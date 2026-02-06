// Attack v6: NO stance/pose language at all. Just describe bigger claws.
// Let the reference image control the pose/angle.
// Also: Sentinel Defense v2 (remove "tank stance" language)
// Run: node generate-attack-v6.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const INPUT_DIR = path.join(BASE_DIR, 'bases-qwen-v2');

const ALL_BASES = [
  { name: 'crawler',  file: 'base-water.webp' },
  { name: 'cadet',    file: 'base-neutral.webp' },
  { name: 'scout',    file: 'base-venom.webp' },
  { name: 'peeper',   file: 'base-earth.webp' },
  { name: 'sentinel', file: 'base-ice.webp' },
];

const SENTINEL = [{ name: 'sentinel', file: 'base-ice.webp' }];

const JOBS = [
  // Attack v6: all 5 bases (Titan keeps v3)
  // NO stance language. NO pose language. Just claws.
  {
    label: 'Attack v6 (no pose language)',
    folder: 'test-flux-fire-attack-v6',
    bases: ALL_BASES,
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Enormous oversized battle claws three times normal size, jagged serrated razor-sharp pincers with sparks flying from edges, heavy reinforced claw arms. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, flame trails, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  // Sentinel Defense v2: remove "tank stance", just describe armor
  {
    label: 'Sentinel Defense v2 (no pose language)',
    folder: 'test-flux-fire-defense-v4',
    bases: SENTINEL,
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. EXTREMELY thick heavy armor plating covering entire body, massive shield-like shell panels doubled in layers, armored face guard, fortress-like reinforced exoskeleton with layered shoulder plates. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, flame trails, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
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

  if (prediction.status !== 'succeeded') {
    throw new Error(`Timed out, status: ${prediction.status}`);
  }

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
    console.error('REPLICATE_API_TOKEN is not set in .env');
    process.exit(1);
  }

  let totalGenerated = 0;
  let totalFailed = 0;

  for (const job of JOBS) {
    const outputDir = path.join(BASE_DIR, job.folder);
    fs.mkdirSync(outputDir, { recursive: true });

    console.log(`\n${'='.repeat(50)}`);
    console.log(job.label);
    console.log(`Prompt (${job.prompt.split(/\s+/).length} words)`);
    console.log(`Output: ${job.folder}`);
    console.log(`${'='.repeat(50)}`);

    for (let i = 0; i < job.bases.length; i++) {
      const base = job.bases[i];
      const outFile = `${base.name}-fire.webp`;
      const outPath = path.join(outputDir, outFile);

      const inputPath = path.join(INPUT_DIR, base.file);
      if (!fs.existsSync(inputPath)) {
        console.error(`  [${i + 1}/${job.bases.length}] MISSING: ${base.file}`);
        totalFailed++;
        continue;
      }

      const dataUri = fileToDataUri(inputPath);
      console.log(`  [${i + 1}/${job.bases.length}] ${base.name}`);

      try {
        const imageUrl = await callFlux(job.prompt, dataUri, { seed: SEED });
        if (!imageUrl) throw new Error('No URL returned');

        const bytes = await downloadImage(imageUrl, outPath);
        console.log(`    SAVED ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
        totalGenerated++;
      } catch (err) {
        totalFailed++;
        console.error(`    FAILED: ${err.message}`);
      }

      await sleep(8000);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`ALL JOBS COMPLETE`);
  console.log(`Generated: ${totalGenerated} | Failed: ${totalFailed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
