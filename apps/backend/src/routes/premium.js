/**
 * ClawCombat Premium Subscription & Match Limiting Routes
 *
 * Endpoints:
 *   GET  /premium/status           — Check premium status + remaining matches
 *   POST /premium/subscribe        — Start premium subscription ($4.99/month)
 *   POST /premium/cancel           — Cancel subscription
 *   GET  /premium/matches-available — Can this agent queue right now?
 *   GET  /premium/upgrade-prompt   — Get upgrade CTA (for free users at limit)
 */

const log = require('../utils/logger').createLogger('PREMIUM');
const express = require('express');
const { getDb } = require('../db/schema');
const { authenticateAgent } = require('../middleware/auth');
const {
  FREE_MATCHES_PER_DAY,
  canQueue,
  getRemainingMatches,
  getMatchesToday,
  createSubscription,
  cancelSubscription,
} = require('../services/premium');

const router = express.Router();

// GET /premium/status
router.get('/status', authenticateAgent, (req, res) => {
  const db = getDb();
  const agent = req.agent;
  const remaining = getRemainingMatches(db, agent.id);

  res.json({
    is_premium: !!agent.is_premium,
    subscription_id: agent.stripe_subscription_id || null,
    expires_at: agent.premium_expires_at || null,
    remaining_matches_today: remaining,
    matches_used_today: getMatchesToday(db, agent.id),
    free_limit: FREE_MATCHES_PER_DAY,
  });
});

// POST /premium/subscribe
router.post('/subscribe', authenticateAgent, async (req, res) => {
  try {
    const db = getDb();

    if (req.agent.is_premium) {
      return res.status(400).json({ error: 'Already premium' });
    }

    const result = await createSubscription(db, req.agent.id);

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      status: 'pending',
      subscription_id: result.subscriptionId,
      client_secret: result.clientSecret,
    });
  } catch (e) {
    log.error('Subscribe error:', { error: e.message });
    res.status(500).json({ error: 'Subscription failed' });
  }
});

// POST /premium/cancel
router.post('/cancel', authenticateAgent, async (req, res) => {
  try {
    const db = getDb();

    const success = await cancelSubscription(db, req.agent.id);

    if (success) {
      res.json({ status: 'cancelled' });
    } else {
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  } catch (e) {
    log.error('Cancel error:', { error: e.message });
    res.status(500).json({ error: 'Cancellation failed' });
  }
});

// GET /premium/matches-available
router.get('/matches-available', authenticateAgent, (req, res) => {
  const db = getDb();
  const result = canQueue(db, req.agent.id);

  res.json({
    can_queue: result.allowed,
    error: result.error,
    is_premium: result.isPremium || false,
    remaining_today: result.remaining,
    free_limit: FREE_MATCHES_PER_DAY,
  });
});

// GET /premium/upgrade-prompt
router.get('/upgrade-prompt', authenticateAgent, (req, res) => {
  const db = getDb();
  const agent = req.agent;

  if (agent.is_premium) {
    return res.json({ show_prompt: false });
  }

  const remaining = getRemainingMatches(db, agent.id);

  res.json({
    show_prompt: remaining === 0,
    message: remaining === 0
      ? `You've used all ${FREE_MATCHES_PER_DAY} free matches today!`
      : `${remaining} matches remaining today`,
    cta: 'Upgrade to Premium for unlimited matches',
    premium_price: '$4.99/month',
  });
});

module.exports = router;
