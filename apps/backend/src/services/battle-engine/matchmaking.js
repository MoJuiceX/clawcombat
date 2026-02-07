/**
 * Battle Engine Matchmaking
 * Queue management and timeout handling
 */

'use strict';

const crypto = require('crypto');
const log = require('../../utils/logger').createLogger('BATTLE_ENGINE');

const { mapDbAgent } = require('./constants');
const { BATTLE_TURN_TIMEOUT_MS, MAX_CONSECUTIVE_TIMEOUTS } = require('../../config/constants');
const { checkBattleEnd } = require('./core');
const { applyStatusDamage } = require('./effects');
const { applyMove } = require('./moves');
const { createBattle, saveTurn } = require('./database');

// ============================================================================
// MATCHMAKING
// ============================================================================

function addToQueue(db, agentId) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) throw new Error('Agent not found');

  // Check if already in queue
  const existing = db.prepare('SELECT * FROM battle_queue WHERE agent_id = ?').get(agentId);
  if (existing) return { status: 'already_queued' };

  // Check if already in an active battle
  const activeBattle = db.prepare(`
    SELECT * FROM battles WHERE (agent_a_id = ? OR agent_b_id = ?) AND status IN ('active', 'pending')
  `).get(agentId, agentId);
  if (activeBattle) return { status: 'already_in_battle', battleId: activeBattle.id };

  db.prepare('INSERT INTO battle_queue (agent_id) VALUES (?)').run(agentId);
  return { status: 'queued' };
}

function removeFromQueue(db, agentId) {
  db.prepare('DELETE FROM battle_queue WHERE agent_id = ?').run(agentId);
  return { status: 'removed' };
}

function matchFromQueue(db) {
  // Use a transaction to prevent race conditions where two simultaneous requests
  // could match the same agent to different opponents. The transaction runs
  // synchronously in better-sqlite3 and blocks other writers, ensuring atomicity.
  const matchTransaction = db.transaction(() => {
    // Join with agents to get ELO for skill-based matching
    const queue = db.prepare(`
      SELECT bq.agent_id, COALESCE(a.elo, 1000) as elo, COALESCE(a.level, 1) as level, bq.joined_at
      FROM battle_queue bq
      JOIN agents a ON bq.agent_id = a.id
      ORDER BY bq.joined_at ASC
    `).all();
    if (queue.length < 2) return null;

    // ELO-based matching with expanding ranges
    // Start tight (100), expand to 500, then match anyone
    const ELO_RANGES = [100, 200, 350, 500, Infinity];
    let matchA = null, matchB = null;

    for (const maxDiff of ELO_RANGES) {
      for (let i = 0; i < queue.length && !matchA; i++) {
        for (let j = i + 1; j < queue.length; j++) {
          if (Math.abs(queue[i].elo - queue[j].elo) <= maxDiff) {
            matchA = queue[i];
            matchB = queue[j];
            break;
          }
        }
      }
      if (matchA) break;
    }

    if (!matchA || !matchB) return null;

    // Remove both from queue atomically within the transaction
    const removeStmt = db.prepare('DELETE FROM battle_queue WHERE agent_id = ?');
    removeStmt.run(matchA.agent_id);
    removeStmt.run(matchB.agent_id);

    return { matchA, matchB };
  });

  // Execute the transaction - this blocks other writers until complete
  const matchResult = matchTransaction();
  if (!matchResult) return null;

  const { matchA, matchB } = matchResult;

  // Load full agent data and map DB columns to engine format
  const agentARow = db.prepare('SELECT * FROM agents WHERE id = ?').get(matchA.agent_id);
  const agentBRow = db.prepare('SELECT * FROM agents WHERE id = ?').get(matchB.agent_id);

  if (!agentARow || !agentBRow) return null;

  const agentA = mapDbAgent(agentARow);
  const agentB = mapDbAgent(agentBRow);

  // Load moves from agent_moves table
  const movesStmt = db.prepare('SELECT move_id FROM agent_moves WHERE agent_id = ? ORDER BY slot');
  agentA.moves = movesStmt.all(agentA.id).map(r => r.move_id);
  agentB.moves = movesStmt.all(agentB.id).map(r => r.move_id);

  const battleState = createBattle(db, agentA, agentB);
  return battleState;
}

// ============================================================================
// TIMEOUT HANDLING
// ============================================================================

