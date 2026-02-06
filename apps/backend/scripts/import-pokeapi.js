#!/usr/bin/env node
'use strict';

// ============================================================================
// PokeAPI Import Script for ClawCombat
// Fetches moves, natures, and type chart from pokeapi.co
// Saves as JSON files in src/data/ — NO runtime API calls needed
// ============================================================================

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'data');

const OUR_TYPES = [
  'NEUTRAL','FIRE','WATER','ELECTRIC','GRASS','ICE','MARTIAL','VENOM',
  'EARTH','AIR','PSYCHE','INSECT','STONE','GHOST','DRAGON','SHADOW','METAL','MYSTIC'
];

// Map PokeAPI type names to our uppercase format
const TYPE_MAP = {
  normal: 'NEUTRAL', fire: 'FIRE', water: 'WATER', electric: 'ELECTRIC',
  grass: 'GRASS', ice: 'ICE', fighting: 'MARTIAL', poison: 'VENOM',
  ground: 'EARTH', flying: 'AIR', psychic: 'PSYCHE', bug: 'INSECT',
  rock: 'STONE', ghost: 'GHOST', dragon: 'DRAGON', dark: 'SHADOW',
  steel: 'METAL', fairy: 'MYSTIC'
};

// Map PokeAPI stat names to our stat names
const STAT_MAP = {
  'hp': 'hp', 'attack': 'attack', 'defense': 'defense',
  'special-attack': 'sp_atk', 'special-defense': 'sp_def', 'speed': 'speed'
};

// Map PokeAPI ailment names to our status names
const AILMENT_MAP = {
  'burn': 'burned', 'venom': 'venom', 'paralysis': 'paralysis',
  'sleep': 'sleep', 'freeze': 'freeze', 'confusion': 'confusion',
  'badly-poison': 'venom' // treat toxic as regular poison
};

// Legacy move ID mapping (old hardcoded → closest PokeAPI equivalent)
const LEGACY_MOVE_TARGETS = {
  'normal_1': 'body-slam',      'normal_2': 'quick-attack',
  'normal_3': 'swords-dance',   'normal_4': 'double-edge',
  'fire_1': 'fire-blast',       'fire_2': 'flamethrower',
  'fire_3': 'will-o-wisp',      'fire_4': 'eruption',
  'water_1': 'hydro-pump',      'water_2': 'aqua-jet',
  'water_3': 'aqua-ring',       'water_4': 'surf',
  'electric_1': 'thunder',      'electric_2': 'thunderbolt',
  'electric_3': 'thunder-wave', 'electric_4': 'volt-tackle',
  'grass_1': 'solar-beam',      'grass_2': 'razor-leaf',
  'grass_3': 'leech-seed',      'grass_4': 'giga-drain',
  'ice_1': 'blizzard',          'ice_2': 'ice-beam',
  'ice_3': 'haze',              'ice_4': 'sheer-cold',
  'fighting_1': 'close-combat', 'fighting_2': 'brick-break',
  'fighting_3': 'bulk-up',      'fighting_4': 'focus-punch',
  'poison_1': 'gunk-shot',      'poison_2': 'poison-jab',
  'poison_3': 'toxic',          'poison_4': 'venoshock',
  'ground_1': 'earthquake',     'ground_2': 'mud-shot',
  'ground_3': 'shore-up',       'ground_4': 'fissure',
  'flying_1': 'brave-bird',     'flying_2': 'air-slash',
  'flying_3': 'tailwind',       'flying_4': 'sky-drop',
  'psychic_1': 'psyche',       'psychic_2': 'psybeam',
  'psychic_3': 'calm-mind',     'psychic_4': 'psystrike',
  'bug_1': 'megahorn',          'bug_2': 'x-scissor',
  'bug_3': 'string-shot',       'bug_4': 'lunge',
  'rock_1': 'stone-edge',       'rock_2': 'rock-slide',
  'rock_3': 'iron-defense',     'rock_4': 'head-smash',
  'ghost_1': 'shadow-force',    'ghost_2': 'shadow-claw',
  'ghost_3': 'curse',           'ghost_4': 'shadow-ball',
  'dragon_1': 'draco-meteor',   'dragon_2': 'dragon-pulse',
  'dragon_3': 'dragon-dance',   'dragon_4': 'outrage',
  'dark_1': 'dark-pulse',       'dark_2': 'crunch',
  'dark_3': 'nasty-plot',       'dark_4': 'sucker-punch',
  'steel_1': 'iron-tail',       'steel_2': 'metal-claw',
  'steel_3': 'iron-defense',    'steel_4': 'meteor-mash',
  'fairy_1': 'moonblast',       'fairy_2': 'dazzling-gleam',
  'fairy_3': 'wish',            'fairy_4': 'draining-kiss',
};

