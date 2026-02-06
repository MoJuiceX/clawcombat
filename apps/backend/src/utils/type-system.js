// ClawCombat 18-Type System + Stat Customization

const VALID_TYPES = [
  'NEUTRAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE',
  'MARTIAL', 'VENOM', 'EARTH', 'AIR', 'PSYCHE', 'INSECT',
  'STONE', 'GHOST', 'DRAGON', 'SHADOW', 'METAL', 'MYSTIC'
];

const TYPE_EMOJIS = {
  NEUTRAL: '⚪', FIRE: '🔥', WATER: '💧', ELECTRIC: '⚡', GRASS: '🌿', ICE: '❄️',
  MARTIAL: '👊', VENOM: '☠️', EARTH: '🌍', AIR: '🦅', PSYCHE: '🧠', INSECT: '🐛',
  STONE: '🪨', GHOST: '👻', DRAGON: '🐉', SHADOW: '🌑', METAL: '⚙️', MYSTIC: '✨'
};

// Super-effective: attacker type → list of defender types it's strong against
const TYPE_ADVANTAGES = {
  NEUTRAL:  [],
  FIRE:     ['GRASS', 'ICE', 'INSECT', 'METAL'],
  WATER:    ['FIRE', 'EARTH', 'STONE'],
  ELECTRIC: ['WATER', 'AIR'],
  GRASS:    ['WATER', 'EARTH', 'STONE'],
  ICE:      ['AIR', 'EARTH', 'GRASS', 'DRAGON'],
  MARTIAL:  ['NEUTRAL', 'ICE', 'STONE', 'SHADOW', 'METAL'],
  VENOM:    ['GRASS', 'MYSTIC'],
  EARTH:    ['FIRE', 'ELECTRIC', 'VENOM', 'STONE', 'METAL'],
  AIR:      ['GRASS', 'MARTIAL', 'INSECT'],
  PSYCHE:   ['MARTIAL', 'VENOM'],
  INSECT:   ['GRASS', 'PSYCHE', 'SHADOW'],
  STONE:    ['AIR', 'INSECT', 'FIRE', 'ICE'],
  GHOST:    ['GHOST', 'PSYCHE'],
  DRAGON:   ['DRAGON'],
  SHADOW:   ['GHOST', 'PSYCHE'],
  METAL:    ['STONE', 'ICE', 'MYSTIC'],
  MYSTIC:   ['MARTIAL', 'DRAGON', 'SHADOW']
};

// Weaknesses: defender type → list of attacker types it's weak to
const TYPE_WEAKNESSES = {
  NEUTRAL:  ['MARTIAL'],
  FIRE:     ['WATER', 'EARTH', 'STONE'],
  WATER:    ['ELECTRIC', 'GRASS'],
  ELECTRIC: ['EARTH'],
  GRASS:    ['FIRE', 'ICE', 'VENOM', 'AIR', 'INSECT'],
  ICE:      ['FIRE', 'MARTIAL', 'STONE', 'METAL'],
  MARTIAL:  ['AIR', 'PSYCHE', 'MYSTIC'],
  VENOM:    ['EARTH', 'PSYCHE'],
  EARTH:    ['WATER', 'GRASS', 'ICE'],
  AIR:      ['ELECTRIC', 'STONE', 'ICE'],
  PSYCHE:   ['INSECT', 'GHOST', 'SHADOW'],
  INSECT:   ['FIRE', 'AIR', 'STONE'],
  STONE:    ['WATER', 'GRASS', 'MARTIAL', 'EARTH', 'METAL'],
  GHOST:    ['GHOST', 'SHADOW'],
  DRAGON:   ['ICE', 'DRAGON', 'MYSTIC'],
  SHADOW:   ['MARTIAL', 'INSECT', 'MYSTIC'],
  METAL:    ['FIRE', 'MARTIAL', 'EARTH'],
  MYSTIC:   ['VENOM', 'METAL']
};

// PERFORMANCE: Pre-computed 18×18 type effectiveness matrix
// Converts O(n) array search to O(1) object lookup
const TYPE_EFFECTIVENESS_MATRIX = {};

// Build matrix at module load (runs once)
for (const attacker of VALID_TYPES) {
  TYPE_EFFECTIVENESS_MATRIX[attacker] = {};
  for (const defender of VALID_TYPES) {
    if (TYPE_ADVANTAGES[attacker]?.includes(defender)) {
      TYPE_EFFECTIVENESS_MATRIX[attacker][defender] = 1.2;
    } else if (TYPE_WEAKNESSES[attacker]?.includes(defender)) {
      TYPE_EFFECTIVENESS_MATRIX[attacker][defender] = 0.8;
    } else {
      TYPE_EFFECTIVENESS_MATRIX[attacker][defender] = 1.0;
    }
  }
}

