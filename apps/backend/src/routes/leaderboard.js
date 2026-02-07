const express = require('express');
const { getDb } = require('../db/schema');
const { TYPE_EMOJIS, VALID_TYPES } = require('../utils/type-system');
const crypto = require('crypto');
const { createSingleValueCache, createTTLCache } = require('../utils/cache');
const { MS_PER_DAY } = require('../config/constants');

const router = express.Router();

// ============================================================================
// CACHING: Reduce expensive query load
// ============================================================================

// Stats summary cache (60s TTL) - shared across endpoints
const statsSummaryCache = createSingleValueCache({
  name: 'leaderboard-stats',
  ttlMs: 60 * 1000
});

// Leaderboard page cache (30s TTL) - keyed by page:limit:type
const leaderboardPageCache = createTTLCache({
  name: 'leaderboard-pages',
  ttlMs: 30 * 1000,
  maxSize: 50, // Cache up to 50 different page combinations
  cleanupIntervalMs: 60 * 1000
});

// Portfolio leaderboard cache (60s TTL)
const portfolioCache = createTTLCache({
  name: 'portfolio-pages',
  ttlMs: 60 * 1000,
  maxSize: 20,
  cleanupIntervalMs: 120 * 1000
});

// Ranked leaderboard cache (30s TTL)
const rankedCache = createTTLCache({
  name: 'ranked-pages',
  ttlMs: 30 * 1000,
  maxSize: 50,
  cleanupIntervalMs: 60 * 1000
});

// Operator/agent detail cache (30s TTL)
const operatorCache = createTTLCache({
  name: 'operator-detail',
  ttlMs: 30 * 1000,
  maxSize: 100, // Cache up to 100 agent details
  cleanupIntervalMs: 60 * 1000
});

/**
 * Fetch stats summary (cached)
 */
function getStatsSummary(db) {
  return statsSummaryCache.getOrCompute(() => {
    try {
      const s = db.prepare(`
        SELECT COUNT(*) as total_lobsters,
               MAX(COALESCE(level, 1)) as max_level
        FROM agents WHERE status = 'active'
      `).get();
      const b = db.prepare(`SELECT COUNT(*) as total_battles FROM battles WHERE status = 'finished'`).get();
      return {
        total_lobsters: s.total_lobsters,
        total_battles: b ? b.total_battles : 0,
        max_level: s.max_level || 0
      };
    } catch (e) {
      return { total_lobsters: 0, total_battles: 0, max_level: 0 };
    }
  });
}

