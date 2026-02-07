/**
 * ClawCombat Battle Engine
 * Complete 1v1 ClawCombat battle system
 * Node.js / Express / SQLite (better-sqlite3) / uuid / axios
 */

'use strict';

const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const axios = require('axios');
const log = require('../utils/logger').createLogger('BATTLE_ENGINE');

// Import stat scaling system for level-based progression
const {
  calculateEffectiveHP,
  calculateEffectiveStat,
  calculateEffectiveMovePower,
  getEvolutionTier,
} = require('../config/stat-scaling');
const { WEBHOOK_TIMEOUT_MS, BATTLE_TURN_TIMEOUT_MS, MAX_CONSECUTIVE_TIMEOUTS, SOCIAL_TOKEN_EXPIRY_MS } = require('../config/constants');
const express = require('express');

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

// ============================================================================
// SECTION 1: CONSTANTS — TYPES
// ============================================================================

const TYPES = [
  'NEUTRAL','FIRE','WATER','ELECTRIC','GRASS','ICE','MARTIAL','VENOM',
  'EARTH','AIR','PSYCHE','INSECT','STONE','GHOST','DRAGON','SHADOW','METAL','MYSTIC'
];

// ============================================================================
// SECTION 2: TYPE EFFECTIVENESS CHART (18x18) — loaded from PokeAPI data
// ============================================================================

// Format: TYPE_CHART[attackingType][defendingType] = multiplier (2.0, 1.0, 0.5, 0)
const TYPE_CHART = require('../data/pokeapi-type-chart.json');

// ============================================================================
// SECTION 3: MOVES (imported from shared module)
// ============================================================================

const { MOVES_LIST, MOVES, MOVES_BY_TYPE, getMovesForType, getMoveById, getMovesByIds } = require('../data/moves');
const { applyNatureModifiers, getNatureByName } = require('../utils/natures');

// ============================================================================
// SECTION 4: STATUS EFFECTS
// ============================================================================

// Status effect balance constants (documented for easy tuning)
const STATUS_CONSTANTS = {
  // Burn
  BURN_DAMAGE_PERCENT: 0.0625,        // 6.25% of maxHP per turn
  BURN_PHYSICAL_DAMAGE_MOD: 0.5,      // 50% physical damage when burned

  // Paralysis
  PARALYSIS_SKIP_CHANCE: 0.15,        // 15% chance to skip turn (was 25%)
  PARALYSIS_SPEED_MOD: 0.75,          // -25% speed (was -50%)

  // Poison
  POISON_DAMAGE_FRACTION: 1/12,       // ~8.3% of maxHP per turn

  // Freeze
  FREEZE_MAX_TURNS: 1,                // Auto-thaw after 1 turn

  // Sleep
  SLEEP_MAX_TURNS: 2,                 // Wake after 2 turns

  // Confusion
  CONFUSION_SELF_HIT_CHANCE: 0.25,    // 25% chance to hit self (was 33%)
  CONFUSION_SELF_HIT_DAMAGE: 0.1,     // 10% of maxHP on self-hit
  CONFUSION_MAX_TURNS: 3,             // Snap out after 3 turns
};

const STATUS_EFFECTS = {
  burned: {
    name: 'Burn',
    onTurnEnd: (agent) => {
      const dmg = Math.max(1, Math.floor(agent.maxHP * STATUS_CONSTANTS.BURN_DAMAGE_PERCENT));
      return { damage: dmg, message: `${agent.name} is hurt by its burn!` };
    },
    onAttack: (agent, move) => {
      if (move.category === 'physical') return { damageMod: STATUS_CONSTANTS.BURN_PHYSICAL_DAMAGE_MOD };
      return {};
    }
  },
  paralysis: {
    name: 'Paralysis',
    onBeforeMove: (agent) => {
      if (Math.random() < STATUS_CONSTANTS.PARALYSIS_SKIP_CHANCE) {
        return { cantMove: true, message: `${agent.name} is fully paralyzed and can't move!` };
      }
      return {};
    },
    speedMod: STATUS_CONSTANTS.PARALYSIS_SPEED_MOD
  },
  poison: {
    name: 'Poison',
    onTurnEnd: (agent) => {
      const dmg = Math.max(1, Math.floor(agent.maxHP * STATUS_CONSTANTS.POISON_DAMAGE_FRACTION));
      return { damage: dmg, message: `${agent.name} is hurt by poison!` };
    }
  },
  freeze: {
    name: 'Freeze',
    onBeforeMove: (agent) => {
      if (agent._freezeTurns >= STATUS_CONSTANTS.FREEZE_MAX_TURNS) {
        return { thaw: true, message: `${agent.name} thawed out!` };
      }
      return { cantMove: true, message: `${agent.name} is frozen solid!` };
    }
  },
  sleep: {
    name: 'Sleep',
    onBeforeMove: (agent) => {
      if (agent._sleepTurns >= STATUS_CONSTANTS.SLEEP_MAX_TURNS || agent._wokeFromDamage) {
        return { wake: true, message: `${agent.name} woke up!` };
      }
      return { cantMove: true, message: `${agent.name} is fast asleep!` };
    }
  },
  confusion: {
    name: 'Confusion',
    onBeforeMove: (agent) => {
      if (agent._confusionTurns >= STATUS_CONSTANTS.CONFUSION_MAX_TURNS) {
        return { snapOut: true, message: `${agent.name} snapped out of confusion!` };
      }
      if (Math.random() < STATUS_CONSTANTS.CONFUSION_SELF_HIT_CHANCE) {
        const damage = Math.max(1, Math.round(agent.maxHP * STATUS_CONSTANTS.CONFUSION_SELF_HIT_DAMAGE));
        return { selfHit: true, damage, message: `${agent.name} hurt itself in confusion! (${damage} damage)` };
      }
      return {};
    }
  }
};

// ============================================================================
// SECTION 5: ABILITIES
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
  // INSECT (Bug-type)
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
// SECTION 5B: STAT DISPLAY NAMES
// ============================================================================

const STAT_DISPLAY = { hp: 'HP', attack: 'Attack', defense: 'Defense', sp_atk: 'Claw', sp_def: 'Shell', speed: 'Speed' };
function statName(key) { return STAT_DISPLAY[key] || key; }

// ============================================================================
// SECTION 6: STAT STAGE MODIFIERS
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
// SECTION 7: CORE FORMULAS
// ============================================================================

function calculateMaxHP(baseHP, level = 1, evHP = 0) {
  // Use level-scaled HP calculation from stat-scaling system
  return calculateEffectiveHP(baseHP, level, evHP);
}

function getTypeEffectiveness(moveType, defenderType) {
  if (!TYPE_CHART[moveType] || !TYPE_CHART[moveType][defenderType]) return 1.0;
  return TYPE_CHART[moveType][defenderType];
}

function calculateDamage(attacker, defender, move, battleState) {
  if (move.power === 0) return { damage: 0, crit: false, typeEffectiveness: 1.0 };

  const isPhysical = move.category === 'physical';
  const atkStat = isPhysical ? attacker.effectiveStats.attack : attacker.effectiveStats.sp_atk;
  let defStat;
  // Psystrike-like: special move targeting physical defense
  if (move.effect && move.effect.type === 'use_physical_def') {
    defStat = defender.effectiveStats.defense;
  } else {
    defStat = isPhysical ? defender.effectiveStats.defense : defender.effectiveStats.sp_def;
  }

  const atkStageKey = isPhysical ? 'attack' : 'sp_atk';
  const defStageKey = (move.effect && move.effect.type === 'use_physical_def') ? 'defense' : (isPhysical ? 'defense' : 'sp_def');

  const atkMod = getStatStageMod(attacker.statStages[atkStageKey]);
  const defMod = getStatStageMod(defender.statStages[defStageKey]);

  // Ability: Corrosion — ignore 15% defense
  let corrosionMod = 1.0;
  if (attacker.ability === 'Corrosion') corrosionMod = 0.85;

  const effectiveAtk = atkStat * atkMod;
  const effectiveDef = defStat * defMod * corrosionMod;

  // Apply level-based move power scaling (conservative: +0.3% per level)
  const scaledMovePower = calculateEffectiveMovePower(move.power, attacker.level || 1);

  // Damage multiplier — BALANCED: 0.25 (was 0.3) for 6-8 turn battles
  let baseDamage = (effectiveAtk / Math.max(1, effectiveDef)) * scaledMovePower * 0.25;

  // STAB
  let stab = (move.type === attacker.type) ? 1.5 : 1.0;
  if (stab > 1.0 && attacker.ability === 'Adaptability') stab = 2.0;

  // Type effectiveness — BALANCED: cap at 1.5x max (was 2.0x/4.0x)
  // This prevents one-shots from type advantage while keeping matchups meaningful
  let typeEff = getTypeEffectiveness(move.type, defender.type);

  // Cap super-effective at 1.5x (allows comebacks, rewards knowledge but doesn't punish too hard)
  if (typeEff > 1.5) typeEff = 1.5;

  // Ability: Resilience / Solid Rock / Filter — further reduce super-effective
  if (typeEff > 1.0) {
    if (defender.ability === 'Resilience') typeEff *= 0.75;
    if (defender.ability === 'Solid Rock') typeEff = Math.min(typeEff, 1.25);
    if (defender.ability === 'Filter') typeEff = Math.min(typeEff, 1.25);
  }

  // Ability: Dark Aura — +15% vs Psychic/Ghost/Fairy types
  if (attacker.ability === 'Dark Aura' && (defender.type === 'PSYCHE' || defender.type === 'GHOST' || defender.type === 'MYSTIC')) {
    baseDamage *= 1.15;
  }
  // Ability: Pixilate — +15% vs Dragon/Dark/Fighting
  if (attacker.ability === 'Pixilate' && (defender.type === 'DRAGON' || defender.type === 'SHADOW' || defender.type === 'MARTIAL')) {
    baseDamage *= 1.15;
  }

  // Ability: Blaze/Torrent/Overgrow/Swarm — +30% when HP < 33%
  const hpRatio = attacker.currentHP / attacker.maxHP;
  if (hpRatio < 0.33) {
    if (attacker.ability === 'Blaze' && move.type === 'FIRE') baseDamage *= 1.3;
    if (attacker.ability === 'Torrent' && move.type === 'WATER') baseDamage *= 1.3;
    if (attacker.ability === 'Overgrow' && move.type === 'GRASS') baseDamage *= 1.3;
    if (attacker.ability === 'Swarm' && move.type === 'INSECT') baseDamage *= 1.3;
  }

  // Ability: Guts — +30% atk when statused
  if (attacker.ability === 'Guts' && attacker.status) baseDamage *= 1.3;
  // Ability: Iron Fist — +10% physical
  if (attacker.ability === 'Iron Fist' && isPhysical) baseDamage *= 1.1;

  // Ability: Multiscale — 25% less damage when HP full
  if (defender.ability === 'Multiscale' && defender.currentHP === defender.maxHP) {
    baseDamage *= 0.75;
  }

  // Critical hit — BALANCED: 1.25x (was 1.5x) to prevent lucky one-shots
  let critChance = 0.0625;
  if (move.effect && move.effect.type === 'high_crit') critChance = (move.effect.crit_rate || 12.5) / 100;
  const critRoll = Math.random() < critChance;
  const crit = critRoll ? 1.25 : 1.0;

  // Random factor 0.85 - 1.0
  const random = 0.85 + Math.random() * 0.15;

  // Burn mod
  const burnMod = (attacker.status === 'burned' && isPhysical) ? 0.5 : 1.0;

  // Eruption: scale power with HP ratio
  if (move.effect && move.effect.type === 'hp_scaling') {
    baseDamage *= Math.max(0.2, attacker.currentHP / attacker.maxHP);
  }

  // Venoshock: double if target poisoned
  if (move.effect && move.effect.type === 'double_if_poisoned' && defender.status === 'poison') {
    baseDamage *= 2.0;
  }

  const finalDamage = Math.max(1, Math.floor(baseDamage * stab * typeEff * crit * random * burnMod));
  return { damage: finalDamage, crit: critRoll, typeEffectiveness: typeEff };
}

// ============================================================================
// SECTION 8: BATTLE STATE INITIALIZATION
// ============================================================================

