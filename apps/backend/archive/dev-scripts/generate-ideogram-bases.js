// Test Ideogram v3 Turbo with our 8 FLUX bases
// Uses img2img via the image parameter + prompt
// Run: node generate-ideogram-bases.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

const SEED = 77777;
const IMAGE_WEIGHT = 50; // 1-100, 50 = balanced between reference and prompt
const OUTPUT_DIR = path.join(__dirname, 'src', 'public', 'references', 'bases-ideogram');

const NEUTRAL_PROMPT = `Chibi cybernetic robot lobster, natural reddish-brown shell color, standard mechanical claws, 6 walking legs, small dark glossy black eyes, antennae, segmented armored tail. Neutral base form, balanced proportions. Plain smooth gray studio background, soft even lighting, no environment. 3D digital art, cyberpunk gaming aesthetic.`;

const NEGATIVE_PROMPT = `human eyes, realistic eyes, text, watermark, blurry, low quality`;

const BASES = [
  { name: 'base-neutral',  file: 'base-neutral.webp' },
  { name: 'base-water',    file: 'base-water.webp' },
  { name: 'base-grass',    file: 'base-grass.webp' },
  { name: 'base-ice',      file: 'base-ice.webp' },
  { name: 'base-venom',    file: 'base-venom.webp' },
  { name: 'base-earth',    file: 'base-earth.webp' },
  { name: 'base-metal',    file: 'base-metal.webp' },
  { name: 'base-nature',   file: 'base-nature.webp' },
];

const INPUT_DIR = path.join(__dirname, 'src', 'public', 'references', 'bases-neutral');

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

async function callIdeogram(prompt, imageDataUri, options = {}) {
  const input = {
    prompt,
    style_reference_images: [imageDataUri], // Pass reference image array for style transfer
    aspect_ratio: '1:1',
    style_type: 'General',
    magic_prompt_option: 'Off', // We want our exact prompt, no AI rewriting
    negative_prompt: NEGATIVE_PROMPT,
  };
  if (options.seed != null) input.seed = options.seed;

  const createResponse = await fetchWithTimeout('https://api.replicate.com/v1/models/ideogram-ai/ideogram-v3-turbo/predictions', {
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
    const err = new Error(`Replicate HTTP ${createResponse.status}: ${errText.substring(0, 400)}`);
    err.status = createResponse.status;
    throw err;
  }

  let prediction = await createResponse.json();

  // Poll if not done
  const maxAttempts = 120;
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

  console.log(`=== Testing Ideogram v3 Turbo — ${total} Bases ===`);
  console.log(`Seed: ${SEED} | Style: General | MagicPrompt: Off`);
  console.log(`Negative: ${NEGATIVE_PROMPT}`);
  console.log(`Prompt (${NEUTRAL_PROMPT.split(/\s+/).length} words)`);
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
    console.log(`[${completed}/${total}] ${base.name} — input: ${base.file}`);

    try {
      const imageUrl = await callIdeogram(NEUTRAL_PROMPT, dataUri, { seed: SEED });
      if (!imageUrl) throw new Error('No URL returned');

      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`  SAVED ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failed++;
      failures.push({ name: base.name, error: err.message });
      console.error(`  FAILED: ${err.message}`);
    }

    if (completed < total) {
      console.log('  Waiting 8s...');
      await sleep(8000);
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
