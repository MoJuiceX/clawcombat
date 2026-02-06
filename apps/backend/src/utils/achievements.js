const crypto = require('crypto');
const { getDb } = require('../db/schema');
const { getAgentById } = require('../services/agent-queries');
const log = require('./logger').createLogger('ACHIEVEMENTS');

const BADGES = {
  first_blood: { name: 'First Blood', description: 'Win your first fight' },
  on_a_roll: { name: 'On a Roll', description: '5 straight wins' },
  century_club: { name: 'Century Club', description: '100 fights completed' },
  judgment_day: { name: 'Judgment Day', description: '50 judgments submitted' },
  community_builder: { name: 'Community Builder', description: 'First proposal wins voting' },
  voting_rights: { name: 'Voting Rights', description: '10 votes cast' },
  democracy: { name: 'Democracy', description: '100 votes cast' },
  streak_7: { name: 'Week Warrior', description: '7-day fighting streak' },
  dedicated: { name: 'Dedicated', description: '90-day fighting streak' },
  rising_star: { name: 'Rising Star', description: 'Reach Level 10' }
};

function checkAndAwardBadges(agentId) {
  const db = getDb();

  const existing = db.prepare('SELECT badge_name FROM achievements WHERE agent_id = ?').all(agentId);
  const earned = new Set(existing.map(e => e.badge_name));

  const agent = getAgentById(agentId);
  if (!agent) return [];

  const newBadges = [];

  // First Blood: win first fight
  if (!earned.has('first_blood') && agent.total_wins >= 1) {
    awardBadge(db, agentId, 'first_blood');
    newBadges.push('first_blood');
  }

  // On a Roll: 5+ consecutive win streak (checks actual fight history, not daily streak)
  if (!earned.has('on_a_roll')) {
    const recentFights = db.prepare(`
      SELECT winner_id FROM fights
      WHERE (agent_a_id = ? OR agent_b_id = ?) AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 5
    `).all(agentId, agentId);
    const allWins = recentFights.length >= 5 && recentFights.every(f => f.winner_id === agentId);
    if (allWins) {
      awardBadge(db, agentId, 'on_a_roll');
      newBadges.push('on_a_roll');
    }
  }

  // Century Club: 100 fights
  if (!earned.has('century_club') && agent.total_fights >= 100) {
    awardBadge(db, agentId, 'century_club');
    newBadges.push('century_club');
  }

  // Judgment Day: 50 judgments
  if (!earned.has('judgment_day') && agent.total_judgments >= 50) {
    awardBadge(db, agentId, 'judgment_day');
    newBadges.push('judgment_day');
  }

  // Community Builder: first proposal wins voting
  if (!earned.has('community_builder')) {
    const wonProposal = db.prepare(`
      SELECT id FROM governance_agent_proposals
      WHERE creator_id = ? AND status = 'winning'
      LIMIT 1
    `).get(agentId);
    if (wonProposal) {
      awardBadge(db, agentId, 'community_builder');
      newBadges.push('community_builder');
    }
  }

  // Voting Rights: 10 votes cast
  if (!earned.has('voting_rights')) {
    const votes = db.prepare("SELECT COUNT(*) as cnt FROM governance_votes WHERE voter_id = ?").get(agentId);
    if (votes && votes.cnt >= 10) {
      awardBadge(db, agentId, 'voting_rights');
      newBadges.push('voting_rights');
    }
  }

  // Democracy: 100 votes cast
  if (!earned.has('democracy')) {
    const votes = db.prepare("SELECT COUNT(*) as cnt FROM governance_votes WHERE voter_id = ?").get(agentId);
    if (votes && votes.cnt >= 100) {
      awardBadge(db, agentId, 'democracy');
      newBadges.push('democracy');
    }
  }

  // Week Warrior: 7-day streak
  if (!earned.has('streak_7') && (agent.best_streak || 0) >= 7) {
    awardBadge(db, agentId, 'streak_7');
    newBadges.push('streak_7');
  }

  // Dedicated: 90-day streak
  if (!earned.has('dedicated') && (agent.best_streak || 0) >= 90) {
    awardBadge(db, agentId, 'dedicated');
    newBadges.push('dedicated');
  }

  // Rising Star: Level 10+
  if (!earned.has('rising_star') && (agent.level || 1) >= 10) {
    awardBadge(db, agentId, 'rising_star');
    newBadges.push('rising_star');
  }

  return newBadges;
}

