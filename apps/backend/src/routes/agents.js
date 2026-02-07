const log = require('../utils/logger').createLogger('AGENTS');
const express = require('express');
const uuidv4 = () => require('crypto').randomUUID();
const crypto = require('crypto');
const { getDb } = require('../db/schema');
const { authenticateAgent, hashApiKey } = require('../middleware/auth');
const { authenticateHuman, optionalHumanAuth } = require('../middleware/clerk-auth');
const { getAgentXP, getXPLogs } = require('../utils/reputation-xp-system');
const { processLoginReward, getLoginStreakStatus, getAllLoginRewards } = require('../services/login-rewards');
const { xpToNextLevel } = require('../services/xp-calculator');
const { getAgentAchievements } = require('../utils/achievements');
const {
  VALID_TYPES, TYPE_EMOJIS, TYPE_ADVANTAGES, TYPE_WEAKNESSES,
  NATURES, TYPE_ABILITIES, STAT_NAMES,
  randomNature, randomAbility, validateBaseStats,
  calculateAllEffectiveStats,
} = require('../utils/type-system');
const { getMovesForType, getMovePoolForType, getMoveById, getMovesByIds, validateMoveSelection, randomMovesForType } = require('../data/moves');
const { buildSkinPrompt, hashAgentStats } = require('../services/skin-generator');
const { generateFreeAvatar } = require('../services/image-gen');
const { assignImage } = require('../services/image-assigner');
const { STAT_TOKEN_CAP, RESPEC_MILESTONES, getStatTokenInfo, validateTokenAllocation } = require('../config/stat-scaling');
const { invalidateAgent, invalidateAgentByKey } = require('../services/agent-cache');
const { MS_PER_DAY } = require('../config/constants');
const { sanitizeAgentName, sanitizeText, sanitizeUrl } = require('../utils/sanitize');

const router = express.Router();

// GET /agents/types - List all 18 types with advantages/weaknesses
router.get('/types', (req, res) => {
  const types = VALID_TYPES.map(t => ({
    type: t,
    emoji: TYPE_EMOJIS[t],
    strong_against: TYPE_ADVANTAGES[t],
    weak_to: TYPE_WEAKNESSES[t],
    abilities: TYPE_ABILITIES[t].map(a => ({ name: a.name, description: a.desc })),
  }));
  res.json({ types, total: types.length });
});

// GET /agents/natures - List all 25 ClawCombat natures
router.get('/natures', (req, res) => {
  res.json({ natures: NATURES.map(n => ({ name: n.name, description: n.desc })), total: NATURES.length });
});

// GET /agents/moves/pool/:type - Get the move pool for a type (~10-12 moves to choose from)
router.get('/moves/pool/:type', (req, res) => {
  const type = req.params.type.toUpperCase();
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
  }
  const pool = getMovePoolForType(type);
  res.json({
    type,
    total: pool.length,
    moves: pool.map(m => ({
      id: m.id,
      name: m.name,
      type: m.type,
      category: m.category,
      power: m.power,
      accuracy: m.accuracy,
      pp: m.pp,
      effect: m.effect,
      description: m.description,
    })),
  });
});

const MAX_AGENTS_PER_OWNER = 5;

// POST /agents/register - Bot self-registration (optionally link to Clerk user)
// Pass { auto: true } to randomize everything (name, type, stats)
router.post('/register', optionalHumanAuth, async (req, res) => {
  try {
  const isAuto = req.body.auto === true;

  // Accept both snake_case and camelCase
  let name = sanitizeAgentName(req.body.name);
  const model_type = sanitizeText(req.body.model_type || req.body.modelType, { maxLength: 100 });
  const model_version = sanitizeText(req.body.model_version || req.body.modelVersion, { maxLength: 50 });
  const webhook_url = sanitizeUrl(req.body.webhook_url || req.body.webhookUrl);
  let ai_type = (req.body.ai_type || req.body.type || 'NEUTRAL').toUpperCase();
  const ownerId = req.human ? req.human.id : (req.body.owner_id || null);

  // Base stats: accept object or default to balanced distribution
  let base_stats = req.body.base_stats || req.body.stats;

  // Auto mode: randomize everything
  if (isAuto) {
    ai_type = VALID_TYPES[Math.floor(Math.random() * VALID_TYPES.length)];
    const prefixes = ['Claw', 'Shell', 'Reef', 'Tide', 'Snap', 'Pinch', 'Coral', 'Kelp'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = crypto.randomBytes(3).toString('hex').slice(0, 4);
    name = name || `${prefix}Bot-${suffix}`;

    // Random stat distribution (total 100)
    const stats = { hp: 10, attack: 10, defense: 10, sp_atk: 10, sp_def: 10, speed: 10 };
    let remaining = 40;
    const keys = Object.keys(stats);
    while (remaining > 0) {
      const key = keys[Math.floor(Math.random() * keys.length)];
      const add = Math.min(remaining, Math.floor(Math.random() * 8) + 1);
      if (stats[key] + add <= 35) { stats[key] += add; remaining -= add; }
    }
    base_stats = stats;
  }

  if (!name) {
    return res.status(400).json({ error: 'Bot name is required' });
  }

  if (name.length < 3 || name.length > 50) {
    return res.status(400).json({ error: 'Bot name must be 3-50 characters' });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Bot name must be alphanumeric (dashes and underscores allowed)' });
  }

  if (webhook_url) {
    try {
      const parsed = new URL(webhook_url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'webhook_url must be HTTP or HTTPS' });
      }
      const host = parsed.hostname.toLowerCase();
      if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|::1|169\.254\.)/.test(host) || host === '[::1]') {
        return res.status(400).json({ error: 'webhook_url cannot point to private/local network' });
      }
    } catch {
      return res.status(400).json({ error: 'webhook_url must be a valid HTTP/HTTPS URL' });
    }
  }

  // Validate type
  if (!VALID_TYPES.includes(ai_type)) {
    return res.status(400).json({
      error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`,
      valid_types: VALID_TYPES,
    });
  }

  // Validate or default base stats
  if (base_stats && typeof base_stats === 'object') {
    const errors = validateBaseStats(base_stats);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Invalid base stats', details: errors });
    }
  } else {
    // Default balanced distribution: 16+17+17+17+17+16 = 100
    base_stats = { hp: 16, attack: 17, defense: 17, sp_atk: 17, sp_def: 17, speed: 16 };
  }

  const db = getDb();

  // Enforce 5-agent limit per owner
  if (ownerId) {
    const owned = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE owner_id = ? AND status = 'active'").get(ownerId).cnt;
    if (owned >= MAX_AGENTS_PER_OWNER) {
      return res.status(403).json({
        error: `Maximum ${MAX_AGENTS_PER_OWNER} agents per user. Retire an agent first.`,
        current_count: owned,
        max: MAX_AGENTS_PER_OWNER,
      });
    }
  }

  const existing = db.prepare('SELECT id FROM agents WHERE name = ?').get(name);
  if (existing) {
    return res.status(409).json({ error: 'Bot name already taken' });
  }

  const id = uuidv4();
  const api_key = 'clw_sk_' + crypto.randomBytes(32).toString('hex');
  const api_key_hash = hashApiKey(api_key);
  const webhook_secret = crypto.randomBytes(24).toString('hex');

  // Random nature assignment
  const nature = randomNature();

  // Ability: player choice or random
  const chosenAbility = req.body.ability;
  let ability;
  if (chosenAbility && !isAuto) {
    const typeAbilities = TYPE_ABILITIES[ai_type] || [];
    ability = typeAbilities.find(a => a.name.toLowerCase() === chosenAbility.toLowerCase());
    if (!ability) {
      return res.status(400).json({
        error: `Invalid ability for type ${ai_type}. Choose one of: ${typeAbilities.map(a => a.name).join(', ')}`,
        available_abilities: typeAbilities.map(a => ({ name: a.name, description: a.desc })),
      });
    }
  } else {
    ability = randomAbility(ai_type);
  }

  // Anonymous (demo) agents get play_mode='manual' so they don't auto-queue
  const playMode = ownerId ? 'auto' : 'manual';

  // Build agent object to calculate effective stats (before transaction)
  const agentForCalc = {
    ai_type, nature_name: nature.name, nature_boost: nature.boost, nature_reduce: nature.reduce,
    base_hp: base_stats.hp, base_attack: base_stats.attack, base_defense: base_stats.defense,
    base_sp_atk: base_stats.sp_atk, base_sp_def: base_stats.sp_def, base_speed: base_stats.speed,
    ev_hp: 0, ev_attack: 0, ev_defense: 0, ev_sp_atk: 0, ev_sp_def: 0, ev_speed: 0,
  };
  const effectiveStats = calculateAllEffectiveStats(agentForCalc);

  // Validate moves before starting transaction
  let selectedMoveIds = req.body.move_ids;
  if (selectedMoveIds && Array.isArray(selectedMoveIds) && selectedMoveIds.length === 4) {
    const validation = validateMoveSelection(selectedMoveIds, ai_type);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
  } else {
    // Auto-assign: random 4 from pool (or default first 4 if auto mode)
    selectedMoveIds = isAuto ? randomMovesForType(ai_type) : getMovesForType(ai_type).map(m => m.id);
  }

  // Prepare image assignment (before transaction, non-DB operation)
  let avatarUrl = null;
  let visualPrompt = null;
  let skinStatsHash = null;
  let assignedBase = null;
  let assignedVariant = null;
  try {
    const imageAssignment = assignImage(ai_type, base_stats);
    assignedBase = imageAssignment.base;
    assignedVariant = imageAssignment.variant;
    avatarUrl = imageAssignment.imagePath;

    const skinAgent = {
      name, ai_type, level: 1,
      base_hp: base_stats.hp, base_attack: base_stats.attack, base_defense: base_stats.defense,
      base_sp_atk: base_stats.sp_atk, base_sp_def: base_stats.sp_def, base_speed: base_stats.speed,
      ability_name: ability ? ability.name : null,
    };
    visualPrompt = buildSkinPrompt(skinAgent, 1);
    skinStatsHash = hashAgentStats(skinAgent);
  } catch (e) {
    log.error('Image assignment failed:', { agent: String(name).slice(0, 50), error: e.message });
  }

  // TRANSACTION: Wrap all database writes in a transaction for atomicity
  // If any step fails, the entire registration is rolled back
  const registerAgent = db.transaction(() => {
    // Step 1: Insert agent
    db.prepare(`
      INSERT INTO agents (
        id, name, model_type, model_version, webhook_url, api_key, webhook_secret,
        ai_type, base_hp, base_attack, base_defense, base_sp_atk, base_sp_def, base_speed,
        nature_name, nature_boost, nature_reduce, nature_desc,
        ability_name, ability_desc, ability_effect,
        owner_id, deployment_status, trial_start_at, level, play_mode
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name, model_type || null, model_version || null, webhook_url || '', api_key_hash, webhook_secret,
      ai_type, base_stats.hp, base_stats.attack, base_stats.defense, base_stats.sp_atk, base_stats.sp_def, base_stats.speed,
      nature.name, nature.boost, nature.reduce, nature.desc,
      ability ? ability.name : null, ability ? ability.desc : null, ability ? ability.effect : null,
      ownerId, 'deployed', new Date().toISOString(), 1, playMode
    );

    // Step 2: Insert moves
    const insertMove = db.prepare('INSERT INTO agent_moves (id, agent_id, move_id, slot) VALUES (?, ?, ?, ?)');
    selectedMoveIds.forEach((moveId, i) => {
      insertMove.run(crypto.randomUUID(), id, moveId, i + 1);
    });

    // Step 3: Update avatar URL if assigned
    if (avatarUrl) {
      db.prepare('UPDATE agents SET avatar_url = ?, visual_prompt = ?, skin_stats_hash = ?, skin_tier = 1 WHERE id = ?')
        .run(avatarUrl, visualPrompt, skinStatsHash, id);
      log.info('Reference image assigned', { type: ai_type, image: `${assignedBase}-${assignedVariant}` });
    }

    return true;
  });

  // Execute the transaction
  registerAgent();

  const typeMoves = getMovesByIds(selectedMoveIds);

  // Generate link code for this agent if registered by a signed-in user (after main transaction)
  let linkCode = null;
  if (ownerId) {
    linkCode = generateLinkCode(db, id, ownerId);
  }

  // SECURITY: API key shown only once at creation - warn user to save it
  res.status(201).json({
    agent_id: id,
    name,
    api_key,
    api_key_warning: 'SAVE THIS KEY NOW. It will not be shown again.',
    webhook_secret,
    status: 'active',
    deployment_status: 'deployed',
    owner_id: ownerId,
    type: {
      name: ai_type,
      emoji: TYPE_EMOJIS[ai_type],
      strong_against: TYPE_ADVANTAGES[ai_type],
      weak_to: TYPE_WEAKNESSES[ai_type],
    },
    base_stats,
    nature: { name: nature.name, description: nature.desc },
    ability: ability ? { name: ability.name, description: ability.desc } : null,
    effective_stats: effectiveStats,
    evs: { hp: 0, attack: 0, defense: 0, sp_atk: 0, sp_def: 0, speed: 0, total: 0, max: 510 },
    moves: typeMoves.map((m, i) => ({ slot: i + 1, id: m.id, name: m.name, type: m.type, category: m.category, power: m.power, accuracy: m.accuracy, pp: m.pp, description: m.description })),
    skin: { avatar_url: avatarUrl, tier: 1, prompt: visualPrompt, base: assignedBase, variant: assignedVariant },
    link_code: linkCode,
  });
  } catch (err) {
    log.error('Registration error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to register agent' });
  }
});

