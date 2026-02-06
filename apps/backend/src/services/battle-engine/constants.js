/**
 * Battle Engine Constants
 * Types, type chart, status effects, abilities, stat stages
 */

'use strict';

// ============================================================================
// TYPES
// ============================================================================

const TYPES = [
  'NEUTRAL','FIRE','WATER','ELECTRIC','GRASS','ICE','MARTIAL','VENOM',
  'EARTH','AIR','PSYCHE','INSECT','STONE','GHOST','DRAGON','SHADOW','METAL','MYSTIC'
];

// ============================================================================
// TYPE EFFECTIVENESS CHART (18x18) — loaded from PokeAPI data
// ============================================================================

// Format: TYPE_CHART[attackingType][defendingType] = multiplier (2.0, 1.0, 0.5, 0)
const TYPE_CHART = require('../../data/pokeapi-type-chart.json');

// ============================================================================
// STATUS EFFECTS
// ============================================================================

const STATUS_EFFECTS = {
  burned: {
    name: 'Burn',
    onTurnEnd: (agent) => {
      const dmg = Math.max(1, Math.floor(agent.maxHP * 0.0625));
      return { damage: dmg, message: `${agent.name} is hurt by its burn!` };
    },
    onAttack: (agent, move) => {
      if (move.category === 'physical') return { damageMod: 0.5 };
      return {};
    }
  },
  paralysis: {
    name: 'Paralysis',
    // BALANCED: 15% skip chance (was 25%), -25% speed (was -50%)
    onBeforeMove: (agent) => {
      if (Math.random() < 0.15) return { cantMove: true, message: `${agent.name} is fully paralyzed and can't move!` };
      return {};
    },
    speedMod: 0.75  // -25% speed (was 0.5 = -50%)
  },
  poison: {
    name: 'Poison',
    onTurnEnd: (agent) => {
      const dmg = Math.max(1, Math.floor(agent.maxHP * (1/12)));
      return { damage: dmg, message: `${agent.name} is hurt by poison!` };
    }
  },
  freeze: {
    name: 'Freeze',
    // BALANCED: Exactly 1 turn freeze (like a strong flinch), then auto-thaw
    onBeforeMove: (agent) => {
      // Always thaw after 1 turn of being frozen
      if (agent._freezeTurns >= 1) {
        return { thaw: true, message: `${agent.name} thawed out!` };
      }
      return { cantMove: true, message: `${agent.name} is frozen solid!` };
    }
  },
  sleep: {
    name: 'Sleep',
    // BALANCED: Exactly 2 turns, wake on damage
    onBeforeMove: (agent) => {
      // Wake up after 2 turns OR if took damage
      if (agent._sleepTurns >= 2 || agent._wokeFromDamage) {
        return { wake: true, message: `${agent.name} woke up!` };
      }
      return { cantMove: true, message: `${agent.name} is fast asleep!` };
    }
  },
  confusion: {
    name: 'Confusion',
    // BALANCED: 25% self-hit (was 33%), max 3 turns
    onBeforeMove: (agent) => {
      // Snap out after 3 turns max
      if (agent._confusionTurns >= 3) {
        return { snapOut: true, message: `${agent.name} snapped out of confusion!` };
      }
      if (Math.random() < 0.25) {
        // Scale to 10% of maxHP, minimum 1
        const damage = Math.max(1, Math.round(agent.maxHP * 0.1));
        return { selfHit: true, damage, message: `${agent.name} hurt itself in confusion! (${damage} damage)` };
      }
      return {};
    }
  }
};

// ============================================================================
// ABILITIES
// ============================================================================

