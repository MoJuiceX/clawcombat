// Regenerate all fire variants for new Sentinel base (FLUX D hybrid)
// Balanced + Attack v6 + Defense v3 + HP v3 + Speed v3 + Claw v3 + Shell v3
// Run: node generate-new-sentinel-fire.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const INPUT_DIR = path.join(BASE_DIR, 'bases-qwen-v2');
const SENTINEL = { name: 'sentinel', file: 'base-ice.webp' };

const JOBS = [
  {
    label: 'Balanced',
    folder: 'test-flux-fire',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Chibi cybernetic robot lobster, fire-type, blazing orange-red armored shell #F08030, molten ember core glowing through chest vents, flame trails from joints, six crustacean walking legs. Fiery volcanic arena with lava pools and ember particles.`,
  },
  {
    label: 'Attack v6',
    folder: 'test-flux-fire-attack-v6',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Enormous oversized battle claws three times normal size, jagged serrated razor-sharp pincers with sparks flying from edges, heavy reinforced claw arms. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, flame trails, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  {
    label: 'Defense v3',
    folder: 'test-flux-fire-defense-v3',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. EXTREMELY thick heavy armor plating covering entire body, massive shield-like shell panels doubled in layers, armored face guard, wide immovable tank stance, fortress-like exoskeleton. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, flame trails, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  {
    label: 'HP v3',
    folder: 'test-flux-fire-hp-v3',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Glowing green vitality runes covering entire shell, bright pulsing health aura radiating from core, regeneration particles swirling around body, extra reinforced chest armor with life crystal embedded. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, flame trails, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  {
    label: 'Speed v3',
    folder: 'test-flux-fire-speed-v3',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. ULTRA sleek razor-thin aerodynamic body, half the normal width, needle-sharp lightweight limbs, speed afterimage ghost trail, blurred motion streaks, sprint racing pose leaning forward. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, flame trails, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  {
    label: 'Claw v3',
    folder: 'test-flux-fire-claw-v3',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. INTENSELY glowing plasma energy claws radiating blinding fire light, crackling electricity arcs between claw tips, visible neon energy veins running from core through arms to claws, ranged energy blast pose. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  {
    label: 'Shell v3',
    folder: 'test-flux-fire-shell-v3',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. TRIPLE-LAYERED ultra-fortified shell with visible glowing energy barrier force field surrounding entire body, translucent hexagonal shield grid, damage absorption runes etched into armor, impenetrable cocoon of protection. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
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

  const inputPath = path.join(INPUT_DIR, SENTINEL.file);
  const dataUri = fileToDataUri(inputPath);

  console.log('=== Regenerating Sentinel Fire Variants (new hybrid base) ===\n');

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < JOBS.length; i++) {
    const job = JOBS[i];
    const outputDir = path.join(BASE_DIR, job.folder);
    fs.mkdirSync(outputDir, { recursive: true });
    const outFile = `${SENTINEL.name}-fire.webp`;
    const outPath = path.join(outputDir, outFile);

    console.log(`[${i + 1}/${JOBS.length}] ${job.label}`);

    try {
      const imageUrl = await callFlux(job.prompt, dataUri, SEED);
      if (!imageUrl) throw new Error('No URL');
      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`  SAVED ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
      generated++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failed++;
    }

    if (i < JOBS.length - 1) await sleep(8000);
  }

  console.log(`\n=== Done: ${generated} generated, ${failed} failed ===`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
