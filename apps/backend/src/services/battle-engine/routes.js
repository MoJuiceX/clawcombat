/**
 * Battle Engine Routes
 * Express route handlers for battle API
 */

'use strict';

const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const express = require('express');
const log = require('../../utils/logger').createLogger('BATTLE_ENGINE');

const { TYPE_CHART, mapDbAgent } = require('./constants');
const { initializeBattleState } = require('./core');
const { applyAbilityEffects } = require('./effects');
const { resolveTurn } = require('./turnresolver');
const { saveTurn, getBattleHistory } = require('./database');
const { addToQueue, removeFromQueue, matchFromQueue, applyBattleResults } = require('./matchmaking');
const { sendWebhook, buildStartPayload, buildTurnPayload } = require('./webhook');

// ============================================================================
// UTILITIES
// ============================================================================

function sanitizeAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    level: agent.level || 1,
    avatar_url: agent.avatar_url || null,
    currentHP: agent.currentHP,
    maxHP: agent.maxHP,
    status: agent.status,
    statStages: { ...agent.statStages },
    ability: agent.ability,
    moves: agent.moves.map(m => ({ id: m.id, name: m.name, type: m.type, category: m.category, power: m.power, pp: m.currentPP, maxPP: m.pp })),
  };
}

function sanitizeBattleState(battleState) {
  return {
    id: battleState.id,
    agentA: sanitizeAgent(battleState.agentA),
    agentB: sanitizeAgent(battleState.agentB),
    turnNumber: battleState.turnNumber,
    status: battleState.status,
    winnerId: battleState.winnerId,
  };
}

// ============================================================================
// BATTLE CONTEXT HELPERS
// ============================================================================

/**
 * Get opponent history - how many times fought and win/loss record
 */
function getOpponentHistory(db, agentId, opponentId) {
  const battles = db.prepare(`
    SELECT winner_id FROM battles
    WHERE ((agent_a_id = ? AND agent_b_id = ?) OR (agent_a_id = ? AND agent_b_id = ?))
      AND status IN ('finished', 'forfeited')
    ORDER BY created_at DESC
  `).all(agentId, opponentId, opponentId, agentId);

  const wins = battles.filter(b => b.winner_id === agentId).length;
  const losses = battles.length - wins;

  return {
    times_fought_before: battles.length,
    your_record_vs_them: `${wins}-${losses}`
  };
}

/**
 * Check if this win is a revenge (you lost to them in the previous encounter)
 */
function isRevenge(db, agentId, opponentId, currentWinnerId) {
  if (currentWinnerId !== agentId) return false;

  // Get the PREVIOUS battle (not including current one)
  const lastBattle = db.prepare(`
    SELECT winner_id FROM battles
    WHERE ((agent_a_id = ? AND agent_b_id = ?) OR (agent_a_id = ? AND agent_b_id = ?))
      AND status IN ('finished', 'forfeited')
    ORDER BY created_at DESC
    LIMIT 1 OFFSET 1
  `).get(agentId, opponentId, opponentId, agentId);

  return lastBattle && lastBattle.winner_id === opponentId;
}

/**
 * Get agent's current rank (by XP)
 */
function getAgentRank(db, agentId) {
  const result = db.prepare(`
    SELECT COUNT(*) + 1 as rank FROM agents
    WHERE status = 'active' AND xp > (SELECT COALESCE(xp, 0) FROM agents WHERE id = ?)
  `).get(agentId);
  return result ? result.rank : 999;
}

/**
 * Get feed snapshot for battle response - trending topics and mentions
 */
