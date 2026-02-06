const cron = require('node-cron');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const log = require('../utils/logger').createLogger('AUTOMATION');
const { getDb } = require('../db/schema');
const { chooseMove } = require('./ai-strategist');
const { getAgentById, getActiveAgentById, getAllActiveAgents } = require('./agent-queries');
const {
  mapDbAgent, createBattle, saveTurn, resolveTurn,
  applyBattleResults, checkTimeouts, TYPE_CHART,
} = require('./battle-engine');

// ============================================================================
// Governance: voting windows, priorities, proposals
// ============================================================================

async function openVotingWindow() {
  const db = getDb();
  log.info('Opening voting window');

  // Close any existing open windows first
  db.prepare("UPDATE voting_window SET status = 'closed' WHERE status = 'open'").run();

  const topProposals = db.prepare(`
    SELECT * FROM proposals
    WHERE status = 'open'
    ORDER BY agent_votes DESC
    LIMIT 3
  `).all();

  if (topProposals.length === 0) {
    log.info('No open proposals for voting window');
    return;
  }

  const windowId = uuidv4();
  const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO voting_window (id, opened_at, closes_at, status, top_proposal_1, top_proposal_2, top_proposal_3)
    VALUES (?, CURRENT_TIMESTAMP, ?, 'open', ?, ?, ?)
  `).run(
    windowId,
    closesAt,
    topProposals[0]?.id || null,
    topProposals[1]?.id || null,
    topProposals[2]?.id || null
  );

  log.info('Voting window opened', { proposals: topProposals.length });
}

async function closeVotingAndSetPriority() {
  const db = getDb();

  const window = db.prepare("SELECT * FROM voting_window WHERE status = 'open' AND closes_at <= datetime('now')").get();
  if (!window) return;

  log.info('Closing voting window');
  db.prepare("UPDATE voting_window SET status = 'closed' WHERE id = ?").run(window.id);

  const proposalIds = [window.top_proposal_1, window.top_proposal_2, window.top_proposal_3].filter(Boolean);

  let winnerPid = null;
  let maxVotes = -Infinity;

  // Batch query for all proposal vote totals (fixes N+1)
  if (proposalIds.length > 0) {
    const placeholders = proposalIds.map(() => '?').join(',');
    const voteTotals = db.prepare(`
      SELECT proposal_id, COALESCE(SUM(vote), 0) as total
      FROM human_votes
      WHERE voting_window_id = ? AND proposal_id IN (${placeholders})
      GROUP BY proposal_id
    `).all(window.id, ...proposalIds);

    const voteMap = {};
    for (const row of voteTotals) {
      voteMap[row.proposal_id] = row.total;
    }

    for (const pid of proposalIds) {
      const total = voteMap[pid] || 0;
      if (total > maxVotes) {
        maxVotes = total;
        winnerPid = pid;
      }
    }
  }

  // If no human votes, pick the one with most agent votes
  if (maxVotes <= 0 && proposalIds.length > 0) {
    winnerPid = proposalIds[0]; // Already sorted by agent_votes
  }

  if (winnerPid) {
    // Deactivate any existing priority
    db.prepare("UPDATE priority SET status = 'superseded' WHERE status = 'active'").run();

    db.prepare(`
      INSERT INTO priority (id, proposal_id, set_by_voting_window_id, human_vote_count, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(uuidv4(), winnerPid, window.id, Math.max(0, maxVotes));

    const proposal = db.prepare('SELECT title FROM proposals WHERE id = ?').get(winnerPid);
    log.info('Priority set', { proposal: proposal?.title, votes: maxVotes });
  }
}

