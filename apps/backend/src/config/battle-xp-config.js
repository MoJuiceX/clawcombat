'use strict';

const { MS_PER_HOUR } = require('./constants');

/**
 * ClawCombat XP System Configuration
 *
 * This file contains all XP-related constants and configurations.
 * Designed for balanced progression: easy early, harder late, achievable for active players.
 *
 * Target timeline:
 * - Premium hardcore (24 battles/day): ~7.5 months to level 100
 * - Free active (6 battles/day): ~2.5 years to level 100
 */

// =============================================================================
// LEVEL REQUIREMENTS (Bracket-based XP needed to level up)
// =============================================================================

/**
 * XP required to advance from level N to level N+1
 * Level 1→2 is FREE (first win forces level-up, handled separately)
 */
const LEVEL_XP_REQUIREMENTS = {
  // Early game: Quick progression to hook players
  2: 500,    // 2→3: ~5 wins
  3: 800,    // 3→4: ~8 wins
  4: 1200,   // 4→5: ~12 wins

  // Levels 5-10: Steady progression
  5: 1500,
  6: 1500,
  7: 1500,
  8: 1500,
  9: 1500,

  // Levels 11-20: Moderate increase
  10: 2000,
  11: 2000,
  12: 2000,
  13: 2000,
  14: 2000,
  15: 2000,
  16: 2000,
  17: 2000,
  18: 2000,
  19: 2000,

  // Levels 21-35: Getting serious
  20: 3000,
  21: 3000,
  22: 3000,
  23: 3000,
  24: 3000,
  25: 3000,
  26: 3000,
  27: 3000,
  28: 3000,
  29: 3000,
  30: 3000,
  31: 3000,
  32: 3000,
  33: 3000,
  34: 3000,

  // Levels 36-50: Mid-game grind
  35: 4500,
  36: 4500,
  37: 4500,
  38: 4500,
  39: 4500,
  40: 4500,
  41: 4500,
  42: 4500,
  43: 4500,
  44: 4500,
  45: 4500,
  46: 4500,
  47: 4500,
  48: 4500,
  49: 4500,

  // Levels 51-70: Late game
  50: 6000,
  51: 6000,
  52: 6000,
  53: 6000,
  54: 6000,
  55: 6000,
  56: 6000,
  57: 6000,
  58: 6000,
  59: 6000,
  60: 6000,
  61: 6000,
  62: 6000,
  63: 6000,
  64: 6000,
  65: 6000,
  66: 6000,
  67: 6000,
  68: 6000,
  69: 6000,

  // Levels 71-85: Veteran tier
  70: 7500,
  71: 7500,
  72: 7500,
  73: 7500,
  74: 7500,
  75: 7500,
  76: 7500,
  77: 7500,
  78: 7500,
  79: 7500,
  80: 7500,
  81: 7500,
  82: 7500,
  83: 7500,
  84: 7500,

  // Levels 86-99: Elite tier
  85: 9000,
  86: 9000,
  87: 9000,
  88: 9000,
  89: 9000,
  90: 9000,
  91: 9000,
  92: 9000,
  93: 9000,
  94: 9000,
  95: 9000,
  96: 9000,
  97: 9000,
  98: 9000,
  99: 9000,
};

// =============================================================================
// LEVEL-BASED XP EARNING (Higher level = more base XP per battle)
// =============================================================================

// Loss XP increased from 10% to 15% of win XP for better casual player retention
const LEVEL_XP_EARNING_BRACKETS = [
  { minLevel: 1,  maxLevel: 10,  winXP: 100, lossXP: 15 },
  { minLevel: 11, maxLevel: 25,  winXP: 120, lossXP: 18 },
  { minLevel: 26, maxLevel: 50,  winXP: 150, lossXP: 23 },
  { minLevel: 51, maxLevel: 75,  winXP: 180, lossXP: 27 },
  { minLevel: 76, maxLevel: 100, winXP: 200, lossXP: 30 },
];

// =============================================================================
// OPPONENT LEVEL DIFFERENCE MODIFIERS
// =============================================================================

const OPPONENT_LEVEL_MODIFIERS = [
  { minDiff: 20,  maxDiff: Infinity, modifier: 0.50 },  // Giant Slayer: +50%
  { minDiff: 10,  maxDiff: 19,       modifier: 0.30 },  // Beat opponent 10+ higher: +30%
  { minDiff: 5,   maxDiff: 9,        modifier: 0.15 },  // Beat opponent 5-9 higher: +15%
  { minDiff: -4,  maxDiff: 4,        modifier: 0.00 },  // Within ±4 levels: normal
  { minDiff: -9,  maxDiff: -5,       modifier: -0.15 }, // Beat opponent 5-9 lower: -15%
  { minDiff: -19, maxDiff: -10,      modifier: -0.30 }, // Beat opponent 10+ lower: -30%
  { minDiff: -Infinity, maxDiff: -20, modifier: -0.30 }, // Beat opponent 20+ lower: -30% (capped)
];

