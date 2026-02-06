'use strict';

const { getDb } = require('../db/schema');
const { getFightLimitInfo, recordFight } = require('../middleware/rate-limit');
const { calculateScaledXP, checkLevelUp } = require('../utils/xp-scaling');
const { getAgentById } = require('./agent-queries');

// ============================================================================
// Schema Migration
// Add `level` column to battle_queue if it does not exist.
// ============================================================================

function ensureQueueSchema(db) {
  try {
    db.exec('ALTER TABLE battle_queue ADD COLUMN level INTEGER DEFAULT 1');
  } catch (e) {
    // Column already exists — safe to ignore
  }
}

// ============================================================================
// Expanding Search Ranges
// The longer an agent waits, the wider the level range we search.
//
//   0-30 seconds:  +/- 5 levels
//   30-60 seconds: +/- 10 levels
//   60-90 seconds: +/- 20 levels
//   90+ seconds:   any level
// ============================================================================

function getLevelRange(waitSeconds) {
  if (waitSeconds < 30) return 5;
  if (waitSeconds < 60) return 10;
  if (waitSeconds < 90) return 20;
  return Infinity;
}

// ============================================================================
// joinQueue
// Adds an agent to the matchmaking queue with level-based matching.
// Checks rate limits before allowing queue entry.
//
// Returns: { status, queuePosition?, reason?, tier?, remaining? }
// ============================================================================

function joinQueue(db, agent) {
  ensureQueueSchema(db);

  // Check rate limit before allowing queue join
  const limitInfo = getFightLimitInfo(agent);
  if (!limitInfo.allowed) {
    return {
      status: 'rate_limited',
      reason: limitInfo.reason,
      tier: limitInfo.tier,
      remaining: limitInfo.remaining,
    };
  }

  // Check if already in queue
  const existing = db.prepare('SELECT * FROM battle_queue WHERE agent_id = ?').get(agent.id);
  if (existing) {
    const position = db.prepare(
      'SELECT COUNT(*) AS pos FROM battle_queue WHERE joined_at <= ?'
    ).get(existing.joined_at);
    return { status: 'already_queued', queuePosition: position.pos };
  }

  // Check if already in an active battle
  const activeBattle = db.prepare(`
    SELECT id FROM battles
    WHERE (agent_a_id = ? OR agent_b_id = ?) AND status IN ('active', 'pending')
  `).get(agent.id, agent.id);
  if (activeBattle) {
    return { status: 'already_in_battle', battleId: activeBattle.id };
  }

  const level = agent.level || 1;

  db.prepare(
    'INSERT INTO battle_queue (agent_id, level) VALUES (?, ?)'
  ).run(agent.id, level);

  const position = db.prepare('SELECT COUNT(*) AS pos FROM battle_queue').get();
  return { status: 'queued', queuePosition: position.pos };
}

// ============================================================================
// leaveQueue
// Removes an agent from the matchmaking queue.
// ============================================================================

function leaveQueue(db, agentId) {
  const result = db.prepare('DELETE FROM battle_queue WHERE agent_id = ?').run(agentId);
  return { status: result.changes > 0 ? 'removed' : 'not_in_queue' };
}

// ============================================================================
// findMatch
// Finds a suitable opponent for a specific agent based on level proximity
// and expanding time-based search ranges.
//
// Returns: opponent queue row or null
// ============================================================================

function findMatch(db, agentId) {
  ensureQueueSchema(db);

  const entry = db.prepare('SELECT * FROM battle_queue WHERE agent_id = ?').get(agentId);
  if (!entry) return null;

  const now = Date.now();
  const joinedAt = new Date(entry.joined_at).getTime();
  const waitSeconds = (now - joinedAt) / 1000;
  const levelRange = getLevelRange(waitSeconds);
  const agentLevel = entry.level || 1;

  let opponent;

  if (levelRange === Infinity) {
    // Any level — pick closest level
    opponent = db.prepare(`
      SELECT * FROM battle_queue
      WHERE agent_id != ?
      ORDER BY ABS(level - ?) ASC
      LIMIT 1
    `).get(agentId, agentLevel);
  } else {
    // Restricted level range
    const minLevel = agentLevel - levelRange;
    const maxLevel = agentLevel + levelRange;

    opponent = db.prepare(`
      SELECT * FROM battle_queue
      WHERE agent_id != ?
        AND level >= ? AND level <= ?
      ORDER BY ABS(level - ?) ASC
      LIMIT 1
    `).get(agentId, minLevel, maxLevel, agentLevel);
  }

  return opponent || null;
}

// ============================================================================
// processQueue
// Runs periodically to match all eligible pairs in the queue.
// Uses expanding search ranges for each queued agent.
//
// Returns: array of { agentA, agentB } matched pairs (agent_id values)
// ============================================================================

