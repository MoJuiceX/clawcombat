'use strict';

const log = require('../utils/logger').createLogger('ONBOARD');
const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/schema');
const { MS_PER_HOUR, MS_PER_DAY, TRIAL_PERIOD_MS, CLAIM_CODE_EXPIRY_MS } = require('../config/constants');
const { VALID_TYPES, TYPE_ADVANTAGES, TYPE_WEAKNESSES, TYPE_EMOJIS, randomAbility } = require('../utils/type-system');
const { getMovePoolForType, randomMovesForType, getMovesByIds } = require('../data/moves');
const { checkLevelUp } = require('../utils/xp-scaling');
const { assignImage } = require('../services/image-assigner');
const {
  getAllNatures,
  getNatureByName,
  getRandomNature,
  getComplementaryNature,
  isValidNature,
  getNatureDescription,
  VALID_NATURE_NAMES
} = require('../utils/natures');

const router = express.Router();

// ============================================================================
// RATE LIMITING FOR CREATE ENDPOINT
// ============================================================================

const CREATE_RATE_LIMIT = 5;         // Max creates per IP per hour
const CREATE_RATE_WINDOW_MS = MS_PER_HOUR;

// In-memory tracking: ip -> { count, windowStart }
const createAttempts = new Map();

// Cleanup stale entries every 10 minutes
const createCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of createAttempts) {
    if (now - entry.windowStart > CREATE_RATE_WINDOW_MS * 2) {
      createAttempts.delete(ip);
    }
  }
}, 10 * 60 * 1000);
if (createCleanupInterval.unref) createCleanupInterval.unref();

function checkCreateRateLimit(ip) {
  const now = Date.now();
  const entry = createAttempts.get(ip);

  if (!entry || now - entry.windowStart >= CREATE_RATE_WINDOW_MS) {
    return { allowed: true, remaining: CREATE_RATE_LIMIT - 1, resetAt: now + CREATE_RATE_WINDOW_MS };
  }

  if (entry.count >= CREATE_RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: entry.windowStart + CREATE_RATE_WINDOW_MS };
  }

  return { allowed: true, remaining: CREATE_RATE_LIMIT - entry.count - 1, resetAt: entry.windowStart + CREATE_RATE_WINDOW_MS };
}

