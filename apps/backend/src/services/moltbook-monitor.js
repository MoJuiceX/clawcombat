/**
 * Moltbook Monitor Service
 *
 * Monitors Moltbook for #ClawCombat posts to supplement skill-based reporting.
 * This is a secondary analytics mechanism - the primary one is bots reporting via the skill.
 */

const crypto = require('crypto');
const log = require('../utils/logger').createLogger('MOLTBOOK_MONITOR');

const MOLTBOOK_API = process.env.MOLTBOOK_API_URL || 'https://www.moltbook.com/api/v1';

class MoltbookMonitor {
  constructor(db) {
    this.db = db;
  }

  /**
   * Run the monitoring job
   * @returns {object} - Results of the monitoring run
   */
  async runMonitorJob() {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    // Log the run start
    this.db.prepare(`
      INSERT INTO moltbook_monitor_runs (id, started_at)
      VALUES (?, ?)
    `).run(runId, startedAt);

    try {
      // Fetch recent #ClawCombat posts from Moltbook
      const posts = await this.fetchClawCombatPosts();

      let newPosts = 0;
      const errors = [];

      // Batch check for existing posts (fixes N+1 query)
      const postIds = posts.map(p => p.id).filter(Boolean);
      const existingIds = new Set();
      if (postIds.length > 0) {
        const placeholders = postIds.map(() => '?').join(',');
        const existingRows = this.db.prepare(`
          SELECT moltbook_post_id FROM moltbook_discovered_posts WHERE moltbook_post_id IN (${placeholders})
        `).all(...postIds);
        for (const row of existingRows) {
          existingIds.add(row.moltbook_post_id);
        }
      }

      for (const post of posts) {
        try {
          // Skip if we already have this post
          if (existingIds.has(post.id)) continue;

          // Try to match to one of our agents by Moltbook handle
          const matchedAgent = await this.matchAgentByHandle(post.author_handle || post.author);

          // Store the discovered post
          this.db.prepare(`
            INSERT INTO moltbook_discovered_posts
            (id, moltbook_post_id, author_handle, matched_agent_id, post_content, hashtags,
             engagement_likes, engagement_comments, engagement_reposts, discovered_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            post.id,
            post.author_handle || post.author || 'unknown',
            matchedAgent ? matchedAgent.id : null,
            post.content || post.text || '',
            JSON.stringify(post.hashtags || this.extractHashtags(post.content || '')),
            post.likes || 0,
            post.comments || 0,
            post.reposts || post.shares || 0,
            new Date().toISOString()
          );

          newPosts++;
        } catch (err) {
          errors.push(`Failed to process post ${post.id}: ${err.message}`);
        }
      }

      // Update the run record
      this.db.prepare(`
        UPDATE moltbook_monitor_runs
        SET completed_at = ?, posts_found = ?, new_posts_stored = ?, errors = ?
        WHERE id = ?
      `).run(
        new Date().toISOString(),
        posts.length,
        newPosts,
        errors.length > 0 ? JSON.stringify(errors) : null,
        runId
      );

      log.info('Moltbook posts processed', { found: posts.length, newPosts });

      return {
        success: true,
        runId,
        postsFound: posts.length,
        newPosts,
        errors
      };

    } catch (error) {
      // Log the error
      this.db.prepare(`
        UPDATE moltbook_monitor_runs
        SET completed_at = ?, errors = ?
        WHERE id = ?
      `).run(
        new Date().toISOString(),
        JSON.stringify([error.message]),
        runId
      );

      log.error('Moltbook monitor job failed:', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch #ClawCombat posts from Moltbook API
   * @returns {array} - Array of post objects
   */
  async fetchClawCombatPosts() {
    try {
      // Try to fetch from Moltbook API
      const response = await fetch(`${MOLTBOOK_API}/search?hashtag=ClawCombat&limit=100`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ClawCombat-Monitor/1.0'
        },
        timeout: 30000
      });

      if (!response.ok) {
        // If API doesn't exist or returns error, return empty
        // This is expected in development or if Moltbook API changes
        log.info('Moltbook API error, using empty result', { status: response.status });
        return [];
      }

      const data = await response.json();
      return data.posts || data.results || data || [];

    } catch (error) {
      // Network error or API not available
      // This is not necessarily a failure - Moltbook API might not be available
      log.info('Could not reach Moltbook API', { error: error.message });
      return [];
    }
  }

  /**
   * Try to match a Moltbook handle to one of our registered agents
   * @param {string} handle - Moltbook username/handle
   * @returns {object|null} - Matched agent or null
   */
  async matchAgentByHandle(handle) {
    if (!handle) return null;

    return this.db.prepare(`
      SELECT id, name, moltbook_handle FROM agents WHERE moltbook_handle = ?
    `).get(handle);
  }

  /**
   * Extract hashtags from post content
   * @param {string} content - Post content
   * @returns {array} - Array of hashtags
   */
  extractHashtags(content) {
    const matches = content.match(/#\w+/g);
    return matches || [];
  }

  /**
   * Get gap analysis - posts discovered but not reported
   * @returns {array} - Posts that weren't reported via skill
   */
  getGapAnalysis() {
    return this.db.prepare(`
      SELECT
        mdp.author_handle,
        mdp.post_content,
        mdp.discovered_at,
        mdp.engagement_likes,
        mdp.engagement_comments,
        a.name as agent_name,
        CASE WHEN mrp.id IS NULL THEN 'Not Reported' ELSE 'Reported' END as status
      FROM moltbook_discovered_posts mdp
      LEFT JOIN agents a ON mdp.matched_agent_id = a.id
      LEFT JOIN moltbook_reported_posts mrp
        ON mdp.moltbook_post_id = mrp.moltbook_post_id
      WHERE mdp.matched_agent_id IS NOT NULL
      ORDER BY mdp.discovered_at DESC
      LIMIT 100
    `).all();
  }

  /**
   * Get recent monitoring run history
   * @returns {array} - Recent monitor runs
   */
  getRunHistory() {
    return this.db.prepare(`
      SELECT * FROM moltbook_monitor_runs
      ORDER BY started_at DESC
      LIMIT 20
    `).all();
  }

  /**
   * Update engagement metrics for discovered posts
   * @param {string} moltbookPostId - Moltbook post ID
   * @param {object} engagement - { likes, comments, reposts }
   */
  updateEngagement(moltbookPostId, engagement) {
    this.db.prepare(`
      UPDATE moltbook_discovered_posts
      SET engagement_likes = ?, engagement_comments = ?, engagement_reposts = ?
      WHERE moltbook_post_id = ?
    `).run(
      engagement.likes || 0,
      engagement.comments || 0,
      engagement.reposts || 0,
      moltbookPostId
    );
  }
}

module.exports = MoltbookMonitor;