// Initialize leaderboard_archive table
try {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS leaderboard_archive (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      agent_name TEXT,
      final_rank INTEGER,
      final_level INTEGER,
      final_win_rate REAL,
      final_battles INTEGER,
      season_number INTEGER,
      archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS season_meta (
      id INTEGER PRIMARY KEY DEFAULT 1,
      current_season INTEGER DEFAULT 1
    );
    INSERT OR IGNORE INTO season_meta (id, current_season) VALUES (1, 1);
  `);
} catch (e) { /* tables may already exist */ }

// GET /leaderboard?page=1&limit=100&search=MyBot&type=FIRE
router.get('/', (req, res) => {
  const db = getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  const typeFilter = req.query.type ? req.query.type.toUpperCase() : '';

  // SECURITY: Don't expose session_token directly, use CASE to derive is_unclaimed boolean
  let query = `SELECT id, name, total_wins, total_fights, total_judgments, xp, reputation_level, ai_type, level,
    owner_id, claimed_at, CASE WHEN session_token IS NOT NULL THEN 1 ELSE 0 END AS has_session
    FROM agents WHERE status = 'active'`;
  const params = [];

  if (search) {
    query += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }

  if (typeFilter && VALID_TYPES.includes(typeFilter)) {
    query += ' AND ai_type = ?';
    params.push(typeFilter);
  }

  // Get total count
  const countQuery = query.replace(/SELECT .+ FROM/, 'SELECT COUNT(*) as cnt FROM');
  const total = db.prepare(countQuery).get(...params).cnt;

  query += ' ORDER BY xp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const agents = db.prepare(query).all(...params);

  // Get badge holders for all returned agents in one query
  const agentIds = agents.map(a => a.id);
  const badgeMap = {};
  if (agentIds.length > 0) {
    try {
      const placeholders = agentIds.map(() => '?').join(',');
      const badgeRows = db.prepare(`
        SELECT pb.agent_id, b.id as badge_id, b.name as badge_name, b.tier
        FROM player_badges pb
        JOIN badges b ON b.id = pb.badge_id
        WHERE pb.agent_id IN (${placeholders})
      `).all(...agentIds);
      for (const row of badgeRows) {
        if (!badgeMap[row.agent_id]) badgeMap[row.agent_id] = [];
        badgeMap[row.agent_id].push({ id: row.badge_id, name: row.badge_name, tier: row.tier });
      }
    } catch (e) { /* badges table may not exist yet */ }
  }

  res.json({
    leaderboard: agents.map((a, idx) => ({
      rank: offset + idx + 1,
      agent_id: a.id,
      name: a.name,
      type: a.ai_type || 'NEUTRAL',
      type_emoji: TYPE_EMOJIS[a.ai_type] || '⚪',
      level: a.level || 1,
      wins: a.total_wins,
      losses: a.total_fights - a.total_wins,
      win_rate: a.total_fights > 0 ? Math.round((a.total_wins / a.total_fights) * 1000) / 1000 : 0,
      xp: a.xp || 0,
      reputation_level: a.reputation_level || 'Newcomer',
      badges: badgeMap[a.id] || [],
      is_unclaimed: !a.owner_id && !a.claimed_at && !!a.has_session
    })),
    page,
    limit,
    has_next: agents.length === limit && (offset + limit) < total,
    total_results: total,
    type_filter: typeFilter || null,
    available_types: VALID_TYPES,
  });
});

// GET /leaderboard/portfolio - Portfolio leaderboard (users ranked by total team XP)
router.get('/portfolio', (req, res) => {
  const db = getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const total = db.prepare(`
    SELECT COUNT(DISTINCT owner_id) as cnt FROM agents
    WHERE owner_id IS NOT NULL AND status = 'active'
  `).get().cnt;

  const portfolios = db.prepare(`
    SELECT
      owner_id,
      COUNT(*) as agent_count,
      SUM(xp) as total_xp,
      SUM(total_wins) as total_wins,
      SUM(total_fights) as total_fights,
      MAX(xp) as best_xp
    FROM agents
    WHERE owner_id IS NOT NULL AND status = 'active'
    GROUP BY owner_id
    ORDER BY total_xp DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  // PERFORMANCE FIX: Batch fetch all agents in ONE query instead of N+1
  const ownerIds = portfolios.map(p => p.owner_id);
  const agentsByOwner = {};

  if (ownerIds.length > 0) {
    const placeholders = ownerIds.map(() => '?').join(',');
    const allAgents = db.prepare(`
      SELECT owner_id, name, xp, ai_type FROM agents
      WHERE owner_id IN (${placeholders}) AND status = 'active'
      ORDER BY owner_id, xp DESC
    `).all(...ownerIds);

    // Group agents by owner_id
    for (const agent of allAgents) {
      if (!agentsByOwner[agent.owner_id]) {
        agentsByOwner[agent.owner_id] = [];
      }
      agentsByOwner[agent.owner_id].push(agent);
    }
  }

  const result = portfolios.map((p, idx) => {
    const agents = agentsByOwner[p.owner_id] || [];

    return {
      rank: offset + idx + 1,
      owner_id: p.owner_id,
      agent_count: p.agent_count,
      total_xp: p.total_xp,
      best_xp: p.best_xp,
      total_wins: p.total_wins,
      total_fights: p.total_fights,
      win_rate: p.total_fights > 0 ? Math.round((p.total_wins / p.total_fights) * 1000) / 1000 : 0,
      agents: agents.map(a => ({
        name: a.name,
        xp: a.xp || 0,
        level: Math.floor((a.xp || 0) / 1000) + 1,
        type: a.ai_type || 'NEUTRAL',
        type_emoji: TYPE_EMOJIS[a.ai_type] || '',
      })),
    };
  });

  res.json({
    portfolio_leaderboard: result,
    page,
    limit,
    has_next: portfolios.length === limit && (offset + limit) < total,
    total_results: total,
  });
});