function buildAgentBattleState(agent) {
  const level = agent.level || 1;

  // Get nature modifier for a stat
  function getNatureMod(statName) {
    if (agent.nature_boost === statName) return 1.1;
    if (agent.nature_reduce === statName) return 0.9;
    return 1.0;
  }

  // Calculate level-scaled stats
  const maxHP = calculateMaxHP(agent.base_hp || 17, level, agent.ev_hp || 0);
  const stats = {
    attack: calculateEffectiveStat(agent.attack || agent.base_attack || 17, level, agent.ev_attack || 0, getNatureMod('attack')),
    defense: calculateEffectiveStat(agent.defense || agent.base_defense || 17, level, agent.ev_defense || 0, getNatureMod('defense')),
    sp_atk: calculateEffectiveStat(agent.sp_atk || agent.base_sp_atk || 17, level, agent.ev_sp_atk || 0, getNatureMod('sp_atk')),
    sp_def: calculateEffectiveStat(agent.sp_def || agent.base_sp_def || 16, level, agent.ev_sp_def || 0, getNatureMod('sp_def')),
    speed: calculateEffectiveStat(agent.speed || agent.base_speed || 16, level, agent.ev_speed || 0, getNatureMod('speed')),
  };

  // Get evolution tier info
  const evoTier = getEvolutionTier(level);

  // Clone moves from the agent's moveset — agents should have 4 move IDs
  const agentMoves = (agent.moves || []).map(mId => {
    const moveData = typeof mId === 'string' ? getMoveById(mId) : mId;
    if (!moveData) return null;
    return { ...moveData, currentPP: moveData.pp };
  }).filter(Boolean);

  // If agent has no moves, give them defaults from their type
  if (agentMoves.length === 0) {
    const typeMoves = MOVES_BY_TYPE[agent.type] || MOVES_BY_TYPE['NEUTRAL'];
    typeMoves.forEach(m => agentMoves.push({ ...m, currentPP: m.pp }));
  }

  return {
    id: agent.id,
    name: agent.name || 'Unknown',
    type: agent.type || 'NEUTRAL',
    avatar_url: agent.avatar_url || null,
    level,
    evolutionTier: evoTier.tier,
    evolutionName: evoTier.name,
    maxHP,
    currentHP: maxHP,
    status: null,
    statusTurns: 0,
    statStages: { attack: 0, defense: 0, sp_atk: 0, sp_def: 0, speed: 0 },
    effectiveStats: { ...stats },
    baseStats: { ...stats },
    ability: agent.ability || null,
    moves: agentMoves,
    webhook_url: agent.webhook_url || null,
    // Tracking
    sturdyUsed: false,
    wishPending: false,
    wishTurn: 0,
    leechSeeded: false,
    cursed: false,
    flinched: false,
  };
}

function initializeBattleState(agentA, agentB) {
  const stateA = buildAgentBattleState(agentA);
  const stateB = buildAgentBattleState(agentB);

  // PERFORMANCE: Pre-compute type matchups for this battle
  // Eliminates 10-12 repeated TYPE_CHART lookups per battle
  const typeA = stateA.type || 'NEUTRAL';
  const typeB = stateB.type || 'NEUTRAL';
  const typeMatchup = {
    aOffense: TYPE_CHART[typeA]?.[typeB] ?? 1.0,  // A attacking B
    bOffense: TYPE_CHART[typeB]?.[typeA] ?? 1.0,  // B attacking A
    // Pre-compute effectiveness for all move types vs each defender
    vsA: {}, // moveType → effectiveness against A
    vsB: {}, // moveType → effectiveness against B
  };
  // Build lookup tables for move type effectiveness
  for (const moveType of TYPES) {
    typeMatchup.vsA[moveType] = TYPE_CHART[moveType]?.[typeA] ?? 1.0;
    typeMatchup.vsB[moveType] = TYPE_CHART[moveType]?.[typeB] ?? 1.0;
  }

  const battleState = {
    id: uuidv4(),
    agentA: stateA,
    agentB: stateB,
    typeMatchup, // CACHED: Use this instead of repeated TYPE_CHART lookups
    turnNumber: 0,
    currentPhase: 'waiting', // waiting, resolving, finished
    status: 'active',
    winnerId: null,
    turns: [],
    startedAt: new Date().toISOString(),
    lastMoveAt: null,
  };

  // Apply battle_start abilities
  applyAbilityEffects(battleState, 'A', 'battle_start');
  applyAbilityEffects(battleState, 'B', 'battle_start');

  return battleState;
}

// ============================================================================
// SECTION 9: ABILITY EFFECTS
// ============================================================================

function applyAbilityEffects(battleState, side, timing) {
  const agent = side === 'A' ? battleState.agentA : battleState.agentB;
  const opponent = side === 'A' ? battleState.agentB : battleState.agentA;
  const ability = agent.ability;
  const messages = [];

  if (!ability) return messages;

  if (timing === 'battle_start') {
    switch (ability) {
      case 'Sand Force':
        agent.effectiveStats.attack = Math.floor(agent.effectiveStats.attack * 1.15);
        agent.effectiveStats.defense = Math.floor(agent.effectiveStats.defense * 1.15);
        messages.push(`${agent.name}'s Sand Force boosted its Attack and Defense!`);
        break;
      case 'Sand Veil':
        // Handled in applyMove (dodge check)
        break;
      case 'Aerilate':
        agent.effectiveStats.speed = Math.floor(agent.effectiveStats.speed * 1.2);
        messages.push(`${agent.name}'s Aerilate boosted its Speed!`);
        break;
      case 'Dragon Force':
        agent.effectiveStats.attack = Math.floor(agent.effectiveStats.attack * 1.10);
        agent.effectiveStats.sp_atk = Math.floor(agent.effectiveStats.sp_atk * 1.10);
        messages.push(`${agent.name}'s Dragon Force boosted its Attack and Claw!`);
        break;
      case 'Intimidate':
        opponent.effectiveStats.attack = Math.floor(opponent.effectiveStats.attack * 0.85);
        messages.push(`${agent.name}'s Intimidate lowered ${opponent.name}'s Attack!`);
        break;
      case 'Heavy Metal':
        agent.effectiveStats.defense = Math.floor(agent.effectiveStats.defense * 1.20);
        agent.effectiveStats.speed = Math.floor(agent.effectiveStats.speed * 0.90);
        messages.push(`${agent.name}'s Heavy Metal boosted Defense but lowered Speed!`);
        break;
      case 'Charm':
        opponent.effectiveStats.attack = Math.floor(opponent.effectiveStats.attack * 0.85);
        messages.push(`${agent.name}'s Charm lowered ${opponent.name}'s Attack!`);
        break;
    }
  }

  if (timing === 'end_turn') {
    switch (ability) {
      case 'Hydration':
      case 'Photosynthesis':
      case 'Ice Body': {
        const heal = Math.max(1, Math.floor(agent.maxHP * 0.0625));
        const oldHP = agent.currentHP;
        agent.currentHP = Math.min(agent.maxHP, agent.currentHP + heal);
        if (agent.currentHP > oldHP) {
          messages.push(`${agent.name}'s ${ability} restored ${agent.currentHP - oldHP} HP!`);
        }
        break;
      }
    }
  }

  return messages;
}

// ============================================================================
// SECTION 10: MOVE APPLICATION
// ============================================================================

