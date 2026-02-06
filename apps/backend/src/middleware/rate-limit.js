'use strict';

const { getDb } = require('../db/schema');
const log = require('../utils/logger').createLogger('RATE_LIMIT');
const { MS_PER_DAY } = require('../config/constants');

const TRIAL_DAYS = 14;
const TRIAL_FIGHTS_PER_HOUR = 1;   // 1 fight per hour during trial (24/day)
const FREE_FIGHTS_PER_DAY = 6;      // 6 fights per day after trial expires
const PREMIUM_FIGHTS_PER_HOUR = 1;  // 1 fight per hour for premium ($4.99/mo)

/**
 * Check if an agent is within trial period (14 days from first lobster creation)
 */
function isInTrial(agent) {
  if (!agent.trial_start_at) return false;
  const trialStart = new Date(agent.trial_start_at);
  const now = new Date();
  const daysSinceCreation = (now - trialStart) / MS_PER_DAY;
  return daysSinceCreation <= TRIAL_DAYS;
}

/**
 * Check if agent is premium (database flag - for bot API calls)
 */
function isPremium(agent) {
  return agent.is_premium === 1;
}

/**
 * Check if user has Clerk Billing premium plan
 * Uses Clerk's backend SDK to verify subscription
 * @param {string} clerkUserId - The Clerk user ID
 * @returns {Promise<boolean>}
 */
async function checkClerkPremium(clerkUserId) {
  if (!clerkUserId) return false;

  try {
    // Use Clerk backend SDK to check user's subscription
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) return false;

    const { createClerkClient } = require('@clerk/backend');
    const clerk = createClerkClient({ secretKey: clerkSecretKey });

    // Get user and check their plan
    const user = await clerk.users.getUser(clerkUserId);
    if (!user) return false;

    // Check if user has premium plan via Clerk Billing
    // Clerk stores plan info in publicMetadata or via the has() equivalent
    // For now, check publicMetadata.plan or privateMetadata.clerkBillingPlan
    const plan = user.publicMetadata?.plan || user.privateMetadata?.clerkBillingPlan;
    return plan === 'premium';
  } catch (e) {
    log.error('Clerk premium check failed:', { error: e.message });
    return false;
  }
}

/**
 * Get fight limit info for an agent
 * @param {Object} agent - The agent object from database
 * @param {Object} options - Optional settings
 * @param {boolean} options.userIsPremium - If true, treat as premium (for Clerk Billing users)
 * Returns: { allowed, remaining, limit, period, reason, upgradeMessage }
 */
function getFightLimitInfo(agent, options = {}) {
  const db = getDb();
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentHour = now.toISOString().slice(0, 13); // "2026-02-02T14"

  // Reset daily counter if new day
  if (agent.fights_today_date !== todayStr) {
    db.prepare('UPDATE agents SET fights_today = 0, fights_today_date = ? WHERE id = ?')
      .run(todayStr, agent.id);
    agent.fights_today = 0;
    agent.fights_today_date = todayStr;
  }

  // Reset hourly counter if new hour
  if (agent.fights_hour_start !== currentHour) {
    db.prepare('UPDATE agents SET fights_this_hour = 0, fights_hour_start = ? WHERE id = ?')
      .run(currentHour, agent.id);
    agent.fights_this_hour = 0;
    agent.fights_hour_start = currentHour;
  }

  const inTrial = isInTrial(agent);
  // Check both database flag (for bots) and Clerk Billing status (for human users)
  const premium = isPremium(agent) || options.userIsPremium === true;

  if (premium || inTrial) {
    // 1 fight per hour
    const limit = premium ? PREMIUM_FIGHTS_PER_HOUR : TRIAL_FIGHTS_PER_HOUR;
    const remaining = Math.max(0, limit - (agent.fights_this_hour || 0));
    return {
      allowed: remaining > 0,
      remaining,
      limit,
      period: 'hour',
      tier: premium ? 'premium' : 'trial',
      trialDaysLeft: inTrial ? Math.ceil(TRIAL_DAYS - ((now - new Date(agent.trial_start_at)) / MS_PER_DAY)) : 0,
      reason: remaining > 0 ? null : 'Hourly fight limit reached. Try again next hour.',
      upgradeMessage: premium ? null : 'Upgrade to Premium for unlimited hourly fights after your trial ends.',
    };
  }

  // Free tier (post-trial): 4 fights per day
  const remaining = Math.max(0, FREE_FIGHTS_PER_DAY - (agent.fights_today || 0));
  return {
    allowed: remaining,
    remaining,
    limit: FREE_FIGHTS_PER_DAY,
    period: 'day',
    tier: 'free',
    trialDaysLeft: 0,
    reason: remaining > 0 ? null : 'Daily fight limit reached. Upgrade to Premium for 1 fight/hour.',
    upgradeMessage: 'Upgrade to Premium ($4.99/mo) for 1 fight per hour instead of 4 per day.',
  };
}

/**
 * Record a fight (increment counters)
 */
function recordFight(agentId) {
  const db = getDb();
  db.prepare(`
    UPDATE agents SET
      fights_today = COALESCE(fights_today, 0) + 1,
      fights_this_hour = COALESCE(fights_this_hour, 0) + 1
    WHERE id = ?
  `).run(agentId);
}

/**
 * Express middleware: check fight rate limit before allowing battle
 */
function checkFightRateLimit(req, res, next) {
  if (!req.agent) return next(); // No agent context, skip

  const info = getFightLimitInfo(req.agent);
  if (!info.allowed) {
    return res.status(429).json({
      error: info.reason,
      tier: info.tier,
      limit: info.limit,
      period: info.period,
      remaining: 0,
      upgrade: info.upgradeMessage,
    });
  }

  req.fightLimit = info;
  next();
}

module.exports = {
  getFightLimitInfo,
  recordFight,
  checkFightRateLimit,
  checkClerkPremium,
  isInTrial,
  isPremium,
  TRIAL_DAYS,
  TRIAL_FIGHTS_PER_HOUR,
  FREE_FIGHTS_PER_DAY,
  PREMIUM_FIGHTS_PER_HOUR,
};
