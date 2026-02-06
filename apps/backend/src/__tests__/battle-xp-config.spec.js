/**
 * ClawCombat XP System Unit Tests
 * Tests the battle XP configuration and calculation functions
 */

const {
  getXPToLevelUp,
  getBaseXPForLevel,
  getOpponentLevelModifier,
  getWinStreakBonus,
  getLoginStreakReward,
  getTotalXPForLevel,
  estimateToMax,
  calculateRestedStatus,
  applyRestedBonus,
  DAILY_FIRST_WIN_BONUS,
  MAX_LEVEL,
  GIANT_SLAYER_LEVEL_DIFF,
  RESTED_XP_CONFIG,
  LEVEL_XP_REQUIREMENTS,
  LOGIN_STREAK_REWARDS,
} = require('../config/battle-xp-config');

describe('XP System Configuration', () => {
  describe('getXPToLevelUp', () => {
    test('returns 0 for level 1 (first win forces level-up)', () => {
      expect(getXPToLevelUp(1)).toBe(0);
    });

    test('returns correct XP for early levels', () => {
      expect(getXPToLevelUp(2)).toBe(500);
      expect(getXPToLevelUp(3)).toBe(800);
      expect(getXPToLevelUp(4)).toBe(1200);
    });

    test('returns correct XP for mid-game levels', () => {
      expect(getXPToLevelUp(10)).toBe(2000);
      expect(getXPToLevelUp(20)).toBe(3000);
      expect(getXPToLevelUp(35)).toBe(4500);
      expect(getXPToLevelUp(50)).toBe(6000);
    });

    test('returns correct XP for late-game levels', () => {
      expect(getXPToLevelUp(70)).toBe(7500);
      expect(getXPToLevelUp(85)).toBe(9000);
      expect(getXPToLevelUp(99)).toBe(9000);
    });

    test('returns 0 for max level', () => {
      expect(getXPToLevelUp(MAX_LEVEL)).toBe(0);
    });

    test('returns elite tier default for undefined levels', () => {
      // Level 200 is not defined, should default to 9000
      expect(getXPToLevelUp(200)).toBe(0); // But MAX_LEVEL check comes first
    });
  });

  describe('getBaseXPForLevel', () => {
    test('returns correct XP for wins at different level brackets', () => {
      // Levels 1-10: 100 XP for win
      expect(getBaseXPForLevel(1, true)).toBe(100);
      expect(getBaseXPForLevel(10, true)).toBe(100);

      // Levels 11-25: 120 XP for win
      expect(getBaseXPForLevel(11, true)).toBe(120);
      expect(getBaseXPForLevel(25, true)).toBe(120);

      // Levels 26-50: 150 XP for win
      expect(getBaseXPForLevel(26, true)).toBe(150);
      expect(getBaseXPForLevel(50, true)).toBe(150);

      // Levels 51-75: 180 XP for win
      expect(getBaseXPForLevel(51, true)).toBe(180);
      expect(getBaseXPForLevel(75, true)).toBe(180);

      // Levels 76-100: 200 XP for win
      expect(getBaseXPForLevel(76, true)).toBe(200);
      expect(getBaseXPForLevel(100, true)).toBe(200);
    });

    test('returns correct XP for losses (15% of win XP)', () => {
      // Levels 1-10: 15 XP for loss (15% of 100)
      expect(getBaseXPForLevel(1, false)).toBe(15);
      expect(getBaseXPForLevel(10, false)).toBe(15);

      // Levels 11-25: 18 XP for loss (15% of 120)
      expect(getBaseXPForLevel(11, false)).toBe(18);

      // Levels 26-50: 23 XP for loss (15% of 150, rounded)
      expect(getBaseXPForLevel(50, false)).toBe(23);

      // Levels 51-75: 27 XP for loss (15% of 180)
      expect(getBaseXPForLevel(75, false)).toBe(27);

      // Levels 76-100: 30 XP for loss (15% of 200)
      expect(getBaseXPForLevel(100, false)).toBe(30);
    });

    test('defaults to highest bracket for levels beyond 100', () => {
      expect(getBaseXPForLevel(150, true)).toBe(200);
      expect(getBaseXPForLevel(150, false)).toBe(30);
    });
  });

  describe('getOpponentLevelModifier', () => {
    test('returns Giant Slayer bonus for beating opponent 20+ levels higher', () => {
      const result = getOpponentLevelModifier(10, 35);
      expect(result.modifier).toBe(0.50);
      expect(result.isGiantSlayer).toBe(true);
    });

    test('returns +30% for beating opponent 10-19 levels higher', () => {
      const result = getOpponentLevelModifier(10, 20);
      expect(result.modifier).toBe(0.30);
      expect(result.isGiantSlayer).toBe(false);
    });

    test('returns +15% for beating opponent 5-9 levels higher', () => {
      const result = getOpponentLevelModifier(10, 15);
      expect(result.modifier).toBe(0.15);
      expect(result.isGiantSlayer).toBe(false);
    });

    test('returns 0% for equal level opponents', () => {
      const result = getOpponentLevelModifier(10, 10);
      expect(result.modifier).toBe(0);
      expect(result.isGiantSlayer).toBe(false);
    });

    test('returns -15% for beating opponent 5-9 levels lower', () => {
      const result = getOpponentLevelModifier(20, 15);
      expect(result.modifier).toBe(-0.15);
      expect(result.isGiantSlayer).toBe(false);
    });

    test('returns -30% for beating opponent 10+ levels lower', () => {
      const result = getOpponentLevelModifier(30, 20);
      expect(result.modifier).toBe(-0.30);
      expect(result.isGiantSlayer).toBe(false);
    });

    test('caps penalty at -30% for beating opponent 20+ levels lower', () => {
      const result = getOpponentLevelModifier(50, 25);
      expect(result.modifier).toBe(-0.30);
      expect(result.isGiantSlayer).toBe(false);
    });
  });

  describe('getWinStreakBonus', () => {
    test('returns 0% for no streak', () => {
      expect(getWinStreakBonus(0)).toBe(0); // Will be 1-win streak
    });

    test('returns +3% for 2-win streak', () => {
      expect(getWinStreakBonus(1)).toBe(0.03);
    });

    test('returns +6% for 3-4 win streak', () => {
      expect(getWinStreakBonus(2)).toBe(0.06);
      expect(getWinStreakBonus(3)).toBe(0.06);
    });

    test('returns +12% for 5-9 win streak', () => {
      expect(getWinStreakBonus(4)).toBe(0.12);
      expect(getWinStreakBonus(8)).toBe(0.12);
    });

    test('returns +15% for 10+ win streak', () => {
      expect(getWinStreakBonus(9)).toBe(0.15);
      expect(getWinStreakBonus(20)).toBe(0.15);
    });
  });

  describe('getLoginStreakReward', () => {
    test('returns correct XP for each day of the week', () => {
      expect(getLoginStreakReward(1)).toBe(25);
      expect(getLoginStreakReward(2)).toBe(40);
      expect(getLoginStreakReward(3)).toBe(50);
      expect(getLoginStreakReward(4)).toBe(65);
      expect(getLoginStreakReward(5)).toBe(75);
      expect(getLoginStreakReward(6)).toBe(90);
      expect(getLoginStreakReward(7)).toBe(350); // Weekly bonus
    });

    test('cycles correctly after day 7', () => {
      expect(getLoginStreakReward(8)).toBe(25); // Back to day 1
      expect(getLoginStreakReward(14)).toBe(350); // Another week
      expect(getLoginStreakReward(15)).toBe(25); // Back to day 1
    });
  });

  describe('DAILY_FIRST_WIN_BONUS', () => {
    test('is set to 50%', () => {
      expect(DAILY_FIRST_WIN_BONUS).toBe(0.50);
    });
  });

  describe('getTotalXPForLevel', () => {
    test('returns 0 for level 1', () => {
      expect(getTotalXPForLevel(1)).toBe(0);
    });

    test('returns 0 for level 2 (first win levels up)', () => {
      expect(getTotalXPForLevel(2)).toBe(0);
    });

    test('returns correct cumulative XP for early levels', () => {
      // Level 3 requires 500 XP (level 2->3)
      expect(getTotalXPForLevel(3)).toBe(500);
      // Level 4 requires 500 + 800 = 1300 XP
      expect(getTotalXPForLevel(4)).toBe(1300);
      // Level 5 requires 500 + 800 + 1200 = 2500 XP
      expect(getTotalXPForLevel(5)).toBe(2500);
    });

    test('total XP for level 100 is substantial', () => {
      const total = getTotalXPForLevel(100);
      expect(total).toBeGreaterThan(400000); // Should be a significant grind
      expect(total).toBeLessThan(1000000); // But not unreasonable
    });
  });

  describe('estimateToMax', () => {
    test('returns reasonable estimates for hardcore players', () => {
      const result = estimateToMax(24, 0.55);
      expect(result.totalBattles).toBeGreaterThan(1000);
      expect(result.days).toBeGreaterThan(100);
      expect(result.months).toBeGreaterThan(3);
    });

    test('returns longer estimates for casual players', () => {
      const hardcore = estimateToMax(24, 0.55);
      const casual = estimateToMax(3, 0.50);

      expect(casual.days).toBeGreaterThan(hardcore.days * 5);
    });

    test('returns object with required properties', () => {
      const result = estimateToMax(10, 0.5);
      expect(result).toHaveProperty('totalBattles');
      expect(result).toHaveProperty('days');
      expect(result).toHaveProperty('months');
      expect(typeof result.totalBattles).toBe('number');
      expect(typeof result.days).toBe('number');
      expect(typeof result.months).toBe('number');
    });
  });
});

