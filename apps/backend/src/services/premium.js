/**
 * ClawCombat Premium & Match Limiting Service
 *
 * Handles:
 * - Stripe subscription management ($4.99/month)
 * - Daily match limits (5/day free, unlimited premium)
 * - Daily counter reset at midnight UTC
 */

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
const log = require('../utils/logger').createLogger('PREMIUM');
const { PREMIUM_PERIOD_MS } = require('../config/constants');

const FREE_MATCHES_PER_DAY = 6;  // 6 fights/day for free tier (after 14-day trial)
const PREMIUM_PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID || '';

// ---------------------------------------------------------------------------
// Match Limiting
// ---------------------------------------------------------------------------

function getMatchesToday(db, agentId) {
  const agent = db.prepare('SELECT fights_today, fights_today_date FROM agents WHERE id = ?').get(agentId);
  if (!agent) return 0;

  const today = new Date().toISOString().slice(0, 10);
  if (agent.fights_today_date !== today) {
    // Auto-reset if date changed
    db.prepare('UPDATE agents SET fights_today = 0, fights_today_date = ? WHERE id = ?').run(today, agentId);
    return 0;
  }
  return agent.fights_today || 0;
}

function incrementMatchCount(db, agentId) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    UPDATE agents SET
      fights_today = CASE WHEN fights_today_date = ? THEN fights_today + 1 ELSE 1 END,
      fights_today_date = ?
    WHERE id = ?
  `).run(today, today, agentId);
}

function canQueue(db, agentId) {
  const agent = db.prepare('SELECT is_premium, premium_expires_at, fights_today, fights_today_date FROM agents WHERE id = ?').get(agentId);
  if (!agent) return { allowed: false, error: 'Agent not found' };

  // Check premium expiry
  if (agent.is_premium) {
    if (agent.premium_expires_at && new Date(agent.premium_expires_at) < new Date()) {
      // Premium expired — downgrade
      db.prepare('UPDATE agents SET is_premium = 0 WHERE id = ?').run(agentId);
    } else {
      return { allowed: true, error: null, isPremium: true, remaining: null };
    }
  }

  // Free user — check daily limit
  const matchesToday = getMatchesToday(db, agentId);
  if (matchesToday >= FREE_MATCHES_PER_DAY) {
    return {
      allowed: false,
      error: `You've reached your daily match limit (${FREE_MATCHES_PER_DAY}/day). Upgrade to premium for unlimited matches!`,
      isPremium: false,
      remaining: 0,
    };
  }

  return {
    allowed: true,
    error: null,
    isPremium: false,
    remaining: FREE_MATCHES_PER_DAY - matchesToday,
  };
}

function getRemainingMatches(db, agentId) {
  const agent = db.prepare('SELECT is_premium FROM agents WHERE id = ?').get(agentId);
  if (!agent) return 0;
  if (agent.is_premium) return null; // unlimited
  const matchesToday = getMatchesToday(db, agentId);
  return Math.max(0, FREE_MATCHES_PER_DAY - matchesToday);
}

// ---------------------------------------------------------------------------
// Stripe Integration
// ---------------------------------------------------------------------------

async function createStripeCustomer(agentId, agentName) {
  if (!stripe) return null;
  try {
    const customer = await stripe.customers.create({
      name: agentName,
      metadata: { agent_id: agentId },
    });
    return customer.id;
  } catch (e) {
    log.error('Stripe customer creation failed:', { error: e.message });
    return null;
  }
}

async function createSubscription(db, agentId) {
  if (!stripe || !PREMIUM_PRICE_ID) {
    return { error: 'Stripe not configured' };
  }

  const agent = db.prepare('SELECT id, name, stripe_customer_id FROM agents WHERE id = ?').get(agentId);
  if (!agent) return { error: 'Agent not found' };

  let customerId = agent.stripe_customer_id;
  if (!customerId) {
    customerId = await createStripeCustomer(agentId, agent.name);
    if (!customerId) return { error: 'Failed to create Stripe customer' };
    db.prepare('UPDATE agents SET stripe_customer_id = ? WHERE id = ?').run(customerId, agentId);
  }

  try {
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: PREMIUM_PRICE_ID }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    const now = new Date();
    const expires = new Date(now.getTime() + PREMIUM_PERIOD_MS);

    db.prepare(`
      UPDATE agents SET
        stripe_subscription_id = ?,
        is_premium = 1,
        premium_started_at = ?,
        premium_expires_at = ?
      WHERE id = ?
    `).run(subscription.id, now.toISOString(), expires.toISOString(), agentId);

    return {
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
    };
  } catch (e) {
    log.error('Subscription creation failed:', { error: e.message });
    return { error: 'Failed to create subscription' };
  }
}

async function cancelSubscription(db, agentId) {
  const agent = db.prepare('SELECT stripe_subscription_id FROM agents WHERE id = ?').get(agentId);
  if (!agent || !agent.stripe_subscription_id) return false;

  try {
    if (stripe) {
      await stripe.subscriptions.cancel(agent.stripe_subscription_id);
    }
    db.prepare(`
      UPDATE agents SET
        is_premium = 0,
        stripe_subscription_id = NULL,
        premium_expires_at = NULL
      WHERE id = ?
    `).run(agentId);
    return true;
  } catch (e) {
    log.error('Cancellation failed:', { error: e.message });
    return false;
  }
}

function handleStripeWebhook(db, event) {
  if (event.type === 'customer.subscription.deleted') {
    const subscriptionId = event.data.object.id;
    const agent = db.prepare('SELECT id FROM agents WHERE stripe_subscription_id = ?').get(subscriptionId);
    if (agent) {
      db.prepare('UPDATE agents SET is_premium = 0, premium_expires_at = NULL WHERE id = ?').run(agent.id);
      log.info('Subscription cancelled', { agentId: agent.id });
    }
  } else if (event.type === 'invoice.payment_succeeded') {
    const subscriptionId = event.data.object.subscription;
    if (subscriptionId) {
      const agent = db.prepare('SELECT id FROM agents WHERE stripe_subscription_id = ?').get(subscriptionId);
      if (agent) {
        const expires = new Date(Date.now() + PREMIUM_PERIOD_MS);
        db.prepare('UPDATE agents SET premium_expires_at = ? WHERE id = ?').run(expires.toISOString(), agent.id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Daily reset (called by cron)
// ---------------------------------------------------------------------------

function resetDailyMatchCounters(db) {
  const today = new Date().toISOString().slice(0, 10);
  const result = db.prepare(`
    UPDATE agents SET fights_today = 0, fights_today_date = ?
    WHERE fights_today_date IS NOT NULL AND fights_today_date != ?
  `).run(today, today);
  if (result.changes > 0) {
    log.info('Reset daily match counters', { count: result.changes });
  }
}

module.exports = {
  FREE_MATCHES_PER_DAY,
  canQueue,
  getRemainingMatches,
  incrementMatchCount,
  getMatchesToday,
  createSubscription,
  cancelSubscription,
  handleStripeWebhook,
  resetDailyMatchCounters,
};
