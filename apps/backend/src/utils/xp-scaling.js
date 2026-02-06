'use strict';

/**
 * XP Scaling Utilities
 *
 * This module provides backward-compatible XP functions that delegate
 * to the centralized battle-xp-config.js configuration.
 *
 * For new code, prefer importing directly from '../config/battle-xp-config.js'
 */

const { getDb } = require('../db/schema');
const {
  getXPToLevelUp,
  getBaseXPForLevel,
  getOpponentLevelModifier,
  MAX_LEVEL
} = require('../config/battle-xp-config');

// =============================================================================
// XP EARNING (Legacy interface for calculateScaledXP)
// =============================================================================

/**
 * Calculate XP for winner and loser based on level difference.
 * Now delegates to the centralized config system.
 *
 * @param {number} winnerLevel
 * @param {number} loserLevel
 * @returns {{ winXP: number, lossXP: number, scaleFactor: number, levelDiff: number }}
 */
function calculateScaledXP(winnerLevel, loserLevel) {
  const levelDiff = (winnerLevel || 1) - (loserLevel || 1);

  // Get base XP for winner's level
  const baseWinXP = getBaseXPForLevel(winnerLevel || 1, true);
  const baseLossXP = getBaseXPForLevel(loserLevel || 1, false);

  // Get opponent level modifier (from winner's perspective: opponent is loser)
  const { modifier } = getOpponentLevelModifier(winnerLevel || 1, loserLevel || 1);

  // Apply modifier to win XP
  const scaleFactor = 1 + modifier;
  const winXP = Math.round(baseWinXP * scaleFactor);

  // Loser gets base loss XP (no scaling for losses)
  const lossXP = baseLossXP;

  return {
    winXP,
    lossXP,
    scaleFactor: Math.round(scaleFactor * 1000) / 1000,
    inverseScale: 1, // Deprecated, kept for backwards compatibility
    levelDiff
  };
}

// =============================================================================
// LEVEL REQUIREMENTS
// =============================================================================

/**
 * Returns the XP required to advance from `currentLevel` to the next level.
 * Now uses bracket-based system from battle-xp-config.js
 *
 * @param {number} currentLevel
 * @returns {number} XP needed (0 if at max level or level 1)
 */
function xpToLevelUp(currentLevel) {
  return getXPToLevelUp(currentLevel);
}

// =============================================================================
// LEVEL CALCULATION
// =============================================================================

/**
 * Derives the current level from total accumulated XP.
 * Iteratively subtracts XP thresholds until remaining XP is insufficient.
 *
 * @param {number} totalXP
 * @returns {{ level: number, currentXP: number, xpNeeded: number, progress: number }}
 */
function calculateLevel(totalXP) {
  let level = 1;
  let remaining = totalXP;

  // Level 1→2 is free (first win), start checking from level 2
  while (level < MAX_LEVEL) {
    const needed = xpToLevelUp(level);
    if (needed === 0 || remaining < needed) break;
    remaining -= needed;
    level++;
  }

  const xpNeeded = xpToLevelUp(level);
  const progress = xpNeeded > 0 ? Math.round((remaining / xpNeeded) * 100) : 100;

  return {
    level,
    currentXP: remaining,
    xpNeeded,
    progress
  };
}

// =============================================================================
// LEVEL-UP CHECK
// =============================================================================

/**
 * Checks whether an agent should level up based on their total XP.
 * Returns { leveled, oldLevel, newLevel } if a level change occurred.
 *
 * Expects agent object with at minimum: { id, xp, level }
 * Updates the agent's level in the database if leveled up.
 *
 * @param {object} agent
 * @returns {{ leveled: boolean, oldLevel: number, newLevel: number }}
 */
function checkLevelUp(agent) {
  const db = getDb();
  const oldLevel = agent.level || 1;
  const totalXP = agent.xp || 0;

  const { level: newLevel } = calculateLevel(totalXP);

  if (newLevel > oldLevel) {
    db.prepare('UPDATE agents SET level = ? WHERE id = ?').run(newLevel, agent.id);
    return { leveled: true, oldLevel, newLevel };
  }

  return { leveled: false, oldLevel, newLevel: oldLevel };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  calculateScaledXP,
  xpToLevelUp,
  calculateLevel,
  checkLevelUp,
  MAX_LEVEL
};