function getFeedSnapshot(db, agentId, agentName) {
  try {
    // Get recent posts for trending analysis (last 24 hours)
    const recentPosts = db.prepare(`
      SELECT content FROM social_posts
      WHERE created_at > datetime('now', '-24 hours')
      ORDER BY likes_count DESC
      LIMIT 50
    `).all();

    // Simple trending extraction - find common words/phrases
    const wordCounts = {};
    const stopWords = new Set(['the', 'a', 'an', 'is', 'was', 'are', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'their', 'it', 'its', 'this', 'that', 'these', 'those']);

    for (const post of recentPosts) {
      const words = post.content.toLowerCase().replace(/[^a-z0-9\s@#]/g, '').split(/\s+/);
      for (const word of words) {
        if (word.length > 2 && !stopWords.has(word)) {
          wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
      }
    }

    const trending = Object.entries(wordCounts)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    // Get mentions of this agent
    const mentions = db.prepare(`
      SELECT id, content, agent_id FROM social_posts
      WHERE content LIKE ? AND agent_id != ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(`%@${agentName}%`, agentId);

    // Get agent names for mentions
    const mentionsWithNames = mentions.map(m => {
      const author = db.prepare('SELECT name FROM agents WHERE id = ?').get(m.agent_id);
      return {
        id: m.id,
        preview: m.content.substring(0, 100),
        by: author ? author.name : 'Unknown'
      };
    });

    return {
      trending,
      mentions_of_you: mentionsWithNames
    };
  } catch (e) {
    return { trending: [], mentions_of_you: [] };
  }
}

/**
 * Build enriched battle context for API responses
 */
function buildBattleContext(db, battle, requestingAgentId) {
  const isAgentA = battle.agent_a_id === requestingAgentId;
  const myId = requestingAgentId;
  const opponentId = isAgentA ? battle.agent_b_id : battle.agent_a_id;

  // Get agent data
  const myAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(myId);
  const opponentAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(opponentId);

  if (!myAgent || !opponentAgent) return null;

  const myRank = getAgentRank(db, myId);
  const opponentRank = getAgentRank(db, opponentId);

  // Opponent history
  const history = getOpponentHistory(db, myId, opponentId);

  // Context flags
  const won = battle.winner_id === myId;
  const revenge = isRevenge(db, myId, opponentId, battle.winner_id);
  const upset = battle.winner_id && (
    (battle.winner_id === myId && myRank > opponentRank) ||
    (battle.winner_id === opponentId && opponentRank > myRank)
  );

  // Battle details
  const battleState = JSON.parse(battle.state_json || '{}');
  const myHP = isAgentA ? battleState.agentA?.currentHP : battleState.agentB?.currentHP;
  const myMaxHP = isAgentA ? battleState.agentA?.maxHP : battleState.agentB?.maxHP;
  const opponentHP = isAgentA ? battleState.agentB?.currentHP : battleState.agentA?.currentHP;
  const opponentMaxHP = isAgentA ? battleState.agentB?.maxHP : battleState.agentA?.maxHP;

  const closeMatch = myMaxHP && opponentMaxHP ?
    Math.abs((myHP / myMaxHP) - (opponentHP / opponentMaxHP)) < 0.25 : false;

  // Feed snapshot
  const feedSnapshot = getFeedSnapshot(db, myId, myAgent.name);

  return {
    battle: {
      outcome: won ? 'win' : (battle.winner_id ? 'loss' : 'ongoing'),
      turns: battle.turn_number || 0,
      close_match: closeMatch,
      your_final_hp_percent: myMaxHP ? Math.round((myHP / myMaxHP) * 100) : null
    },
    opponent: {
      id: opponentId,
      name: opponentAgent.name,
      type: opponentAgent.ai_type,
      rank: opponentRank,
      level: opponentAgent.level || 1,
      times_fought_before: history.times_fought_before,
      your_record_vs_them: history.your_record_vs_them
    },
    your_stats: {
      new_rank: myRank,
      rank_change: null, // Would need to track pre-battle rank
      win_streak: myAgent.win_streak || 0,
      level: myAgent.level || 1
    },
    context: {
      upset: upset,
      revenge: revenge
    },
    feed_snapshot: feedSnapshot
  };
}

// ============================================================================
// EXPRESS ROUTES
// ============================================================================

function createBattleRoutes(db, authenticateAgent) {
  const router = express.Router();

  // POST /queue — Join matchmaking queue
  router.post('/queue', authenticateAgent, (req, res) => {
    try {
      // Check fight limit (trial: 1/hour, free: 6/day, premium: 1/hour)
      const { getFightLimitInfo, recordFight } = require('../../middleware/rate-limit');
      const limitInfo = getFightLimitInfo(req.agent);
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

      const result = addToQueue(db, req.agent.id);
      if (result.status === 'already_in_battle') {
        return res.status(409).json({ error: 'Already in an active battle', battleId: result.battleId });
      }
      if (result.status === 'already_queued') {
        return res.status(409).json({ error: 'Already in queue' });
      }

      // Attempt to match immediately
      const battle = matchFromQueue(db);
      if (battle) {
        // Notify both agents
        const agentAData = db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agentA.id);
        const agentBData = db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agentB.id);

        sendWebhook(agentAData, 'battle_start', { battleId: battle.id, ...buildStartPayload(battle, 'A') });
        sendWebhook(agentBData, 'battle_start', { battleId: battle.id, ...buildStartPayload(battle, 'B') });

        // Record fight for both agents
        recordFight(battle.agentA.id);
        recordFight(battle.agentB.id);

        return res.json({ status: 'matched', battleId: battle.id });
      }

      res.json({ status: 'queued', message: 'Waiting for opponent...' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /queue — Leave matchmaking queue
  router.delete('/queue', authenticateAgent, (req, res) => {
    try {
      removeFromQueue(db, req.agent.id);
      res.json({ status: 'removed' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /challenge — Challenge a specific agent
  router.post('/challenge', authenticateAgent, (req, res) => {
    try {
      const { targetAgentId } = req.body;
      if (!targetAgentId) return res.status(400).json({ error: 'targetAgentId required' });
      if (targetAgentId === req.agent.id) return res.status(400).json({ error: 'Cannot challenge yourself' });

      const target = db.prepare('SELECT * FROM agents WHERE id = ?').get(targetAgentId);
      if (!target) return res.status(404).json({ error: 'Target agent not found' });

      // Check active battles
      const activeBattle = db.prepare(`
        SELECT * FROM battles WHERE (agent_a_id = ? OR agent_b_id = ?) AND status IN ('active', 'pending')
      `).get(req.agent.id, req.agent.id);
      if (activeBattle) return res.status(409).json({ error: 'Already in an active battle' });

      // Create pending challenge
      const battleId = uuidv4();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO battles (id, agent_a_id, agent_b_id, status, current_phase, created_at)
        VALUES (?, ?, ?, 'pending', 'challenge', ?)
      `).run(battleId, req.agent.id, targetAgentId, now);

      // Send webhook to target
      sendWebhook(target, 'battle_challenge', {
        battleId,
        challenger: { id: req.agent.id, name: req.agent.name, type: req.agent.type },
      });

      res.json({ status: 'challenge_sent', battleId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /:id/accept — Accept a challenge
  router.post('/:id/accept', authenticateAgent, (req, res) => {
    try {
      const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(req.params.id);
      if (!battle) return res.status(404).json({ error: 'Battle not found' });
      if (battle.status !== 'pending') return res.status(400).json({ error: 'Battle not in pending state' });
      if (battle.agent_b_id !== req.agent.id) return res.status(403).json({ error: 'You are not the challenged agent' });

      // Load both agents
      const agentA = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agent_a_id));
      const agentB = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agent_b_id));

      if (agentA.moves && typeof agentA.moves === 'string') {
        try { agentA.moves = JSON.parse(agentA.moves); } catch(e) { agentA.moves = []; }
      }
      if (agentB.moves && typeof agentB.moves === 'string') {
        try { agentB.moves = JSON.parse(agentB.moves); } catch(e) { agentB.moves = []; }
      }

      const battleState = initializeBattleState(agentA, agentB, applyAbilityEffects);
      battleState.id = battle.id; // Keep the existing battle ID

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE battles SET status = 'active', current_phase = 'waiting', state_json = ?, started_at = ?, last_turn_at = ?, turn_number = 0
        WHERE id = ?
      `).run(JSON.stringify(battleState), now, now, battle.id);

      // Notify both agents
      sendWebhook(agentA, 'battle_start', { battleId: battleState.id, ...buildStartPayload(battleState, 'A') });
      sendWebhook(agentB, 'battle_start', { battleId: battleState.id, ...buildStartPayload(battleState, 'B') });

      res.json({ status: 'battle_started', battleId: battleState.id, battleState: sanitizeBattleState(battleState) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /:id/choose-move — Submit a move for the current turn
  router.post('/:id/choose-move', authenticateAgent, (req, res) => {
    try {
      const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(req.params.id);
      if (!battle) return res.status(404).json({ error: 'Battle not found' });
      if (battle.status !== 'active') return res.status(400).json({ error: 'Battle is not active' });

      const { moveId } = req.body;
      if (!moveId) return res.status(400).json({ error: 'moveId required' });

      const battleState = JSON.parse(battle.state_json);
      const isAgentA = battle.agent_a_id === req.agent.id;
      const isAgentB = battle.agent_b_id === req.agent.id;

      if (!isAgentA && !isAgentB) return res.status(403).json({ error: 'You are not in this battle' });

      // Validate the move belongs to this agent
      const agentSide = isAgentA ? battleState.agentA : battleState.agentB;
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

        // Save turn
        saveTurn(db, battle.id, turnResult);

        // Clear pending moves, update state
        battleState._pendingMoveA = null;
        battleState._pendingMoveB = null;

        if (battleState.status === 'finished') {
          // Award XP
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

        // Webhooks — send turn results to both agents
        const agentAData = db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agent_a_id);
        const agentBData = db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agent_b_id);

        const eventName = battleState.status === 'finished' ? 'battle_end' : 'battle_turn';
        sendWebhook(agentAData, eventName, { battleId: battle.id, ...buildTurnPayload(battleState, turnResult, 'A') });
        sendWebhook(agentBData, eventName, { battleId: battle.id, ...buildTurnPayload(battleState, turnResult, 'B') });

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
      res.status(500).json({ error: e.message });
    }
  });

  // POST /:id/surrender — Forfeit the battle
  router.post('/:id/surrender', authenticateAgent, (req, res) => {
    try {
      const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(req.params.id);
      if (!battle) return res.status(404).json({ error: 'Battle not found' });
      if (battle.status !== 'active') return res.status(400).json({ error: 'Battle is not active' });

      const isAgentA = battle.agent_a_id === req.agent.id;
      const isAgentB = battle.agent_b_id === req.agent.id;
      if (!isAgentA && !isAgentB) return res.status(403).json({ error: 'You are not in this battle' });

      const winnerId = isAgentA ? battle.agent_b_id : battle.agent_a_id;
      const loserId = req.agent.id;

      const battleState = JSON.parse(battle.state_json);
      battleState.status = 'forfeited';
      battleState.winnerId = winnerId;

      db.prepare(`
        UPDATE battles SET status = 'forfeited', winner_id = ?, ended_at = ?, state_json = ?
        WHERE id = ?
      `).run(winnerId, new Date().toISOString(), JSON.stringify(battleState), battle.id);

      applyBattleResults(db, winnerId, loserId, battle.id);

      // Notify opponent
      const opponent = db.prepare('SELECT * FROM agents WHERE id = ?').get(winnerId);
      sendWebhook(opponent, 'battle_end', {
        battleId: battle.id,
        result: 'opponent_surrendered',
        winnerId,
      });

      res.json({ status: 'surrendered', winnerId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /active — Agent's active battle
  router.get('/active', authenticateAgent, (req, res) => {
    try {
      const battle = db.prepare(`
        SELECT * FROM battles
        WHERE (agent_a_id = ? OR agent_b_id = ?) AND status IN ('active', 'pending')
        ORDER BY created_at DESC LIMIT 1
      `).get(req.agent.id, req.agent.id);

      if (!battle) return res.json({ active: false });

      const battleState = JSON.parse(battle.state_json);
      const isAgentA = battle.agent_a_id === req.agent.id;

      res.json({
        active: true,
        battleId: battle.id,
        status: battle.status,
        turnNumber: battle.turn_number,
        yourSide: isAgentA ? 'A' : 'B',
        yourHP: isAgentA ? battleState.agentA.currentHP : battleState.agentB.currentHP,
        yourMaxHP: isAgentA ? battleState.agentA.maxHP : battleState.agentB.maxHP,
        opponentHP: isAgentA ? battleState.agentB.currentHP : battleState.agentA.currentHP,
        opponentMaxHP: isAgentA ? battleState.agentB.maxHP : battleState.agentA.maxHP,
        yourMoves: (isAgentA ? battleState.agentA : battleState.agentB).moves.map(m => ({
          id: m.id, name: m.name, type: m.type, power: m.power, pp: m.currentPP, maxPP: m.pp
        })),
        moveSubmitted: isAgentA ? !!battle.agent_a_move : !!battle.agent_b_move,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /recent — Recent completed battles
  router.get('/recent', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const battles = db.prepare(`
        SELECT b.*, a1.name as agent_a_name, a1.ai_type as agent_a_type,
               COALESCE(a1.level, 1) as agent_a_level,
               (SELECT COUNT(*) + 1 FROM agents WHERE status = 'active' AND xp > COALESCE(a1.xp, 0)) as agent_a_rank,
               a2.name as agent_b_name, a2.ai_type as agent_b_type,
               COALESCE(a2.level, 1) as agent_b_level,
               (SELECT COUNT(*) + 1 FROM agents WHERE status = 'active' AND xp > COALESCE(a2.xp, 0)) as agent_b_rank
        FROM battles b
        LEFT JOIN agents a1 ON b.agent_a_id = a1.id
        LEFT JOIN agents a2 ON b.agent_b_id = a2.id
        WHERE b.status IN ('finished', 'forfeited', 'timeout')
        ORDER BY b.ended_at DESC
        LIMIT ?
      `).all(limit);

      res.json(battles.map(b => ({
        id: b.id,
        battleNumber: b.battle_number,
        agentA: { id: b.agent_a_id, name: b.agent_a_name, type: b.agent_a_type, level: b.agent_a_level, rank: b.agent_a_rank },
        agentB: { id: b.agent_b_id, name: b.agent_b_name, type: b.agent_b_type, level: b.agent_b_level, rank: b.agent_b_rank },
        status: b.status,
        winnerId: b.winner_id,
        turnNumber: b.turn_number,
        endedAt: b.ended_at,
      })));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /agent/:agentId — Public battle history for a specific agent
  router.get('/agent/:agentId', (req, res) => {
    try {
      const agentId = req.params.agentId;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = parseInt(req.query.offset) || 0;

      const battles = db.prepare(`
        SELECT b.*, a1.name as agent_a_name, a1.ai_type as agent_a_type,
               a2.name as agent_b_name, a2.ai_type as agent_b_type
        FROM battles b
        LEFT JOIN agents a1 ON b.agent_a_id = a1.id
        LEFT JOIN agents a2 ON b.agent_b_id = a2.id
        WHERE (b.agent_a_id = ? OR b.agent_b_id = ?)
          AND b.status IN ('finished', 'forfeited', 'timeout')
        ORDER BY b.ended_at DESC
        LIMIT ? OFFSET ?
      `).all(agentId, agentId, limit, offset);

      const total = db.prepare(`
        SELECT COUNT(*) as count FROM battles
        WHERE (agent_a_id = ? OR agent_b_id = ?)
          AND status IN ('finished', 'forfeited', 'timeout')
      `).get(agentId, agentId).count;

      res.json({
        battles: battles.map(b => {
          const isAgentA = b.agent_a_id === agentId;
          const won = b.winner_id === agentId;
          return {
            id: b.id,
            battleNumber: b.battle_number,
            opponent: {
              id: isAgentA ? b.agent_b_id : b.agent_a_id,
              name: isAgentA ? b.agent_b_name : b.agent_a_name,
              type: isAgentA ? b.agent_b_type : b.agent_a_type,
            },
            result: won ? 'win' : 'loss',
            turns: b.turn_number,
            endedAt: b.ended_at,
          };
        }),
        total,
        limit,
        offset,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /first-fight — Trigger an instant first fight for a newly created agent
  router.post('/first-fight', (req, res) => {
    try {
      const { agent_id } = req.body;
      if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

      const { triggerFirstFight } = require('../automation');
      const result = triggerFirstFight(db, agent_id);
      res.json(result);
    } catch (e) {
      log.error('First fight error:', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // GET /:id — Get battle state (public, enriched if authenticated)
  router.get('/:id', (req, res) => {
    try {
      const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(req.params.id);
      if (!battle) return res.status(404).json({ error: 'Battle not found' });

      const battleState = JSON.parse(battle.state_json);

      // Look up XP awarded for this battle
      let xpResults = null;
      try {
        const xpLogs = db.prepare("SELECT agent_id, action, xp_earned FROM xp_logs WHERE reason LIKE ?").all(`Battle ${battle.id}%`);
        if (xpLogs.length > 0) {
          xpResults = {};
          for (const xpLog of xpLogs) {
            xpResults[xpLog.agent_id] = { xp_earned: xpLog.xp_earned, action: xpLog.action };
          }
        }
      } catch (e) { /* xp_logs may not exist */ }

      // Build base response
      const response = {
        id: battle.id,
        battleNumber: battle.battle_number,
        agentA: sanitizeAgent(battleState.agentA),
        agentB: sanitizeAgent(battleState.agentB),
        turnNumber: battle.turn_number,
        status: battle.status,
        winnerId: battle.winner_id,
        xpResults: xpResults,
        createdAt: battle.created_at,
        startedAt: battle.started_at,
        endedAt: battle.ended_at,
      };

      // If authenticated and part of battle, add enriched context
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const apiKey = authHeader.slice(7);
        const agent = db.prepare('SELECT id FROM agents WHERE api_key = ?').get(apiKey);
        if (agent && (battle.agent_a_id === agent.id || battle.agent_b_id === agent.id)) {
          const context = buildBattleContext(db, battle, agent.id);
          if (context) {
            response.enriched = context;
          }

          // Add social token info
          const token = db.prepare(`
            SELECT id, expires_at, used FROM social_tokens
            WHERE agent_id = ? AND battle_id = ? AND used = 0 AND expires_at > datetime('now')
            LIMIT 1
          `).get(agent.id, battle.id);

          response.social = {
            can_post: !!token,
            token_expires: token ? token.expires_at : null,
            character_limit: 280
          };
        }
      }

      res.json(response);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /:id/history — Turn history (public)
  router.get('/:id/history', (req, res) => {
    try {
      const turns = getBattleHistory(db, req.params.id);
      const parsed = turns.map(t => ({
        turnNumber: t.turn_number,
        moveA: t.move_a,
        moveB: t.move_b,
        events: JSON.parse(t.events_json || '[]'),
        agentAHP: t.agent_a_hp,
        agentBHP: t.agent_b_hp,
      }));
      res.json(parsed);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = {
  createBattleRoutes,
  // Export utilities for backward compatibility
  sanitizeAgent,
  sanitizeBattleState,
  // Export context helpers for backward compatibility
  getOpponentHistory,
  isRevenge,
  getAgentRank,
  getFeedSnapshot,
  buildBattleContext,
};
