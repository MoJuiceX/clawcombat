'use strict';

/**
 * ClawCombat XP Calculator v2
 *
 * Complete XP system with:
 * - Bracket-based XP requirements (not formula-based)
 * - Level-scaled XP earning (higher levels earn more)
 * - Opponent level difference modifiers (±30% based on level gap)
 * - Win streak bonuses (3/6/12/15%)
 * - Daily first win bonus (+50%)
 *
 * Target timeline:
 * - Premium hardcore (24/day): ~7.5 months to level 100
 * - Free active (6/day): ~2.5 years to level 100
 */

const log = require('../utils/logger').createLogger('XP_CALCULATOR');

const { getTier, buildSkinPrompt, hashAgentStats } = require('./skin-generator');
const {
  getXPToLevelUp,
  getBaseXPForLevel,
  getOpponentLevelModifier,
  getWinStreakBonus,
  calculateRestedStatus,
  applyRestedBonus,
  DAILY_FIRST_WIN_BONUS,
  MAX_LEVEL,
  GIANT_SLAYER_LEVEL_DIFF,
  RESTED_XP_CONFIG,
  PREMIUM_XP_MULTIPLIER
} = require('../config/battle-xp-config');
const { RESPEC_MILESTONES } = require('../config/stat-scaling');

// =============================================================================
// XP CALCULATION
// =============================================================================

/**
 * Calculate XP earned from a battle with all modifiers applied
 *
 * @param {object} params
 * @param {number} params.playerLevel - Player's level
 * @param {number} params.opponentLevel - Opponent's level
 * @param {boolean} params.won - Whether player won
 * @param {number} params.winStreak - Player's current win streak (before this battle)
 * @param {boolean} params.isFirstWinToday - Whether this is player's first win today
 * @param {number} params.restedBattles - Available rested battles (for 2x XP bonus)
 * @param {boolean} params.isPremium - Whether player has premium subscription
 * @returns {{ xp: number, breakdown: object, restedUsed: boolean }}
 */
function calculateBattleXP({ playerLevel, opponentLevel, won, winStreak = 0, isFirstWinToday = false, restedBattles = 0, isPremium = false }) {
  // 1. Get base XP for player's level bracket
  const baseXP = getBaseXPForLevel(playerLevel, won);

  // Initialize breakdown
  const breakdown = {
    baseXP,
    levelBracket: getLevelBracketName(playerLevel),
    modifiers: []
  };

  let totalXP = baseXP;

  // Only apply bonuses to wins
  if (won) {
    // 2. Apply opponent level difference modifier
    const { modifier: levelMod, isGiantSlayer } = getOpponentLevelModifier(playerLevel, opponentLevel);
    if (levelMod !== 0) {
      const levelBonus = Math.round(baseXP * levelMod);
      totalXP += levelBonus;
      breakdown.modifiers.push({
        type: 'opponent_level',
        modifier: levelMod,
        xpChange: levelBonus,
        description: levelMod > 0
          ? `Beat opponent ${opponentLevel - playerLevel} levels higher (+${Math.round(levelMod * 100)}%)`
          : `Beat opponent ${playerLevel - opponentLevel} levels lower (${Math.round(levelMod * 100)}%)`
      });
    }
    breakdown.isGiantSlayer = isGiantSlayer;

    // 3. Apply win streak bonus
    const streakBonus = getWinStreakBonus(winStreak);
    if (streakBonus > 0) {
      const streakXP = Math.round(baseXP * streakBonus);
      totalXP += streakXP;
      breakdown.modifiers.push({
        type: 'win_streak',
        streak: winStreak + 1,
        modifier: streakBonus,
        xpChange: streakXP,
        description: `${winStreak + 1}-win streak (+${Math.round(streakBonus * 100)}%)`
      });
    }

    // 4. Apply daily first win bonus
    if (isFirstWinToday) {
      const firstWinXP = Math.round(baseXP * DAILY_FIRST_WIN_BONUS);
      totalXP += firstWinXP;
      breakdown.modifiers.push({
        type: 'daily_first_win',
        modifier: DAILY_FIRST_WIN_BONUS,
        xpChange: firstWinXP,
        description: `First win of the day (+${Math.round(DAILY_FIRST_WIN_BONUS * 100)}%)`
      });
    }

    // 5. Apply rested XP bonus (2x multiplier for casual player catch-up)
    if (restedBattles > 0) {
      const restedBonus = totalXP; // Double the total XP earned
      totalXP += restedBonus;
      breakdown.modifiers.push({
        type: 'rested_xp',
        modifier: 1.0, // 100% bonus = 2x total
        xpChange: restedBonus,
        description: `Rested XP bonus (2x) - ${restedBattles - 1} battles remaining`
      });
      breakdown.restedUsed = true;
    }

    // 6. Apply premium XP bonus (+50% for premium subscribers)
    if (isPremium) {
      const premiumBonus = Math.round(baseXP * (PREMIUM_XP_MULTIPLIER - 1));
      totalXP += premiumBonus;
      breakdown.modifiers.push({
        type: 'premium',
        modifier: PREMIUM_XP_MULTIPLIER - 1,
        xpChange: premiumBonus,
        description: `Premium bonus (+${Math.round((PREMIUM_XP_MULTIPLIER - 1) * 100)}%)`
      });
      breakdown.isPremium = true;
    }
  }

  breakdown.totalXP = Math.round(totalXP);
  breakdown.restedUsed = breakdown.restedUsed || false;

  return {
    xp: Math.round(totalXP),
    breakdown,
    restedUsed: breakdown.restedUsed
  };
}