async function checkPriorityProgress() {
  const db = getDb();

  const priority = db.prepare("SELECT * FROM priority WHERE status = 'active'").get();
  if (!priority) return;

  const latest = db.prepare(`
    SELECT * FROM progress
    WHERE proposal_id = ?
    ORDER BY reported_at DESC
    LIMIT 1
  `).get(priority.proposal_id);

  if (latest && latest.progress_score >= 9) {
    db.prepare("UPDATE priority SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(priority.id);
    db.prepare("UPDATE proposals SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(priority.proposal_id);

    const proposal = db.prepare('SELECT title FROM proposals WHERE id = ?').get(priority.proposal_id);
    log.info('Priority completed', { proposal: proposal?.title });
  }
}

async function updateLeaderboard() {
  const db = getDb();
  log.info('Updating leaderboard');

  // Safety LIMIT to prevent runaway queries; 10000 is well above expected agent count
  const agents = getAllActiveAgents(10000);

  const upsert = db.prepare(`
    INSERT INTO leaderboard (agent_id, name, wins, losses, win_rate, total_judgments, judge_accuracy, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
    ON CONFLICT(agent_id) DO UPDATE SET
      name = excluded.name,
      wins = excluded.wins,
      losses = excluded.losses,
      win_rate = excluded.win_rate,
      total_judgments = excluded.total_judgments,
      updated_at = CURRENT_TIMESTAMP
  `);

  // Batch upserts in a transaction for better performance
  const updateAll = db.transaction(() => {
    for (const a of agents) {
      const losses = (a.total_fights || 0) - (a.total_wins || 0);
      const winRate = (a.total_fights || 0) > 0 ? (a.total_wins || 0) / a.total_fights : 0;
      upsert.run(a.id, a.name, a.total_wins || 0, losses, winRate, a.level || 1);
    }
  });
  updateAll();

  log.info('Leaderboard updated', { agents: agents.length });
}

// Human governance: check 24h voting deadlines every 60 seconds
async function checkHumanVotingDeadlines() {
  const db = getDb();

  const closed = db.prepare(`
    SELECT * FROM governance_human_proposals
    WHERE status = 'voting'
    AND vote_end_time <= datetime('now')
  `).all();

  for (const proposal of closed) {
    const netVotes = proposal.votes_up - proposal.votes_down;
    const finalStatus = netVotes > 0 ? 'won' : 'lost';

    db.prepare('UPDATE governance_human_proposals SET status = ? WHERE id = ?').run(finalStatus, proposal.id);

    if (finalStatus === 'won') {
      // Add to build queue
      db.prepare(`
        INSERT INTO build_queue (id, proposal_id, proposal_type, title, status)
        VALUES (?, ?, 'human', ?, 'queued')
      `).run(crypto.randomUUID(), proposal.id, proposal.title);

      log.info('Proposal won', { proposal: proposal.title, votes: `${proposal.votes_up}-${proposal.votes_down}` });
    } else {
      log.info('Proposal lost', { proposal: proposal.title, votes: `${proposal.votes_up}-${proposal.votes_down}` });
    }
  }

  if (closed.length > 0) {
    log.info('Processed expired human proposals', { count: closed.length });
  }
}

// Resolve agent governance winners from past 24h cycles
async function resolveAgentWeeklyWinners() {
  const db = getDb();
  const { getCurrentWeekKey } = require('../utils/voting-window');
  const currentWeek = getCurrentWeekKey();

  // Find past cycles with 'winning' proposals that were never resolved
  const unresolvedWinners = db.prepare(`
    SELECT * FROM governance_agent_proposals
    WHERE status = 'winning'
    AND (voting_cycle_week IS NULL OR voting_cycle_week < ?)
  `).all(currentWeek);

  for (const proposal of unresolvedWinners) {
    // Mark as 'won' and add to build queue
    db.prepare("UPDATE governance_agent_proposals SET status = 'won' WHERE id = ?").run(proposal.id);

    db.prepare(`
      INSERT INTO build_queue (id, proposal_id, proposal_type, title, status)
      VALUES (?, ?, 'agent', ?, 'queued')
    `).run(crypto.randomUUID(), proposal.id, proposal.title);

    log.info('Agent proposal won', { proposal: proposal.title, votes: `${proposal.votes_up}-${proposal.votes_down}` });
  }

  // Also mark all other active proposals from past weeks as 'expired'
  db.prepare(`
    UPDATE governance_agent_proposals
    SET status = 'expired'
    WHERE status = 'active'
    AND voting_cycle_week IS NOT NULL
    AND voting_cycle_week < ?
  `).run(currentWeek);

  if (unresolvedWinners.length > 0) {
    log.info('Resolved agent weekly winners', { count: unresolvedWinners.length });
  }
}

// ============================================================================
// Auto-Queue: Periodically queue play_mode='auto' agents for battle matchmaking
// ============================================================================

async function autoQueueAgents() {
  const db = getDb();
  log.info('Auto-queuing auto-play agents');

  const autoAgents = db.prepare(`
    SELECT id FROM agents
    WHERE status = 'active'
    AND play_mode = 'auto'
    AND id NOT IN (SELECT agent_id FROM battle_queue)
    AND id NOT IN (
      SELECT agent_a_id FROM battles WHERE status IN ('active', 'pending')
      UNION
      SELECT agent_b_id FROM battles WHERE status IN ('active', 'pending')
    )
  `).all();

  if (autoAgents.length === 0) {
    log.info('No auto-play agents available to queue');
    return 0;
  }

  const insertStmt = db.prepare('INSERT OR IGNORE INTO battle_queue (agent_id) VALUES (?)');
  let queued = 0;

  // Batch inserts in a transaction for better performance
  const queueAll = db.transaction(() => {
    for (const agent of autoAgents) {
      try {
        insertStmt.run(agent.id);
        queued++;
      } catch (e) {
        // Already in queue or constraint violation
      }
    }
  });
  queueAll();

  log.info('Auto-play agents queued', { count: queued });
  return queued;
}

// ============================================================================
// Resolve Auto-vs-Auto Battle: Instantly resolve all turns using AI strategist
// ============================================================================

function resolveAutoVsAuto(db, battleState, battleId) {
  const MAX_TURNS = 100;
  let turns = 0;

  while (battleState.status === 'active' && turns < MAX_TURNS) {
    const moveA = chooseMove('normal', battleState.agentA, battleState.agentB, battleState.agentA.moves, TYPE_CHART);
    const moveB = chooseMove('normal', battleState.agentB, battleState.agentA, battleState.agentB.moves, TYPE_CHART);

    if (!moveA || !moveB) break;

    const turnResult = resolveTurn(battleState, moveA, moveB);
    saveTurn(db, battleId, turnResult);
    turns++;
  }

  // Update battle record
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE battles SET
      status = ?,
      winner_id = ?,
      turn_number = ?,
      current_phase = 'finished',
      state_json = ?,
      ended_at = ?,
      last_turn_at = ?
    WHERE id = ?
  `).run(
    battleState.status === 'active' ? 'timeout' : battleState.status,
    battleState.winnerId,
    battleState.turnNumber,
    JSON.stringify(battleState),
    now, now,
    battleId
  );

  // Award XP
  if (battleState.winnerId) {
    const loserId = battleState.winnerId === battleState.agentA.id ? battleState.agentB.id : battleState.agentA.id;
    applyBattleResults(db, battleState.winnerId, loserId, battleId);
  }

  log.info('Auto-play battle resolved', { battleId: battleId.slice(0,8), turns, winner: battleState.winnerId ? battleState.winnerId.slice(0,8) : 'draw' });
  return { turns, winnerId: battleState.winnerId };
}

// ============================================================================
// Process Auto Queue: Match and instantly resolve auto-vs-auto battles
// ============================================================================

async function processAutoQueue() {
  const db = getDb();
  log.info('Processing auto-play queue');

  // Get all queued agents with level info
  const queue = db.prepare(`
    SELECT bq.agent_id, a.play_mode, COALESCE(a.level, 1) as level
    FROM battle_queue bq
    JOIN agents a ON bq.agent_id = a.id
    WHERE a.play_mode = 'auto'
  `).all();

  if (queue.length < 2) {
    log.info('Not enough auto-play agents in queue');
    return 0;
  }

  // Sort by level for greedy level-matched pairing
  queue.sort((a, b) => a.level - b.level);

  // Add small randomness to break ties: shuffle agents with same level
  for (let i = 0; i < queue.length; ) {
    let j = i;
    while (j < queue.length && queue[j].level === queue[i].level) j++;
    // Shuffle the [i, j) range
    for (let k = j - 1; k > i; k--) {
      const r = i + Math.floor(Math.random() * (k - i + 1));
      [queue[k], queue[r]] = [queue[r], queue[k]];
    }
    i = j;
  }

  let battles = 0;
  const matched = new Set();
  const LEVEL_RANGES = [5, 10, 20, Infinity]; // Expanding ranges

  // Greedy matching: try tight ranges first, widen if needed
  for (const maxDiff of LEVEL_RANGES) {
    for (let i = 0; i < queue.length; i++) {
      if (matched.has(queue[i].agent_id)) continue;

      let bestMatch = -1;
      let bestDiff = Infinity;

      for (let j = i + 1; j < queue.length; j++) {
        if (matched.has(queue[j].agent_id)) continue;
        const diff = Math.abs(queue[i].level - queue[j].level);
        if (diff <= maxDiff && diff < bestDiff) {
          bestDiff = diff;
          bestMatch = j;
        }
        // Since sorted by level, if diff > maxDiff we can break
        if (queue[j].level - queue[i].level > maxDiff) break;
      }

      if (bestMatch === -1) continue;

      // Match these two
      matched.add(queue[i].agent_id);
      matched.add(queue[bestMatch].agent_id);

      const removeStmt = db.prepare('DELETE FROM battle_queue WHERE agent_id = ?');
      removeStmt.run(queue[i].agent_id);
      removeStmt.run(queue[bestMatch].agent_id);

      const agentARow = getAgentById(queue[i].agent_id);
      const agentBRow = getAgentById(queue[bestMatch].agent_id);

      if (!agentARow || !agentBRow) continue;

      const agentA = mapDbAgent(agentARow);
      const agentB = mapDbAgent(agentBRow);

      const battleState = createBattle(db, agentA, agentB);
      resolveAutoVsAuto(db, battleState, battleState.id);
      battles++;

      const levelDiff = Math.abs(queue[i].level - queue[bestMatch].level);
      log.debug('Matched agents for auto-play', { levelA: queue[i].level, levelB: queue[bestMatch].level, diff: levelDiff, range: maxDiff });
    }
  }

  log.info('Resolved auto-play battles', { count: battles });
  return battles;
}

// ============================================================================
// Rank Recomputation: Pre-compute ranks for O(1) leaderboard lookups
// ============================================================================

/**
 * Recompute ranks for all active agents.
 * Sorts by: level DESC, win_rate DESC, total_fights DESC
 * Assigns rank = position + 1 in sorted order.
 *
 * @param {Object} db - Database instance (optional, uses getDb() if not provided)
 * @returns {Object} { count: number, durationMs: number }
 */
function recomputeAllRanks(db = null) {
  if (!db) db = getDb();
  const startTime = Date.now();

  // Fetch all active agents sorted by ranking criteria
  const agents = db.prepare(`
    SELECT id, level, total_wins, total_fights
    FROM agents
    WHERE status = 'active'
    ORDER BY
      COALESCE(level, 1) DESC,
      CASE WHEN total_fights > 0 THEN CAST(total_wins AS REAL) / total_fights ELSE 0 END DESC,
      total_fights DESC
  `).all();

  // Bulk update ranks in a transaction
  const updateRank = db.prepare('UPDATE agents SET rank = ? WHERE id = ?');
  const clearInactiveRanks = db.prepare("UPDATE agents SET rank = NULL WHERE status != 'active'");

  const transaction = db.transaction(() => {
    // Assign ranks to active agents
    for (let i = 0; i < agents.length; i++) {
      updateRank.run(i + 1, agents[i].id);
    }
    // Clear ranks for inactive agents
    clearInactiveRanks.run();
  });

  transaction();

  const durationMs = Date.now() - startTime;
  log.info('Recomputed all ranks', { count: agents.length, durationMs });

  return { count: agents.length, durationMs };
}

function cleanupUnclaimedAgents() {
  const db = getDb();

  // Find unclaimed agents whose 24-hour claim window has expired
  const expired = db.prepare(`
    SELECT id, name FROM agents
    WHERE owner_id IS NULL
    AND claimed_at IS NULL
    AND status = 'active'
    AND claim_expires_at IS NOT NULL
    AND claim_expires_at < datetime('now')
  `).all();

  if (expired.length === 0) return 0;

  const deleteAgent = db.prepare("DELETE FROM agents WHERE id = ?");
  const deleteMoves = db.prepare("DELETE FROM agent_moves WHERE agent_id = ?");
  const cancelBattles = db.prepare(`
    UPDATE battles SET status = 'cancelled'
    WHERE (agent_a_id = ? OR agent_b_id = ?)
    AND status IN ('active', 'pending')
  `);

  db.transaction(() => {
    for (const agent of expired) {
      cancelBattles.run(agent.id, agent.id);
      deleteMoves.run(agent.id);
      deleteAgent.run(agent.id);
      log.info('Agent released - claim window expired', { agent: agent.name });
    }
  })();

  log.info('Cleaned up unclaimed agents', { count: expired.length });
  return expired.length;
}

function startCronJobs() {
  if (process.env.DISABLE_AUTOMATION === 'true') {
    log.info('Automation disabled');
    return;
  }
  // Every 10 seconds: check for timed-out turn submissions (30s per turn)
  setInterval(() => {
    try {
      const db = getDb();
      checkTimeouts(db);
    } catch (err) {
      log.error('Timeout check error:', { error: err.message });
    }
  }, 10000);

  // Every 5 minutes: auto-queue and resolve auto-play battles
  cron.schedule('*/5 * * * *', async () => {
    try {
      await autoQueueAgents();
      await processAutoQueue();
    } catch (err) {
      log.error('Auto-play job error:', { error: err.message });
    }
  });

  // Every hour: check governance progress + Moltbook monitoring
  cron.schedule('0 * * * *', async () => {
    try {
      await checkPriorityProgress();
    } catch (err) {
      log.error('Hourly job error:', { error: err.message });
    }

    // Moltbook monitor: discover #ClawCombat posts
    try {
      const MoltbookMonitor = require('./moltbook-monitor');
      const db = getDb();
      const monitor = new MoltbookMonitor(db);
      await monitor.runMonitorJob();
    } catch (err) {
      log.error('Moltbook monitor error:', { error: err.message });
    }
  });

  // Every day at 18:00 UTC: open voting window
  cron.schedule('0 18 * * *', async () => {
    try {
      await openVotingWindow();
    } catch (err) {
      log.error('Voting open error:', { error: err.message });
    }
  });

  // Every minute: check if voting should close (catches the 24h expiry) + recompute ranks
  cron.schedule('* * * * *', async () => {
    try {
      await closeVotingAndSetPriority();
      await checkHumanVotingDeadlines();
    } catch (err) {
      log.error('Voting close error:', { error: err.message });
    }

    // Recompute leaderboard ranks for O(1) lookups
    try {
      recomputeAllRanks();
    } catch (err) {
      log.error('Rank recomputation error:', { error: err.message });
    }
  });

  // Every day at 00:00 UTC: update leaderboard + reset daily match counters + cleanup social
  cron.schedule('0 0 * * *', async () => {
    try {
      await resolveAgentWeeklyWinners();
      await updateLeaderboard();
      // Reset daily match counters for free users
      const { resetDailyMatchCounters } = require('./premium');
      const db = getDb();
      resetDailyMatchCounters(db);

      // Cleanup expired social posts and tokens
      try {
        const expiredPosts = db.prepare("DELETE FROM social_posts WHERE expires_at < datetime('now')").run();
        const expiredTokens = db.prepare("DELETE FROM social_tokens WHERE expires_at < datetime('now')").run();
        if (expiredPosts.changes > 0 || expiredTokens.changes > 0) {
          log.info('Social cleanup completed', { expiredPosts: expiredPosts.changes, expiredTokens: expiredTokens.changes });
        }
      } catch (e) {
        log.error('Social cleanup error:', { error: e.message });
      }

      // Cleanup unclaimed lobsters whose 24-hour claim window has expired
      cleanupUnclaimedAgents();
    } catch (err) {
      log.error('Daily job error:', { error: err.message });
    }
  });

  // 1st of each month at 00:00 UTC: Automatic seasonal leaderboard reset
  cron.schedule('0 0 1 * *', async () => {
    try {
      log.info('Triggering automatic seasonal reset');
      const db = getDb();

      // Get current season
      let currentSeason = 1;
      try {
        const meta = db.prepare('SELECT current_season FROM season_meta WHERE id = 1').get();
        if (meta) currentSeason = meta.current_season;
      } catch (e) { /* */ }

      // Archive current leaderboard
      const agents = db.prepare(`
        SELECT id, name, level, total_wins, total_fights
        FROM agents WHERE status = 'active'
        ORDER BY
          COALESCE(level, 1) DESC,
          CASE WHEN total_fights > 0 THEN CAST(total_wins AS REAL) / total_fights ELSE 0 END DESC,
          total_fights DESC
      `).all();

      // Seed seasonal badges
      const ensureBadge = db.prepare('INSERT OR IGNORE INTO badges (id, name, description, tier) VALUES (?, ?, ?, ?)');
      ensureBadge.run(`season_${currentSeason}_top10`, `Season ${currentSeason} Top 10`, `Finished in the top 10 of Season ${currentSeason}`, 'legendary');
      ensureBadge.run(`season_${currentSeason}_top50`, `Season ${currentSeason} Top 50`, `Finished in the top 50 of Season ${currentSeason}`, 'epic');
      ensureBadge.run(`season_${currentSeason}_top100`, `Season ${currentSeason} Top 100`, `Finished in the top 100 of Season ${currentSeason}`, 'rare');

      const insertArchive = db.prepare(`
        INSERT INTO leaderboard_archive (id, agent_id, agent_name, final_rank, final_level, final_win_rate, final_battles, season_number, reward_badge, reward_cosmetic)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // Note: resetAgent loop replaced with bulk UPDATE in transaction
      const awardBadge = db.prepare("INSERT OR IGNORE INTO player_badges (id, agent_id, badge_id, earned_by) VALUES (?, ?, ?, 'seasonal')");

      const transaction = db.transaction(() => {
        for (let i = 0; i < agents.length; i++) {
          const a = agents[i];
          const fights = a.total_fights || 0;
          const wins = a.total_wins || 0;
          const winRate = fights > 0 ? Math.round((wins / fights) * 1000) / 1000 : 0;
          const rank = i + 1;

          let rewardBadge = null;
          let rewardCosmetic = null;
          if (rank <= 10) { rewardBadge = 'top_10'; rewardCosmetic = `season_${currentSeason}_legendary`; }
          else if (rank <= 50) { rewardBadge = 'top_50'; rewardCosmetic = `season_${currentSeason}_epic`; }
          else if (rank <= 100) { rewardBadge = 'top_100'; rewardCosmetic = `season_${currentSeason}_rare`; }

          insertArchive.run(crypto.randomUUID(), a.id, a.name, rank, a.level || 1, winRate, fights, currentSeason, rewardBadge, rewardCosmetic);

          if (rank <= 100) {
            const badgeId = rank <= 10 ? `season_${currentSeason}_top10` : rank <= 50 ? `season_${currentSeason}_top50` : `season_${currentSeason}_top100`;
            awardBadge.run(crypto.randomUUID(), a.id, badgeId);
          }
        }

        // Bulk reset all active agents instead of looping
        db.prepare("UPDATE agents SET total_wins = 0, total_fights = 0 WHERE status = 'active'").run();
        db.prepare('UPDATE season_meta SET current_season = current_season + 1 WHERE id = 1').run();
      });

      transaction();
      log.info('Seasonal reset completed', { oldSeason: currentSeason, newSeason: currentSeason + 1, archived: agents.length });
    } catch (err) {
      log.error('Seasonal reset error:', { error: err.message });
    }
  });

  log.info('All cron jobs scheduled');
}

