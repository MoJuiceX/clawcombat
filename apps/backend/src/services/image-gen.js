// Image generation service — Replicate FLUX 2 Pro only
// Uses type-specific reference images for img2img generation
// Retries up to 3 times with exponential backoff for reliability

const log = require('../utils/logger').createLogger('IMAGE_GEN');
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.BASE_URL || 'https://clawcombat.com');

const REFERENCE_VERSION = process.env.REFERENCE_VERSION || 'v0';

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_SECONDS = 120;

// Reference image URL for each type (versioned, hosted in /references/{version}/)
// v0 maps to root /references/ for backward compatibility with deployed server
function getReferenceImageUrl(type, version) {
  const typeLower = (type || 'neutral').toLowerCase();
  const v = version || REFERENCE_VERSION;
  if (v === 'v0') {
    return `${BASE_URL}/references/${typeLower}-type-young.webp`;
  }
  return `${BASE_URL}/references/${v}/${typeLower}-type-young.webp`;
}

// Build array of reference images for multi-reference generation
function buildReferenceImages(type, options = {}) {
  const v = options.version || REFERENCE_VERSION;
  const images = [getReferenceImageUrl(type, v)];
  if (options.includeVariant) {
    const variantBase = v === 'v0'
      ? `${BASE_URL}/references/variants/t1`
      : `${BASE_URL}/references/variants/${v}-t1`;
    images.push(`${variantBase}/${type.toLowerCase()}-balanced.webp`);
  }
  return images;
}

// Fetch with timeout + abort controller
function fetchWithTimeout(url, options, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Sleep helper
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Replicate FLUX 2 Pro ──
// Creates a prediction, uses Prefer: wait, falls back to polling

async function callReplicate(prompt, referenceImages, options = {}) {
  if (!REPLICATE_API_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN is not set');
  }

  log.debug('FLUX 2 Pro: references', { references: referenceImages.join(', ') });

  const input = {
    prompt,
    input_images: referenceImages,
    aspect_ratio: options.aspect_ratio || '1:1',
    output_format: options.output_format || 'webp',
    output_quality: options.output_quality || 85,
    safety_tolerance: options.safety_tolerance || 3,
  };
  if (options.seed != null) input.seed = options.seed;
  if (options.resolution) input.resolution = options.resolution;

  // Step 1: Create prediction with Prefer: wait (server holds connection open)
  const createResponse = await fetchWithTimeout('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait',
    },
    body: JSON.stringify({
      version: '285631b5656a1839331cd9af0d82da820e2075db12046d1d061c681b2f206bc6',
      input,
    }),
  }, 120000);

  if (!createResponse.ok) {
    const errText = await createResponse.text();
    const err = new Error(`Replicate HTTP ${createResponse.status}: ${errText.substring(0, 300)}`);
    err.status = createResponse.status;
    // Parse retry_after for 429 rate limits
    try { err.retryAfter = JSON.parse(errText).retry_after; } catch {}
    throw err;
  }

  let prediction = await createResponse.json();

  // Step 2: If Prefer: wait didn't resolve, poll until done
  if (prediction.status !== 'succeeded') {
    const maxAttempts = Math.ceil(MAX_POLL_SECONDS / (POLL_INTERVAL_MS / 1000));

    for (let i = 0; i < maxAttempts; i++) {
      if (prediction.status === 'succeeded') break;
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(`Prediction ${prediction.status}: ${prediction.error || 'unknown'}`);
      }

      await sleep(POLL_INTERVAL_MS);

      const pollResponse = await fetchWithTimeout(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        { headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` } },
        15000
      );

      if (!pollResponse.ok) {
        throw new Error(`Poll HTTP ${pollResponse.status}`);
      }

      prediction = await pollResponse.json();
    }
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(`Timed out after ${MAX_POLL_SECONDS}s, status: ${prediction.status}`);
  }

  // Step 3: Extract image URL from output
  const output = prediction.output;
  if (!output) {
    throw new Error('No output in prediction');
  }

  const imageUrl = typeof output === 'string' ? output : (Array.isArray(output) ? output[0] : null);
  if (!imageUrl) {
    throw new Error(`Unexpected output format: ${JSON.stringify(output).substring(0, 100)}`);
  }

  return imageUrl;
}

// ── Retry wrapper with exponential backoff ──

async function callReplicateWithRetry(prompt, referenceImages, options = {}) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.debug('FLUX 2 Pro attempt', { attempt, maxRetries: MAX_RETRIES });
      const url = await callReplicate(prompt, referenceImages, options);
      log.info('FLUX 2 Pro succeeded', { attempt });
      return url;
    } catch (err) {
      lastError = err;
      log.warn('Avatar generation attempt failed', { attempt, error: err.message });

      if (attempt < MAX_RETRIES) {
        // Use server's retry_after for 429s, otherwise exponential backoff
        const backoffMs = err.retryAfter
          ? (err.retryAfter + 1) * 1000
          : 2000 * Math.pow(2, attempt - 1);
        log.debug('Retrying image generation', { backoffSeconds: backoffMs / 1000 });
        await sleep(backoffMs);
      }
    }
  }

  throw lastError;
}

// ── Public API ──

async function generateFreeAvatar(prompt, type, options = {}) {
  if (!REPLICATE_API_TOKEN) {
    log.error('REPLICATE_API_TOKEN is not set — cannot generate images');
    return { url: null, model: 'none', error: 'REPLICATE_API_TOKEN is not configured. Set it in your environment variables.' };
  }

  try {
    const refs = options.referenceImages || buildReferenceImages(type);
    const url = await callReplicateWithRetry(prompt, refs, options);
    return { url, model: 'flux-2-pro', error: null };
  } catch (err) {
    log.error('All attempts failed for free avatar', { maxRetries: MAX_RETRIES, error: err.message });
    return { url: null, model: 'flux-2-pro', error: `Image generation failed after ${MAX_RETRIES} attempts: ${err.message}` };
  }
}

async function generatePremiumAvatar(prompt, type, options = {}) {
  if (!REPLICATE_API_TOKEN) {
    log.error('REPLICATE_API_TOKEN is not set — cannot generate images');
    return { url: null, model: 'none', error: 'REPLICATE_API_TOKEN is not configured. Set it in your environment variables.' };
  }

  try {
    const refs = options.referenceImages || buildReferenceImages(type, { includeVariant: true });
    const url = await callReplicateWithRetry(prompt, refs, options);
    return { url, model: 'flux-2-pro', error: null };
  } catch (err) {
    log.error('All attempts failed for premium avatar', { maxRetries: MAX_RETRIES, error: err.message });
    return { url: null, model: 'flux-2-pro', error: `Image generation failed after ${MAX_RETRIES} attempts: ${err.message}` };
  }
}

module.exports = { generateFreeAvatar, generatePremiumAvatar, getReferenceImageUrl, buildReferenceImages, REFERENCE_VERSION };
