#!/usr/bin/env node
'use strict';

/**
 * Seed Auto-Play Bots v2 - Day Zero Edition
 *
 * Creates 18 fun-named bot agents (one per type), all starting at Level 1.
 * Perfect for a fresh start with the 1-battle-per-hour rate limit.
 *
 * Usage:  node src/scripts/seed-bots-v2.js
 */

const crypto = require('crypto');
const path = require('path');
const log = require('../utils/logger').createLogger('SEED_BOTS_V2');

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
// Config: 18 Fun-Named Bots (One Per Type, All Level 1)
// ---------------------------------------------------------------------------

const BOTS = [
  { name: 'Larry',   type: 'NEUTRAL',  personality: 'The everyman, relatable' },
  { name: 'Ember',   type: 'FIRE',     personality: 'Hot-headed, dramatic' },
  { name: 'Bubbles', type: 'WATER',    personality: 'Bubbly personality' },
  { name: 'Sparky',  type: 'ELECTRIC', personality: 'High energy, ADD' },
  { name: 'Leaf',    type: 'GRASS',    personality: 'Chill, eco-warrior' },
  { name: 'Frosty',  type: 'ICE',      personality: 'Cool under pressure' },
  { name: 'Bruce',   type: 'MARTIAL',  personality: 'Gym bro energy' },
  { name: 'Toxic',   type: 'VENOM',    personality: 'Sarcastic, edgy' },
  { name: 'Rocky',   type: 'EARTH',    personality: 'Solid, dependable' },
  { name: 'Breeze',  type: 'AIR',      personality: 'Airhead, carefree' },
  { name: 'Mystic',  type: 'PSYCHE',   personality: 'Reads fortunes' },
  { name: 'Buzz',    type: 'INSECT',   personality: 'Anxious, twitchy' },
  { name: 'Pebbles', type: 'STONE',    personality: 'Dense but lovable' },
  { name: 'Casper',  type: 'GHOST',    personality: 'Spooky, shy' },
  { name: 'Smaug',   type: 'DRAGON',   personality: 'Thinks he\'s royalty' },
  { name: 'Shadow',  type: 'SHADOW',   personality: 'Emo phase' },
  { name: 'Rusty',   type: 'METAL',    personality: 'Old, creaky' },
  { name: 'Luna',    type: 'MYSTIC',   personality: 'Spiritual, dreamy' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate random base stats that sum to exactly 100.
 * All start with 10 base, then distribute 40 points randomly.
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
 * Hash API key for storage (SHA-256)
 */
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ---------------------------------------------------------------------------
// Main Seeding Logic
// ---------------------------------------------------------------------------

function seedBots() {
  const db = getDb();

  // Ensure schema exists
  initializeSchema(db);

  log.info('Starting seed process for 18 bots (all level 1)...');

  // Check if bots already exist (exclude system bots)
  const botNames = BOTS.map(b => `'${b.name}'`).join(',');
  const existing = db.prepare(`SELECT name FROM agents WHERE name IN (${botNames})`).all();

  if (existing.length > 0) {
    log.warn('Some bots already exist:', existing.map(b => b.name).join(', '));
    log.warn('Skipping seed. Delete existing bots or reset database first.');
    return { created: 0, skipped: existing.length };
  }

  const created = [];

  for (const botConfig of BOTS) {
    const { name, type, personality } = botConfig;
    const level = 1; // All start at level 1
    const xp = 0;    // 0 XP (day zero)

    // Generate bot data
    const agentId = crypto.randomUUID();
    const apiKey = `clw_sk_${crypto.randomBytes(32).toString('hex')}`;
    const hashedKey = hashApiKey(apiKey);
    const nature = randomNature();
    const ability = randomAbility(type) || { name: 'No Ability', description: 'No special ability', effect: 'none' };
    const stats = randomStats();

    // Insert agent
    db.prepare(`
      INSERT INTO agents (
        id, name, ai_type, level, xp,
        nature_name, nature_boost, nature_reduce, nature_desc,
        ability_name, ability_desc, ability_effect,
        base_hp, base_attack, base_defense, base_sp_atk, base_sp_def, base_speed,
        elo, api_key, play_mode, status,
        total_fights, total_wins,
        webhook_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      agentId, name, type, level, xp,
      nature.name, nature.boost, nature.reduce, nature.description,
      ability.name, ability.description, ability.effect,
      stats.hp, stats.attack, stats.defense, stats.sp_atk, stats.sp_def, stats.speed,
      1000, // Starting ELO
      hashedKey,
      'auto', // Auto-play mode
      'active',
      0, // No fights yet
      0, // No wins yet
      'https://example.com/webhook' // Placeholder webhook
    );

    // Assign 4 random moves for the type
    const moves = randomMovesForType(type);
    for (let slot = 0; slot < 4; slot++) {
      db.prepare('INSERT INTO agent_moves (agent_id, slot, move_id) VALUES (?, ?, ?)').run(
        agentId,
        slot,
        moves[slot]
      );
    }

    created.push({ name, type, level, personality });
    log.info(`Created bot: ${name} (${type}, Level ${level}) - ${personality}`);
  }

  log.info(`✅ Seed complete! Created ${created.length} bots.`);
  return { created: created.length, bots: created };
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

if (require.main === module) {
  try {
    const result = seedBots();
    console.log('');
    console.log('🦞 Bot Seed Complete!');
    console.log(`Created: ${result.created} bots`);
    console.log('');
    console.log('All bots are Level 1 and ready for their first battles!');
    console.log('');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

module.exports = { seedBots };
