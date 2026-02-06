// Test FLUX.1 Kontext Pro for editing body-mod stat variants
// Takes the balanced image and applies targeted stat edits
// Test: air crawler — attack, defense, hp, speed, claw
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const OUTPUT_DIR = path.join(BASE_DIR, 'test-kontext');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Source: the existing air crawler balanced image (which looks good)
const SOURCE_IMAGE = path.join(BASE_DIR, 'air', 'crawler-balanced.webp');

// Edit instructions — describe only what to CHANGE, not the whole image
const EDITS = [
  {
    stat: 'attack',
    prompt: 'Make the battle claws much larger, sharper, and more dangerous looking. Add glowing energy sparks on the serrated claw edges. The claw arms should be bigger and more reinforced.',
  },
  {
    stat: 'defense',
    prompt: 'Add thick layered armor plating covering the entire body. Add a reinforced face shield visor, shoulder armor plates, and armored guards on all legs. The armor should look heavy with visible bolts and weld lines.',
  },
  {
    stat: 'hp',
    prompt: 'Add glowing green vitality runes and symbols across the entire shell surface. Add a pulsing green health crystal embedded in the chest. Add green regeneration particles swirling around the body and a green healing aura outline around the silhouette.',
  },
  {
    stat: 'speed',
    prompt: 'Make the body much thinner and more streamlined and aerodynamic. Add a visible speed afterimage ghost trail behind the body showing motion copies. Add motion blur streaks and wind tunnel effect lines.',
  },
  {
    stat: 'claw',
    prompt: 'Make the claws glow with bright plasma energy, wrapped in crackling lightning arcs. Add visible neon energy veins running from the chest through the arms to glowing white-hot claw tips. The claws should radiate intense energy light.',
  },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fileToDataUri(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.png' ? 'image/webp' : 'image/jpeg';
  const data = fs.readFileSync(filepath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

function fetchWithTimeout(url, options, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function callKontext(prompt, inputImageDataUri) {
  const input = {
    prompt,
    input_image: inputImageDataUri,
    aspect_ratio: 'match_input_image',
    output_format: 'png',
    safety_tolerance: 2,
  };

  const createResponse = await fetchWithTimeout('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait',
    },
    body: JSON.stringify({
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

  if (!fs.existsSync(SOURCE_IMAGE)) {
    console.error(`Source image not found: ${SOURCE_IMAGE}`);
    process.exit(1);
  }

  const sourceDataUri = fileToDataUri(SOURCE_IMAGE);
  console.log(`Source: air/crawler-balanced.png`);
  console.log(`Output: test-kontext/\n`);

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < EDITS.length; i++) {
    const edit = EDITS[i];
    const outFile = `crawler-${edit.stat}.png`;
    const outPath = path.join(OUTPUT_DIR, outFile);

    console.log(`[${i + 1}/${EDITS.length}] ${edit.stat}`);
    console.log(`  Prompt: ${edit.prompt.substring(0, 80)}...`);

    try {
      const imageUrl = await callKontext(edit.prompt, sourceDataUri);
      if (!imageUrl) throw new Error('No URL returned');
      const bytes = await downloadImage(imageUrl, outPath);
      console.log(`  SAVED ${outFile} (${(bytes / 1024).toFixed(0)} KB)`);
      generated++;
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${err.message}`);
    }

    if (i < EDITS.length - 1) await sleep(5000);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`KONTEXT TEST COMPLETE`);
  console.log(`Generated: ${generated} | Failed: ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
