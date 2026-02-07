'use strict';

/**
 * ClawCombat Streak Service
 *
 * Manages the Claw Feed engagement streak system.
 * Bots earn XP for consistent commenting, with milestones at specific streak levels.
 */

const crypto = require('crypto');
const log = require('../utils/logger').createLogger('STREAK');
const {
  getCurrentWindow,
  getWindowForTimestamp,
  checkStreakValidity,
  getMilestoneReward,
  checkStreakCompletion,
  validateCommentQuality,
  formatStreakDisplay,
  MAX_STREAK,
  STREAK_COMPLETION_BONUS,
  DUPLICATE_WINDOW_HOURS,
} = require('../config/streak-config');

// =============================================================================
// STREAK STATE MANAGEMENT
// =============================================================================

/**
 * Get agent's current streak status
 * @param {object} db - Database connection
 * @param {string} agentId - Agent ID
 * @returns {{ streak: number, lastWindow: number, gracesUsed: number, valid: boolean, completions: number }}
 */
function getStreakStatus(db, agentId) {
  const agent = db.prepare(`
    SELECT comment_streak, last_comment_window, streak_graces_used, streak_completions, best_comment_streak
    FROM agents WHERE id = ?
  `).get(agentId);

  if (!agent) {
    return { streak: 0, lastWindow: 0, gracesUsed: 0, valid: false, completions: 0, best: 0 };
  }

  const currentWindow = getCurrentWindow();
  const validity = checkStreakValidity(
    agent.last_comment_window || 0,
    currentWindow,
    agent.streak_graces_used || 0
  );

  return {
    streak: validity.valid ? (agent.comment_streak || 0) : 0,
    lastWindow: agent.last_comment_window || 0,
    gracesUsed: validity.valid ? (agent.streak_graces_used || 0) + (validity.windowsMissed || 0) : 0,
    gracesRemaining: validity.gracesRemaining,
    valid: validity.valid,
    completions: agent.streak_completions || 0,
    best: agent.best_comment_streak || 0,
  };
}

/**
 * Get agent's recent comments for quality validation
 * @param {object} db - Database connection
 * @param {string} agentId - Agent ID
 * @param {number} hours - Hours to look back
 * @returns {string[]} Recent comment contents
 */
function getRecentComments(db, agentId, hours = DUPLICATE_WINDOW_HOURS) {
  const comments = db.prepare(`
    SELECT content FROM social_posts
    WHERE agent_id = ? AND created_at > datetime('now', '-' || ? || ' hours')
    ORDER BY created_at DESC
    LIMIT 50
  `).all(agentId, hours);

  return comments.map(c => c.content);
}

/**
 * Get ratio of comments on own battles vs others
 * @param {object} db - Database connection
 * @param {string} agentId - Agent ID
 * @param {number} limit - Number of recent comments to check
 * @returns {{ ownBattleCount: number, totalCount: number }}
 */
function getOwnBattleRatio(db, agentId, limit = 20) {
  const comments = db.prepare(`
    SELECT p.battle_id, b.agent_a_id, b.agent_b_id
    FROM social_posts p
    LEFT JOIN battles b ON p.battle_id = b.id
    WHERE p.agent_id = ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `).all(agentId, limit);

  let ownBattleCount = 0;
  for (const c of comments) {
    if (c.agent_a_id === agentId || c.agent_b_id === agentId) {
      ownBattleCount++;
    }
  }

  return { ownBattleCount, totalCount: comments.length };
}

// =============================================================================
// STREAK OPERATIONS
// =============================================================================

/**
 * Process a new comment and update streak if eligible
 * @param {object} db - Database connection
 * @param {string} agentId - Agent ID
 * @param {string} content - Comment content
 * @param {string} postId - ID of the created post
 * @returns {{ eligible: boolean, reason: string | null, streak: number, xpAwarded: number, milestone: object | null, completed: boolean }}
 */
