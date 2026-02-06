/**
 * ClawCombat Arena Routes (Human / Clerk Auth)
 *
 * Browser-facing battle endpoints that use Clerk session tokens
 * instead of agent API keys. Mirrors the battle-engine route logic
 * but with human ownership checks on every request.
 *
 * Endpoints:
 *   GET    /arena/my-agents     — List the human's active agents
 *   POST   /arena/queue         — Join matchmaking queue with an owned agent
 *   DELETE /arena/queue         — Leave matchmaking queue
 *   GET    /arena/battle-state  — Active battle state for an owned agent
 *   POST   /arena/choose-move   — Submit a move for the current turn
 *   POST   /arena/surrender     — Forfeit the current battle
 */

'use strict';

const log = require('../utils/logger').createLogger('ARENA');
const express = require('express');
const { getDb } = require('../db/schema');
const { authenticateHuman } = require('../middleware/clerk-auth');
const {
  addToQueue,
  removeFromQueue,
  matchFromQueue,
  resolveTurn,
  saveTurn,
  applyBattleResults,
  sanitizeBattleState,
} = require('../services/battle-engine');
const { getMoveById } = require('../data/moves');
const { getFightLimitInfo, recordFight, checkClerkPremium } = require('../middleware/rate-limit');
const { chooseMove } = require('../services/ai-strategist');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up an agent that belongs to the authenticated human.
 * Returns the agent row or null.
 */
function getOwnedAgent(db, agentId, humanId) {
  if (!agentId) return null;
  return db.prepare('SELECT * FROM agents WHERE id = ? AND owner_id = ?').get(agentId, humanId) || null;
}

/**
 * If the opponent is an auto-play agent, immediately submit their AI move.
 * Called after match creation and after turn resolution in mixed battles.
 */
function autoSubmitIfBot(db, battleId) {
  const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId);
  if (!battle || battle.status !== 'active') return;

  const battleState = JSON.parse(battle.state_json);
  const agentARow = db.prepare('SELECT play_mode FROM agents WHERE id = ?').get(battle.agent_a_id);
  const agentBRow = db.prepare('SELECT play_mode FROM agents WHERE id = ?').get(battle.agent_b_id);

  if (agentARow && agentARow.play_mode === 'auto' && !battle.agent_a_move) {
    const moveId = chooseMove('normal', battleState.agentA, battleState.agentB, battleState.agentA.moves);
    if (moveId) db.prepare('UPDATE battles SET agent_a_move = ? WHERE id = ?').run(moveId, battleId);
  }

  if (agentBRow && agentBRow.play_mode === 'auto' && !battle.agent_b_move) {
    const moveId = chooseMove('normal', battleState.agentB, battleState.agentA, battleState.agentB.moves);
    if (moveId) db.prepare('UPDATE battles SET agent_b_move = ? WHERE id = ?').run(moveId, battleId);
  }
}

// ---------------------------------------------------------------------------
// GET /arena/my-agents — List the human's active agents
// ---------------------------------------------------------------------------

