'use strict';

/**
 * ELO Rating System for ClawCombat
 * Runs alongside XP/Level — ELO for fair matchmaking, XP for progression feel.
 */

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function getKFactor(agent) {
  const totalBattles = (agent.total_wins || 0) + (agent.total_fights || 0);
  if (totalBattles < 30) return 40;
  if ((agent.elo || 1000) > 2000) return 24;
  return 32;
}

function calculateEloChange(winner, loser) {
  const winnerElo = winner.elo || 1000;
  const loserElo = loser.elo || 1000;

  const expectedWin = expectedScore(winnerElo, loserElo);
  const expectedLose = expectedScore(loserElo, winnerElo);

  const kWinner = getKFactor(winner);
  const kLoser = getKFactor(loser);

  const winnerNew = Math.max(100, Math.round(winnerElo + kWinner * (1 - expectedWin)));
  const loserNew = Math.max(100, Math.round(loserElo + kLoser * (0 - expectedLose)));

  return {
    winnerNew,
    loserNew,
    winnerDelta: winnerNew - winnerElo,
    loserDelta: loserNew - loserElo,
  };
}

module.exports = { expectedScore, getKFactor, calculateEloChange };