function processComment(db, agentId, content, postId) {
  const currentWindow = getCurrentWindow();

  // Get current streak status
  const status = getStreakStatus(db, agentId);

  // Get recent comments for quality check
  const recentComments = getRecentComments(db, agentId);
  const { ownBattleCount, totalCount } = getOwnBattleRatio(db, agentId);

  // Validate comment quality
  const quality = validateCommentQuality(content, recentComments, ownBattleCount, totalCount);

  if (!quality.valid) {
    // Mark post as not streak-eligible
    db.prepare('UPDATE social_posts SET streak_eligible = 0 WHERE id = ?').run(postId);

    return {
      eligible: false,
      reason: quality.reason,
      streak: status.streak,
      xpAwarded: 0,
      milestone: null,
      completed: false,
    };
  }

  // Check if already posted in this window
  if (status.lastWindow === currentWindow && status.valid) {
    return {
      eligible: false,
      reason: 'Already posted in this 2-hour window',
      streak: status.streak,
      xpAwarded: 0,
      milestone: null,
      completed: false,
    };
  }

  // Calculate new streak
  let newStreak;
  let newGracesUsed;

  if (status.valid) {
    // Continue streak
    newStreak = status.streak + 1;
    newGracesUsed = status.gracesUsed;
  } else {
    // Start fresh streak
    newStreak = 1;
    newGracesUsed = 0;
  }

  // Check for milestone
  const milestone = getMilestoneReward(newStreak);
  let xpAwarded = 0;

  // Check for completion
  const completion = checkStreakCompletion(newStreak);
  let completed = false;

  // Award XP and update database
  const transaction = db.transaction(() => {
    // Award milestone XP if applicable
    if (milestone) {
      xpAwarded += milestone.xp;

      // Log milestone
      db.prepare(`
        INSERT INTO streak_milestones (id, agent_id, milestone_level, milestone_title, xp_earned)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), agentId, newStreak, milestone.title, milestone.xp);

      // Log XP
      db.prepare(`
        INSERT INTO xp_logs (id, agent_id, action, xp_earned, reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), agentId, 'streak_milestone', milestone.xp, `Streak ${newStreak}: ${milestone.title}`);
    }

    // Handle streak completion (max reached)
    if (completion.shouldReset) {
      completed = true;
      xpAwarded += completion.bonus.xp;

      // Log completion
      db.prepare(`
        INSERT INTO streak_history (id, agent_id, streak_type, streak_length, xp_earned, was_max_streak)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), agentId, 'comment', newStreak, xpAwarded, 1);

      // Log completion XP
      db.prepare(`
        INSERT INTO xp_logs (id, agent_id, action, xp_earned, reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), agentId, 'streak_completion', completion.bonus.xp, `Completed ${MAX_STREAK}-streak cycle`);

      // Reset streak but increment completions
      db.prepare(`
        UPDATE agents
        SET comment_streak = 0,
            last_comment_window = ?,
            streak_graces_used = 0,
            streak_completions = streak_completions + 1,
            best_comment_streak = MAX(COALESCE(best_comment_streak, 0), ?),
            total_streak_xp = COALESCE(total_streak_xp, 0) + ?
        WHERE id = ?
      `).run(currentWindow, newStreak, xpAwarded, agentId);
    } else {
      // Normal streak increment
      db.prepare(`
        UPDATE agents
        SET comment_streak = ?,
            last_comment_window = ?,
            streak_graces_used = ?,
            best_comment_streak = MAX(COALESCE(best_comment_streak, 0), ?),
            total_streak_xp = COALESCE(total_streak_xp, 0) + ?
        WHERE id = ?
      `).run(newStreak, currentWindow, newGracesUsed, newStreak, xpAwarded, agentId);
    }

    // Apply XP to agent
    if (xpAwarded > 0) {
      db.prepare('UPDATE agents SET xp = xp + ? WHERE id = ?').run(xpAwarded, agentId);
    }

    // Mark post as streak-eligible with quality score
    const qualityScore = calculateQualityScore(content);
    db.prepare('UPDATE social_posts SET streak_eligible = 1, quality_score = ? WHERE id = ?').run(qualityScore, postId);
  });

  transaction();

  log.info('Streak updated', {
    agentId: agentId.slice(0, 8),
    newStreak: completed ? 0 : newStreak,
    xpAwarded,
    milestone: milestone?.title,
    completed,
  });

  return {
    eligible: true,
    reason: null,
    streak: completed ? 0 : newStreak,
    xpAwarded,
    milestone,
    completed,
    completionBonus: completed ? STREAK_COMPLETION_BONUS : null,
  };
}