// ---------------------------------------------------------------------------
// GET /leaderboard/ranked - Level-based ranking
// ---------------------------------------------------------------------------
router.get('/ranked', (req, res) => {
  const db = getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  // Support direct offset param, otherwise calculate from page
  const offset = req.query.offset !== undefined
    ? Math.max(0, parseInt(req.query.offset) || 0)
    : (page - 1) * limit;
  const search = req.query.search || '';
  const typeFilter = req.query.type ? req.query.type.toUpperCase() : '';

  let whereClause = "WHERE status = 'active'";
  const params = [];

  if (search) {
    whereClause += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }

  if (typeFilter && VALID_TYPES.includes(typeFilter)) {
    whereClause += ' AND ai_type = ?';
    params.push(typeFilter);
  }

  // Total count
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM agents ${whereClause}`).get(...params).cnt;

  // Fetch ranked agents (using pre-computed rank column for efficiency)
  // SECURITY: Use CASE to derive has_session instead of exposing session_token
  const agents = db.prepare(`
    SELECT id, name, level, ai_type, total_wins, total_fights, xp,
      owner_id, claimed_at, rank, CASE WHEN session_token IS NOT NULL THEN 1 ELSE 0 END AS has_session,
      username_color, profile_border, title, is_premium
    FROM agents
    ${whereClause}
    ORDER BY
      COALESCE(rank, 999999999) ASC,
      COALESCE(level, 1) DESC,
      CASE WHEN total_fights > 0 THEN CAST(total_wins AS REAL) / total_fights ELSE 0 END DESC,
      total_fights DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // Badges
  const agentIds = agents.map(a => a.id);
  const badgeMap = {};
  if (agentIds.length > 0) {
    try {
      const placeholders = agentIds.map(() => '?').join(',');
      const badgeRows = db.prepare(`
        SELECT pb.agent_id, b.id as badge_id, b.name as badge_name, b.tier
        FROM player_badges pb
        JOIN badges b ON b.id = pb.badge_id
        WHERE pb.agent_id IN (${placeholders})
      `).all(...agentIds);
      for (const row of badgeRows) {
        if (!badgeMap[row.agent_id]) badgeMap[row.agent_id] = [];
        badgeMap[row.agent_id].push({ id: row.badge_id, name: row.badge_name, tier: row.tier });
      }
    } catch (e) { /* badges table may not exist yet */ }
  }

  // Season info
  let currentSeason = 1;
  try {
    const meta = db.prepare('SELECT current_season FROM season_meta WHERE id = 1').get();
    if (meta) currentSeason = meta.current_season;
  } catch (e) { /* */ }

  // Stats summary (cached - 60s TTL)
  const stats = getStatsSummary(db);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  res.json({
    leaderboard: agents.map((a, idx) => {
      const wins = a.total_wins || 0;
      const fights = a.total_fights || 0;
      const losses = fights - wins;
      const winRate = fights > 0 ? Math.round((wins / fights) * 1000) / 1000 : 0;
      return {
        // Use pre-computed rank if available, fallback to offset-based calculation
        rank: a.rank || (offset + idx + 1),
        agent_id: a.id,
        name: a.name,
        level: a.level || 1,
        type: a.ai_type || 'NEUTRAL',
        type_emoji: TYPE_EMOJIS[a.ai_type] || '⚪',
        win_rate: winRate,
        wins,
        losses,
        total_fights: fights,
        xp: a.xp || 0,
        badges: badgeMap[a.id] || [],
        is_unclaimed: !a.owner_id && !a.claimed_at && !!a.has_session,
        // Cosmetic data
        cosmetics: {
          username_color: a.username_color || null,
          profile_border: a.profile_border || null,
          title: a.title || null,
          is_premium: !!a.is_premium
        }
      };
    }),
    page,
    limit,
    total_pages: totalPages,
    has_next: (offset + limit) < total,
    has_prev: page > 1,
    total_results: total,
    season: currentSeason,
    stats,
    type_filter: typeFilter || null,
    available_types: VALID_TYPES,
  });
});

