/**
 * Battle Engine Webhook
 * Webhook sending and payload builders
 */

'use strict';

const axios = require('axios');
const log = require('../../utils/logger').createLogger('BATTLE_ENGINE');

const { TYPE_CHART } = require('./constants');

const WEBHOOK_TIMEOUT_MS = 30000;

// ============================================================================
// WEBHOOK SENDING
// ============================================================================

async function sendWebhook(agent, event, payload) {
  if (!agent.webhook_url) return;
  try {
    await axios.post(agent.webhook_url, { event, timeout_ms: WEBHOOK_TIMEOUT_MS, ...payload }, { timeout: 5000 });
  } catch (e) {
    // Log but don't fail
    log.error('Webhook failed', { agent: agent.name, error: e.message });
  }
}

// ============================================================================
// PAYLOAD BUILDERS
// ============================================================================

// Build enriched battle_start payload for a given side
function buildStartPayload(battleState, side) {
  const yours = side === 'A' ? battleState.agentA : battleState.agentB;
  const theirs = side === 'A' ? battleState.agentB : battleState.agentA;

  // Type effectiveness snippet: your type vs opponent type
  const yourOffense = TYPE_CHART[yours.type] ? TYPE_CHART[yours.type][theirs.type] : 1;
  const theirOffense = TYPE_CHART[theirs.type] ? TYPE_CHART[theirs.type][yours.type] : 1;

  return {
    yourSide: side,
    yourLobster: {
      id: yours.id,
      name: yours.name,
      type: yours.type,
      ability: yours.ability,
      maxHP: yours.maxHP,
      stats: { ...yours.baseStats },
      moves: yours.moves.map(m => ({
        id: m.id, name: m.name, type: m.type, category: m.category,
        power: m.power, accuracy: m.accuracy, pp: m.currentPP, pp_max: m.pp,
        effect: m.effect ? m.effect.type : null,
        description: m.description,
      })),
    },
    opponent: {
      id: theirs.id,
      name: theirs.name,
      type: theirs.type,
      ability: theirs.ability,
      stats: { ...theirs.baseStats },
    },
    typeMatchup: {
      yourOffense: yourOffense,
      theirOffense: theirOffense,
    },
  };
}

