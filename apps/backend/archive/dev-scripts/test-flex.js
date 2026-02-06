// Test: FLUX 2 Flex with high guidance for body-mod stat differentiation
// Uses body-mod base as reference but cranks guidance to prioritize prompt
// Tests guidance values 7, 8.5, 10 for attack to find sweet spot
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const BASES_DIR = path.join(BASE_DIR, 'bases');
const OUTPUT_DIR = path.join(BASE_DIR, 'test-flex');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const STYLE = 'Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.';
const AIR_BASE = path.join(BASES_DIR, 'crawler-air.webp');

const ARENA = 'High altitude sky arena with clouds below, strong wind gusts, floating platforms.';

// Test different guidance levels for attack, then all stats at best guidance
const TESTS = [
  // Guidance sweep for attack
  {
    output: 'crawler-attack-g7.webp',
    guidance: 7,
    prompt: `${STYLE} MASSIVE razor-sharp battle claws FOUR TIMES bigger than the body, glowing red-hot serrated pincer edges with sparking energy, veins of power running through oversized claw arms. Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow, six crustacean walking legs. ${ARENA}`,
  },
  {
    output: 'crawler-attack-g8.5.webp',
    guidance: 8.5,
    prompt: `${STYLE} MASSIVE razor-sharp battle claws FOUR TIMES bigger than the body, glowing red-hot serrated pincer edges with sparking energy, veins of power running through oversized claw arms. Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow, six crustacean walking legs. ${ARENA}`,
  },
  {
    output: 'crawler-attack-g10.webp',
    guidance: 10,
    prompt: `${STYLE} MASSIVE razor-sharp battle claws FOUR TIMES bigger than the body, glowing red-hot serrated pincer edges with sparking energy, veins of power running through oversized claw arms. Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow, six crustacean walking legs. ${ARENA}`,
  },
  // All 5 stats at guidance 10 (max prompt adherence)
  {
    output: 'crawler-defense-g10.webp',
    guidance: 10,
    prompt: `${STYLE} FORTRESS of layered armor plates covering every surface, thick riveted steel panels doubled and tripled over body, heavy reinforced face shield visor, shoulder pauldrons, armored leg guards on all legs, visible bolts and weld lines. Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow, six crustacean walking legs. ${ARENA}`,
  },
  {
    output: 'crawler-hp-g10.webp',
    guidance: 10,
    prompt: `${STYLE} BRILLIANT green vitality runes and symbols glowing across ENTIRE shell surface, large pulsing green health crystal embedded in chest, bright green regeneration particle cloud swirling around body, visible green healing aura outline around silhouette. Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow, six crustacean walking legs. ${ARENA}`,
  },
  {
    output: 'crawler-speed-g10.webp',
    guidance: 10,
    prompt: `${STYLE} EXTREMELY thin streamlined needle-like body, paper-thin razor aerodynamic shell, visible speed afterimage trail showing THREE ghost copies behind, motion blur streaks, wind tunnel effect lines. Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow, six crustacean walking legs. ${ARENA}`,
  },
  {
    output: 'crawler-claw-g10.webp',
    guidance: 10,
    prompt: `${STYLE} BLINDINGLY bright plasma energy claws wrapped in crackling lightning, visible neon energy veins running from chest core through arms to glowing white-hot claw tips, intense energy aura radiating from claws casting light on ground. Chibi cybernetic robot lobster with wings, air-type, sky-blue shell #A890F0, swirling wind currents, feather-light glow, six crustacean walking legs. ${ARENA}`,
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

async function callFlexApi(prompt, imageDataUri, seed, guidance) {
  const input = {
    prompt,
    input_images: [imageDataUri],
    aspect_ratio: '1:1',
    output_format: 'webp',
    output_quality: 95,
    safety_tolerance: 3,
    guidance,
    steps: 40,
    prompt_upsampling: false,
  };
  if (seed != null) input.seed = seed;

  const createResponse = await fetchWithTimeout('https://api.replicate.com/v1/models/black-forest-labs/flux-2-flex/predictions', {
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

  const baseDataUri = fileToDataUri(AIR_BASE);
  console.log('Reference: air crawler body-mod base');
  console.log('Testing guidance levels: 7, 8.5, 10');
  console.log(`Output: test-flex/\n`);

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i];
    const outPath = path.join(OUTPUT_DIR, test.output);

    console.log(`[${i + 1}/${TESTS.length}] ${test.output} (guidance=${test.guidance})`);

    try {
      const imageUrl = await callFlexApi(test.prompt, baseDataUri, SEED, test.guidance);
      if (!imageUrl) throw new Error('No URL returned');
      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`  SAVED ${test.output} (${(bytes / 1024).toFixed(0)} KB)`);
      generated++;
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${err.message}`);
    }

    if (i < TESTS.length - 1) await sleep(5000);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`FLEX TEST COMPLETE`);
  console.log(`Generated: ${generated} | Failed: ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
