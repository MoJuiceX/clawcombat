// Generate shrimp-like base using FLUX 2 Pro (reference mode)
// Starting from Crawler as reference
// Run: node generate-shrimp-base-flux.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const OUTPUT_DIR = path.join(BASE_DIR, 'test-shrimp-base');
const INPUT_FILE = path.join(BASE_DIR, 'bases-qwen-v2', 'base-water.webp');

// 4 prompt variations for shrimp-like body
const VARIANTS = [
  {
    name: 'shrimp-a',
    seed: 77777,
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Chibi cybernetic robot shrimp creature, curved arched elongated body, prominent upward-curving segmented tail, small compact tucked claws close to body, streamlined narrow head with single large round eye, long thin antennae, six small walking legs underneath, smooth lightweight reddish-brown shell plates. Plain gray studio background.`,
  },
  {
    name: 'shrimp-b',
    seed: 88888,
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Chibi cybernetic robot shrimp creature, curved arched elongated body, prominent upward-curving segmented tail, small compact tucked claws close to body, streamlined narrow head with single large round eye, long thin antennae, six small walking legs underneath, smooth lightweight reddish-brown shell plates. Plain gray studio background.`,
  },
  {
    name: 'shrimp-c',
    seed: 77777,
    // More lobster DNA, less extreme shrimp
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Chibi cybernetic robot lobster with elongated curved body shape, arched segmented tail sweeping upward, small delicate claws, narrow streamlined head, single large expressive eye, long antennae, six thin crustacean walking legs, lightweight smooth reddish-brown armor plates. Plain gray studio background.`,
  },
  {
    name: 'shrimp-d',
    seed: 88888,
    // More lobster DNA, less extreme shrimp
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Chibi cybernetic robot lobster with elongated curved body shape, arched segmented tail sweeping upward, small delicate claws, narrow streamlined head, single large expressive eye, long antennae, six thin crustacean walking legs, lightweight smooth reddish-brown armor plates. Plain gray studio background.`,
  },
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

async function callFlux(prompt, referenceImageDataUri, seed) {
  const input = {
    prompt,
    input_images: [referenceImageDataUri],
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
    console.error('REPLICATE_API_TOKEN is not set in .env');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const dataUri = fileToDataUri(INPUT_FILE);

  console.log(`=== Generating Shrimp Bases via FLUX 2 Pro ===`);
  console.log(`Reference: Crawler (base-water.webp)`);
  console.log(`Output: test-shrimp-base/`);
  console.log('');

  for (let i = 0; i < VARIANTS.length; i++) {
    const v = VARIANTS[i];
    const outFile = `${v.name}.webp`;
    const outPath = path.join(OUTPUT_DIR, outFile);

    console.log(`[${i + 1}/${VARIANTS.length}] ${v.name} (seed=${v.seed})`);
    console.log(`  Prompt: ${v.prompt.substring(0, 80)}...`);

    try {
      const imageUrl = await callFlux(v.prompt, dataUri, v.seed);
      if (!imageUrl) throw new Error('No URL returned');
      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`  SAVED ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
    }

    if (i < VARIANTS.length - 1) await sleep(8000);
  }

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
