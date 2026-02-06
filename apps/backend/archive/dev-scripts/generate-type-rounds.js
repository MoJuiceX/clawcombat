// Generic type stat round generator
// Generates all 7 stat variants for all 6 bases for a given type
// Uses clean folder structure: references/{type}/{base}-{stat}.webp
// Run: node generate-type-rounds.js <type>
// Example: node generate-type-rounds.js electric

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const SEED = 77777;
const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');
const BASES_DIR = path.join(BASE_DIR, 'bases');

const BASES = [
  { name: 'crawler',  file: 'crawler.webp' },
  { name: 'cadet',    file: 'cadet.webp' },
  { name: 'scout',    file: 'scout.webp' },
  { name: 'sentinel', file: 'sentinel.webp' },
  { name: 'peeper',   file: 'peeper.webp' },
  { name: 'titan',    file: 'titan.webp' },
];

const STYLE = 'Highly detailed sharp 3D digital art, high contrast, cyberpunk gaming aesthetic, shot on Sony A7IV 50mm f/2.8.';

// Type definitions: color, energy, arena
const TYPES = {
  electric: {
    color: 'bright electric-yellow shell #F8D030',
    energy: 'crackling lightning arcs across body, electric sparks',
    arena: 'Electric storm arena with Tesla coils, lightning bolts striking ground, charged particle effects in air.',
  },
  grass: {
    color: 'vibrant leaf-green shell #78C850',
    energy: 'glowing vine circuits, photosynthesis energy pulses',
    arena: 'Overgrown jungle arena with bioluminescent plants, thick vines, moss-covered ruins.',
  },
  ice: {
    color: 'pale frost-blue shell #98D8D8',
    energy: 'freezing crystalline frost patterns, cold vapor trails',
    arena: 'Frozen tundra arena with ice pillars, snowfall, aurora borealis in sky.',
  },
  venom: {
    color: 'toxic purple shell #A040A0',
    energy: 'dripping toxic sludge veins, poison mist',
    arena: 'Toxic swamp arena with bubbling acid pools, poisonous spore clouds, corroded metal.',
  },
  earth: {
    color: 'sandy brown shell #E0C068',
    energy: 'rumbling seismic cracks, dust particle effects',
    arena: 'Desert canyon arena with cracked earth, sandstorm, towering rock formations.',
  },
  air: {
    color: 'sky-blue shell #A890F0',
    energy: 'swirling wind currents, feather-light glow',
    arena: 'High altitude sky arena with clouds below, strong wind gusts, floating platforms.',
  },
  psyche: {
    color: 'pink-magenta shell #F85888',
    energy: 'pulsing psychic aura waves, mind energy glow',
    arena: 'Surreal psychic arena with floating geometric shapes, warped space, neon mind waves.',
  },
  insect: {
    color: 'yellow-green shell #A8B820',
    energy: 'chitinous bio-electric pulses, compound eye reflections',
    arena: 'Giant forest floor arena with oversized mushrooms, fallen leaves, insect hive structures.',
  },
  stone: {
    color: 'gray-brown rocky shell #B8A038',
    energy: 'crumbling stone debris, mineral crystal glow',
    arena: 'Rocky mountain arena with boulders, gravel, ancient stone pillars.',
  },
  shadow: {
    color: 'dark charcoal shell #705848',
    energy: 'creeping shadow tendrils, dark energy wisps',
    arena: 'Dark alley arena with dim streetlights, long shadows, ominous fog.',
  },
  metal: {
    color: 'polished steel-gray shell #B8B8D0',
    energy: 'gleaming metallic reflections, magnetic field lines',
    arena: 'Industrial forge arena with molten metal rivers, steel beams, sparking welders.',
  },
  mystic: {
    color: 'pastel pink shell #EE99AC',
    energy: 'sparkling fairy dust particles, enchanted glow',
    arena: 'Enchanted garden arena with glowing flowers, floating crystals, rainbow light beams.',
  },
  martial: {
    color: 'brick-red shell #C03028',
    energy: 'focused chi aura, battle energy radiating from core',
    arena: 'Martial arts dojo arena with wooden training dummies, stone floor, hanging lanterns.',
  },
  neutral: {
    color: 'warm beige shell #A8A878',
    energy: 'subtle neutral energy hum, balanced aura',
    arena: 'Clean esports arena with spotlights, smooth gray floor, tournament banners.',
  },
  dragon: {
    color: 'deep indigo-violet shell #7038F8',
    energy: 'draconic fire breath wisps, ancient power glow',
    arena: 'Dragon lair arena with treasure hoard, ancient runes, volcanic vents.',
  },
  ghost: {
    color: 'ethereal purple shell #705898',
    energy: 'spectral translucent shell sections, ghostly wisps',
    arena: 'Haunted graveyard arena with floating tombstones, spectral fog, eerie moonlight.',
  },
};

