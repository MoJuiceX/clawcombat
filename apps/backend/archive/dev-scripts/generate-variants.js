// Generate pre-made avatar variants for free tier fallback
// Run: node generate-variants.js
// Downloads images from Replicate FLUX 2 Pro and saves as WebP

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { buildSkinPrompt } = require('./src/services/skin-generator.js');
const { generateFreeAvatar, getReferenceImageUrl } = require('./src/services/image-gen.js');

const TYPES = [
  'NEUTRAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE',
  'MARTIAL', 'VENOM', 'EARTH', 'AIR', 'PSYCHE', 'INSECT',
  'STONE', 'GHOST', 'DRAGON', 'SHADOW', 'METAL', 'MYSTIC'
];

// Stat distributions — total always 100
const STAT_PROFILES = {
  balanced: { hp: 17, attack: 17, defense: 17, sp_atk: 17, sp_def: 16, speed: 16 },
  hp:       { hp: 35, attack: 13, defense: 13, sp_atk: 13, sp_def: 13, speed: 13 },
  attack:   { hp: 13, attack: 35, defense: 13, sp_atk: 13, sp_def: 13, speed: 13 },
  defense:  { hp: 13, attack: 13, defense: 35, sp_atk: 13, sp_def: 13, speed: 13 },
  sp_atk:   { hp: 13, attack: 13, defense: 13, sp_atk: 35, sp_def: 13, speed: 13 },
  sp_def:   { hp: 13, attack: 13, defense: 13, sp_atk: 13, sp_def: 35, speed: 13 },
  speed:    { hp: 13, attack: 13, defense: 13, sp_atk: 13, sp_def: 13, speed: 35 },
};

// CLI flags
const args = process.argv.slice(2);
const getFlag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const SEED = getFlag('seed') ? parseInt(getFlag('seed')) : null;
const VERSION = getFlag('version') || 'v0';
const OUTPUT_SUFFIX = getFlag('output') || `${VERSION}-t1`;

// Which profiles to generate (pass as positional args, or defaults to balanced)
const requestedProfiles = args.filter(a => !a.startsWith('--') && !(args[args.indexOf(a) - 1] || '').startsWith('--'));
const profiles = requestedProfiles.length > 0 ? requestedProfiles : ['balanced'];

// Validate profiles
for (const p of profiles) {
  if (!STAT_PROFILES[p]) {
    console.error(`Unknown profile: ${p}. Options: ${Object.keys(STAT_PROFILES).join(', ')}`);
    process.exit(1);
  }
}

const OUTPUT_DIR = path.join(__dirname, 'src', 'public', 'references', 'variants', OUTPUT_SUFFIX);

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

async function main() {
  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const total = profiles.length * TYPES.length;
  let completed = 0;
  let failed = 0;
  const failures = [];

  console.log(`=== Generating ${total} variant images ===`);
  console.log(`Profiles: ${profiles.join(', ')}`);
  console.log(`Types: ${TYPES.length}`);
  console.log(`Reference version: ${VERSION}`);
  console.log(`Seed: ${SEED != null ? SEED : 'random'}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Estimated cost: ~$${(total * 0.04).toFixed(2)}`);
  console.log('');

  for (const profile of profiles) {
    const stats = STAT_PROFILES[profile];

    for (const type of TYPES) {
      completed++;
      const filename = `${type.toLowerCase()}-${profile}.webp`;
      const filepath = path.join(OUTPUT_DIR, filename);

      // Skip if already exists
      if (fs.existsSync(filepath)) {
        console.log(`[${completed}/${total}] SKIP ${filename} (already exists)`);
        continue;
      }

      const agent = {
        name: `${type}-${profile}`,
        ai_type: type,
        xp: 0,
        base_hp: stats.hp,
        base_attack: stats.attack,
        base_defense: stats.defense,
        base_sp_atk: stats.sp_atk,
        base_sp_def: stats.sp_def,
        base_speed: stats.speed,
      };

      const prompt = buildSkinPrompt(agent, 1);

      console.log(`[${completed}/${total}] Generating ${filename}...`);
      console.log(`  Reference: ${getReferenceImageUrl(type, VERSION)}`);
      if (SEED != null) console.log(`  Seed: ${SEED}`);

      try {
        const options = {};
        if (SEED != null) options.seed = SEED;
        const result = await generateFreeAvatar(prompt, type, options);

        if (result.error || !result.url) {
          throw new Error(result.error || 'No URL returned');
        }

        // Download and save
        const bytes = await downloadImage(result.url, filepath);
        const kb = (bytes / 1024).toFixed(0);
        console.log(`  SAVED ${filename} (${kb} KB)`);
      } catch (err) {
        failed++;
        failures.push({ type, profile, error: err.message });
        console.error(`  FAILED: ${err.message}`);
      }

      // Pace requests — 12 second gap to stay well within rate limits
      if (completed < total) {
        console.log('  Waiting 12s...');
        await sleep(12000);
      }
    }
  }

  console.log('\n=== Generation Complete ===');
  console.log(`Success: ${total - failed}/${total}`);
  if (failures.length > 0) {
    console.log(`\nFailed (${failures.length}):`);
    for (const f of failures) {
      console.log(`  ${f.type}-${f.profile}: ${f.error}`);
    }
    console.log('\nRe-run the script to retry failed ones (existing files are skipped).');
  }

  // List all generated files
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.webp'));
  console.log(`\nFiles in ${OUTPUT_DIR}: ${files.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
