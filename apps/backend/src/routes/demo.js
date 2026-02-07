const log = require('../utils/logger').createLogger('DEMO');
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { initializeBattleState, resolveTurn, TYPE_CHART } = require('../services/battle-engine');
const { chooseMove } = require('../services/ai-strategist');
const { randomMovesForType } = require('../data/moves');
const { VALID_TYPES } = require('../utils/type-system');
const { getRandomBattleName } = require('../data/battle-names');

// ============================================================================
// IN-MEMORY DEMO SESSION STORE
// ============================================================================

const demoSessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TURNS = 100;
const MAX_DEMO_SESSIONS = 10000;

// Cleanup expired sessions every 2 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of demoSessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      demoSessions.delete(id);
    }
  }
}, 2 * 60 * 1000);

// Allow graceful shutdown to clear the interval
if (cleanupInterval.unref) cleanupInterval.unref();

// ============================================================================
// RANDOM NAME (uses 600-name pool from battle-names.js)
// ============================================================================

function randomName() {
  return getRandomBattleName();
}

// ============================================================================
// RANDOM STATS GENERATOR (Demo-optimized for longer battles)
// ============================================================================

function randomStats() {
  // Demo stats are optimized for 4-8 turn battles (good viewer experience)
  // Higher HP, lower attack = more back-and-forth, not one-shot kills
  const stats = {
    base_hp: 22 + Math.floor(Math.random() * 6),     // 22-27 (high HP for survivability)
    attack: 10 + Math.floor(Math.random() * 6),      // 10-15 (moderate attack)
    defense: 14 + Math.floor(Math.random() * 5),     // 14-18 (decent defense)
    sp_atk: 10 + Math.floor(Math.random() * 6),      // 10-15 (moderate sp_atk)
    sp_def: 14 + Math.floor(Math.random() * 5),      // 14-18 (decent sp_def)
    speed: 12 + Math.floor(Math.random() * 6),       // 12-17 (varied speed for turn order)
  };
  return stats;
}

// Original random stats for non-demo use (if needed)
function randomStatsBalanced() {
  // 6 stats summing to 100, each between 8 and 25
  const statKeys = ['base_hp', 'attack', 'defense', 'sp_atk', 'sp_def', 'speed'];
  const min = 8;
  const max = 25;
  const total = 100;
  const count = statKeys.length;

  // Start with minimums, distribute remainder randomly
  const stats = {};
  let remaining = total - (min * count);
  const values = new Array(count).fill(min);

  for (let i = 0; i < count - 1; i++) {
    const maxAdd = Math.min(max - values[i], remaining);
    const add = Math.floor(Math.random() * (maxAdd + 1));
    values[i] += add;
    remaining -= add;
  }
  // Give remainder to last stat, clamped
  values[count - 1] = Math.min(max, values[count - 1] + remaining);
  remaining = total - values.reduce((s, v) => s + v, 0);

  // If we still have leftover (due to clamping), redistribute
  while (remaining > 0) {
    for (let i = 0; i < count && remaining > 0; i++) {
      if (values[i] < max) {
        values[i]++;
        remaining--;
      }
    }
  }

  // Shuffle to avoid bias toward last stat
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }

  statKeys.forEach((key, i) => { stats[key] = values[i]; });
  return stats;
}

// ============================================================================
// BUILD DEMO AGENT
// ============================================================================

function buildDemoAgent(opts = {}) {
  let type;
  if (opts.type && VALID_TYPES.includes(opts.type)) {
    type = opts.type;
  } else {
    const pool = opts.excludeType ? VALID_TYPES.filter(t => t !== opts.excludeType) : VALID_TYPES;
    type = pool[Math.floor(Math.random() * pool.length)];
  }
  const name = opts.name || randomName();
  const moveIds = (opts.moves && opts.moves.length === 4) ? opts.moves : randomMovesForType(type);
  const stats = randomStats();

  return {
    id: `demo_${crypto.randomUUID()}`,
    name,
    type,
    moves: moveIds,
    ...stats,
    ability: null,
    avatar_url: null,
  };
}

// ============================================================================
// SANITIZE STATE FOR CLIENT
// ============================================================================

function sanitizeForClient(battleState, playerSide) {
  const player = battleState[playerSide === 'A' ? 'agentA' : 'agentB'];
  const opponent = battleState[playerSide === 'A' ? 'agentB' : 'agentA'];

  return {
    turnNumber: battleState.turnNumber,
    status: battleState.status,
    winnerId: battleState.winnerId,
    player: {
      id: player.id,
      name: player.name,
      type: player.type,
      currentHP: player.currentHP,
      maxHP: player.maxHP,
      status: player.status,
      moves: player.moves.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        power: m.power,
        accuracy: m.accuracy,
        pp: m.pp,
        currentPP: m.currentPP,
        effect: m.effect || null,
        effectChance: m.effectChance || null,
      })),
    },
    opponent: {
      id: opponent.id,
      name: opponent.name,
      type: opponent.type,
      currentHP: opponent.currentHP,
      maxHP: opponent.maxHP,
      status: opponent.status,
    },
  };
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /demo/start
 * Start a new demo battle. Optionally accepts {type, name, moves} for the player.
 * Returns both agents + player's available moves.
 */