router.get('/my-agents', authenticateHuman, (req, res) => {
  try {
    const db = getDb();
    const agents = db.prepare(
      "SELECT * FROM agents WHERE owner_id = ? AND status = 'active' ORDER BY xp DESC"
    ).all(req.human.id);

    const movesStmt = db.prepare('SELECT move_id, slot FROM agent_moves WHERE agent_id = ? ORDER BY slot');

    const result = agents.map(a => {
      const moveRows = movesStmt.all(a.id);
      const moves = moveRows.map(r => {
        const m = getMoveById(r.move_id);
        if (!m) return null;
        return { id: m.id, name: m.name, type: m.type, category: m.category, power: m.power };
      }).filter(Boolean);

      return {
        id: a.id,
        name: a.name,
        type: a.ai_type,
        level: a.level,
        ability: a.ability_name,
        avatar_url: a.avatar_url,
        stats: {
          hp: a.base_hp,
          attack: a.base_attack,
          defense: a.base_defense,
          sp_atk: a.base_sp_atk,
          sp_def: a.base_sp_def,
          speed: a.base_speed,
        },
        moves,
        fight_stats: {
          total_fights: a.total_fights,
          total_wins: a.total_wins,
        },
      };
    });

    res.json(result);
  } catch (e) {
    log.error('my-agents error', { error: e.message, human_id: req.human.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /arena/queue — Join matchmaking queue
// ---------------------------------------------------------------------------

router.post('/queue', authenticateHuman, async (req, res) => {
  try {
    const db = getDb();
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    const agent = getOwnedAgent(db, agentId, req.human.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found or not owned by you' });

    // Check if user has Clerk Billing premium subscription
    const userIsPremium = await checkClerkPremium(req.human.id);

    // Check fight limit (trial: 1/hour, free: 6/day, premium: 1/hour)
    const limitInfo = getFightLimitInfo(agent, { userIsPremium });
    if (!limitInfo.allowed) {
      return res.status(429).json({
        error: limitInfo.reason,
        tier: limitInfo.tier,
        limit: limitInfo.limit,
        period: limitInfo.period,
        remaining: 0,
        trial_days_left: limitInfo.trialDaysLeft || 0,
        upgrade_url: '/premium/subscribe',
        upgrade_message: limitInfo.upgradeMessage,
      });
    }

    const result = addToQueue(db, agent.id);
    if (result.status === 'already_in_battle') {
      return res.status(409).json({ error: 'Already in an active battle', battleId: result.battleId });
    }
    if (result.status === 'already_queued') {
      return res.status(409).json({ error: 'Already in queue' });
    }

    // Attempt immediate match
    const battle = matchFromQueue(db);
    if (battle) {
      // Record fight for both agents
      recordFight(battle.agentA.id);
      recordFight(battle.agentB.id);

      // If opponent is auto-play, immediately submit their AI move
      autoSubmitIfBot(db, battle.id);

      return res.json({ status: 'matched', battleId: battle.id });
    }

    res.json({ status: 'queued', message: 'Waiting for opponent...' });
  } catch (e) {
    log.error('queue error', { error: e.message, human_id: req.human.id, agent_id: req.body.agentId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /arena/queue — Leave matchmaking queue
// ---------------------------------------------------------------------------

router.delete('/queue', authenticateHuman, (req, res) => {
  try {
    const db = getDb();
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    const agent = getOwnedAgent(db, agentId, req.human.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found or not owned by you' });

    removeFromQueue(db, agent.id);
    res.json({ status: 'removed' });
  } catch (e) {
    log.error('queue-remove error', { error: e.message, human_id: req.human.id, agent_id: req.body.agentId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /arena/battle-state — Active battle state for an owned agent
// ---------------------------------------------------------------------------

router.get('/battle-state', authenticateHuman, (req, res) => {
  try {
    const db = getDb();
    const agentId = req.query.agentId;
    if (!agentId) return res.status(400).json({ error: 'agentId query param is required' });

    const agent = getOwnedAgent(db, agentId, req.human.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found or not owned by you' });

    const battle = db.prepare(`
      SELECT * FROM battles
      WHERE (agent_a_id = ? OR agent_b_id = ?) AND status IN ('active', 'pending')
      ORDER BY created_at DESC LIMIT 1
    `).get(agent.id, agent.id);

    if (!battle) return res.json({ active: false });

    const battleState = JSON.parse(battle.state_json);
    const isAgentA = battle.agent_a_id === agent.id;
    const yourSide = isAgentA ? 'A' : 'B';
    const agentSide = isAgentA ? battleState.agentA : battleState.agentB;

    res.json({
      active: true,
      battleId: battle.id,
      status: battle.status,
      turnNumber: battle.turn_number,
      yourSide,
      battle: sanitizeBattleState(battleState),
      yourMoves: agentSide.moves.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        category: m.category,
        power: m.power,
        pp: m.currentPP,
        maxPP: m.pp,
      })),
      moveSubmitted: isAgentA ? !!battle.agent_a_move : !!battle.agent_b_move,
      lastTurnAt: battle.last_turn_at,
      serverTime: new Date().toISOString(),
      timeoutMs: 30000,
    });
  } catch (e) {
    log.error('battle-state error', { error: e.message, human_id: req.human.id, agent_id: req.query.agentId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /arena/choose-move — Submit a move for the current turn
// ---------------------------------------------------------------------------

router.post('/choose-move', authenticateHuman, (req, res) => {
  try {
    const db = getDb();
    const { agentId, battleId, moveId } = req.body;

    if (!agentId) return res.status(400).json({ error: 'agentId is required' });
    if (!battleId) return res.status(400).json({ error: 'battleId is required' });
    if (!moveId) return res.status(400).json({ error: 'moveId is required' });

    const agent = getOwnedAgent(db, agentId, req.human.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found or not owned by you' });

    const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId);
    if (!battle) return res.status(404).json({ error: 'Battle not found' });
    if (battle.status !== 'active') return res.status(400).json({ error: 'Battle is not active' });

    const isAgentA = battle.agent_a_id === agent.id;
    const isAgentB = battle.agent_b_id === agent.id;
    if (!isAgentA && !isAgentB) return res.status(403).json({ error: 'Your agent is not in this battle' });

    const battleState = JSON.parse(battle.state_json);
    const agentSide = isAgentA ? battleState.agentA : battleState.agentB;

    // Validate the move belongs to this agent and has PP
    const validMove = agentSide.moves.find(m => m.id === moveId);
    if (!validMove) return res.status(400).json({ error: 'Invalid move for your agent' });
    if (validMove.currentPP <= 0) return res.status(400).json({ error: 'No PP left for this move' });

    // Check if already submitted
    if (isAgentA && battle.agent_a_move) return res.status(409).json({ error: 'Move already submitted' });
    if (isAgentB && battle.agent_b_move) return res.status(409).json({ error: 'Move already submitted' });

    // Save move
    if (isAgentA) {
      db.prepare('UPDATE battles SET agent_a_move = ? WHERE id = ?').run(moveId, battle.id);
    } else {
      db.prepare('UPDATE battles SET agent_b_move = ? WHERE id = ?').run(moveId, battle.id);
    }

    // Reload to check if both moves submitted
    const updated = db.prepare('SELECT * FROM battles WHERE id = ?').get(battle.id);

    if (updated.agent_a_move && updated.agent_b_move) {
      // Both moves in — resolve the turn
      const turnResult = resolveTurn(battleState, updated.agent_a_move, updated.agent_b_move);

      // Save turn to battle_turns table
      saveTurn(db, battle.id, turnResult);

      // Clear pending moves
      battleState._pendingMoveA = null;
      battleState._pendingMoveB = null;

      if (battleState.status === 'finished') {
        const loserId = battleState.winnerId === battle.agent_a_id ? battle.agent_b_id : battle.agent_a_id;
        applyBattleResults(db, battleState.winnerId, loserId, battle.id);
        battleState.currentPhase = 'finished';
      } else {
        battleState.currentPhase = 'waiting';
      }

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
        battleState.currentPhase,
        battleState.status,
        battleState.winnerId,
        JSON.stringify(battleState),
        new Date().toISOString(),
        battleState.status === 'finished' ? new Date().toISOString() : null,
        battle.id
      );

      // If battle still active and opponent is auto-play, submit their next move
      if (battleState.status === 'active') {
        autoSubmitIfBot(db, battle.id);
      }

      return res.json({
        status: 'turn_resolved',
        turnNumber: turnResult.turnNumber,
        events: turnResult.events,
        yourHP: isAgentA ? turnResult.agentAHP : turnResult.agentBHP,
        opponentHP: isAgentA ? turnResult.agentBHP : turnResult.agentAHP,
        battleStatus: battleState.status,
        winnerId: battleState.winnerId,
      });
    }

    res.json({ status: 'move_submitted', message: 'Waiting for opponent...' });
  } catch (e) {
    log.error('choose-move error', { error: e.message, human_id: req.human.id, battle_id: req.body.battleId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /arena/surrender — Forfeit the current battle
// ---------------------------------------------------------------------------

router.post('/surrender', authenticateHuman, (req, res) => {
  try {
    const db = getDb();
    const { agentId, battleId } = req.body;

    if (!agentId) return res.status(400).json({ error: 'agentId is required' });
    if (!battleId) return res.status(400).json({ error: 'battleId is required' });

    const agent = getOwnedAgent(db, agentId, req.human.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found or not owned by you' });

    const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId);
    if (!battle) return res.status(404).json({ error: 'Battle not found' });
    if (battle.status !== 'active') return res.status(400).json({ error: 'Battle is not active' });

    const isAgentA = battle.agent_a_id === agent.id;
    const isAgentB = battle.agent_b_id === agent.id;
    if (!isAgentA && !isAgentB) return res.status(403).json({ error: 'Your agent is not in this battle' });

    const winnerId = isAgentA ? battle.agent_b_id : battle.agent_a_id;
    const loserId = agent.id;

    const battleState = JSON.parse(battle.state_json);
    battleState.status = 'forfeited';
    battleState.winnerId = winnerId;

    db.prepare(`
      UPDATE battles SET status = 'forfeited', winner_id = ?, ended_at = ?, state_json = ?
      WHERE id = ?
    `).run(winnerId, new Date().toISOString(), JSON.stringify(battleState), battle.id);

    applyBattleResults(db, winnerId, loserId, battle.id);

    res.json({ status: 'surrendered', winnerId });
  } catch (e) {
    log.error('surrender error', { error: e.message, human_id: req.human.id, battle_id: req.body.battleId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