/**
 * Get human-readable level bracket name
 */
function getLevelBracketName(level) {
  if (level <= 10) return 'Rookie (1-10)';
  if (level <= 25) return 'Apprentice (11-25)';
  if (level <= 50) return 'Veteran (26-50)';
  if (level <= 75) return 'Elite (51-75)';
  return 'Champion (76-100)';
}

// =============================================================================
// LEVEL PROGRESSION
// =============================================================================

/**
 * XP required to reach the next level
 * @param {number} currentLevel
 * @returns {number} XP needed (0 if max level)
 */
function xpToNextLevel(currentLevel) {
  return getXPToLevelUp(currentLevel);
}

/**
 * Apply XP to an agent, handling level-ups.
 * Returns update info but does NOT write to DB — caller is responsible.
 *
 * @param {object} agent - Agent row from DB (needs: xp, level)
 * @param {number} xpEarned - XP to add
 * @returns {{ newXP: number, newLevel: number, levelsGained: number, xpToNext: number }}
 */
function applyXP(agent, xpEarned) {
  let currentXP = (agent.xp || 0) + xpEarned;
  let currentLevel = agent.level || 1;
  let levelsGained = 0;

  while (currentLevel < MAX_LEVEL) {
    const needed = xpToNextLevel(currentLevel);
    if (needed === 0 || currentXP < needed) break;
    currentXP -= needed;
    currentLevel++;
    levelsGained++;
  }

  if (currentLevel >= MAX_LEVEL) {
    currentLevel = MAX_LEVEL;
    // Keep XP as-is at max level (display purposes)
  }

  return {
    newXP: currentXP,
    newLevel: currentLevel,
    levelsGained,
    xpToNext: xpToNextLevel(currentLevel)
  };
}

// =============================================================================
// BATTLE XP AWARD (Main entry point)
// =============================================================================

/**
 * Full battle XP flow: calculate, apply, and update DB for both winner and loser.
 *
 * @param {object} db - better-sqlite3 database
 * @param {string} winnerId - Agent ID
 * @param {string} loserId - Agent ID
 * @param {string} battleId - Battle ID (for xp_logs)
 * @returns {{ winner: object, loser: object }}
 */
