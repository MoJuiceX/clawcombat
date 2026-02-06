const log = require('../utils/logger').createLogger('AVATARS');
const express = require('express');
const crypto = require('crypto');
const Stripe = require('stripe');
const { getDb } = require('../db/schema');
const { authenticateAgent } = require('../middleware/auth');
const { authenticateHuman } = require('../middleware/clerk-auth');
const { buildSkinPrompt, hashAgentStats, getTier } = require('../services/skin-generator');
const { generateFreeAvatar, generatePremiumAvatar } = require('../services/image-gen');
const { invalidateAgent } = require('../services/agent-cache');
const { getAgentById } = require('../services/agent-queries');

const router = express.Router();

// ── Stripe setup ──

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const CREDIT_PACKAGES = {
  1: 100,    // $1.00
  5: 450,    // $4.50
  10: 850,   // $8.50
  20: 1500,  // $15.00
};

// ── Credit helpers ──

function getCredits(db, userId) {
  const row = db.prepare('SELECT credits FROM user_credits WHERE user_id = ?').get(userId);
  return row ? row.credits : 0;
}

function ensureCreditRow(db, userId) {
  db.prepare('INSERT OR IGNORE INTO user_credits (user_id, credits, lifetime_credits) VALUES (?, 0, 0)').run(userId);
}