// ── Rate-limited fetch ──
let requestCount = 0;
async function apiFetch(url) {
  requestCount++;
  if (requestCount % 50 === 0) {
    console.log(`  [${requestCount} requests made, pausing 2s...]`);
    await new Promise(r => setTimeout(r, 2000));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status} for ${url}`);
  return res.json();
}

// ── Fetch all moves for a type ──
async function fetchMovesForType(typeName) {
  const typeData = await apiFetch(`https://pokeapi.co/api/v2/type/${typeName}`);
  const moveUrls = typeData.moves.map(m => m.url);
  console.log(`  ${typeName}: ${moveUrls.length} total moves found`);

  // Fetch all move details (batch of 10 at a time)
  const moves = [];
  for (let i = 0; i < moveUrls.length; i += 10) {
    const batch = moveUrls.slice(i, i + 10);
    const results = await Promise.all(batch.map(url => apiFetch(url).catch(() => null)));
    moves.push(...results.filter(Boolean));
  }
  return moves;
}

// ── Convert a PokeAPI move to our format ──
function convertMove(apiMove, ourType) {
  const effect = extractEffect(apiMove);
  const englishEntry = apiMove.flavor_text_entries?.find(e => e.language.name === 'en');
  const description = englishEntry?.flavor_text?.replace(/\n/g, ' ') || apiMove.name;

  return {
    id: `poke_${ourType.toLowerCase()}_${apiMove.name}`,
    pokeapi_id: apiMove.id,
    name: formatMoveName(apiMove.name),
    type: ourType,
    category: apiMove.damage_class?.name === 'physical' ? 'physical' : 'special',
    power: apiMove.power || 0,
    accuracy: apiMove.accuracy || 100,
    pp: apiMove.pp || 10,
    effect,
    description,
    priority: apiMove.priority || 0,
  };
}

// ── Extract effect from PokeAPI meta data ──
function extractEffect(apiMove) {
  const meta = apiMove.meta;
  if (!meta) return null;

  // Priority moves
  if (apiMove.priority > 0) {
    return { type: 'priority' };
  }

  // OHKO moves
  if (meta.category?.name === 'ohko') {
    return { type: 'ohko' };
  }

  // Drain moves (positive drain = heal, negative = recoil)
  if (meta.drain > 0) {
    return { type: 'drain', percent: meta.drain };
  }
  if (meta.drain < 0) {
    return { type: 'recoil', percent: Math.abs(meta.drain) };
  }

  // Healing moves
  if (meta.healing > 0) {
    return { type: 'heal', percent: meta.healing };
  }

  // Status ailments
  const ailment = meta.ailment?.name;
  if (ailment && ailment !== 'none' && AILMENT_MAP[ailment]) {
    const chance = meta.ailment_chance || 100;
    return { type: 'status', status: AILMENT_MAP[ailment], chance };
  }

  // Stat changes
  if (apiMove.stat_changes && apiMove.stat_changes.length > 0) {
    const change = apiMove.stat_changes[0];
    const statName = STAT_MAP[change.stat?.name] || change.stat?.name;
    const stages = change.change;

    if (stages > 0) {
      const result = { type: 'stat_boost', target: 'self', stat: statName, stages };
      if (apiMove.stat_changes.length > 1) {
        const c2 = apiMove.stat_changes[1];
        result.stat2 = STAT_MAP[c2.stat?.name] || c2.stat?.name;
        result.stages2 = c2.change;
      }
      return result;
    } else {
      const result = { type: 'stat_drop', target: 'opponent', stat: statName, stages: Math.abs(stages), chance: meta.stat_chance || 100 };
      if (apiMove.stat_changes.length > 1) {
        const c2 = apiMove.stat_changes[1];
        result.stat2 = STAT_MAP[c2.stat?.name] || c2.stat?.name;
        result.stages2 = Math.abs(c2.change);
      }
      // Self-targeting stat drops (like Close Combat)
      if (apiMove.target?.name === 'user' || (apiMove.power > 0 && meta.stat_chance === 0)) {
        result.target = 'self';
      }
      return result;
    }
  }

  // Flinch
  if (meta.flinch_chance > 0) {
    return { type: 'flinch', chance: meta.flinch_chance };
  }

  // High crit
  if (meta.crit_rate > 0) {
    return { type: 'high_crit', crit_rate: 12.5 * (meta.crit_rate + 1) };
  }

  return null;
}