// Returns multiplier: 1.2 (super-effective), 0.8 (not effective), 1.0 (neutral)
// Now O(1) instead of O(n) array search
function getTypeMultiplier(attackerType, defenderType) {
  return TYPE_EFFECTIVENESS_MATRIX[attackerType]?.[defenderType] ?? 1.0;
}

// ── 25 ClawCombat Natures ──
const NATURES_DATA = require('../data/pokeapi-natures.json');
const NATURES = NATURES_DATA;

// Legacy nature mapping for existing agents
const LEGACY_NATURE_MAP = {
  'Aggressive': 'Brutal',    // +atk, -sp_atk
  'Defensive': 'Defiant',    // +def, -atk
  'Speedy': 'Energetic',     // +spd, -sp_atk
  'Smart': 'Calculated',     // +sp_atk, -atk
  'Tough': 'Vigilant',       // +def, -sp_atk
  'Balanced': 'Sturdy',      // neutral
  // Old Pokemon names → new ClawCombat names
  'Hardy': 'Sturdy',
  'Bold': 'Defiant',
  'Modest': 'Calculated',
  'Calm': 'Tranquil',
  'Timid': 'Evasive',
  'Lonely': 'Savage',
  'Docile': 'Balanced',
  'Mild': 'Focused',
  'Gentle': 'Mellow',
  'Hasty': 'Rapid',
  'Adamant': 'Brutal',
  'Impish': 'Vigilant',
  'Bashful': 'Quiet',
  'Careful': 'Alert',
  'Rash': 'Impulsive',
  'Jolly': 'Energetic',
  'Naughty': 'Wild',
  'Lax': 'Relaxed',
  'Quirky': 'Eccentric',
  'Naive': 'Innocent',
  'Brave': 'Fearless',
  'Relaxed': 'Sluggish',
  'Quiet': 'Silent',
  'Sassy': 'Stubborn',
  'Serious': 'Grim',
};

// ── 2 Abilities per type (balanced for competitive play) ──
const TYPE_ABILITIES = {
  NEUTRAL: [
    { name: 'Adaptability', desc: 'STAB bonus is 2.0x instead of 1.5x', effect: 'type_boost' },
    { name: 'Resilience', desc: 'Super-effective hits do 0.75x damage', effect: 'damage_reduce' },
  ],
  FIRE: [
    { name: 'Blaze', desc: '+30% fire move damage when HP < 33%', effect: 'low_hp_boost' },
    { name: 'Inferno', desc: '20% chance to burn opponent on hit', effect: 'burn_chance' },
  ],
  WATER: [
    { name: 'Torrent', desc: '+30% water move damage when HP < 33%', effect: 'low_hp_boost' },
    { name: 'Hydration', desc: 'Heal 6.25% HP each turn', effect: 'regen' },
  ],
  ELECTRIC: [
    { name: 'Static', desc: '20% chance to paralyze on physical contact', effect: 'paralyze_chance' },
    { name: 'Volt Absorb', desc: 'Immune to Electric, heals 25% HP instead', effect: 'absorb_electric' },
  ],
  GRASS: [
    { name: 'Overgrow', desc: '+30% grass move damage when HP < 33%', effect: 'low_hp_boost' },
    { name: 'Photosynthesis', desc: 'Heal 6.25% HP each turn', effect: 'regen' },
  ],
  ICE: [
    { name: 'Ice Body', desc: 'Heal 6.25% HP each turn', effect: 'regen' },
    { name: 'Permafrost', desc: '10% chance to freeze opponent on hit', effect: 'freeze_chance' },
  ],
  MARTIAL: [
    { name: 'Guts', desc: '+30% Attack when afflicted with status', effect: 'status_boost' },
    { name: 'Iron Fist', desc: '+10% physical move damage', effect: 'flat_attack_boost' },
  ],
  VENOM: [
    { name: 'Poison Touch', desc: '20% chance to poison opponent on hit', effect: 'poison_chance' },
    { name: 'Corrosion', desc: 'Ignore 15% of opponent defense', effect: 'defense_pierce' },
  ],
  EARTH: [
    { name: 'Sand Force', desc: '+15% Attack and Defense', effect: 'flat_stat_boost' },
    { name: 'Sand Veil', desc: '10% chance to dodge attacks', effect: 'dodge_chance' },
  ],
  AIR: [
    { name: 'Aerilate', desc: '+20% Speed in combat', effect: 'speed_boost' },
    { name: 'Gale Wings', desc: 'Always strike first when HP is full', effect: 'priority' },
  ],
  PSYCHE: [
    { name: 'Magic Guard', desc: 'Immune to indirect/status damage', effect: 'status_immune' },
    { name: 'Telepathy', desc: '10% chance to dodge attacks', effect: 'dodge_chance' },
  ],
  INSECT: [
    { name: 'Swarm', desc: '+30% insect move damage when HP < 33%', effect: 'low_hp_boost' },
    { name: 'Compound Eyes', desc: '+30% accuracy', effect: 'accuracy_boost' },
  ],
  STONE: [
    { name: 'Sturdy', desc: 'Survive any hit with 1 HP once per battle', effect: 'endure' },
    { name: 'Solid Rock', desc: 'Super-effective hits = 1.5x instead of 2.0x', effect: 'damage_reduce' },
  ],
  GHOST: [
    { name: 'Levitate', desc: 'Immune to Earth attacks', effect: 'absorb_ground' },
    { name: 'Cursed Body', desc: '20% chance to lower opponent\'s best stat', effect: 'disable_chance' },
  ],
  DRAGON: [
    { name: 'Multiscale', desc: '25% less damage when HP is full', effect: 'full_hp_shield' },
    { name: 'Dragon Force', desc: '+10% Attack and Claw', effect: 'flat_stat_boost' },
  ],
  SHADOW: [
    { name: 'Dark Aura', desc: '+15% damage vs Psyche, Ghost, and Mystic', effect: 'type_damage_boost' },
    { name: 'Intimidate', desc: 'Reduce opponent Attack by 15% at start', effect: 'intimidate' },
  ],
  METAL: [
    { name: 'Filter', desc: 'Super-effective hits = 1.5x instead of 2.0x', effect: 'damage_reduce' },
    { name: 'Heavy Metal', desc: '+20% Defense, -10% Speed', effect: 'defense_speed_trade' },
  ],
  MYSTIC: [
    { name: 'Pixilate', desc: '+15% damage vs Dragon, Shadow, and Martial', effect: 'type_damage_boost' },
    { name: 'Charm', desc: 'Reduce opponent Attack by 15% at start', effect: 'intimidate' },
  ],
};