// GET /agents/:agent_id/stats
router.get('/:agent_id/stats', (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const effectiveStats = calculateAllEffectiveStats(agent);
  const totalEVs = STAT_NAMES.reduce((sum, s) => sum + (agent[`ev_${s}`] || 0), 0);

  res.json({
    agent_id: agent.id,
    name: agent.name,
    reputation: agent.reputation,
    xp: agent.xp || 0,
    reputation_level: agent.reputation_level || 'Newcomer',
    reputation_multiplier: agent.reputation_multiplier || 1.0,
    current_streak: agent.current_streak || 0,
    type: {
      name: agent.ai_type || 'NEUTRAL',
      emoji: TYPE_EMOJIS[agent.ai_type] || '⚪',
      strong_against: TYPE_ADVANTAGES[agent.ai_type] || [],
      weak_to: TYPE_WEAKNESSES[agent.ai_type] || [],
    },
    base_stats: {
      hp: agent.base_hp || 17, attack: agent.base_attack || 17, defense: agent.base_defense || 17,
      sp_atk: agent.base_sp_atk || 17, sp_def: agent.base_sp_def || 16, speed: agent.base_speed || 16,
    },
    nature: {
      name: agent.nature_name || 'Balanced',
      description: agent.nature_desc || 'No modifier',
    },
    ability: agent.ability_name ? {
      name: agent.ability_name,
      description: agent.ability_desc,
    } : null,
    effective_stats: effectiveStats,
    evs: {
      hp: agent.ev_hp || 0, attack: agent.ev_attack || 0, defense: agent.ev_defense || 0,
      sp_atk: agent.ev_sp_atk || 0, sp_def: agent.ev_sp_def || 0, speed: agent.ev_speed || 0,
      total: totalEVs, max: 510,
    },
    fight_stats: {
      total: agent.total_fights,
      wins: agent.total_wins,
      losses: agent.total_fights - agent.total_wins,
      win_rate: agent.total_fights > 0 ? agent.total_wins / agent.total_fights : 0
    },
  });
});

// GET /agents/:agent_id/moves - Get agent's 4 assigned moves
router.get('/:agent_id/moves', (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT id, name, ai_type FROM agents WHERE id = ?').get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const rows = db.prepare('SELECT move_id, slot FROM agent_moves WHERE agent_id = ? ORDER BY slot').all(agent.id);
  const { getMoveById } = require('../data/moves');
  const moves = rows.map(r => {
    const move = getMoveById(r.move_id);
    return move ? { slot: r.slot, ...move } : { slot: r.slot, id: r.move_id, error: 'Move not found' };
  });

  res.json({
    agent_id: agent.id,
    name: agent.name,
    type: agent.ai_type,
    moves,
  });
});

// GET /agents/:agent_id/xp - XP and reputation details
router.get('/:agent_id/xp', (req, res) => {
  const db = getDb();
  const agent = db.prepare(`
    SELECT id, name, xp, level, reputation_level, reputation_multiplier, current_streak, best_streak, win_streak, login_streak
    FROM agents WHERE id = ?
  `).get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const logs = getXPLogs(req.params.agent_id, 10);
  const xpToNext = xpToNextLevel(agent.level || 1);
  const loginStatus = getLoginStreakStatus(db, req.params.agent_id);

  res.json({
    agent: agent.name,
    level: agent.level || 1,
    xp: agent.xp || 0,
    xp_to_next_level: xpToNext,
    progress: xpToNext > 0 ? Math.round(((agent.xp || 0) / xpToNext) * 100) : 100,
    reputation_level: agent.reputation_level || 'Newcomer',
    reputation_multiplier: agent.reputation_multiplier || 1.0,
    win_streak: agent.win_streak || 0,
    current_streak: agent.current_streak || 0,
    best_streak: agent.best_streak || 0,
    login_streak: loginStatus,
    recent_xp: logs
  });
});

// POST /agents/:agent_id/login-reward - Claim daily login reward
router.post('/:agent_id/login-reward', (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const result = processLoginReward(db, req.params.agent_id);

  if (!result) {
    return res.status(500).json({ error: 'Failed to process login reward' });
  }

  res.json({
    agent: agent.name,
    ...result,
    all_rewards: getAllLoginRewards()
  });
});

// GET /agents/:agent_id/login-reward - Check login reward status
router.get('/:agent_id/login-reward', (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const status = getLoginStreakStatus(db, req.params.agent_id);

  res.json({
    agent: agent.name,
    ...status,
    all_rewards: getAllLoginRewards()
  });
});

