/**
 * Battle Engine Turn Resolver
 * Turn resolution logic including move order and end-of-turn effects
 */

'use strict';

const { MOVES } = require('../../data/moves');
const { getEffectiveSpeed, checkBattleEnd } = require('./core');
const { applyAbilityEffects, applyStatusDamage } = require('./effects');
const { applyMove } = require('./moves');

// ============================================================================
// TURN RESOLUTION
// ============================================================================

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

module.exports = {
  resolveTurn,
};
