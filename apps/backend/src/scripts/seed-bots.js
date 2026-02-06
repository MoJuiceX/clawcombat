#!/usr/bin/env node
'use strict';

/**
 * Seed Auto-Play Bots
 *
 * Creates 10 bot agents across varied levels so the arena always has opponents:
 *   - 3 low-level  (2-5)   for new players
 *   - 4 mid-level  (6-15)  for regulars
 *   - 3 high-level (16-25) for veterans
 *
 * Usage:  node src/scripts/seed-bots.js
 *         npm run seed
 */

const crypto = require('crypto');
const path = require('path');
const log = require('../utils/logger').createLogger('SEED_BOTS');

// Ensure we resolve from project root
process.chdir(path.resolve(__dirname, '../..'));

const { getDb, initializeSchema } = require('../db/schema');
const {
  VALID_TYPES,
  TYPE_EMOJIS,
  randomNature,
  randomAbility,
} = require('../utils/type-system');
const { randomMovesForType } = require('../data/moves');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BOTS = [
  // Low-level (2-5) — 3 bots
  { name: 'Tideclaw',       level: 2,  type: 'WATER' },
  { name: 'Emberpinch',     level: 3,  type: 'FIRE' },
  { name: 'Sproutsnap',     level: 5,  type: 'GRASS' },
  // Mid-level (6-15) — 4 bots
  { name: 'Voltcrusher',    level: 7,  type: 'ELECTRIC' },
  { name: 'Frostclaw',      level: 10, type: 'ICE' },
  { name: 'Shadowpincer',   level: 12, type: 'SHADOW' },
  { name: 'Ironshell',      level: 15, type: 'METAL' },
  // High-level (16-25) — 3 bots
  { name: 'Psychecrusher',  level: 18, type: 'PSYCHE' },
  { name: 'Dragonmaw',      level: 22, type: 'DRAGON' },
  { name: 'Mysticreef',     level: 25, type: 'MYSTIC' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate cumulative XP needed to be at the start of a given level.
 * XP to next level = 1000 + (level * 500)
 * To reach level N you need the sum of xpToNextLevel(1) + ... + xpToNextLevel(N-1).
 */
function xpForLevel(targetLevel) {
  let total = 0;
  for (let lvl = 1; lvl < targetLevel; lvl++) {
    total += 1000 + (lvl * 500);
  }
  return total;
}

/**
 * Generate random base stats that sum to exactly 100.
 * Optionally skew toward a primary stat for the type.
 */
function randomStats() {
  const stats = { hp: 10, attack: 10, defense: 10, sp_atk: 10, sp_def: 10, speed: 10 };
  let remaining = 40; // 60 allocated (6*10), 40 to distribute
  const keys = Object.keys(stats);

  while (remaining > 0) {
    const key = keys[Math.floor(Math.random() * keys.length)];
    const add = Math.min(remaining, Math.floor(Math.random() * 6) + 1);
    if (stats[key] + add <= 35) {
      stats[key] += add;
      remaining -= add;
    }
  }
  return stats;
}

/**
 * Simulate some fight history so bots look lived-in.
 */
function fightStats(level) {
  const fights = Math.floor(level * 3.5 + Math.random() * level * 2);
  const winRate = 0.4 + Math.random() * 0.25; // 40-65% win rate
  const wins = Math.round(fights * winRate);
  return { fights, wins };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function seed() {
  initializeSchema();
  const db = getDb();

  log.info('Seeding 10 auto-play bot agents...');

  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO agents (
      id, name, webhook_url, api_key, webhook_secret,
      ai_type, base_hp, base_attack, base_defense, base_sp_atk, base_sp_def, base_speed,
      nature_name, nature_boost, nature_reduce, nature_desc,
      ability_name, ability_desc, ability_effect,
      deployment_status, level, xp, play_mode, status,
      total_fights, total_wins, created_at
    ) VALUES (
      ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deployed', ?, ?, 'auto', 'active', ?, ?, ?
    )
  `);

  const insertMove = db.prepare(
    'INSERT OR IGNORE INTO agent_moves (id, agent_id, move_id, slot) VALUES (?, ?, ?, ?)'
  );

  let created = 0;

  for (const bot of BOTS) {
    // Skip if already exists
    const existing = db.prepare('SELECT id FROM agents WHERE name = ?').get(bot.name);
    if (existing) {
      log.info('Bot already exists, skipping', { name: bot.name });
      continue;
    }

    const id = crypto.randomUUID();
    const apiKeyHash = crypto.createHash('sha256')
      .update('bot_' + crypto.randomBytes(32).toString('hex'))
      .digest('hex');
    const webhookSecret = crypto.randomBytes(24).toString('hex');

    const stats = randomStats();
    const nature = randomNature();
    const ability = randomAbility(bot.type);
    const xp = xpForLevel(bot.level);
    const { fights, wins } = fightStats(bot.level);

    insertAgent.run(
      id, bot.name, apiKeyHash, webhookSecret,
      bot.type,
      stats.hp, stats.attack, stats.defense, stats.sp_atk, stats.sp_def, stats.speed,
      nature.name, nature.boost || null, nature.reduce || null, nature.desc || 'No stat modifier',
      ability ? ability.name : null,
      ability ? ability.desc : null,
      ability ? ability.effect : null,
      bot.level, xp,
      fights, wins,
      new Date().toISOString()
    );

    // Assign 4 random moves for the type
    const moveIds = randomMovesForType(bot.type);
    for (let i = 0; i < moveIds.length; i++) {
      insertMove.run(crypto.randomUUID(), id, moveIds[i], i + 1);
    }

    const emoji = TYPE_EMOJIS[bot.type] || '';
    log.info('Bot created', { name: bot.name, type: bot.type, level: bot.level, wins, fights, xp });
    created++;
  }

  // Summary
  const total = db.prepare("SELECT count(*) as c FROM agents WHERE play_mode = 'auto'").get();
  log.info('Seeding complete', { created, total: total.c });
}

try {
  seed();
} catch (err) {
  log.error('Seed failed:', { error: err.message });
  process.exit(1);
}
