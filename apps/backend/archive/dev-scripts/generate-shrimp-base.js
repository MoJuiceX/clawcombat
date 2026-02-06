// Generate a new "shrimp-like" base variant using Qwen img2img
// Starting from Crawler (cleanest base) at various strengths
// Goal: curved elongated body, small tucked claws, unique silhouette
// Run: node generate-shrimp-base.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const OUTPUT_DIR = path.join(BASE_DIR, 'test-shrimp-base');

// Use Crawler as starting point (cleanest, most flexible base)
const INPUT_FILE = path.join(BASE_DIR, 'bases-qwen-v2', 'base-water.webp');

// Shrimp-like prompt: curved body, small claws, streamlined, unique silhouette
const SHRIMP_PROMPT = `Chibi cybernetic robot shrimp-lobster hybrid, curved arched elongated body, prominent segmented tail curving upward, small compact tucked claws close to body, streamlined aerodynamic head with single large round eye, long thin antennae, six small walking legs underneath, smooth lightweight shell plates. Natural reddish-brown shell color. Plain smooth gray studio background, soft even lighting. 3D digital art, cyberpunk gaming aesthetic, Ultra HD, sharp detail.`;

// Try 4 variations with different strengths
const VARIATIONS = [
  { name: 'shrimp-s055', strength: 0.55, guidance: 3 },
  { name: 'shrimp-s060', strength: 0.60, guidance: 3 },
  { name: 'shrimp-s065', strength: 0.65, guidance: 4 },
  { name: 'shrimp-s070', strength: 0.70, guidance: 4 },
];

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

async function callQwen(prompt, imageDataUri, options = {}) {
  const input = {
    prompt,
    image: imageDataUri,
    strength: options.strength || 0.6,
    guidance: options.guidance || 3,
    aspect_ratio: '1:1',
    output_format: 'webp',
    output_quality: 90,
    num_inference_steps: 50,
    go_fast: false,
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
    const err = new Error(`Replicate HTTP ${createResponse.status}: ${errText.substring(0, 400)}`);
    err.status = createResponse.status;
    throw err;
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

  if (prediction.status !== 'succeeded') {
    throw new Error(`Timed out, status: ${prediction.status}`);
  }

  const output = prediction.output;
  if (!output) throw new Error('No output');
  return Array.isArray(output) ? output[0] : output;
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

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Input file missing: ${INPUT_FILE}`);
    process.exit(1);
  }

  const dataUri = fileToDataUri(INPUT_FILE);

  console.log(`=== Generating Shrimp Base Variants ===`);
  console.log(`Input: base-water.webp (Crawler)`);
  console.log(`Prompt (${SHRIMP_PROMPT.split(/\s+/).length} words)`);
  console.log(`Seed: ${SEED} | Steps: 50 | go_fast: false`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('');

  for (let i = 0; i < VARIATIONS.length; i++) {
    const v = VARIATIONS[i];
    const outFile = `${v.name}.webp`;
    const outPath = path.join(OUTPUT_DIR, outFile);

    console.log(`[${i + 1}/${VARIATIONS.length}] ${v.name} (str=${v.strength}, guide=${v.guidance})`);

    try {
      const imageUrl = await callQwen(SHRIMP_PROMPT, dataUri, {
        seed: SEED,
        strength: v.strength,
        guidance: v.guidance,
      });
      if (!imageUrl) throw new Error('No URL returned');

      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`  SAVED ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
    }

    if (i < VARIATIONS.length - 1) await sleep(8000);
  }

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
