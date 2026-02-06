'use strict';

/**
 * Matchmaking System Tests
 *
 * Tests for the ClawCombat matchmaking system including:
 * - joinQueue: Rate limit checks, duplicate prevention, active battle checks
 * - leaveQueue: Removing agents from queue
 * - findMatch: Level range matching, expanding search ranges
 * - processQueue: Multi-match processing, queue removal
 * - getLevelRange: Time-based level range thresholds
 * - completeBattle: XP awards, level-up detection
 * - getQueueStats: Queue statistics
 */

// Mock dependencies before importing
jest.mock('../db/schema', () => ({
  getDb: jest.fn()
}));

jest.mock('../middleware/rate-limit', () => ({
  getFightLimitInfo: jest.fn(),
  recordFight: jest.fn()
}));

jest.mock('../utils/xp-scaling', () => ({
  calculateScaledXP: jest.fn(() => ({
    winXP: 100,
    lossXP: 25,
    scaleFactor: 1.0,
    levelDiff: 0
  })),
  checkLevelUp: jest.fn(() => ({ leveled: false, oldLevel: 5, newLevel: 5 }))
}));

// Import mocked modules for setup
const { getDb } = require('../db/schema');
const { getFightLimitInfo, recordFight } = require('../middleware/rate-limit');
const { calculateScaledXP, checkLevelUp } = require('../utils/xp-scaling');

// Import module under test
const {
  joinQueue,
  leaveQueue,
  findMatch,
  processQueue,
  completeBattle,
  getQueueStats
} = require('../services/matchmaking');

