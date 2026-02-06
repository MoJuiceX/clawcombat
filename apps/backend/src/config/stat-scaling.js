'use strict';

/**
 * ClawCombat Stat Scaling System
 *
 * Handles all level-based scaling for:
 * - HP (scales more aggressively)
 * - Attack, Defense, Sp.Atk, Sp.Def, Speed (moderate scaling)
 * - Move Power (conservative scaling)
 * - Evolution bonuses at level 20 and 60
 *
 * Design philosophy:
 * - Level 1 lobster vs Level 100 lobster should feel meaningfully different
 * - Higher level = stronger in all aspects
 * - Move power scaling is conservative (side bonus, not main driver)
 * - Evolution milestones provide noticeable power spikes
 */

// =============================================================================
// STAT TOKEN SYSTEM
// =============================================================================

// Hard cap per stat: forces players to invest in at least 2 stats
const STAT_TOKEN_CAP = 50;

// Milestone levels that grant move respecs
const RESPEC_MILESTONES = [10, 20, 30, 40, 50, 60, 70, 80, 90];

// =============================================================================
// EVOLUTION TIERS
// =============================================================================

const EVOLUTION_TIERS = {
  1: { name: 'Basic', minLevel: 1, maxLevel: 19, statBonus: 0 },
  2: { name: 'Evolved', minLevel: 20, maxLevel: 59, statBonus: 0.10 },  // +10%
  3: { name: 'Final', minLevel: 60, maxLevel: 100, statBonus: 0.25 },   // +25% total (+15% on top of Tier 2)
};

/**
 * Get evolution tier for a given level
 * @param {number} level
 * @returns {{ tier: number, name: string, statBonus: number }}
 */
function getEvolutionTier(level) {
  if (level >= 60) return { tier: 3, ...EVOLUTION_TIERS[3] };
  if (level >= 20) return { tier: 2, ...EVOLUTION_TIERS[2] };
  return { tier: 1, ...EVOLUTION_TIERS[1] };
}

/**
 * Check if leveling up triggers an evolution
 * @param {number} oldLevel
 * @param {number} newLevel
 * @returns {{ evolved: boolean, fromTier: number, toTier: number, tierName: string } | null}
 */
function checkEvolution(oldLevel, newLevel) {
  const oldTier = getEvolutionTier(oldLevel);
  const newTier = getEvolutionTier(newLevel);

  if (newTier.tier > oldTier.tier) {
    return {
      evolved: true,
      fromTier: oldTier.tier,
      toTier: newTier.tier,
      tierName: newTier.name,
    };
  }
  return null;
}

// =============================================================================
// STAT SCALING FORMULAS
// =============================================================================

/**
 * Base scaling multiplier per level (applies to all stats)
 * Formula: 1 + (level - 1) * 0.02
 * - Level 1: 1.0x
 * - Level 50: 1.98x
 * - Level 100: 2.98x
 */
function getLevelMultiplier(level) {
  return 1 + (level - 1) * 0.02;
}

/**
 * Calculate effective HP at a given level
 * HP scales more aggressively than other stats
 *
 * @param {number} baseHP - Base HP stat (from agent creation)
 * @param {number} level - Current level
 * @param {number} evHP - EV points in HP (0-252)
 * @returns {number} Effective HP
 */
function calculateEffectiveHP(baseHP, level, evHP = 0) {
  const levelMult = getLevelMultiplier(level);
  const evoTier = getEvolutionTier(level);

  // HP bonus multiplier (HP scales 3x more than other stats for longer battles)
  // Changed from 1.2 to 3.0 to make battles last 4-8 turns instead of 1-2
  const hpBonus = 3.0;

  // EV contribution (each 4 EV points = +1 to stat at level 100)
  const evContribution = Math.floor(evHP / 4) * (level / 100);

  const baseScaled = baseHP * levelMult * hpBonus * (1 + evoTier.statBonus);

  return Math.round(baseScaled + evContribution + 20); // +20 base HP floor (was +10)
}

/**
 * Calculate effective stat (Attack, Defense, Sp.Atk, Sp.Def, Speed)
 *
 * @param {number} baseStat - Base stat value
 * @param {number} level - Current level
 * @param {number} evStat - EV points in this stat (0-252)
 * @param {number} natureMod - Nature modifier (0.9, 1.0, or 1.1)
 * @returns {number} Effective stat
 */
function calculateEffectiveStat(baseStat, level, evStat = 0, natureMod = 1.0) {
  const levelMult = getLevelMultiplier(level);
  const evoTier = getEvolutionTier(level);

  // EV contribution
  const evContribution = Math.floor(evStat / 4) * (level / 100);

  const baseScaled = baseStat * levelMult * (1 + evoTier.statBonus) * natureMod;

  return Math.round(baseScaled + evContribution + 5); // +5 base floor
}