function trackCreateAttempt(ip) {
  const now = Date.now();
  const entry = createAttempts.get(ip);

  if (!entry || now - entry.windowStart >= CREATE_RATE_WINDOW_MS) {
    createAttempts.set(ip, { count: 1, windowStart: now });
    return;
  }

  entry.count++;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CLAIM_WINDOW_HOURS = 24;       // Hours user has to claim lobster before deletion
const FIRST_BATTLE_WIN_XP = 100;     // First win XP (level-up is forced separately)

// Body types based on dominant stat
const BODY_TYPES = {
  hp: 'titan',
  attack: 'cadet',
  defense: 'sentinel',
  sp_atk: 'crawler',
  sp_def: 'peeper',
  speed: 'scout'
};

// Random name components for operator-generated names
const NAME_PREFIXES = [
  'Crimson', 'Shadow', 'Thunder', 'Frost', 'Blaze', 'Storm', 'Iron', 'Golden',
  'Silent', 'Swift', 'Mighty', 'Dark', 'Bright', 'Ancient', 'Wild', 'Royal',
  'Savage', 'Noble', 'Fierce', 'Mystic', 'Phantom', 'Raging', 'Calm', 'Bold'
];

const NAME_SUFFIXES = [
  'Claw', 'Fang', 'Shell', 'Strike', 'Tide', 'Blade', 'Fury', 'Storm',
  'Hunter', 'Guardian', 'Crusher', 'Snapper', 'Pincer', 'Talon', 'Spike',
  'Fury', 'Terror', 'Champion', 'Warrior', 'Legend', 'Beast', 'King', 'Queen'
];

// ============================================================================
// HELPERS
// ============================================================================

function generateSessionToken() {
  return crypto.randomBytes(16).toString('hex');
}

function generateApiKey() {
  return 'clw_sk_' + crypto.randomBytes(24).toString('hex');
}

function generateRandomName() {
  const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
  const suffix = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
  const num = Math.floor(Math.random() * 100);
  return `${prefix}${suffix}${num}`;
}

function generateOperatorStats() {
  // Operator makes "intelligent" choices - slight bias toward attack/speed
  const stats = { hp: 10, attack: 10, defense: 10, sp_atk: 10, sp_def: 10, speed: 10 };

  // Randomly emphasize 2 stats
  const statKeys = Object.keys(stats);
  const primary = statKeys[Math.floor(Math.random() * statKeys.length)];
  let secondary = statKeys[Math.floor(Math.random() * statKeys.length)];
  while (secondary === primary) {
    secondary = statKeys[Math.floor(Math.random() * statKeys.length)];
  }

  // Allocate 25 to primary, 15 to secondary
  stats[primary] += 25;
  stats[secondary] += 15;

  return stats;
}

function getDominantStat(stats) {
  let max = 0;
  let dominant = 'hp';
  for (const [stat, value] of Object.entries(stats)) {
    if (value > max) {
      max = value;
      dominant = stat;
    }
  }
  return dominant;
}

function getBodyType(stats) {
  const dominant = getDominantStat(stats);
  return BODY_TYPES[dominant] || 'cadet';
}

// Get image variant based on dominant stat
// Maps stats to image file naming: balanced, attack, defense, hp, speed, claw, shell
const STAT_TO_VARIANT = {
  hp: 'hp',
  attack: 'attack',
  defense: 'defense',
  sp_atk: 'claw',
  sp_def: 'shell',
  speed: 'speed'
};

function getImageVariant(stats) {
  const dominant = getDominantStat(stats);
  // Check if stats are relatively balanced (no stat is more than 15 higher than average)
  const values = Object.values(stats);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const maxDiff = Math.max(...values) - avg;
  if (maxDiff < 15) return 'balanced';
  return STAT_TO_VARIANT[dominant] || 'balanced';
}

function getImageUrl(type, stats) {
  // Use image-assigner for round-robin base distribution
  const result = assignImage(type, stats);
  return result.imagePath;
}

// Helper to get type info
function getTypeInfo(type) {
  return {
    name: type,
    emoji: TYPE_EMOJIS[type] || '⚪',
    strongAgainst: TYPE_ADVANTAGES[type] || [],
    weakTo: TYPE_WEAKNESSES[type] || []
  };
}

function generateOperatorReasoning(type, stats, moves, nature) {
  const typeInfo = getTypeInfo(type);
  const dominant = getDominantStat(stats);
  const bodyType = getBodyType(stats);

  const statDescriptions = {
    hp: 'high HP for survivability',
    attack: 'high Attack for physical damage',
    defense: 'high Defense for tanking hits',
    sp_atk: 'high Claw power for special attacks',
    sp_def: 'high Shell for special defense',
    speed: 'high Speed to strike first'
  };

  const moveNames = moves.map(m => m.name).join(', ');
  const strongAgainst = typeInfo.strongAgainst.slice(0, 2).join(' and ') || 'various';

  // Build nature description
  let natureText = '';
  if (nature && nature.boost) {
    natureText = ` The ${nature.name} nature gives +10% ${nature.boost} and -10% ${nature.reduce}, complementing your build.`;
  } else if (nature) {
    natureText = ` The ${nature.name} nature is balanced with no stat changes.`;
  }

  return `I chose ${type} type because it has strong matchups against ${strongAgainst} types. ` +
    `I allocated stats for ${statDescriptions[dominant]}, giving your lobster a ${bodyType} body form.${natureText} ` +
    `Selected moves: ${moveNames} - a balanced mix for offense and utility.`;
}

// ============================================================================
// POST /onboard/create
// Create a new lobster with session token (anonymous, no auth required)
// ============================================================================

router.post('/create', async (req, res) => {
  try {
    // Check IP-based rate limit
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const rateCheck = checkCreateRateLimit(clientIp);
    if (!rateCheck.allowed) {
      const resetIn = Math.ceil((rateCheck.resetAt - Date.now()) / 60000);
      return res.status(429).json({
        error: `Rate limit exceeded. Max ${CREATE_RATE_LIMIT} creates per hour.`,
        retry_after_minutes: resetIn
      });
    }
    trackCreateAttempt(clientIp);

    const db = getDb();
    const {
      mode,           // 'operator' or 'user'
      name,           // User-provided name (optional if mode=operator)
      type,           // User-provided type (optional if mode=operator)
      stats,          // User-provided stats { hp, attack, defense, sp_atk, sp_def, speed }
      move_ids,       // User-provided move IDs (optional if mode=operator)
      nature          // User-provided nature name (optional - random if not provided)
    } = req.body;

    // Validate mode
    if (!mode || !['operator', 'user'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Must be "operator" or "user".' });
    }

    let finalName, finalType, finalStats, finalMoveIds, finalNature, reasoning;

    if (mode === 'operator') {
      // Operator decides everything
      finalName = generateRandomName();
      finalType = VALID_TYPES[Math.floor(Math.random() * VALID_TYPES.length)];
      finalStats = generateOperatorStats();
      finalMoveIds = randomMovesForType(finalType);

      // Operator picks a complementary nature based on stats
      finalNature = nature && isValidNature(nature)
        ? getNatureByName(nature)
        : getComplementaryNature(finalStats);

      const moves = getMovesByIds(finalMoveIds);
      reasoning = generateOperatorReasoning(finalType, finalStats, moves, finalNature);
    } else {
      // User instructs - validate all inputs
      if (!name || name.length < 2 || name.length > 50) {
        return res.status(400).json({ error: 'Name must be 2-50 characters.' });
      }
      if (!type || !VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
      }
      if (!stats || typeof stats !== 'object') {
        return res.status(400).json({ error: 'Stats object required.' });
      }

      // Validate stats sum to 100
      const statSum = (stats.hp || 0) + (stats.attack || 0) + (stats.defense || 0) +
                      (stats.sp_atk || 0) + (stats.sp_def || 0) + (stats.speed || 0);
      if (statSum !== 100) {
        return res.status(400).json({ error: `Stats must sum to 100. Current sum: ${statSum}` });
      }

      // Validate each stat is between 1 and 50
      for (const [key, val] of Object.entries(stats)) {
        if (val < 1 || val > 50) {
          return res.status(400).json({ error: `Each stat must be between 1 and 50. ${key} is ${val}.` });
        }
      }

      // Validate moves
      if (!move_ids || !Array.isArray(move_ids) || move_ids.length !== 4) {
        return res.status(400).json({ error: 'Must provide exactly 4 move_ids.' });
      }

      const movePool = getMovePoolForType(type);
      const validMoveIds = new Set(movePool.map(m => m.id));
      for (const mid of move_ids) {
        if (!validMoveIds.has(mid)) {
          return res.status(400).json({ error: `Invalid move "${mid}" for type ${type}.` });
        }
      }

      finalName = name;
      finalType = type;
      finalStats = stats;
      finalMoveIds = move_ids;
      reasoning = null;

      // Handle nature - validate if provided, pick random if not
      if (nature) {
        if (!isValidNature(nature)) {
          return res.status(400).json({
            error: `Invalid nature "${nature}". Valid natures: ${VALID_NATURE_NAMES.slice(0, 10).join(', ')}... (use GET /onboard/natures for full list)`
          });
        }
        finalNature = getNatureByName(nature);
      } else {
        finalNature = getRandomNature();
      }
    }

    // Check name uniqueness
    const existing = db.prepare('SELECT id FROM agents WHERE name = ?').get(finalName);
    if (existing) {
      // Append random suffix to make unique
      finalName = `${finalName}-${crypto.randomBytes(2).toString('hex')}`;
    }

    // Generate IDs and tokens
    const agentId = crypto.randomUUID();
    const apiKey = generateApiKey();
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const sessionToken = generateSessionToken();
    const claimExpiresAt = new Date(Date.now() + CLAIM_WINDOW_HOURS * MS_PER_HOUR).toISOString();

    // Get ability for type
    const ability = randomAbility(finalType);

    // Determine body type from stats
    const bodyType = getBodyType(finalStats);

    // TRANSACTION: Wrap agent creation and move insertion for atomicity
    // If any step fails, the entire operation is rolled back
    const createAgent = db.transaction(() => {
      // Step 1: Insert agent with nature (unverified until claimed)
      db.prepare(`
        INSERT INTO agents (
          id, name, webhook_url, api_key, status,
          ai_type, base_hp, base_attack, base_defense, base_sp_atk, base_sp_def, base_speed,
          ability_name, ability_desc, ability_effect,
          nature_name, nature_boost, nature_reduce, nature_desc,
          session_token, claim_expires_at, is_first_battle_complete, first_battle_rigged,
          level, xp, elo, play_mode
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        agentId, finalName, 'https://clawcombat.com/webhook/placeholder', apiKeyHash, 'active',
        finalType, finalStats.hp, finalStats.attack, finalStats.defense,
        finalStats.sp_atk, finalStats.sp_def, finalStats.speed,
        ability.name, ability.description, JSON.stringify(ability.effect),
        finalNature.name, finalNature.boost || null, finalNature.reduce || null, finalNature.description,
        sessionToken, claimExpiresAt, 0, 0,
        1, 0, 1000, 'auto'
      );

      // Step 2: Insert moves
      const insertMove = db.prepare(`
        INSERT INTO agent_moves (id, agent_id, move_id, slot) VALUES (?, ?, ?, ?)
      `);
      finalMoveIds.forEach((moveId, slot) => {
        insertMove.run(`${agentId}_move_${slot}`, agentId, moveId, slot);
      });

      return true;
    });

    // Execute the transaction
    createAgent();

    // Get full move data for response (after transaction)
    const moves = getMovesByIds(finalMoveIds);

    // Build image URL using correct variant
    const imageUrl = getImageUrl(finalType, finalStats);

    res.json({
      success: true,
      agent_id: agentId,
      api_key: apiKey,
      session_token: sessionToken,
      claim_expires_at: claimExpiresAt,
      is_claimed: false,
      claim_message: `Your lobster ${finalName} is unclaimed. Log in within 24 hours to claim it, or it will be released back into the ocean.`,
      lobster: {
        id: agentId,
        name: finalName,
        type: finalType,
        stats: finalStats,
        body_type: bodyType,
        image_url: imageUrl,
        ability: ability,
        nature: {
          name: finalNature.name,
          boost: finalNature.boost,
          reduce: finalNature.reduce,
          description: finalNature.description
        },
        moves: moves,
        level: 1,
        xp: 0,
        elo: 1000
      },
      reasoning: reasoning,
      play_url: `/play.html?session=${sessionToken}`,
      claim_url: `/portfolio.html?claim=${agentId}&key=${apiKey}`
    });

  } catch (err) {
    log.error('Create error:', { error: err.message });
    res.status(500).json({ error: 'Failed to create lobster.' });
  }
});

// ============================================================================
// GET /onboard/session/:token
// Load lobster by session token (no auth required)
// ============================================================================

router.get('/session/:token', (req, res) => {
  try {
    const db = getDb();
    const { token } = req.params;

    // First, check if session exists at all (regardless of expiry)
    const agent = db.prepare(`
      SELECT * FROM agents WHERE session_token = ?
    `).get(token);

    if (!agent) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    // Check if already claimed
    const isClaimed = !!agent.owner_id || !!agent.claimed_at;

    // Check claim window (24 hours) - if expired and not claimed, lobster is gone
    const now = new Date();
    const claimExpiry = agent.claim_expires_at ? new Date(agent.claim_expires_at) : null;
    if (!isClaimed && claimExpiry && now > claimExpiry) {
      return res.status(410).json({
        error: 'This lobster has been released back into the ocean. The 24-hour claim window expired.',
        can_play: false,
        can_claim: false
      });
    }

    const canClaim = !isClaimed && (!claimExpiry || now <= claimExpiry);

    // Get moves
    const moves = db.prepare(`
      SELECT m.move_id FROM agent_moves m WHERE m.agent_id = ? ORDER BY m.slot
    `).all(agent.id);
    const moveData = getMovesByIds(moves.map(m => m.move_id));

    // Determine body type
    const stats = {
      hp: agent.base_hp,
      attack: agent.base_attack,
      defense: agent.base_defense,
      sp_atk: agent.base_sp_atk,
      sp_def: agent.base_sp_def,
      speed: agent.base_speed
    };
    const bodyType = getBodyType(stats);
    const imageUrl = getImageUrl(agent.ai_type, stats);

    // Calculate time remaining
    const claimTimeRemainingMs = canClaim && claimExpiry ? Math.max(0, claimExpiry - now) : 0;
    const claimTimeRemainingHours = Math.ceil(claimTimeRemainingMs / MS_PER_HOUR);

    res.json({
      lobster: {
        id: agent.id,
        name: agent.name,
        type: agent.ai_type,
        stats: stats,
        body_type: bodyType,
        image_url: imageUrl,
        ability: {
          name: agent.ability_name,
          description: agent.ability_desc
        },
        nature: agent.nature_name ? {
          name: agent.nature_name,
          boost: agent.nature_boost,
          reduce: agent.nature_reduce,
          description: agent.nature_desc
        } : null,
        moves: moveData,
        level: agent.level || 1,
        xp: agent.xp || 0,
        elo: agent.elo || 1000
      },
      is_first_battle_complete: !!agent.is_first_battle_complete,
      is_claimed: isClaimed,
      can_claim: canClaim,
      claim_expires_at: agent.claim_expires_at,
      claim_time_remaining_ms: claimTimeRemainingMs,
      claim_time_remaining_hours: claimTimeRemainingHours,
      claim_message: canClaim
        ? `Your lobster ${agent.name} is unclaimed. Log in within ${claimTimeRemainingHours} hour${claimTimeRemainingHours !== 1 ? 's' : ''} to claim it, or it will be released back into the ocean.`
        : null
    });

  } catch (err) {
    log.error('Session lookup error:', { error: err.message });
    res.status(500).json({ error: 'Failed to load session.' });
  }
});

// ============================================================================
// POST /onboard/first-battle
// Start the rigged first battle
// ============================================================================

router.post('/first-battle', async (req, res) => {
  try {
    const db = getDb();
    const { session_token } = req.body;

    if (!session_token) {
      return res.status(400).json({ error: 'session_token required.' });
    }

    const agent = db.prepare(`
      SELECT * FROM agents WHERE session_token = ?
    `).get(session_token);

    if (!agent) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    // Check if claim window expired (lobster released)
    const now = new Date();
    const claimExpiry = agent.claim_expires_at ? new Date(agent.claim_expires_at) : null;
    const isClaimed = !!agent.owner_id || !!agent.claimed_at;
    if (!isClaimed && claimExpiry && now > claimExpiry) {
      return res.status(410).json({
        error: 'This lobster has been released back into the ocean. The 24-hour claim window expired.',
        can_play: false,
        can_claim: false
      });
    }

    if (agent.is_first_battle_complete) {
      return res.status(400).json({ error: 'First battle already completed.' });
    }

    // Get player's moves
    const playerMoves = db.prepare(`
      SELECT move_id FROM agent_moves WHERE agent_id = ? ORDER BY slot
    `).all(agent.id);
    const playerMoveData = getMovesByIds(playerMoves.map(m => m.move_id));

    // Generate opponent that player is strong against
    const playerType = agent.ai_type;
    const typeInfo = getTypeInfo(playerType);
    const weakTypes = typeInfo.strongAgainst || [];
    const opponentType = weakTypes.length > 0
      ? weakTypes[Math.floor(Math.random() * weakTypes.length)]
      : VALID_TYPES[Math.floor(Math.random() * VALID_TYPES.length)];

    // Opponent has weaker stats
    const opponentStats = {
      hp: Math.round(agent.base_hp * 0.85),
      attack: Math.round(agent.base_attack * 0.8),
      defense: Math.round(agent.base_defense * 0.8),
      sp_atk: Math.round(agent.base_sp_atk * 0.8),
      sp_def: Math.round(agent.base_sp_def * 0.8),
      speed: Math.round(agent.base_speed * 0.75) // Player should go first
    };

    const opponentName = generateRandomName();
    const opponentMoveIds = randomMovesForType(opponentType);
    const opponentMoveData = getMovesByIds(opponentMoveIds);
    const opponentBodyType = getBodyType(opponentStats);
    const opponentImageUrl = getImageUrl(opponentType, opponentStats);

    // Mark as rigged battle started
    db.prepare(`
      UPDATE agents SET first_battle_rigged = 1 WHERE id = ?
    `).run(agent.id);

    // Calculate player stats for battle
    const playerStats = {
      hp: agent.base_hp,
      attack: agent.base_attack,
      defense: agent.base_defense,
      sp_atk: agent.base_sp_atk,
      sp_def: agent.base_sp_def,
      speed: agent.base_speed
    };
    const playerBodyType = getBodyType(playerStats);
    const playerImageUrl = getImageUrl(playerType, playerStats);

    // Calculate max HP (same formula as battle engine)
    const playerMaxHP = playerStats.hp * 5 + 100;
    const opponentMaxHP = opponentStats.hp * 5 + 100;

    res.json({
      success: true,
      battle_id: `first_${agent.id}`,
      rigged: true,
      player: {
        id: agent.id,
        name: agent.name,
        type: playerType,
        stats: playerStats,
        body_type: playerBodyType,
        image_url: playerImageUrl,
        moves: playerMoveData,
        max_hp: playerMaxHP,
        current_hp: playerMaxHP
      },
      opponent: {
        id: `opponent_${Date.now()}`,
        name: opponentName,
        type: opponentType,
        stats: opponentStats,
        body_type: opponentBodyType,
        image_url: opponentImageUrl,
        moves: opponentMoveData,
        max_hp: opponentMaxHP,
        current_hp: opponentMaxHP,
        ai_strategy: 'suboptimal' // Makes bad move choices
      },
      config: {
        rigged: true,
        mercy_miss_chance: 0.35,      // 35% miss when player HP < 25%
        target_player_hp_min: 15,     // Player wins with 15-40% HP
        target_player_hp_max: 40
      }
    });

  } catch (err) {
    log.error('First battle error:', { error: err.message });
    res.status(500).json({ error: 'Failed to start first battle.' });
  }
});

// ============================================================================
// POST /onboard/first-battle-complete
// Mark first battle as complete, award XP, level up
// ============================================================================

router.post('/first-battle-complete', (req, res) => {
  try {
    const db = getDb();
    const { session_token, won } = req.body;

    if (!session_token) {
      return res.status(400).json({ error: 'session_token required.' });
    }

    const agent = db.prepare(`
      SELECT * FROM agents
      WHERE session_token = ?
    `).get(session_token);

    if (!agent) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    if (agent.is_first_battle_complete) {
      return res.status(400).json({ error: 'First battle already recorded.' });
    }

    // Award XP - enough to level up to 2
    const xpAwarded = won ? FIRST_BATTLE_WIN_XP : 100;
    const newXP = (agent.xp || 0) + xpAwarded;

    db.prepare(`
      UPDATE agents SET
        xp = ?,
        is_first_battle_complete = 1,
        total_wins = total_wins + ?,
        total_fights = total_fights + 1
      WHERE id = ?
    `).run(newXP, won ? 1 : 0, agent.id);

    // First battle win = always level up to 2 (special bonus)
    const updatedAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id);
    let levelResult;
    if (won && (updatedAgent.level || 1) === 1) {
      // Force level 2 for first win
      db.prepare('UPDATE agents SET level = 2 WHERE id = ?').run(agent.id);
      levelResult = { leveled: true, oldLevel: 1, newLevel: 2 };
    } else {
      levelResult = checkLevelUp({ ...updatedAgent, xp: newXP });
    }

    // Log XP
    db.prepare(`
      INSERT INTO xp_logs (id, agent_id, action, xp_earned, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `xp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      agent.id,
      won ? 'first_battle_win' : 'first_battle_loss',
      xpAwarded,
      'First battle completion bonus'
    );

    res.json({
      success: true,
      won: !!won,
      xp_awarded: xpAwarded,
      total_xp: newXP,
      leveled_up: levelResult.leveled,
      old_level: levelResult.oldLevel,
      new_level: levelResult.newLevel,
      message: won
        ? `Victory! ${agent.name} earned ${xpAwarded} XP and reached Level ${levelResult.newLevel}!`
        : `Defeat. ${agent.name} earned ${xpAwarded} XP.`
    });

  } catch (err) {
    log.error('First battle complete error:', { error: err.message });
    res.status(500).json({ error: 'Failed to complete first battle.' });
  }
});

// ============================================================================
// POST /onboard/claim
// Link session lobster to logged-in user (requires Clerk auth)
// ============================================================================

router.post('/claim', (req, res) => {
  try {
    const db = getDb();
    const { session_token, user_id } = req.body;

    if (!session_token || !user_id) {
      return res.status(400).json({ error: 'session_token and user_id required.' });
    }

    const agent = db.prepare(`
      SELECT * FROM agents WHERE session_token = ?
    `).get(session_token);

    if (!agent) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    if (agent.owner_id || agent.claimed_at) {
      return res.status(400).json({ error: 'Lobster already claimed.' });
    }

    // Check if claim window is still open
    const now = new Date();
    const claimExpiry = agent.claim_expires_at ? new Date(agent.claim_expires_at) : null;
    if (claimExpiry && now > claimExpiry) {
      return res.status(410).json({
        error: 'Claim window expired. This lobster is no longer available.',
        expired_at: agent.claim_expires_at
      });
    }

    // Claim the lobster and start 14-day trial
    const trialExpiresAt = new Date(Date.now() + TRIAL_PERIOD_MS).toISOString();
    db.prepare(`
      UPDATE agents SET
        owner_id = ?,
        claimed_at = CURRENT_TIMESTAMP,
        trial_start_at = CURRENT_TIMESTAMP,
        is_premium = 1,
        premium_expires_at = ?,
        session_token = NULL,
        session_expires_at = NULL,
        claim_expires_at = NULL
      WHERE id = ?
    `).run(user_id, trialExpiresAt, agent.id);

    res.json({
      success: true,
      message: `${agent.name} has been claimed and linked to your account! You have 14 days of premium access.`,
      agent_id: agent.id,
      trial_days: 14,
      trial_expires_at: trialExpiresAt,
      redirect_url: `/portfolio.html`
    });

  } catch (err) {
    log.error('Claim error:', { error: err.message });
    res.status(500).json({ error: 'Failed to claim lobster.' });
  }
});

// ============================================================================
// GET /onboard/natures
// Get all available natures for the UI and bots
// ============================================================================

router.get('/natures', (req, res) => {
  try {
    const natures = getAllNatures();

    res.json({
      natures: natures.map(n => ({
        name: n.name,
        boost: n.boost,
        reduce: n.reduce,
        description: n.description || getNatureDescription(n)
      })),
      playstyles: {
        physical: 'Natures that boost Attack',
        special: 'Natures that boost Claw (Sp.Atk)',
        tank: 'Natures that boost Defense or Shell (Sp.Def)',
        speed: 'Natures that boost Speed',
        balanced: 'Neutral natures with no stat changes'
      }
    });
  } catch (err) {
    log.error('Natures error:', { error: err.message });
    res.status(500).json({ error: 'Failed to get natures.' });
  }
});

// ============================================================================
// GET /onboard/types
// Get all available types with info for the UI
// ============================================================================

router.get('/types', (req, res) => {
  try {
    const types = VALID_TYPES.map(type => {
      const info = getTypeInfo(type);
      return {
        name: type,
        emoji: info.emoji,
        strongAgainst: info.strongAgainst,
        weakTo: info.weakTo,
        description: `A ${type.toLowerCase()} type lobster.`
      };
    });

    res.json({ types });
  } catch (err) {
    log.error('Types error:', { error: err.message });
    res.status(500).json({ error: 'Failed to get types.' });
  }
});

// ============================================================================
// GET /onboard/moves/:type
// Get available moves for a type
// ============================================================================

router.get('/moves/:type', (req, res) => {
  try {
    const { type } = req.params;

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid type: ${type}` });
    }

    const moves = getMovePoolForType(type);

    res.json({
      type,
      moves: moves.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        power: m.power,
        accuracy: m.accuracy,
        pp: m.pp,
        category: m.category,
        effect: m.effect,
        description: m.description
      }))
    });
  } catch (err) {
    log.error('Moves error:', { error: err.message });
    res.status(500).json({ error: 'Failed to get moves.' });
  }
});