// Giant Slayer threshold (triggers badge + extra bonus)
const GIANT_SLAYER_LEVEL_DIFF = 20;

// =============================================================================
// WIN STREAK BONUSES
// =============================================================================

const WIN_STREAK_BONUSES = [
  { minStreak: 10, bonus: 0.15 },  // 10+ wins: +15%
  { minStreak: 5,  bonus: 0.12 },  // 5+ wins: +12%
  { minStreak: 3,  bonus: 0.06 },  // 3+ wins: +6%
  { minStreak: 2,  bonus: 0.03 },  // 2 wins: +3%
];

// =============================================================================
// DAILY FIRST WIN BONUS
// =============================================================================

const DAILY_FIRST_WIN_BONUS = 0.50; // +50% XP on first win of the day (increased from 33% for casual player retention)

// =============================================================================
// LOGIN STREAK REWARDS (XP awarded for daily login)
// =============================================================================

const LOGIN_STREAK_REWARDS = {
  1: 25,   // Day 1
  2: 40,   // Day 2
  3: 50,   // Day 3
  4: 65,   // Day 4
  5: 75,   // Day 5
  6: 90,   // Day 6
  7: 350,  // Day 7 (100 + 250 bonus)
};

// After day 7, cycle restarts
const LOGIN_STREAK_CYCLE_DAYS = 7;

// =============================================================================
// RESTED XP SYSTEM (Casual player catch-up mechanic)
// =============================================================================

const RESTED_XP_CONFIG = {
  multiplier: 2.0,           // 2x XP when rested
  maxRestedBattles: 3,       // Max battles that can benefit from rested XP
  offlineHoursRequired: 24,  // Hours offline before gaining rested status
  maxStoredDays: 2,          // Maximum rested battles can accumulate (2 days = 6 battles max)
};

// =============================================================================
// GENERAL CONSTANTS
// =============================================================================

const MAX_LEVEL = 100;
const FIRST_BATTLE_WIN_XP = 100; // XP shown for first win (level-up is forced separately)
const PREMIUM_XP_MULTIPLIER = 1.5; // +50% XP for premium subscribers

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get XP required to level up from the given level
 * @param {number} level - Current level (1-99)
 * @returns {number} XP needed (0 if at max level)
 */
function getXPToLevelUp(level) {
  if (level >= MAX_LEVEL) return 0;
  if (level < 2) return 0; // Level 1→2 is free (first win)
  return LEVEL_XP_REQUIREMENTS[level] || 9000; // Default to elite tier if not defined
}

/**
 * Get base XP earning for a player at the given level
 * @param {number} level - Player's level
 * @param {boolean} won - Whether they won or lost
 * @returns {number} Base XP before modifiers
 */
function getBaseXPForLevel(level, won) {
  for (const bracket of LEVEL_XP_EARNING_BRACKETS) {
    if (level >= bracket.minLevel && level <= bracket.maxLevel) {
      return won ? bracket.winXP : bracket.lossXP;
    }
  }
  // Default to highest bracket
  const last = LEVEL_XP_EARNING_BRACKETS[LEVEL_XP_EARNING_BRACKETS.length - 1];
  return won ? last.winXP : last.lossXP;
}

/**
 * Get modifier based on opponent level difference
 * @param {number} playerLevel - Player's level
 * @param {number} opponentLevel - Opponent's level
 * @returns {{ modifier: number, isGiantSlayer: boolean }}
 */
function getOpponentLevelModifier(playerLevel, opponentLevel) {
  const diff = opponentLevel - playerLevel; // Positive = opponent is higher

  for (const bracket of OPPONENT_LEVEL_MODIFIERS) {
    if (diff >= bracket.minDiff && diff <= bracket.maxDiff) {
      return {
        modifier: bracket.modifier,
        isGiantSlayer: diff >= GIANT_SLAYER_LEVEL_DIFF
      };
    }
  }

  return { modifier: 0, isGiantSlayer: false };
}

/**
 * Get win streak bonus percentage
 * @param {number} streak - Current win streak (before this win)
 * @returns {number} Bonus percentage (0.03 = 3%)
 */
function getWinStreakBonus(streak) {
  // Streak parameter is the streak BEFORE this win, so we add 1
  const newStreak = streak + 1;

  for (const tier of WIN_STREAK_BONUSES) {
    if (newStreak >= tier.minStreak) {
      return tier.bonus;
    }
  }

  return 0;
}

/**
 * Get login streak reward XP
 * @param {number} streakDay - Current streak day (1-7)
 * @returns {number} XP reward
 */