/**
 * Calculate all effective stats for an agent at their current level
 * Includes: base stats + level scaling + EV contribution + nature modifiers + token bonuses
 *
 * @param {object} agent - Agent with base stats, EVs, nature, level, and stat tokens
 * @returns {object} All effective stats
 */
function calculateAllEffectiveStatsScaled(agent) {
  const level = agent.level || 1;

  // Nature modifiers
  const natureBoost = agent.nature_boost;
  const natureReduce = agent.nature_reduce;

  function getNatureMod(statName) {
    if (natureBoost === statName) return 1.1;
    if (natureReduce === statName) return 0.9;
    return 1.0;
  }

  // Stat token bonuses (each token = +1 to effective stat)
  const tokenHP = agent.stat_tokens_hp || 0;
  const tokenAtk = agent.stat_tokens_attack || 0;
  const tokenDef = agent.stat_tokens_defense || 0;
  const tokenSpAtk = agent.stat_tokens_sp_atk || 0;
  const tokenSpDef = agent.stat_tokens_sp_def || 0;
  const tokenSpeed = agent.stat_tokens_speed || 0;

  return {
    hp: calculateEffectiveHP(agent.base_hp || 17, level, agent.ev_hp || 0) + tokenHP,
    attack: calculateEffectiveStat(agent.base_attack || 17, level, agent.ev_attack || 0, getNatureMod('attack')) + tokenAtk,
    defense: calculateEffectiveStat(agent.base_defense || 17, level, agent.ev_defense || 0, getNatureMod('defense')) + tokenDef,
    sp_atk: calculateEffectiveStat(agent.base_sp_atk || 17, level, agent.ev_sp_atk || 0, getNatureMod('sp_atk')) + tokenSpAtk,
    sp_def: calculateEffectiveStat(agent.base_sp_def || 16, level, agent.ev_sp_def || 0, getNatureMod('sp_def')) + tokenSpDef,
    speed: calculateEffectiveStat(agent.base_speed || 16, level, agent.ev_speed || 0, getNatureMod('speed')) + tokenSpeed,
  };
}

/**
 * Get stat token allocation info for an agent
 * Useful for UI display
 *
 * @param {object} agent - Agent with stat token columns
 * @returns {object} Token info including available, invested, totals, and cap
 */
function getStatTokenInfo(agent) {
  const invested = {
    hp: agent.stat_tokens_hp || 0,
    attack: agent.stat_tokens_attack || 0,
    defense: agent.stat_tokens_defense || 0,
    sp_atk: agent.stat_tokens_sp_atk || 0,
    sp_def: agent.stat_tokens_sp_def || 0,
    speed: agent.stat_tokens_speed || 0,
  };

  const totalInvested = Object.values(invested).reduce((sum, val) => sum + val, 0);

  return {
    available: agent.stat_tokens_available || 0,
    invested,
    totalInvested,
    capPerStat: STAT_TOKEN_CAP,
  };
}

/**
 * Validate a token allocation request
 *
 * @param {object} agent - Agent with current token state
 * @param {object} allocations - Requested allocations { hp: 5, attack: 3, etc. }
 * @returns {{ valid: boolean, error?: string, tokensToSpend?: number }}
 */
function validateTokenAllocation(agent, allocations) {
  const available = agent.stat_tokens_available || 0;
  const validStats = ['hp', 'attack', 'defense', 'sp_atk', 'sp_def', 'speed'];

  let totalRequested = 0;

  for (const [stat, amount] of Object.entries(allocations)) {
    // Check stat name is valid
    if (!validStats.includes(stat)) {
      return { valid: false, error: `Invalid stat: ${stat}` };
    }

    // Check amount is positive integer
    if (!Number.isInteger(amount) || amount < 0) {
      return { valid: false, error: `Invalid amount for ${stat}: must be a positive integer` };
    }

    // Check stat cap won't be exceeded
    const currentInvested = agent[`stat_tokens_${stat}`] || 0;
    if (currentInvested + amount > STAT_TOKEN_CAP) {
      return {
        valid: false,
        error: `Cannot allocate ${amount} to ${stat}: would exceed cap of ${STAT_TOKEN_CAP} (currently ${currentInvested})`
      };
    }

    totalRequested += amount;
  }

  // Check total doesn't exceed available
  if (totalRequested > available) {
    return {
      valid: false,
      error: `Insufficient tokens: requested ${totalRequested}, available ${available}`
    };
  }

  return { valid: true, tokensToSpend: totalRequested };
}

// =============================================================================
// MOVE POWER SCALING (Conservative)
// =============================================================================

/**
 * Calculate effective move power at a given level
 *
 * Conservative scaling: +0.3% per level, capped at +30% at level 100
 * This is a "side bonus" - the main damage scaling comes from stat growth
 *
 * @param {number} basePower - Move's base power (e.g., 90)
 * @param {number} level - User's level
 * @returns {number} Effective move power
 */