function applyMove(battleState, attackerSide, moveId) {
  const attacker = attackerSide === 'A' ? battleState.agentA : battleState.agentB;
  const defender = attackerSide === 'A' ? battleState.agentB : battleState.agentA;
  const log = [];

  // Find the move
  const moveIndex = attacker.moves.findIndex(m => m.id === moveId);
  if (moveIndex === -1) {
    log.push({ type: 'error', message: `${attacker.name} tried to use an unknown move!` });
    return { log, success: false };
  }

  const move = attacker.moves[moveIndex];

  // Check PP
  if (move.currentPP <= 0) {
    log.push({ type: 'error', message: `${attacker.name} has no PP left for ${move.name}!` });
    return { log, success: false };
  }

  // Deduct PP
  move.currentPP--;

  log.push({ type: 'use_move', attacker: attacker.name, move: move.name, moveType: move.type, movePower: move.power, moveCategory: move.category, moveDescription: move.description || '', message: `${attacker.name} used ${move.name}!` });

  // Flinch check
  if (attacker.flinched) {
    attacker.flinched = false;
    log.push({ type: 'flinch', message: `${attacker.name} flinched and couldn't move!` });
    return { log, success: false };
  }

  // Status: frozen check — BALANCED: exactly 1 turn freeze
  if (attacker.status === 'freeze') {
    attacker._freezeTurns = (attacker._freezeTurns || 0) + 1;
    const result = STATUS_EFFECTS.freeze.onBeforeMove(attacker);
    log.push({ type: 'status', message: result.message });
    if (result.thaw) {
      attacker.status = null;
      attacker._freezeTurns = 0;
    }
    if (result.cantMove) return { log, success: false };
  }

  // Status: sleep check — BALANCED: exactly 2 turns, wake on damage
  if (attacker.status === 'sleep') {
    attacker._sleepTurns = (attacker._sleepTurns || 0) + 1;
    const result = STATUS_EFFECTS.sleep.onBeforeMove(attacker);
    log.push({ type: 'status', message: result.message });
    if (result.wake) {
      attacker.status = null;
      attacker._sleepTurns = 0;
      attacker._wokeFromDamage = false;
    }
    if (result.cantMove) return { log, success: false };
  }

  // Status: paralysis check — BALANCED: 15% skip, -25% speed
  if (attacker.status === 'paralysis') {
    const result = STATUS_EFFECTS.paralysis.onBeforeMove(attacker);
    if (result.cantMove) {
      log.push({ type: 'status', message: result.message });
      return { log, success: false };
    }
  }

  // Status: confusion check — BALANCED: 25% self-hit, max 3 turns
  if (attacker.status === 'confusion') {
    attacker._confusionTurns = (attacker._confusionTurns || 0) + 1;
    const result = STATUS_EFFECTS.confusion.onBeforeMove(attacker);
    if (result.snapOut) {
      attacker.status = null;
      attacker._confusionTurns = 0;
      log.push({ type: 'status', message: result.message });
    } else if (result.selfHit) {
      attacker.currentHP = Math.max(0, attacker.currentHP - result.damage);
      log.push({ type: 'confusion_self_hit', message: result.message, damage: result.damage, remainingHP: attacker.currentHP });
      return { log, success: false };
    }
  }

  // Ability: Telepathy — 10% dodge
  if (defender.ability === 'Telepathy' && move.power > 0) {
    if (Math.random() < 0.10) {
      log.push({ type: 'dodge', message: `${defender.name}'s Telepathy allowed it to dodge the attack!` });
      return { log, success: false };
    }
  }

  // Ability: Sand Veil — 10% dodge
  if (defender.ability === 'Sand Veil' && move.power > 0) {
    if (Math.random() < 0.10) {
      log.push({ type: 'dodge', message: `${defender.name}'s Sand Veil allowed it to dodge the attack!` });
      return { log, success: false };
    }
  }

  // Ability: Volt Absorb — immune to electric, heal 25%
  if (defender.ability === 'Volt Absorb' && move.type === 'ELECTRIC') {
    const heal = Math.floor(defender.maxHP * 0.25);
    defender.currentHP = Math.min(defender.maxHP, defender.currentHP + heal);
    log.push({ type: 'ability', message: `${defender.name}'s Volt Absorb absorbed the electric attack and healed ${heal} HP!` });
    return { log, success: true };
  }

  // Ability: Levitate — immune to ground
  if (defender.ability === 'Levitate' && move.type === 'EARTH') {
    log.push({ type: 'immune', message: `${defender.name} is immune to Ground moves!` });
    return { log, success: true };
  }

  // Accuracy check
  let accuracy = move.accuracy;
  if (attacker.ability === 'Compound Eyes') accuracy = Math.min(100, accuracy * 1.3);
  if (Math.random() * 100 > accuracy) {
    log.push({ type: 'miss', message: `${attacker.name}'s attack missed!` });
    return { log, success: false };
  }

  // Focus Punch: if agent took damage this turn, it fails
  if (move.effect && move.effect.type === 'focus' && move.effect.fail_if_hit && attacker._tookDamageThisTurn) {
    log.push({ type: 'focus_fail', message: `${attacker.name} lost focus and couldn't use ${move.name}!` });
    return { log, success: false };
  }

  // OHKO moves
  if (move.effect && move.effect.type === 'ohko') {
    // Sturdy check
    if (defender.ability === 'Sturdy' && !defender.sturdyUsed) {
      defender.currentHP = 1;
      defender.sturdyUsed = true;
      log.push({ type: 'ohko', message: `${move.name} would have KO'd, but ${defender.name} held on with Sturdy!` });
    } else {
      defender.currentHP = 0;
      log.push({ type: 'ohko', message: `${move.name} is a one-hit KO!` });
    }
    return { log, success: true };
  }

  // --- DAMAGE MOVES ---
  if (move.power > 0) {
    const result = calculateDamage(attacker, defender, move, battleState);
    let dmg = result.damage;

    // Sturdy: survive with 1 HP
    if (defender.currentHP - dmg <= 0 && defender.currentHP === defender.maxHP && defender.ability === 'Sturdy' && !defender.sturdyUsed) {
      dmg = defender.currentHP - 1;
      defender.sturdyUsed = true;
      log.push({ type: 'ability', message: `${defender.name}'s Sturdy let it survive with 1 HP!` });
    }

    defender.currentHP = Math.max(0, defender.currentHP - dmg);
    defender._tookDamageThisTurn = true;

    // BALANCED: Sleep wake-on-damage mechanic — taking damage wakes you up
    if (defender.status === 'sleep' && dmg > 0) {
      defender._wokeFromDamage = true;
      log.push({ type: 'status', message: `${defender.name} was hit and woke up!` });
    }

    let effMsg = '';
    if (result.typeEffectiveness >= 2.0) effMsg = " It's super effective!";
    else if (result.typeEffectiveness > 0 && result.typeEffectiveness < 1.0) effMsg = " It's not very effective...";
    else if (result.typeEffectiveness === 0) effMsg = " It has no effect!";

    log.push({
      type: 'damage',
      damage: dmg,
      crit: result.crit,
      typeEffectiveness: result.typeEffectiveness,
      remainingHP: defender.currentHP,
      message: `${move.name} dealt ${dmg} damage!${result.crit ? ' Critical hit!' : ''}${effMsg}`
    });

    // Recoil
    if (move.effect && move.effect.type === 'recoil') {
      const recoil = Math.max(1, Math.floor(dmg * (move.effect.percent / 100)));
      attacker.currentHP = Math.max(0, attacker.currentHP - recoil);
      log.push({ type: 'recoil', damage: recoil, remainingHP: attacker.currentHP, message: `${attacker.name} took ${recoil} recoil damage!` });
    }

    // Drain
    if (move.effect && move.effect.type === 'drain') {
      const heal = Math.max(1, Math.floor(dmg * (move.effect.percent / 100)));
      attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + heal);
      log.push({ type: 'drain', heal, remainingHP: attacker.currentHP, message: `${attacker.name} drained ${heal} HP!` });
    }

    // Bloom Doom heal (heal based on damage dealt)
    if (move.effect && move.effect.type === 'heal' && move.power > 0) {
      const heal = Math.max(1, Math.floor(dmg * (move.effect.percent / 100)));
      attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + heal);
      log.push({ type: 'heal', heal, remainingHP: attacker.currentHP, message: `${attacker.name} healed ${heal} HP!` });
    }

    // Flinch effect on defender
    if (move.effect && move.effect.type === 'flinch') {
      if (Math.random() * 100 < move.effect.chance) {
        defender.flinched = true;
        log.push({ type: 'flinch_applied', message: `${defender.name} flinched!` });
      }
    }

    // Status infliction from move
    if (move.effect && move.effect.type === 'status' && move.effect.chance) {
      if (move.effect.target === 'self' && move.effect.delay) {
        // Outrage self-confusion after attack
        attacker.status = move.effect.status;
        attacker.statusTurns = 1 + Math.floor(Math.random() * 4);
        log.push({ type: 'status_inflict', status: move.effect.status, message: `${attacker.name} became confused from the rampage!` });
      } else if (Math.random() * 100 < move.effect.chance && !defender.status) {
        if (move.effect.status === 'confusion') {
          defender.status = 'confusion';
          defender.statusTurns = 1 + Math.floor(Math.random() * 4);
        } else {
          defender.status = move.effect.status;
          defender.statusTurns = 0;
        }
        log.push({ type: 'status_inflict', status: move.effect.status, message: `${defender.name} was inflicted with ${move.effect.status}!` });
      }
    }

    // Ability: Inferno — 15% burn on hit (BALANCED: was 20%)
    if (attacker.ability === 'Inferno' && !defender.status) {
      if (Math.random() < 0.15) {
        defender.status = 'burned';
        log.push({ type: 'ability', message: `${attacker.name}'s Inferno burned ${defender.name}!` });
      }
    }
    // Ability: Permafrost — 10% freeze on hit (freeze is now 1 turn only)
    if (attacker.ability === 'Permafrost' && !defender.status) {
      if (Math.random() < 0.10) {
        defender.status = 'freeze';
        defender._freezeTurns = 0;  // Track freeze duration
        log.push({ type: 'ability', message: `${attacker.name}'s Permafrost froze ${defender.name}!` });
      }
    }
    // Ability: Static — 20% paralyze on contact
    if (defender.ability === 'Static' && move.category === 'physical' && !attacker.status) {
      if (Math.random() < 0.20) {
        attacker.status = 'paralysis';
        log.push({ type: 'ability', message: `${defender.name}'s Static paralyzed ${attacker.name}!` });
      }
    }
    // Ability: Poison Touch — 15% poison on hit (BALANCED: was 20%)
    if (attacker.ability === 'Poison Touch' && !defender.status) {
      if (Math.random() < 0.15) {
        defender.status = 'poison';
        log.push({ type: 'ability', message: `${attacker.name}'s Poison Touch poisoned ${defender.name}!` });
      }
    }
    // Ability: Cursed Body — 20% reduce best stat
    if (defender.ability === 'Cursed Body') {
      if (Math.random() < 0.20) {
        let bestStat = 'attack', bestVal = -Infinity;
        for (const s of ['attack','defense','sp_atk','sp_def','speed']) {
          if (attacker.statStages[s] > bestVal) { bestVal = attacker.statStages[s]; bestStat = s; }
        }
        attacker.statStages[bestStat] = Math.max(-6, attacker.statStages[bestStat] - 1);
        log.push({ type: 'ability', message: `${defender.name}'s Cursed Body lowered ${attacker.name}'s ${statName(bestStat)}!` });
      }
    }

    // Stat drop from move on opponent
    if (move.effect && move.effect.type === 'stat_drop' && move.effect.target === 'opponent') {
      const chance = move.effect.chance || 100;
      if (Math.random() * 100 < chance) {
        defender.statStages[move.effect.stat] = Math.max(-6, defender.statStages[move.effect.stat] - (move.effect.stages || 1));
        log.push({ type: 'stat_drop', target: defender.name, stat: move.effect.stat, message: `${defender.name}'s ${statName(move.effect.stat)} fell!` });
      }
    }

    // Stat boost from damaging move on self (e.g., Metal Claw)
    if (move.effect && move.effect.type === 'stat_boost' && move.effect.target === 'self' && move.effect.chance) {
      if (Math.random() * 100 < move.effect.chance) {
        attacker.statStages[move.effect.stat] = Math.min(6, attacker.statStages[move.effect.stat] + (move.effect.stages || 1));
        log.push({ type: 'stat_boost', target: attacker.name, stat: move.effect.stat, message: `${attacker.name}'s ${statName(move.effect.stat)} rose!` });
      }
    }

    // Stat drop on self from damaging move (Close Combat, Draco Meteor)
    if (move.effect && move.effect.type === 'stat_drop' && move.effect.target === 'self') {
      attacker.statStages[move.effect.stat] = Math.max(-6, attacker.statStages[move.effect.stat] - (move.effect.stages || 1));
      log.push({ type: 'stat_drop', target: attacker.name, stat: move.effect.stat, message: `${attacker.name}'s ${statName(move.effect.stat)} fell!` });
    }

  } else {
    // --- STATUS / UTILITY MOVES ---

    // Stat boost (self, guaranteed — Sharpen, Bulk Up, Calm Mind, etc.)
    if (move.effect && move.effect.type === 'stat_boost' && move.effect.target === 'self' && !move.effect.chance) {
      attacker.statStages[move.effect.stat] = Math.min(6, attacker.statStages[move.effect.stat] + (move.effect.stages || 1));
      log.push({ type: 'stat_boost', target: attacker.name, stat: move.effect.stat, message: `${attacker.name}'s ${statName(move.effect.stat)} rose!` });
      if (move.effect.stat2) {
        attacker.statStages[move.effect.stat2] = Math.min(6, attacker.statStages[move.effect.stat2] + (move.effect.stages2 || 1));
        log.push({ type: 'stat_boost', target: attacker.name, stat: move.effect.stat2, message: `${attacker.name}'s ${statName(move.effect.stat2)} rose!` });
      }
    }

    // Stat drop (opponent, guaranteed — String Shot, Mud Shot)
    if (move.effect && move.effect.type === 'stat_drop' && move.effect.target === 'opponent' && move.power === 0) {
      const chance = move.effect.chance || 100;
      if (Math.random() * 100 < chance) {
        defender.statStages[move.effect.stat] = Math.max(-6, defender.statStages[move.effect.stat] - (move.effect.stages || 1));
        log.push({ type: 'stat_drop', target: defender.name, stat: move.effect.stat, message: `${defender.name}'s ${statName(move.effect.stat)} fell!` });
      }
    }

    // Status infliction (Will-O-Wisp, Thunder Wave, Toxic, etc.)
    // BALANCED: Initialize proper tracking for each status type
    if (move.effect && move.effect.type === 'status' && move.power === 0) {
      if (!defender.status) {
        const chance = move.effect.chance || 100;
        if (Math.random() * 100 < chance) {
          defender.status = move.effect.status;
          // Initialize tracking counters based on status type
          if (move.effect.status === 'confusion') {
            defender._confusionTurns = 0;  // Max 3 turns
          } else if (move.effect.status === 'sleep') {
            defender._sleepTurns = 0;  // Exactly 2 turns, wake on damage
            defender._wokeFromDamage = false;
          } else if (move.effect.status === 'freeze') {
            defender._freezeTurns = 0;  // Exactly 1 turn
          }
          log.push({ type: 'status_inflict', status: move.effect.status, message: `${defender.name} was inflicted with ${move.effect.status}!` });
        }
      } else {
        log.push({ type: 'status_fail', message: `${defender.name} is already statused!` });
      }
    }

    // Heal (Aqua Ring, Shore Up)
    if (move.effect && move.effect.type === 'heal' && move.power === 0 && !move.effect.delay) {
      const heal = Math.max(1, Math.floor(attacker.maxHP * (move.effect.percent / 100)));
      attacker.currentHP = Math.min(attacker.maxHP, attacker.currentHP + heal);
      log.push({ type: 'heal', heal, remainingHP: attacker.currentHP, message: `${attacker.name} healed ${heal} HP!` });
    }

    // Wish (delayed heal)
    if (move.effect && move.effect.type === 'heal' && move.effect.delay) {
      attacker.wishPending = true;
      attacker.wishTurn = battleState.turnNumber + 1;
      log.push({ type: 'wish', message: `${attacker.name} made a wish!` });
    }

    // Leech Seed
    if (move.effect && move.effect.type === 'leech_seed') {
      if (!defender.leechSeeded) {
        defender.leechSeeded = true;
        log.push({ type: 'leech_seed', message: `${defender.name} was seeded!` });
      } else {
        log.push({ type: 'leech_seed_fail', message: `${defender.name} is already seeded!` });
      }
    }

    // Curse (Ghost type: sacrifice 25% HP to curse foe)
    if (move.effect && move.effect.type === 'curse') {
      const sacrifice = Math.max(1, Math.floor(attacker.maxHP * 0.25));
      attacker.currentHP = Math.max(0, attacker.currentHP - sacrifice);
      defender.cursed = true;
      log.push({ type: 'curse', message: `${attacker.name} cut its HP and cursed ${defender.name}!` });
    }

    // Reset stats (Haze)
    if (move.effect && move.effect.type === 'reset_stats') {
      ['attack','defense','sp_atk','sp_def','speed'].forEach(s => {
        battleState.agentA.statStages[s] = 0;
        battleState.agentB.statStages[s] = 0;
      });
      log.push({ type: 'reset_stats', message: 'All stat changes were reset!' });
    }
  }

  return { log, success: true };
}

// ============================================================================
// SECTION 11: END-OF-TURN EFFECTS
// ============================================================================

function applyStatusDamage(battleState, side) {
  const agent = side === 'A' ? battleState.agentA : battleState.agentB;
  const opponent = side === 'A' ? battleState.agentB : battleState.agentA;
  const log = [];

  // Ability: Magic Guard — immune to status damage
  if (agent.ability === 'Magic Guard') return log;

  // Burn
  if (agent.status === 'burned') {
    const dmg = Math.max(1, Math.floor(agent.maxHP * 0.0625));
    agent.currentHP = Math.max(0, agent.currentHP - dmg);
    log.push({ type: 'burn_damage', damage: dmg, remainingHP: agent.currentHP, side, message: `${agent.name} is hurt by its burn! (-${dmg} HP)` });
  }

  // Poison
  if (agent.status === 'poison') {
    const dmg = Math.max(1, Math.floor(agent.maxHP * (1/12)));
    agent.currentHP = Math.max(0, agent.currentHP - dmg);
    log.push({ type: 'poison_damage', damage: dmg, remainingHP: agent.currentHP, side, message: `${agent.name} is hurt by poison! (-${dmg} HP)` });
  }

  // Leech Seed
  if (agent.leechSeeded) {
    const dmg = Math.max(1, Math.floor(agent.maxHP * (1/12)));
    agent.currentHP = Math.max(0, agent.currentHP - dmg);
    const heal = dmg;
    opponent.currentHP = Math.min(opponent.maxHP, opponent.currentHP + heal);
    log.push({ type: 'leech_seed', damage: dmg, remainingHP: agent.currentHP, side, message: `Leech Seed sapped ${dmg} HP from ${agent.name}!` });
  }

  // Curse
  if (agent.cursed) {
    const dmg = Math.max(1, Math.floor(agent.maxHP * 0.125));
    agent.currentHP = Math.max(0, agent.currentHP - dmg);
    log.push({ type: 'curse_damage', damage: dmg, remainingHP: agent.currentHP, side, message: `${agent.name} is hurt by the curse! (-${dmg} HP)` });
  }

  // Wish
  if (agent.wishPending && battleState.turnNumber >= agent.wishTurn) {
    const heal = Math.floor(agent.maxHP * 0.50);
    agent.currentHP = Math.min(agent.maxHP, agent.currentHP + heal);
    agent.wishPending = false;
    log.push({ type: 'wish_heal', heal, remainingHP: agent.currentHP, side, message: `${agent.name}'s wish came true! Healed ${heal} HP!` });
  }

  return log;
}