function awardBadge(db, agentId, badgeName) {
  const id = `badge_${crypto.randomBytes(8).toString('hex')}`;
  try {
    db.prepare(`
      INSERT INTO achievements (id, agent_id, badge_name)
      VALUES (?, ?, ?)
    `).run(id, agentId, badgeName);
  } catch (e) {
    // Expected: UNIQUE constraint violation when agent already has badge
    // Log at debug level for tracking without spamming logs
    log.debug('Badge already awarded or error', { agentId, badgeName, error: e.message });
  }
}

function getAgentAchievements(agentId) {
  const db = getDb();
  const badges = db.prepare('SELECT badge_name, earned_at FROM achievements WHERE agent_id = ? ORDER BY earned_at DESC').all(agentId);
  return badges.map(b => ({
    badge: b.badge_name,
    name: BADGES[b.badge_name]?.name || b.badge_name,
    description: BADGES[b.badge_name]?.description || '',
    earned_at: b.earned_at
  }));
}

/**
 * Batch fetch badges for multiple agents (prevents N+1 query pattern)
 * @param {string[]} agentIds - Array of agent IDs
 * @returns {Object} Map of agentId -> badges array
 */
function getBadgesForAgents(agentIds) {
  if (!agentIds || agentIds.length === 0) return {};

  const db = getDb();
  const placeholders = agentIds.map(() => '?').join(',');

  // Batch query: fetch all badges for all agents in one query
  const badges = db.prepare(`
    SELECT agent_id, badge_name, earned_at
    FROM achievements
    WHERE agent_id IN (${placeholders})
    ORDER BY earned_at DESC
  `).all(...agentIds);

  // Group by agent_id
  const badgesByAgent = {};
  for (const agentId of agentIds) {
    badgesByAgent[agentId] = [];
  }

  for (const b of badges) {
    if (badgesByAgent[b.agent_id]) {
      badgesByAgent[b.agent_id].push({
        badge: b.badge_name,
        name: BADGES[b.badge_name]?.name || b.badge_name,
        description: BADGES[b.badge_name]?.description || '',
        earned_at: b.earned_at
      });
    }
  }

  return badgesByAgent;
}

/**
 * Batch fetch player_badges (ranking badges) for multiple agents
 * @param {string[]} agentIds - Array of agent IDs
 * @returns {Object} Map of agentId -> badges array
 */
function getPlayerBadgesForAgents(agentIds) {
  if (!agentIds || agentIds.length === 0) return {};

  const db = getDb();
  const placeholders = agentIds.map(() => '?').join(',');

  // Batch query: fetch all player_badges for all agents in one query
  const badges = db.prepare(`
    SELECT pb.agent_id, b.id as badge_id, b.name as badge_name, b.tier
    FROM player_badges pb
    JOIN badges b ON b.id = pb.badge_id
    WHERE pb.agent_id IN (${placeholders})
  `).all(...agentIds);

  // Group by agent_id
  const badgesByAgent = {};
  for (const agentId of agentIds) {
    badgesByAgent[agentId] = [];
  }

  for (const b of badges) {
    if (badgesByAgent[b.agent_id]) {
      badgesByAgent[b.agent_id].push({
        badge_id: b.badge_id,
        name: b.badge_name,
        tier: b.tier
      });
    }
  }

  return badgesByAgent;
}

module.exports = { checkAndAwardBadges, getAgentAchievements, getBadgesForAgents, getPlayerBadgesForAgents, BADGES };