// ── Stat constants ──
const STAT_NAMES = ['hp', 'attack', 'defense', 'sp_atk', 'sp_def', 'speed'];

// Display names: internal key → lobster-themed label
const STAT_DISPLAY_NAMES = {
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  sp_atk: 'Claw',
  sp_def: 'Shell',
  speed: 'Speed',
};

function getStatDisplayName(key) {
  return STAT_DISPLAY_NAMES[key] || key;
}
const BASE_STAT_TOTAL = 100;
const MAX_STAT_TOKENS = 50;
const MAX_TOTAL_EVS = 510;
const EV_WIN_PRIMARY = 10;
const EV_WIN_SECONDARY = 5;
const EV_WIN_TERTIARY = 2;
const EV_LOSS = 5; // participation credit

// ── Random assignment helpers ──
function randomNature() {
  return NATURES[Math.floor(Math.random() * NATURES.length)];
}

// Resolve a nature name (handles legacy names)
function resolveNature(natureName) {
  // Direct match
  let nature = NATURES.find(n => n.name === natureName);
  if (nature) return nature;

  // Legacy mapping
  const mapped = LEGACY_NATURE_MAP[natureName];
  if (mapped) {
    nature = NATURES.find(n => n.name === mapped);
    if (nature) return nature;
  }

  // Fallback to Sturdy (neutral)
  return NATURES.find(n => n.name === 'Sturdy') || NATURES[0];
}

function randomAbility(type) {
  const abilities = TYPE_ABILITIES[type];
  if (!abilities || abilities.length === 0) return null;
  return abilities[Math.floor(Math.random() * abilities.length)];
}

// ── Validate base stat allocation ──
function validateBaseStats(stats) {
  const errors = [];
  let total = 0;
  for (const stat of STAT_NAMES) {
    const val = stats[stat];
    if (val === undefined || val === null) {
      errors.push(`Missing stat: ${stat}`);
      continue;
    }
    if (!Number.isInteger(val) || val < 1 || val > MAX_STAT_TOKENS) {
      errors.push(`${stat} must be 1-${MAX_STAT_TOKENS} (got ${val})`);
      continue;
    }
    total += val;
  }
  if (total !== BASE_STAT_TOTAL) {
    errors.push(`Stats must total ${BASE_STAT_TOTAL} (got ${total})`);
  }
  return errors;
}

