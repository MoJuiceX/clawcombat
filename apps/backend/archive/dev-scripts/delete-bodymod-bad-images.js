// Delete specific bad body-mod type images so generate-type-rounds.js can regenerate them
// Ghost: delete ALL non-balanced (except sentinel-defense)
// Dragon: delete specific bad ones (keep OK claw/shell/speed/hp per character)
// Mystic: delete specific bad ones (keep OK shell + some claw)
const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, 'src', 'public', 'references');

const BASES = ['crawler', 'cadet', 'scout', 'sentinel', 'peeper', 'titan'];
const ALL_STATS = ['attack', 'defense', 'hp', 'speed', 'claw', 'shell'];

// Define what's OK (keep) per type — everything else gets deleted
const KEEP = {
  ghost: {
    // Only sentinel defense is OK besides balanced
    sentinel: ['defense'],
  },
  dragon: {
    // Crawler: claw, shell OK
    crawler: ['claw', 'shell'],
    // Cadet: claw, shell OK
    cadet: ['claw', 'shell'],
    // Scout: claw, shell, speed, hp OK
    scout: ['claw', 'shell', 'speed', 'hp'],
    // Sentinel: claw, shell OK
    sentinel: ['claw', 'shell'],
    // Peeper: claw OK
    peeper: ['claw'],
    // Titan: hp, claw, shell OK
    titan: ['hp', 'claw', 'shell'],
  },
  mystic: {
    // All shell OK, claw OK for titan/peeper/sentinel/cadet
    crawler: ['shell'],
    cadet: ['shell', 'claw'],
    scout: ['shell'],
    sentinel: ['shell', 'claw'],
    peeper: ['shell', 'claw'],
    titan: ['shell', 'claw'],
  },
};

let deleted = 0;
let kept = 0;

for (const [typeName, keepMap] of Object.entries(KEEP)) {
  const typeDir = path.join(BASE_DIR, typeName);
  console.log(`\n=== ${typeName.toUpperCase()} ===`);

  for (const base of BASES) {
    const okStats = keepMap[base] || [];

    for (const stat of ALL_STATS) {
      const file = path.join(typeDir, `${base}-${stat}.webp`);
      if (!fs.existsSync(file)) continue;

      if (okStats.includes(stat)) {
        console.log(`  KEEP  ${base}-${stat}.webp`);
        kept++;
      } else {
        fs.unlinkSync(file);
        console.log(`  DEL   ${base}-${stat}.webp`);
        deleted++;
      }
    }
  }
}

console.log(`\nDeleted: ${deleted} | Kept: ${kept}`);
