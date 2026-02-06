'use strict';

// ============================================================================
// ClawCombat AI Strategist
// Automated move selection for PvE battles and agents without webhooks.
// Three difficulty levels: easy, normal, hard.
// ============================================================================

const { MOVES } = require('../data/moves');
const { TYPE_CHART } = require('./battle-engine');

// ============================================================================
// CONSTANTS
// ============================================================================

const DIFFICULTY = {
  EASY: 'easy',
  NORMAL: 'normal',
  HARD: 'hard',
};

// Scoring thresholds and weights
const SCORE = {
  BASE: 50,
  SUPER_EFFECTIVE: 30,
  NOT_VERY_EFFECTIVE: -20,
  IMMUNE: -40,
  KILL_SHOT: 25,
  SIGNIFICANT_DAMAGE: 10,
  LOW_HP_AGGRESSION: 10,
  STATUS_VALUE: 15,
  HEALING_VALUE: 20,
};

// ============================================================================
// DAMAGE ESTIMATION
// Simplified version of battle-engine's calculateDamage — no crits, no random
// factor, no abilities. Just a rough estimate for AI decision-making.
// ============================================================================

/**
 * Estimate damage a move would deal.
 * Uses attack/sp_atk for offensive stat and defense/sp_def for defensive stat
 * based on move category (physical vs special).
 *
 * @param {object} attacker - Attacker battle state
 * @param {object} defender - Defender battle state
 * @param {object} move     - Move data object
 * @param {object} typeChart - TYPE_CHART[atkType][defType] = multiplier
 * @returns {number} Estimated damage (floored to integer, minimum 1 for damaging moves)
 */
function estimateDamage(attacker, defender, move, typeChart) {
  if (!move.power || move.power === 0) return 0;

  const isPhysical = move.category === 'physical';
  const atkStat = isPhysical ? (attacker.attack || 50) : (attacker.sp_atk || 50);
  const defStat = isPhysical ? (defender.defense || 50) : (defender.sp_def || 50);

  const effectiveness = getEffectiveness(move.type, defender.type, typeChart);

  const damage = move.power * (atkStat / Math.max(1, defStat)) * effectiveness * 0.5;
  return Math.max(1, Math.floor(damage));
}

// ============================================================================
// TYPE EFFECTIVENESS HELPER
// ============================================================================

/**
 * Get type effectiveness multiplier for a move against a defender type.
 *
 * @param {string} moveType     - The move's type (e.g. 'FIRE')
 * @param {string} defenderType - The defender's type (e.g. 'GRASS')
 * @param {object} typeChart    - TYPE_CHART lookup table
 * @returns {number} Multiplier: 0, 0.5, 1.0, or 2.0
 */
function getEffectiveness(moveType, defenderType, typeChart) {
  if (!typeChart || !typeChart[moveType]) return 1.0;
  return typeChart[moveType][defenderType] || 1.0;
}

// ============================================================================
// MOVE EVALUATION
// Scores a single move on a 0-100 scale based on tactical value.
// ============================================================================

/**
 * Evaluate a move's tactical score given the current battle context.
 *
 * @param {object} attacker  - Attacker battle state
 * @param {object} defender  - Defender battle state
 * @param {object} move      - Move data object (from MOVES or battle state)
 * @param {object} typeChart - TYPE_CHART lookup table
 * @returns {number} Score in the 0-100 range (clamped)
 */
