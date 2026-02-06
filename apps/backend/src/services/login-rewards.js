'use strict';

/**
 * Login Streak Rewards System
 *
 * Awards XP for daily logins with escalating rewards:
 * - Day 1: 25 XP
 * - Day 2: 40 XP
 * - Day 3: 50 XP
 * - Day 4: 65 XP
 * - Day 5: 75 XP
 * - Day 6: 90 XP
 * - Day 7: 350 XP (100 + 250 bonus)
 *
 * Streak resets if a day is missed.
 * After day 7, cycle restarts at day 1.
 */

const crypto = require('crypto');
const {
  LOGIN_STREAK_REWARDS,
  LOGIN_STREAK_CYCLE_DAYS,
  getLoginStreakReward
} = require('../config/battle-xp-config');

/**
 * Check and process daily login reward for an agent
 *
 * @param {object} db - better-sqlite3 database
 * @param {string} agentId - Agent ID
 * @returns {{ awarded: boolean, xp: number, streakDay: number, newStreak: number, message: string } | null}
 */
function processLoginReward(db, agentId) {
  const agent = db.prepare(`
    SELECT id, xp, level, login_streak, last_login_date, login_reward_claimed_date
    FROM agents WHERE id = ?
  `).get(agentId);

  if (!agent) return null;

  const today = new Date().toISOString().split('T')[0];

  // Already claimed today?
  if (agent.login_reward_claimed_date === today) {
    return {
      awarded: false,
      xp: 0,
      streakDay: agent.login_streak || 1,
      newStreak: agent.login_streak || 1,
      message: 'Already claimed today'
    };
  }

  // Calculate streak
  const yesterday = getYesterday();
  let newStreak;

  if (agent.last_login_date === yesterday) {
    // Consecutive day - increment streak
    newStreak = ((agent.login_streak || 0) % LOGIN_STREAK_CYCLE_DAYS) + 1;
  } else if (agent.last_login_date === today) {
    // Same day login (shouldn't happen if claimed check passed, but handle it)
    newStreak = agent.login_streak || 1;
  } else {
    // Streak broken or first login - start at day 1
    newStreak = 1;
  }

  // Calculate XP reward
  const xpReward = getLoginStreakReward(newStreak);

  // Update agent
  const newXP = (agent.xp || 0) + xpReward;
  db.prepare(`
    UPDATE agents
    SET xp = ?, login_streak = ?, last_login_date = ?, login_reward_claimed_date = ?
    WHERE id = ?
  `).run(newXP, newStreak, today, today, agentId);

  // Log XP award
  const reason = newStreak === 7
    ? `Day ${newStreak} login streak (weekly bonus!)`
    : `Day ${newStreak} login streak`;

  db.prepare(`
    INSERT INTO xp_logs (id, agent_id, action, xp_earned, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), agentId, 'login_streak', xpReward, reason);

  return {
    awarded: true,
    xp: xpReward,
    streakDay: newStreak,
    newStreak,
    message: newStreak === 7
      ? `Day 7 bonus! +${xpReward} XP`
      : `Day ${newStreak} streak! +${xpReward} XP`
  };
}

/**
 * Get login streak status for an agent (without claiming)
 *
 * @param {object} db - better-sqlite3 database
 * @param {string} agentId - Agent ID
 * @returns {{ currentStreak: number, canClaim: boolean, nextReward: number, streakWillReset: boolean }}
 */
function getLoginStreakStatus(db, agentId) {
  const agent = db.prepare(`
    SELECT login_streak, last_login_date, login_reward_claimed_date
    FROM agents WHERE id = ?
  `).get(agentId);

  if (!agent) {
    return {
      currentStreak: 0,
      canClaim: true,
      nextReward: LOGIN_STREAK_REWARDS[1],
      streakWillReset: false
    };
  }

  const today = new Date().toISOString().split('T')[0];
  const yesterday = getYesterday();
  const canClaim = agent.login_reward_claimed_date !== today;

  // Determine what the streak will be if claimed today
  let projectedStreak;
  let streakWillReset = false;

  if (agent.last_login_date === yesterday) {
    projectedStreak = ((agent.login_streak || 0) % LOGIN_STREAK_CYCLE_DAYS) + 1;
  } else if (agent.last_login_date === today) {
    projectedStreak = agent.login_streak || 1;
  } else {
    projectedStreak = 1;
    streakWillReset = (agent.login_streak || 0) > 1;
  }

  return {
    currentStreak: agent.login_streak || 0,
    canClaim,
    nextReward: getLoginStreakReward(projectedStreak),
    streakWillReset,
    projectedStreak
  };
}

/**
 * Get all login streak rewards for display
 *
 * @returns {Array<{ day: number, xp: number, isBonus: boolean }>}
 */
function getAllLoginRewards() {
  return Object.entries(LOGIN_STREAK_REWARDS).map(([day, xp]) => ({
    day: parseInt(day, 10),
    xp,
    isBonus: parseInt(day, 10) === 7
  }));
}

/**
 * Get yesterday's date string
 */
function getYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

module.exports = {
  processLoginReward,
  getLoginStreakStatus,
  getAllLoginRewards
};
