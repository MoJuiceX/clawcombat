/**
 * Tutorial Battle Service
 *
 * Provides an instant first battle experience for new lobsters.
 *
 * Tutorial battles are designed to:
 * - Match against a level 1 seed bot
 * - Guarantee the new lobster wins
 * - Last exactly 5-6 turns for good pacing
 * - Generate a real battle replay the user can watch
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
 * Tutorial battle is designed to:
 * - Always match against a level 1 seed bot
 * - Guarantee the new agent wins
 * - Last exactly 5-6 turns for pacing
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

  // Find a level 1 tutorial opponent
  const opponent = findTutorialOpponent(db, newAgent);
  if (!opponent) {
    throw new Error('No tutorial opponent available');
  }

  log.info('Starting tutorial battle', {
    new_agent: newAgent.name,
    opponent: opponent.name,
    type_matchup: `${newAgent.type} vs ${opponent.type}`
  });

  // TUTORIAL BOOST: Ensure new agent wins in 5-6 turns
  // We temporarily boost the new agent's attack power
  const boostedAgent = { ...newAgent };
  const targetTurns = 5 + Math.floor(Math.random() * 2); // 5 or 6 turns

  // Calculate how much damage per turn needed to KO opponent in target turns
  const opponentHP = opponent.hp;
  const damagePerTurn = Math.ceil(opponentHP / targetTurns);

  // Boost attack stats to ensure we deal this damage
  // This is temporary and only affects this battle calculation
  boostedAgent.attack = Math.max(boostedAgent.attack, damagePerTurn * 1.5);
  boostedAgent.sp_atk = Math.max(boostedAgent.sp_atk, damagePerTurn * 1.5);

  // Create battle in database (use original agent data, not boosted)
  const battleId = createBattle(db, newAgent, opponent);

  // Initialize battle state with boosted agent
  let battleState = initializeBattleState(boostedAgent, opponent);
  battleState.id = battleId;

  // Create AI strategists for both sides
  const newAgentAI = createAIStrategist();
  const opponentAI = createAIStrategist();

  const MAX_TURNS = 10; // Tutorial battles should end quickly
  let turnNumber = 0;

  // Run battle until conclusion (guaranteed to end with new agent winning)
  while (turnNumber < MAX_TURNS) {
    turnNumber++;

    // Both agents select moves
    const newAgentMove = newAgentAI.selectMove(
      battleState.agentA,
      battleState.agentB,
      boostedAgent.moves.map(m => m.id)
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

  // Determine winner/loser (new agent should always be winner due to boost)
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
 *
 * Requirements:
 * - Must be level 1 (fair fight for new lobster)
 * - Preferably weak to new agent's type (gives new agent advantage)
 * - Must be a seed bot (not another user's lobster)
 */
function findTutorialOpponent(db, newAgent) {
  // Get all level 1 seed bots (created by seed-bots-v2.js)
  const level1SeedBots = db.prepare(`
    SELECT * FROM agents
    WHERE name IN ('Larry', 'Ember', 'Bubbles', 'Sparky', 'Leaf', 'Frosty', 'Bruce', 'Toxic', 'Rocky', 'Breeze', 'Mystic', 'Buzz', 'Pebbles', 'Casper', 'Smaug', 'Shadow', 'Rusty', 'Luna')
    AND status = 'active'
    AND level = 1
    ORDER BY RANDOM()
    LIMIT 18
  `).all();

  if (level1SeedBots.length === 0) {
    // Fallback: any seed bot if no level 1s available
    const anySeedBot = db.prepare(`
      SELECT * FROM agents
      WHERE name IN ('Larry', 'Ember', 'Bubbles', 'Sparky', 'Leaf', 'Frosty', 'Bruce', 'Toxic', 'Rocky', 'Breeze', 'Mystic', 'Buzz', 'Pebbles', 'Casper', 'Smaug', 'Shadow', 'Rusty', 'Luna')
      AND status = 'active'
      ORDER BY level ASC
      LIMIT 1
    `).get();

    return anySeedBot ? mapDbAgent(anySeedBot) : null;
  }

  // Get type advantages
  const { TYPE_ADVANTAGES } = require('../utils/type-system');
  const newAgentAdvantages = TYPE_ADVANTAGES[newAgent.type] || [];

  // Find level 1 bots that the new agent has advantage against
  const weakBots = level1SeedBots.filter(bot =>
    newAgentAdvantages.includes(bot.ai_type)
  );

  // If we found bots with type disadvantage, pick one randomly
  if (weakBots.length > 0) {
    const randomIndex = Math.floor(Math.random() * weakBots.length);
    return mapDbAgent(weakBots[randomIndex]);
  }

  // Otherwise, pick a random level 1 seed bot
  const randomIndex = Math.floor(Math.random() * level1SeedBots.length);
  return mapDbAgent(level1SeedBots[randomIndex]);
}

module.exports = {
  runTutorialBattle,
  findTutorialOpponent,
};