function evaluateMove(attacker, defender, move, typeChart) {
  const tc = typeChart || TYPE_CHART;

  let score = SCORE.BASE;

  // ---- Type effectiveness modifier ----
  const effectiveness = getEffectiveness(move.type, defender.type, tc);

  if (effectiveness >= 2.0) {
    score += SCORE.SUPER_EFFECTIVE;
  } else if (effectiveness === 0) {
    score += SCORE.IMMUNE;
  } else if (effectiveness > 0 && effectiveness < 1.0) {
    score += SCORE.NOT_VERY_EFFECTIVE;
  }

  // ---- Damage-based scoring ----
  const estDmg = estimateDamage(attacker, defender, move, tc);

  // Kill shot: if estimated damage can KO the defender
  const defenderHP = defender.hp != null ? defender.hp : defender.currentHP;
  if (estDmg > 0 && defenderHP != null && estDmg >= defenderHP) {
    score += SCORE.KILL_SHOT;
  }

  // Significant damage: estimated damage >= 50% of defender's max HP
  const defenderMaxHP = defender.maxHp || defender.maxHP || defenderHP || 100;
  if (estDmg > 0 && estDmg >= defenderMaxHP * 0.5) {
    score += SCORE.SIGNIFICANT_DAMAGE;
  }

  // ---- Low HP aggression: go all-out when desperate ----
  const attackerHP = attacker.hp != null ? attacker.hp : attacker.currentHP;
  const attackerMaxHP = attacker.maxHp || attacker.maxHP || attackerHP || 100;
  if (attackerHP != null && attackerMaxHP > 0 && (attackerHP / attackerMaxHP) < 0.25) {
    if (estDmg > 0) {
      score += SCORE.LOW_HP_AGGRESSION;
    }
  }

  // ---- Status move value ----
  // Award points if the move can inflict a status and the defender has none
  if (move.effect && move.effect.type === 'status' && move.effect.status) {
    if (!defender.status) {
      score += SCORE.STATUS_VALUE;
    }
  }

  // ---- Healing move value ----
  // Award points if the move heals and the attacker is below 40% HP
  if (move.effect && move.effect.type === 'heal') {
    if (attackerHP != null && attackerMaxHP > 0 && (attackerHP / attackerMaxHP) < 0.4) {
      score += SCORE.HEALING_VALUE;
    }
  }

  // ---- Accuracy penalty ----
  // Penalize inaccurate moves: -(100 - accuracy) / 5
  const accuracy = move.accuracy || 100;
  score -= (100 - accuracy) / 5;

  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

// ============================================================================
// MOVE CHOICE — TOP-LEVEL FUNCTION
// ============================================================================

/**
 * Choose the best move for an AI-controlled agent.
 *
 * @param {string} difficulty   - 'easy' | 'normal' | 'hard'
 * @param {object} attacker     - Attacker battle state
 * @param {object} defender     - Defender battle state
 * @param {Array}  moves        - Array of move objects or move IDs available to the attacker
 * @param {object} [typeChart]  - Optional TYPE_CHART override (defaults to battle-engine's)
 * @returns {string} The chosen move's ID
 */
function chooseMove(difficulty, attacker, defender, moves, typeChart) {
  const tc = typeChart || TYPE_CHART;

  // Resolve move IDs to full move objects if needed
  const resolvedMoves = resolveMoves(moves);

  // Filter out moves with 0 PP remaining (if PP tracking is present)
  const usable = resolvedMoves.filter(m => {
    if (m.currentPP != null) return m.currentPP > 0;
    return true;
  });

  // Fallback: if no usable moves, just pick the first available
  if (usable.length === 0) {
    return resolvedMoves.length > 0 ? resolvedMoves[0].id : null;
  }

  // ---- EASY: purely random ----
  if (difficulty === DIFFICULTY.EASY) {
    const index = Math.floor(Math.random() * usable.length);
    return usable[index].id;
  }

  // ---- Score all moves ----
  const scored = usable.map(move => ({
    move,
    score: evaluateMove(attacker, defender, move, tc),
  }));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // ---- HARD: always pick the best ----
  if (difficulty === DIFFICULTY.HARD) {
    return scored[0].move.id;
  }

  // ---- NORMAL: best move 80% of the time, second-best 20% ----
  if (scored.length >= 2) {
    return Math.random() < 0.8 ? scored[0].move.id : scored[1].move.id;
  }

  // Only one move available
  return scored[0].move.id;
}

// ============================================================================
// MOVE RESOLUTION HELPER
// Accepts an array of move objects or move ID strings and returns full objects.
// ============================================================================

/**
 * Resolve an array of moves that may be IDs (strings) or full objects.
 *
 * @param {Array} moves - Array of move objects or move ID strings
 * @returns {Array} Array of full move objects
 */
function resolveMoves(moves) {
  if (!moves || moves.length === 0) return [];

  return moves.map(m => {
    if (typeof m === 'string') {
      return MOVES[m] || null;
    }
    // Already a full move object
    return m;
  }).filter(Boolean);
}

// ============================================================================
// AIStrategist CLASS
// Object-oriented wrapper for managing AI difficulty and choosing moves.
// ============================================================================

class AIStrategist {
  /**
   * @param {string} [difficulty='normal'] - Difficulty level: 'easy' | 'normal' | 'hard'
   * @param {object} [typeChart]           - Optional custom type chart
   */
  constructor(difficulty = DIFFICULTY.NORMAL, typeChart = null) {
    this.difficulty = difficulty;
    this.typeChart = typeChart || TYPE_CHART;

    // PERFORMANCE: Memoization cache for type effectiveness lookups
    // Key: "moveType:defenderType" → effectiveness multiplier
    // Reduces redundant TYPE_CHART lookups during a battle
    this._effectivenessCache = new Map();
  }

  /**
   * Get type effectiveness with memoization.
   * Same matchup looked up once per battle instead of per-move-per-turn.
   * @private
   */
  _getEffectivenessCached(moveType, defenderType) {
    const key = `${moveType}:${defenderType}`;
    if (this._effectivenessCache.has(key)) {
      return this._effectivenessCache.get(key);
    }
    const effectiveness = getEffectiveness(moveType, defenderType, this.typeChart);
    this._effectivenessCache.set(key, effectiveness);
    return effectiveness;
  }

  /**
   * Clear the effectiveness cache (call when battle ends or defender changes).
   */
  clearCache() {
    this._effectivenessCache.clear();
  }

  /**
   * Evaluate a move with cached effectiveness lookups.
   * @private
   */
  _evaluateMoveCached(attacker, defender, move) {
    let score = SCORE.BASE;

    // ---- Type effectiveness modifier (CACHED) ----
    const effectiveness = this._getEffectivenessCached(move.type, defender.type);

    if (effectiveness >= 2.0) {
      score += SCORE.SUPER_EFFECTIVE;
    } else if (effectiveness === 0) {
      score += SCORE.IMMUNE;
    } else if (effectiveness > 0 && effectiveness < 1.0) {
      score += SCORE.NOT_VERY_EFFECTIVE;
    }

    // ---- Damage-based scoring ----
    const estDmg = estimateDamage(attacker, defender, move, this.typeChart);

    // Kill shot: if estimated damage can KO the defender
    const defenderHP = defender.hp != null ? defender.hp : defender.currentHP;
    if (estDmg > 0 && defenderHP != null && estDmg >= defenderHP) {
      score += SCORE.KILL_SHOT;
    }

    // Significant damage: estimated damage >= 50% of defender's max HP
    const defenderMaxHP = defender.maxHp || defender.maxHP || defenderHP || 100;
    if (estDmg > 0 && estDmg >= defenderMaxHP * 0.5) {
      score += SCORE.SIGNIFICANT_DAMAGE;
    }

    // ---- Low HP aggression: go all-out when desperate ----
    const attackerHP = attacker.hp != null ? attacker.hp : attacker.currentHP;
    const attackerMaxHP = attacker.maxHp || attacker.maxHP || attackerHP || 100;
    if (attackerHP != null && attackerMaxHP > 0 && (attackerHP / attackerMaxHP) < 0.25) {
      if (estDmg > 0) {
        score += SCORE.LOW_HP_AGGRESSION;
      }
    }

    // ---- Status move value ----
    if (move.effect && move.effect.type === 'status' && move.effect.status) {
      if (!defender.status) {
        score += SCORE.STATUS_VALUE;
      }
    }

    // ---- Healing move value ----
    if (move.effect && move.effect.type === 'heal') {
      if (attackerHP != null && attackerMaxHP > 0 && (attackerHP / attackerMaxHP) < 0.4) {
        score += SCORE.HEALING_VALUE;
      }
    }

    // ---- Accuracy penalty ----
    const accuracy = move.accuracy || 100;
    score -= (100 - accuracy) / 5;

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Choose the best move for the given battle context.
   *
   * @param {object} attacker - Attacker battle state
   * @param {object} defender - Defender battle state
   * @param {Array}  moves    - Available moves (objects or IDs)
   * @returns {string} Chosen move ID
   */
  choose(attacker, defender, moves) {
    // Resolve move IDs to full move objects if needed
    const resolvedMoves = resolveMoves(moves);

    // Filter out moves with 0 PP remaining
    const usable = resolvedMoves.filter(m => {
      if (m.currentPP != null) return m.currentPP > 0;
      return true;
    });

    // Fallback: if no usable moves, just pick the first available
    if (usable.length === 0) {
      return resolvedMoves.length > 0 ? resolvedMoves[0].id : null;
    }

    // ---- EASY: purely random ----
    if (this.difficulty === DIFFICULTY.EASY) {
      const index = Math.floor(Math.random() * usable.length);
      return usable[index].id;
    }

    // ---- Score all moves (with memoization) ----
    const scored = usable.map(move => ({
      move,
      score: this._evaluateMoveCached(attacker, defender, move),
    }));

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // ---- HARD: always pick the best ----
    if (this.difficulty === DIFFICULTY.HARD) {
      return scored[0].move.id;
    }

    // ---- NORMAL: best move 80% of the time, second-best 20% ----
    if (scored.length >= 2) {
      return Math.random() < 0.8 ? scored[0].move.id : scored[1].move.id;
    }

    // Only one move available
    return scored[0].move.id;
  }

  /**
   * Score all available moves and return them sorted best-to-worst.
   * Useful for debugging or displaying AI reasoning.
   *
   * @param {object} attacker - Attacker battle state
   * @param {object} defender - Defender battle state
   * @param {Array}  moves    - Available moves (objects or IDs)
   * @returns {Array<{moveId: string, name: string, score: number}>}
   */
  rankMoves(attacker, defender, moves) {
    const resolved = resolveMoves(moves);
    const ranked = resolved.map(move => ({
      moveId: move.id,
      name: move.name,
      score: this._evaluateMoveCached(attacker, defender, move),
    }));
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  chooseMove,
  evaluateMove,
  AIStrategist,
  // Internal helpers exported for testing
  estimateDamage,
  getEffectiveness,
  resolveMoves,
  DIFFICULTY,
  SCORE,
};
