// Rounds 2-7: FLUX 2 Pro fire type with stat-focused prompts
// Each round uses a different stat emphasis, all 6 bases
// Run: node generate-flux-fire-rounds.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const INPUT_DIR = path.join(BASE_DIR, 'bases-qwen-v2');

const BASES = [
  { name: 'crawler', file: 'base-water.webp' },
  { name: 'cadet',   file: 'base-neutral.webp' },
  { name: 'scout',   file: 'base-venom.webp' },
  { name: 'peeper',  file: 'base-earth.webp' },
  { name: 'titan',   file: 'base-nature.webp' },
  { name: 'warbot',  file: 'base-metal.webp' },
];

// v3 prompts: quality/style FIRST, then stat descriptor, legs added back, HP reworked as energy effects
const ROUNDS = [
  {
    stat: 'attack',
    folder: 'test-flux-fire-attack-v3',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. GIANT deadly sword-like battle claws twice the body size, jagged serrated blade edges dripping with sparks, aggressive lunging attack stance. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, flame trails, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  {
    stat: 'defense',
    folder: 'test-flux-fire-defense-v3',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. EXTREMELY thick heavy armor plating covering entire body, massive shield-like shell panels doubled in layers, armored face guard, wide immovable tank stance, fortress-like exoskeleton. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, flame trails, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  {
    stat: 'hp',
    folder: 'test-flux-fire-hp-v3',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Glowing green vitality runes covering entire shell, bright pulsing health aura radiating from core, regeneration particles swirling around body, extra reinforced chest armor with life crystal embedded. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, flame trails, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  {
    stat: 'speed',
    folder: 'test-flux-fire-speed-v3',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. ULTRA sleek razor-thin aerodynamic body, half the normal width, needle-sharp lightweight limbs, speed afterimage ghost trail, blurred motion streaks, sprint racing pose leaning forward. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, flame trails, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  {
    stat: 'claw',
    folder: 'test-flux-fire-claw-v3',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. INTENSELY glowing plasma energy claws radiating blinding fire light, crackling electricity arcs between claw tips, visible neon energy veins running from core through arms to claws, ranged energy blast pose. Chibi cybernetic robot lobster, fire-type, blazing orange-red shell #F08030, molten ember core, six crustacean walking legs. Fiery volcanic arena with lava pools.`,
  },
  {
    stat: 'shell',
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

  for (let r = 0; r < ROUNDS.length; r++) {
    const round = ROUNDS[r];
    const roundNum = r + 2; // Rounds 2-7
    const outputDir = path.join(BASE_DIR, round.folder);
    fs.mkdirSync(outputDir, { recursive: true });

    console.log(`\n${'='.repeat(50)}`);
    console.log(`ROUND ${roundNum}: ${round.stat.toUpperCase()}-focused Fire`);
    console.log(`Prompt (${round.prompt.split(/\s+/).length} words)`);
    console.log(`Output: ${round.folder}`);
    console.log(`${'='.repeat(50)}`);

    for (let i = 0; i < BASES.length; i++) {
      const base = BASES[i];
      const outFile = `${base.name}-fire.webp`;
      const outPath = path.join(outputDir, outFile);

      if (fs.existsSync(outPath)) {
        console.log(`  [${i + 1}/${BASES.length}] SKIP ${outFile} (exists)`);
        continue;
      }

      const inputPath = path.join(INPUT_DIR, base.file);
      if (!fs.existsSync(inputPath)) {
        console.error(`  [${i + 1}/${BASES.length}] MISSING: ${base.file}`);
        totalFailed++;
        continue;
      }

      const dataUri = fileToDataUri(inputPath);
      console.log(`  [${i + 1}/${BASES.length}] ${base.name}`);

      try {
        const imageUrl = await callFlux(round.prompt, dataUri, { seed: SEED });
        if (!imageUrl) throw new Error('No URL returned');

        const bytes = await downloadImage(imageUrl, outPath);
        console.log(`    SAVED ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
        totalGenerated++;
      } catch (err) {
        totalFailed++;
        console.error(`    FAILED: ${err.message}`);
      }

      // Rate limit
      await sleep(8000);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`ALL ROUNDS COMPLETE`);
  console.log(`Generated: ${totalGenerated} | Failed: ${totalFailed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