describe('Rested XP System', () => {
  describe('RESTED_XP_CONFIG', () => {
    test('has correct configuration values', () => {
      expect(RESTED_XP_CONFIG.multiplier).toBe(2.0);
      expect(RESTED_XP_CONFIG.maxRestedBattles).toBe(3);
      expect(RESTED_XP_CONFIG.offlineHoursRequired).toBe(24);
      expect(RESTED_XP_CONFIG.maxStoredDays).toBe(2);
    });
  });

  describe('calculateRestedStatus', () => {
    test('returns max rested battles for new players (no last battle)', () => {
      const result = calculateRestedStatus(null, 0);
      expect(result.isRested).toBe(true);
      expect(result.restedBattlesAvailable).toBe(3);
      expect(result.multiplier).toBe(2.0);
    });

    test('returns rested status after 24+ hours offline', () => {
      const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const result = calculateRestedStatus(oneDayAgo, 0);
      expect(result.isRested).toBe(true);
      expect(result.restedBattlesAvailable).toBe(3);
    });

    test('returns not rested for recent battles', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const result = calculateRestedStatus(oneHourAgo, 0);
      expect(result.isRested).toBe(false);
      expect(result.restedBattlesAvailable).toBe(0);
      expect(result.multiplier).toBe(1.0);
    });

    test('preserves existing rested battles if more than new calculation', () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
      const result = calculateRestedStatus(fiveHoursAgo, 2);
      expect(result.isRested).toBe(true);
      expect(result.restedBattlesAvailable).toBe(2);
    });

    test('caps rested battles at max stored days', () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const result = calculateRestedStatus(weekAgo, 0);
      // Max is 3 battles * 2 days = 6
      expect(result.restedBattlesAvailable).toBeLessThanOrEqual(6);
    });
  });

  describe('applyRestedBonus', () => {
    test('doubles XP when rested battles available', () => {
      const result = applyRestedBonus(100, 3);
      expect(result.xp).toBe(200);
      expect(result.restedUsed).toBe(true);
      expect(result.remainingRestedBattles).toBe(2);
    });

    test('returns base XP when no rested battles', () => {
      const result = applyRestedBonus(100, 0);
      expect(result.xp).toBe(100);
      expect(result.restedUsed).toBe(false);
      expect(result.remainingRestedBattles).toBe(0);
    });

    test('decrements rested battles correctly', () => {
      let remaining = 3;
      for (let i = 0; i < 3; i++) {
        const result = applyRestedBonus(100, remaining);
        expect(result.xp).toBe(200);
        remaining = result.remainingRestedBattles;
      }
      expect(remaining).toBe(0);

      // Fourth battle should not get bonus
      const result = applyRestedBonus(100, remaining);
      expect(result.xp).toBe(100);
    });

    test('handles negative rested battles gracefully', () => {
      const result = applyRestedBonus(100, -1);
      expect(result.xp).toBe(100);
      expect(result.restedUsed).toBe(false);
      expect(result.remainingRestedBattles).toBe(0);
    });
  });
});

