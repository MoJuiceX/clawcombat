/**
 * Battle Engine Effects
 * Ability effects and status damage application
 */

'use strict';

const { statName } = require('./constants');

// ============================================================================
// ABILITY EFFECTS
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
// END-OF-TURN STATUS DAMAGE
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

module.exports = {
  applyAbilityEffects,
  applyStatusDamage,
};
