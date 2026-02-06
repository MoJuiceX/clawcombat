const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/schema');
const { authenticateAgent } = require('../middleware/auth');
const { authenticateHuman } = require('../middleware/clerk-auth');
const { getCurrentWeekKey, getTimeUntilVotingEnd } = require('../utils/voting-window');
const { awardXP, XP_AMOUNTS } = require('../utils/reputation-xp-system');

const router = express.Router();

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 20;

// ── Helper: paginate ──
function paginate(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ── Helper: update "winning" status for current week ──
// Only the #1 proposal per pool per week gets "winning". All others stay "active".
function updateWeeklyWinners(db) {
  const week = getCurrentWeekKey();

  // Human pool: find top proposal this week
  const humanTop = db.prepare(`
    SELECT id FROM governance_human_proposals
    WHERE voting_cycle_week = ? AND status IN ('active', 'winning')
    ORDER BY (votes_up - votes_down) DESC, created_at ASC
    LIMIT 1
  `).get(week);

  // Reset all human proposals this week to active, then mark winner
  db.prepare(`
    UPDATE governance_human_proposals
    SET status = 'active'
    WHERE voting_cycle_week = ? AND status = 'winning'
  `).run(week);

  if (humanTop) {
    db.prepare(`
      UPDATE governance_human_proposals SET status = 'winning' WHERE id = ?
    `).run(humanTop.id);
  }

  // Agent pool: same logic
  const agentTop = db.prepare(`
    SELECT id FROM governance_agent_proposals
    WHERE voting_cycle_week = ? AND status IN ('active', 'winning')
    ORDER BY (votes_up - votes_down) DESC, created_at ASC
    LIMIT 1
  `).get(week);

  db.prepare(`
    UPDATE governance_agent_proposals
    SET status = 'active'
    WHERE voting_cycle_week = ? AND status = 'winning'
  `).run(week);

  if (agentTop) {
    db.prepare(`
      UPDATE governance_agent_proposals SET status = 'winning' WHERE id = ?
    `).run(agentTop.id);
  }
}

// ════════════════════════════════════════
// HUMAN GOVERNANCE (6 endpoints) - 24h per-proposal voting
// ════════════════════════════════════════

// POST /governance/human/propose
router.post('/human/propose', authenticateHuman, (req, res) => {
  const db = getDb();
  const { title, description } = req.body;
  const userId = req.human.id;

  if (!title || title.trim().length < 10 || title.trim().length > 100) {
    return res.status(400).json({ error: 'Title must be 10-100 characters' });
  }
  if (description && (description.trim().length < 20 || description.trim().length > 500)) {
    return res.status(400).json({ error: 'Description must be 20-500 characters' });
  }
  // Reject HTML/script injection attempts
  const htmlPattern = /<[^>]*>|javascript:|on\w+\s*=/i;
  if (htmlPattern.test(title) || (description && htmlPattern.test(description))) {
    return res.status(400).json({ error: 'HTML and script content is not allowed' });
  }

  // Rate limit: 1 proposal per 24h per user
  const recent = db.prepare(`
    SELECT created_at FROM governance_human_proposals
    WHERE creator_id = ? AND created_at > datetime('now', '-24 hours')
    ORDER BY created_at DESC LIMIT 1
  `).get(userId);

  if (recent) {
    const createdAt = new Date(recent.created_at).getTime();
    const nextAvailable = createdAt + 86400000;
    const remaining = nextAvailable - Date.now();
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return res.status(429).json({
      error: `You can propose again in ${hours}h ${minutes}m`,
      next_proposal_available: new Date(nextAvailable).toISOString()
    });
  }

  // System max: 10 active voting proposals
  const activeCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM governance_human_proposals
    WHERE status = 'voting' AND vote_end_time > datetime('now')
  `).get().cnt;

  if (activeCount >= 10) {
    return res.status(429).json({ error: 'Max 10 active proposals. Try again when one finishes voting.' });
  }

  const id = 'prop_h_' + crypto.randomUUID().split('-')[0];
  const now = new Date().toISOString();
  const voteEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO governance_human_proposals
    (id, title, description, creator_id, status, vote_start_time, vote_end_time, created_at)
    VALUES (?, ?, ?, ?, 'voting', ?, ?, ?)
  `).run(id, title.trim(), description ? description.trim() : null, userId, now, voteEnd, now);

  res.status(201).json({
    success: true,
    proposal: {
      id,
      title: title.trim(),
      description: description ? description.trim() : null,
      creator_id: userId,
      status: 'voting',
      votes_up: 0,
      votes_down: 0,
      created_at: now,
      vote_end_time: voteEnd,
      time_remaining_hours: 24,
      time_remaining_minutes: 0
    },
    message: 'Proposal created! Voting for 24 hours.'
  });
});

