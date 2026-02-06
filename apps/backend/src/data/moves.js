'use strict';

// ============================================================================
// CLAWCOMBAT MOVES DATABASE
// Loaded from PokeAPI import (191 moves, ~10-12 per type)
// Backward compatible: legacy move IDs (normal_1, fire_1, etc.) still resolve
// ============================================================================

const TYPES = [
  'NEUTRAL','FIRE','WATER','ELECTRIC','GRASS','ICE','MARTIAL','VENOM',
  'EARTH','AIR','PSYCHE','INSECT','STONE','GHOST','DRAGON','SHADOW','METAL','MYSTIC'
];

// Load PokeAPI data
const MOVES_BY_TYPE_RAW = require('./pokeapi-moves.json');
const LEGACY_MAP = require('./legacy-move-map.json');

// Build flat list and keyed maps
const MOVES_LIST = [];
const MOVES = {};
const MOVES_BY_TYPE = {};

for (const type of TYPES) {
  const pool = MOVES_BY_TYPE_RAW[type] || [];
  MOVES_BY_TYPE[type] = pool;
  for (const move of pool) {
    MOVES_LIST.push(move);
    MOVES[move.id] = move;
  }
}

// Index legacy IDs pointing to new moves
const LEGACY_MOVES = {};
for (const [legacyId, newId] of Object.entries(LEGACY_MAP)) {
  if (MOVES[newId]) {
    LEGACY_MOVES[legacyId] = MOVES[newId];
  }
}

// Get the full move pool for a type (~10-12 moves to choose from)
function getMovePoolForType(type) {
  return MOVES_BY_TYPE[type] || [];
}

// Get default 4 moves for a type (backward compat for existing lobsters + auto-creation)
function getMovesForType(type) {
  const pool = MOVES_BY_TYPE[type] || [];
  return pool.slice(0, 4);
}

// Look up a move by ID (checks both new and legacy IDs)
function getMoveById(id) {
  return MOVES[id] || LEGACY_MOVES[id] || null;
}

// Get moves by an array of IDs (for loading a specific lobster's chosen moves)
function getMovesByIds(ids) {
  return ids.map(id => getMoveById(id)).filter(Boolean);
}

// Validate that move IDs are valid for a given type
function validateMoveSelection(moveIds, type) {
  if (!Array.isArray(moveIds) || moveIds.length !== 4) {
    return { valid: false, error: 'Must select exactly 4 moves' };
  }
  const pool = getMovePoolForType(type);
  const poolIds = new Set(pool.map(m => m.id));
  const invalid = moveIds.filter(id => !poolIds.has(id));
  if (invalid.length > 0) {
    return { valid: false, error: `Invalid moves for type ${type}: ${invalid.join(', ')}` };
  }
  const unique = new Set(moveIds);
  if (unique.size !== 4) {
    return { valid: false, error: 'All 4 moves must be different' };
  }
  return { valid: true };
}

// Pick 4 random moves from a type's pool
// Ensures at least 3 damage moves (power > 0), max 1 status move (power === 0)
function randomMovesForType(type) {
  const pool = getMovePoolForType(type);
  if (pool.length <= 4) return pool.map(m => m.id);

  // Separate into damage moves and status moves
  const damageMoves = pool.filter(m => m.power > 0);
  const statusMoves = pool.filter(m => m.power === 0);

  // Fisher-Yates shuffle
  const shuffle = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const shuffledDamage = shuffle(damageMoves);
  const shuffledStatus = shuffle(statusMoves);

  const selected = [];

  // Pick 3 damage moves (or all if fewer than 3)
  const damageCount = Math.min(3, shuffledDamage.length);
  for (let i = 0; i < damageCount; i++) {
    selected.push(shuffledDamage[i]);
  }

  // Try to add 1 status move if available
  if (shuffledStatus.length > 0 && selected.length < 4) {
    selected.push(shuffledStatus[0]);
  }

  // Fill remaining slots with more damage moves if we need 4
  let damageIdx = damageCount;
  while (selected.length < 4 && damageIdx < shuffledDamage.length) {
    selected.push(shuffledDamage[damageIdx]);
    damageIdx++;
  }

  // Final shuffle so damage/status order is random
  return shuffle(selected).map(m => m.id);
}

module.exports = {
  TYPES,
  MOVES_LIST,
  MOVES,
  MOVES_BY_TYPE,
  getMovesForType,
  getMovePoolForType,
  getMoveById,
  getMovesByIds,
  validateMoveSelection,
  randomMovesForType,
};
