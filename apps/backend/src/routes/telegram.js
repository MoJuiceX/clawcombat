/**
 * ClawCombat Telegram Bot Routes
 *
 * POST /telegram/webhook  — Receive Telegram updates
 * POST /telegram/setup    — Set webhook URL (admin only)
 * POST /telegram/teardown — Remove webhook (admin only)
 */

const log = require('../utils/logger').createLogger('TELEGRAM');
const express = require('express');
const crypto = require('crypto');
const { processUpdate, setWebhook, deleteWebhook } = require('../services/telegram-bot');
const { requireAdmin } = require('../middleware/admin-auth');

const router = express.Router();

// POST /telegram/webhook — Telegram sends updates here
router.post('/webhook', async (req, res) => {
  try {
    // Verify Telegram webhook secret if configured
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (webhookSecret) {
      const token = req.headers['x-telegram-bot-api-secret-token'];
      if (token !== webhookSecret) {
        return res.status(403).json({ ok: false });
      }
    }

    // Basic structure validation - ignore unrecognized update types
    const update = req.body;
    if (!update || typeof update !== 'object' || (!update.message && !update.callback_query && !update.edited_message)) {
      return res.json({ ok: true }); // Acknowledge but ignore
    }

    // Don't await — respond immediately to Telegram
    processUpdate(update).catch(e => log.error('Webhook handler error:', { error: e.message }));
    res.json({ ok: true });
  } catch (e) {
    log.error('Webhook error:', { error: e.message });
    res.json({ ok: true }); // Always 200 to Telegram
  }
});

// POST /telegram/setup — Register webhook with Telegram (admin only)
router.post('/setup', requireAdmin, async (req, res) => {
  try {
    const baseUrl = process.env.WEB_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'clawcombat.com'}`;
    const webhookUrl = req.body.webhook_url || `${baseUrl}/telegram/webhook`;

    await setWebhook(webhookUrl);
    res.json({ status: 'webhook_set', url: webhookUrl });
  } catch (e) {
    log.error('Setup error:', { error: e.message });
    res.status(500).json({ error: 'Failed to set webhook' });
  }
});

// POST /telegram/teardown — Remove webhook (admin only)
router.post('/teardown', requireAdmin, async (req, res) => {
  try {
    await deleteWebhook();
    res.json({ status: 'webhook_removed' });
  } catch (e) {
    log.error('Teardown error:', { error: e.message });
    res.status(500).json({ error: 'Failed to remove webhook' });
  }
});

module.exports = router;