// Body-mod types need MUCH stronger stat prompts since the base is already visually complex
const bodyModTypes = ['dragon', 'ghost', 'mystic', 'air'];

// Stat round prompt templates
function buildRounds(type) {
  const t = TYPES[type];
  if (!t) return null;

  const isBodyMod = bodyModTypes.includes(type);
  const bodyModFeature = {
    dragon: 'with dragon wings and horns',
    ghost: 'with translucent ghostly body',
    mystic: 'with fairy wings and sparkles',
    air: 'with wings',
  }[type] || '';

  const subject = isBodyMod
    ? `Chibi cybernetic robot lobster ${bodyModFeature}, ${type}-type, ${t.color}, ${t.energy}, six crustacean walking legs.`
    : `Chibi cybernetic robot lobster, ${type}-type, ${t.color}, ${t.energy}, six crustacean walking legs.`;

  if (isBodyMod) {
    // STRONGER prompts for body-mod types — stat visuals front-loaded and extreme
    return [
      {
        stat: 'balanced',
        prompt: `${STYLE} ${subject} ${t.arena}`,
      },
      {
        stat: 'attack',
        prompt: `${STYLE} MASSIVE razor-sharp battle claws FOUR TIMES bigger than the body, glowing red-hot serrated pincer edges with sparking energy, veins of power running through oversized claw arms. ${subject} ${t.arena}`,
      },
      {
        stat: 'defense',
        prompt: `${STYLE} FORTRESS of layered armor plates covering every surface, thick riveted steel panels doubled and tripled over body, heavy reinforced face shield visor, shoulder pauldrons, armored leg guards on all legs, visible bolts and weld lines. ${subject} ${t.arena}`,
      },
      {
        stat: 'hp',
        prompt: `${STYLE} BRILLIANT green vitality runes and symbols glowing across ENTIRE shell surface, large pulsing green health crystal embedded in chest, bright green regeneration particle cloud swirling around body, visible green healing aura outline around silhouette. ${subject} ${t.arena}`,
      },
      {
        stat: 'speed',
        prompt: `${STYLE} EXTREMELY thin streamlined needle-like body, paper-thin razor aerodynamic shell, visible speed afterimage trail showing THREE ghost copies behind, motion blur streaks, wind tunnel effect lines. ${subject} ${t.arena}`,
      },
      {
        stat: 'claw',
        prompt: `${STYLE} BLINDINGLY bright plasma energy claws wrapped in crackling lightning, visible neon energy veins running from chest core through arms to glowing white-hot claw tips, intense energy aura radiating from claws casting light on ground. ${subject} ${t.arena}`,
      },
      {
        stat: 'shell',
        prompt: `${STYLE} GLOWING translucent hexagonal energy barrier force field completely surrounding entire body like a bubble shield, visible honeycomb shield grid pattern, bright protective cocoon of light, shield ripple effects on surface. ${subject} ${t.arena}`,
      },
    ];
  }

  // Standard prompts for non-body-mod types (work well as-is)
  return [
    {
      stat: 'balanced',
      prompt: `${STYLE} ${subject} ${t.arena}`,
    },
    {
      stat: 'attack',
      prompt: `${STYLE} Enormous oversized battle claws three times normal size, jagged serrated razor-sharp pincers with energy sparks from edges, heavy reinforced claw arms. ${subject} ${t.arena}`,
    },
    {
      stat: 'defense',
      prompt: `${STYLE} EXTREMELY thick heavy armor plating covering entire body, massive shield-like shell panels doubled in layers, armored face guard, fortress-like exoskeleton. ${subject} ${t.arena}`,
    },
    {
      stat: 'hp',
      prompt: `${STYLE} Glowing green vitality runes covering entire shell, bright pulsing health aura radiating from core, regeneration particles swirling around body, extra reinforced chest armor with life crystal embedded. ${subject} ${t.arena}`,
    },
    {
      stat: 'speed',
      prompt: `${STYLE} ULTRA sleek razor-thin aerodynamic body, half the normal width, needle-sharp lightweight limbs, speed afterimage ghost trail, blurred motion streaks. ${subject} ${t.arena}`,
    },
    {
      stat: 'claw',
      prompt: `${STYLE} INTENSELY glowing plasma energy claws radiating blinding light, crackling electricity arcs between claw tips, visible neon energy veins running from core through arms to claws. ${subject} ${t.arena}`,
    },
    {
      stat: 'shell',
      prompt: `${STYLE} TRIPLE-LAYERED ultra-fortified shell with visible glowing energy barrier force field surrounding entire body, translucent hexagonal shield grid, damage absorption runes etched into armor, impenetrable cocoon of protection. ${subject} ${t.arena}`,
    },
  ];
}

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

  const args = process.argv.slice(2);
  const forceFlag = args.includes('--force');
  const typeName = args.find(a => !a.startsWith('--'));
  if (!typeName || !TYPES[typeName]) {
    console.error(`Usage: node generate-type-rounds.js <type> [--force]`);
    console.error(`  --force: delete all existing images and regenerate`);
    console.error(`Available: ${Object.keys(TYPES).join(', ')}`);
    process.exit(1);
  }

  const rounds = buildRounds(typeName);
  const outputDir = path.join(BASE_DIR, typeName);
  fs.mkdirSync(outputDir, { recursive: true });

  const useBodyMod = bodyModTypes.includes(typeName);

  // If --force, delete all non-balanced images (keep balanced since they're OK)
  if (forceFlag) {
    const stats = ['attack', 'defense', 'hp', 'speed', 'claw', 'shell'];
    for (const base of BASES) {
      for (const stat of stats) {
        const f = path.join(outputDir, `${base.name}-${stat}.webp`);
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
          console.log(`DELETED ${base.name}-${stat}.webp`);
        }
      }
    }
  }

  let totalGenerated = 0;
  let totalFailed = 0;

  for (const round of rounds) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`${typeName.toUpperCase()} ${round.stat.toUpperCase()}`);
    console.log(`${'='.repeat(50)}`);

    for (let i = 0; i < BASES.length; i++) {
      const base = BASES[i];
      const outFile = `${base.name}-${round.stat}.webp`;
      const outPath = path.join(outputDir, outFile);

      if (fs.existsSync(outPath)) {
        console.log(`  [${i + 1}/${BASES.length}] SKIP ${outFile} (exists)`);
        continue;
      }

      // Use body-mod base if available for this type, otherwise standard
      const baseFile = useBodyMod
        ? path.join(BASES_DIR, `${base.name}-${typeName}.webp`)
        : path.join(BASES_DIR, base.file);

      if (!fs.existsSync(baseFile)) {
        console.error(`  [${i + 1}/${BASES.length}] MISSING: ${baseFile}`);
        totalFailed++;
        continue;
      }

      const dataUri = fileToDataUri(baseFile);
      console.log(`  [${i + 1}/${BASES.length}] ${base.name}`);

      try {
        const imageUrl = await callFlux(round.prompt, dataUri, SEED);
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
  console.log(`ALL ${typeName.toUpperCase()} ROUNDS COMPLETE`);
  console.log(`Generated: ${totalGenerated} | Failed: ${totalFailed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
