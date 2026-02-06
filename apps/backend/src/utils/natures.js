/**
 * Lobster Natures System
 *
 * Natures modify stats by +10%/-10%, adding strategic depth to lobster builds.
 * Each nature boosts one stat and reduces another (or has no effect).
 */

const naturesData = require('../data/pokeapi-natures.json');

// Build lookup maps
const NATURES_BY_NAME = {};
const NATURES_LIST = [];

for (const nature of naturesData) {
  const normalized = {
    name: nature.name,
    boost: nature.boost,    // stat to increase by 10%
    reduce: nature.reduce,  // stat to decrease by 10%
    description: nature.desc
  };
  NATURES_BY_NAME[nature.name.toLowerCase()] = normalized;
  NATURES_LIST.push(normalized);
}

// Valid nature names for validation
const VALID_NATURE_NAMES = NATURES_LIST.map(n => n.name);

/**
 * Get a nature by name (case-insensitive)
 * @param {string} name - Nature name
 * @returns {object|null} - Nature object or null if not found
 */
function getNatureByName(name) {
  if (!name) return null;
  return NATURES_BY_NAME[name.toLowerCase()] || null;
}

/**
 * Get all available natures
 * @returns {array} - Array of all natures
 */
function getAllNatures() {
  return NATURES_LIST;
}

/**
 * Get a random nature
 * @returns {object} - Random nature object
 */
function getRandomNature() {
  return NATURES_LIST[Math.floor(Math.random() * NATURES_LIST.length)];
}

/**
 * Get a nature that complements the stat build
 * Prefers natures that boost the dominant stat
 * @param {object} stats - { hp, attack, defense, sp_atk, sp_def, speed }
 * @returns {object} - Complementary nature
 */
function getComplementaryNature(stats) {
  // Find the highest stat
  let maxStat = 'attack';
  let maxVal = 0;

  for (const [stat, val] of Object.entries(stats)) {
    if (stat !== 'hp' && val > maxVal) {  // HP can't be boosted by nature
      maxVal = val;
      maxStat = stat;
    }
  }

  // Find natures that boost this stat
  const complementary = NATURES_LIST.filter(n => n.boost === maxStat);

  if (complementary.length === 0) {
    // No nature boosts this stat (HP), return balanced nature
    return getNatureByName('Balanced');
  }

  // Pick a random one from the complementary options
  return complementary[Math.floor(Math.random() * complementary.length)];
}

/**
 * Apply nature modifiers to stats
 * @param {object} baseStats - { hp, attack, defense, sp_atk, sp_def, speed }
 * @param {object} nature - Nature object with boost/reduce
 * @returns {object} - Modified stats
 */
function applyNatureModifiers(baseStats, nature) {
  if (!nature) return { ...baseStats };

  const modified = { ...baseStats };

  // Apply +10% boost
  if (nature.boost && modified[nature.boost] !== undefined) {
    modified[nature.boost] = Math.round(modified[nature.boost] * 1.1);
  }

  // Apply -10% reduction
  if (nature.reduce && modified[nature.reduce] !== undefined) {
    modified[nature.reduce] = Math.round(modified[nature.reduce] * 0.9);
  }

  return modified;
}

/**
 * Get strategic natures for a given playstyle
 * @param {string} playstyle - 'physical', 'special', 'tank', 'speed', 'balanced'
 * @returns {array} - Array of recommended natures
 */
function getNaturesForPlaystyle(playstyle) {
  switch (playstyle) {
    case 'physical':
      // Boost attack, don't care about sp_atk
      return NATURES_LIST.filter(n => n.boost === 'attack' && n.reduce !== 'speed');

    case 'special':
      // Boost sp_atk (claw), don't care about attack
      return NATURES_LIST.filter(n => n.boost === 'sp_atk' && n.reduce !== 'speed');

    case 'tank':
      // Boost defense or sp_def
      return NATURES_LIST.filter(n => n.boost === 'defense' || n.boost === 'sp_def');

    case 'speed':
      // Boost speed
      return NATURES_LIST.filter(n => n.boost === 'speed');

    case 'balanced':
    default:
      // Neutral natures
      return NATURES_LIST.filter(n => !n.boost && !n.reduce);
  }
}

/**
 * Validate a nature name
 * @param {string} name - Nature name to validate
 * @returns {boolean} - True if valid
 */
function isValidNature(name) {
  if (!name) return false;
  return Object.prototype.hasOwnProperty.call(NATURES_BY_NAME, name.toLowerCase());
}

/**
 * Get nature description for display
 * @param {object} nature - Nature object
 * @returns {string} - Human-readable description
 */
function getNatureDescription(nature) {
  if (!nature) return 'No nature effect';
  if (!nature.boost && !nature.reduce) return 'Balanced - no stat changes';

  const boostName = {
    attack: 'Attack',
    defense: 'Defense',
    sp_atk: 'Claw (Sp.Atk)',
    sp_def: 'Shell (Sp.Def)',
    speed: 'Speed'
  };

  return `+10% ${boostName[nature.boost] || nature.boost}, -10% ${boostName[nature.reduce] || nature.reduce}`;
}

module.exports = {
  getAllNatures,
  getNatureByName,
  getRandomNature,
  getComplementaryNature,
  applyNatureModifiers,
  getNaturesForPlaystyle,
  isValidNature,
  getNatureDescription,
  VALID_NATURE_NAMES
};
