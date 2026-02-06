// Generate missing base+variant images for NEUTRAL, MYSTIC, MARTIAL, FIRE, EARTH
// Uses FLUX 2 Pro with type-specific prompts matching existing approved images
// Run: node scripts/dev/generate-missing-variants.js [type|all]

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, '..', '..', 'src', 'public', 'references');

const STYLE = 'Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.';

// Type definitions: color, energy, arena (from generate-type-rounds.js)
const TYPES = {
  neutral: {
    color: '#A8A878',
    energy: 'clean silver-white LED strips',
    arena: 'Clean esports arena with spotlights, smooth gray floor, tournament banners.',
  },
  mystic: {
    color: '#EE99AC',
    energy: 'glowing arcane runes, iridescent fairy energy ribbons',
    arena: 'Enchanted garden arena with glowing flowers, floating crystals, rainbow light beams.',
  },
  martial: {
    color: '#C03028',
    energy: 'crimson fighting spirit aura, cloth-wrapped battle claw wraps',
    arena: 'Martial arts dojo arena with wooden training dummies, stone floor, hanging lanterns.',
  },
  fire: {
    color: '#F08030',
    energy: 'molten ember core, flame trails',
    arena: 'Fiery volcanic arena with lava pools.',
  },
  earth: {
    color: '#E0C068',
    energy: 'amber earth energy glowing through cracks in shell',
    arena: 'Desert canyon arena with cracked earth, sandstorm, towering rock formations.',
  },
};

// Variant-specific stat prompts (aggressive descriptions FIRST)
const VARIANT_PROMPTS = {
  attack: 'MASSIVE razor-sharp battle claws FOUR TIMES bigger than the body, glowing red-hot serrated pincer edges with sparking energy, veins of power running through oversized claw arms.',
  balanced: '', // No stat prefix for balanced
  defense: 'FORTRESS of layered armor plates covering every surface, thick riveted steel panels doubled and tripled over body, heavy reinforced face shield visor, shoulder pauldrons, armored leg guards on all legs, visible bolts and weld lines.',
  hp: 'BRILLIANT green vitality runes and symbols glowing across ENTIRE shell surface, large pulsing green health crystal embedded in chest, bright green regeneration particle cloud swirling around body, visible green healing aura outline around silhouette.',
  speed: 'EXTREMELY thin streamlined needle-like body, paper-thin razor aerodynamic shell, visible speed afterimage trail showing THREE ghost copies behind, motion blur streaks, wind tunnel effect lines.',
  claw: 'BLINDINGLY bright plasma energy claws wrapped in crackling lightning, visible neon energy veins running from chest core through arms to glowing white-hot claw tips, intense energy aura radiating from claws casting light on ground.',
  shell: 'GLOWING translucent hexagonal energy barrier force field completely surrounding entire body like a bubble shield, visible honeycomb shield grid pattern, bright protective cocoon of light, shield ripple effects on surface.',
};