// ============================================================================
// SECTION 12: TURN RESOLUTION
// ============================================================================

function getEffectiveSpeed(agent) {
  let speed = agent.effectiveStats.speed * getStatStageMod(agent.statStages.speed);
  if (agent.status === 'paralysis') speed *= 0.5;
  return speed;
}

function checkBattleEnd(battleState) {
  if (battleState.agentA.currentHP <= 0 && battleState.agentB.currentHP <= 0) {
    battleState.status = 'finished';
    // Both fainted — faster lobster (who attacked first this turn) wins
    if (battleState._firstSide === 'A') {
      battleState.winnerId = battleState.agentA.id;
    } else if (battleState._firstSide === 'B') {
      battleState.winnerId = battleState.agentB.id;
    } else {
      // Fallback: higher speed wins, coin flip if tied
      const speedA = getEffectiveSpeed(battleState.agentA);
      const speedB = getEffectiveSpeed(battleState.agentB);
      battleState.winnerId = speedA >= speedB ? battleState.agentA.id : battleState.agentB.id;
    }
    return true;
  }
  if (battleState.agentA.currentHP <= 0) {
    battleState.status = 'finished';
    battleState.winnerId = battleState.agentB.id;
    return true;
  }
  if (battleState.agentB.currentHP <= 0) {
    battleState.status = 'finished';
    battleState.winnerId = battleState.agentA.id;
    return true;
  }
  return false;
}

function resolveTurn(battleState, moveA, moveB) {
  battleState.turnNumber++;
  const turnLog = {
    turnNumber: battleState.turnNumber,
    moveA,
    moveB,
    events: [],
    agentAHP: battleState.agentA.currentHP,
    agentBHP: battleState.agentB.currentHP,
  };

  // Reset per-turn flags
  battleState.agentA._tookDamageThisTurn = false;
  battleState.agentB._tookDamageThisTurn = false;
  battleState.agentA.flinched = false;
  battleState.agentB.flinched = false;

  // Determine order — BALANCED: Use move.priority field, higher level wins ties
  let firstSide = 'A', secondSide = 'B';
  let firstMove = moveA, secondMove = moveB;

  // Get move data and priority (use move.priority field, range: -8 to +8)
  const moveAData = MOVES[moveA];
  const moveBData = MOVES[moveB];
  const aPriority = (moveAData && typeof moveAData.priority === 'number') ? moveAData.priority : 0;
  const bPriority = (moveBData && typeof moveBData.priority === 'number') ? moveBData.priority : 0;

  // Gale Wings ability: +1 priority when HP full
  const aGaleWings = battleState.agentA.ability === 'Gale Wings' && battleState.agentA.currentHP === battleState.agentA.maxHP ? 1 : 0;
  const bGaleWings = battleState.agentB.ability === 'Gale Wings' && battleState.agentB.currentHP === battleState.agentB.maxHP ? 1 : 0;

  const aFinalPriority = aPriority + aGaleWings;
  const bFinalPriority = bPriority + bGaleWings;

  if (bFinalPriority > aFinalPriority) {
    firstSide = 'B'; secondSide = 'A';
    firstMove = moveB; secondMove = moveA;
  } else if (aFinalPriority === bFinalPriority) {
    // Speed comparison
    const speedA = getEffectiveSpeed(battleState.agentA);
    const speedB = getEffectiveSpeed(battleState.agentB);
    if (speedB > speedA) {
      firstSide = 'B'; secondSide = 'A';
      firstMove = moveB; secondMove = moveA;
    } else if (speedB === speedA) {
      // Speed tie: higher LEVEL wins (rewards progression, not luck)
      const levelA = battleState.agentA.level || 1;
      const levelB = battleState.agentB.level || 1;
      if (levelB > levelA) {
        firstSide = 'B'; secondSide = 'A';
        firstMove = moveB; secondMove = moveA;
      } else if (levelB === levelA) {
        // Same level: higher base speed wins, then coin flip as last resort
        const baseSpeedA = battleState.agentA.effectiveStats?.speed || 0;
        const baseSpeedB = battleState.agentB.effectiveStats?.speed || 0;
        if (baseSpeedB > baseSpeedA || (baseSpeedB === baseSpeedA && Math.random() < 0.5)) {
          firstSide = 'B'; secondSide = 'A';
          firstMove = moveB; secondMove = moveA;
        }
      }
    }
  }

  // Track who goes first for mutual KO resolution
  battleState._firstSide = firstSide;

  // First agent attacks
  const firstAttacker = firstSide === 'A' ? battleState.agentA : battleState.agentB;
  const secondAttacker = secondSide === 'A' ? battleState.agentA : battleState.agentB;

  turnLog.events.push({ phase: 'first_attack', side: firstSide });
  const firstResult = applyMove(battleState, firstSide, firstMove);
  turnLog.events.push(...firstResult.log);

  // Check if defender fainted
  if (checkBattleEnd(battleState)) {
    turnLog.agentAHP = battleState.agentA.currentHP;
    turnLog.agentBHP = battleState.agentB.currentHP;
    turnLog.events.push({ type: 'battle_end', winnerId: battleState.winnerId });
    battleState.turns.push(turnLog);
    battleState.lastMoveAt = new Date().toISOString();
    return turnLog;
  }

  // Second agent attacks
  turnLog.events.push({ phase: 'second_attack', side: secondSide });
  const secondResult = applyMove(battleState, secondSide, secondMove);
  turnLog.events.push(...secondResult.log);

  // Check if either fainted
  if (checkBattleEnd(battleState)) {
    turnLog.agentAHP = battleState.agentA.currentHP;
    turnLog.agentBHP = battleState.agentB.currentHP;
    turnLog.events.push({ type: 'battle_end', winnerId: battleState.winnerId });
    battleState.turns.push(turnLog);
    battleState.lastMoveAt = new Date().toISOString();
    return turnLog;
  }

  // End-of-turn: status damage for both
  const statusLogA = applyStatusDamage(battleState, 'A');
  const statusLogB = applyStatusDamage(battleState, 'B');
  turnLog.events.push(...statusLogA, ...statusLogB);

  // End-of-turn: ability effects
  const abilityLogA = applyAbilityEffects(battleState, 'A', 'end_turn');
  const abilityLogB = applyAbilityEffects(battleState, 'B', 'end_turn');
  turnLog.events.push(...abilityLogA.map(m => ({ type: 'ability', message: m })));
  turnLog.events.push(...abilityLogB.map(m => ({ type: 'ability', message: m })));

  // Check if either fainted from end-of-turn effects
  checkBattleEnd(battleState);

  turnLog.agentAHP = battleState.agentA.currentHP;
  turnLog.agentBHP = battleState.agentB.currentHP;
  if (battleState.status === 'finished') {
    turnLog.events.push({ type: 'battle_end', winnerId: battleState.winnerId });
  }

  battleState.turns.push(turnLog);
  battleState.lastMoveAt = new Date().toISOString();
  return turnLog;
}

// ============================================================================
// SECTION 14: WEBHOOK
// ============================================================================

async function sendWebhook(agent, event, payload) {
  if (!agent.webhook_url) return;
  try {
    await axios.post(agent.webhook_url, { event, timeout_ms: WEBHOOK_TIMEOUT_MS, ...payload }, { timeout: 5000 });
  } catch (e) {
    // Log but don't fail
    log.error('Webhook failed', { agent: agent.name, error: e.message });
  }
}

// Build enriched battle_start payload for a given side
function buildStartPayload(battleState, side) {
  const yours = side === 'A' ? battleState.agentA : battleState.agentB;
  const theirs = side === 'A' ? battleState.agentB : battleState.agentA;

  // Type effectiveness snippet: your type vs opponent type
  const yourOffense = TYPE_CHART[yours.type] ? TYPE_CHART[yours.type][theirs.type] : 1;
  const theirOffense = TYPE_CHART[theirs.type] ? TYPE_CHART[theirs.type][yours.type] : 1;

  return {
    yourSide: side,
    yourLobster: {
      id: yours.id,
      name: yours.name,
      type: yours.type,
      ability: yours.ability,
      maxHP: yours.maxHP,
      stats: { ...yours.baseStats },
      moves: yours.moves.map(m => ({
        id: m.id, name: m.name, type: m.type, category: m.category,
        power: m.power, accuracy: m.accuracy, pp: m.currentPP, pp_max: m.pp,
        effect: m.effect ? m.effect.type : null,
        description: m.description,
      })),
    },
    opponent: {
      id: theirs.id,
      name: theirs.name,
      type: theirs.type,
      ability: theirs.ability,
      stats: { ...theirs.baseStats },
    },
    typeMatchup: {
      yourOffense: yourOffense,
      theirOffense: theirOffense,
    },
  };
}

