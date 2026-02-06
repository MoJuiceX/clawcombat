// Fix Crawler and Peeper water attack images
// Crawler: front-facing, lost body shape
// Peeper: water squirting from eyes
// Run: node generate-water-attack-fixes.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const INPUT_DIR = path.join(BASE_DIR, 'bases-qwen-v2');

const TYPE_COLOR = 'deep ocean-blue shell #6890F0';
const TYPE_ENERGY = 'bioluminescent blue cooling veins, water dripping from body';
const TYPE_ARENA = 'Water arena with ocean surface, splashing waves around feet, wet reflective ground, water droplets in air.';

const FIXES = [
  {
    name: 'crawler',
    file: 'base-water.webp',
    folder: 'test-flux-water-attack',
    outFile: 'crawler-water.webp',
    // Remove any size exaggeration that might cause FLUX to repose. Focus on claw attributes only.
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Oversized battle claws with jagged serrated razor-sharp pincers, water jets spraying from claw edges, heavy reinforced claw arms. Chibi cybernetic robot lobster matching reference body shape closely, water-type, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${TYPE_ARENA}`,
  },
  {
    name: 'peeper',
    file: 'base-earth.webp',
    folder: 'test-flux-water-attack',
    outFile: 'peeper-water.webp',
    // Explicitly say no water from eyes, water effects only on claws
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Enormous oversized battle claws three times normal size, jagged serrated razor-sharp pincers with water jets spraying from claw edges only, heavy reinforced claw arms. Chibi cybernetic robot lobster, water-type, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs, two eyes on stalks. ${TYPE_ARENA}`,
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
    console.error('REPLICATE_API_TOKEN is not set');
    process.exit(1);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`WATER ATTACK FIXES — ${FIXES.length} images`);
  console.log(`${'='.repeat(50)}`);

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < FIXES.length; i++) {
    const fix = FIXES[i];
    const outPath = path.join(BASE_DIR, fix.folder, fix.outFile);
    const inputPath = path.join(INPUT_DIR, fix.file);

    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

    const dataUri = fileToDataUri(inputPath);
    console.log(`  [${i + 1}/${FIXES.length}] ${fix.name} attack`);

    try {
      const imageUrl = await callFlux(fix.prompt, dataUri, SEED);
      if (!imageUrl) throw new Error('No URL returned');
      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`    SAVED ${fix.outFile} (${(bytes / 1024).toFixed(0)} KB)`);
      generated++;
    } catch (err) {
      failed++;
      console.error(`    FAILED: ${err.message}`);
    }

    await sleep(8000);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`WATER ATTACK FIXES COMPLETE`);
  console.log(`Generated: ${generated} | Failed: ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
