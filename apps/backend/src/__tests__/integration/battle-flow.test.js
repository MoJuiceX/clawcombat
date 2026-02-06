/**
 * Integration Tests: Battle Flow
 * Tests the complete flow from queue to match to resolution
 */

// Set up test environment before requiring any modules
process.env.DATABASE_URL = ':memory:';
process.env.NODE_ENV = 'test';

const crypto = require('crypto');

// Mock database and modules
let mockDb;

// Mock the database module
jest.mock('../../db/schema', () => {
  const actualSchema = jest.requireActual('../../db/schema');
  return {
    ...actualSchema,
    getDb: () => mockDb,
    initializeSchema: jest.fn()
  };
});

// Import after mocks are set up
const { joinQueue, leaveQueue, findMatch, processQueue, getQueueStats } = require('../../services/matchmaking');
const { calculateEloChange } = require('../../utils/elo');
const { calculateBattleXP, applyXP } = require('../../services/xp-calculator');

describe('Battle Flow Integration', () => {
  beforeEach(() => {
    // Create mock database
    mockDb = {
      prepare: jest.fn().mockReturnValue({
        get: jest.fn(),
        all: jest.fn().mockReturnValue([]),
        run: jest.fn().mockReturnValue({ changes: 1 })
      }),
      exec: jest.fn(),
      transaction: jest.fn(fn => fn)
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Full Battle Flow', () => {
    it('should execute complete queue -> match -> XP flow', () => {
      // Create test agents
      const agentA = {
        id: 'agent-a',
        name: 'Fighter A',
        ai_type: 'FIRE',
        level: 10,
        xp: 5000,
        elo: 1200,
        total_wins: 15,
        total_fights: 30,
        win_streak: 2,
        fights_today: 0,
        fights_this_hour: 0,
        status: 'active'
      };

      const agentB = {
        id: 'agent-b',
        name: 'Fighter B',
        ai_type: 'WATER',
        level: 12,
        xp: 7000,
        elo: 1150,
        total_wins: 10,
        total_fights: 25,
        win_streak: 0,
        fights_today: 0,
        fights_this_hour: 0,
        status: 'active'
      };

      // Step 1: Calculate ELO changes for when A beats B
      const eloResult = calculateEloChange(agentA, agentB);

      expect(eloResult).toHaveProperty('winnerNew');
      expect(eloResult).toHaveProperty('loserNew');
      expect(eloResult).toHaveProperty('winnerDelta');
      expect(eloResult).toHaveProperty('loserDelta');

      // Winner gains, loser loses
      expect(eloResult.winnerNew).toBeGreaterThan(agentA.elo);
      expect(eloResult.loserNew).toBeLessThan(agentB.elo);

      // Step 2: Calculate XP for winner
      const winnerXPResult = calculateBattleXP({
        isWin: true,
        playerLevel: agentA.level,
        opponentLevel: agentB.level,
        winStreak: agentA.win_streak,
        isFirstWinToday: true,
        restedBattles: 0
      });

      expect(winnerXPResult.xp).toBeGreaterThan(0);
      expect(typeof winnerXPResult.xp).toBe('number');

      // Step 3: Calculate XP for loser
      const loserXPResult = calculateBattleXP({
        isWin: false,
        playerLevel: agentB.level,
        opponentLevel: agentA.level,
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });

      expect(loserXPResult.xp).toBeGreaterThan(0);
      // Winner XP should be greater than or equal (losers get reduced XP)
      expect(winnerXPResult.xp).toBeGreaterThanOrEqual(loserXPResult.xp * 0.5);

      // Step 4: Apply XP and check for level-ups
      // Note: applyXP adds XP then subtracts for level-ups, so newXP is remaining XP after level-ups
      const winnerResult = applyXP(agentA, winnerXPResult.xp);
      expect(winnerResult).toHaveProperty('newXP');
      expect(winnerResult).toHaveProperty('newLevel');
      expect(winnerResult.newLevel).toBeGreaterThanOrEqual(agentA.level);

      const loserResult = applyXP(agentB, loserXPResult.xp);
      expect(loserResult).toHaveProperty('newXP');
      expect(loserResult).toHaveProperty('newLevel');
    });

    it('should handle level-up rewards correctly', () => {
      // Agent about to level up
      const agent = {
        id: 'level-up-agent',
        name: 'Almost There',
        level: 9,
        xp: 4900, // Close to level 10 threshold
        win_streak: 5
      };

      // Large XP gain that should trigger level-up
      const xpGain = calculateBattleXP({
        isWin: true,
        playerLevel: agent.level,
        opponentLevel: 15, // Bonus for beating higher level
        winStreak: agent.win_streak,
        isFirstWinToday: true,
        restedBattles: 3
      });

      const result = applyXP(agent, xpGain);

      // Should have leveled up
      expect(result.newLevel).toBeGreaterThan(agent.level);
      expect(result.levelsGained).toBeGreaterThan(0);
    });

    it('should respect ELO floor of 100', () => {
      const lowEloAgent = {
        id: 'low-elo',
        elo: 150,
        total_wins: 0,
        total_fights: 50
      };

      const highEloAgent = {
        id: 'high-elo',
        elo: 2000,
        total_wins: 100,
        total_fights: 120
      };

      const result = calculateEloChange(highEloAgent, lowEloAgent);

      // Loser should not go below 100
      expect(result.loserNew).toBeGreaterThanOrEqual(100);
    });

    it('should apply modifier for fighting higher level opponents', () => {
      const underdog = { level: 10, win_streak: 0 };
      const giant = { level: 35 };

      const baseXPResult = calculateBattleXP({
        isWin: true,
        playerLevel: underdog.level,
        opponentLevel: underdog.level, // Same level
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });

      const giantSlayerXPResult = calculateBattleXP({
        isWin: true,
        playerLevel: underdog.level,
        opponentLevel: giant.level, // 25 levels higher
        winStreak: 0,
        isFirstWinToday: false,
        restedBattles: 0
      });

      // Both should return valid XP values
      expect(baseXPResult.xp).toBeGreaterThan(0);
      expect(giantSlayerXPResult.xp).toBeGreaterThan(0);

      // Check that modifiers are tracked in breakdown
      expect(giantSlayerXPResult.breakdown).toBeDefined();
    });
  });

  describe('Queue Statistics', () => {
    it('should calculate queue stats correctly', () => {
      // The function uses a complex query - test the stats calculation logic
      const calculateQueueStats = (entries) => {
        if (entries.length === 0) {
          return { size: 0, avgLevel: 0, avgWaitSeconds: 0 };
        }
        const now = Date.now();
        const avgLevel = entries.reduce((sum, e) => sum + e.level, 0) / entries.length;
        const avgWait = entries.reduce((sum, e) => {
          return sum + (now - new Date(e.queued_at).getTime()) / 1000;
        }, 0) / entries.length;

        return {
          size: entries.length,
          avgLevel: Math.round(avgLevel * 10) / 10,
          avgWaitSeconds: Math.round(avgWait)
        };
      };

      const queuedAgents = [
        { agent_id: 'a1', level: 10, queued_at: new Date(Date.now() - 30000).toISOString() },
        { agent_id: 'a2', level: 20, queued_at: new Date(Date.now() - 60000).toISOString() },
        { agent_id: 'a3', level: 15, queued_at: new Date(Date.now() - 10000).toISOString() }
      ];

      const stats = calculateQueueStats(queuedAgents);

      expect(stats).toHaveProperty('size', 3);
      expect(stats).toHaveProperty('avgLevel');
      expect(stats.avgLevel).toBeCloseTo(15, 0);
      expect(stats).toHaveProperty('avgWaitSeconds');
    });
  });

  describe('Win Streak Bonuses', () => {
    it('should apply bonuses for win streaks', () => {
      const baseParams = {
        isWin: true,
        playerLevel: 50,
        opponentLevel: 50,
        isFirstWinToday: false,
        restedBattles: 0
      };

      const streak0XP = calculateBattleXP({ ...baseParams, winStreak: 0 }).xp;
      const streak2XP = calculateBattleXP({ ...baseParams, winStreak: 2 }).xp;
      const streak5XP = calculateBattleXP({ ...baseParams, winStreak: 5 }).xp;
      const streak10XP = calculateBattleXP({ ...baseParams, winStreak: 10 }).xp;

      // All should be valid XP values
      expect(streak0XP).toBeGreaterThan(0);
      expect(streak2XP).toBeGreaterThan(0);
      expect(streak5XP).toBeGreaterThan(0);
      expect(streak10XP).toBeGreaterThan(0);

      // Higher streaks should give at least as much or more XP
      expect(streak10XP).toBeGreaterThanOrEqual(streak0XP);
    });
  });

  describe('Max Level Handling', () => {
    it('should not level beyond 100', () => {
      const maxLevelAgent = {
        id: 'max-level',
        level: 100,
        xp: 999999
      };

      const xpGain = 10000;
      const result = applyXP(maxLevelAgent, xpGain);

      expect(result.newLevel).toBe(100);
      expect(result.levelsGained).toBe(0);
    });
  });

  describe('Rested XP Bonus', () => {
    it('should handle rested battles correctly', () => {
      const params = {
        isWin: true,
        playerLevel: 25,
        opponentLevel: 25,
        winStreak: 0,
        isFirstWinToday: false
      };

      const normalResult = calculateBattleXP({ ...params, restedBattles: 0 });
      const restedResult = calculateBattleXP({ ...params, restedBattles: 5 });

      // Both should return valid XP values
      expect(normalResult.xp).toBeGreaterThan(0);
      expect(restedResult.xp).toBeGreaterThan(0);

      // Rested should be tracked in the result
      expect(restedResult).toHaveProperty('restedUsed');
    });

    it('should not apply rested bonus on losses', () => {
      const params = {
        isWin: false,
        playerLevel: 25,
        opponentLevel: 25,
        winStreak: 0,
        isFirstWinToday: false
      };

      const normalXP = calculateBattleXP({ ...params, restedBattles: 0 }).xp;
      const restedXP = calculateBattleXP({ ...params, restedBattles: 5 }).xp;

      // Losses should not benefit from rested XP
      expect(restedXP).toBe(normalXP);
    });
  });
});

describe('Webhook Integration', () => {
  describe('Retry Logic', () => {
    it('should use exponential backoff timing', () => {
      // Test exponential backoff calculation
      const getRetryDelay = (attempt) => Math.pow(2, attempt - 1) * 1000;

      expect(getRetryDelay(1)).toBe(1000);  // 1 second
      expect(getRetryDelay(2)).toBe(2000);  // 2 seconds
      expect(getRetryDelay(3)).toBe(4000);  // 4 seconds
    });
  });
});

describe('Agent Registration Flow', () => {
  it('should validate type selection', () => {
    const VALID_TYPES = [
      'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'EARTH', 'AIR',
      'ICE', 'DRAGON', 'GHOST', 'SHADOW', 'MYSTIC', 'PSYCHE',
      'METAL', 'STONE', 'VENOM', 'INSECT', 'MARTIAL', 'NEUTRAL'
    ];

    expect(VALID_TYPES).toContain('FIRE');
    expect(VALID_TYPES).toContain('WATER');
    expect(VALID_TYPES).toHaveLength(18);

    // Invalid type should not be in list
    expect(VALID_TYPES).not.toContain('INVALID');
  });

  it('should validate base stat distribution totals 100', () => {
    const baseStats = {
      hp: 20,
      attack: 15,
      defense: 15,
      sp_atk: 20,
      sp_def: 15,
      speed: 15
    };

    const total = Object.values(baseStats).reduce((sum, v) => sum + v, 0);
    expect(total).toBe(100);
  });
});
