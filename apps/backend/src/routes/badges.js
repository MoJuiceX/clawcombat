const log = require('../utils/logger').createLogger('BADGES');
const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/schema');

const router = express.Router();

// GET /badges — List all available badges (public)
router.get('/', (req, res) => {
  const db = getDb();
  const badges = db.prepare('SELECT id, name, description, icon_url, tier, created_at FROM badges ORDER BY created_at ASC').all();
  res.json({ badges });
});

// GET /badges/agents/:id — Get badges for a specific agent (public)
router.get('/agents/:id', (req, res) => {
  const db = getDb();
  const agentId = req.params.id;

  const agent = db.prepare("SELECT id, name FROM agents WHERE id = ? AND status = 'active'").get(agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const badges = db.prepare(`
    SELECT b.id, b.name, b.description, b.icon_url, b.tier, pb.awarded_at, pb.earned_by
    FROM player_badges pb
    JOIN badges b ON b.id = pb.badge_id
    WHERE pb.agent_id = ?
    ORDER BY pb.awarded_at DESC
  `).all(agentId);

  res.json({ agent_id: agentId, agent_name: agent.name, badges });
});

// POST /badges/recalculate — Admin-only: recalculate Launch Champion badges
const { requireAdmin } = require('../middleware/admin-auth');
router.post('/recalculate', requireAdmin, (req, res) => {

  const db = getDb();
  const result = recalculateBadges(db);

  // Log admin action
  try {
    db.prepare('INSERT INTO admin_logs (id, action, payload) VALUES (?, ?, ?)').run(
      crypto.randomUUID(), 'recalculate_badges', JSON.stringify(result)
    );
  } catch (e) { log.error('Admin log error:', { error: e.message }); }

  res.json({ status: 'ok', ...result });
});

function recalculateBadges(db) {
  const BADGE_ID = 'launch_champion';
  const TOP_N = 100;

  // Get top 100 agents by XP (matching leaderboard sort: level desc then xp desc)
  // Level = floor(xp / 1000) + 1, so sorting by xp DESC is equivalent
  const topAgents = db.prepare(`
    SELECT id FROM agents
    WHERE status = 'active'
    ORDER BY xp DESC, total_wins DESC
    LIMIT ?
  `).all(TOP_N);

  const topIds = new Set(topAgents.map(a => a.id));

  // Get current badge holders
  const currentHolders = db.prepare(
    "SELECT agent_id FROM player_badges WHERE badge_id = ? AND earned_by = 'ranking'"
  ).all(BADGE_ID);
  const currentIds = new Set(currentHolders.map(h => h.agent_id));

  let added = 0;
  let removed = 0;

  // Batch badge updates in a transaction for better performance
  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO player_badges (id, agent_id, badge_id, earned_by) VALUES (?, ?, ?, ?)'
  );
  const deleteStmt = db.prepare(
    "DELETE FROM player_badges WHERE agent_id = ? AND badge_id = ? AND earned_by = 'ranking'"
  );

  const updateBadges = db.transaction(() => {
    // Award badge to top agents who don't have it
    for (const id of topIds) {
      if (!currentIds.has(id)) {
        insertStmt.run(crypto.randomUUID(), id, BADGE_ID, 'ranking');
        added++;
      }
    }

    // Remove badge from agents no longer in top N (only ranking-based)
    for (const id of currentIds) {
      if (!topIds.has(id)) {
        deleteStmt.run(id, BADGE_ID);
        removed++;
      }
    }
  });

  updateBadges();

  return { badge: BADGE_ID, top_n: TOP_N, added, removed, total_holders: topIds.size };
}

module.exports = router;
module.exports.recalculateBadges = recalculateBadges;
