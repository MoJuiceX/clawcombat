// Generate a hybrid base by combining all 6 current bases
// Approach 1: Qwen — create a 2x3 composite image, feed as single input
// Approach 2: FLUX — use input_images with 3 bases per call (2 batches)
// Run: node generate-hybrid-base.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const OUTPUT_DIR = path.join(BASE_DIR, 'test-hybrid-base');
const INPUT_DIR = path.join(BASE_DIR, 'bases-qwen-v2');

const BASES = [
  'base-water.webp',    // Crawler
  'base-neutral.webp',  // Cadet
  'base-ice.webp',      // Sentinel
  'base-venom.webp',    // Scout
  'base-earth.webp',    // Peeper
  'base-nature.webp',   // Titan
];

const HYBRID_PROMPT = `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Chibi cybernetic robot lobster, unique new design combining elements from reference images, natural reddish-brown shell color, moderate sized claws, single large expressive eye, long antennae, six crustacean walking legs, smooth segmented armor plates, balanced proportions. Plain smooth gray studio background, soft even lighting.`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fileToDataUri(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const data = fs.readFileSync(filepath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

function fetchWithTimeout(url, options, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Create a 2x3 composite of all 6 bases using sips/ImageMagick
function createComposite() {
  const compositePath = path.join(OUTPUT_DIR, '_composite.webp');

  // Use ImageMagick if available, otherwise sips
  try {
    const files = BASES.map(b => path.join(INPUT_DIR, b)).join(' ');
    execSync(`montage ${files} -tile 3x2 -geometry 512x512+0+0 -background gray ${compositePath}`, { stdio: 'pipe' });
    console.log('  Created composite with ImageMagick');
    return compositePath;
  } catch {
    console.log('  ImageMagick not available, creating composite with canvas...');
  }

  // Fallback: use sharp or just pick one base as reference
  // For simplicity, create a simple side-by-side using sips
  // Actually, let's just use the first base and note it in the output
  console.log('  Falling back to using Crawler as primary Qwen reference');
  return path.join(INPUT_DIR, BASES[0]);
}

async function callQwen(prompt, imageDataUri, options = {}) {
  const input = {
    prompt,
    image: imageDataUri,
    strength: options.strength || 0.65,
    guidance: options.guidance || 4,
    aspect_ratio: '1:1',
    output_format: 'webp',
    output_quality: 90,
    num_inference_steps: 50,
    go_fast: true,
  };
  if (options.seed != null) input.seed = options.seed;

  const createResponse = await fetchWithTimeout('https://api.replicate.com/v1/models/qwen/qwen-image/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait',
    },
    body: JSON.stringify({ input }),
  }, 180000);

  if (!createResponse.ok) {
    const errText = await createResponse.text();
    throw new Error(`Replicate HTTP ${createResponse.status}: ${errText.substring(0, 400)}`);
  }

  let prediction = await createResponse.json();
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts && prediction.status !== 'succeeded'; i++) {
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Prediction ${prediction.status}: ${prediction.error || 'unknown'}`);
    }
    await sleep(2000);
    const pollResponse = await fetchWithTimeout(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` } },
      15000
    );
    if (!pollResponse.ok) throw new Error(`Poll HTTP ${pollResponse.status}`);
    prediction = await pollResponse.json();
  }
  if (prediction.status !== 'succeeded') throw new Error(`Timed out`);
  const output = prediction.output;
  return Array.isArray(output) ? output[0] : output;
}

async function callFlux(prompt, referenceImageDataUris, seed) {
  const input = {
    prompt,
    input_images: referenceImageDataUris,
    aspect_ratio: '1:1',
    output_format: 'webp',
    output_quality: 95,
    safety_tolerance: 3,
  };
  if (seed != null) input.seed = seed;

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
  }, 180000);

  if (!createResponse.ok) {
    const errText = await createResponse.text();
    throw new Error(`Replicate HTTP ${createResponse.status}: ${errText.substring(0, 400)}`);
  }

  let prediction = await createResponse.json();
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
  if (prediction.status !== 'succeeded') throw new Error(`Timed out`);
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
    console.error('REPLICATE_API_TOKEN is not set');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load all 6 base data URIs
  const dataUris = BASES.map(b => fileToDataUri(path.join(INPUT_DIR, b)));

  console.log('=== Generating Hybrid Bases ===\n');

  // --- Approach 1: Qwen with composite image ---
  console.log('--- QWEN APPROACH ---');
  const compositePath = createComposite();
  const compositeUri = fileToDataUri(compositePath);

  for (const { name, seed, strength } of [
    { name: 'hybrid-qwen-a', seed: 77777, strength: 0.65 },
    { name: 'hybrid-qwen-b', seed: 88888, strength: 0.65 },
  ]) {
    const outPath = path.join(OUTPUT_DIR, `${name}.webp`);
    console.log(`\n[Qwen] ${name} (seed=${seed}, str=${strength})`);
    try {
      const url = await callQwen(HYBRID_PROMPT, compositeUri, { seed, strength });
      if (!url) throw new Error('No URL');
      const bytes = await downloadImage(url, outPath);
      console.log(`  SAVED ${name}.webp (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
    }
    await sleep(8000);
  }

  // --- Approach 2: FLUX with multiple references ---
  console.log('\n--- FLUX MULTI-REF APPROACH ---');

  // Split 6 bases into two groups of 3
  const group1 = [dataUris[0], dataUris[1], dataUris[2]]; // Crawler, Cadet, Sentinel
  const group2 = [dataUris[3], dataUris[4], dataUris[5]]; // Scout, Peeper, Titan

  const fluxJobs = [
    { name: 'hybrid-flux-a', refs: group1, seed: 77777, note: 'Crawler+Cadet+Sentinel' },
    { name: 'hybrid-flux-b', refs: group1, seed: 88888, note: 'Crawler+Cadet+Sentinel' },
    { name: 'hybrid-flux-c', refs: group2, seed: 77777, note: 'Scout+Peeper+Titan' },
    { name: 'hybrid-flux-d', refs: group2, seed: 88888, note: 'Scout+Peeper+Titan' },
  ];

  for (const job of fluxJobs) {
    const outPath = path.join(OUTPUT_DIR, `${job.name}.webp`);
    console.log(`\n[FLUX] ${job.name} (${job.note}, seed=${job.seed})`);
    try {
      const url = await callFlux(HYBRID_PROMPT, job.refs, job.seed);
      if (!url) throw new Error('No URL');
      const bytes = await downloadImage(url, outPath);
      console.log(`  SAVED ${job.name}.webp (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
    }
    await sleep(8000);
  }

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
