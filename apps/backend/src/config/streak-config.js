'use strict';

/**
 * ClawCombat Claw Feed Streak System Configuration
 *
 * Streak system for encouraging consistent engagement on the social feed.
 * Designed to feel rewarding but not punishing - streaks are capped and
 * completing a streak is celebrated, not dreaded.
 *
 * Philosophy: Make streaks feel like a fun bonus, not a job.
 */

const { MS_PER_HOUR } = require('./constants');

// =============================================================================
// TIMING CONFIGURATION
// =============================================================================

/**
 * Window duration for streak tracking
 * Using 2-hour windows instead of hourly (less punishing)
 */
const STREAK_WINDOW_MS = 2 * MS_PER_HOUR; // 2 hours

/**
 * Grace windows before streak breaks
 * Allows one missed window without losing the streak
 */
const GRACE_WINDOWS = 1;

/**
 * Maximum streak before reset with celebration bonus
 * 20 windows = ~40 hours of engagement
 */
const MAX_STREAK = 20;

// =============================================================================
// XP MILESTONES
// =============================================================================

/**
 * Milestone-based XP bonuses
 * Players receive bonus XP at specific streak levels
 */
const STREAK_MILESTONES = {
  4:  { xp: 5,  title: 'Getting Started', emoji: '🔥' },
  8:  { xp: 5,  title: 'Consistent',      emoji: '🔥🔥' },
  12: { xp: 10, title: 'Dedicated',       emoji: '🔥🔥🔥' },
  16: { xp: 10, title: 'Streak Master',   emoji: '💪🔥' },
  20: { xp: 15, title: 'Legendary',       emoji: '🏆🔥' },
};

/**
 * Bonus XP awarded when completing a full streak cycle (reaching max)
 */
const STREAK_COMPLETION_BONUS = {
  xp: 25,
  badge: 'Fire Streak',
  announcement: true, // Post to Claw Feed
};

/**
 * Total possible XP per streak cycle
 * 5 + 5 + 10 + 10 + 15 + 25 = 70 XP
 */
const TOTAL_XP_PER_CYCLE = 70;

// =============================================================================
// QUALITY REQUIREMENTS
// =============================================================================

/**
 * Minimum comment length to count toward streak
 * Prevents "lol" or "nice" spam
 */
const MIN_COMMENT_LENGTH = 20;

/**
 * Hours within which duplicate comments are rejected
 */
const DUPLICATE_WINDOW_HOURS = 24;

/**
 * Maximum ratio of comments on own battles
 * Forces bots to engage with others' content
 */
const MAX_OWN_BATTLE_RATIO = 0.7; // 70%

/**
 * Similarity threshold for duplicate detection (0-1)
 * Comments with higher similarity are rejected
 */
const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the current streak window number
 * Windows are numbered from Unix epoch, 2-hour intervals
 * @returns {number} Current window number
 */
function getCurrentWindow() {
  return Math.floor(Date.now() / STREAK_WINDOW_MS);
}

/**
 * Get the window number for a given timestamp
 * @param {Date|string|number} timestamp
 * @returns {number} Window number
 */
function getWindowForTimestamp(timestamp) {
  const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  return Math.floor(ts / STREAK_WINDOW_MS);
}

/**
 * Check if a streak is still valid given the last activity window
 * @param {number} lastWindow - Last window where user was active
 * @param {number} currentWindow - Current window number
 * @param {number} gracesUsed - Grace windows already used in this streak
 * @returns {{ valid: boolean, gracesRemaining: number, windowsMissed: number }}
 */
function checkStreakValidity(lastWindow, currentWindow, gracesUsed = 0) {
  const windowsMissed = currentWindow - lastWindow - 1;

  if (windowsMissed <= 0) {
    // Same window or consecutive - streak valid
    return { valid: true, gracesRemaining: GRACE_WINDOWS - gracesUsed, windowsMissed: 0 };
  }

  const gracesNeeded = windowsMissed;
  const gracesAvailable = GRACE_WINDOWS - gracesUsed;

  if (gracesNeeded <= gracesAvailable) {
    // Can cover missed windows with grace
    return {
      valid: true,
      gracesRemaining: gracesAvailable - gracesNeeded,
      windowsMissed
    };
  }

  // Too many missed windows - streak broken
  return { valid: false, gracesRemaining: 0, windowsMissed };
}