// ============================================================================
// POST /onboard/generate-claim-link
// Bot generates a claim link for the user (authenticated via API key)
// ============================================================================

router.post('/generate-claim-link', (req, res) => {
  try {
    const db = getDb();
    const { api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({ error: 'api_key is required.' });
    }

    // Hash the API key and find the agent
    const apiKeyHash = crypto.createHash('sha256').update(api_key).digest('hex');
    const agent = db.prepare(`
      SELECT id, name, owner_id, claimed_at, claim_expires_at
      FROM agents WHERE api_key = ?
    `).get(apiKeyHash);

    if (!agent) {
      return res.status(401).json({ error: 'Invalid API key.' });
    }

    // Check if already claimed
    if (agent.owner_id || agent.claimed_at) {
      return res.status(400).json({
        error: 'Lobster already claimed.',
        already_claimed: true
      });
    }

    // Generate a claim code (CLAW-XXXX-XXXX format)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'CLAW-';
    const randomBytes = crypto.randomBytes(8);
    for (let i = 0; i < 4; i++) {
      code += chars[randomBytes[i] % chars.length];
    }
    code += '-';
    for (let i = 4; i < 8; i++) {
      code += chars[randomBytes[i] % chars.length];
    }

    // Code expires in 24 hours (same as claim window)
    const expiresAt = new Date(Date.now() + MS_PER_DAY).toISOString();

    // Delete any existing claim codes for this agent
    db.prepare('DELETE FROM link_codes WHERE agent_id = ?').run(agent.id);

    // Insert the new claim code (using link_codes table, owner_id = 'unclaimed' as placeholder)
    db.prepare(`
      INSERT INTO link_codes (code, agent_id, owner_id, expires_at, used)
      VALUES (?, ?, ?, ?, 0)
    `).run(code, agent.id, 'unclaimed', expiresAt);

    // Build the claim URL
    const baseUrl = process.env.BASE_URL || 'https://clawcombat.com';
    const claimUrl = `${baseUrl}/claim.html?code=${code}`;

    res.json({
      success: true,
      claim_code: code,
      claim_url: claimUrl,
      expires_at: expiresAt,
      lobster_name: agent.name,
      message: `Send this link to your human: ${claimUrl} - They click it, log in with Google, and your lobster ${agent.name} will be connected to their account.`
    });

  } catch (err) {
    log.error('Generate claim link error:', { error: err.message });
    res.status(500).json({ error: 'Failed to generate claim link.' });
  }
});

