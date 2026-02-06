// Generate modified base variants for Dragon, Flying, Ghost, Fairy
// Each type gets body modifications while keeping neutral reddish-brown color
// Uses FLUX 2 Pro with current 6 bases as reference
// Run: node generate-type-bases.js [dragon|flying|ghost|fairy|all]

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const INPUT_DIR = path.join(BASE_DIR, 'bases-qwen-v2');

const BASES = [
  { name: 'crawler',  file: 'base-water.webp' },
  { name: 'cadet',    file: 'base-neutral.webp' },
  { name: 'scout',    file: 'base-venom.webp' },
  { name: 'sentinel', file: 'base-ice.webp' },
  { name: 'peeper',   file: 'base-earth.webp' },
  { name: 'titan',    file: 'base-nature.webp' },
];

const STYLE_PREFIX = 'Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.';
const NEUTRAL_SUFFIX = 'Natural reddish-brown shell color, six crustacean walking legs. Plain smooth gray studio background, soft even lighting.';

const TYPE_BASES = {
  dragon: {
    folder: 'bases-dragon',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with large mechanical dragon wings spread behind body, horned armored head crest, dragon-scale textured shell plates, longer spiked tail with barbed tip, fierce single eye. ${NEUTRAL_SUFFIX}`,
  },
  flying: {
    folder: 'bases-flying',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with translucent iridescent dragonfly-style insect wings attached to back, lighter streamlined aerodynamic frame, thinner shell plates, wind-swept antennae, sleek compact body built for flight. ${NEUTRAL_SUFFIX}`,
  },
  ghost: {
    folder: 'bases-ghost',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with semi-transparent translucent shell sections revealing inner machinery, ghostly ethereal wisps trailing from body, slightly floating above ground with fading legs, spectral glow around edges, haunted single eye. ${NEUTRAL_SUFFIX}`,
  },
  fairy: {
    folder: 'bases-fairy',
    prompt: `${STYLE_PREFIX} Chibi cybernetic robot lobster with small delicate butterfly-like wings with circuit patterns, daintier lighter proportions, sparkle particle effects around body, elegant curved antennae, polished smooth shell with gem-like inlays. ${NEUTRAL_SUFFIX}`,
  },
};

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

async function generateType(typeName) {
  const config = TYPE_BASES[typeName];
  if (!config) {
    console.error(`Unknown type: ${typeName}`);
    return { generated: 0, failed: 0 };
  }

  const outputDir = path.join(BASE_DIR, config.folder);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`${typeName.toUpperCase()} BASE VARIANTS`);
  console.log(`Prompt (${config.prompt.split(/\s+/).length} words)`);
  console.log(`Output: ${config.folder}`);
  console.log(`${'='.repeat(50)}`);

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < BASES.length; i++) {
    const base = BASES[i];
    const outFile = `${base.name}-${typeName}.webp`;
    const outPath = path.join(outputDir, outFile);

    if (fs.existsSync(outPath)) {
      console.log(`  [${i + 1}/${BASES.length}] SKIP ${outFile} (exists)`);
      continue;
    }

    const inputPath = path.join(INPUT_DIR, base.file);
    if (!fs.existsSync(inputPath)) {
      console.error(`  [${i + 1}/${BASES.length}] MISSING: ${base.file}`);
      failed++;
      continue;
    }

    const dataUri = fileToDataUri(inputPath);
    console.log(`  [${i + 1}/${BASES.length}] ${base.name}`);

    try {
      const imageUrl = await callFlux(config.prompt, dataUri, SEED);
      if (!imageUrl) throw new Error('No URL returned');
      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`    SAVED ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
      generated++;
    } catch (err) {
      failed++;
      console.error(`    FAILED: ${err.message}`);
    }

    await sleep(8000);
  }

  return { generated, failed };
}

async function main() {
  if (!REPLICATE_API_TOKEN) {
    console.error('REPLICATE_API_TOKEN is not set');
    process.exit(1);
  }

  const arg = process.argv[2] || 'all';
  const types = arg === 'all' ? ['dragon', 'flying', 'ghost', 'fairy'] : [arg];

  let totalGenerated = 0;
  let totalFailed = 0;

  for (const typeName of types) {
    const { generated, failed } = await generateType(typeName);
    totalGenerated += generated;
    totalFailed += failed;
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`ALL TYPE BASES COMPLETE`);
  console.log(`Generated: ${totalGenerated} | Failed: ${totalFailed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
