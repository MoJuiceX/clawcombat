// Type base fixes v2 — Round 2 of review feedback
// Run: node generate-type-bases-fixes-v2.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const INPUT_DIR = path.join(BASE_DIR, 'bases-qwen-v2');

const STYLE_PREFIX = 'Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.';
const NEUTRAL_SUFFIX = 'Natural reddish-brown shell color, six crustacean walking legs. Plain smooth gray studio background, soft even lighting.';

const FIXES = [
  // Sentinel Dragon: body too far from base, keep one eye
  {
    name: 'sentinel',
    file: 'base-ice.webp',
    folder: 'bases-dragon',
    outFile: 'sentinel-dragon.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster matching the reference body shape closely, with mechanical dragon wings added behind body, dragon-scale texture on existing shell, single large expressive eye, keeping the same proportions and body structure as reference. ${NEUTRAL_SUFFIX}`,
  },
  // Peeper Dragon: head needs to look like base Peeper with two eyes on stalks
  {
    name: 'peeper',
    file: 'base-earth.webp',
    folder: 'bases-dragon',
    outFile: 'peeper-dragon.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster matching the reference body shape closely, with mechanical dragon wings added behind body, dragon-scale texture on existing shell, two eyes on tall stalks protruding from top of head exactly like the reference, no other eyes, keeping the same head shape and proportions as reference. ${NEUTRAL_SUFFIX}`,
  },
  // Peeper Flying: has stalked eyes (good) but also normal eyes — remove normal eyes
  {
    name: 'peeper',
    file: 'base-earth.webp',
    folder: 'bases-flying',
    outFile: 'peeper-flying.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster matching the reference body shape closely, with translucent iridescent dragonfly-style insect wings attached to back, streamlined aerodynamic frame, only two eyes on tall stalks protruding from top of head exactly like the reference, no eyes on the face, no other eyes, sleek body built for flight. ${NEUTRAL_SUFFIX}`,
  },
  // Ghost Crawler: eyes looking different directions, make them black
  {
    name: 'crawler',
    file: 'base-water.webp',
    folder: 'bases-ghost',
    outFile: 'crawler-ghost.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with HIGHLY transparent see-through ghostly shell revealing inner machinery and circuits, extremely translucent body like frosted glass, ghostly ethereal wisps trailing from body, slightly floating above ground, spectral glow around edges, solid black empty eyes. ${NEUTRAL_SUFFIX}`,
  },
  // Peeper Fairy: lost base body, has stalked eyes but also normal eyes
  {
    name: 'peeper',
    file: 'base-earth.webp',
    folder: 'bases-fairy',
    outFile: 'peeper-fairy.webp',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster matching the reference body shape closely, with small delicate butterfly-like wings with circuit patterns, sparkle particle effects around body, polished smooth shell with gem-like inlays, only two eyes on tall stalks protruding from top of head exactly like the reference, no eyes on the face, no other eyes. ${NEUTRAL_SUFFIX}`,
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
  console.log(`TYPE BASE FIXES v2 — ${FIXES.length} images`);
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
  console.log(`FIXES v2 COMPLETE`);
  console.log(`Generated: ${generated} | Failed: ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
