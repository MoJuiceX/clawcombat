/**
 * Moltbook Service
 *
 * Handles template selection, variable substitution, and milestone detection
 * for the Moltbook viral marketing integration.
 */

const templates = require('../data/moltbook-post-templates.json');

/**
 * Format a template by replacing {variables} with actual values
 * @param {string} template - Template string with {variable} placeholders
 * @param {object} context - Object with values to substitute
 * @returns {string} - Formatted string
 */
function formatTemplate(template, context) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      return context[key];
    }
    return match; // Keep original if no value provided
  });
}

/**
 * Select random templates from a category
 * @param {string} type - 'win' | 'loss' | 'milestone' | 'recruitment' | 'daily'
 * @param {number} count - Number of templates to return
 * @param {object} context - Variables to substitute
 * @returns {array} - Array of formatted templates with metadata
 */
function selectRandomTemplates(type, count, context) {
  let pool;

  switch (type) {
    case 'win':
      pool = templates.templates.win_posts;
      break;
    case 'loss':
      pool = templates.templates.loss_posts;
      break;
    case 'milestone':
      pool = templates.templates.milestone_posts;
      break;
    case 'recruitment':
      pool = templates.templates.recruitment_replies;
      break;
    case 'daily':
      pool = templates.templates.daily_reminders;
      break;
    default:
      pool = templates.templates.win_posts;
  }

  if (!pool || pool.length === 0) {
    return [];
  }

  // Shuffle and take requested count
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, pool.length));

  // Format each template with context
  return selected.map(item => ({
    id: item.id,
    content: formatTemplate(item.template, context),
    tone: item.tone || null,
    includes_invite: item.includes_invite || false
  }));
}

/**
 * Detect milestones achieved by an agent
 * @param {object} agent - Agent data with stats
 * @param {object} battleResult - Battle result data
 * @param {object} previousStats - Stats before this battle
 * @returns {array} - Array of milestone triggers hit
 */
function detectMilestones(agent, battleResult, previousStats = {}) {
  const milestones = [];

  const wins = agent.total_wins || 0;
  const losses = agent.total_losses || 0;
  const level = agent.level || 1;
  const streak = agent.win_streak || 0;
  const totalBattles = (agent.total_battles || 0);
  const rank = agent.rank || 999;

  const prevWins = previousStats.total_wins || 0;
  const prevLevel = previousStats.level || 1;
  const prevStreak = previousStats.win_streak || 0;
  const prevBattles = previousStats.total_battles || 0;
  const prevRank = previousStats.rank || 999;

  // First win
  if (wins === 1 && prevWins === 0) {
    milestones.push('first_win');
  }

  // Win streak milestones
  if (streak >= 5 && prevStreak < 5) {
    milestones.push('streak_5');
  }
  if (streak >= 10 && prevStreak < 10) {
    milestones.push('streak_10');
  }

  // Level milestones
  if (level >= 5 && prevLevel < 5) {
    milestones.push('level_5');
  }
  if (level >= 10 && prevLevel < 10) {
    milestones.push('level_10');
  }
  if (level !== prevLevel && level % 5 === 0) {
    milestones.push('level_up');
  }

  // Battle count milestones
  if (totalBattles >= 100 && prevBattles < 100) {
    milestones.push('battles_100');
  }

  // Rank milestones
  if (rank <= 100 && prevRank > 100) {
    milestones.push('top_100');
  }

  return milestones;
}

/**
 * Calculate win rate percentage
 * @param {number} wins - Total wins
 * @param {number} losses - Total losses
 * @returns {number} - Win rate as percentage (0-100)
 */
function calculateWinRate(wins, losses) {
  const total = wins + losses;
  if (total === 0) return 0;
  return Math.round((wins / total) * 100);
}

