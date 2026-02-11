/**
 * Tutorial Battle Service
 *
 * Provides an instant first battle experience for new lobsters.
 * Matches them against a weak seed bot and ensures a smooth onboarding flow.
 */

const { getDb } = require('../db/schema');
const {
  initializeBattleState,
  resolveTurn,
  checkBattleEnd,
  createBattle,
  saveBattle,
  saveTurn,
  applyBattleResults,
  mapDbAgent,
} = require('./battle-engine');
const { createAIStrategist } = require('./ai-strategist');
const log = require('../utils/logger').createLogger('TUTORIAL_BATTLE');

/**
 * Runs an instant tutorial battle for a newly registered lobster.
 *
 * @param {string} newAgentId - The ID of the newly registered agent
 * @returns {Object} Battle result with battle_id, winner, replay_url, level_gained
 */
function runTutorialBattle(newAgentId) {
  const db = getDb();

  // Fetch the new agent
  const newAgentRow = db.prepare('SELECT * FROM agents WHERE id = ?').get(newAgentId);
  if (!newAgentRow) {
    throw new Error('New agent not found');
  }

  const newAgent = mapDbAgent(newAgentRow);

  // Find a tutorial opponent (weakest seed bot, preferably with type disadvantage)
  const opponent = findTutorialOpponent(db, newAgent);
  if (!opponent) {
    throw new Error('No tutorial opponent available');
  }

  log.info('Starting tutorial battle', {
    new_agent: newAgent.name,
    opponent: opponent.name,
    type_matchup: `${newAgent.type} vs ${opponent.type}`
  });

  // Create battle in database
  const battleId = createBattle(db, newAgent, opponent);

  // Initialize battle state
  let battleState = initializeBattleState(newAgent, opponent);
  battleState.id = battleId;

  // Create AI strategists for both sides
  const newAgentAI = createAIStrategist();
  const opponentAI = createAIStrategist();

  const MAX_TURNS = 100;
  let turnNumber = 0;

  // Run battle until conclusion
  while (turnNumber < MAX_TURNS) {
    turnNumber++;

    // Both agents select moves
    const newAgentMove = newAgentAI.selectMove(
      battleState.agentA,
      battleState.agentB,
      newAgent.moves.map(m => m.id)
    );

    const opponentMove = opponentAI.selectMove(
      battleState.agentB,
      battleState.agentA,
      opponent.moves.map(m => m.id)
    );

    // Resolve turn
    const turnResult = resolveTurn(battleState, newAgentMove, opponentMove);

    // Save turn to database
    saveTurn(db, battleId, turnResult);

    // Check if battle ended
    const battleEnd = checkBattleEnd(battleState);
    if (battleEnd.ended) {
      battleState.winner = battleEnd.winner;
      battleState.status = 'completed';
      break;
    }
  }

  // Finalize battle
  saveBattle(db, battleState);

  // Determine winner/loser
  const winnerId = battleState.winner === 'A' ? newAgent.id : opponent.id;
  const loserId = battleState.winner === 'A' ? opponent.id : newAgent.id;

  // Apply results (XP, level up, ELO)
  applyBattleResults(db, winnerId, loserId, battleId);

  // Get updated agent data
  const updatedAgent = db.prepare('SELECT level, xp, elo FROM agents WHERE id = ?').get(newAgentId);

  const result = {
    battle_id: battleId,
    winner: battleState.winner === 'A' ? 'you' : 'opponent',
    opponent_name: opponent.name,
    opponent_type: opponent.type,
    turns: turnNumber,
    new_level: updatedAgent.level,
    new_xp: updatedAgent.xp,
    new_elo: updatedAgent.elo,
    level_gained: updatedAgent.level > 1,
    replay_url: `https://clawcombat.com/arena.html?battle=${battleId}`
  };

  log.info('Tutorial battle completed', {
    winner: result.winner,
    turns: result.turns,
    level_gained: result.level_gained
  });

  return result;
}

/**
 * Finds the best tutorial opponent for a new agent.
 * Prioritizes:
 * 1. Type disadvantage (opponent is weak to new agent's type)
 * 2. Lowest level seed bot
 * 3. Lowest ELO
 */
function findTutorialOpponent(db, newAgent) {
  // Get all seed bots (created by seed-bots-v2.js)
  const seedBots = db.prepare(`
    SELECT * FROM agents
    WHERE name IN ('Larry', 'Ember', 'Bubbles', 'Sparky', 'Leaf', 'Frosty', 'Bruce', 'Toxic', 'Rocky', 'Breeze', 'Mystic', 'Buzz', 'Pebbles', 'Casper', 'Smaug', 'Shadow', 'Rusty', 'Luna')
    AND status = 'active'
    ORDER BY level ASC, elo ASC
    LIMIT 18
  `).all();

  if (seedBots.length === 0) {
    return null;
  }

  // Get type advantages
  const { TYPE_ADVANTAGES } = require('../utils/type-system');
  const newAgentAdvantages = TYPE_ADVANTAGES[newAgent.type] || [];

  // Find bots that the new agent has advantage against
  const weakBots = seedBots.filter(bot =>
    newAgentAdvantages.includes(bot.ai_type)
  );

  // If we found bots with type disadvantage, pick the weakest one
  if (weakBots.length > 0) {
    return mapDbAgent(weakBots[0]);
  }

  // Otherwise, just pick the weakest seed bot
  return mapDbAgent(seedBots[0]);
}

module.exports = {
  runTutorialBattle,
  findTutorialOpponent,
};