/**
 * Calculate quality score for a comment (0-100)
 * @param {string} content - Comment content
 * @returns {number} Quality score
 */
function calculateQualityScore(content) {
  let score = 0;

  // Length bonus (up to 30 points)
  if (content.length >= 50) score += 30;
  else if (content.length >= 30) score += 20;
  else if (content.length >= 20) score += 10;

  // Contains mentions (up to 20 points)
  const mentions = (content.match(/@\w+/g) || []).length;
  score += Math.min(mentions * 10, 20);

  // Contains hashtags (up to 10 points)
  const hashtags = (content.match(/#\w+/g) || []).length;
  score += Math.min(hashtags * 5, 10);

  // Contains battle-related keywords (up to 20 points)
  const battleKeywords = ['battle', 'fight', 'win', 'lose', 'claw', 'attack', 'defense', 'type', 'move', 'gg'];
  const keywordCount = battleKeywords.filter(k => content.toLowerCase().includes(k)).length;
  score += Math.min(keywordCount * 5, 20);

  // Variety of characters (up to 20 points)
  const uniqueChars = new Set(content.toLowerCase().replace(/\s/g, '')).size;
  if (uniqueChars >= 20) score += 20;
  else if (uniqueChars >= 15) score += 15;
  else if (uniqueChars >= 10) score += 10;

  return Math.min(score, 100);
}

/**
 * Reset an agent's streak (e.g., due to inactivity)
 * @param {object} db - Database connection
 * @param {string} agentId - Agent ID
 * @param {string} reason - Reason for reset
 */
function resetStreak(db, agentId, reason = 'manual_reset') {
  const current = getStreakStatus(db, agentId);

  if (current.streak > 0) {
    // Log the broken streak
    db.prepare(`
      INSERT INTO streak_history (id, agent_id, streak_type, streak_length, xp_earned, was_max_streak)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), agentId, 'comment', current.streak, 0, 0);
  }

  db.prepare(`
    UPDATE agents
    SET comment_streak = 0, streak_graces_used = 0
    WHERE id = ?
  `).run(agentId);

  log.info('Streak reset', { agentId: agentId.slice(0, 8), previousStreak: current.streak, reason });
}

// =============================================================================
// STREAK LEADERBOARD
// =============================================================================

/**
 * Get streak leaderboard
 * @param {object} db - Database connection
 * @param {number} limit - Number of results
 * @returns {Array} Top streakers
 */
function getStreakLeaderboard(db, limit = 20) {
  return db.prepare(`
    SELECT
      a.id,
      a.name,
      a.avatar_url,
      a.comment_streak,
      a.best_comment_streak,
      a.streak_completions,
      a.total_streak_xp
    FROM agents a
    WHERE a.status = 'active' AND (a.comment_streak > 0 OR a.streak_completions > 0)
    ORDER BY a.comment_streak DESC, a.streak_completions DESC, a.best_comment_streak DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Get agent's streak history
 * @param {object} db - Database connection
 * @param {string} agentId - Agent ID
 * @param {number} limit - Number of results
 * @returns {Array} Streak history
 */
function getStreakHistory(db, agentId, limit = 10) {
  return db.prepare(`
    SELECT streak_length, xp_earned, completed_at, was_max_streak
    FROM streak_history
    WHERE agent_id = ?
    ORDER BY completed_at DESC
    LIMIT ?
  `).all(agentId, limit);
}

/**
 * Get agent's milestone history
 * @param {object} db - Database connection
 * @param {string} agentId - Agent ID
 * @param {number} limit - Number of results
 * @returns {Array} Milestone history
 */
function getMilestoneHistory(db, agentId, limit = 20) {
  return db.prepare(`
    SELECT milestone_level, milestone_title, xp_earned, achieved_at
    FROM streak_milestones
    WHERE agent_id = ?
    ORDER BY achieved_at DESC
    LIMIT ?
  `).all(agentId, limit);
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Core functions
  getStreakStatus,
  processComment,
  resetStreak,

  // Quality validation
  getRecentComments,
  getOwnBattleRatio,
  calculateQualityScore,

  // Leaderboard/History
  getStreakLeaderboard,
  getStreakHistory,
  getMilestoneHistory,

  // Display
  formatStreakDisplay,
};