/**
 * Generate complete Moltbook post data for a battle result
 * @param {object} agent - The agent that fought
 * @param {object} opponent - The opponent
 * @param {object} battle - Battle data
 * @param {boolean} won - Whether the agent won
 * @param {object} previousStats - Agent stats before battle (for milestone detection)
 * @returns {object} - Complete moltbook_post_data object
 */
function generateMoltbookPostData(agent, opponent, battle, won, previousStats = {}) {
  const wins = agent.total_wins || 0;
  const losses = agent.total_losses || 0;
  const streak = agent.win_streak || 0;
  const level = agent.level || 1;
  const rank = agent.rank || 999;

  // Build context for template substitution
  const context = {
    opponent_name: opponent.name || 'Unknown',
    opponent_type: opponent.ai_type || opponent.type || 'NEUTRAL',
    your_type: agent.ai_type || agent.type || 'NEUTRAL',
    winning_move: battle.final_move || 'a powerful attack',
    wins: String(wins),
    losses: String(losses),
    win_rate: String(calculateWinRate(wins, losses)),
    streak: String(streak),
    rank: String(rank),
    level: String(level),
    your_name: agent.name || 'My lobster'
  };

  // Detect milestones
  const milestonesHit = detectMilestones(agent, battle, previousStats);

  // Select appropriate templates
  const resultType = won ? 'win' : 'loss';
  const suggestedPosts = selectRandomTemplates(resultType, 3, context);

  // Add milestone posts if any milestones were hit
  if (milestonesHit.length > 0) {
    const milestoneTemplates = templates.templates.milestone_posts.filter(
      t => milestonesHit.includes(t.trigger)
    );

    milestoneTemplates.forEach(mt => {
      suggestedPosts.push({
        id: mt.id,
        content: formatTemplate(mt.template, context),
        tone: 'milestone',
        is_milestone: true,
        milestone_type: mt.trigger
      });
    });
  }

  return {
    result: resultType,
    opponent_name: context.opponent_name,
    opponent_type: context.opponent_type,
    your_type: context.your_type,
    winning_move: context.winning_move,
    your_stats: {
      wins: wins,
      losses: losses,
      win_rate: calculateWinRate(wins, losses),
      streak: streak,
      rank: rank,
      level: level
    },
    milestones_hit: milestonesHit,
    suggested_posts: suggestedPosts,
    hashtags: ['#ClawCombat'],
    report_endpoint: 'https://clawcombat.com/api/moltbook/report'
  };
}

/**
 * Get milestone template for a specific trigger
 * @param {string} trigger - The milestone trigger (e.g., 'level_5', 'streak_10')
 * @param {object} context - Variables to substitute
 * @returns {object|null} - Formatted milestone post or null
 */
function getMilestoneTemplate(trigger, context) {
  const milestoneTemplate = templates.templates.milestone_posts.find(
    t => t.trigger === trigger
  );

  if (!milestoneTemplate) return null;

  return {
    id: milestoneTemplate.id,
    content: formatTemplate(milestoneTemplate.template, context),
    trigger: trigger
  };
}

/**
 * Get all available templates (for admin/debugging)
 * @returns {object} - Full templates object
 */
function getAllTemplates() {
  return templates;
}

/**
 * Check if agent should post based on posting rules
 * @param {object} agent - Agent data
 * @param {string} lastPostTime - ISO timestamp of last post
 * @returns {boolean} - Whether agent should post
 */
function shouldPost(agent, lastPostTime) {
  // Rate limit: 1 post per 30 minutes
  if (lastPostTime) {
    const lastPost = new Date(lastPostTime);
    const now = new Date();
    const minutesSinceLastPost = (now - lastPost) / (1000 * 60);
    if (minutesSinceLastPost < 30) {
      return false;
    }
  }
  return true;
}

module.exports = {
  formatTemplate,
  selectRandomTemplates,
  detectMilestones,
  calculateWinRate,
  generateMoltbookPostData,
  getMilestoneTemplate,
  getAllTemplates,
  shouldPost
};
