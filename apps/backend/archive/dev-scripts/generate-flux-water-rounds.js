// Water type: Balanced + 6 stat rounds for all 6 bases
// Same prompt structure as fire, swapping type visuals
// Run: node generate-flux-water-rounds.js

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

// Water type visuals:
// Color: deep ocean-blue #6890F0
// Energy: bioluminescent cooling veins, water ripple effects
// Arena: deep underwater arena with coral reefs, bubbles, caustic light rays

const TYPE_COLOR = 'deep ocean-blue shell #6890F0';
const TYPE_ENERGY = 'bioluminescent blue cooling veins, water ripple effects';
const TYPE_ARENA = 'Deep underwater arena with coral reefs, bubbles, and caustic light rays.';

const ROUNDS = [
  {
    stat: 'balanced',
    folder: 'test-flux-water',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Chibi cybernetic robot lobster, water-type, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${TYPE_ARENA}`,
  },
  {
    stat: 'attack',
    folder: 'test-flux-water-attack',
    // Titan gets v3-style (with stance language), others get v6-style (no stance)
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Enormous oversized battle claws three times normal size, jagged serrated razor-sharp pincers with water jets spraying from edges, heavy reinforced claw arms. Chibi cybernetic robot lobster, water-type, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${TYPE_ARENA}`,
    // Titan-specific prompt with stance (worked for fire)
    titanPrompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. GIANT deadly battle claws twice the body size, jagged serrated blade edges with water jets, aggressive lunging attack stance. Chibi cybernetic robot lobster, water-type, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${TYPE_ARENA}`,
  },
  {
    stat: 'defense',
    folder: 'test-flux-water-defense',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. EXTREMELY thick heavy armor plating covering entire body, massive shield-like shell panels doubled in layers, armored face guard, fortress-like exoskeleton. Chibi cybernetic robot lobster, water-type, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${TYPE_ARENA}`,
  },
  {
    stat: 'hp',
    folder: 'test-flux-water-hp',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. Glowing green vitality runes covering entire shell, bright pulsing health aura radiating from core, regeneration particles swirling around body, extra reinforced chest armor with life crystal embedded. Chibi cybernetic robot lobster, water-type, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${TYPE_ARENA}`,
  },
  {
    stat: 'speed',
    folder: 'test-flux-water-speed',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. ULTRA sleek razor-thin aerodynamic body, half the normal width, needle-sharp lightweight limbs, speed afterimage ghost trail, blurred motion streaks, sprint racing pose leaning forward. Chibi cybernetic robot lobster, water-type, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${TYPE_ARENA}`,
  },
  {
    stat: 'claw',
    folder: 'test-flux-water-claw',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. INTENSELY glowing plasma energy claws radiating blinding blue water light, crackling electricity arcs between claw tips, visible neon energy veins running from core through arms to claws, ranged energy blast pose. Chibi cybernetic robot lobster, water-type, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${TYPE_ARENA}`,
  },
  {
    stat: 'shell',
    folder: 'test-flux-water-shell',
    prompt: `Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8. TRIPLE-LAYERED ultra-fortified shell with visible glowing energy barrier force field surrounding entire body, translucent hexagonal shield grid, damage absorption runes etched into armor, impenetrable cocoon of protection. Chibi cybernetic robot lobster, water-type, ${TYPE_COLOR}, ${TYPE_ENERGY}, six crustacean walking legs. ${TYPE_ARENA}`,
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
    const outputDir = path.join(BASE_DIR, round.folder);
    fs.mkdirSync(outputDir, { recursive: true });

    console.log(`\n${'='.repeat(50)}`);
    console.log(`WATER ${round.stat.toUpperCase()}`);
    console.log(`Output: ${round.folder}`);
    console.log(`${'='.repeat(50)}`);

    for (let i = 0; i < BASES.length; i++) {
      const base = BASES[i];
      const outFile = `${base.name}-water.webp`;
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

      // Use titan-specific prompt for attack if available
      const prompt = (round.titanPrompt && base.name === 'titan') ? round.titanPrompt : round.prompt;

      const dataUri = fileToDataUri(inputPath);
      console.log(`  [${i + 1}/${BASES.length}] ${base.name}`);

      try {
        const imageUrl = await callFlux(prompt, dataUri, { seed: SEED });
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
  console.log(`ALL WATER ROUNDS COMPLETE`);
  console.log(`Generated: ${totalGenerated} | Failed: ${totalFailed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
