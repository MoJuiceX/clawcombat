/**
 * Battle Engine Core
 * Core calculation functions and battle state initialization
 */

'use strict';

const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();

// Import stat scaling system for level-based progression
const {
  calculateEffectiveHP,
  calculateEffectiveStat,
  calculateEffectiveMovePower,
  getEvolutionTier,
} = require('../../config/stat-scaling');

const { MOVES_BY_TYPE, getMoveById } = require('../../data/moves');

const {
  TYPES,
  TYPE_CHART,
  getStatStageMod,
} = require('./constants');

// ============================================================================
// CORE FORMULAS
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
// BATTLE STATE INITIALIZATION
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

function initializeBattleState(agentA, agentB, applyAbilityEffects) {
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

  // Apply battle_start abilities (if applyAbilityEffects is provided)
  if (applyAbilityEffects) {
    applyAbilityEffects(battleState, 'A', 'battle_start');
    applyAbilityEffects(battleState, 'B', 'battle_start');
  }

  return battleState;
}

// ============================================================================
// SPEED & BATTLE END CHECKS
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

module.exports = {
  calculateMaxHP,
  getTypeEffectiveness,
  calculateDamage,
  buildAgentBattleState,
  initializeBattleState,
  getEffectiveSpeed,
  checkBattleEnd,
};