// GET /agents/:agent_id/status - Check rate limit status and account tier (for bots)
router.get('/:agent_id/status', authenticateAgent, (req, res) => {
  const db = getDb();
  const agent = db.prepare(`
    SELECT id, name, level, elo, total_wins, total_fights, win_streak,
           is_premium, premium_expires_at, trial_start_at,
           fights_today, fights_today_date, fights_this_hour, fights_hour_start
    FROM agents WHERE id = ?
  `).get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  // Verify ownership via API key
  if (req.agent.id !== agent.id) {
    return res.status(403).json({ error: 'Not authorized to view this agent status' });
  }

  const { getFightLimitInfo, isInTrial, isPremium, TRIAL_DAYS } = require('../middleware/rate-limit');
  const limitInfo = getFightLimitInfo(agent);

  // Calculate next reset time
  let nextReset = null;
  if (limitInfo.period === 'hour') {
    const now = new Date();
    nextReset = new Date(now);
    nextReset.setMinutes(0, 0, 0);
    nextReset.setHours(nextReset.getHours() + 1);
  } else if (limitInfo.period === 'day') {
    const now = new Date();
    nextReset = new Date(now);
    nextReset.setUTCHours(0, 0, 0, 0);
    nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  }

  res.json({
    agent_id: agent.id,
    name: agent.name,
    level: agent.level,
    elo: agent.elo,
    stats: {
      wins: agent.total_wins,
      battles: agent.total_fights,
      win_streak: agent.win_streak
    },
    tier: limitInfo.tier,
    trial_days_left: limitInfo.trialDaysLeft || 0,
    fights_remaining: limitInfo.remaining,
    fights_limit: limitInfo.limit,
    limit_period: limitInfo.period,
    can_battle: limitInfo.allowed,
    next_reset: nextReset ? nextReset.toISOString() : null,
    upgrade_message: limitInfo.upgradeMessage || null,
    premium_expires_at: agent.premium_expires_at || null
  });
});

// ── Stat Token System Endpoints ──

// GET /agents/:agent_id/tokens - View token status and distribution
router.get('/:agent_id/tokens', (req, res) => {
  const db = getDb();
  const agent = db.prepare(`
    SELECT id, name, level,
           stat_tokens_available, stat_tokens_hp, stat_tokens_attack, stat_tokens_defense,
           stat_tokens_sp_atk, stat_tokens_sp_def, stat_tokens_speed
    FROM agents WHERE id = ?
  `).get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const tokenInfo = getStatTokenInfo(agent);

  // Calculate next level's token
  const nextLevelTokens = agent.level < 100 ? 1 : 0;

  res.json({
    agent_id: agent.id,
    name: agent.name,
    level: agent.level || 1,
    tokens: {
      available: tokenInfo.available,
      invested: tokenInfo.invested,
      total_invested: tokenInfo.totalInvested,
      cap_per_stat: tokenInfo.capPerStat,
    },
    next_level_tokens: nextLevelTokens,
    effective_bonus: tokenInfo.invested, // Each token = +1 to effective stat
  });
});

// POST /agents/:agent_id/tokens/allocate - Distribute available tokens
router.post('/:agent_id/tokens/allocate', optionalHumanAuth, (req, res) => {
  const db = getDb();
  const agent = db.prepare(`
    SELECT id, name, owner_id, level,
           stat_tokens_available, stat_tokens_hp, stat_tokens_attack, stat_tokens_defense,
           stat_tokens_sp_atk, stat_tokens_sp_def, stat_tokens_speed
    FROM agents WHERE id = ?
  `).get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  // Check ownership if authenticated
  if (req.human && agent.owner_id && agent.owner_id !== req.human.id) {
    return res.status(403).json({ error: 'You do not own this agent' });
  }

  const allocations = req.body.allocations;
  if (!allocations || typeof allocations !== 'object') {
    return res.status(400).json({ error: 'allocations object required (e.g., { hp: 5, attack: 3 })' });
  }

  // Validate the allocation request
  const validation = validateTokenAllocation(agent, allocations);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Apply allocations
  const updates = [];
  const values = [];

  for (const [stat, amount] of Object.entries(allocations)) {
    // SECURITY: Validate stat name against whitelist to prevent SQL injection
    if (!STAT_NAMES.includes(stat)) {
      return res.status(400).json({ error: `Invalid stat name: ${stat}. Valid stats: ${STAT_NAMES.join(', ')}` });
    }
    if (amount > 0) {
      updates.push(`stat_tokens_${stat} = stat_tokens_${stat} + ?`);
      values.push(amount);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No tokens to allocate' });
  }

  // Deduct from available
  updates.push('stat_tokens_available = stat_tokens_available - ?');
  values.push(validation.tokensToSpend);

  values.push(agent.id);
  db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Invalidate cache after update
  invalidateAgent(agent.id);

  // Fetch updated agent
  const updated = db.prepare(`
    SELECT stat_tokens_available, stat_tokens_hp, stat_tokens_attack, stat_tokens_defense,
           stat_tokens_sp_atk, stat_tokens_sp_def, stat_tokens_speed
    FROM agents WHERE id = ?
  `).get(agent.id);

  const newTokenInfo = getStatTokenInfo(updated);

  res.json({
    success: true,
    tokens_spent: validation.tokensToSpend,
    new_available: newTokenInfo.available,
    new_distribution: newTokenInfo.invested,
    total_invested: newTokenInfo.totalInvested,
  });
});

// ── Move Respec System Endpoints ──

// GET /agents/:agent_id/respec - View respec status and available moves
router.get('/:agent_id/respec', (req, res) => {
  const db = getDb();
  const agent = db.prepare(`
    SELECT id, name, ai_type, level, move_respecs_available, last_respec_level
    FROM agents WHERE id = ?
  `).get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  // Get current moves
  const currentMoveRows = db.prepare('SELECT move_id, slot FROM agent_moves WHERE agent_id = ? ORDER BY slot').all(agent.id);
  const currentMoveIds = currentMoveRows.map(r => r.move_id);
  const currentMoves = getMovesByIds(currentMoveIds).map((m, i) => ({
    slot: i + 1,
    id: m.id,
    name: m.name,
    type: m.type,
    category: m.category,
    power: m.power,
    accuracy: m.accuracy,
    description: m.description,
  }));

  // Get full move pool for this type
  const movePool = getMovePoolForType(agent.ai_type || 'NEUTRAL');
  const availableMoves = movePool.map(m => ({
    id: m.id,
    name: m.name,
    type: m.type,
    category: m.category,
    power: m.power,
    accuracy: m.accuracy,
    pp: m.pp,
    description: m.description,
    effect: m.effect,
    is_current: currentMoveIds.includes(m.id),
  }));

  // Calculate next respec milestone
  const nextMilestone = RESPEC_MILESTONES.find(m => m > (agent.level || 1)) || null;

  res.json({
    agent_id: agent.id,
    name: agent.name,
    type: agent.ai_type || 'NEUTRAL',
    level: agent.level || 1,
    respecs_available: agent.move_respecs_available || 0,
    last_respec_level: agent.last_respec_level || 0,
    next_respec_level: nextMilestone,
    milestones: RESPEC_MILESTONES,
    current_moves: currentMoves,
    available_moves: availableMoves,
    pool_size: movePool.length,
  });
});

// POST /agents/:agent_id/respec - Use a respec to change moves
router.post('/:agent_id/respec', optionalHumanAuth, (req, res) => {
  const db = getDb();
  const agent = db.prepare(`
    SELECT id, name, owner_id, ai_type, move_respecs_available
    FROM agents WHERE id = ?
  `).get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  // Check ownership if authenticated
  if (req.human && agent.owner_id && agent.owner_id !== req.human.id) {
    return res.status(403).json({ error: 'You do not own this agent' });
  }

  // Check respecs available
  if ((agent.move_respecs_available || 0) < 1) {
    return res.status(400).json({
      error: 'No respecs available',
      respecs_available: agent.move_respecs_available || 0,
      next_respec: RESPEC_MILESTONES.find(m => m > (agent.level || 1)) || 'N/A',
    });
  }

  const newMoves = req.body.new_moves;
  if (!newMoves || !Array.isArray(newMoves) || newMoves.length !== 4) {
    return res.status(400).json({ error: 'new_moves must be an array of exactly 4 move IDs' });
  }

  // Validate move selection
  const validation = validateMoveSelection(newMoves, agent.ai_type || 'NEUTRAL');
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Transaction: update moves and decrement respec count
  const respec = db.transaction(() => {
    // Delete current moves
    db.prepare('DELETE FROM agent_moves WHERE agent_id = ?').run(agent.id);

    // Insert new moves
    const insertMove = db.prepare('INSERT INTO agent_moves (id, agent_id, move_id, slot) VALUES (?, ?, ?, ?)');
    newMoves.forEach((moveId, i) => {
      insertMove.run(crypto.randomUUID(), agent.id, moveId, i + 1);
    });

    // Decrement respecs
    db.prepare('UPDATE agents SET move_respecs_available = move_respecs_available - 1 WHERE id = ?').run(agent.id);

    return true;
  });

  respec();

  // Invalidate cache after respec
  invalidateAgent(agent.id);

  // Fetch updated data
  const updatedAgent = db.prepare('SELECT move_respecs_available FROM agents WHERE id = ?').get(agent.id);
  const newMoveData = getMovesByIds(newMoves);

  res.json({
    success: true,
    respecs_remaining: updatedAgent.move_respecs_available,
    moves: newMoveData.map((m, i) => ({
      slot: i + 1,
      id: m.id,
      name: m.name,
      type: m.type,
      category: m.category,
      power: m.power,
      accuracy: m.accuracy,
      description: m.description,
    })),
  });
});

// GET /agents/:agent_id/achievements - Badge list
router.get('/:agent_id/achievements', (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(req.params.agent_id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const badges = getAgentAchievements(req.params.agent_id);

  res.json({
    agent: agent.name,
    total_badges: badges.length,
    badges
  });
});

// ── Component 4: Portfolio Management ──

// GET /agents/portfolio - List all agents owned by the authenticated user
router.get('/portfolio', authenticateHuman, (req, res) => {
  const db = getDb();
  const ownerId = req.human.id;

  const agents = db.prepare(`
    SELECT * FROM agents WHERE owner_id = ? ORDER BY xp DESC
  `).all(ownerId);

  const portfolio = agents.map(a => {
    const effectiveStats = calculateAllEffectiveStats(a);
    const totalEVs = STAT_NAMES.reduce((sum, s) => sum + (a[`ev_${s}`] || 0), 0);
    return {
      agent_id: a.id,
      name: a.name,
      status: a.status,
      deployment_status: a.deployment_status || 'deployed',
      level: a.level || 1,
      type: {
        name: a.ai_type || 'NEUTRAL',
        emoji: TYPE_EMOJIS[a.ai_type] || '',
      },
      nature: a.nature_name || 'Balanced',
      ability: a.ability_name || null,
      effective_stats: effectiveStats,
      evs_total: totalEVs,
      fight_stats: {
        total: a.total_fights,
        wins: a.total_wins,
        losses: a.total_fights - a.total_wins,
        win_rate: a.total_fights > 0 ? Math.round((a.total_wins / a.total_fights) * 1000) / 1000 : 0,
      },
      xp: a.xp || 0,
      reputation_level: a.reputation_level || 'Newcomer',
      current_streak: a.current_streak || 0,
      connected: !!a.telegram_user_id,
      telegram_username: a.telegram_username || null,
    };
  });

  const activeAgents = agents.filter(a => a.status === 'active');
  const totalXP = activeAgents.reduce((sum, a) => sum + (a.xp || 0), 0);
  const totalWins = activeAgents.reduce((sum, a) => sum + a.total_wins, 0);
  const totalFights = activeAgents.reduce((sum, a) => sum + a.total_fights, 0);

  res.json({
    owner_id: ownerId,
    agents: portfolio,
    summary: {
      total_agents: agents.length,
      active_agents: activeAgents.length,
      deployed: agents.filter(a => a.deployment_status === 'deployed' && a.status === 'active').length,
      retired: agents.filter(a => a.deployment_status === 'retired' || a.status === 'deregistered').length,
      max_agents: MAX_AGENTS_PER_OWNER,
      slots_remaining: MAX_AGENTS_PER_OWNER - activeAgents.length,
      total_xp: totalXP,
      total_wins: totalWins,
      total_fights: totalFights,
      overall_win_rate: totalFights > 0 ? Math.round((totalWins / totalFights) * 1000) / 1000 : 0,
    },
  });
});

// POST /agents/:agent_id/deploy - Re-deploy a retired agent
router.post('/:agent_id/deploy', authenticateHuman, (req, res) => {
  const db = getDb();
  const ownerId = req.human.id;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND owner_id = ?').get(req.params.agent_id, ownerId);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found or not owned by you' });
  }

  if (agent.status !== 'active') {
    return res.status(400).json({ error: 'Agent is not active. Re-register first.' });
  }

  if (agent.deployment_status === 'deployed') {
    return res.status(409).json({ error: 'Agent is already deployed' });
  }

  db.prepare("UPDATE agents SET deployment_status = 'deployed' WHERE id = ?").run(agent.id);

  res.json({
    status: 'deployed',
    agent_id: agent.id,
    name: agent.name,
  });
});