function getLoginStreakReward(streakDay) {
  const day = ((streakDay - 1) % LOGIN_STREAK_CYCLE_DAYS) + 1;
  return LOGIN_STREAK_REWARDS[day] || LOGIN_STREAK_REWARDS[1];
}

/**
 * Calculate total XP needed to reach a specific level from level 1
 * @param {number} targetLevel - Target level
 * @returns {number} Total XP needed
 */
function getTotalXPForLevel(targetLevel) {
  let total = 0;
  for (let lvl = 2; lvl < targetLevel; lvl++) {
    total += getXPToLevelUp(lvl);
  }
  return total;
}

/**
 * Estimate battles needed to reach level 100
 * @param {number} battlesPerDay - Average battles per day
 * @param {number} winRate - Win rate (0.5 = 50%)
 * @returns {{ totalBattles: number, days: number, months: number }}
 */
function estimateToMax(battlesPerDay = 24, winRate = 0.5) {
  // Simplified estimate using average XP per battle
  const avgWinXP = 150; // Mid-range estimate
  const avgLossXP = 23; // Updated to 15% of win XP
  const avgXPPerBattle = (avgWinXP * winRate) + (avgLossXP * (1 - winRate));

  const totalXP = getTotalXPForLevel(100);
  const totalBattles = Math.ceil(totalXP / avgXPPerBattle);
  const days = Math.ceil(totalBattles / battlesPerDay);
  const months = (days / 30).toFixed(1);

  return { totalBattles, days, months: parseFloat(months) };
}

/**
 * Calculate rested XP status for an agent
 * @param {Date|string} lastBattleAt - Last battle timestamp
 * @param {number} currentRestedBattles - Current rested battles available
 * @returns {{ isRested: boolean, restedBattlesAvailable: number, multiplier: number }}
 */
function calculateRestedStatus(lastBattleAt, currentRestedBattles = 0) {
  if (!lastBattleAt) {
    // New player or never battled - start with max rested
    return {
      isRested: true,
      restedBattlesAvailable: RESTED_XP_CONFIG.maxRestedBattles,
      multiplier: RESTED_XP_CONFIG.multiplier
    };
  }

  const lastBattle = new Date(lastBattleAt);
  const now = new Date();
  const hoursSinceLastBattle = (now - lastBattle) / MS_PER_HOUR;

  // Calculate new rested battles based on time offline
  if (hoursSinceLastBattle >= RESTED_XP_CONFIG.offlineHoursRequired) {
    // Grant 3 rested battles per 24h offline, up to max
    const daysOffline = Math.floor(hoursSinceLastBattle / 24);
    const newRestedBattles = Math.min(
      daysOffline * RESTED_XP_CONFIG.maxRestedBattles,
      RESTED_XP_CONFIG.maxRestedBattles * RESTED_XP_CONFIG.maxStoredDays
    );

    return {
      isRested: true,
      restedBattlesAvailable: Math.max(currentRestedBattles, newRestedBattles),
      multiplier: RESTED_XP_CONFIG.multiplier
    };
  }

  // Not enough time offline, use existing rested battles if any
  return {
    isRested: currentRestedBattles > 0,
    restedBattlesAvailable: currentRestedBattles,
    multiplier: currentRestedBattles > 0 ? RESTED_XP_CONFIG.multiplier : 1.0
  };
}

/**
 * Apply rested XP bonus and decrement rested battles
 * @param {number} baseXP - XP before rested bonus
 * @param {number} restedBattlesAvailable - Current rested battles
 * @returns {{ xp: number, restedUsed: boolean, remainingRestedBattles: number }}
 */
function applyRestedBonus(baseXP, restedBattlesAvailable) {
  if (restedBattlesAvailable <= 0) {
    return {
      xp: baseXP,
      restedUsed: false,
      remainingRestedBattles: 0
    };
  }

  return {
    xp: Math.round(baseXP * RESTED_XP_CONFIG.multiplier),
    restedUsed: true,
    remainingRestedBattles: restedBattlesAvailable - 1
  };
}

module.exports = {
  // Constants
  LEVEL_XP_REQUIREMENTS,
  LEVEL_XP_EARNING_BRACKETS,
  OPPONENT_LEVEL_MODIFIERS,
  WIN_STREAK_BONUSES,
  DAILY_FIRST_WIN_BONUS,
  LOGIN_STREAK_REWARDS,
  LOGIN_STREAK_CYCLE_DAYS,
  MAX_LEVEL,
  FIRST_BATTLE_WIN_XP,
  GIANT_SLAYER_LEVEL_DIFF,
  RESTED_XP_CONFIG,
  PREMIUM_XP_MULTIPLIER,

  // Helper functions
  getXPToLevelUp,
  getBaseXPForLevel,
  getOpponentLevelModifier,
  getWinStreakBonus,
  getLoginStreakReward,
  getTotalXPForLevel,
  estimateToMax,
  calculateRestedStatus,
  applyRestedBonus,
};
