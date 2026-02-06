'use strict';

/**
 * ELO System Tests
 *
 * Tests for the ClawCombat ELO rating calculation system including:
 * - expectedScore: Probability calculations based on rating differences
 * - getKFactor: Dynamic K-factor based on games played and ELO
 * - calculateEloChange: Win/loss rating adjustments with floor protection
 */

const { expectedScore, getKFactor, calculateEloChange } = require('../utils/elo');

describe('ELO System', () => {
  // ===========================================================================
  // expectedScore Tests
  // ===========================================================================
  describe('expectedScore', () => {
    describe('happy path', () => {
      it('should return 0.5 for equally rated players', () => {
        const score = expectedScore(1000, 1000);
        expect(score).toBeCloseTo(0.5, 5);
      });

      it('should return higher expected score for higher rated player', () => {
        const scoreA = expectedScore(1200, 1000); // A is higher rated
        const scoreB = expectedScore(1000, 1200); // B is higher rated

        expect(scoreA).toBeGreaterThan(0.5);
        expect(scoreB).toBeLessThan(0.5);
      });

      it('should return approximately 0.76 for 200 point advantage', () => {
        // 200 point advantage gives ~0.76 expected score
        const score = expectedScore(1200, 1000);
        expect(score).toBeCloseTo(0.76, 1);
      });

      it('should return approximately 0.91 for 400 point advantage', () => {
        // 400 point advantage gives ~0.91 expected score
        const score = expectedScore(1400, 1000);
        expect(score).toBeCloseTo(0.91, 1);
      });

      it('should return expected scores that sum to 1 for both players', () => {
        const scoreA = expectedScore(1200, 1000);
        const scoreB = expectedScore(1000, 1200);

        expect(scoreA + scoreB).toBeCloseTo(1.0, 5);
      });

      it('should work with high ELO values', () => {
        const score = expectedScore(2500, 2300);
        expect(score).toBeGreaterThan(0.5);
        expect(score).toBeLessThan(1.0);
      });

      it('should work with low ELO values', () => {
        const score = expectedScore(200, 100);
        expect(score).toBeGreaterThan(0.5);
        expect(score).toBeLessThan(1.0);
      });
    });

    describe('edge cases', () => {
      it('should handle very large rating differences', () => {
        // 1000 point difference
        const score = expectedScore(2000, 1000);
        expect(score).toBeGreaterThan(0.99);
        expect(score).toBeLessThan(1.0);
      });

      it('should handle zero ratings', () => {
        const score = expectedScore(0, 0);
        expect(score).toBeCloseTo(0.5, 5);
      });

      it('should handle one zero rating', () => {
        const score = expectedScore(1000, 0);
        expect(score).toBeGreaterThan(0.5);
      });

      it('should be symmetric', () => {
        const scoreA = expectedScore(1500, 1200);
        const scoreB = expectedScore(1200, 1500);

        // scoreA + scoreB should equal 1
        expect(scoreA + scoreB).toBeCloseTo(1.0, 10);
      });

      it('should handle identical high ratings', () => {
        const score = expectedScore(3000, 3000);
        expect(score).toBeCloseTo(0.5, 5);
      });
    });

    describe('error cases', () => {
      // Note: The function doesn't explicitly throw errors for invalid inputs
      // These tests verify behavior with unusual inputs

      it('should handle negative ratings without crashing', () => {
        const score = expectedScore(-100, 100);
        expect(typeof score).toBe('number');
        expect(score).toBeLessThan(0.5);
      });

      it('should handle NaN gracefully', () => {
        const score = expectedScore(NaN, 1000);
        expect(Number.isNaN(score)).toBe(true);
      });
    });
  });

  // ===========================================================================
  // getKFactor Tests
  // ===========================================================================
  describe('getKFactor', () => {
    describe('happy path', () => {
      it('should return K=40 for new players (<30 games)', () => {
        const agent = { total_wins: 10, total_fights: 15, elo: 1000 };
        expect(getKFactor(agent)).toBe(40);
      });

      it('should return K=40 for players with exactly 29 total battles', () => {
        const agent = { total_wins: 15, total_fights: 14, elo: 1000 };
        expect(getKFactor(agent)).toBe(40);
      });

      it('should return K=32 for established players (30+ games, <2000 ELO)', () => {
        const agent = { total_wins: 20, total_fights: 20, elo: 1500 };
        expect(getKFactor(agent)).toBe(32);
      });

      it('should return K=24 for high ELO players (>2000 ELO)', () => {
        const agent = { total_wins: 100, total_fights: 100, elo: 2100 };
        expect(getKFactor(agent)).toBe(24);
      });

      it('should prioritize game count over ELO for new players', () => {
        // High ELO but few games should still get K=40
        const agent = { total_wins: 10, total_fights: 10, elo: 2500 };
        expect(getKFactor(agent)).toBe(40);
      });
    });

    describe('edge cases', () => {
      it('should handle exactly 30 total battles', () => {
        const agent = { total_wins: 15, total_fights: 15, elo: 1500 };
        expect(getKFactor(agent)).toBe(32);
      });

      it('should handle exactly 2000 ELO with 30+ games', () => {
        const agent = { total_wins: 20, total_fights: 20, elo: 2000 };
        // ELO > 2000 check, so exactly 2000 gets K=32
        expect(getKFactor(agent)).toBe(32);
      });

      it('should handle exactly 2001 ELO', () => {
        const agent = { total_wins: 20, total_fights: 20, elo: 2001 };
        expect(getKFactor(agent)).toBe(24);
      });

      it('should handle 0 games played', () => {
        const agent = { total_wins: 0, total_fights: 0, elo: 1000 };
        expect(getKFactor(agent)).toBe(40);
      });

      it('should handle missing total_wins field', () => {
        const agent = { total_fights: 50, elo: 1500 };
        // Should use 0 as default for missing field
        expect(getKFactor(agent)).toBe(32);
      });

      it('should handle missing total_fights field', () => {
        const agent = { total_wins: 50, elo: 1500 };
        // Should use 0 as default for missing field
        expect(getKFactor(agent)).toBe(32);
      });

      it('should handle missing elo field (defaults to 1000)', () => {
        const agent = { total_wins: 20, total_fights: 20 };
        expect(getKFactor(agent)).toBe(32);
      });

      it('should handle very high ELO', () => {
        const agent = { total_wins: 500, total_fights: 500, elo: 3000 };
        expect(getKFactor(agent)).toBe(24);
      });

      it('should handle very low ELO with many games', () => {
        const agent = { total_wins: 50, total_fights: 100, elo: 500 };
        expect(getKFactor(agent)).toBe(32);
      });
    });

    describe('error cases', () => {
      it('should handle empty object', () => {
        const agent = {};
        // Should default to new player K-factor
        expect(getKFactor(agent)).toBe(40);
      });

      it('should handle null/undefined fields', () => {
        const agent = { total_wins: null, total_fights: undefined, elo: null };
        expect(getKFactor(agent)).toBe(40);
      });
    });
  });

  // ===========================================================================
  // calculateEloChange Tests
  // ===========================================================================
  describe('calculateEloChange', () => {
    describe('happy path', () => {
      it('should increase winner ELO and decrease loser ELO', () => {
        const winner = { elo: 1000, total_wins: 50, total_fights: 50 };
        const loser = { elo: 1000, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        expect(result.winnerNew).toBeGreaterThan(1000);
        expect(result.loserNew).toBeLessThan(1000);
        expect(result.winnerDelta).toBeGreaterThan(0);
        expect(result.loserDelta).toBeLessThan(0);
      });

      it('should give equal points for equally rated established players', () => {
        const winner = { elo: 1000, total_wins: 50, total_fights: 50 };
        const loser = { elo: 1000, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        // K=32, expected=0.5, so delta = 32 * (1 - 0.5) = 16
        expect(result.winnerDelta).toBe(16);
        expect(result.loserDelta).toBe(-16);
      });

      it('should give more points for upset win (lower rated beats higher)', () => {
        const winner = { elo: 1000, total_wins: 50, total_fights: 50 };
        const loser = { elo: 1400, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        // Winner should gain more than 16 points for upset
        expect(result.winnerDelta).toBeGreaterThan(16);
      });

      it('should give fewer points for expected win (higher rated beats lower)', () => {
        const winner = { elo: 1400, total_wins: 50, total_fights: 50 };
        const loser = { elo: 1000, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        // Winner should gain less than 16 points for expected result
        expect(result.winnerDelta).toBeLessThan(16);
      });

      it('should use different K-factors for players at different experience levels', () => {
        const newWinner = { elo: 1000, total_wins: 5, total_fights: 5 };
        const establishedLoser = { elo: 1000, total_wins: 100, total_fights: 100 };

        const result = calculateEloChange(newWinner, establishedLoser);

        // New player (K=40) vs established (K=32)
        // New player gains: 40 * 0.5 = 20
        // Established loses: 32 * 0.5 = 16
        expect(result.winnerDelta).toBe(20);
        expect(result.loserDelta).toBe(-16);
      });

      it('should use K=24 for high ELO players', () => {
        const winner = { elo: 2100, total_wins: 200, total_fights: 200 };
        const loser = { elo: 2100, total_wins: 200, total_fights: 200 };

        const result = calculateEloChange(winner, loser);

        // K=24, expected=0.5, so delta = 24 * 0.5 = 12
        expect(result.winnerDelta).toBe(12);
        expect(result.loserDelta).toBe(-12);
      });
    });

    describe('edge cases', () => {
      it('should enforce ELO floor of 100 for loser', () => {
        const winner = { elo: 500, total_wins: 50, total_fights: 50 };
        const loser = { elo: 110, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        // Loser should not go below 100
        expect(result.loserNew).toBeGreaterThanOrEqual(100);
      });

      it('should enforce ELO floor when loser is at minimum', () => {
        const winner = { elo: 500, total_wins: 50, total_fights: 50 };
        const loser = { elo: 100, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        expect(result.loserNew).toBe(100);
        expect(result.loserDelta).toBe(0);
      });

      it('should handle missing ELO (defaults to 1000)', () => {
        const winner = { total_wins: 50, total_fights: 50 };
        const loser = { total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        expect(result.winnerNew).toBe(1016);
        expect(result.loserNew).toBe(984);
      });

      it('should handle very large ELO differences', () => {
        const winner = { elo: 100, total_wins: 50, total_fights: 50 };
        const loser = { elo: 2500, total_wins: 200, total_fights: 200 }; // High ELO uses K=24

        const result = calculateEloChange(winner, loser);

        // Massive upset - winner should gain close to K points (K=32 for established player)
        expect(result.winnerDelta).toBeGreaterThan(30);
        // Loser (high ELO with K=24) loses based on expected score
        // With huge rating advantage, expected win is ~1.0, so loss = K * (0 - ~1.0) = ~-K
        // This is actually a significant loss for the heavily favored player
        expect(result.loserDelta).toBeLessThan(0);
        // Verify it's a reasonable loss amount for the K-factor used
        expect(Math.abs(result.loserDelta)).toBeLessThanOrEqual(24); // K=24 for high ELO
      });

      it('should handle both players at ELO floor', () => {
        const winner = { elo: 100, total_wins: 50, total_fights: 50 };
        const loser = { elo: 100, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        expect(result.winnerNew).toBe(116);
        // Loser stays at floor
        expect(result.loserNew).toBe(100);
      });

      it('should round ELO values to integers', () => {
        const winner = { elo: 1000, total_wins: 50, total_fights: 50 };
        const loser = { elo: 1050, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        expect(Number.isInteger(result.winnerNew)).toBe(true);
        expect(Number.isInteger(result.loserNew)).toBe(true);
        expect(Number.isInteger(result.winnerDelta)).toBe(true);
        expect(Number.isInteger(result.loserDelta)).toBe(true);
      });

      it('should handle winner with 0 ELO explicitly set', () => {
        const winner = { elo: 0, total_wins: 50, total_fights: 50 };
        const loser = { elo: 1000, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        // Even starting from 0, winner should gain ELO
        expect(result.winnerNew).toBeGreaterThan(0);
      });
    });

    describe('error cases', () => {
      it('should handle empty objects', () => {
        const winner = {};
        const loser = {};

        const result = calculateEloChange(winner, loser);

        // Should use defaults (ELO 1000, K=40)
        expect(result.winnerNew).toBe(1020);
        expect(result.loserNew).toBe(980);
      });

      it('should handle null ELO values', () => {
        const winner = { elo: null, total_wins: 50, total_fights: 50 };
        const loser = { elo: null, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);

        // Should use default ELO of 1000
        expect(result.winnerNew).toBe(1016);
        expect(result.loserNew).toBe(984);
      });
    });
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================
  describe('integration', () => {
    it('should maintain total ELO in the system (conservation)', () => {
      // When two players fight, the total ELO change should be 0
      // (ignoring floor effects)
      const winner = { elo: 1500, total_wins: 100, total_fights: 100 };
      const loser = { elo: 1500, total_wins: 100, total_fights: 100 };

      const result = calculateEloChange(winner, loser);

      // Total change should be 0
      expect(result.winnerDelta + result.loserDelta).toBe(0);
    });

    it('should produce sensible ELO progression over multiple games', () => {
      // Simulate a player winning 10 games against equal opponents
      let player = { elo: 1000, total_wins: 0, total_fights: 0 };

      for (let i = 0; i < 10; i++) {
        const opponent = { elo: 1000, total_wins: 50, total_fights: 50 };
        const result = calculateEloChange(player, opponent);

        player = {
          elo: result.winnerNew,
          total_wins: player.total_wins + 1,
          total_fights: player.total_fights + 1
        };
      }

      // After 10 wins against 1000-rated opponents, should be significantly higher
      expect(player.elo).toBeGreaterThan(1100);
      expect(player.elo).toBeLessThan(1300); // But not unreasonably high
    });

    it('should produce diminishing returns as rating gap increases', () => {
      const results = [];

      // Test wins against progressively weaker opponents
      const ratings = [1000, 900, 800, 700, 600];

      for (const opponentRating of ratings) {
        const winner = { elo: 1000, total_wins: 50, total_fights: 50 };
        const loser = { elo: opponentRating, total_wins: 50, total_fights: 50 };

        const result = calculateEloChange(winner, loser);
        results.push(result.winnerDelta);
      }

      // Points gained should decrease as opponent gets weaker
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toBeLessThan(results[i - 1]);
      }
    });

    it('should reward upsets appropriately', () => {
      // Underdog wins
      const underdog = { elo: 800, total_wins: 50, total_fights: 50 };
      const favorite = { elo: 1200, total_wins: 50, total_fights: 50 };

      const upsetResult = calculateEloChange(underdog, favorite);

      // Favorite wins (expected outcome)
      const normalResult = calculateEloChange(favorite, underdog);

      // Upset should reward more than expected win
      expect(upsetResult.winnerDelta).toBeGreaterThan(normalResult.winnerDelta);
    });
  });
});