function checkTimeouts(db, applyBattleResults) {
  const cutoff = new Date(Date.now() - BATTLE_TURN_TIMEOUT_MS).toISOString();
  const staleBattles = db.prepare(`
    SELECT * FROM battles
    WHERE status = 'active'
    AND current_phase = 'waiting'
    AND last_turn_at < ?
    AND (agent_a_move IS NULL OR agent_b_move IS NULL)
  `).all(cutoff);

  const results = [];

  for (const battle of staleBattles) {
    const battleState = JSON.parse(battle.state_json);
    const aSubmitted = battle.agent_a_move !== null;
    const bSubmitted = battle.agent_b_move !== null;

    // Initialize consecutive timeout counters if not present
    if (!battleState._timeoutsA) battleState._timeoutsA = 0;
    if (!battleState._timeoutsB) battleState._timeoutsB = 0;

    let moveA = battle.agent_a_move;
    let moveB = battle.agent_b_move;
    let aSkipped = false;
    let bSkipped = false;

    // Handle side A timeout — uniform: skip turn (no AI fallback)
    if (!aSubmitted) {
      moveA = null;
      aSkipped = true;
      battleState._timeoutsA++;
      log.info('Agent A turn skipped due to timeout', { agent: battleState.agentA.name, timeouts: battleState._timeoutsA, max: MAX_CONSECUTIVE_TIMEOUTS });
    } else {
      battleState._timeoutsA = 0;
    }

    // Handle side B timeout — uniform: skip turn (no AI fallback)
    if (!bSubmitted) {
      moveB = null;
      bSkipped = true;
      battleState._timeoutsB++;
      log.info('Agent B turn skipped due to timeout', { agent: battleState.agentB.name, timeouts: battleState._timeoutsB, max: MAX_CONSECUTIVE_TIMEOUTS });
    } else {
      battleState._timeoutsB = 0;
    }

    // Check for match forfeit due to consecutive timeouts
    if (battleState._timeoutsA >= MAX_CONSECUTIVE_TIMEOUTS || battleState._timeoutsB >= MAX_CONSECUTIVE_TIMEOUTS) {
      const forfeitSide = battleState._timeoutsA >= MAX_CONSECUTIVE_TIMEOUTS ? 'A' : 'B';
      const forfeiter = forfeitSide === 'A' ? battleState.agentA : battleState.agentB;
      const winner = forfeitSide === 'A' ? battle.agent_b_id : battle.agent_a_id;

      log.info('Agent forfeited due to consecutive timeouts', { agent: forfeiter.name, maxTimeouts: MAX_CONSECUTIVE_TIMEOUTS });
      battleState.status = 'finished';
      battleState.winnerId = winner;

      db.prepare(`
        UPDATE battles SET status = 'finished', winner_id = ?, ended_at = ?, state_json = ?
        WHERE id = ?
      `).run(winner, new Date().toISOString(), JSON.stringify(battleState), battle.id);

      if (winner && applyBattleResults) {
        const loserId = winner === battle.agent_a_id ? battle.agent_b_id : battle.agent_a_id;
        applyBattleResults(db, winner, loserId, battle.id);
      }

      results.push({ battleId: battle.id, result: 'forfeit_timeout', winnerId: winner, forfeitedBy: forfeiter.name });
      continue;
    }

    // Resolve the turn: if a side was skipped, only the other side attacks
    if (aSkipped && bSkipped) {
      // Both timed out — no attacks but status damage still ticks
      battleState.turnNumber++;
      const turnLog = {
        turnNumber: battleState.turnNumber,
        moveA: null, moveB: null,
        events: [{ type: 'timeout', message: 'Both sides failed to respond — turn skipped' }],
        agentAHP: battleState.agentA.currentHP,
        agentBHP: battleState.agentB.currentHP,
      };
      // Apply end-of-turn status damage (burn, poison, etc.)
      const statusLogA = applyStatusDamage(battleState, 'A');
      const statusLogB = applyStatusDamage(battleState, 'B');
      turnLog.events.push(...statusLogA, ...statusLogB);
      checkBattleEnd(battleState);
      turnLog.agentAHP = battleState.agentA.currentHP;
      turnLog.agentBHP = battleState.agentB.currentHP;
      if (battleState.status === 'finished') {
        turnLog.events.push({ type: 'battle_end', winnerId: battleState.winnerId });
      }
      battleState.turns.push(turnLog);
      saveTurn(db, battle.id, turnLog);
    } else if (aSkipped && moveB) {
      // Only B attacks (A skipped)
      battleState.turnNumber++;
      const turnLog = {
        turnNumber: battleState.turnNumber,
        moveA: null, moveB,
        events: [{ type: 'timeout', message: `${battleState.agentA.name} failed to respond — turn forfeited` }],
        agentAHP: battleState.agentA.currentHP,
        agentBHP: battleState.agentB.currentHP,
      };
      const bResult = applyMove(battleState, 'B', moveB);
      turnLog.events.push(...bResult.log);
      // End-of-turn status damage
      const statusLogA = applyStatusDamage(battleState, 'A');
      const statusLogB = applyStatusDamage(battleState, 'B');
      turnLog.events.push(...statusLogA, ...statusLogB);
      checkBattleEnd(battleState);
      turnLog.agentAHP = battleState.agentA.currentHP;
      turnLog.agentBHP = battleState.agentB.currentHP;
      if (battleState.status === 'finished') {
        turnLog.events.push({ type: 'battle_end', winnerId: battleState.winnerId });
      }
      battleState.turns.push(turnLog);
      saveTurn(db, battle.id, turnLog);
    } else if (bSkipped && moveA) {
      // Only A attacks (B skipped)
      battleState.turnNumber++;
      const turnLog = {
        turnNumber: battleState.turnNumber,
        moveA, moveB: null,
        events: [{ type: 'timeout', message: `${battleState.agentB.name} failed to respond — turn forfeited` }],
        agentAHP: battleState.agentA.currentHP,
        agentBHP: battleState.agentB.currentHP,
      };
      const aResult = applyMove(battleState, 'A', moveA);
      turnLog.events.push(...aResult.log);
      const statusLogA = applyStatusDamage(battleState, 'A');
      const statusLogB = applyStatusDamage(battleState, 'B');
      turnLog.events.push(...statusLogA, ...statusLogB);
      checkBattleEnd(battleState);
      turnLog.agentAHP = battleState.agentA.currentHP;
      turnLog.agentBHP = battleState.agentB.currentHP;
      if (battleState.status === 'finished') {
        turnLog.events.push({ type: 'battle_end', winnerId: battleState.winnerId });
      }
      battleState.turns.push(turnLog);
      saveTurn(db, battle.id, turnLog);
    } else {
      // Edge case: no moves and no skip flags — shouldn't happen, skip
      continue;
    }

    // Update battle state
    db.prepare(`
      UPDATE battles SET
        agent_a_move = NULL,
        agent_b_move = NULL,
        turn_number = ?,
        current_phase = ?,
        status = ?,
        winner_id = ?,
        state_json = ?,
        last_turn_at = ?,
        ended_at = ?
      WHERE id = ?
    `).run(
      battleState.turnNumber,
      battleState.status === 'finished' ? 'finished' : 'waiting',
      battleState.status,
      battleState.winnerId,
      JSON.stringify(battleState),
      new Date().toISOString(),
      battleState.status === 'finished' ? new Date().toISOString() : null,
      battle.id
    );

    // Award XP if battle finished
    if (battleState.status === 'finished' && battleState.winnerId && applyBattleResults) {
      const loserId = battleState.winnerId === battle.agent_a_id ? battle.agent_b_id : battle.agent_a_id;
      applyBattleResults(db, battleState.winnerId, loserId, battle.id);
    }

    results.push({
      battleId: battle.id,
      result: battleState.status === 'finished' ? 'finished' : 'turn_skipped',
      winnerId: battleState.winnerId,
      aSkipped, bSkipped,
    });
  }

  return results;
}