// ── Format move name: "thunder-punch" → "Thunder Punch" ──
function formatMoveName(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Select the best ~10 moves per type ──
function selectMovePool(allMoves, ourType) {
  // Filter: must have power > 0 OR be a status/utility move, must be in a single battle
  const validMoves = allMoves.filter(m => {
    if (!m) return false;
    // Skip moves with no useful data
    if (m.power === null && !m.meta) return false;
    // Skip moves that target multiple pokemon or field effects we can't handle
    const target = m.target?.name;
    if (target && !['selected-pokemon', 'user', 'all-opponents', 'specific-move', 'random-opponent'].includes(target)) {
      // Allow some self-targeting moves (stat boosts, heals)
      if (target !== 'users-field' && target !== 'user-and-allies') return false;
    }
    return true;
  });

  // Convert all to our format
  const converted = validMoves.map(m => convertMove(m, ourType));

  // Categorize
  const highPower = converted.filter(m => m.power >= 80 && m.power <= 150).sort((a, b) => b.power - a.power);
  const medPower = converted.filter(m => m.power >= 40 && m.power < 80).sort((a, b) => b.accuracy - a.accuracy);
  const priorityMoves = converted.filter(m => m.priority > 0 || m.effect?.type === 'priority');
  const statusMoves = converted.filter(m => m.effect?.type === 'status' && m.power === 0);
  const drainMoves = converted.filter(m => m.effect?.type === 'drain' || m.effect?.type === 'heal');
  const boostMoves = converted.filter(m => m.effect?.type === 'stat_boost' && m.power === 0);
  const dropMoves = converted.filter(m => m.effect?.type === 'stat_drop' && m.power === 0);
  const recoilMoves = converted.filter(m => m.effect?.type === 'recoil' && m.power >= 100);
  const ohkoMoves = converted.filter(m => m.effect?.type === 'ohko');
  const flinchMoves = converted.filter(m => m.effect?.type === 'flinch' && m.power >= 50);
  const critMoves = converted.filter(m => m.effect?.type === 'high_crit' && m.power >= 50);

  // Build pool: pick from each category, avoiding duplicates
  const pool = [];
  const usedIds = new Set();

  function addMove(move) {
    if (!move || usedIds.has(move.id)) return false;
    usedIds.add(move.id);
    pool.push(move);
    return true;
  }

  function addBest(list, count) {
    let added = 0;
    for (const m of list) {
      if (added >= count) break;
      if (addMove(m)) added++;
    }
    return added;
  }

  // Pick physical + special high-power (1 each if available)
  const highPhysical = highPower.filter(m => m.category === 'physical');
  const highSpecial = highPower.filter(m => m.category === 'special');
  addBest(highPhysical, 1);
  addBest(highSpecial, 1);
  // Fill remaining high-power slots
  addBest(highPower, 3 - pool.length);

  // 2 medium power
  addBest(medPower, 2);

  // 1 priority
  addBest(priorityMoves, 1);

  // 2 status
  addBest(statusMoves, 2);

  // 1 drain/heal
  addBest(drainMoves, 1);

  // 1 stat boost
  addBest(boostMoves, 1);

  // 1 stat drop
  addBest(dropMoves, 1);

  // Fill extras if we're under 10: recoil, ohko, flinch, crit moves
  if (pool.length < 12) addBest(recoilMoves, 1);
  if (pool.length < 12) addBest(ohkoMoves, 1);
  if (pool.length < 12) addBest(flinchMoves, 1);
  if (pool.length < 12) addBest(critMoves, 1);

  // Final fill from any remaining converted moves sorted by power desc
  if (pool.length < 10) {
    const remaining = converted
      .filter(m => !usedIds.has(m.id) && m.power > 0)
      .sort((a, b) => b.power - a.power);
    addBest(remaining, 10 - pool.length);
  }

  return pool;
}

// ── Fetch all 25 natures ──
async function fetchNatures() {
  console.log('\nFetching natures...');
  const listData = await apiFetch('https://pokeapi.co/api/v2/nature?limit=25');
  const natures = [];

  for (const entry of listData.results) {
    const data = await apiFetch(entry.url);
    const nature = {
      name: data.name.charAt(0).toUpperCase() + data.name.slice(1),
      pokeapi_id: data.id,
    };

    if (data.increased_stat && data.decreased_stat) {
      nature.boost = STAT_MAP[data.increased_stat.name] || data.increased_stat.name;
      nature.reduce = STAT_MAP[data.decreased_stat.name] || data.decreased_stat.name;
      nature.desc = `+10% ${nature.boost}, -10% ${nature.reduce}`;
    } else {
      nature.boost = null;
      nature.reduce = null;
      nature.desc = 'No stat modifier';
    }

    natures.push(nature);
  }

  console.log(`  Fetched ${natures.length} natures`);
  return natures;
}

// ── Fetch type effectiveness chart ──
async function fetchTypeChart() {
  console.log('\nFetching type chart...');
  const chart = {};

  for (const ourType of OUR_TYPES) {
    const apiTypeName = ourType.toLowerCase();
    const data = await apiFetch(`https://pokeapi.co/api/v2/type/${apiTypeName}`);

    const relations = data.damage_relations;
    chart[ourType] = {};

    for (const defType of OUR_TYPES) {
      chart[ourType][defType] = 1.0; // default neutral
    }

    // Super effective (2x)
    for (const t of relations.double_damage_to) {
      const mapped = TYPE_MAP[t.name];
      if (mapped) chart[ourType][mapped] = 2.0;
    }

    // Not very effective (0.5x)
    for (const t of relations.half_damage_to) {
      const mapped = TYPE_MAP[t.name];
      if (mapped) chart[ourType][mapped] = 0.5;
    }

    // Immune (0x)
    for (const t of relations.no_damage_to) {
      const mapped = TYPE_MAP[t.name];
      if (mapped) chart[ourType][mapped] = 0;
    }
  }

  console.log('  Type chart complete (18x18 matrix)');
  return chart;
}

// ── Build legacy move map ──
function buildLegacyMoveMap(allMovesByType) {
  const legacyMap = {};

  for (const [legacyId, pokeSlug] of Object.entries(LEGACY_MOVE_TARGETS)) {
    const type = legacyId.split('_')[0].toUpperCase();
    const pool = allMovesByType[type] || [];
    // Find the move with matching slug in the pool
    const match = pool.find(m => m.id.includes(pokeSlug));
    if (match) {
      legacyMap[legacyId] = match.id;
    } else {
      // Fallback: first move of that type with similar characteristics
      legacyMap[legacyId] = pool[0]?.id || null;
    }
  }

  return legacyMap;
}

// ── Main ──
async function main() {
  console.log('=== PokeAPI Import for ClawCombat ===\n');

  // 1. Fetch moves for each type
  const allMovesByType = {};
  for (const ourType of OUR_TYPES) {
    const apiTypeName = ourType.toLowerCase();
    console.log(`\nFetching ${ourType} moves...`);
    const rawMoves = await fetchMovesForType(apiTypeName);
    const pool = selectMovePool(rawMoves, ourType);
    allMovesByType[ourType] = pool;
    console.log(`  Selected ${pool.length} moves for ${ourType}: ${pool.map(m => m.name).join(', ')}`);
  }

  // 2. Fetch natures
  const natures = await fetchNatures();

  // 3. Fetch type chart
  const typeChart = await fetchTypeChart();

  // 4. Build legacy map
  const legacyMap = buildLegacyMoveMap(allMovesByType);

  // 5. Save files
  console.log('\nSaving files...');

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'pokeapi-moves.json'),
    JSON.stringify(allMovesByType, null, 2)
  );
  console.log('  ✓ pokeapi-moves.json');

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'pokeapi-natures.json'),
    JSON.stringify(natures, null, 2)
  );
  console.log('  ✓ pokeapi-natures.json');

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'pokeapi-type-chart.json'),
    JSON.stringify(typeChart, null, 2)
  );
  console.log('  ✓ pokeapi-type-chart.json');

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'legacy-move-map.json'),
    JSON.stringify(legacyMap, null, 2)
  );
  console.log('  ✓ legacy-move-map.json');

  // Summary
  const totalMoves = Object.values(allMovesByType).reduce((s, pool) => s + pool.length, 0);
  console.log(`\n=== Import Complete ===`);
  console.log(`Total moves: ${totalMoves} across ${OUR_TYPES.length} types`);
  console.log(`Natures: ${natures.length}`);
  console.log(`Type chart: ${OUR_TYPES.length}x${OUR_TYPES.length} matrix`);
  console.log(`Legacy mappings: ${Object.keys(legacyMap).length}`);
  console.log(`API requests made: ${requestCount}`);
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