// ============================================================================
// Trigger First Fight: Immediately resolve a battle for a newly created agent
// ============================================================================

function triggerFirstFight(db, agentId) {
  // Load the agent
  const agentRow = getActiveAgentById(agentId);
  if (!agentRow) throw new Error('Agent not found');

  const agentLevel = agentRow.level || 1;

  // Find a random bot opponent within ±5 levels, fall back to any level
  let opponent = db.prepare(`
    SELECT * FROM agents
    WHERE status = 'active'
    AND play_mode = 'auto'
    AND id != ?
    AND ABS(COALESCE(level, 1) - ?) <= 5
    ORDER BY RANDOM() LIMIT 1
  `).get(agentId, agentLevel);

  if (!opponent) {
    // Fall back to any active bot
    opponent = db.prepare(`
      SELECT * FROM agents
      WHERE status = 'active'
      AND play_mode = 'auto'
      AND id != ?
      ORDER BY RANDOM() LIMIT 1
    `).get(agentId);
  }

  if (!opponent) {
    // Fall back to any active agent that isn't the same one
    opponent = db.prepare(`
      SELECT * FROM agents
      WHERE status = 'active'
      AND id != ?
      ORDER BY RANDOM() LIMIT 1
    `).get(agentId);
  }

  if (!opponent) throw new Error('No opponents available');

  // Map to engine format
  const agentA = mapDbAgent(agentRow);
  const agentB = mapDbAgent(opponent);

  // Load moves from agent_moves table
  const movesStmt = db.prepare('SELECT move_id FROM agent_moves WHERE agent_id = ? ORDER BY slot');
  agentA.moves = movesStmt.all(agentA.id).map(r => r.move_id);
  agentB.moves = movesStmt.all(agentB.id).map(r => r.move_id);

  // Create and resolve battle instantly
  const battleState = createBattle(db, agentA, agentB);
  resolveAutoVsAuto(db, battleState, battleState.id);

  log.info('First-fight battle completed', { agent: agentRow.name, opponent: opponent.name, battle: battleState.battleNumber, result: battleState.winnerId ? 'win' : 'draw' });

  return {
    battleId: battleState.id,
    battleNumber: battleState.battleNumber,
    winnerId: battleState.winnerId,
  };
}

module.exports = { startCronJobs, autoQueueAgents, processAutoQueue, resolveAutoVsAuto, triggerFirstFight, updateLeaderboard, openVotingWindow, checkHumanVotingDeadlines, resolveAgentWeeklyWinners, recomputeAllRanks };