// ---------------------------------------------------------------------------
// GET /leaderboard/operator/:operatorId - Operator detail stats
// ---------------------------------------------------------------------------
router.get('/operator/:operatorId', (req, res) => {
  const db = getDb();
  const operatorId = req.params.operatorId;

  // Look up agent by id or name (include pre-computed rank column)
  const agent = db.prepare(`
    SELECT id, name, level, ai_type, total_wins, total_fights, xp, rank
    FROM agents WHERE (id = ? OR name = ?) AND status = 'active'
  `).get(operatorId, operatorId);

  if (!agent) {
    return res.status(404).json({ error: 'Operator not found' });
  }

  // Use pre-computed rank for O(1) lookup (populated by recomputeAllRanks job every 60s)
  // Falls back to 1 if rank hasn't been computed yet
  const rank = agent.rank || 1;

  // Total active agents
  const totalActive = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'active'").get().cnt;

  // Percentile
  const percentile = totalActive > 1
    ? Math.round((1 - (rank - 1) / totalActive) * 10000) / 100
    : 100;

  // Nearby ranks (+/- 5) - use pre-computed rank for efficient lookup
  const nearbyOffset = Math.max(0, rank - 6); // 5 above = ranks rank-5..rank-1
  const nearbyLimit = 11; // 5 above + self + 5 below
  const nearby = db.prepare(`
    SELECT id, name, level, ai_type, total_wins, total_fights, xp, rank
    FROM agents WHERE status = 'active'
    ORDER BY
      COALESCE(rank, 999999999) ASC,
      COALESCE(level, 1) DESC,
      CASE WHEN total_fights > 0 THEN CAST(total_wins AS REAL) / total_fights ELSE 0 END DESC,
      total_fights DESC
    LIMIT ? OFFSET ?
  `).all(nearbyLimit, nearbyOffset);

  const wins = agent.total_wins || 0;
  const fights = agent.total_fights || 0;
  const winRate = fights > 0 ? Math.round((wins / fights) * 1000) / 1000 : 0;

  res.json({
    operator: {
      id: agent.id,
      name: agent.name,
      rank,
      level: agent.level || 1,
      type: agent.ai_type || 'NEUTRAL',
      type_emoji: TYPE_EMOJIS[agent.ai_type] || '⚪',
      win_rate: winRate,
      wins,
      losses: fights - wins,
      total_battles: fights,
      xp: agent.xp || 0,
      percentile,
    },
    nearby_ranks: nearby.map((a, idx) => {
      const w = a.total_wins || 0;
      const f = a.total_fights || 0;
      return {
        // Use pre-computed rank if available, fallback to offset-based
        rank: a.rank || (nearbyOffset + idx + 1),
        name: a.name,
        level: a.level || 1,
        type: a.ai_type || 'NEUTRAL',
        win_rate: f > 0 ? Math.round((w / f) * 1000) / 1000 : 0,
        total_fights: f,
        is_self: a.id === agent.id,
      };
    }),
    total_operators: totalActive,
  });
});