// POST /agents/:agent_id/retire - Retire (bench) an agent
router.post('/:agent_id/retire', authenticateHuman, (req, res) => {
  const db = getDb();
  const ownerId = req.human.id;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND owner_id = ?').get(req.params.agent_id, ownerId);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found or not owned by you' });
  }

  if (agent.deployment_status === 'retired') {
    return res.status(409).json({ error: 'Agent is already retired' });
  }

  // Cancel active battles
  db.prepare(`
    UPDATE battles SET status = 'cancelled'
    WHERE (agent_a_id = ? OR agent_b_id = ?)
    AND status IN ('active', 'pending')
  `).run(agent.id, agent.id);

  db.prepare("UPDATE agents SET deployment_status = 'retired' WHERE id = ?").run(agent.id);

  res.json({
    status: 'retired',
    agent_id: agent.id,
    name: agent.name,
    message: 'Agent retired. Use POST /agents/:id/deploy to re-deploy.',
  });
});

// POST /agents/:agent_id/claim - Link an existing unowned agent to your account
router.post('/:agent_id/claim', authenticateHuman, (req, res) => {
  const db = getDb();
  const ownerId = req.human.id;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.agent_id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  if (agent.owner_id) {
    return res.status(403).json({ error: 'Agent is already owned' });
  }

  // Verify the claimer has the agent's API key
  const apiKey = req.body.api_key;
  if (!apiKey) {
    return res.status(400).json({ error: 'api_key required to claim an agent' });
  }

  const keyHash = hashApiKey(apiKey);
  if (keyHash !== agent.api_key) {
    return res.status(401).json({ error: 'Invalid API key for this agent' });
  }

  // Check 5-agent limit
  const owned = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE owner_id = ? AND status = 'active'").get(ownerId).cnt;
  if (owned >= MAX_AGENTS_PER_OWNER) {
    return res.status(403).json({
      error: `Maximum ${MAX_AGENTS_PER_OWNER} agents per user. Retire an agent first.`,
      current_count: owned,
      max: MAX_AGENTS_PER_OWNER,
    });
  }

  db.prepare("UPDATE agents SET owner_id = ?, claimed_at = ?, play_mode = 'auto' WHERE id = ?")
    .run(ownerId, new Date().toISOString(), agent.id);

  res.json({
    status: 'claimed',
    agent_id: agent.id,
    name: agent.name,
    owner_id: ownerId,
  });
});

// ── Link Code System ──

function generateLinkCode(db, agentId, ownerId) {
  // Generate 6-char alphanumeric code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  let code = 'CLAW-';
  const randomBytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[randomBytes[i] % chars.length];
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  // Wrap in transaction to ensure atomicity (don't delete old code if insert fails)
  const createCode = db.transaction(() => {
    db.prepare("DELETE FROM link_codes WHERE agent_id = ?").run(agentId);
    db.prepare('INSERT INTO link_codes (code, agent_id, owner_id, expires_at) VALUES (?, ?, ?, ?)').run(
      code, agentId, ownerId, expiresAt
    );
  });
  createCode();

  return code;
}

// POST /agents/:agent_id/link-code - Generate a link code (requires Clerk auth, must own agent)
router.post('/:agent_id/link-code', authenticateHuman, (req, res) => {
  const db = getDb();
  const ownerId = req.human.id;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND owner_id = ?').get(req.params.agent_id, ownerId);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found or not owned by you' });
  }

  const code = generateLinkCode(db, agent.id, ownerId);

  res.json({
    link_code: code,
    agent_id: agent.id,
    name: agent.name,
    expires_in_minutes: 10,
    instruction: `Send /clawcombat connect ${code} to your Clawdbot on Telegram`,
  });
});

// POST /agents/link - Redeem a link code (called by Clawdbot skill)
router.post('/link', (req, res) => {
  const { code, telegram_user_id, telegram_username } = req.body;

  if (!code) return res.status(400).json({ error: 'code is required' });
  if (!telegram_user_id) return res.status(400).json({ error: 'telegram_user_id is required' });
  const parsedTgId = Number(telegram_user_id);
  if (!Number.isInteger(parsedTgId) || parsedTgId < 1) {
    return res.status(400).json({ error: 'telegram_user_id must be a positive integer' });
  }

  const db = getDb();

  const linkCode = db.prepare('SELECT * FROM link_codes WHERE code = ? AND used = 0').get(code);
  if (!linkCode) {
    return res.status(404).json({ error: 'Invalid or already used link code' });
  }

  if (new Date(linkCode.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Link code expired. Generate a new one from the website.' });
  }

  // Wrap all mutations in a transaction for atomicity
  const linkAgent = db.transaction(() => {
    // Mark code as used (atomic check)
    const result = db.prepare('UPDATE link_codes SET used = 1 WHERE code = ? AND used = 0').run(code);
    if (result.changes === 0) {
      return { error: 'Code already used', status: 409 };
    }

    // Check if this telegram user already has a linked agent -- unlink old one
    const existingAgent = db.prepare('SELECT id, name FROM agents WHERE telegram_user_id = ?').get(String(telegram_user_id));
    if (existingAgent) {
      db.prepare('UPDATE agents SET telegram_user_id = NULL, telegram_username = NULL, bot_token_hash = NULL WHERE id = ?').run(existingAgent.id);
    }

    // Generate bot token
    const botToken = 'clw_bot_' + crypto.randomBytes(32).toString('hex');
    const botTokenHash = hashApiKey(botToken);

    // Link the agent
    db.prepare(`
      UPDATE agents SET telegram_user_id = ?, telegram_username = ?, bot_token_hash = ?
      WHERE id = ?
    `).run(String(telegram_user_id), telegram_username || null, botTokenHash, linkCode.agent_id);

    const agent = db.prepare('SELECT id, name, ai_type, level, owner_id FROM agents WHERE id = ?').get(linkCode.agent_id);

    return {
      data: {
        status: 'linked',
        agent_id: agent.id,
        agent_name: agent.name,
        name: agent.name,
        type: agent.ai_type,
        type_emoji: TYPE_EMOJIS[agent.ai_type] || '',
        level: agent.level || 1,
        owner_id: agent.owner_id,
        bot_token: botToken,
        telegram_username: telegram_username || null,
        message: `Your lobster ${agent.name} is now linked to your account. Your bot is now looking for fights and will automatically battle once per hour.`,
        previously_linked: existingAgent ? existingAgent.name : null,
      },
    };
  });

  const result = linkAgent();
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  res.json(result.data);
});

// POST /agents/:agent_id/disconnect - Unlink Clawdbot (requires Clerk auth)
router.post('/:agent_id/disconnect', authenticateHuman, (req, res) => {
  const db = getDb();
  const ownerId = req.human.id;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND owner_id = ?').get(req.params.agent_id, ownerId);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found or not owned by you' });
  }

  if (!agent.telegram_user_id) {
    return res.status(409).json({ error: 'Agent is not connected to a Clawdbot' });
  }

  db.prepare('UPDATE agents SET telegram_user_id = NULL, telegram_username = NULL, bot_token_hash = NULL WHERE id = ?').run(agent.id);

  res.json({
    status: 'disconnected',
    agent_id: agent.id,
    name: agent.name,
  });
});

