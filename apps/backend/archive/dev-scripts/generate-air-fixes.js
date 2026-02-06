// Air type targeted fixes — stronger stat differentiation
// Fixes 14 must-fix images with much more aggressive stat prompts
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const BASES_DIR = path.join(BASE_DIR, 'bases');
const OUTPUT_DIR = path.join(BASE_DIR, 'air');

const STYLE = 'Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.';
const TYPE_COLOR = 'sky-blue shell #A890F0';
const TYPE_ENERGY = 'swirling wind currents, feather-light glow';
const ARENA = 'High altitude sky arena with clouds below, strong wind gusts, floating platforms.';

// Much stronger stat-specific prompts — stat visuals FIRST, before type info
const FIXES = [
  // === CRAWLER ===
  {
    base: 'crawler-air.webp',
    output: 'crawler-attack.webp',
    prompt: `${STYLE} MASSIVE razor-sharp battle claws FOUR TIMES bigger than the body, glowing red-hot serrated pincer edges with sparking energy, veins of power running through oversized claw arms. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },
  {
    base: 'crawler-air.webp',
    output: 'crawler-defense.webp',
    prompt: `${STYLE} FORTRESS of layered armor plates covering every surface, thick riveted steel panels doubled and tripled over body, heavy reinforced face shield visor, shoulder pauldrons, armored leg guards on all legs, visible bolts and weld lines. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },
  {
    base: 'crawler-air.webp',
    output: 'crawler-speed.webp',
    prompt: `${STYLE} EXTREMELY thin streamlined needle-like body, paper-thin razor aerodynamic shell, visible speed afterimage trail showing THREE ghost copies behind, motion blur streaks, wind tunnel effect lines. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },
  {
    base: 'crawler-air.webp',
    output: 'crawler-claw.webp',
    prompt: `${STYLE} BLINDINGLY bright plasma energy claws wrapped in crackling lightning, visible neon energy veins running from chest core through arms to glowing white-hot claw tips, intense energy aura radiating from claws casting light on ground. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },

  // === CADET ===
  {
    base: 'cadet-air.webp',
    output: 'cadet-defense.webp',
    prompt: `${STYLE} FORTRESS of layered armor plates covering every surface, thick riveted steel panels doubled and tripled over body, heavy reinforced face shield visor, shoulder pauldrons, armored leg guards on all legs, visible bolts and weld lines. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },
  {
    base: 'cadet-air.webp',
    output: 'cadet-speed.webp',
    prompt: `${STYLE} EXTREMELY thin streamlined needle-like body, paper-thin razor aerodynamic shell, visible speed afterimage trail showing THREE ghost copies behind, motion blur streaks, wind tunnel effect lines. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },
  {
    base: 'cadet-air.webp',
    output: 'cadet-shell.webp',
    prompt: `${STYLE} GLOWING translucent hexagonal energy barrier force field completely surrounding entire body like a bubble shield, visible honeycomb shield grid pattern, bright protective cocoon of light, shield ripple effects on surface. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },

  // === SCOUT ===
  {
    base: 'scout-air.webp',
    output: 'scout-defense.webp',
    prompt: `${STYLE} FORTRESS of layered armor plates covering every surface, thick riveted steel panels doubled and tripled over body, heavy reinforced face shield visor, shoulder pauldrons, armored leg guards on all legs, visible bolts and weld lines. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },

  // === SENTINEL ===
  {
    base: 'sentinel-air.webp',
    output: 'sentinel-speed.webp',
    prompt: `${STYLE} EXTREMELY thin streamlined needle-like body, paper-thin razor aerodynamic shell, visible speed afterimage trail showing THREE ghost copies behind, motion blur streaks, wind tunnel effect lines. Chibi cybernetic robot lobster with single large eye, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },

  // === PEEPER ===
  {
    base: 'peeper-air.webp',
    output: 'peeper-defense.webp',
    prompt: `${STYLE} FORTRESS of layered armor plates covering every surface, thick riveted steel panels doubled and tripled over body, heavy reinforced face shield visor, shoulder pauldrons, armored leg guards on all legs, visible bolts and weld lines. Chibi cybernetic robot lobster with only two eyes on tall stalks, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },
  {
    base: 'peeper-air.webp',
    output: 'peeper-speed.webp',
    prompt: `${STYLE} EXTREMELY thin streamlined needle-like body, paper-thin razor aerodynamic shell, visible speed afterimage trail showing THREE ghost copies behind, motion blur streaks, wind tunnel effect lines. Chibi cybernetic robot lobster with only two eyes on tall stalks, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },

  // === TITAN ===
  {
    base: 'titan-air.webp',
    output: 'titan-defense.webp',
    prompt: `${STYLE} FORTRESS of layered armor plates covering every surface, thick riveted steel panels doubled and tripled over body, heavy reinforced face shield visor, shoulder pauldrons, armored leg guards on all legs, visible bolts and weld lines. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },
  {
    base: 'titan-air.webp',
    output: 'titan-speed.webp',
    prompt: `${STYLE} EXTREMELY thin streamlined needle-like body, paper-thin razor aerodynamic shell, visible speed afterimage trail showing THREE ghost copies behind, motion blur streaks, wind tunnel effect lines. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
  },
  {
    base: 'titan-air.webp',
    output: 'titan-shell.webp',
    prompt: `${STYLE} GLOWING translucent hexagonal energy barrier force field completely surrounding entire body like a bubble shield, visible honeycomb shield grid pattern, bright protective cocoon of light, shield ripple effects on surface. Chibi cybernetic robot lobster, air-type with wings, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${ARENA}`,
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

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < FIXES.length; i++) {
    const fix = FIXES[i];
    const baseFile = path.join(BASES_DIR, fix.base);
    const outPath = path.join(OUTPUT_DIR, fix.output);

    // Delete existing so we regenerate
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

    console.log(`\n[${i + 1}/${FIXES.length}] ${fix.output}`);

    if (!fs.existsSync(baseFile)) {
      console.error(`  MISSING BASE: ${baseFile}`);
      failed++;
      continue;
    }

    const dataUri = fileToDataUri(baseFile);

    try {
      const imageUrl = await callFlux(fix.prompt, dataUri, SEED);
      if (!imageUrl) throw new Error('No URL returned');
      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`  SAVED ${fix.output} (${(bytes / 1024).toFixed(0)} KB)`);
      generated++;
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${err.message}`);
    }

    if (i < FIXES.length - 1) await sleep(8000);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`AIR FIXES COMPLETE`);
  console.log(`Generated: ${generated} | Failed: ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