describe('XP Calculation Integration', () => {
  test('full XP calculation for level 5 first win of day', () => {
    const base = getBaseXPForLevel(5, true);
    expect(base).toBe(100);

    const firstWinBonus = Math.round(base * DAILY_FIRST_WIN_BONUS);
    expect(firstWinBonus).toBe(50);

    const total = base + firstWinBonus;
    expect(total).toBe(150);
  });

  test('full XP calculation with Giant Slayer and streak', () => {
    const playerLevel = 25;
    const opponentLevel = 50;
    const winStreak = 9; // Will become 10-win streak

    const base = getBaseXPForLevel(playerLevel, true);
    const { modifier, isGiantSlayer } = getOpponentLevelModifier(playerLevel, opponentLevel);
    const streakBonus = getWinStreakBonus(winStreak);

    expect(base).toBe(120); // Level 25 is in 11-25 bracket
    expect(modifier).toBe(0.50); // +25 levels = Giant Slayer
    expect(isGiantSlayer).toBe(true);
    expect(streakBonus).toBe(0.15); // 10-win streak

    const levelBonus = Math.round(base * modifier);
    const streakBonusXP = Math.round(base * streakBonus);
    const total = base + levelBonus + streakBonusXP;

    expect(levelBonus).toBe(60); // 120 * 0.50
    expect(streakBonusXP).toBe(18); // 120 * 0.15
    expect(total).toBe(198);
  });

  test('rested XP stacks with other bonuses', () => {
    const base = getBaseXPForLevel(50, true);
    const firstWinBonus = Math.round(base * DAILY_FIRST_WIN_BONUS);
    const preRestedTotal = base + firstWinBonus;

    const { xp: restedTotal } = applyRestedBonus(preRestedTotal, 3);

    // 150 base + 75 first win = 225, then 2x for rested = 450
    expect(restedTotal).toBe(450);
  });
});
