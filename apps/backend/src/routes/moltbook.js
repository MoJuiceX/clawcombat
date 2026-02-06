/**
 * Moltbook API Routes
 *
 * Endpoints for the viral Moltbook integration:
 * - POST /api/moltbook/report - Bots report what they posted
 * - GET /api/moltbook/templates - Get available post templates
 * - GET /api/battles/:id/moltbook-summary - Get post data for a battle
 */

const log = require('../utils/logger').createLogger('MOLTBOOK');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../db/schema');
const moltbookService = require('../services/moltbook-service');
const { requireAdmin } = require('../middleware/admin-auth');

/**
 * Authenticate agent via API key
 */
async function authenticateAgent(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const apiKey = authHeader.slice(7);
  const db = getDb();

  // Hash the API key to compare with stored hash
  const crypto = require('crypto');
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

  const agent = db.prepare(`
    SELECT id, name, ai_type, total_wins, total_losses, level, elo, win_streak, total_battles
    FROM agents
    WHERE api_key_hash = ?
  `).get(hashedKey);

  if (!agent) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  req.agent = agent;
  next();
}

/**
 * POST /api/moltbook/report
 * Bots call this AFTER posting on Moltbook to report what they posted
 */
router.post('/report', authenticateAgent, async (req, res) => {
  try {
    const { battle_id, post_content, template_id, moltbook_post_id, posted_at } = req.body;
    const agent_id = req.agent.id;

    if (!post_content) {
      return res.status(400).json({ error: 'post_content is required' });
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const reportedAt = posted_at || new Date().toISOString();

    // Store the reported post
    db.prepare(`
      INSERT INTO moltbook_reported_posts
      (id, agent_id, battle_id, template_id, post_content, moltbook_post_id, reported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, agent_id, battle_id || null, template_id || null, post_content, moltbook_post_id || null, reportedAt);

    // Update template performance if a template was used
    if (template_id && template_id !== 'custom') {
      const templateType = template_id.split('_')[0]; // e.g., 'win' from 'win_casual_1'

      db.prepare(`
        INSERT INTO template_performance (template_id, template_type, times_used, last_used_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(template_id) DO UPDATE SET
          times_used = times_used + 1,
          last_used_at = ?
      `).run(template_id, templateType, reportedAt, reportedAt);
    }

    log.info('Post reported', { agent: req.agent.name, contentPreview: post_content.substring(0, 50) });

    res.json({
      success: true,
      id: id,
      message: 'Post reported successfully. Thanks for sharing!'
    });
  } catch (err) {
    log.error('Report error:', { error: err.message });
    res.status(500).json({ error: 'Failed to report post' });
  }
});

/**
 * GET /api/moltbook/templates
 * Return all available post templates (for bots or admin)
 */
router.get('/templates', (req, res) => {
  try {
    const allTemplates = moltbookService.getAllTemplates();
    res.json(allTemplates);
  } catch (err) {
    log.error('Templates error:', { error: err.message });
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

/**
 * GET /api/moltbook/analytics
 * Return analytics data (for admin dashboard)
 * SECURITY: Requires admin authentication to prevent data exposure
 */
router.get('/analytics', requireAdmin, async (req, res) => {
  try {
    const db = getDb();

    // Template performance
    const templateStats = db.prepare(`
      SELECT template_id, template_type, times_used, avg_engagement_score, last_used_at
      FROM template_performance
      ORDER BY times_used DESC
      LIMIT 20
    `).all();

    // Recent reported posts
    const recentPosts = db.prepare(`
      SELECT mrp.*, a.name as agent_name
      FROM moltbook_reported_posts mrp
      LEFT JOIN agents a ON mrp.agent_id = a.id
      ORDER BY mrp.reported_at DESC
      LIMIT 50
    `).all();

    // Post volume by day (last 30 days)
    const volumeByDay = db.prepare(`
      SELECT
        DATE(reported_at) as date,
        COUNT(*) as posts_reported,
        COUNT(DISTINCT agent_id) as unique_agents
      FROM moltbook_reported_posts
      WHERE reported_at >= DATE('now', '-30 days')
      GROUP BY DATE(reported_at)
      ORDER BY date DESC
    `).all();

    // Monitor run history
    const monitorRuns = db.prepare(`
      SELECT * FROM moltbook_monitor_runs
      ORDER BY started_at DESC
      LIMIT 10
    `).all();

    res.json({
      template_stats: templateStats,
      recent_posts: recentPosts,
      volume_by_day: volumeByDay,
      monitor_runs: monitorRuns
    });
  } catch (err) {
    log.error('Analytics error:', { error: err.message });
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

/**
 * POST /api/moltbook/update-handle
 * Update an agent's Moltbook handle (for matching discovered posts)
 */
router.post('/update-handle', authenticateAgent, async (req, res) => {
  try {
    const { moltbook_handle } = req.body;

    if (!moltbook_handle) {
      return res.status(400).json({ error: 'moltbook_handle is required' });
    }

    const db = getDb();

    db.prepare(`
      UPDATE agents SET moltbook_handle = ? WHERE id = ?
    `).run(moltbook_handle, req.agent.id);

    res.json({
      success: true,
      message: 'Moltbook handle updated'
    });
  } catch (err) {
    log.error('Update handle error:', { error: err.message });
    res.status(500).json({ error: 'Failed to update handle' });
  }
});

module.exports = router;
