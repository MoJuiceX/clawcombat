// Fix specific type base images based on review feedback
// Run: node generate-type-bases-fixes.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const INPUT_DIR = path.join(BASE_DIR, 'bases-qwen-v2');

const STYLE_PREFIX = 'Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.';
const NEUTRAL_SUFFIX = 'Natural reddish-brown shell color, six crustacean walking legs. Plain smooth gray studio background, soft even lighting.';

// Each fix: which base, which type folder, and the corrected prompt
const FIXES = [
  // --- DRAGON FIXES ---
  {
    name: 'titan',
    file: 'base-nature.webp',
    folder: 'bases-dragon',
    outFile: 'titan-dragon.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with large mechanical dragon wings spread behind body, horned armored head crest, dragon-scale textured shell plates, longer spiked tail with barbed tip, two large expressive eyes. ${NEUTRAL_SUFFIX}`,
  },
  {
    name: 'peeper',
    file: 'base-earth.webp',
    folder: 'bases-dragon',
    outFile: 'peeper-dragon.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with large mechanical dragon wings spread behind body, horned armored head crest, dragon-scale textured shell plates, longer spiked tail with barbed tip, two large expressive eyes on stalks protruding from top of head. ${NEUTRAL_SUFFIX}`,
  },
  {
    name: 'sentinel',
    file: 'base-ice.webp',
    folder: 'bases-dragon',
    outFile: 'sentinel-dragon.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with large mechanical dragon wings spread behind body, horned armored head crest, dragon-scale textured shell plates, longer spiked tail with barbed tip, single large expressive eye. ${NEUTRAL_SUFFIX}`,
  },
  {
    name: 'scout',
    file: 'base-venom.webp',
    folder: 'bases-dragon',
    outFile: 'scout-dragon.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster matching the reference body shape closely, with mechanical dragon wings added behind body, dragon-scale texture on shell, two large expressive eyes, keeping the same proportions and claw style as reference. ${NEUTRAL_SUFFIX}`,
  },

  // --- FLYING FIX ---
  {
    name: 'peeper',
    file: 'base-earth.webp',
    folder: 'bases-flying',
    outFile: 'peeper-flying.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with translucent iridescent dragonfly-style insect wings attached to back, lighter streamlined aerodynamic frame, thinner shell plates, wind-swept antennae, two large expressive eyes on stalks protruding from top of head, sleek compact body built for flight. ${NEUTRAL_SUFFIX}`,
  },

  // --- GHOST FIXES ---
  {
    name: 'crawler',
    file: 'base-water.webp',
    folder: 'bases-ghost',
    outFile: 'crawler-ghost.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with HIGHLY transparent see-through ghostly shell revealing inner machinery and circuits, extremely translucent body like frosted glass, ghostly ethereal wisps trailing from body, slightly floating above ground, spectral glow around edges, haunted single eye. ${NEUTRAL_SUFFIX}`,
  },
  {
    name: 'scout',
    file: 'base-venom.webp',
    folder: 'bases-ghost',
    outFile: 'scout-ghost.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with HIGHLY transparent see-through ghostly shell revealing inner machinery and circuits, extremely translucent body like frosted glass, ghostly ethereal wisps trailing from body, slightly floating above ground, spectral glow around edges, two expressive eyes. ${NEUTRAL_SUFFIX}`,
  },
  {
    name: 'peeper',
    file: 'base-earth.webp',
    folder: 'bases-ghost',
    outFile: 'peeper-ghost.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with HIGHLY transparent see-through ghostly shell, ghostly ethereal wisps trailing from body, slightly floating above ground, spectral glow around edges, two large expressive eyes on stalks protruding from top of head. ${NEUTRAL_SUFFIX}`,
  },

  // --- FAIRY FIX ---
  {
    name: 'peeper',
    file: 'base-earth.webp',
    folder: 'bases-fairy',
    outFile: 'peeper-fairy.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with small delicate butterfly-like wings with circuit patterns, daintier lighter proportions, sparkle particle effects around body, elegant curved antennae, polished smooth shell with gem-like inlays, two large expressive eyes on stalks protruding from top of head. ${NEUTRAL_SUFFIX}`,
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
  console.log(`TYPE BASE FIXES — ${FIXES.length} images`);
  console.log(`${'='.repeat(50)}`);

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < FIXES.length; i++) {
    const fix = FIXES[i];
    const outputDir = path.join(BASE_DIR, fix.folder);
    fs.mkdirSync(outputDir, { recursive: true });

    const outPath = path.join(outputDir, fix.outFile);
    const inputPath = path.join(INPUT_DIR, fix.file);

    if (!fs.existsSync(inputPath)) {
      console.error(`  [${i + 1}/${FIXES.length}] MISSING: ${fix.file}`);
      failed++;
      continue;
    }

    // Delete existing file so we regenerate
    if (fs.existsSync(outPath)) {
      fs.unlinkSync(outPath);
    }

    const dataUri = fileToDataUri(inputPath);
    console.log(`  [${i + 1}/${FIXES.length}] ${fix.name} ${fix.folder.replace('bases-', '')}`);

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
  console.log(`FIXES COMPLETE`);
  console.log(`Generated: ${generated} | Failed: ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