function processQueue(db) {
  ensureQueueSchema(db);

  // Use a transaction to prevent race conditions where two simultaneous requests
  // could match the same agent to different opponents. The transaction runs
  // synchronously in better-sqlite3 and blocks other writers, ensuring atomicity.
  const processTransaction = db.transaction(() => {
    const queue = db.prepare('SELECT * FROM battle_queue ORDER BY joined_at ASC').all();
    if (queue.length < 2) return [];

    const matched = new Set();
    const matches = [];
    const now = Date.now();

    for (const entry of queue) {
      if (matched.has(entry.agent_id)) continue;

      const joinedAt = new Date(entry.joined_at).getTime();
      const waitSeconds = (now - joinedAt) / 1000;
      const levelRange = getLevelRange(waitSeconds);
      const agentLevel = entry.level || 1;

      // Find best opponent among unmatched queue entries
      let bestOpponent = null;
      let bestScore = Infinity;

      for (const candidate of queue) {
        if (candidate.agent_id === entry.agent_id) continue;
        if (matched.has(candidate.agent_id)) continue;

        const candidateLevel = candidate.level || 1;
        const levelDiff = Math.abs(agentLevel - candidateLevel);

        // Check level range constraint
        if (levelRange !== Infinity && levelDiff > levelRange) continue;

        // Score: prefer closer levels
        const score = levelDiff;

        if (score < bestScore) {
          bestScore = score;
          bestOpponent = candidate;
        }
      }

      if (bestOpponent) {
        matched.add(entry.agent_id);
        matched.add(bestOpponent.agent_id);

        // Remove both from queue atomically within the transaction
        const removeStmt = db.prepare('DELETE FROM battle_queue WHERE agent_id = ?');
        removeStmt.run(entry.agent_id);
        removeStmt.run(bestOpponent.agent_id);

        matches.push({
          agentA: entry.agent_id,
          agentB: bestOpponent.agent_id,
          levelDiff: Math.abs((entry.level || 1) - (bestOpponent.level || 1)),
        });
      }
    }

    return matches;
  });

  // Execute the transaction - this blocks other writers until complete
  const matches = processTransaction();

  // Record fights for rate limiting (outside transaction since it's in-memory)
  for (const match of matches) {
    recordFight(match.agentA);
    recordFight(match.agentB);
  }

  return matches;
}

// ============================================================================
// completeBattle
// Called when a battle finishes. Awards scaled XP to winner and loser
// based on their level difference.
//
// Returns: { winnerXP, loserXP, winnerLevelUp, loserLevelUp }
// ============================================================================

function completeBattle(db, battleId, winnerId, loserId) {
  const winner = getAgentById(winnerId);
  const loser = getAgentById(loserId);

  if (!winner || !loser) {
    throw new Error('Winner or loser agent not found');
  }

  const winnerLevel = winner.level || 1;
  const loserLevel = loser.level || 1;

  // Calculate scaled XP
  const { winXP, lossXP, scaleFactor, levelDiff } = calculateScaledXP(winnerLevel, loserLevel);

  // Award XP to winner
  const newWinnerXP = (winner.xp || 0) + winXP;
  db.prepare('UPDATE agents SET xp = ? WHERE id = ?').run(newWinnerXP, winnerId);

  // Award XP to loser (consolation XP)
  const newLoserXP = (loser.xp || 0) + lossXP;
  db.prepare('UPDATE agents SET xp = ? WHERE id = ?').run(newLoserXP, loserId);

  // Check for level ups
  const winnerAgent = { ...winner, xp: newWinnerXP };
  const loserAgent = { ...loser, xp: newLoserXP };

  const winnerLevelUp = checkLevelUp(winnerAgent);
  const loserLevelUp = checkLevelUp(loserAgent);

  // Log XP awards in battle record
  try {
    db.prepare(`
      UPDATE battles SET
        state_json = json_set(
          COALESCE(state_json, '{}'),
          '$.xpAwarded', json('{"winnerXP":' || ? || ',"loserXP":' || ? || ',"scaleFactor":' || ? || '}')
        )
      WHERE id = ?
    `).run(winXP, lossXP, scaleFactor, battleId);
  } catch (e) {
    // Non-critical — XP is already saved on agents
  }

  return {
    winnerXP: winXP,
    loserXP: lossXP,
    scaleFactor,
    levelDiff,
    winnerLevelUp,
    loserLevelUp,
  };
}

// ============================================================================
// getQueueStats
// Returns current matchmaking queue statistics.
// ============================================================================

function getQueueStats(db) {
  ensureQueueSchema(db);

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS size,
      COALESCE(AVG(level), 0) AS avgLevel,
      COALESCE(MIN(level), 0) AS minLevel,
      COALESCE(MAX(level), 0) AS maxLevel
    FROM battle_queue
  `).get();

  // Calculate average wait time
  const waitInfo = db.prepare(`
    SELECT
      COALESCE(AVG((strftime('%s', 'now') - strftime('%s', joined_at))), 0) AS avgWaitSeconds,
      COALESCE(MAX((strftime('%s', 'now') - strftime('%s', joined_at))), 0) AS maxWaitSeconds
    FROM battle_queue
  `).get();

  return {
    size: stats.size,
    avgLevel: Math.round(stats.avgLevel * 10) / 10,
    minLevel: stats.minLevel,
    maxLevel: stats.maxLevel,
    avgWaitSeconds: Math.round(waitInfo.avgWaitSeconds),
    maxWaitSeconds: Math.round(waitInfo.maxWaitSeconds),
  };
}

module.exports = {
  joinQueue,
  leaveQueue,
  findMatch,
  processQueue,
  completeBattle,
  getQueueStats,
};