function awardBattleXP(db, winnerId, loserId, battleId) {
  const winner = db.prepare(`
    SELECT id, xp, level, win_streak, daily_first_win_date, rested_battles, last_fight_at
    FROM agents WHERE id = ?
  `).get(winnerId);

  const loser = db.prepare(`
    SELECT id, xp, level, win_streak, rested_battles, last_fight_at
    FROM agents WHERE id = ?
  `).get(loserId);

  if (!winner || !loser) return null;

  const today = new Date().toISOString().split('T')[0];
  const isFirstWinToday = winner.daily_first_win_date !== today;

  // Calculate rested status for both players
  const winnerRestedStatus = calculateRestedStatus(winner.last_fight_at, winner.rested_battles || 0);
  const loserRestedStatus = calculateRestedStatus(loser.last_fight_at, loser.rested_battles || 0);

  // Calculate XP for winner (with rested bonus if available)
  const winnerCalc = calculateBattleXP({
    playerLevel: winner.level || 1,
    opponentLevel: loser.level || 1,
    won: true,
    winStreak: winner.win_streak || 0,
    isFirstWinToday,
    restedBattles: winnerRestedStatus.restedBattlesAvailable
  });

  // Calculate XP for loser (rested bonus applies to losses too for casual retention)
  const loserCalc = calculateBattleXP({
    playerLevel: loser.level || 1,
    opponentLevel: winner.level || 1,
    won: false,
    winStreak: 0,
    isFirstWinToday: false,
    restedBattles: loserRestedStatus.restedBattlesAvailable
  });

  // Apply XP and check for level-ups
  const winnerResult = applyXP(winner, winnerCalc.xp);
  const loserResult = applyXP(loser, loserCalc.xp);

  // Update winner: XP, level, win streak, daily first win date, rested battles
  const newWinStreak = (winner.win_streak || 0) + 1;
  const winnerNewRestedBattles = winnerCalc.restedUsed
    ? Math.max(0, winnerRestedStatus.restedBattlesAvailable - 1)
    : winnerRestedStatus.restedBattlesAvailable;
  db.prepare(`
    UPDATE agents
    SET xp = ?, level = ?, win_streak = ?, daily_first_win_date = ?, rested_battles = ?
    WHERE id = ?
  `).run(winnerResult.newXP, winnerResult.newLevel, newWinStreak, today, winnerNewRestedBattles, winnerId);

  // Update loser: XP, level, reset win streak, rested battles
  const loserNewRestedBattles = loserCalc.restedUsed
    ? Math.max(0, loserRestedStatus.restedBattlesAvailable - 1)
    : loserRestedStatus.restedBattlesAvailable;
  db.prepare(`
    UPDATE agents
    SET xp = ?, level = ?, win_streak = 0, rested_battles = ?
    WHERE id = ?
  `).run(loserResult.newXP, loserResult.newLevel, loserNewRestedBattles, loserId);

  // Grant level-up rewards (stat tokens + move respecs) and check tier evolution
  let winnerRewards = { tokensAwarded: 0, respecsAwarded: 0, milestones: [] };
  let loserRewards = { tokensAwarded: 0, respecsAwarded: 0, milestones: [] };

  if (winnerResult.levelsGained > 0) {
    winnerRewards = grantLevelUpRewards(db, winnerId, winner.level || 1, winnerResult.newLevel);
    triggerTierEvolution(db, winnerId, winner.level || 1, winnerResult.newLevel);
  }
  if (loserResult.levelsGained > 0) {
    loserRewards = grantLevelUpRewards(db, loserId, loser.level || 1, loserResult.newLevel);
    triggerTierEvolution(db, loserId, loser.level || 1, loserResult.newLevel);
  }

  // Log XP awards
  const crypto = require('crypto');
  const winReason = buildXPReason(winnerCalc.breakdown, battleId, winner.level || 1, loser.level || 1);
  const lossReason = `Battle ${battleId} (lv${loser.level || 1} vs lv${winner.level || 1})`;

  db.prepare('INSERT INTO xp_logs (id, agent_id, action, xp_earned, reason) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), winnerId, 'battle_win', winnerCalc.xp, winReason);
  db.prepare('INSERT INTO xp_logs (id, agent_id, action, xp_earned, reason) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), loserId, 'battle_loss', loserCalc.xp, lossReason);

  // Update win/fight counters
  db.prepare(`
    UPDATE agents
    SET total_wins = total_wins + 1, total_fights = total_fights + 1, last_fight_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(winnerId);
  db.prepare(`
    UPDATE agents
    SET total_fights = total_fights + 1, last_fight_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(loserId);

  // Award Giant Slayer badge if applicable
  if (winnerCalc.breakdown.isGiantSlayer) {
    awardGiantSlayerBadge(db, winnerId, winner.level || 1, loser.level || 1);
  }

  return {
    winner: {
      xp_earned: winnerCalc.xp,
      levels_gained: winnerResult.levelsGained,
      level_now: winnerResult.newLevel,
      total_xp: winnerResult.newXP,
      xp_to_next: winnerResult.xpToNext,
      win_streak: newWinStreak,
      breakdown: winnerCalc.breakdown,
      rewards: winnerRewards,
      rested_used: winnerCalc.restedUsed,
      rested_remaining: winnerNewRestedBattles
    },
    loser: {
      xp_earned: loserCalc.xp,
      levels_gained: loserResult.levelsGained,
      level_now: loserResult.newLevel,
      total_xp: loserResult.newXP,
      xp_to_next: loserResult.xpToNext,
      win_streak: 0,
      breakdown: loserCalc.breakdown,
      rewards: loserRewards,
      rested_used: loserCalc.restedUsed,
      rested_remaining: loserNewRestedBattles
    }
  };
}

/**
 * Build detailed XP reason string for logging
 */
function buildXPReason(breakdown, battleId, playerLevel, opponentLevel) {
  let reason = `Battle ${battleId} (lv${playerLevel} vs lv${opponentLevel})`;

  const bonuses = breakdown.modifiers
    .filter(m => m.xpChange > 0)
    .map(m => {
      if (m.type === 'win_streak') return `streak:+${m.xpChange}`;
      if (m.type === 'daily_first_win') return `first:+${m.xpChange}`;
      if (m.type === 'opponent_level') return `lvl:+${m.xpChange}`;
      return `+${m.xpChange}`;
    });

  if (bonuses.length > 0) {
    reason += ` [${bonuses.join(', ')}]`;
  }

  if (breakdown.isGiantSlayer) {
    reason += ' GIANT SLAYER!';
  }

  return reason;
}

/**
 * Award Giant Slayer badge to player
 */
function awardGiantSlayerBadge(db, agentId, playerLevel, opponentLevel) {
  const badgeId = 'giant_slayer';

  // Check if badge exists, create if not
  const badge = db.prepare('SELECT id FROM badges WHERE id = ?').get(badgeId);
  if (!badge) {
    db.prepare(`
      INSERT INTO badges (id, name, description, tier)
      VALUES (?, ?, ?, ?)
    `).run(badgeId, 'Giant Slayer', `Beat an opponent ${GIANT_SLAYER_LEVEL_DIFF}+ levels higher`, 'epic');
  }

  // Award badge if not already earned
  try {
    db.prepare(`
      INSERT INTO player_badges (id, agent_id, badge_id, earned_by)
      VALUES (?, ?, ?, ?)
    `).run(require('crypto').randomUUID(), agentId, badgeId, `lv${playerLevel} beat lv${opponentLevel}`);

    log.info('Giant Slayer badge awarded', { agentId: agentId.slice(0, 8), playerLevel, opponentLevel });
  } catch (e) {
    // Badge already earned, ignore
  }
}

/**
 * Check if a level-up crosses a tier boundary and trigger skin regeneration.
 */
function triggerTierEvolution(db, agentId, oldLevel, newLevel) {
  const oldTier = getTier(oldLevel);
  const newTier = getTier(newLevel);
  if (newTier <= oldTier) return;

  log.info('Agent crossed tier boundary', { agentId: agentId.slice(0, 8), oldTier, newTier, oldLevel, newLevel });

  // Update skin using reference image (no AI generation cost)
  try {
    const { assignImage } = require('./image-assigner');
    const agent = db.prepare("SELECT * FROM agents WHERE id = ? AND status = 'active'").get(agentId);
    if (!agent) return;

    // Save current skin as previous evolution
    if (agent.avatar_url) {
      db.prepare(`
        UPDATE agents SET previous_skin_url = ?, previous_skin_tier = ?,
          skin_evolved_at = CURRENT_TIMESTAMP,
          evolution_count = COALESCE(evolution_count, 0) + 1
        WHERE id = ?
      `).run(agent.avatar_url, oldTier, agentId);
    }

    // Assign reference image based on type + stats
    const stats = {
      hp: agent.base_hp,
      attack: agent.base_attack,
      defense: agent.base_defense,
      sp_atk: agent.base_sp_atk,
      sp_def: agent.base_sp_def,
      speed: agent.base_speed
    };
    const assignment = assignImage(agent.ai_type, stats);

    if (assignment.imagePath) {
      const prompt = buildSkinPrompt(agent);
      const hash = hashAgentStats(agent);
      db.prepare(`
        UPDATE agents SET avatar_url = ?, visual_prompt = ?, skin_stats_hash = ?, skin_tier = ?
        WHERE id = ?
      `).run(assignment.imagePath, prompt, hash, newTier, agentId);
      log.info('Agent evolved to new tier', { agent: agent.name, tier: newTier, image: `${agent.ai_type}/${assignment.base}-${assignment.variant}` });
    }
  } catch (err) {
    log.error('Auto-regen failed for agent evolution', { agentId, error: err.message });
  }
}

// =============================================================================
// LEVEL-UP REWARDS (Stat Tokens + Move Respecs)
// =============================================================================

/**
 * Grant level-up rewards: stat tokens (1 per level) and move respecs (at milestones)
 *
 * @param {object} db - better-sqlite3 database
 * @param {string} agentId - Agent ID
 * @param {number} oldLevel - Level before XP gain
 * @param {number} newLevel - Level after XP gain
 * @returns {{ tokensAwarded: number, respecsAwarded: number, milestones: number[] }}
 */
function grantLevelUpRewards(db, agentId, oldLevel, newLevel) {
  if (newLevel <= oldLevel) {
    return { tokensAwarded: 0, respecsAwarded: 0, milestones: [] };
  }

  const levelsGained = newLevel - oldLevel;
  const milestonesReached = [];

  // Check which milestone levels were crossed
  for (const milestone of RESPEC_MILESTONES) {
    if (oldLevel < milestone && newLevel >= milestone) {
      milestonesReached.push(milestone);
    }
  }

  // Grant stat tokens (1 per level gained)
  db.prepare(`
    UPDATE agents
    SET stat_tokens_available = COALESCE(stat_tokens_available, 0) + ?
    WHERE id = ?
  `).run(levelsGained, agentId);

  // Grant move respecs for each milestone crossed
  if (milestonesReached.length > 0) {
    db.prepare(`
      UPDATE agents
      SET move_respecs_available = COALESCE(move_respecs_available, 0) + ?,
          last_respec_level = ?
      WHERE id = ?
    `).run(milestonesReached.length, Math.max(...milestonesReached), agentId);

    log.info('Agent gained move respecs', { agentId: agentId.slice(0, 8), respecs: milestonesReached.length, milestones: milestonesReached.join(', ') });
  }

  log.info('Agent leveled up', { agentId: agentId.slice(0, 8), oldLevel, newLevel, statTokens: levelsGained });

  return {
    tokensAwarded: levelsGained,
    respecsAwarded: milestonesReached.length,
    milestones: milestonesReached
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Main functions
  calculateBattleXP,
  xpToNextLevel,
  applyXP,
  awardBattleXP,

  // Level-up rewards
  grantLevelUpRewards,

  // Constants (re-exported for backwards compatibility)
  MAX_LEVEL,

  // Utilities
  getLevelBracketName
};
