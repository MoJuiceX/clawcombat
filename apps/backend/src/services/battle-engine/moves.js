/**
 * Battle Engine Moves
 * Move application logic
 */

'use strict';

const { STATUS_EFFECTS, statName } = require('./constants');
const { calculateDamage } = require('./core');

// ============================================================================
// MOVE APPLICATION
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

module.exports = {
  applyMove,
};