// GET /governance/human/proposals
router.get('/human/proposals', (req, res) => {
  const db = getDb();
  const { page, limit, offset } = paginate(req);
  const VALID_STATUSES = ['voting', 'approved', 'rejected', 'expired', 'pending'];
  const rawStatus = req.query.status || 'voting';
  const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : 'voting';
  const now = new Date();

  let whereClause, params;
  if (status === 'voting') {
    whereClause = "WHERE status = 'voting' AND vote_end_time > datetime('now')";
    params = [];
  } else {
    whereClause = 'WHERE status = ?';
    params = [status];
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM governance_human_proposals ${whereClause}`).get(...params).cnt;
  const proposals = db.prepare(`
    SELECT * FROM governance_human_proposals ${whereClause}
    ORDER BY (votes_up - votes_down) DESC, created_at ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({
    proposals: proposals.map(p => {
      const endTime = p.vote_end_time ? new Date(p.vote_end_time).getTime() : 0;
      const remaining = Math.max(0, endTime - now.getTime());
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        creator_id: p.creator_id,
        votes_up: p.votes_up,
        votes_down: p.votes_down,
        net_votes: p.votes_up - p.votes_down,
        status: p.status,
        created_at: p.created_at,
        vote_end_time: p.vote_end_time,
        time_remaining_hours: Math.floor(remaining / 3600000),
        time_remaining_minutes: Math.floor((remaining % 3600000) / 60000)
      };
    }),
    total,
    page,
    has_next: offset + limit < total
  });
});

