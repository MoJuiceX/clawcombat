// Generate refined base reference images using FLUX 2 Pro
// Uses existing hand-crafted images + variants as multi-reference input
// Run: node generate-base-images.js --from v0 --to v1 --seed 12345

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { generateFreeAvatar, getReferenceImageUrl } = require('./src/services/image-gen.js');
const { TYPE_HEX } = require('./src/services/skin-generator.js');

const TYPES = [
  'NEUTRAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE',
  'MARTIAL', 'VENOM', 'EARTH', 'AIR', 'PSYCHE', 'INSECT',
  'STONE', 'GHOST', 'DRAGON', 'SHADOW', 'METAL', 'MYSTIC'
];

// CLI flags
const args = process.argv.slice(2);
const getFlag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const FROM_VERSION = getFlag('from') || 'v0';
const TO_VERSION = getFlag('to') || 'v1';
const SEED = getFlag('seed') ? parseInt(getFlag('seed')) : 12345;
const SINGLE_TYPE = getFlag('type') ? getFlag('type').toUpperCase() : null;

const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.BASE_URL || 'https://clawcombat.com');

const OUTPUT_DIR = path.join(__dirname, 'src', 'public', 'references', TO_VERSION);

async function downloadImage(url, filepath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filepath, buffer);
  return buffer.length;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Build a neutral base prompt per type (~40 words, no stat variation)
function buildBasePrompt(type) {
  const typeInfo = TYPE_HEX[type] || TYPE_HEX.NEUTRAL;
  const typeLower = type.toLowerCase();
  return `Chibi cybernetic robot lobster, ${typeLower}-type, shell color ${typeInfo.hex}, ${typeInfo.glow}, balanced proportions, standard claws, 6 walking legs, small dark glossy black eyes, antennae, segmented tail. 3D digital art, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8, studio lighting.`;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const types = SINGLE_TYPE ? [SINGLE_TYPE] : TYPES;
  const total = types.length;
  let completed = 0;
  let failed = 0;
  const failures = [];

  console.log(`=== Generating ${total} base reference images ===`);
  console.log(`From: ${FROM_VERSION} → To: ${TO_VERSION}`);
  console.log(`Seed: ${SEED}`);
  console.log(`Resolution: 2 MP`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Estimated cost: ~$${(total * 0.05).toFixed(2)}`);
  console.log('');

  for (const type of types) {
    completed++;
    const filename = `${type.toLowerCase()}-type-young.webp`;
    const filepath = path.join(OUTPUT_DIR, filename);

    // Skip if already exists
    if (fs.existsSync(filepath)) {
      console.log(`[${completed}/${total}] SKIP ${filename} (already exists)`);
      continue;
    }

    // Build multi-reference images: base + variant (if exists)
    const referenceImages = [
      `${BASE_URL}/references/${FROM_VERSION}/${type.toLowerCase()}-type-young.webp`
    ];
    const variantPath = path.join(__dirname, 'src', 'public', 'references', 'variants', `${FROM_VERSION}-t1`, `${type.toLowerCase()}-balanced.webp`);
    if (fs.existsSync(variantPath)) {
      referenceImages.push(`${BASE_URL}/references/variants/${FROM_VERSION}-t1/${type.toLowerCase()}-balanced.webp`);
    }

    const prompt = buildBasePrompt(type);

    console.log(`[${completed}/${total}] Generating ${filename}...`);
    console.log(`  References: ${referenceImages.length} images`);
    console.log(`  Prompt (${prompt.split(/\s+/).length} words)`);

    try {
      const result = await generateFreeAvatar(prompt, type, {
        referenceImages,
        seed: SEED,
        resolution: '2 MP',
        output_quality: 95,
      });

      if (result.error || !result.url) {
        throw new Error(result.error || 'No URL returned');
      }

      const bytes = await downloadImage(result.url, filepath);
      const kb = (bytes / 1024).toFixed(0);
      console.log(`  SAVED ${filename} (${kb} KB)`);
    } catch (err) {
      failed++;
      failures.push({ type, error: err.message });
      console.error(`  FAILED: ${err.message}`);
    }

    // Rate limit: 12s between requests
    if (completed < total) {
      console.log('  Waiting 12s...');
      await sleep(12000);
    }
  }

  console.log('\n=== Generation Complete ===');
  console.log(`Success: ${total - failed}/${total}`);
  if (failures.length > 0) {
    console.log(`\nFailed (${failures.length}):`);
    for (const f of failures) {
      console.log(`  ${f.type}: ${f.error}`);
    }
    console.log('\nRe-run the script to retry failed ones (existing files are skipped).');
  }

  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.webp'));
  console.log(`\nFiles in ${OUTPUT_DIR}: ${files.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
