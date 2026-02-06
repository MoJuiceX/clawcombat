// Generate 12 neutral base LOPSERs using FLUX 2 Pro
// Each uses a different reference image but identical prompt + seed
// Output: references/bases-neutral/
//
// Run: node generate-neutral-bases.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.BASE_URL || 'https://clawcombat.com');

const SEED = 77777;
const OUTPUT_DIR = path.join(__dirname, 'src', 'public', 'references', 'bases-neutral');

// The one universal prompt — identical for all 12
const NEUTRAL_PROMPT = `Chibi cybernetic robot lobster, natural reddish-brown shell color, standard mechanical claws, 6 walking legs, small dark glossy black eyes, antennae, segmented armored tail. Neutral base form, balanced proportions. Plain smooth gray studio background, soft even lighting, no environment. 3D digital art, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.`;

// 11 reference sources (Martial cut): 8 existing type bases + 3 custom uploads
// Earth + Venom use originals directly (pre-copied), FLUX will skip them
const BASES = [
  { name: 'base-neutral',  ref: `${BASE_URL}/references/neutral-type-young.webp` },
  { name: 'base-fire',     ref: `${BASE_URL}/references/fire-type-young.webp` },
  { name: 'base-water',    ref: `${BASE_URL}/references/water-type-young.webp` },
  { name: 'base-grass',    ref: `${BASE_URL}/references/grass-type-young.webp` },
  { name: 'base-ice',      ref: `${BASE_URL}/references/ice-type-young.webp` },
  { name: 'base-venom',    ref: `${BASE_URL}/references/venom-type-young.webp` },
  { name: 'base-earth',    ref: `${BASE_URL}/references/earth-type-young.webp` },
  { name: 'base-metal',    ref: `${BASE_URL}/references/metal-type-young.webp` },
  // 3 custom uploads — sent as base64 data URIs since they're not deployed
  { name: 'base-mean',    localFile: path.join(__dirname, 'src', 'public', 'references', 'new-bases', 'mean-lopster.png') },
  { name: 'base-bulky',   localFile: path.join(__dirname, 'src', 'public', 'references', 'new-bases', 'bulky-lobster.jpg') },
  { name: 'base-nature',  localFile: path.join(__dirname, 'src', 'public', 'references', 'new-bases', 'nature-lobster.jpg') },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fileToDataUri(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const data = fs.readFileSync(filepath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

function fetchWithTimeout(url, options, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function callReplicate(prompt, referenceImages, options = {}) {
  const input = {
    prompt,
    input_images: referenceImages,
    aspect_ratio: '1:1',
    output_format: 'webp',
    output_quality: 95,
    safety_tolerance: 3,
  };
  if (options.seed != null) input.seed = options.seed;

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
    try { err.retryAfter = JSON.parse(errText).retry_after; } catch {}
    throw err;
  }

  let prediction = await createResponse.json();

  // Poll if not done
  const maxAttempts = 80;
  for (let i = 0; i < maxAttempts && prediction.status !== 'succeeded'; i++) {
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Prediction ${prediction.status}: ${prediction.error || 'unknown'}`);
    }
    await sleep(1500);
    const pollResponse = await fetchWithTimeout(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` } },
      15000
    );
    if (!pollResponse.ok) throw new Error(`Poll HTTP ${pollResponse.status}`);
    prediction = await pollResponse.json();
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(`Timed out, status: ${prediction.status}`);
  }

  const output = prediction.output;
  return typeof output === 'string' ? output : (Array.isArray(output) ? output[0] : null);
}

async function downloadImage(url, filepath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filepath, buffer);
  return buffer.length;
}

async function main() {
  if (!REPLICATE_API_TOKEN) {
    console.error('REPLICATE_API_TOKEN is not set in .env');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const total = BASES.length;
  let completed = 0;
  let failed = 0;
  const failures = [];

  console.log(`=== Generating ${total} Neutral Base LOPSERs ===`);
  console.log(`Seed: ${SEED}`);
  console.log(`Prompt (${NEUTRAL_PROMPT.split(/\s+/).length} words): ${NEUTRAL_PROMPT}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Estimated cost: ~$${(total * 0.05).toFixed(2)}`);
  console.log('');

  for (const base of BASES) {
    completed++;
    const filename = `${base.name}.webp`;
    const filepath = path.join(OUTPUT_DIR, filename);

    // Skip if exists
    if (fs.existsSync(filepath)) {
      console.log(`[${completed}/${total}] SKIP ${filename} (already exists)`);
      continue;
    }

    // Build reference image (URL or base64 data URI)
    let refImage;
    if (base.ref) {
      refImage = base.ref;
      console.log(`[${completed}/${total}] ${base.name} — ref: ${base.ref}`);
    } else {
      refImage = fileToDataUri(base.localFile);
      console.log(`[${completed}/${total}] ${base.name} — ref: ${path.basename(base.localFile)} (base64, ${(refImage.length / 1024).toFixed(0)} KB)`);
    }

    try {
      const imageUrl = await callReplicate(NEUTRAL_PROMPT, [refImage], { seed: SEED });
      if (!imageUrl) throw new Error('No URL returned');

      const bytes = await downloadImage(imageUrl, filepath);
      console.log(`  ✓ SAVED ${filename} (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failed++;
      failures.push({ name: base.name, error: err.message });
      console.error(`  ✗ FAILED: ${err.message}`);
    }

    // Rate limit between requests
    if (completed < total) {
      console.log('  Waiting 10s...');
      await sleep(10000);
    }
  }

  console.log('\n=== Done ===');
  console.log(`Success: ${total - failed}/${total}`);
  if (failures.length > 0) {
    console.log(`\nFailed (${failures.length}):`);
    for (const f of failures) console.log(`  ${f.name}: ${f.error}`);
    console.log('\nRe-run to retry (existing files are skipped).');
  }

  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.webp'));
  console.log(`\nFiles in output: ${files.length}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
