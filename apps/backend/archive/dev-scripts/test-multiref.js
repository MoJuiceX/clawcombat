// Test: FLUX 2 Pro multi-image reference
// Image 1: Psyche stat variant (shows what the stat should look like)
// Image 2: Air crawler balanced (shows the body-mod style to keep)
// Goal: Combine stat features from psyche + air body-mod style
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const OUTPUT_DIR = path.join(BASE_DIR, 'test-multiref');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const STYLE = 'Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.';

// Air crawler balanced = body-mod reference (image 2)
const AIR_BALANCED = path.join(BASE_DIR, 'air', 'crawler-balanced.webp');

// Psyche stat variants = stat reference (image 1)
const TESTS = [
  {
    stat: 'attack',
    statRef: path.join(BASE_DIR, 'psyche', 'crawler-attack.webp'),
    prompt: `${STYLE} Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow. Combine the large battle claws and attack features from image 1 with the air-type winged body style from image 2. Six crustacean walking legs. High altitude sky arena with clouds below, strong wind gusts, floating platforms.`,
  },
  {
    stat: 'defense',
    statRef: path.join(BASE_DIR, 'psyche', 'crawler-defense.webp'),
    prompt: `${STYLE} Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow. Combine the thick armor plating and defense features from image 1 with the air-type winged body style from image 2. Six crustacean walking legs. High altitude sky arena with clouds below, strong wind gusts, floating platforms.`,
  },
  {
    stat: 'hp',
    statRef: path.join(BASE_DIR, 'psyche', 'crawler-hp.webp'),
    prompt: `${STYLE} Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow. Combine the glowing vitality runes and HP features from image 1 with the air-type winged body style from image 2. Six crustacean walking legs. High altitude sky arena with clouds below, strong wind gusts, floating platforms.`,
  },
  {
    stat: 'speed',
    statRef: path.join(BASE_DIR, 'psyche', 'crawler-speed.webp'),
    prompt: `${STYLE} Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow. Combine the sleek aerodynamic body and speed afterimage trail from image 1 with the air-type winged body style from image 2. Six crustacean walking legs. High altitude sky arena with clouds below, strong wind gusts, floating platforms.`,
  },
  {
    stat: 'claw',
    statRef: path.join(BASE_DIR, 'psyche', 'crawler-claw.webp'),
    prompt: `${STYLE} Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow. Combine the glowing plasma energy claws from image 1 with the air-type winged body style from image 2. Six crustacean walking legs. High altitude sky arena with clouds below, strong wind gusts, floating platforms.`,
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

async function callFlux(prompt, imageDataUris, seed) {
  const input = {
    prompt,
    input_images: imageDataUris,
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

  const airBalancedUri = fileToDataUri(AIR_BALANCED);
  console.log('Image 1: psyche stat variant (stat features)');
  console.log('Image 2: air crawler balanced (body-mod style)');
  console.log(`Output: test-multiref/\n`);

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i];
    const outFile = `crawler-${test.stat}.webp`;
    const outPath = path.join(OUTPUT_DIR, outFile);

    console.log(`[${i + 1}/${TESTS.length}] ${test.stat}`);

    const statRefUri = fileToDataUri(test.statRef);

    try {
      // Pass both images: [statRef, airBalanced]
      const imageUrl = await callFlux(test.prompt, [statRefUri, airBalancedUri], SEED);
      if (!imageUrl) throw new Error('No URL returned');
      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`  SAVED ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
      generated++;
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${err.message}`);
    }

    if (i < TESTS.length - 1) await sleep(8000);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`MULTI-REF TEST COMPLETE`);
  console.log(`Generated: ${generated} | Failed: ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