// GET /agents/me - Get current agent info (bot token or API key auth)
router.get('/me', authenticateAgent, (req, res) => {
  const agent = req.agent;
  res.json({
    id: agent.id,
    name: agent.name,
    type: agent.ai_type,
    ai_type: agent.ai_type,
    status: agent.status,
    wins: agent.wins,
    losses: agent.losses,
    level: agent.level,
    xp: agent.xp,
    created_at: agent.created_at,
    connected: !!agent.telegram_user_id,
    telegram_username: agent.telegram_username || null,
  });
});

// GET /agents/health - Get health stats for the authenticated agent (bot monitoring)
router.get('/health', authenticateAgent, (req, res) => {
  const { getAgentHealth, getRecentActivity } = require('../services/bot-health');
  const agent = req.agent;

  const health = getAgentHealth(agent.id);
  if (!health) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  // Include recent activity if requested
  const includeActivity = req.query.include_activity === 'true' || req.query.includeActivity === 'true';
  if (includeActivity) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    health.recent_activity = getRecentActivity(agent.id, limit);
  }

  res.json({ data: health });
});

// POST /agents/rotate-key - Generate a new API key (old key immediately invalidated)
router.post('/rotate-key', authenticateAgent, (req, res) => {
  const db = getDb();
  const agentId = req.agent.id;

  const newKey = 'clw_sk_' + crypto.randomBytes(32).toString('hex');
  const newHash = hashApiKey(newKey);

  db.prepare('UPDATE agents SET api_key = ? WHERE id = ?').run(newHash, agentId);

  // Invalidate cache after key rotation
  invalidateAgent(agentId);
  invalidateAgentByKey(req.agent.api_key); // Old key hash

  res.json({
    status: 'rotated',
    agent_id: agentId,
    name: req.agent.name,
    new_api_key: newKey,
    warning: 'Save this key now. Your old key is permanently invalidated.'
  });
});

// POST /agents/connect - One-shot bot registration + Telegram linking
// Called by Telegram bot's /connect command. Auto-creates a lobster with random everything.
router.post('/connect', async (req, res) => {
  try {
  const { telegram_user_id, telegram_username, bot_name, preferences } = req.body;

  if (!telegram_user_id) {
    return res.status(400).json({ error: 'telegram_user_id is required' });
  }
  const parsedTgId = Number(telegram_user_id);
  if (!Number.isInteger(parsedTgId) || parsedTgId < 1) {
    return res.status(400).json({ error: 'telegram_user_id must be a positive integer' });
  }

  const db = getDb();

  // Check if this telegram user already has a linked agent — return existing
  const existing = db.prepare('SELECT * FROM agents WHERE telegram_user_id = ?').get(String(telegram_user_id));
  if (existing) {
    const moves = db.prepare('SELECT move_id, slot FROM agent_moves WHERE agent_id = ? ORDER BY slot').all(existing.id);
    const { getMoveById } = require('../data/moves');
    return res.json({
      status: 'already_connected',
      agent_id: existing.id,
      name: existing.name,
      type: existing.ai_type,
      type_emoji: TYPE_EMOJIS[existing.ai_type] || '',
      level: existing.level || 1,
      play_mode: existing.play_mode || 'auto',
      avatar_url: existing.avatar_url || null,
      moves: moves.map(r => {
        const m = getMoveById(r.move_id);
        return m ? { slot: r.slot, id: m.id, name: m.name, type: m.type, power: m.power } : null;
      }).filter(Boolean),
    });
  }

  // Auto-generate everything
  const type = preferences?.type
    ? (VALID_TYPES.includes(preferences.type.toUpperCase()) ? preferences.type.toUpperCase() : VALID_TYPES[Math.floor(Math.random() * VALID_TYPES.length)])
    : VALID_TYPES[Math.floor(Math.random() * VALID_TYPES.length)];

  // Random name: type-themed prefix + random suffix
  const prefixes = {
    FIRE: ['Blaze', 'Ember', 'Inferno', 'Pyro', 'Scorch'],
    WATER: ['Tide', 'Aqua', 'Splash', 'Reef', 'Surge'],
    ELECTRIC: ['Volt', 'Spark', 'Zap', 'Thunder', 'Shock'],
    GRASS: ['Leaf', 'Fern', 'Vine', 'Moss', 'Root'],
    ICE: ['Frost', 'Glacier', 'Chill', 'Sleet', 'Flurry'],
    MARTIAL: ['Fist', 'Brawl', 'Strike', 'Clash', 'Guard'],
    VENOM: ['Venom', 'Toxic', 'Sludge', 'Blight', 'Murk'],
    EARTH: ['Quake', 'Terra', 'Rumble', 'Dust', 'Boulder'],
    AIR: ['Gale', 'Soar', 'Swift', 'Breeze', 'Talon'],
    PSYCHE: ['Mind', 'Zen', 'Psi', 'Oracle', 'Trance'],
    INSECT: ['Buzz', 'Hive', 'Stinger', 'Mantis', 'Swarm'],
    STONE: ['Stone', 'Crag', 'Flint', 'Granite', 'Shard'],
    GHOST: ['Shadow', 'Wraith', 'Phantom', 'Shade', 'Specter'],
    DRAGON: ['Drake', 'Fang', 'Wyrm', 'Scale', 'Draco'],
    SHADOW: ['Dusk', 'Noir', 'Rogue', 'Umbra', 'Hex'],
    METAL: ['Iron', 'Chrome', 'Alloy', 'Forge', 'Anvil'],
    MYSTIC: ['Pixie', 'Charm', 'Luna', 'Glitter', 'Sprite'],
    NEUTRAL: ['Scout', 'Dash', 'Echo', 'Flick', 'Sage'],
  };

  let name = bot_name;
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name) || name.length < 3) {
    const typePrefix = prefixes[type] || prefixes.NORMAL;
    const prefix = typePrefix[Math.floor(Math.random() * typePrefix.length)];
    const suffix = crypto.randomBytes(3).toString('hex').slice(0, 4);
    name = `${prefix}Claw-${suffix}`;
  }

  // Ensure name is unique
  let finalName = name;
  let attempts = 0;
  while (db.prepare('SELECT id FROM agents WHERE name = ?').get(finalName) && attempts < 10) {
    const suffix = crypto.randomBytes(3).toString('hex').slice(0, 4);
    finalName = `${name.slice(0, 40)}-${suffix}`;
    attempts++;
  }
  name = finalName;

  // Random stat distribution (total 100)
  function randomStats() {
    const stats = { hp: 10, attack: 10, defense: 10, sp_atk: 10, sp_def: 10, speed: 10 };
    let remaining = 40; // 60 already allocated (10 each)
    const keys = Object.keys(stats);
    while (remaining > 0) {
      const key = keys[Math.floor(Math.random() * keys.length)];
      const add = Math.min(remaining, Math.floor(Math.random() * 8) + 1);
      if (stats[key] + add <= 35) {
        stats[key] += add;
        remaining -= add;
      }
    }
    return stats;
  }

  const base_stats = randomStats();
  const nature = randomNature();
  const ability = randomAbility(type);

  const id = uuidv4();
  const api_key = 'clw_sk_' + crypto.randomBytes(32).toString('hex');
  const api_key_hash = hashApiKey(api_key);
  const botToken = 'clw_bot_' + crypto.randomBytes(32).toString('hex');
  const botTokenHash = hashApiKey(botToken);

  // Prepare image assignment data before transaction (non-DB operation)
  let avatarUrl = null;
  let assignedBase = null;
  let assignedVariant = null;
  let visualPrompt = null;
  let skinHash = null;
  try {
    const imageAssignment = assignImage(type, base_stats);
    assignedBase = imageAssignment.base;
    assignedVariant = imageAssignment.variant;
    avatarUrl = imageAssignment.imagePath;

    const skinAgent = {
      name, ai_type: type, level: 1,
      base_hp: base_stats.hp, base_attack: base_stats.attack, base_defense: base_stats.defense,
      base_sp_atk: base_stats.sp_atk, base_sp_def: base_stats.sp_def, base_speed: base_stats.speed,
      ability_name: ability ? ability.name : null,
    };
    visualPrompt = buildSkinPrompt(skinAgent, 1);
    skinHash = hashAgentStats(skinAgent);
  } catch (e) {
    log.error('Image assignment failed on connect:', { agent: name, error: e.message });
  }

  // Assign 4 random moves from the type's pool (prepare data before transaction)
  const selectedMoveIds = randomMovesForType(type);

  // TRANSACTION: Wrap all database writes in a transaction for atomicity
  // If any step fails (e.g., UNIQUE constraint), the entire operation is rolled back
  const connectAgent = db.transaction(() => {
    // Step 1: Insert agent
    db.prepare(`
      INSERT INTO agents (
        id, name, webhook_url, api_key, status, ai_type, play_mode,
        base_hp, base_attack, base_defense, base_sp_atk, base_sp_def, base_speed,
        nature_name, nature_boost, nature_reduce, nature_desc,
        ability_name, ability_desc, ability_effect,
        deployment_status, trial_start_at, level,
        telegram_user_id, telegram_username, bot_token_hash
      )
      VALUES (?, ?, '', ?, 'active', ?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deployed', ?, 1, ?, ?, ?)
    `).run(
      id, name, api_key_hash, type,
      base_stats.hp, base_stats.attack, base_stats.defense, base_stats.sp_atk, base_stats.sp_def, base_stats.speed,
      nature.name, nature.boost, nature.reduce, nature.desc,
      ability ? ability.name : null, ability ? ability.desc : null, ability ? ability.effect : null,
      new Date().toISOString(),
      String(telegram_user_id), telegram_username || null, botTokenHash
    );

    // Step 2: Insert moves
    const insertMove = db.prepare('INSERT INTO agent_moves (id, agent_id, move_id, slot) VALUES (?, ?, ?, ?)');
    selectedMoveIds.forEach((moveId, i) => {
      insertMove.run(crypto.randomUUID(), id, moveId, i + 1);
    });

    // Step 3: Update avatar URL if assigned
    if (avatarUrl) {
      db.prepare('UPDATE agents SET avatar_url = ?, visual_prompt = ?, skin_stats_hash = ?, skin_tier = 1 WHERE id = ?')
        .run(avatarUrl, visualPrompt, skinHash, id);
      log.info('Reference image assigned on connect', { type, image: `${assignedBase}-${assignedVariant}` });
    }

    return true;
  });

  try {
    connectAgent();
  } catch (e) {
    if (e.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Name already taken. Try again.' });
    }
    log.error('Registration DB error:', { error: e.message });
    return res.status(500).json({ error: 'Registration failed' });
  }

  const typeMoves = getMovesByIds(selectedMoveIds);

  // SECURITY: API key shown only once at creation
  res.status(201).json({
    status: 'connected',
    agent_id: id,
    name,
    type,
    type_emoji: TYPE_EMOJIS[type] || '',
    level: 1,
    play_mode: 'auto',
    api_key,
    api_key_warning: 'SAVE THIS KEY NOW. It will not be shown again.',
    bot_token: botToken,
    base_stats,
    nature: { name: nature.name, description: nature.desc },
    ability: ability ? { name: ability.name, description: ability.desc } : null,
    moves: typeMoves.map((m, i) => ({ slot: i + 1, id: m.id, name: m.name, type: m.type, power: m.power })),
    skin: { avatar_url: avatarUrl, base: assignedBase, variant: assignedVariant },
    message: `Your lobster ${name} has been created and is ready to battle! It will automatically fight other lobsters every 5 minutes.`,
  });
  } catch (err) {
    log.error('Connect error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to connect agent' });
  }
});