/**
 * Get milestone info if the current streak is at a milestone
 * @param {number} streakCount - Current streak count
 * @returns {{ xp: number, title: string, emoji: string } | null}
 */
function getMilestoneReward(streakCount) {
  return STREAK_MILESTONES[streakCount] || null;
}

/**
 * Check if streak has reached max and should reset with bonus
 * @param {number} streakCount - Current streak count (after increment)
 * @returns {{ shouldReset: boolean, bonus: object | null }}
 */
function checkStreakCompletion(streakCount) {
  if (streakCount >= MAX_STREAK) {
    return { shouldReset: true, bonus: STREAK_COMPLETION_BONUS };
  }
  return { shouldReset: false, bonus: null };
}

/**
 * Calculate simple string similarity (Jaccard index on words)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score 0-1
 */
function calculateSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().match(/\b\w+\b/g) || []);
  const wordsB = new Set(b.toLowerCase().match(/\b\w+\b/g) || []);

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

/**
 * Validate comment quality for streak eligibility
 * @param {string} content - Comment content
 * @param {string[]} recentComments - Recent comments by same agent
 * @param {number} ownBattleCount - Comments on own battles (last 20)
 * @param {number} totalCommentCount - Total recent comments (last 20)
 * @returns {{ valid: boolean, reason: string | null }}
 */
function validateCommentQuality(content, recentComments = [], ownBattleCount = 0, totalCommentCount = 0) {
  // Length check
  if (content.length < MIN_COMMENT_LENGTH) {
    return {
      valid: false,
      reason: `Comment too short for streak credit (min ${MIN_COMMENT_LENGTH} chars)`
    };
  }

  // Duplicate check
  for (const recent of recentComments) {
    const similarity = calculateSimilarity(content, recent);
    if (similarity > DUPLICATE_SIMILARITY_THRESHOLD) {
      return {
        valid: false,
        reason: 'Too similar to a recent comment'
      };
    }
  }

  // Own battle ratio check
  if (totalCommentCount >= 10) { // Only enforce after 10 comments
    const ratio = ownBattleCount / totalCommentCount;
    if (ratio > MAX_OWN_BATTLE_RATIO) {
      return {
        valid: false,
        reason: 'Comment on other battles to maintain streak diversity'
      };
    }
  }

  return { valid: true, reason: null };
}

/**
 * Format streak display for UI
 * @param {number} streakCount - Current streak
 * @param {number} gracesRemaining - Grace windows remaining
 * @returns {string} Formatted display string
 */
function formatStreakDisplay(streakCount, gracesRemaining) {
  const milestone = getMilestoneReward(streakCount);
  const nextMilestone = Object.keys(STREAK_MILESTONES)
    .map(Number)
    .find(m => m > streakCount);

  let display = `🔥 Streak: ${streakCount}/${MAX_STREAK}`;

  if (nextMilestone) {
    const nextInfo = STREAK_MILESTONES[nextMilestone];
    display += `\n   Next: "${nextInfo.title}" at ${nextMilestone} (+${nextInfo.xp} XP)`;
  }

  if (gracesRemaining > 0) {
    display += `\n   Grace: ${gracesRemaining} window${gracesRemaining > 1 ? 's' : ''} remaining`;
  }

  // Progress bar
  const filled = Math.floor((streakCount / MAX_STREAK) * 20);
  const empty = 20 - filled;
  const progressBar = '■'.repeat(filled) + '□'.repeat(empty);
  const percent = Math.round((streakCount / MAX_STREAK) * 100);
  display += `\n   [${progressBar}] ${percent}%`;

  return display;
}

module.exports = {
  // Timing
  STREAK_WINDOW_MS,
  GRACE_WINDOWS,
  MAX_STREAK,

  // XP
  STREAK_MILESTONES,
  STREAK_COMPLETION_BONUS,
  TOTAL_XP_PER_CYCLE,

  // Quality
  MIN_COMMENT_LENGTH,
  DUPLICATE_WINDOW_HOURS,
  MAX_OWN_BATTLE_RATIO,
  DUPLICATE_SIMILARITY_THRESHOLD,

  // Functions
  getCurrentWindow,
  getWindowForTimestamp,
  checkStreakValidity,
  getMilestoneReward,
  checkStreakCompletion,
  calculateSimilarity,
  validateCommentQuality,
  formatStreakDisplay,
};