describe('Matchmaking System', () => {
  let mockDb;
  let mockStatement;

  beforeEach(() => {
    jest.clearAllMocks();

    mockStatement = {
      run: jest.fn(() => ({ changes: 1 })),
      get: jest.fn(),
      all: jest.fn(() => [])
    };

    mockDb = {
      prepare: jest.fn(() => mockStatement),
      exec: jest.fn(),
      // Mock transaction() - in better-sqlite3, transaction returns a function that executes the callback
      transaction: jest.fn((fn) => {
        // Return a function that executes the transaction callback when called
        return () => fn();
      })
    };

    getDb.mockReturnValue(mockDb);

    // Default mock for rate limit - allow fights
    getFightLimitInfo.mockReturnValue({
      allowed: true,
      remaining: 5,
      limit: 6,
      period: 'day',
      tier: 'free',
      reason: null
    });
  });

  // ===========================================================================
  // getLevelRange Tests (Internal helper, tested via findMatch/processQueue)
  // ===========================================================================
  describe('level range calculation', () => {
    // Note: getLevelRange is not exported, but we can test its behavior
    // through findMatch and processQueue

    describe('happy path', () => {
      it('should use narrow range (+/-5) for recently queued agents', () => {
        // Agent just joined (0-30 seconds)
        const now = new Date();
        const agent = { id: 'agent-1', level: 10 };

        mockStatement.get
          .mockReturnValueOnce(null) // Not in queue
          .mockReturnValueOnce(null) // Not in active battle
          .mockReturnValueOnce({ // Queue position
            agent_id: 'agent-1',
            level: 10,
            joined_at: now.toISOString()
          });

        joinQueue(mockDb, agent);

        // When finding match, should use level range of 5
        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-1',
          level: 10,
          joined_at: now.toISOString()
        });

        findMatch(mockDb, 'agent-1');

        // Verify the SQL query uses level range (5-15 for level 10)
        const prepareCalls = mockDb.prepare.mock.calls;
        const matchQuery = prepareCalls.find(call =>
          call[0].includes('level >=') && call[0].includes('level <=')
        );
        expect(matchQuery).toBeDefined();
      });
    });
  });

  // ===========================================================================
  // joinQueue Tests
  // ===========================================================================
  describe('joinQueue', () => {
    describe('happy path', () => {
      it('should add agent to queue and return queued status', () => {
        const agent = { id: 'agent-123', level: 5 };

        mockStatement.get
          .mockReturnValueOnce(null) // Not already in queue
          .mockReturnValueOnce(null); // Not in active battle

        mockStatement.get.mockReturnValueOnce({ pos: 3 }); // Queue position

        const result = joinQueue(mockDb, agent);

        expect(result.status).toBe('queued');
        expect(result.queuePosition).toBe(3);
        expect(mockStatement.run).toHaveBeenCalled();
      });

      it('should use agent level when adding to queue', () => {
        const agent = { id: 'agent-123', level: 25 };

        mockStatement.get
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(null);
        mockStatement.get.mockReturnValueOnce({ pos: 1 });

        joinQueue(mockDb, agent);

        // Verify INSERT includes level
        const insertCall = mockStatement.run.mock.calls.find(call =>
          call.length === 2 && call[0] === 'agent-123' && call[1] === 25
        );
        expect(insertCall).toBeDefined();
      });

      it('should default to level 1 if agent has no level', () => {
        const agent = { id: 'agent-123' };

        mockStatement.get
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(null);
        mockStatement.get.mockReturnValueOnce({ pos: 1 });

        joinQueue(mockDb, agent);

        const insertCall = mockStatement.run.mock.calls.find(call =>
          call.length === 2 && call[0] === 'agent-123' && call[1] === 1
        );
        expect(insertCall).toBeDefined();
      });

      it('should ensure queue schema before operations', () => {
        const agent = { id: 'agent-123', level: 5 };

        mockStatement.get
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(null);
        mockStatement.get.mockReturnValueOnce({ pos: 1 });

        joinQueue(mockDb, agent);

        // Should attempt to add level column (will fail silently if exists)
        expect(mockDb.exec).toHaveBeenCalled();
      });
    });

    describe('edge cases', () => {
      it('should return already_queued if agent is already in queue', () => {
        const agent = { id: 'agent-123', level: 5 };

        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-123',
          joined_at: new Date().toISOString()
        });
        mockStatement.get.mockReturnValueOnce({ pos: 2 });

        const result = joinQueue(mockDb, agent);

        expect(result.status).toBe('already_queued');
        expect(result.queuePosition).toBe(2);
      });

      it('should return already_in_battle if agent has active battle', () => {
        const agent = { id: 'agent-123', level: 5 };

        mockStatement.get
          .mockReturnValueOnce(null) // Not in queue
          .mockReturnValueOnce({ id: 'battle-456' }); // Has active battle

        const result = joinQueue(mockDb, agent);

        expect(result.status).toBe('already_in_battle');
        expect(result.battleId).toBe('battle-456');
      });

      it('should return rate_limited if fight limit exceeded', () => {
        const agent = { id: 'agent-123', level: 5 };

        getFightLimitInfo.mockReturnValue({
          allowed: false,
          remaining: 0,
          limit: 6,
          period: 'day',
          tier: 'free',
          reason: 'Daily fight limit reached'
        });

        const result = joinQueue(mockDb, agent);

        expect(result.status).toBe('rate_limited');
        expect(result.reason).toBe('Daily fight limit reached');
        expect(result.tier).toBe('free');
      });

      it('should handle rate limit info with remaining fights', () => {
        const agent = { id: 'agent-123', level: 5 };

        getFightLimitInfo.mockReturnValue({
          allowed: false,
          remaining: 0,
          limit: 1,
          period: 'hour',
          tier: 'trial',
          reason: 'Hourly limit reached',
          remaining: 0
        });

        const result = joinQueue(mockDb, agent);

        expect(result.status).toBe('rate_limited');
        expect(result.remaining).toBe(0);
      });
    });

    describe('error cases', () => {
      it('should handle database errors gracefully', () => {
        const agent = { id: 'agent-123', level: 5 };

        mockDb.exec.mockImplementation(() => {
          throw new Error('Column already exists');
        });

        mockStatement.get
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(null);
        mockStatement.get.mockReturnValueOnce({ pos: 1 });

        // Should not throw, column error is expected
        const result = joinQueue(mockDb, agent);
        expect(result.status).toBe('queued');
      });
    });
  });

  // ===========================================================================
  // leaveQueue Tests
  // ===========================================================================
  describe('leaveQueue', () => {
    describe('happy path', () => {
      it('should remove agent from queue and return removed status', () => {
        mockStatement.run.mockReturnValue({ changes: 1 });

        const result = leaveQueue(mockDb, 'agent-123');

        expect(result.status).toBe('removed');
        expect(mockDb.prepare).toHaveBeenCalledWith(
          'DELETE FROM battle_queue WHERE agent_id = ?'
        );
        expect(mockStatement.run).toHaveBeenCalledWith('agent-123');
      });
    });

    describe('edge cases', () => {
      it('should return not_in_queue if agent was not in queue', () => {
        mockStatement.run.mockReturnValue({ changes: 0 });

        const result = leaveQueue(mockDb, 'agent-123');

        expect(result.status).toBe('not_in_queue');
      });

      it('should handle removing non-existent agent', () => {
        mockStatement.run.mockReturnValue({ changes: 0 });

        const result = leaveQueue(mockDb, 'nonexistent-agent');

        expect(result.status).toBe('not_in_queue');
      });
    });
  });

  // ===========================================================================
  // findMatch Tests
  // ===========================================================================
  describe('findMatch', () => {
    describe('happy path', () => {
      it('should find opponent within level range', () => {
        const now = new Date();

        // Agent's queue entry
        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-1',
          level: 10,
          joined_at: now.toISOString()
        });

        // Opponent found
        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-2',
          level: 12,
          joined_at: now.toISOString()
        });

        const result = findMatch(mockDb, 'agent-1');

        expect(result).not.toBeNull();
        expect(result.agent_id).toBe('agent-2');
      });

      it('should prefer closest level opponent', () => {
        const now = new Date();

        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-1',
          level: 10,
          joined_at: now.toISOString()
        });

        // Returns closest level opponent
        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-2',
          level: 11, // Only 1 level difference
          joined_at: now.toISOString()
        });

        const result = findMatch(mockDb, 'agent-1');

        expect(result.level).toBe(11);
      });

      it('should use Infinity range for long-waiting agents (90+ seconds)', () => {
        const oldTime = new Date(Date.now() - 100000); // 100 seconds ago

        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-1',
          level: 10,
          joined_at: oldTime.toISOString()
        });

        // Any level opponent can be matched
        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-2',
          level: 50,
          joined_at: new Date().toISOString()
        });

        const result = findMatch(mockDb, 'agent-1');

        expect(result).not.toBeNull();
        // Verify infinite range query was used (no level constraints)
        const queryCalls = mockDb.prepare.mock.calls;
        const infiniteRangeQuery = queryCalls.find(call =>
          call[0].includes('ORDER BY ABS(level') && !call[0].includes('level >=')
        );
        expect(infiniteRangeQuery).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('should return null if agent not in queue', () => {
        mockStatement.get.mockReturnValueOnce(null);

        const result = findMatch(mockDb, 'agent-1');

        expect(result).toBeNull();
      });

      it('should return null if no suitable opponent found', () => {
        const now = new Date();

        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-1',
          level: 10,
          joined_at: now.toISOString()
        });

        // No opponent found
        mockStatement.get.mockReturnValueOnce(null);

        const result = findMatch(mockDb, 'agent-1');

        expect(result).toBeNull();
      });

      it('should handle agent with undefined level (defaults to 1)', () => {
        const now = new Date();

        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-1',
          // level is undefined
          joined_at: now.toISOString()
        });

        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-2',
          level: 3,
          joined_at: now.toISOString()
        });

        const result = findMatch(mockDb, 'agent-1');

        expect(result).not.toBeNull();
      });

      it('should use medium range (10) for 30-60 second wait', () => {
        const thirtySecondsAgo = new Date(Date.now() - 45000); // 45 seconds

        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-1',
          level: 20,
          joined_at: thirtySecondsAgo.toISOString()
        });

        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-2',
          level: 28,
          joined_at: new Date().toISOString()
        });

        const result = findMatch(mockDb, 'agent-1');

        // Level 28 is within +/-10 of level 20
        expect(result).not.toBeNull();
      });

      it('should use wide range (20) for 60-90 second wait', () => {
        const sixtySecondsAgo = new Date(Date.now() - 75000); // 75 seconds

        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-1',
          level: 30,
          joined_at: sixtySecondsAgo.toISOString()
        });

        mockStatement.get.mockReturnValueOnce({
          agent_id: 'agent-2',
          level: 48,
          joined_at: new Date().toISOString()
        });

        const result = findMatch(mockDb, 'agent-1');

        // Level 48 is within +/-20 of level 30
        expect(result).not.toBeNull();
      });
    });
  });

  // ===========================================================================
  // processQueue Tests
  // ===========================================================================
  describe('processQueue', () => {
    describe('happy path', () => {
      it('should match pairs of agents and remove from queue', () => {
        const now = new Date();

        mockStatement.all.mockReturnValueOnce([
          { agent_id: 'agent-1', level: 10, joined_at: now.toISOString() },
          { agent_id: 'agent-2', level: 12, joined_at: now.toISOString() }
        ]);

        const result = processQueue(mockDb);

        expect(result).toHaveLength(1);
        expect(result[0].agentA).toBe('agent-1');
        expect(result[0].agentB).toBe('agent-2');

        // Should remove both from queue
        expect(mockStatement.run).toHaveBeenCalledWith('agent-1');
        expect(mockStatement.run).toHaveBeenCalledWith('agent-2');

        // Should record fights
        expect(recordFight).toHaveBeenCalledWith('agent-1');
        expect(recordFight).toHaveBeenCalledWith('agent-2');
      });

      it('should match multiple pairs in a single process', () => {
        const now = new Date();

        mockStatement.all.mockReturnValueOnce([
          { agent_id: 'agent-1', level: 10, joined_at: now.toISOString() },
          { agent_id: 'agent-2', level: 10, joined_at: now.toISOString() },
          { agent_id: 'agent-3', level: 20, joined_at: now.toISOString() },
          { agent_id: 'agent-4', level: 22, joined_at: now.toISOString() }
        ]);

        const result = processQueue(mockDb);

        expect(result).toHaveLength(2);
      });

      it('should calculate level difference for matched pairs', () => {
        const now = new Date();

        mockStatement.all.mockReturnValueOnce([
          { agent_id: 'agent-1', level: 10, joined_at: now.toISOString() },
          { agent_id: 'agent-2', level: 15, joined_at: now.toISOString() }
        ]);

        const result = processQueue(mockDb);

        expect(result[0].levelDiff).toBe(5);
      });

      it('should prefer closer level matches', () => {
        const now = new Date();

        mockStatement.all.mockReturnValueOnce([
          { agent_id: 'agent-1', level: 10, joined_at: now.toISOString() },
          { agent_id: 'agent-2', level: 11, joined_at: now.toISOString() }, // Closest
          { agent_id: 'agent-3', level: 14, joined_at: now.toISOString() }
        ]);

        const result = processQueue(mockDb);

        // Agent 1 should match with agent 2 (closest level)
        expect(result[0].agentA).toBe('agent-1');
        expect(result[0].agentB).toBe('agent-2');
        // Agent 3 has no match
        expect(result).toHaveLength(1);
      });
    });

    describe('edge cases', () => {
      it('should return empty array if queue has less than 2 agents', () => {
        mockStatement.all.mockReturnValueOnce([
          { agent_id: 'agent-1', level: 10, joined_at: new Date().toISOString() }
        ]);

        const result = processQueue(mockDb);

        expect(result).toEqual([]);
      });

      it('should return empty array if queue is empty', () => {
        mockStatement.all.mockReturnValueOnce([]);

        const result = processQueue(mockDb);

        expect(result).toEqual([]);
      });

      it('should not match agent with themselves', () => {
        const now = new Date();

        mockStatement.all.mockReturnValueOnce([
          { agent_id: 'agent-1', level: 10, joined_at: now.toISOString() }
        ]);

        const result = processQueue(mockDb);

        expect(result).toEqual([]);
      });

      it('should skip agents already matched in this processing round', () => {
        const now = new Date();

        mockStatement.all.mockReturnValueOnce([
          { agent_id: 'agent-1', level: 10, joined_at: now.toISOString() },
          { agent_id: 'agent-2', level: 10, joined_at: now.toISOString() },
          { agent_id: 'agent-3', level: 10, joined_at: now.toISOString() }
        ]);

        const result = processQueue(mockDb);

        // Only one match (agent-1 + agent-2), agent-3 is left unmatched
        expect(result).toHaveLength(1);
      });

      it('should respect level range constraints based on wait time', () => {
        const now = new Date();

        mockStatement.all.mockReturnValueOnce([
          { agent_id: 'agent-1', level: 10, joined_at: now.toISOString() },
          { agent_id: 'agent-2', level: 50, joined_at: now.toISOString() } // 40 levels apart
        ]);

        const result = processQueue(mockDb);

        // New agents (0-30s wait) have +/-5 level range
        // 40 level difference exceeds range
        expect(result).toEqual([]);
      });

      it('should expand range for long-waiting agents', () => {
        const longAgo = new Date(Date.now() - 100000); // 100 seconds ago

        mockStatement.all.mockReturnValueOnce([
          { agent_id: 'agent-1', level: 10, joined_at: longAgo.toISOString() },
          { agent_id: 'agent-2', level: 50, joined_at: longAgo.toISOString() }
        ]);

        const result = processQueue(mockDb);

        // Long-waiting agents have Infinity range
        expect(result).toHaveLength(1);
      });

      it('should handle undefined levels by defaulting to 1', () => {
        const now = new Date();

        mockStatement.all.mockReturnValueOnce([
          { agent_id: 'agent-1', joined_at: now.toISOString() }, // No level
          { agent_id: 'agent-2', level: 3, joined_at: now.toISOString() }
        ]);

        const result = processQueue(mockDb);

        // Should match (level 1 with level 3 is within +/-5 range)
        expect(result).toHaveLength(1);
        expect(result[0].levelDiff).toBe(2); // abs(1 - 3)
      });
    });
  });

  // ===========================================================================
  // completeBattle Tests
  // ===========================================================================
  describe('completeBattle', () => {
    describe('happy path', () => {
      it('should award XP to winner and loser', () => {
        const winner = { id: 'winner-123', level: 10, xp: 500 };
        const loser = { id: 'loser-456', level: 10, xp: 300 };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser);

        calculateScaledXP.mockReturnValue({
          winXP: 150,
          lossXP: 30,
          scaleFactor: 1.0,
          levelDiff: 0
        });

        const result = completeBattle(mockDb, 'battle-789', 'winner-123', 'loser-456');

        expect(result.winnerXP).toBe(150);
        expect(result.loserXP).toBe(30);

        // Verify XP was updated in database
        const updateCalls = mockStatement.run.mock.calls;
        expect(updateCalls.some(call => call[0] === 650)).toBe(true); // 500 + 150
        expect(updateCalls.some(call => call[0] === 330)).toBe(true); // 300 + 30
      });

      it('should check for level-ups after XP award', () => {
        const winner = { id: 'winner-123', level: 10, xp: 500 };
        const loser = { id: 'loser-456', level: 10, xp: 300 };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser);

        checkLevelUp.mockReturnValue({ leveled: true, oldLevel: 10, newLevel: 11 });

        const result = completeBattle(mockDb, 'battle-789', 'winner-123', 'loser-456');

        expect(result.winnerLevelUp).toEqual({ leveled: true, oldLevel: 10, newLevel: 11 });
        expect(checkLevelUp).toHaveBeenCalledTimes(2);
      });

      it('should return scale factor and level diff', () => {
        const winner = { id: 'winner-123', level: 20, xp: 1000 };
        const loser = { id: 'loser-456', level: 10, xp: 500 };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser);

        calculateScaledXP.mockReturnValue({
          winXP: 70,
          lossXP: 30,
          scaleFactor: 0.7,
          levelDiff: 10
        });

        const result = completeBattle(mockDb, 'battle-789', 'winner-123', 'loser-456');

        expect(result.scaleFactor).toBe(0.7);
        expect(result.levelDiff).toBe(10);
      });
    });

    describe('edge cases', () => {
      it('should handle agents with no existing XP', () => {
        const winner = { id: 'winner-123', level: 1 }; // No xp field
        const loser = { id: 'loser-456', level: 1 };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser);

        calculateScaledXP.mockReturnValue({
          winXP: 100,
          lossXP: 25,
          scaleFactor: 1.0,
          levelDiff: 0
        });

        const result = completeBattle(mockDb, 'battle-789', 'winner-123', 'loser-456');

        expect(result.winnerXP).toBe(100);
        // Winner should have 0 + 100 = 100 XP
        const updateCalls = mockStatement.run.mock.calls;
        expect(updateCalls.some(call => call[0] === 100)).toBe(true);
      });

      it('should handle agents with undefined level (defaults to 1)', () => {
        const winner = { id: 'winner-123', xp: 0 }; // No level field
        const loser = { id: 'loser-456', xp: 0 };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser);

        const result = completeBattle(mockDb, 'battle-789', 'winner-123', 'loser-456');

        expect(calculateScaledXP).toHaveBeenCalledWith(1, 1);
        expect(result).toBeDefined();
      });

      it('should update battle record with XP info (non-critical)', () => {
        const winner = { id: 'winner-123', level: 10, xp: 500 };
        const loser = { id: 'loser-456', level: 10, xp: 300 };

        mockStatement.get
          .mockReturnValueOnce(winner)
          .mockReturnValueOnce(loser);

        // Simulate battle record update failing (non-critical)
        mockStatement.run.mockImplementationOnce(() => ({ changes: 1 }))
          .mockImplementationOnce(() => ({ changes: 1 }))
          .mockImplementationOnce(() => { throw new Error('Update failed'); });

        // Should not throw - battle record update is non-critical
        expect(() => {
          completeBattle(mockDb, 'battle-789', 'winner-123', 'loser-456');
        }).not.toThrow();
      });
    });

    describe('error cases', () => {
      it('should throw error if winner not found', () => {
        mockStatement.get
          .mockReturnValueOnce(null) // Winner not found
          .mockReturnValueOnce({ id: 'loser-456', level: 10, xp: 300 });

        expect(() => {
          completeBattle(mockDb, 'battle-789', 'winner-123', 'loser-456');
        }).toThrow('Winner or loser agent not found');
      });

      it('should throw error if loser not found', () => {
        mockStatement.get
          .mockReturnValueOnce({ id: 'winner-123', level: 10, xp: 500 })
          .mockReturnValueOnce(null); // Loser not found

        expect(() => {
          completeBattle(mockDb, 'battle-789', 'winner-123', 'loser-456');
        }).toThrow('Winner or loser agent not found');
      });

      it('should throw error if both agents not found', () => {
        mockStatement.get
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(null);

        expect(() => {
          completeBattle(mockDb, 'battle-789', 'winner-123', 'loser-456');
        }).toThrow('Winner or loser agent not found');
      });
    });
  });

  // ===========================================================================
  // getQueueStats Tests
  // ===========================================================================
  describe('getQueueStats', () => {
    describe('happy path', () => {
      it('should return queue statistics', () => {
        mockStatement.get
          .mockReturnValueOnce({
            size: 10,
            avgLevel: 25.5,
            minLevel: 5,
            maxLevel: 50
          })
          .mockReturnValueOnce({
            avgWaitSeconds: 45,
            maxWaitSeconds: 120
          });

        const result = getQueueStats(mockDb);

        expect(result.size).toBe(10);
        expect(result.avgLevel).toBe(25.5);
        expect(result.minLevel).toBe(5);
        expect(result.maxLevel).toBe(50);
        expect(result.avgWaitSeconds).toBe(45);
        expect(result.maxWaitSeconds).toBe(120);
      });

      it('should round average level to one decimal place', () => {
        mockStatement.get
          .mockReturnValueOnce({
            size: 5,
            avgLevel: 22.3333,
            minLevel: 10,
            maxLevel: 35
          })
          .mockReturnValueOnce({
            avgWaitSeconds: 30,
            maxWaitSeconds: 60
          });

        const result = getQueueStats(mockDb);

        expect(result.avgLevel).toBe(22.3);
      });

      it('should round wait times to integers', () => {
        mockStatement.get
          .mockReturnValueOnce({
            size: 3,
            avgLevel: 15,
            minLevel: 10,
            maxLevel: 20
          })
          .mockReturnValueOnce({
            avgWaitSeconds: 33.7,
            maxWaitSeconds: 89.2
          });

        const result = getQueueStats(mockDb);

        expect(result.avgWaitSeconds).toBe(34);
        expect(result.maxWaitSeconds).toBe(89);
      });
    });

    describe('edge cases', () => {
      it('should handle empty queue', () => {
        mockStatement.get
          .mockReturnValueOnce({
            size: 0,
            avgLevel: 0,
            minLevel: 0,
            maxLevel: 0
          })
          .mockReturnValueOnce({
            avgWaitSeconds: 0,
            maxWaitSeconds: 0
          });

        const result = getQueueStats(mockDb);

        expect(result.size).toBe(0);
        expect(result.avgLevel).toBe(0);
        expect(result.avgWaitSeconds).toBe(0);
      });

      it('should handle single agent in queue', () => {
        mockStatement.get
          .mockReturnValueOnce({
            size: 1,
            avgLevel: 42,
            minLevel: 42,
            maxLevel: 42
          })
          .mockReturnValueOnce({
            avgWaitSeconds: 15,
            maxWaitSeconds: 15
          });

        const result = getQueueStats(mockDb);

        expect(result.size).toBe(1);
        expect(result.minLevel).toBe(result.maxLevel);
        expect(result.avgWaitSeconds).toBe(result.maxWaitSeconds);
      });

      it('should ensure queue schema before getting stats', () => {
        mockStatement.get
          .mockReturnValueOnce({
            size: 0,
            avgLevel: 0,
            minLevel: 0,
            maxLevel: 0
          })
          .mockReturnValueOnce({
            avgWaitSeconds: 0,
            maxWaitSeconds: 0
          });

        getQueueStats(mockDb);

        expect(mockDb.exec).toHaveBeenCalled();
      });
    });
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================
  describe('integration', () => {
    it('should handle full queue-match-battle flow', () => {
      const now = new Date();

      // 1. Agents join queue
      const agent1 = { id: 'agent-1', level: 10 };
      const agent2 = { id: 'agent-2', level: 12 };

      // Mock for joinQueue
      mockStatement.get
        .mockReturnValueOnce(null) // agent1 not in queue
        .mockReturnValueOnce(null) // agent1 not in battle
        .mockReturnValueOnce({ pos: 1 }) // queue position
        .mockReturnValueOnce(null) // agent2 not in queue
        .mockReturnValueOnce(null) // agent2 not in battle
        .mockReturnValueOnce({ pos: 2 }); // queue position

      const join1 = joinQueue(mockDb, agent1);
      const join2 = joinQueue(mockDb, agent2);

      expect(join1.status).toBe('queued');
      expect(join2.status).toBe('queued');

      // 2. Process queue creates match
      mockStatement.all.mockReturnValueOnce([
        { agent_id: 'agent-1', level: 10, joined_at: now.toISOString() },
        { agent_id: 'agent-2', level: 12, joined_at: now.toISOString() }
      ]);

      const matches = processQueue(mockDb);

      expect(matches).toHaveLength(1);
      expect(matches[0].agentA).toBe('agent-1');
      expect(matches[0].agentB).toBe('agent-2');

      // 3. Complete battle
      mockStatement.get
        .mockReturnValueOnce({ id: 'agent-1', level: 10, xp: 500 })
        .mockReturnValueOnce({ id: 'agent-2', level: 12, xp: 600 });

      const battleResult = completeBattle(mockDb, 'battle-123', 'agent-1', 'agent-2');

      expect(battleResult.winnerXP).toBeGreaterThan(0);
      expect(battleResult.loserXP).toBeGreaterThan(0);
    });

    it('should respect rate limits throughout the flow', () => {
      const agent = { id: 'agent-123', level: 5 };

      // First join succeeds
      getFightLimitInfo.mockReturnValueOnce({
        allowed: true,
        remaining: 1,
        limit: 6,
        period: 'day',
        tier: 'free'
      });

      mockStatement.get
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null);
      mockStatement.get.mockReturnValueOnce({ pos: 1 });

      const firstJoin = joinQueue(mockDb, agent);
      expect(firstJoin.status).toBe('queued');

      // Simulate leaving queue
      mockStatement.run.mockReturnValueOnce({ changes: 1 });
      leaveQueue(mockDb, 'agent-123');

      // Second join blocked by rate limit
      getFightLimitInfo.mockReturnValueOnce({
        allowed: false,
        remaining: 0,
        limit: 6,
        period: 'day',
        tier: 'free',
        reason: 'Daily limit reached'
      });

      const secondJoin = joinQueue(mockDb, agent);
      expect(secondJoin.status).toBe('rate_limited');
    });
  });
});