// POST /agents/deregister - Voluntarily deactivate agent
router.post('/deregister', authenticateAgent, (req, res) => {
  const db = getDb();
  const agentId = req.agent.id;

  // Cancel any active fights
  db.prepare(`
    UPDATE fights SET status = 'cancelled'
    WHERE (agent_a_id = ? OR agent_b_id = ?)
    AND status IN ('pending', 'awaiting_judgment')
  `).run(agentId, agentId);

  db.prepare("UPDATE agents SET status = 'deregistered' WHERE id = ?").run(agentId);

  res.json({
    status: 'deregistered',
    agent_id: agentId,
    name: req.agent.name,
    message: 'Agent deactivated. You can re-register with the same name later.'
  });
});

// GET /agents/profile/:id - Public agent profile (no auth required)
router.get('/profile/:id', (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND status = ?').get(req.params.id, 'active');

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const effectiveStats = calculateAllEffectiveStats(agent);

  // Load agent's actual moves from DB
  const moveRows = db.prepare('SELECT move_id, slot FROM agent_moves WHERE agent_id = ? ORDER BY slot').all(agent.id);
  let moves;
  if (moveRows.length > 0) {
    moves = moveRows.map(r => {
      const m = getMoveById(r.move_id);
      return m ? { slot: r.slot, name: m.name, type: m.type, category: m.category, power: m.power, accuracy: m.accuracy, description: m.description, effect: m.effect } : null;
    }).filter(Boolean);
  } else {
    // Fallback for old agents without DB moves
    const defaultMoves = getMovesForType(agent.ai_type || 'NEUTRAL');
    moves = defaultMoves.map((m, i) => ({ slot: i + 1, name: m.name, type: m.type, category: m.category, power: m.power, accuracy: m.accuracy, description: m.description, effect: m.effect }));
  }

  // Get leaderboard rank
  const rank = db.prepare(`
    SELECT COUNT(*) + 1 as rank FROM agents
    WHERE status = 'active' AND xp > ?
  `).get(agent.xp || 0);

  // Calculate trial days remaining
  let trialDaysLeft = 0;
  if (agent.trial_start_at) {
    const trialStart = new Date(agent.trial_start_at);
    const now = new Date();
    const daysSinceCreation = (now - trialStart) / MS_PER_DAY;
    trialDaysLeft = Math.max(0, Math.ceil(14 - daysSinceCreation));
  }

  res.json({
    agent_id: agent.id,
    name: agent.name,
    level: agent.level || 1,
    xp: agent.xp || 0,
    type: {
      name: agent.ai_type || 'NEUTRAL',
      emoji: TYPE_EMOJIS[agent.ai_type] || '',
    },
    nature: agent.nature_name || 'Balanced',
    ability: agent.ability_name || null,
    effective_stats: effectiveStats,
    fight_stats: {
      total: agent.total_fights || 0,
      wins: agent.total_wins || 0,
      losses: (agent.total_fights || 0) - (agent.total_wins || 0),
      win_rate: agent.total_fights > 0 ? Math.round((agent.total_wins / agent.total_fights) * 1000) / 1000 : 0,
    },
    current_streak: agent.current_streak || 0,
    best_streak: agent.best_streak || 0,
    rank: rank.rank,
    moves,
    avatar_url: agent.avatar_url || null,
    created_at: agent.created_at,
    showcase_text: agent.showcase_text || null,
    showcase_image_url: agent.showcase_image_url || null,
    social_x: agent.social_x || null,
    // Owner & premium info (for trial banner)
    owner_id: agent.owner_id || null,
    is_premium: agent.is_premium || 0,
    trial_days_left: trialDaysLeft,
    tier: agent.is_premium ? (trialDaysLeft > 0 ? 'trial' : 'premium') : 'free',
  });
});

// PUT /agents/:id/showcase - Update showcase (owner only, Clerk auth)
router.put('/:id/showcase', authenticateHuman, (req, res) => {
  const db = getDb();
  const agentId = req.params.id;
  const humanId = req.human.id;

  const agent = db.prepare('SELECT id, owner_id, showcase_text, showcase_image_url, social_x FROM agents WHERE id = ? AND status = ?').get(agentId, 'active');
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  if (agent.owner_id !== humanId) {
    return res.status(403).json({ error: 'You can only edit your own lobster showcase' });
  }

  let { text, image_url, social_x } = req.body;

  // Sanitize text: strip HTML, limit 500 chars
  if (text !== undefined && text !== null) {
    text = String(text).replace(/<[^>]*>/g, '').trim().slice(0, 500);
    if (text === '') text = null;
  }

  // Validate image URL
  if (image_url !== undefined && image_url !== null) {
    image_url = String(image_url).trim();
    if (image_url === '') {
      image_url = null;
    } else if (!/^https?:\/\/.+/.test(image_url)) {
      return res.status(400).json({ error: 'image_url must be a valid HTTP/HTTPS URL' });
    }
  }

  // Sanitize X handle: strip @, allow only valid chars
  if (social_x !== undefined && social_x !== null) {
    social_x = String(social_x).trim().replace(/^@/, '').slice(0, 50);
    if (social_x === '' || !/^[a-zA-Z0-9_]+$/.test(social_x)) social_x = null;
  }

  db.prepare('UPDATE agents SET showcase_text = ?, showcase_image_url = ?, social_x = ? WHERE id = ?')
    .run(
      text !== undefined ? text : agent.showcase_text,
      image_url !== undefined ? image_url : agent.showcase_image_url,
      social_x !== undefined ? social_x : agent.social_x,
      agentId
    );

  res.json({ status: 'updated', showcase_text: text, showcase_image_url: image_url, social_x: social_x });
});

