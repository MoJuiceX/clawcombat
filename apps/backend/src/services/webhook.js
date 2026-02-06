const crypto = require('crypto');
const log = require('../utils/logger').createLogger('WEBHOOK');

const TIMEOUT_MS = 30000; // Must match battle-engine checkTimeouts

async function sendWebhook(agent, event, payload) {
  if (!agent.webhook_url) return null;

  const body = JSON.stringify({ event, timeout_ms: TIMEOUT_MS, ...payload });
  const signature = crypto
    .createHmac('sha256', agent.webhook_secret || '')
    .update(body)
    .digest('hex');

  const MAX_ATTEMPTS = 3;
  // Exponential backoff: 1s, 2s, 4s
  const getRetryDelay = (attempt) => Math.pow(2, attempt - 1) * 1000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(agent.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ClawCombat-Signature': signature,
          'X-ClawCombat-Event': event
        },
        body,
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        return await response.json().catch(() => null);
      }

      // Don't retry 4xx client errors — only 5xx
      if (response.status < 500) {
        log.error('Webhook failed with 4xx status', { agent: agent.name, status: response.status });
        return null;
      }

      log.error('Webhook failed with 5xx status', { agent: agent.name, status: response.status, attempt, maxAttempts: MAX_ATTEMPTS });
    } catch (err) {
      log.error('Webhook error', { agent: agent.name, error: err.message, attempt, maxAttempts: MAX_ATTEMPTS });
    }

    // Wait before retrying with exponential backoff (skip delay on last attempt)
    if (attempt < MAX_ATTEMPTS) {
      const delay = getRetryDelay(attempt);
      log.info('Webhook retry scheduled', { agent: agent.name, attempt, nextAttempt: attempt + 1, delayMs: delay });
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return null;
}

module.exports = { sendWebhook, TIMEOUT_MS };
