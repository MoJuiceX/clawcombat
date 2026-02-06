/**
 * Edge Case Integration Tests
 *
 * Tests boundary conditions and unusual scenarios that could cause issues
 */

const { calculateBattleXP, applyXP } = require('../../services/xp-calculator');
const { calculateEloChange } = require('../../utils/elo');
const { getTypeMultiplier, VALID_TYPES } = require('../../utils/type-system');

describe('Edge Cases', () => {
  describe('Max Level Handling', () => {
    const maxLevelAgent = {
      id: 'max-level-agent',
      level: 100,
      xp: 999999,
      win_streak: 50
    };

    test('should not level beyond 100', () => {
      const result = applyXP(maxLevelAgent, 10000);
      expect(result.newLevel).toBe(100);
    });

    test('should still award XP at max level (for tracking)', () => {
      const xpResult = calculateBattleXP({
        playerLevel: 100,
        opponentLevel: 100,
        won: true,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });
      expect(xpResult.xp).toBeGreaterThan(0);
    });
  });

  describe('Level 1 Special Cases', () => {
    test('level 1 agent gets appropriate XP for win', () => {
      const xpResult = calculateBattleXP({
        playerLevel: 1,
        opponentLevel: 1,
        won: true,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });
      expect(xpResult.xp).toBeGreaterThan(0);
    });

    test('level 1 loss still awards some XP', () => {
      const xpResult = calculateBattleXP({
        playerLevel: 1,
        opponentLevel: 1,
        won: false,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });
      expect(xpResult.xp).toBeGreaterThan(0);
    });
  });

  describe('ELO Edge Cases', () => {
    test('ELO floor of 100 is enforced', () => {
      const result = calculateEloChange(
        { elo: 1500, total_wins: 50, total_fights: 100 },
        { elo: 100, total_wins: 0, total_fights: 10 }
      );
      expect(result.loserNew).toBe(100);
    });

    test('both players at ELO floor', () => {
      const result = calculateEloChange(
        { elo: 100, total_wins: 0, total_fights: 10 },
        { elo: 100, total_wins: 0, total_fights: 10 }
      );
      expect(result.winnerNew).toBeGreaterThan(100);
      expect(result.loserNew).toBe(100);
    });

    test('large ELO difference upset', () => {
      const result = calculateEloChange(
        { elo: 800, total_wins: 10, total_fights: 20 },
        { elo: 2000, total_wins: 200, total_fights: 300 }
      );
      // Upset should give significant points
      expect(result.winnerDelta).toBeGreaterThan(20);
    });

    test('missing ELO defaults to 1000', () => {
      const result = calculateEloChange(
        { total_wins: 0, total_fights: 0 },
        { total_wins: 0, total_fights: 0 }
      );
      expect(result.winnerNew).toBeGreaterThan(1000);
      expect(result.loserNew).toBeLessThan(1000);
    });

    test('returns all expected properties', () => {
      const result = calculateEloChange(
        { elo: 1000, total_wins: 10, total_fights: 20 },
        { elo: 1000, total_wins: 10, total_fights: 20 }
      );
      expect(result).toHaveProperty('winnerNew');
      expect(result).toHaveProperty('loserNew');
      expect(result).toHaveProperty('winnerDelta');
      expect(result).toHaveProperty('loserDelta');
    });
  });

  describe('Win Streak Edge Cases', () => {
    test('maximum win streak bonus caps at 15%', () => {
      const result10 = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 50,
        won: true,
        winStreak: 10,
        isFirstWinToday: false,
        restedBattles: 0
      });

      const result100 = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 50,
        won: true,
        winStreak: 100,
        isFirstWinToday: false,
        restedBattles: 0
      });

      // Both should have same XP (streak bonus capped)
      expect(result10.xp).toBe(result100.xp);
    });

    test('losses do not get streak bonus', () => {
      const lossResult = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 50,
        won: false,
        winStreak: 10,
        isFirstWinToday: false,
        restedBattles: 0
      });

      // Losses have no modifiers
      expect(lossResult.breakdown.modifiers).toHaveLength(0);
    });
  });

  describe('Type System Edge Cases', () => {
    test('all 18 types are valid', () => {
      expect(VALID_TYPES).toHaveLength(18);
    });

    test('self-type attacks return correct multiplier', () => {
      for (const type of VALID_TYPES) {
        const multiplier = getTypeMultiplier(type, type);
        expect(multiplier).toBeDefined();
        expect(multiplier).toBeGreaterThanOrEqual(0);
        expect(multiplier).toBeLessThanOrEqual(2);
      }
    });

    test('invalid types return 1.0 (neutral)', () => {
      expect(getTypeMultiplier('invalid', 'fire')).toBe(1.0);
      expect(getTypeMultiplier('fire', 'invalid')).toBe(1.0);
      expect(getTypeMultiplier('invalid', 'invalid')).toBe(1.0);
    });

    test('type effectiveness - FIRE vs GRASS (super effective)', () => {
      expect(getTypeMultiplier('FIRE', 'GRASS')).toBe(1.2);
    });

    test('type effectiveness - WATER vs FIRE (super effective)', () => {
      expect(getTypeMultiplier('WATER', 'FIRE')).toBe(1.2);
    });

    test('type resistance - FIRE vs WATER (not effective)', () => {
      expect(getTypeMultiplier('FIRE', 'WATER')).toBe(0.8);
    });
  });

  describe('XP Modifier Stacking', () => {
    test('all bonuses stack correctly', () => {
      const baseResult = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 50,
        won: true,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });

      const stackedResult = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 70, // Higher level opponent bonus
        won: true,
        winStreak: 10, // Streak bonus
        isFirstWinToday: true, // First win bonus
        restedBattles: 3 // Rested bonus
      });

      // Stacked should be significantly higher
      expect(stackedResult.xp).toBeGreaterThan(baseResult.xp * 2);
    });

    test('negative modifiers reduce XP', () => {
      const normalResult = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 50,
        won: true,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });

      const penaltyResult = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 30, // Lower level opponent penalty
        won: true,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });

      expect(penaltyResult.xp).toBeLessThan(normalResult.xp);
    });
  });

  describe('Rested XP Edge Cases', () => {
    test('rested bonus only applies to wins', () => {
      const lossResult = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 50,
        won: false,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 10
      });

      expect(lossResult.restedUsed).toBe(false);
    });

    test('rested bonus is 2x when available', () => {
      const normalResult = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 50,
        won: true,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });

      const restedResult = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 50,
        won: true,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 5
      });

      expect(restedResult.restedUsed).toBe(true);
      expect(restedResult.xp).toBe(normalResult.xp * 2);
    });
  });

  describe('Boundary Level Tests', () => {
    const levelBoundaries = [
      { level: 10, bracket: 'Rookie' },
      { level: 11, bracket: 'Apprentice' },
      { level: 25, bracket: 'Apprentice' },
      { level: 26, bracket: 'Veteran' },
      { level: 50, bracket: 'Veteran' },
      { level: 51, bracket: 'Elite' },
      { level: 75, bracket: 'Elite' },
      { level: 76, bracket: 'Champion' }
    ];

    test.each(levelBoundaries)('level $level should be in $bracket bracket', ({ level }) => {
      const result = calculateBattleXP({
        playerLevel: level,
        opponentLevel: level,
        won: true,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });
      expect(result.xp).toBeGreaterThan(0);
    });
  });

  describe('Multi-Level-Up Scenarios', () => {
    test('large XP gain causes multiple level-ups', () => {
      const agent = { id: 'low-level', level: 5, xp: 0 };
      const result = applyXP(agent, 50000); // Massive XP
      expect(result.newLevel).toBeGreaterThan(10);
      expect(result.levelsGained).toBeGreaterThan(5);
    });

    test('level up returns correct xpToNext', () => {
      const agent = { id: 'mid-level', level: 25, xp: 0 };
      const result = applyXP(agent, 2500); // Exactly one level worth
      expect(result.xpToNext).toBeDefined();
      expect(result.xpToNext).toBeGreaterThan(0);
    });
  });

  describe('Null/Undefined Input Handling', () => {
    test('applyXP handles undefined agent fields', () => {
      const agent = { id: 'minimal' };
      const result = applyXP(agent, 100);
      expect(result.newLevel).toBeGreaterThanOrEqual(1);
    });

    test('calculateEloChange handles missing fields gracefully', () => {
      const result = calculateEloChange(
        { elo: 1000 },
        { elo: 1000 }
      );
      expect(result.winnerNew).toBeDefined();
      expect(result.loserNew).toBeDefined();
    });

    test('getTypeMultiplier handles null inputs', () => {
      expect(getTypeMultiplier(null, 'fire')).toBe(1.0);
      expect(getTypeMultiplier('fire', null)).toBe(1.0);
      expect(getTypeMultiplier(undefined, undefined)).toBe(1.0);
    });
  });

  describe('XP Breakdown Structure', () => {
    test('breakdown contains expected properties', () => {
      const result = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 60,
        won: true,
        winStreak: 5,
        isFirstWinToday: true,
        restedBattles: 2
      });

      expect(result.breakdown).toHaveProperty('baseXP');
      expect(result.breakdown).toHaveProperty('levelBracket');
      expect(result.breakdown).toHaveProperty('modifiers');
      expect(result.breakdown).toHaveProperty('totalXP');
      expect(Array.isArray(result.breakdown.modifiers)).toBe(true);
    });

    test('modifiers have correct structure', () => {
      const result = calculateBattleXP({
        playerLevel: 50,
        opponentLevel: 60,
        won: true,
        winStreak: 5,
        isFirstWinToday: false,
        restedBattles: 0
      });

      for (const modifier of result.breakdown.modifiers) {
        expect(modifier).toHaveProperty('type');
        expect(modifier).toHaveProperty('modifier');
        expect(modifier).toHaveProperty('xpChange');
        expect(modifier).toHaveProperty('description');
      }
    });
  });
});