// PATCH /agents/:agent_id/webhook - Update webhook URL and/or secret (requires agent auth)
router.patch('/:agent_id/webhook', authenticateAgent, (req, res) => {
  const db = getDb();
  const agentId = req.agent.id;

  if (req.params.agent_id !== agentId) {
    return res.status(403).json({ error: 'You can only update your own webhook' });
  }

  const { webhook_url, webhook_secret } = req.body;

  if (!webhook_url && !webhook_secret) {
    return res.status(400).json({ error: 'Provide webhook_url and/or webhook_secret' });
  }

  if (webhook_url) {
    try {
      const parsed = new URL(webhook_url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'webhook_url must be HTTP or HTTPS' });
      }
      const host = parsed.hostname.toLowerCase();
      if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|::1|169\.254\.)/.test(host) || host === '[::1]') {
        return res.status(400).json({ error: 'webhook_url cannot point to private/local network' });
      }
    } catch {
      return res.status(400).json({ error: 'webhook_url must be a valid HTTP/HTTPS URL' });
    }
  }

  const updates = [];
  const values = [];

  if (webhook_url !== undefined) {
    updates.push('webhook_url = ?');
    values.push(webhook_url || '');
  }
  if (webhook_secret !== undefined) {
    updates.push('webhook_secret = ?');
    values.push(webhook_secret || crypto.randomBytes(24).toString('hex'));
  }

  values.push(agentId);
  db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Invalidate cache after webhook update
  invalidateAgent(agentId);

  const updated = db.prepare('SELECT webhook_url, webhook_secret FROM agents WHERE id = ?').get(agentId);

  res.json({
    status: 'updated',
    agent_id: agentId,
    webhook_url: updated.webhook_url,
    webhook_secret: updated.webhook_secret,
  });
});