// POST /governance/human/vote
router.post('/human/vote', authenticateHuman, (req, res) => {
  const db = getDb();
  const { proposal_id, direction } = req.body;
  const human_id = req.human.id;

  if (!proposal_id) return res.status(400).json({ error: 'proposal_id is required' });
  if (!direction || !['up', 'down'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }

  // Check proposal exists and is still voting
  const proposal = db.prepare(`
    SELECT * FROM governance_human_proposals
    WHERE id = ? AND status = 'voting' AND vote_end_time > datetime('now')
  `).get(proposal_id);

  if (!proposal) {
    return res.status(400).json({ error: 'Proposal not found or voting has ended' });
  }

  // Check existing vote in dedicated human votes table
  const existing = db.prepare(
    'SELECT * FROM governance_human_votes WHERE proposal_id = ? AND user_id = ?'
  ).get(proposal_id, human_id);

  // Column mapping to avoid SQL interpolation
  const VOTE_COLUMNS = { up: 'votes_up', down: 'votes_down' };

  if (existing) {
    if (existing.vote_direction === direction) {
      // Same vote = toggle off (remove)
      db.prepare('DELETE FROM governance_human_votes WHERE id = ?').run(existing.id);
      if (direction === 'up') {
        db.prepare('UPDATE governance_human_proposals SET votes_up = MAX(0, votes_up - 1) WHERE id = ?').run(proposal_id);
      } else {
        db.prepare('UPDATE governance_human_proposals SET votes_down = MAX(0, votes_down - 1) WHERE id = ?').run(proposal_id);
      }
    } else {
      // Different vote = switch
      db.prepare('UPDATE governance_human_votes SET vote_direction = ?, voted_at = CURRENT_TIMESTAMP WHERE id = ?').run(direction, existing.id);
      if (existing.vote_direction === 'up' && direction === 'down') {
        db.prepare('UPDATE governance_human_proposals SET votes_up = MAX(0, votes_up - 1), votes_down = votes_down + 1 WHERE id = ?').run(proposal_id);
      } else {
        db.prepare('UPDATE governance_human_proposals SET votes_down = MAX(0, votes_down - 1), votes_up = votes_up + 1 WHERE id = ?').run(proposal_id);
      }
    }
  } else {
    // New vote
    const voteId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO governance_human_votes (id, proposal_id, user_id, vote_direction)
      VALUES (?, ?, ?, ?)
    `).run(voteId, proposal_id, human_id, direction);
    if (direction === 'up') {
      db.prepare('UPDATE governance_human_proposals SET votes_up = votes_up + 1 WHERE id = ?').run(proposal_id);
    } else {
      db.prepare('UPDATE governance_human_proposals SET votes_down = votes_down + 1 WHERE id = ?').run(proposal_id);
    }
  }

  const updated = db.prepare('SELECT * FROM governance_human_proposals WHERE id = ?').get(proposal_id);

  res.json({
    success: true,
    proposal_id,
    title: updated.title,
    votes_up: updated.votes_up,
    votes_down: updated.votes_down,
    net_votes: updated.votes_up - updated.votes_down,
    your_vote: existing && existing.vote_direction === direction ? null : direction,
    status: updated.status
  });
});

// GET /governance/human/proposal/:proposalId
router.get('/human/proposal/:proposalId', (req, res) => {
  const db = getDb();
  const proposal = db.prepare('SELECT * FROM governance_human_proposals WHERE id = ?').get(req.params.proposalId);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

  const now = Date.now();
  const endTime = proposal.vote_end_time ? new Date(proposal.vote_end_time).getTime() : 0;
  const remaining = Math.max(0, endTime - now);

  // Get voter's vote if human_id provided
  const humanId = req.query.human_id;
  let yourVote = null;
  if (humanId) {
    const vote = db.prepare('SELECT vote_direction FROM governance_human_votes WHERE proposal_id = ? AND user_id = ?').get(proposal.id, humanId);
    yourVote = vote ? vote.vote_direction : null;
  }

  const totalVoters = db.prepare('SELECT COUNT(*) as cnt FROM governance_human_votes WHERE proposal_id = ?').get(proposal.id).cnt;

  res.json({
    proposal: {
      id: proposal.id,
      title: proposal.title,
      description: proposal.description,
      creator_id: proposal.creator_id,
      votes_up: proposal.votes_up,
      votes_down: proposal.votes_down,
      net_votes: proposal.votes_up - proposal.votes_down,
      status: proposal.status,
      created_at: proposal.created_at,
      vote_end_time: proposal.vote_end_time,
      time_remaining_hours: Math.floor(remaining / 3600000),
      time_remaining_minutes: Math.floor((remaining % 3600000) / 60000),
      total_voters: totalVoters,
      your_vote: yourVote
    }
  });
});

// GET /governance/human/my-proposals
router.get('/human/my-proposals', authenticateHuman, (req, res) => {
  const db = getDb();
  const human_id = req.human.id;

  const proposals = db.prepare(`
    SELECT * FROM governance_human_proposals
    WHERE creator_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(human_id);

  // Check if they can propose now
  const recent = db.prepare(`
    SELECT created_at FROM governance_human_proposals
    WHERE creator_id = ? AND created_at > datetime('now', '-24 hours')
    ORDER BY created_at DESC LIMIT 1
  `).get(human_id);

  let canProposeNow = true;
  let nextProposalAvailable = null;
  if (recent) {
    canProposeNow = false;
    const createdAt = new Date(recent.created_at).getTime();
    nextProposalAvailable = new Date(createdAt + 86400000).toISOString();
  }

  res.json({
    proposals: proposals.map(p => ({
      id: p.id,
      title: p.title,
      status: p.status,
      votes_up: p.votes_up,
      votes_down: p.votes_down,
      net_votes: p.votes_up - p.votes_down,
      created_at: p.created_at,
      vote_end_time: p.vote_end_time
    })),
    can_propose_now: canProposeNow,
    next_proposal_available: nextProposalAvailable
  });
});

// GET /governance/human/my-votes
router.get('/human/my-votes', authenticateHuman, (req, res) => {
  const db = getDb();
  const human_id = req.human.id;

  const votes = db.prepare(`
    SELECT v.*, p.title as proposal_title, p.status as proposal_status,
           p.votes_up, p.votes_down
    FROM governance_human_votes v
    JOIN governance_human_proposals p ON v.proposal_id = p.id
    WHERE v.user_id = ?
    ORDER BY v.voted_at DESC
    LIMIT 50
  `).all(human_id);

  res.json({
    votes: votes.map(v => ({
      proposal_id: v.proposal_id,
      proposal_title: v.proposal_title,
      vote_direction: v.vote_direction,
      voted_at: v.voted_at,
      proposal_status: v.proposal_status
    })),
    total: votes.length
  });
});

// ════════════════════════════════════════
// AGENT GOVERNANCE (4 endpoints)
// ════════════════════════════════════════

// POST /governance/agent/propose
router.post('/agent/propose', authenticateAgent, (req, res) => {
  const db = getDb();
  const { title, description } = req.body;
  const agentId = req.agent.id;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }

  const id = 'prop_a_' + crypto.randomUUID().split('-')[0];
  const week = getCurrentWeekKey();
  const timeLeft = getTimeUntilVotingEnd();

  db.prepare(`
    INSERT INTO governance_agent_proposals (id, title, description, creator_id, voting_cycle_week)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, title.trim(), description ? description.trim() : null, agentId, week);

  // Award XP for proposing
  awardXP(agentId, 'propose', XP_AMOUNTS.propose, `Proposed: ${title.trim()}`);

  updateWeeklyWinners(db);

  res.status(201).json({
    proposal_id: id,
    pool: 'agent',
    title: title.trim(),
    description: description ? description.trim() : null,
    votes_up: 0,
    votes_down: 0,
    status: 'active',
    voting_closes_in: `${timeLeft.days}d ${timeLeft.hours}h`,
    share_command: `/vote ${id} up`
  });
});

// GET /governance/agent/proposals
router.get('/agent/proposals', (req, res) => {
  const db = getDb();
  const { page, limit, offset } = paginate(req);
  const week = getCurrentWeekKey();
  const timeLeft = getTimeUntilVotingEnd();

  const showAll = req.query.all === 'true';

  let total, proposals;
  if (showAll) {
    total = db.prepare('SELECT COUNT(*) as cnt FROM governance_agent_proposals').get().cnt;
    proposals = db.prepare(`
      SELECT p.*, a.name as creator_name FROM governance_agent_proposals p
      LEFT JOIN agents a ON p.creator_id = a.id
      ORDER BY
        CASE p.status WHEN 'winning' THEN 0 WHEN 'active' THEN 1 WHEN 'implementing' THEN 2 WHEN 'implemented' THEN 3 ELSE 4 END,
        (p.votes_up - p.votes_down) DESC, p.created_at ASC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  } else {
    total = db.prepare('SELECT COUNT(*) as cnt FROM governance_agent_proposals WHERE voting_cycle_week = ?').get(week).cnt;
    proposals = db.prepare(`
      SELECT p.*, a.name as creator_name FROM governance_agent_proposals p
      LEFT JOIN agents a ON p.creator_id = a.id
      WHERE p.voting_cycle_week = ?
      ORDER BY
        CASE p.status WHEN 'winning' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
        (p.votes_up - p.votes_down) DESC, p.created_at ASC
      LIMIT ? OFFSET ?
    `).all(week, limit, offset);
  }

  const totalPages = Math.ceil(total / limit);

  res.json({
    pool: 'agent',
    page,
    total_pages: totalPages,
    total_proposals: total,
    voting_closes_in: { days: timeLeft.days, hours: timeLeft.hours, minutes: timeLeft.minutes },
    proposals: proposals.map(p => ({
      proposal_id: p.id,
      title: p.title,
      description: p.description,
      creator_id: p.creator_id,
      creator_name: p.creator_name,
      votes_up: p.votes_up,
      votes_down: p.votes_down,
      net_votes: p.votes_up - p.votes_down,
      status: p.status,
      created_at: p.created_at
    }))
  });
});

// POST /governance/agent/vote
router.post('/agent/vote', authenticateAgent, (req, res) => {
  const db = getDb();
  const agentId = req.agent.id;
  const { proposal_id, direction } = req.body;

  if (!proposal_id) return res.status(400).json({ error: 'proposal_id is required' });
  if (!direction || !['up', 'down'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }

  const proposal = db.prepare('SELECT * FROM governance_agent_proposals WHERE id = ?').get(proposal_id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

  const existing = db.prepare('SELECT * FROM governance_votes WHERE proposal_id = ? AND voter_id = ?').get(proposal_id, agentId);

  if (existing) {
    if (existing.vote_direction === direction) {
      db.prepare('DELETE FROM governance_votes WHERE id = ?').run(existing.id);
      if (direction === 'up') {
        db.prepare('UPDATE governance_agent_proposals SET votes_up = MAX(0, votes_up - 1) WHERE id = ?').run(proposal_id);
      } else {
        db.prepare('UPDATE governance_agent_proposals SET votes_down = MAX(0, votes_down - 1) WHERE id = ?').run(proposal_id);
      }
    } else {
      db.prepare('UPDATE governance_votes SET vote_direction = ?, voted_at = CURRENT_TIMESTAMP WHERE id = ?').run(direction, existing.id);
      if (existing.vote_direction === 'up' && direction === 'down') {
        db.prepare('UPDATE governance_agent_proposals SET votes_up = MAX(0, votes_up - 1), votes_down = votes_down + 1 WHERE id = ?').run(proposal_id);
      } else {
        db.prepare('UPDATE governance_agent_proposals SET votes_down = MAX(0, votes_down - 1), votes_up = votes_up + 1 WHERE id = ?').run(proposal_id);
      }
    }
  } else {
    const voteId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO governance_votes (id, proposal_id, pool, voter_id, vote_direction)
      VALUES (?, ?, 'agent', ?, ?)
    `).run(voteId, proposal_id, agentId, direction);
    if (direction === 'up') {
      db.prepare('UPDATE governance_agent_proposals SET votes_up = votes_up + 1 WHERE id = ?').run(proposal_id);
    } else {
      db.prepare('UPDATE governance_agent_proposals SET votes_down = votes_down + 1 WHERE id = ?').run(proposal_id);
    }
  }

  updateWeeklyWinners(db);

  const updated = db.prepare('SELECT * FROM governance_agent_proposals WHERE id = ?').get(proposal_id);
  const timeLeft = getTimeUntilVotingEnd();

  res.json({
    proposal_id,
    title: updated.title,
    votes_up: updated.votes_up,
    votes_down: updated.votes_down,
    net_votes: updated.votes_up - updated.votes_down,
    status: updated.status,
    voting_closes_in: `${timeLeft.days}d ${timeLeft.hours}h`
  });
});

// GET /governance/agent/status
router.get('/agent/status', authenticateAgent, (req, res) => {
  const db = getDb();
  const agentId = req.agent.id;
  const timeLeft = getTimeUntilVotingEnd();

  const proposalsCreated = db.prepare('SELECT * FROM governance_agent_proposals WHERE creator_id = ? ORDER BY created_at DESC').all(agentId);
  const votesUp = db.prepare("SELECT COUNT(*) as cnt FROM governance_votes WHERE voter_id = ? AND pool = 'agent' AND vote_direction = 'up'").get(agentId).cnt;
  const votesDown = db.prepare("SELECT COUNT(*) as cnt FROM governance_votes WHERE voter_id = ? AND pool = 'agent' AND vote_direction = 'down'").get(agentId).cnt;
  const totalAgents = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'active'").get().cnt;
  const totalHumans = db.prepare("SELECT COUNT(DISTINCT voter_id) as cnt FROM governance_votes WHERE pool = 'human'").get().cnt;

  let reputation = 'New';
  const totalVotes = votesUp + votesDown;
  if (totalVotes >= 100) reputation = 'Expert';
  else if (totalVotes >= 50) reputation = 'Veteran';
  else if (totalVotes >= 10) reputation = 'Trusted';
  else if (totalVotes >= 3) reputation = 'Active';

  const building = db.prepare("SELECT * FROM governance_human_proposals WHERE status = 'implementing' LIMIT 1").get()
    || db.prepare("SELECT * FROM governance_agent_proposals WHERE status = 'implementing' LIMIT 1").get();

  res.json({
    agent_id: agentId,
    agent_name: req.agent.name,
    proposals_created: proposalsCreated.map(p => ({
      proposal_id: p.id,
      title: p.title,
      status: p.status,
      net_votes: p.votes_up - p.votes_down
    })),
    votes_cast: { total: totalVotes, up: votesUp, down: votesDown },
    voting_power: '1 vote = 1 point',
    reputation,
    currently_building: building ? { proposal_id: building.id, title: building.title } : null,
    voting_closes_in: { days: timeLeft.days, hours: timeLeft.hours },
    total_agents: totalAgents,
    total_humans: totalHumans
  });
});

// ════════════════════════════════════════
// SHARED (3 endpoints)
// ════════════════════════════════════════

// GET /governance/queue
router.get('/queue', (req, res) => {
  const db = getDb();
  const week = getCurrentWeekKey();
  const timeLeft = getTimeUntilVotingEnd();

  // Build queue items (human proposals that won 24h voting)
  const buildItems = db.prepare(`
    SELECT * FROM build_queue
    WHERE status IN ('queued', 'building')
    ORDER BY added_at ASC
  `).all();

  // Agent weekly winner
  const agentWinner = db.prepare(`
    SELECT * FROM governance_agent_proposals
    WHERE voting_cycle_week = ? AND status = 'winning'
    LIMIT 1
  `).get(week);

  // Currently implementing from any source
  const implementing = [
    ...db.prepare("SELECT *, 'human' as pool FROM governance_human_proposals WHERE status = 'implementing'").all(),
    ...db.prepare("SELECT *, 'agent' as pool FROM governance_agent_proposals WHERE status = 'implementing'").all()
  ];

  const queue = [];
  let position = 1;

  // Currently implementing goes first
  for (const p of implementing) {
    queue.push({
      position: position++,
      pool: p.pool,
      proposal_id: p.id,
      title: p.title,
      net_votes: p.votes_up - p.votes_down,
      status: 'implementing'
    });
  }

  // Human won proposals from build queue (batch query to fix N+1)
  const buildProposalIds = buildItems.map(i => i.proposal_id).filter(Boolean);
  const proposalMap = {};
  if (buildProposalIds.length > 0) {
    const placeholders = buildProposalIds.map(() => '?').join(',');
    const proposals = db.prepare(`SELECT * FROM governance_human_proposals WHERE id IN (${placeholders})`).all(...buildProposalIds);
    for (const p of proposals) {
      proposalMap[p.id] = p;
    }
  }

  for (const item of buildItems) {
    const proposal = proposalMap[item.proposal_id];
    if (proposal) {
      queue.push({
        position: position++,
        pool: 'human',
        proposal_id: proposal.id,
        title: proposal.title || item.title,
        votes_up: proposal.votes_up,
        votes_down: proposal.votes_down,
        net_votes: proposal.votes_up - proposal.votes_down,
        status: item.status,
        added_at: item.added_at
      });
    }
  }

  // Agent weekly winner
  if (agentWinner && agentWinner.status !== 'implementing') {
    queue.push({
      position: position++,
      pool: 'agent',
      proposal_id: agentWinner.id,
      title: agentWinner.title,
      votes_up: agentWinner.votes_up,
      votes_down: agentWinner.votes_down,
      net_votes: agentWinner.votes_up - agentWinner.votes_down,
      status: 'winning'
    });
  }

  res.json({
    queue,
    agent_voting_closes_in: { days: timeLeft.days, hours: timeLeft.hours, minutes: timeLeft.minutes },
    message: 'All proposals run on 24-hour voting cycles. Winners announced daily.',
    summary: {
      implementing: implementing.length,
      queued: buildItems.length,
      total: queue.length
    }
  });
});

// GET /governance/completed
router.get('/completed', (req, res) => {
  const db = getDb();
  const limit = Math.min(50, parseInt(req.query.limit) || 20);

  const completed = db.prepare(`
    SELECT * FROM governance_completed
    ORDER BY shipped_at DESC
    LIMIT ?
  `).all(limit);

  const implementedHuman = db.prepare("SELECT * FROM governance_human_proposals WHERE status = 'implemented' ORDER BY created_at DESC").all();
  const implementedAgent = db.prepare("SELECT * FROM governance_agent_proposals WHERE status = 'implemented' ORDER BY created_at DESC").all();

  const allCompleted = [
    ...completed.map(c => ({
      proposal_id: c.proposal_id,
      pool: c.pool,
      title: c.title,
      builders: c.builders ? JSON.parse(c.builders) : [],
      total_votes: c.total_votes,
      shipped_at: c.shipped_at,
      impact: c.impact_description
    })),
    ...implementedHuman.filter(p => !completed.find(c => c.proposal_id === p.id)).map(p => ({
      proposal_id: p.id,
      pool: 'human',
      title: p.title,
      net_votes: p.votes_up - p.votes_down,
      status: 'implemented'
    })),
    ...implementedAgent.filter(p => !completed.find(c => c.proposal_id === p.id)).map(p => ({
      proposal_id: p.id,
      pool: 'agent',
      title: p.title,
      net_votes: p.votes_up - p.votes_down,
      status: 'implemented'
    }))
  ];

  res.json({
    total_shipped: allCompleted.length,
    features: allCompleted
  });
});

// PERFORMANCE: Cache governance stats with 60s TTL (12+ queries are expensive)
let governanceStatsCache = null;
let governanceStatsCacheTime = 0;
const GOVERNANCE_STATS_CACHE_TTL = 60 * 1000; // 60 seconds

// GET /governance/stats
router.get('/stats', (req, res) => {
  const now = Date.now();

  // Return cached data if fresh
  if (governanceStatsCache && (now - governanceStatsCacheTime) < GOVERNANCE_STATS_CACHE_TTL) {
    return res.json(governanceStatsCache);
  }

  const db = getDb();
  const week = getCurrentWeekKey();
  const timeLeft = getTimeUntilVotingEnd();

  const humanProposals = db.prepare('SELECT COUNT(*) as cnt FROM governance_human_proposals').get().cnt;
  const humanVoting = db.prepare("SELECT COUNT(*) as cnt FROM governance_human_proposals WHERE status = 'voting' AND vote_end_time > datetime('now')").get().cnt;
  const humanWon = db.prepare("SELECT COUNT(*) as cnt FROM governance_human_proposals WHERE status = 'won'").get().cnt;
  const agentProposals = db.prepare('SELECT COUNT(*) as cnt FROM governance_agent_proposals').get().cnt;
  const agentThisWeek = db.prepare('SELECT COUNT(*) as cnt FROM governance_agent_proposals WHERE voting_cycle_week = ?').get(week).cnt;
  const humanVotes = db.prepare('SELECT COUNT(*) as cnt FROM governance_human_votes').get().cnt;
  const agentVotes = db.prepare("SELECT COUNT(*) as cnt FROM governance_votes WHERE pool = 'agent'").get().cnt;
  const uniqueHumanVoters = db.prepare('SELECT COUNT(DISTINCT user_id) as cnt FROM governance_human_votes').get().cnt;
  const uniqueAgentVoters = db.prepare("SELECT COUNT(DISTINCT voter_id) as cnt FROM governance_votes WHERE pool = 'agent'").get().cnt;
  const agentWinning = db.prepare("SELECT COUNT(*) as cnt FROM governance_agent_proposals WHERE status = 'winning' AND voting_cycle_week = ?").get(week).cnt;
  const completed = db.prepare('SELECT COUNT(*) as cnt FROM governance_completed').get().cnt;
  const buildQueueSize = db.prepare("SELECT COUNT(*) as cnt FROM build_queue WHERE status = 'queued'").get().cnt;
  const totalAgents = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'active'").get().cnt;

  governanceStatsCache = {
    human_pool: {
      cycle_type: '24h per-proposal',
      total_proposals: humanProposals,
      currently_voting: humanVoting,
      won: humanWon,
      total_votes: humanVotes,
      unique_voters: uniqueHumanVoters
    },
    agent_pool: {
      cycle_type: '24h',
      closes_in: { days: timeLeft.days, hours: timeLeft.hours, minutes: timeLeft.minutes },
      total_proposals: agentProposals,
      this_week: agentThisWeek,
      total_votes: agentVotes,
      unique_voters: uniqueAgentVoters,
      current_winner: agentWinning > 0
    },
    totals: {
      all_proposals: humanProposals + agentProposals,
      all_votes: humanVotes + agentVotes,
      features_shipped: completed,
      build_queue: buildQueueSize,
      active_agents: totalAgents
    }
  };
  governanceStatsCacheTime = now;

  res.json(governanceStatsCache);
});

module.exports = router;