// ── Calculate effective stat value (base + nature + EVs + level scaling) ──
// Import the stat scaling system
const {
  calculateEffectiveHP,
  calculateEffectiveStat: calcStatScaled,
  getEvolutionTier
} = require('../config/stat-scaling');

function calculateEffectiveStat(statName, baseValue, nature, evValue, level = 1) {
  // Get nature modifier
  let natureMod = 1.0;
  if (nature.boost === statName) natureMod = 1.1;
  if (nature.reduce === statName) natureMod = 0.9;

  // Use the new level-scaled calculation
  return calcStatScaled(baseValue, level, evValue || 0, natureMod);
}

// ── Calculate all effective stats (with level scaling + token bonuses) ──
function calculateAllEffectiveStats(agent) {
  const effectiveNature = resolveNature(agent.nature_name);
  const level = agent.level || 1;

  // Token bonuses (each token = +1 to effective stat)
  const tokenHP = agent.stat_tokens_hp || 0;
  const tokenAtk = agent.stat_tokens_attack || 0;
  const tokenDef = agent.stat_tokens_defense || 0;
  const tokenSpAtk = agent.stat_tokens_sp_atk || 0;
  const tokenSpDef = agent.stat_tokens_sp_def || 0;
  const tokenSpeed = agent.stat_tokens_speed || 0;

  // HP uses special calculation (scales more)
  const hp = calculateEffectiveHP(
    agent.base_hp || 17,
    level,
    agent.ev_hp || 0
  ) + tokenHP;

  // Other stats use standard calculation + token bonus
  const stats = { hp };
  const tokenMap = {
    attack: tokenAtk,
    defense: tokenDef,
    sp_atk: tokenSpAtk,
    sp_def: tokenSpDef,
    speed: tokenSpeed,
  };

  for (const stat of STAT_NAMES) {
    if (stat === 'hp') continue; // Already calculated
    stats[stat] = calculateEffectiveStat(
      stat,
      agent[`base_${stat}`] || 0,
      effectiveNature,
      agent[`ev_${stat}`] || 0,
      level
    ) + (tokenMap[stat] || 0);
  }

  // Add evolution tier info
  const evoTier = getEvolutionTier(level);
  stats._evolutionTier = evoTier.tier;
  stats._evolutionName = evoTier.name;

  return stats;
}

// ── Determine EV distribution for a win ──
// Primary stat = highest base stat, secondary = 2nd highest, tertiary = 3rd
function getEVDistribution(agent) {
  const statValues = STAT_NAMES.map(s => ({ name: s, value: agent[`base_${s}`] || 0 }));
  statValues.sort((a, b) => b.value - a.value);
  return {
    primary: statValues[0].name,
    secondary: statValues[1].name,
    tertiary: statValues[2].name,
  };
}

// ── Award EVs after a battle ──
function awardEVs(db, agentId, won) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return null;

  const totalEVs = STAT_NAMES.reduce((sum, s) => sum + (agent[`ev_${s}`] || 0), 0);
  if (totalEVs >= MAX_TOTAL_EVS) return { capped: true, total: totalEVs };

  const dist = getEVDistribution(agent);
  const remaining = MAX_TOTAL_EVS - totalEVs;

  let awards;
  if (won) {
    awards = {
      [dist.primary]: Math.min(EV_WIN_PRIMARY, remaining),
      [dist.secondary]: Math.min(EV_WIN_SECONDARY, Math.max(0, remaining - EV_WIN_PRIMARY)),
      [dist.tertiary]: Math.min(EV_WIN_TERTIARY, Math.max(0, remaining - EV_WIN_PRIMARY - EV_WIN_SECONDARY)),
    };
  } else {
    // Loser gets participation EVs spread across primary
    awards = {
      [dist.primary]: Math.min(EV_LOSS, remaining),
    };
  }

  // Apply EV updates using whitelist validation to prevent SQL injection
  const VALID_EV_COLUMNS = {
    hp: 'ev_hp',
    attack: 'ev_attack',
    defense: 'ev_defense',
    sp_atk: 'ev_sp_atk',
    sp_def: 'ev_sp_def',
    speed: 'ev_speed'
  };

  for (const [stat, amount] of Object.entries(awards)) {
    if (amount > 0 && VALID_EV_COLUMNS[stat]) {
      const column = VALID_EV_COLUMNS[stat];
      // Use separate prepared statements for each valid column
      switch (column) {
        case 'ev_hp':
          db.prepare('UPDATE agents SET ev_hp = ev_hp + ? WHERE id = ?').run(amount, agentId);
          break;
        case 'ev_attack':
          db.prepare('UPDATE agents SET ev_attack = ev_attack + ? WHERE id = ?').run(amount, agentId);
          break;
        case 'ev_defense':
          db.prepare('UPDATE agents SET ev_defense = ev_defense + ? WHERE id = ?').run(amount, agentId);
          break;
        case 'ev_sp_atk':
          db.prepare('UPDATE agents SET ev_sp_atk = ev_sp_atk + ? WHERE id = ?').run(amount, agentId);
          break;
        case 'ev_sp_def':
          db.prepare('UPDATE agents SET ev_sp_def = ev_sp_def + ? WHERE id = ?').run(amount, agentId);
          break;
        case 'ev_speed':
          db.prepare('UPDATE agents SET ev_speed = ev_speed + ? WHERE id = ?').run(amount, agentId);
          break;
      }
    }
  }

  return { awards, total: totalEVs + Object.values(awards).reduce((s, v) => s + v, 0) };
}