// Missing images to generate
// ref = existing approved image from same type folder to use as reference
const MISSING = [
  { type: 'neutral', base: 'cadet', variant: 'attack', ref: 'cadet-balanced.webp' },
  { type: 'mystic', base: 'crawler', variant: 'speed', ref: 'crawler-balanced.webp' },
  { type: 'martial', base: 'crawler', variant: 'attack', ref: 'crawler-balanced.webp' },
  { type: 'martial', base: 'peeper', variant: 'attack', ref: 'peeper-balanced.webp' },
  { type: 'martial', base: 'cadet', variant: 'speed', ref: 'cadet-balanced.webp' },
  { type: 'martial', base: 'scout', variant: 'attack', ref: 'scout-balanced.webp' },
  { type: 'martial', base: 'sentinel', variant: 'attack', ref: 'sentinel-hp.webp' },
  { type: 'martial', base: 'sentinel', variant: 'balanced', ref: 'sentinel-hp.webp' },
  { type: 'martial', base: 'sentinel', variant: 'defense', ref: 'sentinel-shell.webp' },
  { type: 'fire', base: 'peeper', variant: 'claw', ref: 'peeper-balanced.webp' },
  { type: 'earth', base: 'peeper', variant: 'attack', ref: 'peeper-balanced.webp' },
  { type: 'earth', base: 'cadet', variant: 'attack', ref: 'cadet-balanced.webp' },
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

async function callFlux2Pro(prompt, referenceImageDataUri, seed) {
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

function buildPrompt(type, base, variant) {
  const t = TYPES[type];
  const statPrefix = VARIANT_PROMPTS[variant] || '';

  // Subject: Chibi cybernetic robot lobster, {type}-type, shell color, energy
  const subject = `Chibi cybernetic robot lobster, ${type}-type, shell color ${t.color}, ${t.energy}, six crustacean walking legs.`;

  // Full prompt: STYLE + stat prefix + subject + arena
  if (statPrefix) {
    return `${STYLE} ${statPrefix} ${subject} ${t.arena}`;
  }
  return `${STYLE} ${subject} ${t.arena}`;
}

async function generateImage(item, index, total, outputDir) {
  const { type, base, variant, ref } = item;
  const outFile = `${type}-${base}-${variant}.webp`;
  const outPath = path.join(outputDir, outFile);

  // Use existing approved image from same type folder as reference
  const refPath = path.join(BASE_DIR, type, ref);

  console.log(`\n[${index + 1}/${total}] ${type}/${base}-${variant}.webp`);
  console.log(`  Reference: ${type}/${ref}`);

  if (fs.existsSync(outPath)) {
    console.log(`  SKIP: already exists in output folder`);
    return { status: 'skipped' };
  }

  if (!fs.existsSync(refPath)) {
    console.error(`  ERROR: reference not found: ${refPath}`);
    return { status: 'failed', error: 'reference not found' };
  }

  const prompt = buildPrompt(type, base, variant);
  console.log(`  Prompt: ${prompt.substring(0, 120)}...`);

  try {
    const dataUri = fileToDataUri(refPath);
    const imageUrl = await callFlux2Pro(prompt, dataUri, SEED);
    if (!imageUrl) throw new Error('No URL returned');
    const bytes = await downloadImage(imageUrl, outPath);
    console.log(`  SAVED: ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
    return { status: 'success' };
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    return { status: 'failed', error: err.message };
  }
}

async function main() {
  if (!REPLICATE_API_TOKEN) {
    console.error('REPLICATE_API_TOKEN is not set');
    process.exit(1);
  }

  const arg = process.argv[2];
  const toGenerate = arg && arg !== 'all'
    ? MISSING.filter(m => m.type === arg)
    : MISSING;

  if (toGenerate.length === 0) {
    console.log(`No images to generate for: ${arg}`);
    console.log(`Available types: neutral, mystic, martial, fire, earth, all`);
    return;
  }

  // Output to a separate folder for comparison
  const outputDir = path.join(BASE_DIR, 'flux2-missing-v2');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('='.repeat(60));
  console.log('GENERATING MISSING VARIANT IMAGES');
  console.log(`Model: FLUX 2 Pro with type-specific prompts`);
  console.log(`Reference: Existing approved images from type folders`);
  console.log(`Images to generate: ${toGenerate.length}`);
  console.log(`Output folder: references/flux2-missing-v2/`);
  console.log('='.repeat(60));

  let success = 0, failed = 0, skipped = 0;

  for (let i = 0; i < toGenerate.length; i++) {
    const result = await generateImage(toGenerate[i], i, toGenerate.length, outputDir);
    if (result.status === 'success') success++;
    else if (result.status === 'failed') failed++;
    else skipped++;

    // Rate limit: wait between API calls
    if (i < toGenerate.length - 1 && result.status === 'success') {
      console.log(`  Waiting 8s before next request...`);
      await sleep(8000);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('COMPLETE');
  console.log(`Success: ${success} | Failed: ${failed} | Skipped: ${skipped}`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