function calculateEffectiveMovePower(basePower, level) {
  if (!basePower || basePower === 0) return 0; // Status moves stay at 0

  // Conservative scaling: +0.3% per level = +30% at level 100
  const powerMultiplier = 1 + (level - 1) * 0.003;

  return Math.round(basePower * powerMultiplier);
}

/**
 * Get move power scaling info for display
 *
 * @param {number} basePower
 * @param {number} level
 * @returns {{ basePower: number, effectivePower: number, bonus: number, bonusPercent: string }}
 */
function getMovePowerScaling(basePower, level) {
  const effectivePower = calculateEffectiveMovePower(basePower, level);
  const bonus = effectivePower - basePower;
  const bonusPercent = basePower > 0 ? Math.round((bonus / basePower) * 100) : 0;

  return {
    basePower,
    effectivePower,
    bonus,
    bonusPercent: `+${bonusPercent}%`,
  };
}

// =============================================================================
// STAT SCALING PREVIEW (for UI/debugging)
// =============================================================================

/**
 * Generate a preview of stat scaling at key levels
 *
 * @param {number} baseStat - Base stat value
 * @param {boolean} isHP - Whether this is HP (scales more)
 * @returns {Array} Array of { level, value, multiplier, tier }
 */
function getStatScalingPreview(baseStat, isHP = false) {
  const keyLevels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  return keyLevels.map(level => {
    const value = isHP
      ? calculateEffectiveHP(baseStat, level, 0)
      : calculateEffectiveStat(baseStat, level, 0, 1.0);
    const tier = getEvolutionTier(level);

    return {
      level,
      value,
      multiplier: (value / baseStat).toFixed(2) + 'x',
      tier: tier.tier,
      tierName: tier.name,
    };
  });
}

/**
 * Generate a preview of move power scaling at key levels
 *
 * @param {number} basePower - Move's base power
 * @returns {Array}
 */
function getMovePowerScalingPreview(basePower) {
  const keyLevels = [1, 20, 40, 60, 80, 100];

  return keyLevels.map(level => {
    const { effectivePower, bonusPercent } = getMovePowerScaling(basePower, level);
    return {
      level,
      basePower,
      effectivePower,
      bonus: bonusPercent,
    };
  });
}

// =============================================================================
// DAMAGE CALCULATION HELPER
// =============================================================================

/**
 * Calculate damage with all scaling applied
 * This is the core damage formula used in battles
 *
 * Formula: ((2 * Level / 5 + 2) * Power * Attack / Defense / 50 + 2) * Modifiers
 * Simplified version that incorporates level scaling
 *
 * @param {object} params
 * @param {number} params.level - Attacker's level
 * @param {number} params.movePower - Move's base power
 * @param {number} params.attackStat - Attacker's relevant stat (Attack or Sp.Atk)
 * @param {number} params.defenseStat - Defender's relevant stat (Defense or Sp.Def)
 * @param {number} params.stab - Same Type Attack Bonus (1.0 or 1.5)
 * @param {number} params.typeEffectiveness - Type matchup (0.5, 1.0, 2.0, etc.)
 * @param {boolean} params.isCrit - Critical hit (1.5x damage)
 * @returns {number} Final damage
 */
function calculateDamage({
  level,
  movePower,
  attackStat,
  defenseStat,
  stab = 1.0,
  typeEffectiveness = 1.0,
  isCrit = false,
}) {
  // Apply level scaling to move power
  const effectivePower = calculateEffectiveMovePower(movePower, level);

  // Pokemon-style damage formula
  const levelFactor = (2 * level / 5 + 2);
  const baseDamage = (levelFactor * effectivePower * attackStat / defenseStat) / 50 + 2;

  // Apply modifiers
  let damage = baseDamage * stab * typeEffectiveness;

  // Critical hit
  if (isCrit) {
    damage *= 1.5;
  }

  // Random variance (85-100%)
  const variance = 0.85 + Math.random() * 0.15;
  damage *= variance;

  return Math.max(1, Math.round(damage)); // Minimum 1 damage
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Evolution
  EVOLUTION_TIERS,
  getEvolutionTier,
  checkEvolution,

  // Stat scaling
  getLevelMultiplier,
  calculateEffectiveHP,
  calculateEffectiveStat,
  calculateAllEffectiveStatsScaled,

  // Move power scaling
  calculateEffectiveMovePower,
  getMovePowerScaling,

  // Stat token system
  STAT_TOKEN_CAP,
  RESPEC_MILESTONES,
  getStatTokenInfo,
  validateTokenAllocation,

  // Previews (for UI/debugging)
  getStatScalingPreview,
  getMovePowerScalingPreview,

  // Damage calculation
  calculateDamage,
};