router.post('/start', (req, res) => {
  try {
    // Enforce session cap to prevent memory exhaustion
    if (demoSessions.size >= MAX_DEMO_SESSIONS) {
      return res.status(503).json({ error: 'Too many active demo sessions. Please try again later.' });
    }

    const { type, name, moves } = req.body || {};

    const playerAgent = buildDemoAgent({ type, name, moves });
    // Ensure opponent has a different type
    const opponentAgent = buildDemoAgent({ excludeType: playerAgent.type });

    const battleState = initializeBattleState(playerAgent, opponentAgent);

    const demoId = crypto.randomUUID();
    demoSessions.set(demoId, {
      battleState,
      playerSide: 'A',
      playerAgent,
      opponentAgent,
      createdAt: Date.now(),
    });

    res.json({
      demoId,
      ...sanitizeForClient(battleState, 'A'),
    });
  } catch (err) {
    log.error('start error:', { error: err.message });
    res.status(500).json({ error: 'Failed to start demo battle' });
  }
});

/**
 * POST /demo/move
 * Submit a move. Accepts {demoId, moveId} or {demoId, auto: true} for AI pick.
 * Resolves the turn (opponent always AI-controlled) and returns events + updated state.
 */
router.post('/move', (req, res) => {
  try {
    const { demoId, moveId, auto } = req.body || {};

    if (!demoId) return res.status(400).json({ error: 'demoId required' });

    const session = demoSessions.get(demoId);
    if (!session) return res.status(404).json({ error: 'Demo session not found or expired' });

    const { battleState } = session;

    if (battleState.status === 'finished') {
      return res.json({
        ...sanitizeForClient(battleState, 'A'),
        events: [],
        message: 'Battle already finished',
      });
    }

    if (battleState.turnNumber >= MAX_TURNS) {
      battleState.status = 'finished';
      // Higher HP ratio wins
      const ratioA = battleState.agentA.currentHP / battleState.agentA.maxHP;
      const ratioB = battleState.agentB.currentHP / battleState.agentB.maxHP;
      battleState.winnerId = ratioA >= ratioB ? battleState.agentA.id : battleState.agentB.id;
      return res.json({
        ...sanitizeForClient(battleState, 'A'),
        events: [{ type: 'battle_end', message: 'Battle reached turn limit', winnerId: battleState.winnerId }],
      });
    }

    // Player move selection
    let playerMoveId;
    if (auto) {
      playerMoveId = chooseMove('hard', battleState.agentA, battleState.agentB, battleState.agentA.moves, TYPE_CHART);
    } else {
      if (!moveId) return res.status(400).json({ error: 'moveId or auto required' });
      const validMove = battleState.agentA.moves.find(m => m.id === moveId);
      if (!validMove) return res.status(400).json({ error: 'Invalid move' });
      if (validMove.currentPP != null && validMove.currentPP <= 0) {
        return res.status(400).json({ error: 'Move has no PP remaining' });
      }
      playerMoveId = moveId;
    }

    // Opponent AI move
    const opponentMoveId = chooseMove('normal', battleState.agentB, battleState.agentA, battleState.agentB.moves, TYPE_CHART);

    // Resolve turn
    const turnLog = resolveTurn(battleState, playerMoveId, opponentMoveId);

    res.json({
      ...sanitizeForClient(battleState, 'A'),
      turn: {
        number: turnLog.turnNumber,
        playerMove: playerMoveId,
        opponentMove: opponentMoveId,
        events: turnLog.events,
        playerHP: turnLog.agentAHP,
        opponentHP: turnLog.agentBHP,
      },
    });
  } catch (err) {
    log.error('move error:', { error: err.message });
    res.status(500).json({ error: 'Failed to process move' });
  }
});

/**
 * POST /demo/auto-finish
 * AI plays both sides to completion. Returns all remaining turns.
 */
router.post('/auto-finish', (req, res) => {
  try {
    const { demoId } = req.body || {};

    if (!demoId) return res.status(400).json({ error: 'demoId required' });

    const session = demoSessions.get(demoId);
    if (!session) return res.status(404).json({ error: 'Demo session not found or expired' });

    const { battleState } = session;

    if (battleState.status === 'finished') {
      return res.json({
        ...sanitizeForClient(battleState, 'A'),
        turns: [],
        message: 'Battle already finished',
      });
    }

    const turns = [];

    while (battleState.status !== 'finished' && battleState.turnNumber < MAX_TURNS) {
      const playerMoveId = chooseMove('hard', battleState.agentA, battleState.agentB, battleState.agentA.moves, TYPE_CHART);
      const opponentMoveId = chooseMove('normal', battleState.agentB, battleState.agentA, battleState.agentB.moves, TYPE_CHART);

      const turnLog = resolveTurn(battleState, playerMoveId, opponentMoveId);
      turns.push({
        number: turnLog.turnNumber,
        playerMove: playerMoveId,
        opponentMove: opponentMoveId,
        events: turnLog.events,
        playerHP: turnLog.agentAHP,
        opponentHP: turnLog.agentBHP,
      });
    }

    // Handle turn limit
    if (battleState.status !== 'finished' && battleState.turnNumber >= MAX_TURNS) {
      battleState.status = 'finished';
      const ratioA = battleState.agentA.currentHP / battleState.agentA.maxHP;
      const ratioB = battleState.agentB.currentHP / battleState.agentB.maxHP;
      battleState.winnerId = ratioA >= ratioB ? battleState.agentA.id : battleState.agentB.id;
      turns.push({
        number: battleState.turnNumber,
        events: [{ type: 'battle_end', message: 'Battle reached turn limit', winnerId: battleState.winnerId }],
      });
    }

    res.json({
      ...sanitizeForClient(battleState, 'A'),
      turns,
    });
  } catch (err) {
    log.error('auto-finish error:', { error: err.message });
    res.status(500).json({ error: 'Failed to auto-finish battle' });
  }
});

/**
 * GET /demo/random-name
 * Generate a random lobster name (shared with frontend).
 */
router.get('/random-name', (req, res) => {
  res.json({ name: randomName() });
});

module.exports = router;