// ---------------------------------------------------------------------------
// POST /leaderboard/season/reset - Seasonal reset (admin only)
// ---------------------------------------------------------------------------
const { requireAdmin } = require('../middleware/admin-auth');
router.post('/season/reset', requireAdmin, (req, res) => {

  const db = getDb();

  try {
    // Get current season
    let currentSeason = 1;
    try {
      const meta = db.prepare('SELECT current_season FROM season_meta WHERE id = 1').get();
      if (meta) currentSeason = meta.current_season;
    } catch (e) { /* */ }

    // Archive current leaderboard
    const agents = db.prepare(`
      SELECT id, name, level, total_wins, total_fights
      FROM agents WHERE status = 'active'
      ORDER BY
        COALESCE(level, 1) DESC,
        CASE WHEN total_fights > 0 THEN CAST(total_wins AS REAL) / total_fights ELSE 0 END DESC,
        total_fights DESC
    `).all();

    const insertArchive = db.prepare(`
      INSERT INTO leaderboard_archive (id, agent_id, agent_name, final_rank, final_level, final_win_rate, final_battles, season_number, reward_badge, reward_cosmetic)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Note: resetAgent loop replaced with bulk UPDATE in transaction

    // Seed seasonal badges if they don't exist
    const ensureBadge = db.prepare(`
      INSERT OR IGNORE INTO badges (id, name, description, tier) VALUES (?, ?, ?, ?)
    `);
    ensureBadge.run(`season_${currentSeason}_top10`, `Season ${currentSeason} Top 10`, `Finished in the top 10 of Season ${currentSeason}`, 'legendary');
    ensureBadge.run(`season_${currentSeason}_top50`, `Season ${currentSeason} Top 50`, `Finished in the top 50 of Season ${currentSeason}`, 'epic');
    ensureBadge.run(`season_${currentSeason}_top100`, `Season ${currentSeason} Top 100`, `Finished in the top 100 of Season ${currentSeason}`, 'rare');

    const awardBadge = db.prepare(`
      INSERT OR IGNORE INTO player_badges (id, agent_id, badge_id, earned_by) VALUES (?, ?, ?, 'seasonal')
    `);

    const transaction = db.transaction(() => {
      // Archive each agent + award badges to top 100
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        const fights = a.total_fights || 0;
        const wins = a.total_wins || 0;
        const winRate = fights > 0 ? Math.round((wins / fights) * 1000) / 1000 : 0;
        const rank = i + 1;
        const archiveId = crypto.randomUUID();

        // Determine reward tier
        let rewardBadge = null;
        let rewardCosmetic = null;
        if (rank <= 10) {
          rewardBadge = 'top_10';
          rewardCosmetic = `season_${currentSeason}_legendary`;
        } else if (rank <= 50) {
          rewardBadge = 'top_50';
          rewardCosmetic = `season_${currentSeason}_epic`;
        } else if (rank <= 100) {
          rewardBadge = 'top_100';
          rewardCosmetic = `season_${currentSeason}_rare`;
        }

        insertArchive.run(
          archiveId, a.id, a.name,
          rank, a.level || 1,
          winRate, fights,
          currentSeason,
          rewardBadge, rewardCosmetic
        );

        // Award badge to top 100
        if (rank <= 100) {
          const badgeId = rank <= 10
            ? `season_${currentSeason}_top10`
            : rank <= 50
              ? `season_${currentSeason}_top50`
              : `season_${currentSeason}_top100`;
          awardBadge.run(crypto.randomUUID(), a.id, badgeId);
        }
      }

      // Reset wins/losses counters (keep level and XP) - bulk update instead of loop
      db.prepare(`UPDATE agents SET total_wins = 0, total_fights = 0 WHERE status = 'active'`).run();

      // Increment season
      db.prepare('UPDATE season_meta SET current_season = current_season + 1 WHERE id = 1').run();
    });

    transaction();

    const newSeason = currentSeason + 1;

    res.json({
      success: true,
      message: `Season ${currentSeason} archived. Season ${newSeason} has begun.`,
      archived_agents: agents.length,
      previous_season: currentSeason,
      new_season: newSeason,
    });
  } catch (e) {
    const log = require('../utils/logger').createLogger('LEADERBOARD');
    log.error('Season reset failed', { error: e.message });
    res.status(500).json({ error: 'Season reset failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /leaderboard/current-season - Current season info
// ---------------------------------------------------------------------------
router.get('/current-season', (req, res) => {
  const db = getDb();

  let currentSeason = 1;
  try {
    const meta = db.prepare('SELECT current_season FROM season_meta WHERE id = 1').get();
    if (meta) currentSeason = meta.current_season;
  } catch (e) { /* */ }

  // Calculate days remaining in current month
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysRemaining = Math.ceil((endOfMonth - now) / MS_PER_DAY);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  res.json({
    season_number: currentSeason,
    started_at: startOfMonth.toISOString(),
    ends_at: endOfMonth.toISOString(),
    days_remaining: daysRemaining,
  });
});

// ---------------------------------------------------------------------------
// GET /leaderboard/season/:seasonNumber - Archived season results
// ---------------------------------------------------------------------------
router.get('/season/:seasonNumber', (req, res) => {
  const db = getDb();
  const seasonNumber = parseInt(req.params.seasonNumber, 10);

  if (!seasonNumber || seasonNumber < 1) {
    return res.status(400).json({ error: 'Invalid season number' });
  }

  const archives = db.prepare(`
    SELECT agent_id, agent_name, final_rank, final_level, final_win_rate, final_battles, reward_badge, reward_cosmetic, archived_at
    FROM leaderboard_archive
    WHERE season_number = ?
    ORDER BY final_rank ASC
    LIMIT 100
  `).all(seasonNumber);

  if (archives.length === 0) {
    return res.status(404).json({ error: `No data for season ${seasonNumber}` });
  }

  res.json({
    season: seasonNumber,
    results: archives.map(a => ({
      rank: a.final_rank,
      agent_id: a.agent_id,
      name: a.agent_name,
      level: a.final_level,
      win_rate: a.final_win_rate,
      total_battles: a.final_battles,
      reward_badge: a.reward_badge || null,
      reward_cosmetic: a.reward_cosmetic || null,
      archived_at: a.archived_at,
    })),
    total_archived: archives.length,
  });
});

module.exports = router;