// ── Fight type stat weights ──
const FIGHT_TYPE_WEIGHTS = {
  SPEED:      { speed: 0.35, attack: 0.20, sp_atk: 0.20, hp: 0.10, defense: 0.08, sp_def: 0.07 },
  DAMAGE:     { attack: 0.30, sp_atk: 0.25, speed: 0.20, hp: 0.10, defense: 0.08, sp_def: 0.07 },
  RESILIENCE: { hp: 0.30, defense: 0.25, sp_def: 0.20, attack: 0.10, sp_atk: 0.08, speed: 0.07 },
  TACTICAL:   { sp_atk: 0.30, sp_def: 0.25, speed: 0.20, hp: 0.10, attack: 0.08, defense: 0.07 },
  BALANCED:   { hp: 0.17, attack: 0.17, defense: 0.17, sp_atk: 0.17, sp_def: 0.16, speed: 0.16 },
  ENDURANCE:  { hp: 0.30, defense: 0.20, sp_def: 0.20, speed: 0.10, attack: 0.10, sp_atk: 0.10 },
};

const FIGHT_TYPES = Object.keys(FIGHT_TYPE_WEIGHTS);

function randomFightType() {
  return FIGHT_TYPES[Math.floor(Math.random() * FIGHT_TYPES.length)];
}

// ── Calculate fight score for an agent ──
function calculateFightScore(agent, fightType, opponentType) {
  const effectiveStats = calculateAllEffectiveStats(agent);
  const weights = FIGHT_TYPE_WEIGHTS[fightType] || FIGHT_TYPE_WEIGHTS.BALANCED;

  // Weighted stat sum
  let statScore = 0;
  for (const stat of STAT_NAMES) {
    statScore += (effectiveStats[stat] || 0) * (weights[stat] || 0);
  }

  // Type advantage multiplier
  const typeMultiplier = getTypeMultiplier(agent.ai_type, opponentType);

  // Ability bonus (simplified: flat 1.1x if ability is relevant)
  let abilityMultiplier = 1.0;
  const ability = agent.ability_name;
  if (ability) {
    // Some abilities give flat boosts
    const abilityDef = TYPE_ABILITIES[agent.ai_type]?.find(a => a.name === ability);
    if (abilityDef) {
      switch (abilityDef.effect) {
        case 'flat_attack_boost': abilityMultiplier = 1.05; break;
        case 'flat_stat_boost': abilityMultiplier = 1.08; break;
        case 'type_boost':
          if (typeMultiplier > 1.0) abilityMultiplier = 1.08;
          break;
        default: abilityMultiplier = 1.05; break; // small passive bonus for having any ability
      }
    }
  }

  return Math.round(statScore * typeMultiplier * abilityMultiplier * 100) / 100;
}

module.exports = {
  VALID_TYPES,
  TYPE_EMOJIS,
  TYPE_ADVANTAGES,
  TYPE_WEAKNESSES,
  TYPE_EFFECTIVENESS_MATRIX,
  NATURES,
  LEGACY_NATURE_MAP,
  TYPE_ABILITIES,
  STAT_NAMES,
  STAT_DISPLAY_NAMES,
  getStatDisplayName,
  BASE_STAT_TOTAL,
  MAX_STAT_TOKENS,
  MAX_TOTAL_EVS,
  FIGHT_TYPES,
  FIGHT_TYPE_WEIGHTS,
  getTypeMultiplier,
  randomNature,
  resolveNature,
  randomAbility,
  validateBaseStats,
  calculateEffectiveStat,
  calculateAllEffectiveStats,
  getEVDistribution,
  awardEVs,
  randomFightType,
  calculateFightScore,
};
