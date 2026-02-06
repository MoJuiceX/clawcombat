// Test: Use STANDARD bases as reference + describe body-mod features in prompt
// Goal: See if stat differentiation works when body-mod is text-only
// Test: Dragon attack for all 6 characters
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const BASES_DIR = path.join(BASE_DIR, 'bases');
const OUTPUT_DIR = path.join(BASE_DIR, 'test-bodymod');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const STYLE = 'Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.';

const BASES = [
  { name: 'crawler',  file: 'crawler.webp' },
  { name: 'cadet',    file: 'cadet.webp' },
  { name: 'scout',    file: 'scout.webp' },
  { name: 'sentinel', file: 'sentinel.webp' },
  { name: 'peeper',   file: 'peeper.webp' },
  { name: 'titan',    file: 'titan.webp' },
];

// Test set: dragon balanced + dragon attack using STANDARD bases
const TESTS = [];
for (const base of BASES) {
  // Dragon balanced — standard base, body-mod in prompt only
  TESTS.push({
    base: base.file,
    output: `${base.name}-dragon-balanced.webp`,
    prompt: `${STYLE} Chibi cybernetic robot lobster with large dragon wings on back and curved dragon horns on head, dragon-type, deep indigo-violet shell #7038F8, draconic fire breath wisps, ancient power glow, six crustacean walking legs. Dragon lair arena with treasure hoard, ancient runes, volcanic vents.`,
  });
  // Dragon attack — standard base, body-mod + stat in prompt
  TESTS.push({
    base: base.file,
    output: `${base.name}-dragon-attack.webp`,
    prompt: `${STYLE} MASSIVE razor-sharp battle claws FOUR TIMES bigger than the body, glowing red-hot serrated pincer edges with sparking energy, veins of power running through oversized claw arms. Chibi cybernetic robot lobster with large dragon wings on back and curved dragon horns on head, dragon-type, deep indigo-violet shell #7038F8, draconic fire breath wisps, ancient power glow, six crustacean walking legs. Dragon lair arena with treasure hoard, ancient runes, volcanic vents.`,
  });
}

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

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i];
    const baseFile = path.join(BASES_DIR, test.base);
    const outPath = path.join(OUTPUT_DIR, test.output);

    if (fs.existsSync(outPath)) {
      console.log(`[${i + 1}/${TESTS.length}] SKIP ${test.output} (exists)`);
      continue;
    }

    console.log(`[${i + 1}/${TESTS.length}] ${test.output}`);

    const dataUri = fileToDataUri(baseFile);

    try {
      const imageUrl = await callFlux(test.prompt, dataUri, SEED);
      if (!imageUrl) throw new Error('No URL returned');
      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`  SAVED ${test.output} (${(bytes / 1024).toFixed(0)} KB)`);
      generated++;
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${err.message}`);
    }

    if (i < TESTS.length - 1) await sleep(8000);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`TEST COMPLETE`);
  console.log(`Generated: ${generated} | Failed: ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