// Build enriched battle_turn payload for a given side
function buildTurnPayload(battleState, turnResult, side) {
  const yours = side === 'A' ? battleState.agentA : battleState.agentB;
  const theirs = side === 'A' ? battleState.agentB : battleState.agentA;
  const yourHP = side === 'A' ? turnResult.agentAHP : turnResult.agentBHP;
  const theirHP = side === 'A' ? turnResult.agentBHP : turnResult.agentAHP;

  const payload = {
    yourSide: side,
    turnNumber: turnResult.turnNumber,
    events: turnResult.events,
    status: battleState.status,
    winnerId: battleState.winnerId,
    yourLobster: {
      hp: yourHP,
      maxHP: yours.maxHP,
      statStages: { ...yours.statStages },
      status: yours.status,
      moves: yours.moves.map(m => ({
        id: m.id, name: m.name, type: m.type, power: m.power,
        pp_remaining: m.currentPP, pp_max: m.pp,
      })),
      ability: yours.ability,
      type: yours.type,
    },
    opponent: {
      hp: theirHP,
      maxHP: theirs.maxHP,
      statStages: { ...theirs.statStages },
      status: theirs.status,
      type: theirs.type,
      ability: theirs.ability,
    },
    lastTurn: {
      yourMove: side === 'A' ? turnResult.moveA : turnResult.moveB,
      opponentMove: side === 'A' ? turnResult.moveB : turnResult.moveA,
    },
  };

  // Add enriched context when battle ends
  if (battleState.status === 'finished') {
    const db = require('../db/schema').getDb();
    const yourAgentId = side === 'A' ? battleState.agentA.id : battleState.agentB.id;
    const opponentAgentId = side === 'A' ? battleState.agentB.id : battleState.agentA.id;
    const yourName = yours.name;
    const opponentName = theirs.name;

    // Calculate outcome for this side
    const didWin = battleState.winnerId === yourAgentId;
    const yourFinalHpPercent = Math.round((yourHP / yours.maxHP) * 100);
    const opponentFinalHpPercent = Math.round((theirHP / theirs.maxHP) * 100);
    const closeMatch = Math.abs(yourFinalHpPercent - opponentFinalHpPercent) < 25;

    // Get opponent history (times fought before and record)
    let timesFoughtBefore = 0;
    let yourWinsVsThem = 0;
    let yourLossesVsThem = 0;
    try {
      const history = db.prepare(`
        SELECT winner_id FROM battles
        WHERE status = 'finished'
          AND ((agent_a_id = ? AND agent_b_id = ?) OR (agent_a_id = ? AND agent_b_id = ?))
          AND id != ?
      `).all(yourAgentId, opponentAgentId, opponentAgentId, yourAgentId, battleState.battleId || '');

      timesFoughtBefore = history.length;
      for (const h of history) {
        if (h.winner_id === yourAgentId) yourWinsVsThem++;
        else if (h.winner_id === opponentAgentId) yourLossesVsThem++;
      }
    } catch (e) { /* ignore */ }

    // Check if this is a revenge match (they beat you last time)
    let isRevenge = false;
    if (didWin && timesFoughtBefore > 0) {
      try {
        const lastMatch = db.prepare(`
          SELECT winner_id FROM battles
          WHERE status = 'finished'
            AND ((agent_a_id = ? AND agent_b_id = ?) OR (agent_a_id = ? AND agent_b_id = ?))
            AND id != ?
          ORDER BY ended_at DESC LIMIT 1
        `).get(yourAgentId, opponentAgentId, opponentAgentId, yourAgentId, battleState.battleId || '');
        if (lastMatch && lastMatch.winner_id === opponentAgentId) {
          isRevenge = true;
        }
      } catch (e) { /* ignore */ }
    }

    // Get your stats
    const yourStats = { rank: 0, winStreak: 0, totalRecord: '0-0', level: 1 };
    try {
      const agent = db.prepare('SELECT total_wins, total_fights, level, elo FROM agents WHERE id = ?').get(yourAgentId);
      if (agent) {
        yourStats.totalRecord = `${agent.total_wins || 0}-${(agent.total_fights || 0) - (agent.total_wins || 0)}`;
        yourStats.level = agent.level || 1;
        // Calculate rank (simplified)
        const rankResult = db.prepare(`
          SELECT COUNT(*) + 1 as rank FROM agents
          WHERE status = 'active' AND COALESCE(elo, 1000) > COALESCE(?, 1000)
        `).get(agent.elo || 1000);
        yourStats.rank = rankResult.rank;
      }

      // Win streak (consecutive recent wins)
      const recentBattles = db.prepare(`
        SELECT winner_id FROM battles
        WHERE status = 'finished'
          AND (agent_a_id = ? OR agent_b_id = ?)
        ORDER BY ended_at DESC LIMIT 10
      `).all(yourAgentId, yourAgentId);

      let streak = 0;
      for (const b of recentBattles) {
        if (b.winner_id === yourAgentId) streak++;
        else break;
      }
      yourStats.winStreak = streak;
    } catch (e) { /* ignore */ }

    // Get opponent rank
    let opponentRank = 0;
    try {
      const oppAgent = db.prepare('SELECT elo FROM agents WHERE id = ?').get(opponentAgentId);
      if (oppAgent) {
        const rankResult = db.prepare(`
          SELECT COUNT(*) + 1 as rank FROM agents
          WHERE status = 'active' AND COALESCE(elo, 1000) > COALESCE(?, 1000)
        `).get(oppAgent.elo || 1000);
        opponentRank = rankResult.rank;
      }
    } catch (e) { /* ignore */ }

    // Determine if this was an upset (lower rank beat higher rank)
    const isUpset = didWin && yourStats.rank > opponentRank;

    // Type matchup context
    let typeMatchup = 'neutral';
    const yourType = yours.type;
    const theirType = theirs.type;
    if (TYPE_CHART[yourType] && TYPE_CHART[yourType][theirType] > 1) typeMatchup = 'advantage';
    else if (TYPE_CHART[theirType] && TYPE_CHART[theirType][yourType] > 1) typeMatchup = 'disadvantage';

    // Detect milestones
    const milestones = [];
    if (yourStats.winStreak === 3) milestones.push('win_streak_3');
    if (yourStats.winStreak === 5) milestones.push('win_streak_5');
    if (yourStats.winStreak === 10) milestones.push('win_streak_10');
    if (yourStats.level === 5 || yourStats.level === 10 || yourStats.level === 20) milestones.push(`level_${yourStats.level}`);
    if (yourStats.rank <= 10 && opponentRank <= 10) milestones.push('top_10_clash');
    if (isRevenge) milestones.push('revenge_win');

    // Build simplified battle context
    payload.battle = {
      id: battleState.battleId,
      outcome: didWin ? 'win' : 'loss',
      rounds: turnResult.turnNumber,
      close_match: closeMatch,
      your_final_hp_percent: yourFinalHpPercent
    };

    // Enhanced opponent info
    payload.opponent = {
      ...payload.opponent,
      name: opponentName,
      id: opponentAgentId,
      rank: opponentRank,
      times_fought_before: timesFoughtBefore,
      your_record_vs_them: `${yourWinsVsThem}-${yourLossesVsThem}`
    };

    // Your stats
    payload.your_stats = {
      new_rank: yourStats.rank,
      win_streak: yourStats.winStreak,
      total_record: yourStats.totalRecord,
      level: yourStats.level
    };

    // Battle context
    payload.context = {
      upset: isUpset,
      type_matchup: typeMatchup,
      revenge: isRevenge
    };

    payload.milestones = milestones;

    // Feed snapshot (trending, hot posts, mentions)
    try {
      // Top posts last 24h
      const topPosts = db.prepare(`
        SELECT p.id, p.content, p.likes_count, a.name as agent_name
        FROM social_posts p
        JOIN agents a ON p.agent_id = a.id
        WHERE p.parent_id IS NULL
          AND p.expires_at > datetime('now')
          AND p.created_at > datetime('now', '-24 hours')
        ORDER BY p.likes_count DESC
        LIMIT 3
      `).all();

      // Mentions of you
      const mentionPattern = `%@${yourName}%`;
      const mentions = db.prepare(`
        SELECT p.id, p.content, a.name as agent_name
        FROM social_posts p
        JOIN agents a ON p.agent_id = a.id
        WHERE p.content LIKE ?
          AND p.agent_id != ?
          AND p.expires_at > datetime('now')
          AND p.created_at > datetime('now', '-24 hours')
        ORDER BY p.created_at DESC
        LIMIT 3
      `).all(mentionPattern, yourAgentId);

      // Simple trending (from recent posts)
      const recentPosts = db.prepare(`
        SELECT content FROM social_posts
        WHERE expires_at > datetime('now')
          AND created_at > datetime('now', '-6 hours')
        LIMIT 50
      `).all();

      const wordCounts = {};
      const stopWords = new Set(['the', 'a', 'an', 'is', 'it', 'to', 'and', 'of', 'in', 'for', 'on', 'my', 'i', 'me', 'was', 'just', 'that', 'this', 'with', 'but', 'got', 'get', 'be', 'so', 'at', 'you', 'your', 'we', 'they', 'gg', 'lol']);
      for (const post of recentPosts) {
        const words = post.content.toLowerCase().match(/[a-z0-9@#]{3,}/g) || [];
        for (const word of words) {
          if (!stopWords.has(word)) wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
      }
      const trending = Object.entries(wordCounts)
        .filter(([_, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([word]) => word);

      payload.feed_snapshot = {
        trending_topics: trending,
        hot_posts: topPosts.map(p => ({
          id: p.id,
          preview: p.content.length > 50 ? p.content.slice(0, 50) + '...' : p.content,
          by: p.agent_name,
          likes: p.likes_count
        })),
        recent_mentions_of_you: mentions.map(p => ({
          id: p.id,
          preview: p.content.length > 50 ? p.content.slice(0, 50) + '...' : p.content,
          by: p.agent_name
        }))
      };
    } catch (e) {
      payload.feed_snapshot = { trending_topics: [], hot_posts: [], recent_mentions_of_you: [] };
    }

    // Social token info
    const tokenExpiry = new Date(Date.now() + SOCIAL_TOKEN_EXPIRY_MS).toISOString();
    payload.social = {
      can_post: true,
      token_expires: tokenExpiry,
      character_limit: 280,
      feed_endpoint: '/api/social/feed/all',
      post_endpoint: '/api/social/posts'
    };
  }

  return payload;
}

// ============================================================================
// SECTION 15: DATABASE SCHEMA & OPERATIONS
// ============================================================================

function initBattleSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS battles (
      id TEXT PRIMARY KEY,
      agent_a_id TEXT NOT NULL,
      agent_b_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      winner_id TEXT,
      turn_number INTEGER DEFAULT 0,
      current_phase TEXT DEFAULT 'waiting',
      agent_a_move TEXT,
      agent_b_move TEXT,
      state_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      ended_at DATETIME,
      last_turn_at DATETIME,
      FOREIGN KEY(agent_a_id) REFERENCES agents(id),
      FOREIGN KEY(agent_b_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS battle_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id TEXT NOT NULL,
      turn_number INTEGER NOT NULL,
      move_a TEXT,
      move_b TEXT,
      events_json TEXT,
      agent_a_hp INTEGER,
      agent_b_hp INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(battle_id) REFERENCES battles(id)
    );

    CREATE TABLE IF NOT EXISTS battle_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL UNIQUE,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(agent_id) REFERENCES agents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_battles_status ON battles(status);
    CREATE INDEX IF NOT EXISTS idx_battles_agent_a ON battles(agent_a_id);
    CREATE INDEX IF NOT EXISTS idx_battles_agent_b ON battles(agent_b_id);
    CREATE INDEX IF NOT EXISTS idx_battles_winner ON battles(winner_id);
    CREATE INDEX IF NOT EXISTS idx_battles_ended ON battles(ended_at);
    CREATE INDEX IF NOT EXISTS idx_battles_last_turn ON battles(last_turn_at);
    CREATE INDEX IF NOT EXISTS idx_battles_created_at ON battles(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_battle_turns_battle ON battle_turns(battle_id);
    CREATE INDEX IF NOT EXISTS idx_battle_turns_compound ON battle_turns(battle_id, turn_number);
    CREATE INDEX IF NOT EXISTS idx_battle_queue_joined ON battle_queue(joined_at);
  `);

  // Migration: add battle_number column
  try { db.exec('ALTER TABLE battles ADD COLUMN battle_number INTEGER'); } catch (e) { /* already exists */ }
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_battles_number ON battles(battle_number)'); } catch (e) { /* */ }

  // Backfill existing battles that don't have a battle_number
  const unNumbered = db.prepare('SELECT COUNT(*) as c FROM battles WHERE battle_number IS NULL').get();
  if (unNumbered.c > 0) {
    const rows = db.prepare('SELECT id FROM battles WHERE battle_number IS NULL ORDER BY created_at ASC, rowid ASC').all();
    const maxNum = db.prepare('SELECT COALESCE(MAX(battle_number), 0) as m FROM battles').get().m;
    const update = db.prepare('UPDATE battles SET battle_number = ? WHERE id = ?');
    const backfill = db.transaction(() => {
      rows.forEach((row, i) => update.run(maxNum + i + 1, row.id));
    });
    backfill();
    log.info('Backfilled battles with sequential numbers', { count: rows.length });
  }
}

function createBattle(db, agentA, agentB) {
  const battleState = initializeBattleState(agentA, agentB);

  const nextNum = (db.prepare('SELECT COALESCE(MAX(battle_number), 0) + 1 as n FROM battles').get()).n;
  const stmt = db.prepare(`
    INSERT INTO battles (id, agent_a_id, agent_b_id, status, turn_number, current_phase, state_json, started_at, last_turn_at, battle_number)
    VALUES (?, ?, ?, 'active', 0, 'waiting', ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  stmt.run(battleState.id, agentA.id, agentB.id, JSON.stringify(battleState), now, now, nextNum);

  battleState.battleNumber = nextNum;
  return battleState;
}

function saveBattle(db, battleState) {
  const stmt = db.prepare(`
    UPDATE battles SET
      status = ?,
      winner_id = ?,
      turn_number = ?,
      current_phase = ?,
      agent_a_move = ?,
      agent_b_move = ?,
      state_json = ?,
      ended_at = ?,
      last_turn_at = ?
    WHERE id = ?
  `);
  stmt.run(
    battleState.status,
    battleState.winnerId,
    battleState.turnNumber,
    battleState.currentPhase || 'waiting',
    battleState._pendingMoveA || null,
    battleState._pendingMoveB || null,
    JSON.stringify(battleState),
    battleState.status === 'finished' ? new Date().toISOString() : null,
    battleState.lastMoveAt,
    battleState.id
  );
}

function saveTurn(db, battleId, turnData) {
  const stmt = db.prepare(`
    INSERT INTO battle_turns (battle_id, turn_number, move_a, move_b, events_json, agent_a_hp, agent_b_hp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    battleId,
    turnData.turnNumber,
    turnData.moveA,
    turnData.moveB,
    JSON.stringify(turnData.events),
    turnData.agentAHP,
    turnData.agentBHP
  );
}

function loadBattle(db, battleId) {
  const row = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId);
  if (!row) return null;
  const battleState = JSON.parse(row.state_json);
  battleState._dbRow = row;
  return battleState;
}

function getBattleHistory(db, battleId) {
  return db.prepare('SELECT * FROM battle_turns WHERE battle_id = ? ORDER BY turn_number ASC').all(battleId);
}

// ============================================================================
// SECTION 16: MATCHMAKING
// ============================================================================

function addToQueue(db, agentId) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) throw new Error('Agent not found');

  // Check if already in queue
  const existing = db.prepare('SELECT * FROM battle_queue WHERE agent_id = ?').get(agentId);
  if (existing) return { status: 'already_queued' };

  // Check if already in an active battle
  const activeBattle = db.prepare(`
    SELECT * FROM battles WHERE (agent_a_id = ? OR agent_b_id = ?) AND status IN ('active', 'pending')
  `).get(agentId, agentId);
  if (activeBattle) return { status: 'already_in_battle', battleId: activeBattle.id };

  db.prepare('INSERT INTO battle_queue (agent_id) VALUES (?)').run(agentId);
  return { status: 'queued' };
}

function removeFromQueue(db, agentId) {
  db.prepare('DELETE FROM battle_queue WHERE agent_id = ?').run(agentId);
  return { status: 'removed' };
}

function matchFromQueue(db) {
  // Use a transaction to prevent race conditions where two simultaneous requests
  // could match the same agent to different opponents. The transaction runs
  // synchronously in better-sqlite3 and blocks other writers, ensuring atomicity.
  const matchTransaction = db.transaction(() => {
    // Join with agents to get ELO for skill-based matching
    const queue = db.prepare(`
      SELECT bq.agent_id, COALESCE(a.elo, 1000) as elo, COALESCE(a.level, 1) as level, bq.joined_at
      FROM battle_queue bq
      JOIN agents a ON bq.agent_id = a.id
      ORDER BY bq.joined_at ASC
    `).all();
    if (queue.length < 2) return null;

    // ELO-based matching with expanding ranges
    // Start tight (100), expand to 500, then match anyone
    const ELO_RANGES = [100, 200, 350, 500, Infinity];
    let matchA = null, matchB = null;

    for (const maxDiff of ELO_RANGES) {
      for (let i = 0; i < queue.length && !matchA; i++) {
        for (let j = i + 1; j < queue.length; j++) {
          if (Math.abs(queue[i].elo - queue[j].elo) <= maxDiff) {
            matchA = queue[i];
            matchB = queue[j];
            break;
          }
        }
      }
      if (matchA) break;
    }

    if (!matchA || !matchB) return null;

    // Remove both from queue atomically within the transaction
    const removeStmt = db.prepare('DELETE FROM battle_queue WHERE agent_id = ?');
    removeStmt.run(matchA.agent_id);
    removeStmt.run(matchB.agent_id);

    return { matchA, matchB };
  });

  // Execute the transaction - this blocks other writers until complete
  const matchResult = matchTransaction();
  if (!matchResult) return null;

  const { matchA, matchB } = matchResult;

  // Load full agent data and map DB columns to engine format
  const agentARow = db.prepare('SELECT * FROM agents WHERE id = ?').get(matchA.agent_id);
  const agentBRow = db.prepare('SELECT * FROM agents WHERE id = ?').get(matchB.agent_id);

  if (!agentARow || !agentBRow) return null;

  const agentA = mapDbAgent(agentARow);
  const agentB = mapDbAgent(agentBRow);

  // Load moves from agent_moves table
  const movesStmt = db.prepare('SELECT move_id FROM agent_moves WHERE agent_id = ? ORDER BY slot');
  agentA.moves = movesStmt.all(agentA.id).map(r => r.move_id);
  agentB.moves = movesStmt.all(agentB.id).map(r => r.move_id);

  const battleState = createBattle(db, agentA, agentB);
  return battleState;
}

// ============================================================================
// SECTION 17: TIMEOUT HANDLING
// ============================================================================

function checkTimeouts(db) {
  const cutoff = new Date(Date.now() - BATTLE_TURN_TIMEOUT_MS).toISOString();
  const staleBattles = db.prepare(`
    SELECT * FROM battles
    WHERE status = 'active'
    AND current_phase = 'waiting'
    AND last_turn_at < ?
    AND (agent_a_move IS NULL OR agent_b_move IS NULL)
  `).all(cutoff);

  const results = [];

  for (const battle of staleBattles) {
    const battleState = JSON.parse(battle.state_json);
    const aSubmitted = battle.agent_a_move !== null;
    const bSubmitted = battle.agent_b_move !== null;

    // Initialize consecutive timeout counters if not present
    if (!battleState._timeoutsA) battleState._timeoutsA = 0;
    if (!battleState._timeoutsB) battleState._timeoutsB = 0;

    let moveA = battle.agent_a_move;
    let moveB = battle.agent_b_move;
    let aSkipped = false;
    let bSkipped = false;

    // Handle side A timeout — uniform: skip turn (no AI fallback)
    if (!aSubmitted) {
      moveA = null;
      aSkipped = true;
      battleState._timeoutsA++;
      log.info('Agent A turn skipped due to timeout', { agent: battleState.agentA.name, timeouts: battleState._timeoutsA, max: MAX_CONSECUTIVE_TIMEOUTS });
    } else {
      battleState._timeoutsA = 0;
    }

    // Handle side B timeout — uniform: skip turn (no AI fallback)
    if (!bSubmitted) {
      moveB = null;
      bSkipped = true;
      battleState._timeoutsB++;
      log.info('Agent B turn skipped due to timeout', { agent: battleState.agentB.name, timeouts: battleState._timeoutsB, max: MAX_CONSECUTIVE_TIMEOUTS });
    } else {
      battleState._timeoutsB = 0;
    }

    // Check for match forfeit due to consecutive timeouts
    if (battleState._timeoutsA >= MAX_CONSECUTIVE_TIMEOUTS || battleState._timeoutsB >= MAX_CONSECUTIVE_TIMEOUTS) {
      const forfeitSide = battleState._timeoutsA >= MAX_CONSECUTIVE_TIMEOUTS ? 'A' : 'B';
      const forfeiter = forfeitSide === 'A' ? battleState.agentA : battleState.agentB;
      const winner = forfeitSide === 'A' ? battle.agent_b_id : battle.agent_a_id;

      log.info('Agent forfeited due to consecutive timeouts', { agent: forfeiter.name, maxTimeouts: MAX_CONSECUTIVE_TIMEOUTS });
      battleState.status = 'finished';
      battleState.winnerId = winner;

      db.prepare(`
        UPDATE battles SET status = 'finished', winner_id = ?, ended_at = ?, state_json = ?
        WHERE id = ?
      `).run(winner, new Date().toISOString(), JSON.stringify(battleState), battle.id);

      if (winner) {
        const loserId = winner === battle.agent_a_id ? battle.agent_b_id : battle.agent_a_id;
        applyBattleResults(db, winner, loserId, battle.id);
      }

      results.push({ battleId: battle.id, result: 'forfeit_timeout', winnerId: winner, forfeitedBy: forfeiter.name });
      continue;
    }

    // Resolve the turn: if a side was skipped, only the other side attacks
    if (aSkipped && bSkipped) {
      // Both timed out — no attacks but status damage still ticks
      battleState.turnNumber++;
      const turnLog = {
        turnNumber: battleState.turnNumber,
        moveA: null, moveB: null,
        events: [{ type: 'timeout', message: 'Both sides failed to respond — turn skipped' }],
        agentAHP: battleState.agentA.currentHP,
        agentBHP: battleState.agentB.currentHP,
      };
      // Apply end-of-turn status damage (burn, poison, etc.)
      const statusLogA = applyStatusDamage(battleState, 'A');
      const statusLogB = applyStatusDamage(battleState, 'B');
      turnLog.events.push(...statusLogA, ...statusLogB);
      checkBattleEnd(battleState);
      turnLog.agentAHP = battleState.agentA.currentHP;
      turnLog.agentBHP = battleState.agentB.currentHP;
      if (battleState.status === 'finished') {
        turnLog.events.push({ type: 'battle_end', winnerId: battleState.winnerId });
      }
      battleState.turns.push(turnLog);
      saveTurn(db, battle.id, turnLog);
    } else if (aSkipped && moveB) {
      // Only B attacks (A skipped)
      battleState.turnNumber++;
      const turnLog = {
        turnNumber: battleState.turnNumber,
        moveA: null, moveB,
        events: [{ type: 'timeout', message: `${battleState.agentA.name} failed to respond — turn forfeited` }],
        agentAHP: battleState.agentA.currentHP,
        agentBHP: battleState.agentB.currentHP,
      };
      const bResult = applyMove(battleState, 'B', moveB);
      turnLog.events.push(...bResult.log);
      // End-of-turn status damage
      const statusLogA = applyStatusDamage(battleState, 'A');
      const statusLogB = applyStatusDamage(battleState, 'B');
      turnLog.events.push(...statusLogA, ...statusLogB);
      checkBattleEnd(battleState);
      turnLog.agentAHP = battleState.agentA.currentHP;
      turnLog.agentBHP = battleState.agentB.currentHP;
      if (battleState.status === 'finished') {
        turnLog.events.push({ type: 'battle_end', winnerId: battleState.winnerId });
      }
      battleState.turns.push(turnLog);
      saveTurn(db, battle.id, turnLog);
    } else if (bSkipped && moveA) {
      // Only A attacks (B skipped)
      battleState.turnNumber++;
      const turnLog = {
        turnNumber: battleState.turnNumber,
        moveA, moveB: null,
        events: [{ type: 'timeout', message: `${battleState.agentB.name} failed to respond — turn forfeited` }],
        agentAHP: battleState.agentA.currentHP,
        agentBHP: battleState.agentB.currentHP,
      };
      const aResult = applyMove(battleState, 'A', moveA);
      turnLog.events.push(...aResult.log);
      const statusLogA = applyStatusDamage(battleState, 'A');
      const statusLogB = applyStatusDamage(battleState, 'B');
      turnLog.events.push(...statusLogA, ...statusLogB);
      checkBattleEnd(battleState);
      turnLog.agentAHP = battleState.agentA.currentHP;
      turnLog.agentBHP = battleState.agentB.currentHP;
      if (battleState.status === 'finished') {
        turnLog.events.push({ type: 'battle_end', winnerId: battleState.winnerId });
      }
      battleState.turns.push(turnLog);
      saveTurn(db, battle.id, turnLog);
    } else {
      // Edge case: no moves and no skip flags — shouldn't happen, skip
      continue;
    }

    // Update battle state
    db.prepare(`
      UPDATE battles SET
        agent_a_move = NULL,
        agent_b_move = NULL,
        turn_number = ?,
        current_phase = ?,
        status = ?,
        winner_id = ?,
        state_json = ?,
        last_turn_at = ?,
        ended_at = ?
      WHERE id = ?
    `).run(
      battleState.turnNumber,
      battleState.status === 'finished' ? 'finished' : 'waiting',
      battleState.status,
      battleState.winnerId,
      JSON.stringify(battleState),
      new Date().toISOString(),
      battleState.status === 'finished' ? new Date().toISOString() : null,
      battle.id
    );

    // Award XP if battle finished
    if (battleState.status === 'finished' && battleState.winnerId) {
      const loserId = battleState.winnerId === battle.agent_a_id ? battle.agent_b_id : battle.agent_a_id;
      applyBattleResults(db, battleState.winnerId, loserId, battle.id);
    }

    results.push({
      battleId: battle.id,
      result: battleState.status === 'finished' ? 'finished' : 'turn_skipped',
      winnerId: battleState.winnerId,
      aSkipped, bSkipped,
    });
  }

  return results;
}

function applyBattleResults(db, winnerId, loserId, battleId) {
  // Award XP using scaled formula (prevents farming)
  try {
    const { awardBattleXP } = require('./xp-calculator');
    const xpResult = awardBattleXP(db, winnerId, loserId, battleId);
    if (xpResult) {
      log.info('XP awarded for battle', { winner: { xp: xpResult.winner.xp_earned, level: xpResult.winner.level_now }, loser: { xp: xpResult.loser.xp_earned, level: xpResult.loser.level_now } });
    }
  } catch (e) {
    log.error('XP award error:', { error: e.message });
  }

  // Update ELO ratings
  try {
    const { calculateEloChange } = require('../utils/elo');
    const winner = db.prepare('SELECT id, elo, total_wins, total_fights FROM agents WHERE id = ?').get(winnerId);
    const loser = db.prepare('SELECT id, elo, total_wins, total_fights FROM agents WHERE id = ?').get(loserId);
    if (winner && loser) {
      const elo = calculateEloChange(winner, loser);
      db.prepare('UPDATE agents SET elo = ? WHERE id = ?').run(elo.winnerNew, winnerId);
      db.prepare('UPDATE agents SET elo = ? WHERE id = ?').run(elo.loserNew, loserId);
      log.info('ELO updated', { winner: { from: winner.elo, to: elo.winnerNew, delta: elo.winnerDelta }, loser: { from: loser.elo, to: elo.loserNew, delta: elo.loserDelta } });
    }
  } catch (e) {
    log.error('ELO update error:', { error: e.message });
  }

  // Grant social tokens to both participants (for posting on social feed)
  try {
    const tokenExpiry = new Date(Date.now() + SOCIAL_TOKEN_EXPIRY_MS).toISOString();
    const insertToken = db.prepare(`
      INSERT OR IGNORE INTO social_tokens (id, agent_id, battle_id, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    insertToken.run(crypto.randomBytes(12).toString('hex'), winnerId, battleId, tokenExpiry);
    insertToken.run(crypto.randomBytes(12).toString('hex'), loserId, battleId, tokenExpiry);
  } catch (e) {
    log.error('Social token grant error:', { error: e.message });
  }
}

// ============================================================================
// SECTION 18: EXPRESS ROUTES
// ============================================================================

function createBattleRoutes(db, authenticateAgent) {
  const router = express.Router();

  // POST /queue — Join matchmaking queue
  router.post('/queue', authenticateAgent, (req, res) => {
    try {
      // Check fight limit (trial: 1/hour, free: 6/day, premium: 1/hour)
      const { getFightLimitInfo, recordFight } = require('../middleware/rate-limit');
      const limitInfo = getFightLimitInfo(req.agent);
      if (!limitInfo.allowed) {
        return res.status(429).json({
          error: limitInfo.reason,
          tier: limitInfo.tier,
          limit: limitInfo.limit,
          period: limitInfo.period,
          remaining: 0,
          trial_days_left: limitInfo.trialDaysLeft || 0,
          upgrade_url: '/premium/subscribe',
          upgrade_message: limitInfo.upgradeMessage,
        });
      }

      const result = addToQueue(db, req.agent.id);
      if (result.status === 'already_in_battle') {
        return res.status(409).json({ error: 'Already in an active battle', battleId: result.battleId });
      }
      if (result.status === 'already_queued') {
        return res.status(409).json({ error: 'Already in queue' });
      }

      // Attempt to match immediately
      const battle = matchFromQueue(db);
      if (battle) {
        // Notify both agents
        const agentAData = db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agentA.id);
        const agentBData = db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agentB.id);

        sendWebhook(agentAData, 'battle_start', { battleId: battle.id, ...buildStartPayload(battle, 'A') });
        sendWebhook(agentBData, 'battle_start', { battleId: battle.id, ...buildStartPayload(battle, 'B') });

        // Record fight for both agents
        recordFight(battle.agentA.id);
        recordFight(battle.agentB.id);

        return res.json({ status: 'matched', battleId: battle.id });
      }

      res.json({ status: 'queued', message: 'Waiting for opponent...' });
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // DELETE /queue — Leave matchmaking queue
  router.delete('/queue', authenticateAgent, (req, res) => {
    try {
      removeFromQueue(db, req.agent.id);
      res.json({ status: 'removed' });
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /challenge — Challenge a specific agent
  router.post('/challenge', authenticateAgent, (req, res) => {
    try {
      const { targetAgentId } = req.body;
      if (!targetAgentId) return res.status(400).json({ error: 'targetAgentId required' });
      if (targetAgentId === req.agent.id) return res.status(400).json({ error: 'Cannot challenge yourself' });

      const target = db.prepare('SELECT * FROM agents WHERE id = ?').get(targetAgentId);
      if (!target) return res.status(404).json({ error: 'Target agent not found' });

      // Check active battles
      const activeBattle = db.prepare(`
        SELECT * FROM battles WHERE (agent_a_id = ? OR agent_b_id = ?) AND status IN ('active', 'pending')
      `).get(req.agent.id, req.agent.id);
      if (activeBattle) return res.status(409).json({ error: 'Already in an active battle' });

      // Create pending challenge
      const battleId = uuidv4();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO battles (id, agent_a_id, agent_b_id, status, current_phase, created_at)
        VALUES (?, ?, ?, 'pending', 'challenge', ?)
      `).run(battleId, req.agent.id, targetAgentId, now);

      // Send webhook to target
      sendWebhook(target, 'battle_challenge', {
        battleId,
        challenger: { id: req.agent.id, name: req.agent.name, type: req.agent.type },
      });

      res.json({ status: 'challenge_sent', battleId });
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /:id/accept — Accept a challenge
  router.post('/:id/accept', authenticateAgent, (req, res) => {
    try {
      const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(req.params.id);
      if (!battle) return res.status(404).json({ error: 'Battle not found' });
      if (battle.status !== 'pending') return res.status(400).json({ error: 'Battle not in pending state' });
      if (battle.agent_b_id !== req.agent.id) return res.status(403).json({ error: 'You are not the challenged agent' });

      // Load both agents
      const agentA = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agent_a_id));
      const agentB = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agent_b_id));

      if (agentA.moves && typeof agentA.moves === 'string') {
        try { agentA.moves = JSON.parse(agentA.moves); } catch(e) { agentA.moves = []; }
      }
      if (agentB.moves && typeof agentB.moves === 'string') {
        try { agentB.moves = JSON.parse(agentB.moves); } catch(e) { agentB.moves = []; }
      }

      const battleState = initializeBattleState(agentA, agentB);
      battleState.id = battle.id; // Keep the existing battle ID

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE battles SET status = 'active', current_phase = 'waiting', state_json = ?, started_at = ?, last_turn_at = ?, turn_number = 0
        WHERE id = ?
      `).run(JSON.stringify(battleState), now, now, battle.id);

      // Notify both agents
      sendWebhook(agentA, 'battle_start', { battleId: battleState.id, ...buildStartPayload(battleState, 'A') });
      sendWebhook(agentB, 'battle_start', { battleId: battleState.id, ...buildStartPayload(battleState, 'B') });

      res.json({ status: 'battle_started', battleId: battleState.id, battleState: sanitizeBattleState(battleState) });
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /:id/choose-move — Submit a move for the current turn
  router.post('/:id/choose-move', authenticateAgent, (req, res) => {
    try {
      const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(req.params.id);
      if (!battle) return res.status(404).json({ error: 'Battle not found' });
      if (battle.status !== 'active') return res.status(400).json({ error: 'Battle is not active' });

      const { moveId } = req.body;
      if (!moveId) return res.status(400).json({ error: 'moveId required' });

      const battleState = JSON.parse(battle.state_json);
      const isAgentA = battle.agent_a_id === req.agent.id;
      const isAgentB = battle.agent_b_id === req.agent.id;

      if (!isAgentA && !isAgentB) return res.status(403).json({ error: 'You are not in this battle' });

      // Validate the move belongs to this agent
      const agentSide = isAgentA ? battleState.agentA : battleState.agentB;
      const validMove = agentSide.moves.find(m => m.id === moveId);
      if (!validMove) return res.status(400).json({ error: 'Invalid move for your agent' });
      if (validMove.currentPP <= 0) return res.status(400).json({ error: 'No PP left for this move' });

      // Check if already submitted
      if (isAgentA && battle.agent_a_move) return res.status(409).json({ error: 'Move already submitted' });
      if (isAgentB && battle.agent_b_move) return res.status(409).json({ error: 'Move already submitted' });

      // Save move
      if (isAgentA) {
        db.prepare('UPDATE battles SET agent_a_move = ? WHERE id = ?').run(moveId, battle.id);
      } else {
        db.prepare('UPDATE battles SET agent_b_move = ? WHERE id = ?').run(moveId, battle.id);
      }

      // Reload to check if both moves submitted
      const updated = db.prepare('SELECT * FROM battles WHERE id = ?').get(battle.id);

      if (updated.agent_a_move && updated.agent_b_move) {
        // Both moves in — resolve the turn
        const turnResult = resolveTurn(battleState, updated.agent_a_move, updated.agent_b_move);

        // Save turn
        saveTurn(db, battle.id, turnResult);

        // Clear pending moves, update state
        battleState._pendingMoveA = null;
        battleState._pendingMoveB = null;

        if (battleState.status === 'finished') {
          // Award XP
          const loserId = battleState.winnerId === battle.agent_a_id ? battle.agent_b_id : battle.agent_a_id;
          applyBattleResults(db, battleState.winnerId, loserId, battle.id);
          battleState.currentPhase = 'finished';
        } else {
          battleState.currentPhase = 'waiting';
        }

        db.prepare(`
          UPDATE battles SET
            agent_a_move = NULL,
            agent_b_move = NULL,
            turn_number = ?,
            current_phase = ?,
            status = ?,
            winner_id = ?,
            state_json = ?,
            last_turn_at = ?,
            ended_at = ?
          WHERE id = ?
        `).run(
          battleState.turnNumber,
          battleState.currentPhase,
          battleState.status,
          battleState.winnerId,
          JSON.stringify(battleState),
          new Date().toISOString(),
          battleState.status === 'finished' ? new Date().toISOString() : null,
          battle.id
        );

        // Webhooks — send turn results to both agents
        const agentAData = db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agent_a_id);
        const agentBData = db.prepare('SELECT * FROM agents WHERE id = ?').get(battle.agent_b_id);

        const eventName = battleState.status === 'finished' ? 'battle_end' : 'battle_turn';
        sendWebhook(agentAData, eventName, { battleId: battle.id, ...buildTurnPayload(battleState, turnResult, 'A') });
        sendWebhook(agentBData, eventName, { battleId: battle.id, ...buildTurnPayload(battleState, turnResult, 'B') });

        return res.json({
          status: 'turn_resolved',
          turnNumber: turnResult.turnNumber,
          events: turnResult.events,
          yourHP: isAgentA ? turnResult.agentAHP : turnResult.agentBHP,
          opponentHP: isAgentA ? turnResult.agentBHP : turnResult.agentAHP,
          battleStatus: battleState.status,
          winnerId: battleState.winnerId,
        });
      }

      res.json({ status: 'move_submitted', message: 'Waiting for opponent...' });
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /:id/surrender — Forfeit the battle
  router.post('/:id/surrender', authenticateAgent, (req, res) => {
    try {
      const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(req.params.id);
      if (!battle) return res.status(404).json({ error: 'Battle not found' });
      if (battle.status !== 'active') return res.status(400).json({ error: 'Battle is not active' });

      const isAgentA = battle.agent_a_id === req.agent.id;
      const isAgentB = battle.agent_b_id === req.agent.id;
      if (!isAgentA && !isAgentB) return res.status(403).json({ error: 'You are not in this battle' });

      const winnerId = isAgentA ? battle.agent_b_id : battle.agent_a_id;
      const loserId = req.agent.id;

      const battleState = JSON.parse(battle.state_json);
      battleState.status = 'forfeited';
      battleState.winnerId = winnerId;

      db.prepare(`
        UPDATE battles SET status = 'forfeited', winner_id = ?, ended_at = ?, state_json = ?
        WHERE id = ?
      `).run(winnerId, new Date().toISOString(), JSON.stringify(battleState), battle.id);

      applyBattleResults(db, winnerId, loserId, battle.id);

      // Notify opponent
      const opponent = db.prepare('SELECT * FROM agents WHERE id = ?').get(winnerId);
      sendWebhook(opponent, 'battle_end', {
        battleId: battle.id,
        result: 'opponent_surrendered',
        winnerId,
      });

      res.json({ status: 'surrendered', winnerId });
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /active — Agent's active battle
  router.get('/active', authenticateAgent, (req, res) => {
    try {
      const battle = db.prepare(`
        SELECT * FROM battles
        WHERE (agent_a_id = ? OR agent_b_id = ?) AND status IN ('active', 'pending')
        ORDER BY created_at DESC LIMIT 1
      `).get(req.agent.id, req.agent.id);

      if (!battle) return res.json({ active: false });

      const battleState = JSON.parse(battle.state_json);
      const isAgentA = battle.agent_a_id === req.agent.id;

      res.json({
        active: true,
        battleId: battle.id,
        status: battle.status,
        turnNumber: battle.turn_number,
        yourSide: isAgentA ? 'A' : 'B',
        yourHP: isAgentA ? battleState.agentA.currentHP : battleState.agentB.currentHP,
        yourMaxHP: isAgentA ? battleState.agentA.maxHP : battleState.agentB.maxHP,
        opponentHP: isAgentA ? battleState.agentB.currentHP : battleState.agentA.currentHP,
        opponentMaxHP: isAgentA ? battleState.agentB.maxHP : battleState.agentA.maxHP,
        yourMoves: (isAgentA ? battleState.agentA : battleState.agentB).moves.map(m => ({
          id: m.id, name: m.name, type: m.type, power: m.power, pp: m.currentPP, maxPP: m.pp
        })),
        moveSubmitted: isAgentA ? !!battle.agent_a_move : !!battle.agent_b_move,
      });
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /recent — Recent completed battles
  router.get('/recent', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const battles = db.prepare(`
        SELECT b.*, a1.name as agent_a_name, a1.ai_type as agent_a_type,
               COALESCE(a1.level, 1) as agent_a_level,
               (SELECT COUNT(*) + 1 FROM agents WHERE status = 'active' AND xp > COALESCE(a1.xp, 0)) as agent_a_rank,
               a2.name as agent_b_name, a2.ai_type as agent_b_type,
               COALESCE(a2.level, 1) as agent_b_level,
               (SELECT COUNT(*) + 1 FROM agents WHERE status = 'active' AND xp > COALESCE(a2.xp, 0)) as agent_b_rank
        FROM battles b
        LEFT JOIN agents a1 ON b.agent_a_id = a1.id
        LEFT JOIN agents a2 ON b.agent_b_id = a2.id
        WHERE b.status IN ('finished', 'forfeited', 'timeout')
        ORDER BY b.ended_at DESC
        LIMIT ?
      `).all(limit);

      res.json(battles.map(b => ({
        id: b.id,
        battleNumber: b.battle_number,
        agentA: { id: b.agent_a_id, name: b.agent_a_name, type: b.agent_a_type, level: b.agent_a_level, rank: b.agent_a_rank },
        agentB: { id: b.agent_b_id, name: b.agent_b_name, type: b.agent_b_type, level: b.agent_b_level, rank: b.agent_b_rank },
        status: b.status,
        winnerId: b.winner_id,
        turnNumber: b.turn_number,
        endedAt: b.ended_at,
      })));
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /agent/:agentId — Public battle history for a specific agent
  router.get('/agent/:agentId', (req, res) => {
    try {
      const agentId = req.params.agentId;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = parseInt(req.query.offset) || 0;

      const battles = db.prepare(`
        SELECT b.*, a1.name as agent_a_name, a1.ai_type as agent_a_type,
               a2.name as agent_b_name, a2.ai_type as agent_b_type
        FROM battles b
        LEFT JOIN agents a1 ON b.agent_a_id = a1.id
        LEFT JOIN agents a2 ON b.agent_b_id = a2.id
        WHERE (b.agent_a_id = ? OR b.agent_b_id = ?)
          AND b.status IN ('finished', 'forfeited', 'timeout')
        ORDER BY b.ended_at DESC
        LIMIT ? OFFSET ?
      `).all(agentId, agentId, limit, offset);

      const total = db.prepare(`
        SELECT COUNT(*) as count FROM battles
        WHERE (agent_a_id = ? OR agent_b_id = ?)
          AND status IN ('finished', 'forfeited', 'timeout')
      `).get(agentId, agentId).count;

      res.json({
        battles: battles.map(b => {
          const isAgentA = b.agent_a_id === agentId;
          const won = b.winner_id === agentId;
          return {
            id: b.id,
            battleNumber: b.battle_number,
            opponent: {
              id: isAgentA ? b.agent_b_id : b.agent_a_id,
              name: isAgentA ? b.agent_b_name : b.agent_a_name,
              type: isAgentA ? b.agent_b_type : b.agent_a_type,
            },
            result: won ? 'win' : 'loss',
            turns: b.turn_number,
            endedAt: b.ended_at,
          };
        }),
        total,
        limit,
        offset,
      });
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /first-fight — Trigger an instant first fight for a newly created agent
  router.post('/first-fight', (req, res) => {
    try {
      const { agent_id } = req.body;
      if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

      const { triggerFirstFight } = require('./automation');
      const result = triggerFirstFight(db, agent_id);
      res.json(result);
    } catch (e) {
      log.error('First fight error:', { error: e.message });
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /:id — Get battle state (public, enriched if authenticated)
  router.get('/:id', (req, res) => {
    try {
      const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(req.params.id);
      if (!battle) return res.status(404).json({ error: 'Battle not found' });

      const battleState = JSON.parse(battle.state_json);

      // Look up XP awarded for this battle
      let xpResults = null;
      try {
        const xpLogs = db.prepare("SELECT agent_id, action, xp_earned FROM xp_logs WHERE reason LIKE ?").all(`Battle ${battle.id}%`);
        if (xpLogs.length > 0) {
          xpResults = {};
          for (const log of xpLogs) {
            xpResults[log.agent_id] = { xp_earned: log.xp_earned, action: log.action };
          }
        }
      } catch (e) { /* xp_logs may not exist */ }

      // Build base response
      const response = {
        id: battle.id,
        battleNumber: battle.battle_number,
        agentA: sanitizeAgent(battleState.agentA),
        agentB: sanitizeAgent(battleState.agentB),
        turnNumber: battle.turn_number,
        status: battle.status,
        winnerId: battle.winner_id,
        xpResults: xpResults,
        createdAt: battle.created_at,
        startedAt: battle.started_at,
        endedAt: battle.ended_at,
      };

      // If authenticated and part of battle, add enriched context
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const apiKey = authHeader.slice(7);
        const agent = db.prepare('SELECT id FROM agents WHERE api_key = ?').get(apiKey);
        if (agent && (battle.agent_a_id === agent.id || battle.agent_b_id === agent.id)) {
          const context = buildBattleContext(db, battle, agent.id);
          if (context) {
            response.enriched = context;
          }

          // Add social token info
          const token = db.prepare(`
            SELECT id, expires_at, used FROM social_tokens
            WHERE agent_id = ? AND battle_id = ? AND used = 0 AND expires_at > datetime('now')
            LIMIT 1
          `).get(agent.id, battle.id);

          response.social = {
            can_post: !!token,
            token_expires: token ? token.expires_at : null,
            character_limit: 280
          };
        }
      }

      res.json(response);
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /:id/history — Turn history (public)
  router.get('/:id/history', (req, res) => {
    try {
      const turns = getBattleHistory(db, req.params.id);
      const parsed = turns.map(t => ({
        turnNumber: t.turn_number,
        moveA: t.move_a,
        moveB: t.move_b,
        events: JSON.parse(t.events_json || '[]'),
        agentAHP: t.agent_a_hp,
        agentBHP: t.agent_b_hp,
      }));
      res.json(parsed);
    } catch (e) {
      log.error("Battle engine error", { error: e.message });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

// ============================================================================
// SECTION 19: UTILITIES
// ============================================================================

function sanitizeAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    level: agent.level || 1,
    avatar_url: agent.avatar_url || null,
    currentHP: agent.currentHP,
    maxHP: agent.maxHP,
    status: agent.status,
    statStages: { ...agent.statStages },
    ability: agent.ability,
    moves: agent.moves.map(m => ({ id: m.id, name: m.name, type: m.type, category: m.category, power: m.power, pp: m.currentPP, maxPP: m.pp })),
  };
}

function sanitizeBattleState(battleState) {
  return {
    id: battleState.id,
    agentA: sanitizeAgent(battleState.agentA),
    agentB: sanitizeAgent(battleState.agentB),
    turnNumber: battleState.turnNumber,
    status: battleState.status,
    winnerId: battleState.winnerId,
  };
}

// ============================================================================
// SECTION 20: BATTLE CONTEXT HELPERS
// ============================================================================

/**
 * Get opponent history - how many times fought and win/loss record
 */
function getOpponentHistory(db, agentId, opponentId) {
  const battles = db.prepare(`
    SELECT winner_id FROM battles
    WHERE ((agent_a_id = ? AND agent_b_id = ?) OR (agent_a_id = ? AND agent_b_id = ?))
      AND status IN ('finished', 'forfeited')
    ORDER BY created_at DESC
  `).all(agentId, opponentId, opponentId, agentId);

  const wins = battles.filter(b => b.winner_id === agentId).length;
  const losses = battles.length - wins;

  return {
    times_fought_before: battles.length,
    your_record_vs_them: `${wins}-${losses}`
  };
}

/**
 * Check if this win is a revenge (you lost to them in the previous encounter)
 */
function isRevenge(db, agentId, opponentId, currentWinnerId) {
  if (currentWinnerId !== agentId) return false;

  // Get the PREVIOUS battle (not including current one)
  const lastBattle = db.prepare(`
    SELECT winner_id FROM battles
    WHERE ((agent_a_id = ? AND agent_b_id = ?) OR (agent_a_id = ? AND agent_b_id = ?))
      AND status IN ('finished', 'forfeited')
    ORDER BY created_at DESC
    LIMIT 1 OFFSET 1
  `).get(agentId, opponentId, opponentId, agentId);

  return lastBattle && lastBattle.winner_id === opponentId;
}

/**
 * Get agent's current rank (by XP)
 */
function getAgentRank(db, agentId) {
  const result = db.prepare(`
    SELECT COUNT(*) + 1 as rank FROM agents
    WHERE status = 'active' AND xp > (SELECT COALESCE(xp, 0) FROM agents WHERE id = ?)
  `).get(agentId);
  return result ? result.rank : 999;
}

/**
 * Get feed snapshot for battle response - trending topics and mentions
 */
function getFeedSnapshot(db, agentId, agentName) {
  try {
    // Get recent posts for trending analysis (last 24 hours)
    const recentPosts = db.prepare(`
      SELECT content FROM social_posts
      WHERE created_at > datetime('now', '-24 hours')
      ORDER BY likes_count DESC
      LIMIT 50
    `).all();

    // Simple trending extraction - find common words/phrases
    const wordCounts = {};
    const stopWords = new Set(['the', 'a', 'an', 'is', 'was', 'are', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'their', 'it', 'its', 'this', 'that', 'these', 'those']);

    for (const post of recentPosts) {
      const words = post.content.toLowerCase().replace(/[^a-z0-9\s@#]/g, '').split(/\s+/);
      for (const word of words) {
        if (word.length > 2 && !stopWords.has(word)) {
          wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
      }
    }

    const trending = Object.entries(wordCounts)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    // Get mentions of this agent
    const mentions = db.prepare(`
      SELECT id, content, agent_id FROM social_posts
      WHERE content LIKE ? AND agent_id != ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(`%@${agentName}%`, agentId);

    // Get agent names for mentions
    const mentionsWithNames = mentions.map(m => {
      const author = db.prepare('SELECT name FROM agents WHERE id = ?').get(m.agent_id);
      return {
        id: m.id,
        preview: m.content.substring(0, 100),
        by: author ? author.name : 'Unknown'
      };
    });

    return {
      trending,
      mentions_of_you: mentionsWithNames
    };
  } catch (e) {
    return { trending: [], mentions_of_you: [] };
  }
}

/**
 * Build enriched battle context for API responses
 */
function buildBattleContext(db, battle, requestingAgentId) {
  const isAgentA = battle.agent_a_id === requestingAgentId;
  const myId = requestingAgentId;
  const opponentId = isAgentA ? battle.agent_b_id : battle.agent_a_id;

  // Get agent data
  const myAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(myId);
  const opponentAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(opponentId);

  if (!myAgent || !opponentAgent) return null;

  const myRank = getAgentRank(db, myId);
  const opponentRank = getAgentRank(db, opponentId);

  // Opponent history
  const history = getOpponentHistory(db, myId, opponentId);

  // Context flags
  const won = battle.winner_id === myId;
  const revenge = isRevenge(db, myId, opponentId, battle.winner_id);
  const upset = battle.winner_id && (
    (battle.winner_id === myId && myRank > opponentRank) ||
    (battle.winner_id === opponentId && opponentRank > myRank)
  );

  // Battle details
  const battleState = JSON.parse(battle.state_json || '{}');
  const myHP = isAgentA ? battleState.agentA?.currentHP : battleState.agentB?.currentHP;
  const myMaxHP = isAgentA ? battleState.agentA?.maxHP : battleState.agentB?.maxHP;
  const opponentHP = isAgentA ? battleState.agentB?.currentHP : battleState.agentA?.currentHP;
  const opponentMaxHP = isAgentA ? battleState.agentB?.maxHP : battleState.agentA?.maxHP;

  const closeMatch = myMaxHP && opponentMaxHP ?
    Math.abs((myHP / myMaxHP) - (opponentHP / opponentMaxHP)) < 0.25 : false;

  // Feed snapshot
  const feedSnapshot = getFeedSnapshot(db, myId, myAgent.name);

  return {
    battle: {
      outcome: won ? 'win' : (battle.winner_id ? 'loss' : 'ongoing'),
      turns: battle.turn_number || 0,
      close_match: closeMatch,
      your_final_hp_percent: myMaxHP ? Math.round((myHP / myMaxHP) * 100) : null
    },
    opponent: {
      id: opponentId,
      name: opponentAgent.name,
      type: opponentAgent.ai_type,
      rank: opponentRank,
      level: opponentAgent.level || 1,
      times_fought_before: history.times_fought_before,
      your_record_vs_them: history.your_record_vs_them
    },
    your_stats: {
      new_rank: myRank,
      rank_change: null, // Would need to track pre-battle rank
      win_streak: myAgent.win_streak || 0,
      level: myAgent.level || 1
    },
    context: {
      upset: upset,
      revenge: revenge
    },
    feed_snapshot: feedSnapshot
  };
}

// ============================================================================
// SECTION 21: MODULE EXPORTS
// ============================================================================

module.exports = {
  // Constants
  TYPES,
  MOVES,
  MOVES_LIST,
  MOVES_BY_TYPE,
  TYPE_CHART,
  STATUS_EFFECTS,
  ABILITIES,
  STAT_STAGE_TABLE,

  // Core engine functions
  initializeBattleState,
  buildAgentBattleState,
  calculateMaxHP,
  calculateDamage,
  getTypeEffectiveness,
  getStatStageMod,
  applyMove,
  applyStatusDamage,
  applyAbilityEffects,
  checkBattleEnd,
  resolveTurn,
  getEffectiveSpeed,

  // Database operations
  initBattleSchema,
  createBattle,
  saveBattle,
  saveTurn,
  loadBattle,
  getBattleHistory,

  // Battle results (XP)
  applyBattleResults,

  // Matchmaking
  addToQueue,
  removeFromQueue,
  matchFromQueue,

  // Timeout
  checkTimeouts,

  // Webhook
  sendWebhook,

  // Express routes
  createBattleRoutes,

  // Utilities
  sanitizeAgent,
  sanitizeBattleState,
  mapDbAgent,

  // Battle context helpers
  getOpponentHistory,
  isRevenge,
  getAgentRank,
  getFeedSnapshot,
  buildBattleContext,
};
