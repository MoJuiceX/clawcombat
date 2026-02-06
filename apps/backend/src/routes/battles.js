/**
 * ClawCombat Turn-Based Battle Routes
 *
 * Mounts the battle engine's Express routes at /battles.
 * Replaces the old prompt-based fights.js system.
 *
 * Endpoints:
 *   POST   /battles/queue         — Join matchmaking queue
 *   DELETE /battles/queue         — Leave matchmaking queue
 *   POST   /battles/challenge     — Challenge a specific agent
 *   POST   /battles/:id/accept    — Accept a challenge
 *   POST   /battles/:id/choose-move — Submit a move for current turn
 *   POST   /battles/:id/surrender — Forfeit the battle
 *   GET    /battles/:id           — Get battle state (public)
 *   GET    /battles/:id/history   — Turn history (public)
 *   GET    /battles/active        — Agent's active battle
 *   GET    /battles/recent        — Recent completed battles
 */

const log = require('../utils/logger').createLogger('BATTLES');
const { getDb } = require('../db/schema');
const { authenticateAgent } = require('../middleware/auth');
const { createBattleRoutes } = require('../services/battle-engine');
const moltbookService = require('../services/moltbook-service');

const db = getDb();
const router = createBattleRoutes(db, authenticateAgent);

/**
 * GET /battles/:id/moltbook-summary
 * Get Moltbook post data for a completed battle
 */
router.get('/:id/moltbook-summary', authenticateAgent, (req, res) => {
  try {
    const battleId = req.params.id;
    const agentId = req.agent.id;

    // Get battle data
    const battle = db.prepare(`
      SELECT b.*,
             a.name as agent_a_name, a.ai_type as agent_a_type, a.total_wins as a_wins, a.total_losses as a_losses, a.level as a_level, a.elo as a_elo, a.win_streak as a_streak,
             o.name as agent_b_name, o.ai_type as agent_b_type, o.total_wins as b_wins, o.total_losses as b_losses, o.level as b_level, o.elo as b_elo, o.win_streak as b_streak
      FROM battles b
      LEFT JOIN agents a ON b.agent_a_id = a.id
      LEFT JOIN agents o ON b.agent_b_id = o.id
      WHERE b.id = ?
    `).get(battleId);

    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }

    // Determine which side the requesting agent was on
    const isAgentA = battle.agent_a_id === agentId;
    const isAgentB = battle.agent_b_id === agentId;

    if (!isAgentA && !isAgentB) {
      return res.status(403).json({ error: 'You were not in this battle' });
    }

    const won = battle.winner_id === agentId;

    // Build agent and opponent objects
    const agent = isAgentA ? {
      id: battle.agent_a_id,
      name: battle.agent_a_name,
      ai_type: battle.agent_a_type,
      total_wins: battle.a_wins || 0,
      total_losses: battle.a_losses || 0,
      level: battle.a_level || 1,
      elo: battle.a_elo || 1000,
      win_streak: battle.a_streak || 0,
      rank: 999 // Would need to calculate actual rank
    } : {
      id: battle.agent_b_id,
      name: battle.agent_b_name,
      ai_type: battle.agent_b_type,
      total_wins: battle.b_wins || 0,
      total_losses: battle.b_losses || 0,
      level: battle.b_level || 1,
      elo: battle.b_elo || 1000,
      win_streak: battle.b_streak || 0,
      rank: 999
    };

    const opponent = isAgentA ? {
      id: battle.agent_b_id,
      name: battle.agent_b_name,
      ai_type: battle.agent_b_type
    } : {
      id: battle.agent_a_id,
      name: battle.agent_a_name,
      ai_type: battle.agent_a_type
    };

    // Parse battle state for final move
    let finalMove = 'a powerful attack';
    try {
      const state = JSON.parse(battle.state_json || '{}');
      if (state.lastMove) {
        finalMove = state.lastMove;
      }
    } catch (e) {
      // JSON parse failed, use default finalMove
      log.debug('Battle state parse failed, using default finalMove', { battleId, error: e.message });
    }

    // Generate moltbook post data
    const moltbookData = moltbookService.generateMoltbookPostData(
      agent,
      opponent,
      { final_move: finalMove },
      won
    );

    res.json({
      battle_id: battleId,
      status: battle.status,
      ...moltbookData
    });
  } catch (err) {
    log.error('Moltbook summary error:', { error: err.message });
    res.status(500).json({ error: 'Failed to generate moltbook summary' });
  }
});

module.exports = router;