// ============================================================================
// BATTLE RESULTS (XP & ELO)
// ============================================================================

function applyBattleResults(db, winnerId, loserId, battleId) {
  // Award XP using scaled formula (prevents farming)
  try {
    const { awardBattleXP } = require('../xp-calculator');
    const xpResult = awardBattleXP(db, winnerId, loserId, battleId);
    if (xpResult) {
      log.info('XP awarded for battle', { winner: { xp: xpResult.winner.xp_earned, level: xpResult.winner.level_now }, loser: { xp: xpResult.loser.xp_earned, level: xpResult.loser.level_now } });
    }
  } catch (e) {
    log.error('XP award error:', { error: e.message });
  }

  // Update ELO ratings
  try {
    const { calculateEloChange } = require('../../utils/elo');
    const winner = db.prepare('SELECT id, elo, total_wins, total_fights FROM agents WHERE id = ?').get(winnerId);
    const loser = db.prepare('SELECT id, elo, total_wins, total_fights FROM agents WHERE id = ?').get(loserId);
    if (winner && loser) {
      const elo = calculateEloChange(winner, loser);
      db.prepare('UPDATE agents SET elo = ? WHERE id = ?').run(elo.winnerNew, winnerId);
      db.prepare('UPDATE agents SET elo = ? WHERE id = ?').run(elo.loserNew, loserId);
      log.info('ELO updated', { winner: { from: winner.elo, to: elo.winnerNew, delta: elo.winnerDelta }, loser: { from: loser.elo, to: elo.loserNew, delta: elo.loserDelta } });
    }
  } catch (e) {
    log.error('ELO update error:', { error: e.message });
  }

  // Grant social tokens to both participants (for posting on social feed)
  try {
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    const insertToken = db.prepare(`
      INSERT OR IGNORE INTO social_tokens (id, agent_id, battle_id, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    insertToken.run(crypto.randomBytes(12).toString('hex'), winnerId, battleId, tokenExpiry);
    insertToken.run(crypto.randomBytes(12).toString('hex'), loserId, battleId, tokenExpiry);
  } catch (e) {
    log.error('Social token grant error:', { error: e.message });
  }
}

module.exports = {
  addToQueue,
  removeFromQueue,
  matchFromQueue,
  checkTimeouts,
  applyBattleResults,
};
