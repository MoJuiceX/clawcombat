/**
 * REPUTATION XP SYSTEM
 *
 * This file handles REPUTATION XP for governance voting weight.
 * This is SEPARATE from Battle XP (in config/battle-xp-config.js).
 *
 * - Battle XP: Drives player leveling (1-100) through combat
 * - Reputation XP: Drives governance participation and voting weight
 *
 * These are intentionally different systems serving different purposes.
 */

const crypto = require('crypto');
const { getDb } = require('../db/schema');

// Reputation XP Rules (NOT the same as Battle XP)
const XP_AMOUNTS = {
  win: 50,
  loss: 0,
  judge: 5,
  propose: 20,
  build: 100,
  streak: 25
};

// Reputation Levels
function getReputationLevel(xp) {
  if (xp >= 1000) return { level: 'Expert', multiplier: 2.0 };
  if (xp >= 500) return { level: 'Veteran', multiplier: 1.5 };
  if (xp >= 250) return { level: 'Trusted', multiplier: 1.2 };
  if (xp >= 100) return { level: 'Active', multiplier: 1.1 };
  return { level: 'Newcomer', multiplier: 1.0 };
}

function awardXP(agentId, action, xpAmount, reason) {
  const db = getDb();

  if (xpAmount <= 0) return null;

  const id = `xp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  db.prepare(`
    INSERT INTO xp_logs (id, agent_id, action, xp_earned, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, agentId, action, xpAmount, reason || null);

  // Reputation XP is separate from battle XP — drives governance weight only
  const agent = db.prepare('SELECT reputation_xp FROM agents WHERE id = ?').get(agentId);
  const oldXP = agent?.reputation_xp || 0;
  const newXP = oldXP + xpAmount;
  const reputation = getReputationLevel(newXP);

  db.prepare(`
    UPDATE agents
    SET reputation_xp = ?, reputation_level = ?, reputation_multiplier = ?
    WHERE id = ?
  `).run(newXP, reputation.level, reputation.multiplier, agentId);

  return { newXP, reputation };
}

function updateStreak(agentId) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const agent = db.prepare('SELECT current_streak, last_fight_date, best_streak FROM agents WHERE id = ?').get(agentId);
  if (!agent) return;

  if (agent.last_fight_date === today) {
    // Already fought today, no streak change
    return;
  }

  // Check if yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  if (agent.last_fight_date === yesterdayStr) {
    // Streak continues
    const newStreak = (agent.current_streak || 0) + 1;
    const bestStreak = Math.max(agent.best_streak || 0, newStreak);
    db.prepare(`
      UPDATE agents
      SET current_streak = ?, best_streak = ?, last_fight_date = ?
      WHERE id = ?
    `).run(newStreak, bestStreak, today, agentId);

    // 5-day streak bonus
    if (newStreak >= 5 && newStreak % 5 === 0) {
      awardXP(agentId, 'streak', XP_AMOUNTS.streak, `${newStreak}-day fighting streak!`);
    }
  } else {
    // Streak broken or first fight
    db.prepare(`
      UPDATE agents
      SET current_streak = 1, last_fight_date = ?
      WHERE id = ?
    `).run(today, agentId);
  }
}

function getAgentXP(agentId) {
  const db = getDb();
  const agent = db.prepare('SELECT xp, level, reputation_xp, reputation_level, reputation_multiplier, current_streak FROM agents WHERE id = ?').get(agentId);
  return agent || { xp: 0, level: 1, reputation_xp: 0, reputation_level: 'Newcomer', reputation_multiplier: 1.0, current_streak: 0 };
}

function getXPLogs(agentId, limit = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT action, xp_earned, reason, created_at
    FROM xp_logs
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(agentId, limit);
}

module.exports = { awardXP, getReputationLevel, getAgentXP, getXPLogs, updateStreak, XP_AMOUNTS };