// TRANSACTION: Wrap credit deduction in a transaction for atomicity
// Ensures balance update and transaction log are either both committed or both rolled back
function deductCredit(db, userId, amount, reason, referenceId) {
  const deductTx = db.transaction(() => {
    ensureCreditRow(db, userId);
    const current = getCredits(db, userId);
    if (current < amount) return false;

    db.prepare('UPDATE user_credits SET credits = credits - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(amount, userId);

    db.prepare('INSERT INTO credit_transactions (id, user_id, amount, reason, reference_id) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), userId, -amount, reason, referenceId);

    return true;
  });

  return deductTx();
}

// TRANSACTION: Wrap credit addition in a transaction for atomicity
// Ensures balance update and transaction log are either both committed or both rolled back
function addCredits(db, userId, amount, reason, referenceId) {
  const addTx = db.transaction(() => {
    ensureCreditRow(db, userId);
    db.prepare('UPDATE user_credits SET credits = credits + ?, lifetime_credits = lifetime_credits + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(amount, amount, userId);

    db.prepare('INSERT INTO credit_transactions (id, user_id, amount, reason, reference_id) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), userId, amount, reason, referenceId);
  });

  addTx();
}

// ── Avatar Endpoints ──

// GET /avatars/:agent_id - Get avatar info for an agent
router.get('/:agent_id', (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT id, name, avatar_url, visual_prompt, avatar_tier, avatar_locked, ai_type FROM agents WHERE id = ?')
    .get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  res.json({
    agent_id: agent.id,
    name: agent.name,
    type: agent.ai_type || 'NEUTRAL',
    avatar_url: agent.avatar_url || null,
    avatar_tier: agent.avatar_tier || 'none',
    avatar_locked: !!agent.avatar_locked,
    visual_prompt: agent.visual_prompt || null,
    has_avatar: !!agent.avatar_url,
  });
});

// POST /avatars/:agent_id/generate - Generate avatar (free or premium)
// Requires authentication (agent API key or human Clerk session) and ownership verification
router.post('/:agent_id/generate', authenticateAgent, async (req, res) => {
  try {
    const db = getDb();
    const tier = (req.body.tier || 'free').toLowerCase();
    const agentId = req.params.agent_id;

    // Verify the authenticated agent owns this agent_id
    if (req.agent.id !== agentId) {
      return res.status(403).json({ error: 'You can only generate avatars for your own agent' });
    }

    if (!['free', 'premium'].includes(tier)) {
      return res.status(400).json({ error: 'tier must be "free" or "premium"' });
    }

    const agent = getAgentById(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (agent.avatar_locked) {
      return res.status(409).json({ error: 'Avatar is locked. Unlock it first to regenerate.' });
    }

    // Generate cyberlobster skin prompt from stats
    const prompt = buildSkinPrompt(agent);

    // Premium requires credits (need owner_id to track)
    if (tier === 'premium') {
      const ownerId = agent.owner_id;
      if (!ownerId) {
        return res.status(400).json({ error: 'Agent must have an owner (Clerk user) for premium avatars. Claim the agent first.' });
      }

      const credits = getCredits(db, ownerId);
      if (credits < 1) {
        return res.status(402).json({
          error: 'Not enough credits',
          credits: credits,
          required: 1,
          purchase_url: '/avatars/credits/pricing',
        });
      }
    }

    // Generate image
    let result;
    if (tier === 'free') {
      result = await generateFreeAvatar(prompt, agent.ai_type);
    } else {
      result = await generatePremiumAvatar(prompt, agent.ai_type);
    }

    if (result.error && !result.url) {
      const isKeyMissing = result.error.includes('not configured');
      const friendlyError = isKeyMissing
        ? 'Image generation service not configured. Please try again later.'
        : `Image generation failed (${result.model}). Please try again.`;
      log.error('Generation failed:', { error: result.error, model: result.model });
      return res.status(502).json({
        error: friendlyError,
        detail: result.error,
        model: result.model,
      });
    }

    // Deduct credit for premium
    if (tier === 'premium' && agent.owner_id) {
      deductCredit(db, agent.owner_id, 1, 'premium_avatar', agentId);
    }

    // Save avatar to agent
    db.prepare('UPDATE agents SET avatar_url = ?, visual_prompt = ?, avatar_tier = ? WHERE id = ?')
      .run(result.url, prompt, tier, agentId);

    // Invalidate cache after avatar update
    invalidateAgent(agentId);

    // Log generation
    const genId = crypto.randomUUID();
    db.prepare('INSERT INTO avatar_generations (id, agent_id, user_id, tier, model, prompt, image_url, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(genId, agentId, agent.owner_id || null, tier, result.model, prompt, result.url ? 'stored' : null, tier === 'premium' ? 0.04 : 0);

    res.json({
      status: 'generated',
      agent_id: agentId,
      tier,
      model: result.model,
      avatar_url: result.url,
      visual_prompt: prompt,
      locked: false,
    });
  } catch (err) {
    log.error('Avatar generation error:', { error: err.message, agent_id: req.params.agent_id });
    res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

// POST /avatars/:agent_id/lock - Lock avatar (prevent changes)
// Requires agent authentication and ownership verification
router.post('/:agent_id/lock', authenticateAgent, (req, res) => {
  const db = getDb();
  const agentId = req.params.agent_id;

  // Verify the authenticated agent owns this agent_id
  if (req.agent.id !== agentId) {
    return res.status(403).json({ error: 'You can only lock your own avatar' });
  }

  const agent = db.prepare('SELECT id, avatar_url, avatar_locked FROM agents WHERE id = ?').get(agentId);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  if (!agent.avatar_url) {
    return res.status(400).json({ error: 'No avatar to lock. Generate one first.' });
  }

  if (agent.avatar_locked) {
    return res.status(409).json({ error: 'Avatar is already locked' });
  }

  db.prepare('UPDATE agents SET avatar_locked = 1, avatar_locked_at = CURRENT_TIMESTAMP WHERE id = ?').run(agent.id);

  // Invalidate cache after lock
  invalidateAgent(agent.id);

  res.json({ status: 'locked', agent_id: agent.id });
});

// POST /avatars/:agent_id/unlock - Unlock avatar for regeneration
// Requires agent authentication and ownership verification
router.post('/:agent_id/unlock', authenticateAgent, (req, res) => {
  const db = getDb();
  const agentId = req.params.agent_id;

  // Verify the authenticated agent owns this agent_id
  if (req.agent.id !== agentId) {
    return res.status(403).json({ error: 'You can only unlock your own avatar' });
  }

  const agent = db.prepare('SELECT id, avatar_locked FROM agents WHERE id = ?').get(agentId);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  if (!agent.avatar_locked) {
    return res.status(409).json({ error: 'Avatar is not locked' });
  }

  db.prepare('UPDATE agents SET avatar_locked = 0 WHERE id = ?').run(agent.id);

  // Invalidate cache after unlock
  invalidateAgent(agent.id);

  res.json({ status: 'unlocked', agent_id: agent.id });
});

// GET /avatars/:agent_id/prompt - Get/preview the visual prompt without generating
router.get('/:agent_id/prompt', (req, res) => {
  const agent = getAgentById(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const prompt = buildSkinPrompt(agent);

  res.json({
    agent_id: agent.id,
    name: agent.name,
    visual_prompt: prompt,
  });
});

// ── Credit Endpoints ──

// GET /avatars/credits/pricing - Show credit packages
router.get('/credits/pricing', (req, res) => {
  res.json({
    packages: [
      { credits: 1, price_usd: 1.00, discount: null },
      { credits: 5, price_usd: 4.50, discount: '10%' },
      { credits: 10, price_usd: 8.50, discount: '15%' },
      { credits: 20, price_usd: 15.00, discount: '25%' },
    ],
    note: '1 credit = 1 premium avatar (DALL-E 3, high quality)',
  });
});

// GET /avatars/credits/balance - Check credit balance (requires Clerk auth)
router.get('/credits/balance', authenticateHuman, (req, res) => {
  const db = getDb();
  const userId = req.human.id;
  ensureCreditRow(db, userId);

  const row = db.prepare('SELECT * FROM user_credits WHERE user_id = ?').get(userId);
  const recent = db.prepare('SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(userId);

  res.json({
    user_id: userId,
    credits: row.credits,
    lifetime_credits: row.lifetime_credits,
    recent_transactions: recent.map(t => ({
      amount: t.amount,
      reason: t.reason,
      reference_id: t.reference_id,
      created_at: t.created_at,
    })),
  });
});

// POST /avatars/credits/add - Add credits (admin or payment callback)
// In production, this would be called by Stripe webhook after payment
router.post('/credits/add', authenticateHuman, (req, res) => {
  const db = getDb();
  const userId = req.human.id;
  const { amount, payment_id } = req.body;

  if (!amount || amount < 1 || amount > 100) {
    return res.status(400).json({ error: 'amount must be between 1 and 100' });
  }

  addCredits(db, userId, amount, 'purchase', payment_id || 'manual');

  const balance = getCredits(db, userId);

  res.json({
    status: 'credits_added',
    amount,
    new_balance: balance,
  });
});

// POST /avatars/credits/admin-grant - Admin grant credits
const { requireAdmin } = require('../middleware/admin-auth');
router.post('/credits/admin-grant', requireAdmin, (req, res) => {

  const db = getDb();
  const { user_id, amount } = req.body;

  if (!user_id || !amount) {
    return res.status(400).json({ error: 'user_id and amount required' });
  }

  addCredits(db, user_id, amount, 'admin_grant', 'admin');

  res.json({
    status: 'granted',
    user_id,
    amount,
    new_balance: getCredits(db, user_id),
  });
});

// ── Stripe Checkout ──

// POST /avatars/credits/checkout - Create Stripe Checkout Session
router.post('/credits/checkout', authenticateHuman, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Payments not configured' });
    }

    const credits = Number(req.body.package);
    const priceInCents = CREDIT_PACKAGES[credits];

    if (!priceInCents) {
      return res.status(400).json({
        error: 'Invalid package. Choose 1, 5, 10, or 20 credits.',
        valid_packages: Object.keys(CREDIT_PACKAGES).map(Number),
      });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `ClawCombat ${credits} Credit${credits > 1 ? 's' : ''}`,
              description: `${credits} premium avatar generation credit${credits > 1 ? 's' : ''}`,
            },
            unit_amount: priceInCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: req.human.id,
        credits: String(credits),
      },
      success_url: `${process.env.WEB_URL || 'https://clawcombat.com'}/portfolio?credits=success`,
      cancel_url: `${process.env.WEB_URL || 'https://clawcombat.com'}/portfolio?credits=cancel`,
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    log.error('Stripe checkout error:', { error: err.message });
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe webhook handler (exported separately for raw body mounting in index.js)
async function stripeWebhookHandler(req, res) {
  if (!stripe) {
    return res.status(503).json({ error: 'Payments not configured' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    log.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    log.error('Stripe webhook signature verification failed:', { error: err.message });
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata.user_id;
    const credits = parseInt(session.metadata.credits, 10);

    if (userId && credits > 0) {
      try {
        const db = getDb();
        addCredits(db, userId, credits, 'stripe_purchase', session.id);
        log.info('Stripe credits added', { credits, userId, session: session.id });
      } catch (err) {
        log.error('Failed to add credits from Stripe webhook:', { error: err.message });
        return res.status(500).json({ error: 'Credit fulfillment failed' });
      }
    }
  }

  res.json({ received: true });
}

module.exports = router;
module.exports.stripeWebhookHandler = stripeWebhookHandler;