const ABILITIES = {
  // NORMAL
  Adaptability: { type: 'NEUTRAL', description: 'STAB is 2.0 instead of 1.5', trigger: 'stab_calc' },
  Resilience: { type: 'NEUTRAL', description: 'Super-effective hits do 0.75x', trigger: 'damage_taken' },
  // FIRE
  Blaze: { type: 'FIRE', description: '+30% fire moves when HP < 33%', trigger: 'damage_calc' },
  Inferno: { type: 'FIRE', description: '15% chance to burn on hit', trigger: 'after_hit', procChance: 0.15 },
  // WATER
  Torrent: { type: 'WATER', description: '+30% water moves when HP < 33%', trigger: 'damage_calc' },
  Hydration: { type: 'WATER', description: 'Heal 6.25% HP per turn', trigger: 'end_turn' },
  // ELECTRIC
  Static: { type: 'ELECTRIC', description: '20% paralyze on contact', trigger: 'after_hit', procChance: 0.20 },
  'Volt Absorb': { type: 'ELECTRIC', description: 'Immune to electric, heal 25% HP', trigger: 'before_hit' },
  // GRASS
  Overgrow: { type: 'GRASS', description: '+30% grass moves when HP < 33%', trigger: 'damage_calc' },
  Photosynthesis: { type: 'GRASS', description: 'Heal 6.25% HP per turn', trigger: 'end_turn' },
  // ICE
  'Ice Body': { type: 'ICE', description: 'Heal 6.25% HP per turn', trigger: 'end_turn' },
  Permafrost: { type: 'ICE', description: '10% freeze on hit', trigger: 'after_hit' },
  // FIGHTING
  Guts: { type: 'MARTIAL', description: '+30% atk when statused', trigger: 'damage_calc' },
  'Iron Fist': { type: 'MARTIAL', description: '+10% physical moves', trigger: 'damage_calc' },
  // POISON
  'Poison Touch': { type: 'VENOM', description: '15% poison on hit', trigger: 'after_hit', procChance: 0.15 },
  Corrosion: { type: 'VENOM', description: 'Ignore 15% defense', trigger: 'damage_calc' },
  // GROUND
  'Sand Force': { type: 'EARTH', description: '+15% atk/def', trigger: 'battle_start' },
  'Sand Veil': { type: 'EARTH', description: '10% dodge chance', trigger: 'before_hit' },
  // FLYING
  Aerilate: { type: 'AIR', description: '+20% speed', trigger: 'battle_start' },
  'Gale Wings': { type: 'AIR', description: 'Always go first when HP full', trigger: 'speed_calc' },
  // PSYCHIC
  'Magic Guard': { type: 'PSYCHE', description: 'Immune to status damage', trigger: 'status_damage' },
  Telepathy: { type: 'PSYCHE', description: '10% dodge chance', trigger: 'before_hit' },
  // BUG
  Swarm: { type: 'INSECT', description: '+30% bug moves when HP < 33%', trigger: 'damage_calc' },
  'Compound Eyes': { type: 'INSECT', description: '+30% accuracy', trigger: 'accuracy_calc' },
  // ROCK
  Sturdy: { type: 'STONE', description: 'Survive any hit with 1 HP once', trigger: 'before_faint' },
  'Solid Rock': { type: 'STONE', description: 'Super-effective = 1.5x instead of 2.0x', trigger: 'damage_taken' },
  // GHOST
  Levitate: { type: 'GHOST', description: 'Immune to ground', trigger: 'before_hit' },
  'Cursed Body': { type: 'GHOST', description: '20% reduce opponent best stat by 1', trigger: 'after_hit_received' },
  // DRAGON
  Multiscale: { type: 'DRAGON', description: '25% less damage when HP full', trigger: 'damage_taken' },
  'Dragon Force': { type: 'DRAGON', description: '+10% Attack and Claw', trigger: 'battle_start' },
  // DARK
  'Dark Aura': { type: 'SHADOW', description: '+15% vs Psychic/Ghost/Fairy', trigger: 'damage_calc' },
  Intimidate: { type: 'SHADOW', description: '-15% opponent atk at start', trigger: 'battle_start' },
  // STEEL
  Filter: { type: 'METAL', description: 'Super-effective = 1.5x', trigger: 'damage_taken' },
  'Heavy Metal': { type: 'METAL', description: '+20% def, -10% speed', trigger: 'battle_start' },
  // FAIRY
  Pixilate: { type: 'MYSTIC', description: '+15% vs Dragon/Dark/Fighting', trigger: 'damage_calc' },
  Charm: { type: 'MYSTIC', description: '-15% opponent atk at start', trigger: 'battle_start' },
};

// ============================================================================
// STAT DISPLAY NAMES
// ============================================================================

const STAT_DISPLAY = { hp: 'HP', attack: 'Attack', defense: 'Defense', sp_atk: 'Claw', sp_def: 'Shell', speed: 'Speed' };
function statName(key) { return STAT_DISPLAY[key] || key; }

// ============================================================================
// STAT STAGE MODIFIERS
// ============================================================================

const STAT_STAGE_TABLE = {
  '-6': 0.25, '-5': 0.29, '-4': 0.33, '-3': 0.40, '-2': 0.50, '-1': 0.67,
  '0': 1.0,
  '1': 1.5, '2': 2.0, '3': 2.5, '4': 3.0, '5': 3.5, '6': 4.0
};

function getStatStageMod(stage) {
  const clamped = Math.max(-6, Math.min(6, stage));
  return STAT_STAGE_TABLE[String(clamped)];
}

// ============================================================================
// DB-TO-ENGINE AGENT MAPPER
// Maps production DB column names to engine-expected field names.
// Production DB: ai_type, base_attack, base_defense, base_sp_atk, base_sp_def, base_speed, ability_name
// Engine expects: type, attack, defense, sp_atk, sp_def, speed, ability
// ============================================================================

function mapDbAgent(row) {
  if (!row) return row;
  return {
    ...row,
    type: row.ai_type || row.type || 'NEUTRAL',
    attack: row.base_attack || row.attack || 50,
    defense: row.base_defense || row.defense || 50,
    sp_atk: row.base_sp_atk || row.sp_atk || 50,
    sp_def: row.base_sp_def || row.sp_def || 50,
    speed: row.base_speed || row.speed || 50,
    ability: row.ability_name || row.ability || null,
  };
}

module.exports = {
  TYPES,
  TYPE_CHART,
  STATUS_EFFECTS,
  ABILITIES,
  STAT_DISPLAY,
  statName,
  STAT_STAGE_TABLE,
  getStatStageMod,
  mapDbAgent,
};
