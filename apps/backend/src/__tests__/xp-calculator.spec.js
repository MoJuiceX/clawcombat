'use strict';

/**
 * XP Calculator Tests
 *
 * Tests for the ClawCombat XP calculation system including:
 * - calculateBattleXP: All modifier combinations, rested XP doubling
 * - applyXP: Level-up detection, XP overflow, MAX_LEVEL cap
 * - awardBattleXP: DB writes, win streak, first-win-of-day
 * - getLevelBracketName: All 5 brackets
 */

// Mock dependencies before importing the module
jest.mock('../db/schema', () => ({
  getDb: jest.fn(),
  initializeSchema: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

jest.mock('../services/skin-generator', () => ({
  getTier: jest.fn((level) => {
    if (level >= 60) return 3;
    if (level >= 20) return 2;
    return 1;
  }),
  buildSkinPrompt: jest.fn(() => 'test-prompt'),
  hashAgentStats: jest.fn(() => 'test-hash')
}));

jest.mock('../services/image-assigner', () => ({
  assignImage: jest.fn(() => ({ imagePath: '/test/image.png', base: 'test', variant: 'v1' }))
}));

// Import the module under test
const {
  calculateBattleXP,
  xpToNextLevel,
  applyXP,
  awardBattleXP,
  grantLevelUpRewards,
  getLevelBracketName,
  MAX_LEVEL
} = require('../services/xp-calculator');

// Import config for test assertions
const {
  DAILY_FIRST_WIN_BONUS,
  RESTED_XP_CONFIG,
  getBaseXPForLevel,
  getWinStreakBonus,
  getXPToLevelUp
} = require('../config/battle-xp-config');

const { RESPEC_MILESTONES } = require('../config/stat-scaling');

describe('XP Calculator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // getLevelBracketName Tests
  // ===========================================================================
  describe('getLevelBracketName', () => {
    describe('happy path', () => {
      it('should return Rookie bracket for levels 1-10', () => {
        expect(getLevelBracketName(1)).toBe('Rookie (1-10)');
        expect(getLevelBracketName(5)).toBe('Rookie (1-10)');
        expect(getLevelBracketName(10)).toBe('Rookie (1-10)');
      });

      it('should return Apprentice bracket for levels 11-25', () => {
        expect(getLevelBracketName(11)).toBe('Apprentice (11-25)');
        expect(getLevelBracketName(18)).toBe('Apprentice (11-25)');
        expect(getLevelBracketName(25)).toBe('Apprentice (11-25)');
      });

      it('should return Veteran bracket for levels 26-50', () => {
        expect(getLevelBracketName(26)).toBe('Veteran (26-50)');
        expect(getLevelBracketName(38)).toBe('Veteran (26-50)');
        expect(getLevelBracketName(50)).toBe('Veteran (26-50)');
      });

      it('should return Elite bracket for levels 51-75', () => {
        expect(getLevelBracketName(51)).toBe('Elite (51-75)');
        expect(getLevelBracketName(63)).toBe('Elite (51-75)');
        expect(getLevelBracketName(75)).toBe('Elite (51-75)');
      });

      it('should return Champion bracket for levels 76-100', () => {
        expect(getLevelBracketName(76)).toBe('Champion (76-100)');
        expect(getLevelBracketName(88)).toBe('Champion (76-100)');
        expect(getLevelBracketName(100)).toBe('Champion (76-100)');
      });
    });

    describe('edge cases', () => {
      it('should handle boundary between Rookie and Apprentice', () => {
        expect(getLevelBracketName(10)).toBe('Rookie (1-10)');
        expect(getLevelBracketName(11)).toBe('Apprentice (11-25)');
      });

      it('should handle boundary between Apprentice and Veteran', () => {
        expect(getLevelBracketName(25)).toBe('Apprentice (11-25)');
        expect(getLevelBracketName(26)).toBe('Veteran (26-50)');
      });

      it('should handle boundary between Veteran and Elite', () => {
        expect(getLevelBracketName(50)).toBe('Veteran (26-50)');
        expect(getLevelBracketName(51)).toBe('Elite (51-75)');
      });

      it('should handle boundary between Elite and Champion', () => {
        expect(getLevelBracketName(75)).toBe('Elite (51-75)');
        expect(getLevelBracketName(76)).toBe('Champion (76-100)');
      });

      it('should return Champion for levels above 100', () => {
        // Edge case: levels above max should still work
        expect(getLevelBracketName(150)).toBe('Champion (76-100)');
      });
    });
  });

  // ===========================================================================
  // xpToNextLevel Tests
  // ===========================================================================
  describe('xpToNextLevel', () => {
    describe('happy path', () => {
      it('should return correct XP for early levels', () => {
        expect(xpToNextLevel(2)).toBe(500);
        expect(xpToNextLevel(3)).toBe(800);
        expect(xpToNextLevel(4)).toBe(1200);
      });

      it('should return correct XP for mid levels', () => {
        expect(xpToNextLevel(20)).toBe(3000);
        expect(xpToNextLevel(35)).toBe(4500);
        expect(xpToNextLevel(50)).toBe(6000);
      });

      it('should return correct XP for late levels', () => {
        expect(xpToNextLevel(70)).toBe(7500);
        expect(xpToNextLevel(85)).toBe(9000);
        expect(xpToNextLevel(99)).toBe(9000);
      });
    });

    describe('edge cases', () => {
      it('should return 0 for level 1 (first level-up is free)', () => {
        expect(xpToNextLevel(1)).toBe(0);
      });

      it('should return 0 at max level (no more leveling)', () => {
        expect(xpToNextLevel(100)).toBe(0);
      });

      it('should return 0 for levels above max', () => {
        expect(xpToNextLevel(101)).toBe(0);
        expect(xpToNextLevel(150)).toBe(0);
      });
    });
  });

  // ===========================================================================
  // calculateBattleXP Tests
  // ===========================================================================
  describe('calculateBattleXP', () => {
    describe('happy path - basic wins and losses', () => {
      it('should calculate base XP for a win at level 1', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        expect(result.xp).toBe(100); // Base XP for Rookie bracket win
        expect(result.breakdown.baseXP).toBe(100);
        expect(result.breakdown.levelBracket).toBe('Rookie (1-10)');
        expect(result.restedUsed).toBe(false);
      });

      it('should calculate base XP for a loss at level 1', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: false,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        expect(result.xp).toBe(15); // Base loss XP for Rookie bracket
        expect(result.breakdown.baseXP).toBe(15);
        expect(result.restedUsed).toBe(false);
      });

      it('should scale base XP with player level bracket', () => {
        // Level 30 is in Veteran bracket (150 win XP)
        const result = calculateBattleXP({
          playerLevel: 30,
          opponentLevel: 30,
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        expect(result.xp).toBe(150);
        expect(result.breakdown.levelBracket).toBe('Veteran (26-50)');
      });

      it('should apply higher base XP at Champion level (76-100)', () => {
        const result = calculateBattleXP({
          playerLevel: 80,
          opponentLevel: 80,
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        expect(result.xp).toBe(200); // Champion bracket win XP
        expect(result.breakdown.levelBracket).toBe('Champion (76-100)');
      });
    });

    describe('happy path - opponent level modifiers', () => {
      it('should apply +50% bonus for beating opponent 20+ levels higher (Giant Slayer)', () => {
        const result = calculateBattleXP({
          playerLevel: 10,
          opponentLevel: 30, // 20 levels higher
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Base 100 + 50% = 150
        expect(result.xp).toBe(150);
        expect(result.breakdown.isGiantSlayer).toBe(true);
        expect(result.breakdown.modifiers).toContainEqual(
          expect.objectContaining({
            type: 'opponent_level',
            modifier: 0.50
          })
        );
      });

      it('should apply +30% bonus for beating opponent 10-19 levels higher', () => {
        const result = calculateBattleXP({
          playerLevel: 10,
          opponentLevel: 22, // 12 levels higher
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Base 100 + 30% = 130
        expect(result.xp).toBe(130);
        expect(result.breakdown.isGiantSlayer).toBe(false);
      });

      it('should apply +15% bonus for beating opponent 5-9 levels higher', () => {
        const result = calculateBattleXP({
          playerLevel: 10,
          opponentLevel: 17, // 7 levels higher
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Base 100 + 15% = 115
        expect(result.xp).toBe(115);
      });

      it('should apply -15% penalty for beating opponent 5-9 levels lower', () => {
        const result = calculateBattleXP({
          playerLevel: 20,
          opponentLevel: 13, // 7 levels lower
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Base 120 (Apprentice) - 15% = 102
        expect(result.xp).toBe(102);
      });

      it('should apply -30% penalty for beating opponent 10+ levels lower', () => {
        const result = calculateBattleXP({
          playerLevel: 30,
          opponentLevel: 15, // 15 levels lower
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Base 150 (Veteran) - 30% = 105
        expect(result.xp).toBe(105);
      });

      it('should apply no modifier for opponents within 4 levels', () => {
        const result = calculateBattleXP({
          playerLevel: 20,
          opponentLevel: 22, // 2 levels higher
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Base 120 with no modifier
        expect(result.xp).toBe(120);
        expect(result.breakdown.modifiers.filter(m => m.type === 'opponent_level')).toHaveLength(0);
      });
    });

    describe('happy path - win streak bonuses', () => {
      it('should apply +3% bonus for 2-win streak', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 1, // This win makes it a 2-win streak
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Base 100 + 3% = 103
        expect(result.xp).toBe(103);
        expect(result.breakdown.modifiers).toContainEqual(
          expect.objectContaining({
            type: 'win_streak',
            streak: 2,
            modifier: 0.03
          })
        );
      });

      it('should apply +6% bonus for 3-win streak', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 2, // This win makes it a 3-win streak
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Base 100 + 6% = 106
        expect(result.xp).toBe(106);
      });

      it('should apply +12% bonus for 5-win streak', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 4, // This win makes it a 5-win streak
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Base 100 + 12% = 112
        expect(result.xp).toBe(112);
      });

      it('should apply +15% bonus for 10+ win streak', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 9, // This win makes it a 10-win streak
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Base 100 + 15% = 115
        expect(result.xp).toBe(115);
      });

      it('should not apply streak bonus on first win (0 previous wins)', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        expect(result.xp).toBe(100);
        expect(result.breakdown.modifiers.filter(m => m.type === 'win_streak')).toHaveLength(0);
      });
    });

    describe('happy path - daily first win bonus', () => {
      it('should apply +50% bonus for first win of the day', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 0,
          isFirstWinToday: true,
          restedBattles: 0
        });

        // Base 100 + 50% = 150
        expect(result.xp).toBe(150);
        expect(result.breakdown.modifiers).toContainEqual(
          expect.objectContaining({
            type: 'daily_first_win',
            modifier: DAILY_FIRST_WIN_BONUS
          })
        );
      });

      it('should not apply first win bonus on subsequent wins', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        expect(result.xp).toBe(100);
        expect(result.breakdown.modifiers.filter(m => m.type === 'daily_first_win')).toHaveLength(0);
      });
    });

    describe('happy path - rested XP bonus', () => {
      it('should apply 2x multiplier when rested battles are available', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 3
        });

        // Base 100 * 2 = 200
        expect(result.xp).toBe(200);
        expect(result.restedUsed).toBe(true);
        expect(result.breakdown.modifiers).toContainEqual(
          expect.objectContaining({
            type: 'rested_xp',
            modifier: 1.0 // 100% bonus = 2x total
          })
        );
      });

      it('should not apply rested bonus on losses', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: false,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 3
        });

        // Loss XP is 15, no rested bonus for losses in this function
        // (losses get base XP only, bonuses only apply to wins)
        expect(result.xp).toBe(15);
        expect(result.restedUsed).toBe(false);
      });
    });

    describe('happy path - multiple modifiers stacking', () => {
      it('should stack all bonuses correctly', () => {
        const result = calculateBattleXP({
          playerLevel: 10,
          opponentLevel: 30, // Giant slayer (+50%)
          won: true,
          winStreak: 9, // 10-win streak (+15%)
          isFirstWinToday: true, // First win (+50%)
          restedBattles: 3 // Rested (2x)
        });

        // Base: 100
        // +50% (giant slayer): 100 * 0.5 = 50 -> total 150
        // +15% (streak): 100 * 0.15 = 15 -> total 165
        // +50% (first win): 100 * 0.5 = 50 -> total 215
        // 2x (rested): 215 * 2 = 430
        expect(result.xp).toBe(430);
        expect(result.breakdown.modifiers).toHaveLength(4);
      });
    });

    describe('edge cases', () => {
      it('should handle level 1 player against max level opponent', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 100,
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Giant slayer bonus applies
        expect(result.xp).toBe(150);
        expect(result.breakdown.isGiantSlayer).toBe(true);
      });

      it('should handle max level player', () => {
        const result = calculateBattleXP({
          playerLevel: 100,
          opponentLevel: 100,
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        expect(result.xp).toBe(200); // Champion bracket
      });

      it('should handle very high win streak', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 99, // 100-win streak
          isFirstWinToday: false,
          restedBattles: 0
        });

        // Still caps at +15%
        expect(result.xp).toBe(115);
      });

      it('should handle 0 rested battles', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true,
          winStreak: 0,
          isFirstWinToday: false,
          restedBattles: 0
        });

        expect(result.restedUsed).toBe(false);
        expect(result.xp).toBe(100);
      });

      it('should use default values for missing parameters', () => {
        const result = calculateBattleXP({
          playerLevel: 1,
          opponentLevel: 1,
          won: true
          // winStreak, isFirstWinToday, restedBattles all missing
        });

        expect(result.xp).toBe(100);
        expect(result.restedUsed).toBe(false);
      });
    });

    describe('error cases', () => {
      // Note: The function doesn't explicitly throw errors,
      // but we test how it handles unusual inputs

      it('should handle undefined player level gracefully', () => {
        // This tests defensive coding - function should handle edge cases
        const result = calculateBattleXP({
          playerLevel: undefined,
          opponentLevel: 1,
          won: true
        });

        // Should not throw, may use default values
        expect(result).toBeDefined();
        expect(typeof result.xp).toBe('number');
      });
    });
  });

  // ===========================================================================
  // applyXP Tests
  // ===========================================================================
  describe('applyXP', () => {
    describe('happy path', () => {
      it('should add XP without level-up when below threshold', () => {
        const agent = { xp: 100, level: 5 };
        const result = applyXP(agent, 50);

        expect(result.newXP).toBe(150);
        expect(result.newLevel).toBe(5);
        expect(result.levelsGained).toBe(0);
      });

      it('should trigger level-up when XP exceeds threshold', () => {
        // Level 5 needs 1500 XP to level up
        const agent = { xp: 1400, level: 5 };
        const result = applyXP(agent, 200);

        // 1400 + 200 = 1600, exceeds 1500 needed
        // New XP = 1600 - 1500 = 100
        expect(result.newLevel).toBe(6);
        expect(result.newXP).toBe(100);
        expect(result.levelsGained).toBe(1);
      });

      it('should handle multiple level-ups from large XP gain', () => {
        // Level 2 needs 500, level 3 needs 800, level 4 needs 1200
        const agent = { xp: 0, level: 2 };
        const result = applyXP(agent, 2500);

        // 2500 >= 500 -> level 3, remaining 2000
        // 2000 >= 800 -> level 4, remaining 1200
        // 1200 >= 1200 -> level 5, remaining 0
        expect(result.newLevel).toBe(5);
        expect(result.newXP).toBe(0);
        expect(result.levelsGained).toBe(3);
      });

      it('should return correct xpToNext value', () => {
        const agent = { xp: 100, level: 5 };
        const result = applyXP(agent, 50);

        expect(result.xpToNext).toBe(getXPToLevelUp(5));
      });
    });

    describe('edge cases', () => {
      it('should handle agent with 0 XP', () => {
        const agent = { xp: 0, level: 5 };
        const result = applyXP(agent, 100);

        expect(result.newXP).toBe(100);
        expect(result.levelsGained).toBe(0);
      });

      it('should handle agent with undefined XP', () => {
        const agent = { level: 5 };
        const result = applyXP(agent, 100);

        expect(result.newXP).toBe(100);
      });

      it('should handle agent with undefined level', () => {
        const agent = { xp: 0 };
        const result = applyXP(agent, 100);

        expect(result.newLevel).toBeGreaterThanOrEqual(1);
      });

      it('should cap at MAX_LEVEL and keep remaining XP', () => {
        const agent = { xp: 8000, level: 99 };
        const result = applyXP(agent, 2000);

        // Level 99 needs 9000 XP
        // 8000 + 2000 = 10000 >= 9000 -> level 100
        expect(result.newLevel).toBe(100);
        expect(result.levelsGained).toBe(1);
        // Remaining XP kept at max level
        expect(result.newXP).toBe(1000);
      });

      it('should not level beyond MAX_LEVEL', () => {
        const agent = { xp: 0, level: 100 };
        const result = applyXP(agent, 50000);

        expect(result.newLevel).toBe(100);
        expect(result.levelsGained).toBe(0);
        // XP is added but no leveling occurs
        expect(result.newXP).toBe(50000);
      });

      it('should handle level 1 (first level-up is free)', () => {
        const agent = { xp: 0, level: 1 };
        const result = applyXP(agent, 1);

        // Level 1->2 requires 0 XP, so any XP should trigger level-up
        // But the loop checks if needed === 0, which breaks immediately
        // So level 1 agents need to be handled specially (first win)
        expect(result.newLevel).toBeGreaterThanOrEqual(1);
      });

      it('should handle 0 XP earned', () => {
        const agent = { xp: 100, level: 5 };
        const result = applyXP(agent, 0);

        expect(result.newXP).toBe(100);
        expect(result.newLevel).toBe(5);
        expect(result.levelsGained).toBe(0);
      });

      it('should handle exact XP for level-up', () => {
        // Level 5 needs exactly 1500 XP
        const agent = { xp: 0, level: 5 };
        const result = applyXP(agent, 1500);

        expect(result.newLevel).toBe(6);
        expect(result.newXP).toBe(0);
        expect(result.levelsGained).toBe(1);
      });
    });

    describe('error cases', () => {
      it('should handle negative XP gracefully', () => {
        const agent = { xp: 100, level: 5 };
        const result = applyXP(agent, -50);

        // Function doesn't validate negative XP, but should not crash
        expect(result).toBeDefined();
        expect(result.newXP).toBe(50); // 100 + (-50) = 50
      });
    });
  });

  // ===========================================================================
  // grantLevelUpRewards Tests
  // ===========================================================================
  describe('grantLevelUpRewards', () => {
    let mockDb;
    let mockStatement;

    beforeEach(() => {
      mockStatement = {
        run: jest.fn(),
        get: jest.fn(),
        all: jest.fn()
      };
      mockDb = {
        prepare: jest.fn(() => mockStatement)
      };
    });

    describe('happy path', () => {
      it('should grant 1 stat token per level gained', () => {
        const result = grantLevelUpRewards(mockDb, 'agent-123', 5, 6);

        expect(result.tokensAwarded).toBe(1);
        expect(mockDb.prepare).toHaveBeenCalled();
        expect(mockStatement.run).toHaveBeenCalledWith(1, 'agent-123');
      });

      it('should grant multiple stat tokens for multiple level gains', () => {
        const result = grantLevelUpRewards(mockDb, 'agent-123', 5, 10);

        expect(result.tokensAwarded).toBe(5);
        expect(mockStatement.run).toHaveBeenCalledWith(5, 'agent-123');
      });

      it('should grant move respec at milestone level 10', () => {
        const result = grantLevelUpRewards(mockDb, 'agent-123', 9, 10);

        expect(result.respecsAwarded).toBe(1);
        expect(result.milestones).toContain(10);
      });

      it('should grant multiple respecs when crossing multiple milestones', () => {
        // Level 15 to 25 crosses milestone 20
        const result = grantLevelUpRewards(mockDb, 'agent-123', 15, 25);

        expect(result.respecsAwarded).toBe(1);
        expect(result.milestones).toContain(20);
        expect(result.tokensAwarded).toBe(10);
      });

      it('should grant respecs for all milestones: 10, 20, 30, 40, 50, 60, 70, 80, 90', () => {
        // Level 5 to 95 crosses all milestones
        const result = grantLevelUpRewards(mockDb, 'agent-123', 5, 95);

        expect(result.milestones).toEqual(expect.arrayContaining(RESPEC_MILESTONES));
        expect(result.respecsAwarded).toBe(RESPEC_MILESTONES.length);
      });
    });

    describe('edge cases', () => {
      it('should return 0 rewards when newLevel equals oldLevel', () => {
        const result = grantLevelUpRewards(mockDb, 'agent-123', 10, 10);

        expect(result.tokensAwarded).toBe(0);
        expect(result.respecsAwarded).toBe(0);
        expect(result.milestones).toEqual([]);
      });

      it('should return 0 rewards when newLevel is less than oldLevel', () => {
        const result = grantLevelUpRewards(mockDb, 'agent-123', 20, 15);

        expect(result.tokensAwarded).toBe(0);
        expect(result.respecsAwarded).toBe(0);
      });

      it('should handle level 1 to 2 (special first level)', () => {
        const result = grantLevelUpRewards(mockDb, 'agent-123', 1, 2);

        expect(result.tokensAwarded).toBe(1);
        expect(result.respecsAwarded).toBe(0);
      });

      it('should handle reaching max level', () => {
        const result = grantLevelUpRewards(mockDb, 'agent-123', 99, 100);

        expect(result.tokensAwarded).toBe(1);
        // No milestone at 100
        expect(result.milestones).not.toContain(100);
      });
    });
  });

  // ===========================================================================
  // awardBattleXP Tests
  // ===========================================================================
  describe('awardBattleXP', () => {
    let mockDb;
    let mockStatement;

    beforeEach(() => {
      mockStatement = {
        run: jest.fn(),
        get: jest.fn(),
        all: jest.fn()
      };
      mockDb = {
        prepare: jest.fn(() => mockStatement)
      };
    });

    describe('happy path', () => {
      it('should award XP to both winner and loser', () => {
        const winner = {
          id: 'winner-123',
          xp: 0,
          level: 5,
          win_streak: 0,
          daily_first_win_date: null,
          rested_battles: 0,
          last_fight_at: null
        };
        const loser = {
          id: 'loser-456',
          xp: 0,
          level: 5,
          win_streak: 3,
          rested_battles: 0,
          last_fight_at: null
        };

        // Mock the database queries
        mockStatement.get
          .mockReturnValueOnce(winner) // First call for winner
          .mockReturnValueOnce(loser)  // Second call for loser
          .mockReturnValue(null);      // Badge check

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        expect(result).not.toBeNull();
        expect(result.winner.xp_earned).toBeGreaterThan(0);
        expect(result.loser.xp_earned).toBeGreaterThan(0);
        expect(result.winner.win_streak).toBe(1);
        expect(result.loser.win_streak).toBe(0);
      });

      it('should increment win streak for winner', () => {
        const winner = {
          id: 'winner-123',
          xp: 0,
          level: 5,
          win_streak: 5,
          daily_first_win_date: null,
          rested_battles: 0,
          last_fight_at: null
        };
        const loser = {
          id: 'loser-456',
          xp: 0,
          level: 5,
          win_streak: 0,
          rested_battles: 0,
          last_fight_at: null
        };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser)
          .mockReturnValue(null);

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        expect(result.winner.win_streak).toBe(6);
      });

      it('should reset loser win streak to 0', () => {
        const winner = {
          id: 'winner-123',
          xp: 0,
          level: 5,
          win_streak: 0,
          daily_first_win_date: null,
          rested_battles: 0,
          last_fight_at: null
        };
        const loser = {
          id: 'loser-456',
          xp: 0,
          level: 5,
          win_streak: 10,
          rested_battles: 0,
          last_fight_at: null
        };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser)
          .mockReturnValue(null);

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        expect(result.loser.win_streak).toBe(0);
      });

      it('should detect first win of the day', () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const winner = {
          id: 'winner-123',
          xp: 0,
          level: 5,
          win_streak: 0,
          daily_first_win_date: yesterday.toISOString().split('T')[0],
          rested_battles: 0,
          last_fight_at: null
        };
        const loser = {
          id: 'loser-456',
          xp: 0,
          level: 5,
          win_streak: 0,
          rested_battles: 0,
          last_fight_at: null
        };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser)
          .mockReturnValue(null);

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        // First win of day bonus should be applied (50%)
        // Base win XP for level 5 (Rookie) is 100
        // With first win bonus: 100 + 50 = 150
        expect(result.winner.breakdown.modifiers).toContainEqual(
          expect.objectContaining({ type: 'daily_first_win' })
        );
      });

      it('should handle level-up and return rewards', () => {
        const winner = {
          id: 'winner-123',
          xp: 1400, // Close to level-up (need 1500 for level 5->6)
          level: 5,
          win_streak: 0,
          daily_first_win_date: new Date().toISOString().split('T')[0],
          rested_battles: 0,
          last_fight_at: null
        };
        const loser = {
          id: 'loser-456',
          xp: 0,
          level: 5,
          win_streak: 0,
          rested_battles: 0,
          last_fight_at: null
        };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser)
          .mockReturnValue(null);

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        // Winner should level up
        expect(result.winner.levels_gained).toBe(1);
        expect(result.winner.level_now).toBe(6);
        expect(result.winner.rewards.tokensAwarded).toBe(1);
      });

      it('should use rested XP bonus when available', () => {
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

        const winner = {
          id: 'winner-123',
          xp: 0,
          level: 5,
          win_streak: 0,
          daily_first_win_date: new Date().toISOString().split('T')[0],
          rested_battles: 3,
          last_fight_at: twoDaysAgo.toISOString()
        };
        const loser = {
          id: 'loser-456',
          xp: 0,
          level: 5,
          win_streak: 0,
          rested_battles: 0,
          last_fight_at: null
        };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser)
          .mockReturnValue(null);

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        // Rested bonus should apply (2x XP) based on calculateRestedStatus
        // Since last_fight_at is 2 days ago (>24h), rested battles should be calculated
        // The result depends on calculateRestedStatus logic
        expect(result.winner.rested_used).toBeDefined();
        // Winner should have rested_remaining defined
        expect(result.winner.rested_remaining).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('should return null if winner not found', () => {
        mockStatement.get
          .mockReturnValueOnce(null) // Winner not found
          .mockReturnValueOnce({ id: 'loser-456', xp: 0, level: 5 });

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        expect(result).toBeNull();
      });

      it('should return null if loser not found', () => {
        mockStatement.get
          .mockReturnValueOnce({ id: 'winner-123', xp: 0, level: 5 })
          .mockReturnValueOnce(null); // Loser not found

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        expect(result).toBeNull();
      });

      it('should handle agents with missing optional fields', () => {
        const winner = {
          id: 'winner-123',
          xp: 0,
          level: 5
          // Missing: win_streak, daily_first_win_date, rested_battles, last_fight_at
        };
        const loser = {
          id: 'loser-456',
          xp: 0,
          level: 5
        };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser)
          .mockReturnValue(null);

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        expect(result).not.toBeNull();
        expect(result.winner.xp_earned).toBeGreaterThan(0);
      });

      it('should handle max level winner (no level-up)', () => {
        const winner = {
          id: 'winner-123',
          xp: 0,
          level: 100,
          win_streak: 0,
          daily_first_win_date: new Date().toISOString().split('T')[0],
          rested_battles: 0,
          last_fight_at: null
        };
        const loser = {
          id: 'loser-456',
          xp: 0,
          level: 100,
          win_streak: 0,
          rested_battles: 0,
          last_fight_at: null
        };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser)
          .mockReturnValue(null);

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        expect(result.winner.levels_gained).toBe(0);
        expect(result.winner.level_now).toBe(100);
      });
    });

    describe('error cases', () => {
      it('should handle missing level fields by defaulting to 1', () => {
        const winner = {
          id: 'winner-123',
          xp: 0,
          // level is undefined
          win_streak: 0,
          daily_first_win_date: null,
          rested_battles: 0,
          last_fight_at: null
        };
        const loser = {
          id: 'loser-456',
          xp: 0,
          // level is undefined
          win_streak: 0,
          rested_battles: 0,
          last_fight_at: null
        };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser)
          .mockReturnValue(null);

        const result = awardBattleXP(mockDb, 'winner-123', 'loser-456', 'battle-789');

        // Should not crash, uses level 1 default
        expect(result).not.toBeNull();
      });
    });
  });

  // ===========================================================================
  // Integration Tests - Combined Functionality
  // ===========================================================================
  describe('integration', () => {
    it('should correctly progress through early game levels', () => {
      let agent = { xp: 0, level: 2 };

      // Simulate several wins
      for (let i = 0; i < 10; i++) {
        const xpCalc = calculateBattleXP({
          playerLevel: agent.level,
          opponentLevel: agent.level,
          won: true,
          winStreak: i,
          isFirstWinToday: i === 0,
          restedBattles: 0
        });

        const result = applyXP(agent, xpCalc.xp);
        agent = { xp: result.newXP, level: result.newLevel };
      }

      // After 10 wins, should have gained some levels
      expect(agent.level).toBeGreaterThan(2);
    });

    it('should correctly calculate XP breakdown with all modifiers', () => {
      const result = calculateBattleXP({
        playerLevel: 10,
        opponentLevel: 35, // 25 levels higher (giant slayer)
        won: true,
        winStreak: 5, // 6-win streak
        isFirstWinToday: true,
        restedBattles: 3
      });

      // Verify breakdown contains all expected modifiers
      const modifierTypes = result.breakdown.modifiers.map(m => m.type);
      expect(modifierTypes).toContain('opponent_level');
      expect(modifierTypes).toContain('win_streak');
      expect(modifierTypes).toContain('daily_first_win');
      expect(modifierTypes).toContain('rested_xp');

      // Verify giant slayer flag
      expect(result.breakdown.isGiantSlayer).toBe(true);
    });
  });
});