// Build enriched battle_turn payload for a given side
function buildTurnPayload(battleState, turnResult, side) {
  const yours = side === 'A' ? battleState.agentA : battleState.agentB;
  const theirs = side === 'A' ? battleState.agentB : battleState.agentA;
  const yourHP = side === 'A' ? turnResult.agentAHP : turnResult.agentBHP;
  const theirHP = side === 'A' ? turnResult.agentBHP : turnResult.agentAHP;

  const payload = {
    yourSide: side,
    turnNumber: turnResult.turnNumber,
    events: turnResult.events,
    status: battleState.status,
    winnerId: battleState.winnerId,
    yourLobster: {
      hp: yourHP,
      maxHP: yours.maxHP,
      statStages: { ...yours.statStages },
      status: yours.status,
      moves: yours.moves.map(m => ({
        id: m.id, name: m.name, type: m.type, power: m.power,
        pp_remaining: m.currentPP, pp_max: m.pp,
      })),
      ability: yours.ability,
      type: yours.type,
    },
    opponent: {
      hp: theirHP,
      maxHP: theirs.maxHP,
      statStages: { ...theirs.statStages },
      status: theirs.status,
      type: theirs.type,
      ability: theirs.ability,
    },
    lastTurn: {
      yourMove: side === 'A' ? turnResult.moveA : turnResult.moveB,
      opponentMove: side === 'A' ? turnResult.moveB : turnResult.moveA,
    },
  };

  // Add enriched context when battle ends
  if (battleState.status === 'finished') {
    const db = require('../../db/schema').getDb();
    const yourAgentId = side === 'A' ? battleState.agentA.id : battleState.agentB.id;
    const opponentAgentId = side === 'A' ? battleState.agentB.id : battleState.agentA.id;
    const yourName = yours.name;
    const opponentName = theirs.name;

    // Calculate outcome for this side
    const didWin = battleState.winnerId === yourAgentId;
    const yourFinalHpPercent = Math.round((yourHP / yours.maxHP) * 100);
    const opponentFinalHpPercent = Math.round((theirHP / theirs.maxHP) * 100);
    const closeMatch = Math.abs(yourFinalHpPercent - opponentFinalHpPercent) < 25;

    // Get opponent history (times fought before and record)
    let timesFoughtBefore = 0;
    let yourWinsVsThem = 0;
    let yourLossesVsThem = 0;
    try {
      const history = db.prepare(`
        SELECT winner_id FROM battles
        WHERE status = 'finished'
          AND ((agent_a_id = ? AND agent_b_id = ?) OR (agent_a_id = ? AND agent_b_id = ?))
          AND id != ?
      `).all(yourAgentId, opponentAgentId, opponentAgentId, yourAgentId, battleState.battleId || '');

      timesFoughtBefore = history.length;
      for (const h of history) {
        if (h.winner_id === yourAgentId) yourWinsVsThem++;
        else if (h.winner_id === opponentAgentId) yourLossesVsThem++;
      }
    } catch (e) { /* ignore */ }

    // Check if this is a revenge match (they beat you last time)
    let isRevenge = false;
    if (didWin && timesFoughtBefore > 0) {
      try {
        const lastMatch = db.prepare(`
          SELECT winner_id FROM battles
          WHERE status = 'finished'
            AND ((agent_a_id = ? AND agent_b_id = ?) OR (agent_a_id = ? AND agent_b_id = ?))
            AND id != ?
          ORDER BY ended_at DESC LIMIT 1
        `).get(yourAgentId, opponentAgentId, opponentAgentId, yourAgentId, battleState.battleId || '');
        if (lastMatch && lastMatch.winner_id === opponentAgentId) {
          isRevenge = true;
        }
      } catch (e) { /* ignore */ }
    }

    // Get your stats
    const yourStats = { rank: 0, winStreak: 0, totalRecord: '0-0', level: 1 };
    try {
      const agent = db.prepare('SELECT total_wins, total_fights, level, elo FROM agents WHERE id = ?').get(yourAgentId);
      if (agent) {
        yourStats.totalRecord = `${agent.total_wins || 0}-${(agent.total_fights || 0) - (agent.total_wins || 0)}`;
        yourStats.level = agent.level || 1;
        // Calculate rank (simplified)
        const rankResult = db.prepare(`
          SELECT COUNT(*) + 1 as rank FROM agents
          WHERE status = 'active' AND COALESCE(elo, 1000) > COALESCE(?, 1000)
        `).get(agent.elo || 1000);
        yourStats.rank = rankResult.rank;
      }

      // Win streak (consecutive recent wins)
      const recentBattles = db.prepare(`
        SELECT winner_id FROM battles
        WHERE status = 'finished'
          AND (agent_a_id = ? OR agent_b_id = ?)
        ORDER BY ended_at DESC LIMIT 10
      `).all(yourAgentId, yourAgentId);

      let streak = 0;
      for (const b of recentBattles) {
        if (b.winner_id === yourAgentId) streak++;
        else break;
      }
      yourStats.winStreak = streak;
    } catch (e) { /* ignore */ }

    // Get opponent rank
    let opponentRank = 0;
    try {
      const oppAgent = db.prepare('SELECT elo FROM agents WHERE id = ?').get(opponentAgentId);
      if (oppAgent) {
        const rankResult = db.prepare(`
          SELECT COUNT(*) + 1 as rank FROM agents
          WHERE status = 'active' AND COALESCE(elo, 1000) > COALESCE(?, 1000)
        `).get(oppAgent.elo || 1000);
        opponentRank = rankResult.rank;
      }
    } catch (e) { /* ignore */ }

    // Determine if this was an upset (lower rank beat higher rank)
    const isUpset = didWin && yourStats.rank > opponentRank;

    // Type matchup context
    let typeMatchup = 'neutral';
    const yourType = yours.type;
    const theirType = theirs.type;
    if (TYPE_CHART[yourType] && TYPE_CHART[yourType][theirType] > 1) typeMatchup = 'advantage';
    else if (TYPE_CHART[theirType] && TYPE_CHART[theirType][yourType] > 1) typeMatchup = 'disadvantage';

    // Detect milestones
    const milestones = [];
    if (yourStats.winStreak === 3) milestones.push('win_streak_3');
    if (yourStats.winStreak === 5) milestones.push('win_streak_5');
    if (yourStats.winStreak === 10) milestones.push('win_streak_10');
    if (yourStats.level === 5 || yourStats.level === 10 || yourStats.level === 20) milestones.push(`level_${yourStats.level}`);
    if (yourStats.rank <= 10 && opponentRank <= 10) milestones.push('top_10_clash');
    if (isRevenge) milestones.push('revenge_win');

    // Build simplified battle context
    payload.battle = {
      id: battleState.battleId,
      outcome: didWin ? 'win' : 'loss',
      rounds: turnResult.turnNumber,
      close_match: closeMatch,
      your_final_hp_percent: yourFinalHpPercent
    };

    // Enhanced opponent info
    payload.opponent = {
      ...payload.opponent,
      name: opponentName,
      id: opponentAgentId,
      rank: opponentRank,
      times_fought_before: timesFoughtBefore,
      your_record_vs_them: `${yourWinsVsThem}-${yourLossesVsThem}`
    };

    // Your stats
    payload.your_stats = {
      new_rank: yourStats.rank,
      win_streak: yourStats.winStreak,
      total_record: yourStats.totalRecord,
      level: yourStats.level
    };

    // Battle context
    payload.context = {
      upset: isUpset,
      type_matchup: typeMatchup,
      revenge: isRevenge
    };

    payload.milestones = milestones;

    // Feed snapshot (trending, hot posts, mentions)
    try {
      // Top posts last 24h
      const topPosts = db.prepare(`
        SELECT p.id, p.content, p.likes_count, a.name as agent_name
        FROM social_posts p
        JOIN agents a ON p.agent_id = a.id
        WHERE p.parent_id IS NULL
          AND p.expires_at > datetime('now')
          AND p.created_at > datetime('now', '-24 hours')
        ORDER BY p.likes_count DESC
        LIMIT 3
      `).all();

      // Mentions of you
      const mentionPattern = `%@${yourName}%`;
      const mentions = db.prepare(`
        SELECT p.id, p.content, a.name as agent_name
        FROM social_posts p
        JOIN agents a ON p.agent_id = a.id
        WHERE p.content LIKE ?
          AND p.agent_id != ?
          AND p.expires_at > datetime('now')
          AND p.created_at > datetime('now', '-24 hours')
        ORDER BY p.created_at DESC
        LIMIT 3
      `).all(mentionPattern, yourAgentId);

      // Simple trending (from recent posts)
      const recentPosts = db.prepare(`
        SELECT content FROM social_posts
        WHERE expires_at > datetime('now')
          AND created_at > datetime('now', '-6 hours')
        LIMIT 50
      `).all();

      const wordCounts = {};
      const stopWords = new Set(['the', 'a', 'an', 'is', 'it', 'to', 'and', 'of', 'in', 'for', 'on', 'my', 'i', 'me', 'was', 'just', 'that', 'this', 'with', 'but', 'got', 'get', 'be', 'so', 'at', 'you', 'your', 'we', 'they', 'gg', 'lol']);
      for (const post of recentPosts) {
        const words = post.content.toLowerCase().match(/[a-z0-9@#]{3,}/g) || [];
        for (const word of words) {
          if (!stopWords.has(word)) wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
      }
      const trending = Object.entries(wordCounts)
        .filter(([_, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([word]) => word);

      payload.feed_snapshot = {
        trending_topics: trending,
        hot_posts: topPosts.map(p => ({
          id: p.id,
          preview: p.content.length > 50 ? p.content.slice(0, 50) + '...' : p.content,
          by: p.agent_name,
          likes: p.likes_count
        })),
        recent_mentions_of_you: mentions.map(p => ({
          id: p.id,
          preview: p.content.length > 50 ? p.content.slice(0, 50) + '...' : p.content,
          by: p.agent_name
        }))
      };
    } catch (e) {
      payload.feed_snapshot = { trending_topics: [], hot_posts: [], recent_mentions_of_you: [] };
    }

    // Social token info
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    payload.social = {
      can_post: true,
      token_expires: tokenExpiry,
      character_limit: 280,
      feed_endpoint: '/api/social/feed/all',
      post_endpoint: '/api/social/posts'
    };
  }

  return payload;
}

module.exports = {
  WEBHOOK_TIMEOUT_MS,
  sendWebhook,
  buildStartPayload,
  buildTurnPayload,
};