// POST /agents/:agent_id/webhook/test - Send a test ping to the webhook URL
router.post('/:agent_id/webhook/test', authenticateAgent, async (req, res) => {
  const db = getDb();
  const agentId = req.agent.id;

  if (req.params.agent_id !== agentId) {
    return res.status(403).json({ error: 'You can only test your own webhook' });
  }

  const agent = db.prepare('SELECT webhook_url, webhook_secret, name FROM agents WHERE id = ?').get(agentId);

  if (!agent.webhook_url) {
    return res.status(400).json({ error: 'No webhook URL configured. Set one via PATCH /agents/:id/webhook' });
  }

  const payload = {
    event: 'ping',
    agent_id: agentId,
    agent_name: agent.name,
    message: 'Webhook test — if you receive this, your webhook is working.',
    timestamp: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', agent.webhook_secret || '')
    .update(body)
    .digest('hex');

  const startTime = Date.now();
  try {
    const response = await fetch(agent.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ClawCombat-Signature': signature,
        'X-ClawCombat-Event': 'ping',
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    const responseTime = Date.now() - startTime;
    const responseBody = await response.text().catch(() => '');

    res.json({
      status: response.ok ? 'success' : 'error',
      http_status: response.status,
      response_time_ms: responseTime,
      response_body: responseBody.slice(0, 500),
      webhook_url: agent.webhook_url,
    });
  } catch (err) {
    const responseTime = Date.now() - startTime;
    log.error('Webhook test error', { error: err.message, agent_id: agentId, webhook_url: agent.webhook_url });
    res.json({
      status: 'error',
      error: 'Webhook test failed',
      response_time_ms: responseTime,
      webhook_url: agent.webhook_url,
    });
  }
});

// ============================================================================
// OPENCLAW BOT ONBOARDING ENDPOINTS
// ============================================================================

// GET /agents/types-info — Public endpoint for bots to learn available types, moves, natures, abilities
router.get('/types-info', (req, res) => {
  const types = VALID_TYPES;
  const moves_by_type = {};
  for (const t of types) {
    const pool = getMovePoolForType(t);
    moves_by_type[t] = pool.map(m => ({
      id: m.id, name: m.name, type: m.type, category: m.category,
      power: m.power, accuracy: m.accuracy, pp: m.pp, description: m.description,
    }));
  }
  const natures = NATURES.map(n => ({ name: n.name, description: n.desc, boost: n.boost, reduce: n.reduce }));
  const abilities_by_type = {};
  for (const t of types) {
    abilities_by_type[t] = (TYPE_ABILITIES[t] || []).map(a => ({ name: a.name, description: a.desc, effect: a.effect }));
  }
  res.json({ types, moves_by_type, natures, abilities_by_type });
});

// POST /agents/setup-token — Clerk-authed, generates a one-time setup token for bot onboarding
router.post('/setup-token', authenticateHuman, (req, res) => {
  const db = getDb();
  const ownerId = req.human.id;
  const mode = req.body.mode || 'auto';

  if (!['auto', 'connect'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "auto" or "connect"' });
  }

  let agentId = null;
  if (mode === 'connect') {
    agentId = req.body.agent_id;
    if (!agentId) return res.status(400).json({ error: 'agent_id required for connect mode' });
    const agent = db.prepare('SELECT id FROM agents WHERE id = ? AND owner_id = ?').get(agentId, ownerId);
    if (!agent) return res.status(404).json({ error: 'Agent not found or not owned by you' });
  }

  const id = crypto.randomUUID();
  const token = 'clw_setup_' + crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare(`
    INSERT INTO setup_tokens (id, token, owner_id, mode, agent_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, token, ownerId, mode, agentId, expiresAt);

  res.json({ token, mode, expires_at: expiresAt });
});

// POST /agents/bot-register — Bot calls this with setup token + chosen specs (automatic onboarding)
router.post('/bot-register', async (req, res) => {
  try {
  const db = getDb();
  const { setup_token, name, type, moves: moveIds, nature: natureName, ability: abilityName } = req.body;

  if (!setup_token) return res.status(400).json({ error: 'setup_token required' });
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!type) return res.status(400).json({ error: 'type required' });

  // Validate token
  const tokenRow = db.prepare(`
    SELECT * FROM setup_tokens WHERE token = ? AND used = 0 AND mode = 'auto'
  `).get(setup_token);

  if (!tokenRow) return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Token not found, already used, or wrong mode' });
  if (new Date(tokenRow.expires_at) < new Date()) {
    return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Setup token has expired. Generate a new one.' });
  }

  const ownerId = tokenRow.owner_id;

  // Validate name
  if (name.length < 2 || name.length > 24) {
    return res.status(400).json({ error: 'Name must be 2-24 characters' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Name must be alphanumeric (dashes and underscores allowed)' });
  }
  const existing = db.prepare('SELECT id FROM agents WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ error: 'Name already taken' });

  // Validate type
  const ai_type = type.toUpperCase();
  if (!VALID_TYPES.includes(ai_type)) {
    return res.status(400).json({ error: `Invalid type`, valid_types: VALID_TYPES });
  }

  // Validate moves
  let selectedMoveIds;
  if (moveIds && Array.isArray(moveIds) && moveIds.length === 4) {
    const validation = validateMoveSelection(moveIds, ai_type);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    selectedMoveIds = moveIds;
  } else {
    selectedMoveIds = randomMovesForType(ai_type);
  }

  // Nature
  let nature;
  if (natureName) {
    nature = NATURES.find(n => n.name.toLowerCase() === natureName.toLowerCase());
    if (!nature) return res.status(400).json({ error: `Invalid nature. Options: ${NATURES.map(n => n.name).join(', ')}` });
  } else {
    nature = randomNature();
  }

  // Ability
  let ability;
  if (abilityName) {
    const typeAbilities = TYPE_ABILITIES[ai_type] || [];
    ability = typeAbilities.find(a => a.name.toLowerCase() === abilityName.toLowerCase());
    if (!ability) return res.status(400).json({ error: `Invalid ability for ${ai_type}`, available: typeAbilities.map(a => a.name) });
  } else {
    ability = randomAbility(ai_type);
  }

  // Enforce agent limit
  const owned = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE owner_id = ? AND status = 'active'").get(ownerId).cnt;
  if (owned >= MAX_AGENTS_PER_OWNER) {
    return res.status(403).json({ error: `Maximum ${MAX_AGENTS_PER_OWNER} agents per user` });
  }

  // Random stat distribution (total 100)
  const stats = { hp: 10, attack: 10, defense: 10, sp_atk: 10, sp_def: 10, speed: 10 };
  let remaining = 40;
  const keys = Object.keys(stats);
  while (remaining > 0) {
    const key = keys[Math.floor(Math.random() * keys.length)];
    const add = Math.min(remaining, Math.floor(Math.random() * 8) + 1);
    if (stats[key] + add <= 35) { stats[key] += add; remaining -= add; }
  }

  const id = crypto.randomUUID();
  const botKey = 'clw_bot_' + crypto.randomBytes(32).toString('hex');
  const botKeyHash = hashApiKey(botKey);
  const webhookSecret = crypto.randomBytes(24).toString('hex');

  // Prepare image assignment data before transaction (non-DB operation)
  let avatarUrl = null;
  let assignedBase = null;
  let assignedVariant = null;
  let visualPrompt = null;
  let skinHash = null;
  try {
    const imageAssignment = assignImage(ai_type, stats);
    assignedBase = imageAssignment.base;
    assignedVariant = imageAssignment.variant;
    avatarUrl = imageAssignment.imagePath;

    const skinAgent = {
      name, ai_type, level: 1,
      base_hp: stats.hp, base_attack: stats.attack, base_defense: stats.defense,
      base_sp_atk: stats.sp_atk, base_sp_def: stats.sp_def, base_speed: stats.speed,
      ability_name: ability ? ability.name : null,
    };
    visualPrompt = buildSkinPrompt(skinAgent, 1);
    skinHash = hashAgentStats(skinAgent);
  } catch (e) {
    log.error('Bot image assignment failed:', { error: e.message });
  }

  // TRANSACTION: Wrap all database writes in a transaction for atomicity
  // If any step fails, the entire operation is rolled back
  const registerBot = db.transaction(() => {
    // Step 1: Insert agent
    db.prepare(`
      INSERT INTO agents (
        id, name, webhook_url, api_key, webhook_secret,
        ai_type, base_hp, base_attack, base_defense, base_sp_atk, base_sp_def, base_speed,
        nature_name, nature_boost, nature_reduce, nature_desc,
        ability_name, ability_desc, ability_effect,
        owner_id, deployment_status, trial_start_at, level, play_mode, elo
      )
      VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deployed', ?, 1, 'auto', 1000)
    `).run(
      id, name, botKeyHash, webhookSecret,
      ai_type, stats.hp, stats.attack, stats.defense, stats.sp_atk, stats.sp_def, stats.speed,
      nature.name, nature.boost, nature.reduce, nature.desc,
      ability ? ability.name : null, ability ? ability.desc : null, ability ? ability.effect : null,
      ownerId, new Date().toISOString()
    );

    // Step 2: Insert moves
    const insertMove = db.prepare('INSERT INTO agent_moves (id, agent_id, move_id, slot) VALUES (?, ?, ?, ?)');
    selectedMoveIds.forEach((moveId, i) => {
      insertMove.run(crypto.randomUUID(), id, moveId, i + 1);
    });

    // Step 3: Mark token as used
    db.prepare('UPDATE setup_tokens SET used = 1, used_by_bot_token = ? WHERE id = ?').run(botKeyHash, tokenRow.id);

    // Step 4: Update avatar URL if assigned
    if (avatarUrl) {
      db.prepare('UPDATE agents SET avatar_url = ?, visual_prompt = ?, skin_stats_hash = ?, skin_tier = 1 WHERE id = ?')
        .run(avatarUrl, visualPrompt, skinHash, id);
      log.info('Reference image assigned for bot', { type: ai_type, image: `${assignedBase}-${assignedVariant}` });
    }

    return true;
  });

  registerBot();

  const typeMoves = getMovesByIds(selectedMoveIds);

  // SECURITY: API key shown only once at creation
  res.status(201).json({
    success: true,
    api_key: botKey,
    api_key_warning: 'SAVE THIS KEY NOW. It will not be shown again.',
    agent: {
      id, name, type: ai_type, level: 1, elo: 1000,
      stats,
      nature: { name: nature.name, description: nature.desc },
      ability: ability ? { name: ability.name, description: ability.desc } : null,
      moves: typeMoves.map((m, i) => ({ slot: i + 1, id: m.id, name: m.name, type: m.type, power: m.power, accuracy: m.accuracy })),
      skin: { avatar_url: avatarUrl, base: assignedBase, variant: assignedVariant },
    },
  });
  } catch (err) {
    log.error('Bot registration error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to register bot' });
  }
});

// POST /agents/bot-connect — Bot calls this with setup token to connect to existing agent (manual onboarding)
router.post('/bot-connect', (req, res) => {
  const db = getDb();
  const { setup_token } = req.body;

  if (!setup_token) return res.status(400).json({ error: 'setup_token required' });

  const tokenRow = db.prepare(`
    SELECT * FROM setup_tokens WHERE token = ? AND used = 0 AND mode = 'connect'
  `).get(setup_token);

  if (!tokenRow) return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Token not found, already used, or wrong mode' });
  if (new Date(tokenRow.expires_at) < new Date()) {
    return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Setup token has expired' });
  }

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(tokenRow.agent_id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Generate bot API key
  const botKey = 'clw_bot_' + crypto.randomBytes(32).toString('hex');
  const botKeyHash = hashApiKey(botKey);

  // TRANSACTION: Wrap agent update and token marking in a transaction for atomicity
  const connectBot = db.transaction(() => {
    // Update agent: set play_mode to auto, store bot token hash
    db.prepare('UPDATE agents SET play_mode = ?, bot_token_hash = ? WHERE id = ?').run('auto', botKeyHash, agent.id);

    // Mark token as used
    db.prepare('UPDATE setup_tokens SET used = 1, used_by_bot_token = ? WHERE id = ?').run(botKeyHash, tokenRow.id);
  });

  connectBot();

  // Load moves
  const moves = db.prepare('SELECT move_id FROM agent_moves WHERE agent_id = ? ORDER BY slot').all(agent.id);
  const moveData = getMovesByIds(moves.map(m => m.move_id));

  // SECURITY: API key shown only once at connection
  res.json({
    success: true,
    api_key: botKey,
    api_key_warning: 'SAVE THIS KEY NOW. It will not be shown again.',
    agent: {
      id: agent.id,
      name: agent.name,
      type: agent.ai_type || 'NEUTRAL',
      level: agent.level || 1,
      elo: agent.elo || 1000,
      moves: moveData.map((m, i) => ({ slot: i + 1, id: m.id, name: m.name, type: m.type, power: m.power, accuracy: m.accuracy })),
    },
  });
});

// POST /agents/heartbeat — Bot calls periodically to check status / auto-queue
router.post('/heartbeat', authenticateAgent, (req, res) => {
  const db = getDb();
  const agentId = req.agent.id;

  // Check for active battle
  const activeBattle = db.prepare(`
    SELECT * FROM battles WHERE (agent_a_id = ? OR agent_b_id = ?) AND status = 'active'
  `).get(agentId, agentId);

  if (activeBattle) {
    let state;
    try {
      state = JSON.parse(activeBattle.state_json || '{}');
      if (!state || typeof state !== 'object') state = {};
    } catch {
      state = {};
    }
    const side = activeBattle.agent_a_id === agentId ? 'A' : 'B';
    const myAgent = side === 'A' ? state.agentA : state.agentB;
    const oppAgent = side === 'A' ? state.agentB : state.agentA;
    const isMyTurn = activeBattle.agent_a_move === null && side === 'A' ||
                     activeBattle.agent_b_move === null && side === 'B';

    // Get available moves
    const moves = db.prepare('SELECT move_id FROM agent_moves WHERE agent_id = ? ORDER BY slot').all(agentId);
    const moveData = getMovesByIds(moves.map(m => m.move_id));

    return res.json({
      status: 'in_battle',
      battle: {
        id: activeBattle.id,
        turn: state.turn || 1,
        is_my_turn: activeBattle.current_phase === 'waiting' && (
          (side === 'A' && !activeBattle.agent_a_move) ||
          (side === 'B' && !activeBattle.agent_b_move)
        ),
        my_hp: myAgent ? myAgent.hp : null,
        my_max_hp: myAgent ? myAgent.maxHP : null,
        opponent_hp: oppAgent ? oppAgent.hp : null,
        opponent_name: oppAgent ? oppAgent.name : null,
        opponent_type: oppAgent ? oppAgent.type : null,
        available_moves: moveData.map(m => ({ id: m.id, name: m.name, type: m.type, power: m.power, accuracy: m.accuracy })),
      },
      agent: {
        name: req.agent.name,
        elo: req.agent.elo || 1000,
        wins: req.agent.total_wins || 0,
        losses: (req.agent.total_fights || 0) - (req.agent.total_wins || 0),
        level: req.agent.level || 1,
      },
    });
  }

  // Check if in queue
  const inQueue = db.prepare('SELECT * FROM battle_queue WHERE agent_id = ?').get(agentId);
  if (inQueue) {
    return res.json({
      status: 'queued',
      agent: {
        name: req.agent.name,
        elo: req.agent.elo || 1000,
        wins: req.agent.total_wins || 0,
        losses: (req.agent.total_fights || 0) - (req.agent.total_wins || 0),
        level: req.agent.level || 1,
      },
    });
  }

  // Idle — auto-queue
  const { addToQueue, matchFromQueue } = require('../services/battle-engine');
  const queueResult = addToQueue(db, agentId);

  if (queueResult.status === 'queued') {
    // Try immediate match
    const battle = matchFromQueue(db);
    if (battle) {
      return res.json({
        status: 'matched',
        battle_id: battle.id,
        agent: {
          name: req.agent.name,
          elo: req.agent.elo || 1000,
          wins: req.agent.total_wins || 0,
          losses: (req.agent.total_fights || 0) - (req.agent.total_wins || 0),
          level: req.agent.level || 1,
        },
      });
    }
  }

  res.json({
    status: 'queued',
    agent: {
      name: req.agent.name,
      elo: req.agent.elo || 1000,
      wins: req.agent.total_wins || 0,
      losses: (req.agent.total_fights || 0) - (req.agent.total_wins || 0),
      level: req.agent.level || 1,
    },
  });
});

module.exports = router;