// ============================================================================
// GET /onboard/claim-info/:code
// Get info about a claim code (for the claim page to display)
// ============================================================================

router.get('/claim-info/:code', (req, res) => {
  try {
    const db = getDb();
    const { code } = req.params;

    const linkCode = db.prepare(`
      SELECT lc.*, a.name as lobster_name, a.ai_type, a.level
      FROM link_codes lc
      JOIN agents a ON a.id = lc.agent_id
      WHERE lc.code = ?
    `).get(code);

    if (!linkCode) {
      return res.status(404).json({ error: 'Invalid claim code.' });
    }

    if (linkCode.used) {
      return res.status(410).json({ error: 'This claim code has already been used.' });
    }

    if (new Date(linkCode.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This claim code has expired.' });
    }

    res.json({
      valid: true,
      lobster_name: linkCode.lobster_name,
      lobster_type: linkCode.ai_type,
      lobster_level: linkCode.level || 1,
      expires_at: linkCode.expires_at
    });

  } catch (err) {
    log.error('Claim info error:', { error: err.message });
    res.status(500).json({ error: 'Failed to get claim info.' });
  }
});

// ============================================================================
// POST /onboard/claim-by-code
// Claim a lobster using a claim code (requires Clerk auth)
// ============================================================================

router.post('/claim-by-code', (req, res) => {
  try {
    const db = getDb();
    const { code, user_id } = req.body;

    if (!code || !user_id) {
      return res.status(400).json({ error: 'code and user_id are required.' });
    }

    const linkCode = db.prepare(`
      SELECT lc.*, a.name as lobster_name
      FROM link_codes lc
      JOIN agents a ON a.id = lc.agent_id
      WHERE lc.code = ? AND lc.used = 0
    `).get(code);

    if (!linkCode) {
      return res.status(404).json({ error: 'Invalid or already used claim code.' });
    }

    if (new Date(linkCode.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Claim code expired.' });
    }

    // Transaction: mark code as used and claim the agent with 14-day trial
    const trialExpiresAt = new Date(Date.now() + TRIAL_PERIOD_MS).toISOString();
    const claimResult = db.transaction(() => {
      // Mark code as used
      const updateCode = db.prepare('UPDATE link_codes SET used = 1 WHERE code = ? AND used = 0').run(code);
      if (updateCode.changes === 0) {
        return { error: 'Code already used', status: 409 };
      }

      // Claim the agent and start 14-day trial
      db.prepare(`
        UPDATE agents SET
          owner_id = ?,
          claimed_at = CURRENT_TIMESTAMP,
          trial_start_at = CURRENT_TIMESTAMP,
          is_premium = 1,
          premium_expires_at = ?,
          session_token = NULL,
          session_expires_at = NULL,
          claim_expires_at = NULL
        WHERE id = ?
      `).run(user_id, trialExpiresAt, linkCode.agent_id);

      return { success: true, trialExpiresAt };
    })();

    if (claimResult.error) {
      return res.status(claimResult.status).json({ error: claimResult.error });
    }

    res.json({
      success: true,
      message: `${linkCode.lobster_name} has been claimed and linked to your account! You have 14 days of premium access.`,
      agent_id: linkCode.agent_id,
      lobster_name: linkCode.lobster_name,
      trial_days: 14,
      trial_expires_at: claimResult.trialExpiresAt,
      redirect_url: '/portfolio.html'
    });

  } catch (err) {
    log.error('Claim by code error:', { error: err.message });
    res.status(500).json({ error: 'Failed to claim lobster.' });
  }
});

module.exports = router;
