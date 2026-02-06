// Round 1: Test FLUX 2 Pro fire type on all 6 Qwen bases
// Same fire prompt, all 6 bases — tests if FLUX can apply fire visuals to Qwen bases
// Run: node generate-qwen-fire-test.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

const SEED = 77777;
const OUTPUT_DIR = path.join(__dirname, 'src', 'public', 'references', 'test-flux-fire');

// Balanced fire prompt — no stat emphasis, just fire type visuals
const FIRE_PROMPT = `Chibi cybernetic robot lobster, fire-type, blazing orange-red shell color #F08030, molten energy core with ember particles erupting from joints, flame trails, glowing cracks in armor, small dark glossy black eyes, antennae, segmented armored tail, titanium claws, 6 walking legs. Fiery volcanic arena with lava pools and smoke. 3D digital art, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.`;

const BASES = [
  { name: 'crawler-fire', file: 'base-water.webp' },
  { name: 'cadet-fire',   file: 'base-neutral.webp' },
  { name: 'scout-fire',   file: 'base-venom.webp' },
  { name: 'peeper-fire',  file: 'base-earth.webp' },
  { name: 'titan-fire',   file: 'base-nature.webp' },
  { name: 'warbot-fire',  file: 'base-metal.webp' },
];

const INPUT_DIR = path.join(__dirname, 'src', 'public', 'references', 'bases-qwen-v2');

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

async function callFlux(prompt, referenceImageDataUri, options = {}) {
  const input = {
    prompt,
    input_images: [referenceImageDataUri],
    aspect_ratio: '1:1',
    output_format: 'webp',
    output_quality: 95,
    safety_tolerance: 3,
  };
  if (options.seed != null) input.seed = options.seed;

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
    const err = new Error(`Replicate HTTP ${createResponse.status}: ${errText.substring(0, 400)}`);
    err.status = createResponse.status;
    throw err;
  }

  let prediction = await createResponse.json();

  // Poll if not done
  const maxAttempts = 150;
  for (let i = 0; i < maxAttempts && prediction.status !== 'succeeded'; i++) {
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Prediction ${prediction.status}: ${prediction.error || 'unknown'}`);
    }
    await sleep(2000);
    const pollResponse = await fetchWithTimeout(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` } },
      15000
    );
    if (!pollResponse.ok) throw new Error(`Poll HTTP ${pollResponse.status}`);
    prediction = await pollResponse.json();
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(`Timed out, status: ${prediction.status}`);
  }

  const output = prediction.output;
  if (!output) throw new Error('No output');
  return Array.isArray(output) ? output[0] : output;
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

  const total = BASES.length;
  let completed = 0;
  let failed = 0;
  const failures = [];

  console.log(`=== Round 1: FLUX 2 Pro Fire Type — 6 Bases ===`);
  console.log(`Model: FLUX 2 Pro | Seed: ${SEED}`);
  console.log(`Prompt (${FIRE_PROMPT.split(/\s+/).length} words)`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('');

  for (const base of BASES) {
    completed++;
    const outFile = `${base.name}.webp`;
    const outPath = path.join(OUTPUT_DIR, outFile);

    if (fs.existsSync(outPath)) {
      console.log(`[${completed}/${total}] SKIP ${outFile} (already exists)`);
      continue;
    }

    const inputPath = path.join(INPUT_DIR, base.file);
    if (!fs.existsSync(inputPath)) {
      console.error(`[${completed}/${total}] MISSING input: ${base.file}`);
      failed++;
      failures.push({ name: base.name, error: 'Input file missing' });
      continue;
    }

    const dataUri = fileToDataUri(inputPath);
    console.log(`[${completed}/${total}] ${base.name}`);

    try {
      const imageUrl = await callFlux(FIRE_PROMPT, dataUri, { seed: SEED });
      if (!imageUrl) throw new Error('No URL returned');

      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`  SAVED ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failed++;
      failures.push({ name: base.name, error: err.message });
      console.error(`  FAILED: ${err.message}`);
    }

    if (completed < total) {
      console.log('  Waiting 10s...');
      await sleep(10000);
    }
  }

  console.log('\n=== Done ===');
  console.log(`Success: ${total - failed}/${total}`);
  if (failures.length > 0) {
    console.log(`\nFailed (${failures.length}):`);
    for (const f of failures) console.log(`  ${f.name}: ${f.error}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
