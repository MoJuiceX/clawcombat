#!/usr/bin/env node
/**
 * COMPLETE DATABASE RESET
 * Deletes ALL data from ALL tables, starts fresh like day zero
 * Preserves schema, only deletes records
 *
 * WARNING: This is irreversible! All battles, agents, and history will be lost.
 */

const { getDb } = require('../db/schema');
const log = require('../utils/logger').createLogger('RESET');

function resetDatabase() {
  const db = getDb();

  try {
    log.warn('DATABASE RESET STARTING - ALL DATA WILL BE DELETED');

    // Get initial stats
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table'
      AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    log.info('Tables found', { count: tables.length, tables: tables.map(t => t.name) });

    // Calculate total records before deletion
    let totalRecordsBefore = 0;
    const tableStats = {};

    for (const { name } of tables) {
      try {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${name}`).get().count;
        tableStats[name] = { before: count, after: 0 };
        totalRecordsBefore += count;
      } catch (e) {
        log.warn(`Could not count records in ${name}:`, e.message);
      }
    }

    log.info('Records before deletion', { total: totalRecordsBefore, by_table: tableStats });

    // Get database size before
    const sizeBefore = db.pragma('page_count')[0].page_count * db.pragma('page_size')[0].page_size;

    // Delete all data in correct order (respecting foreign keys)
    // Order matters: delete children before parents

    const deletionOrder = [
      // Battle-related (most dependent)
      'battle_turns',
      'battle_logs',
      'social_tokens',
      'social_reactions',
      'social_likes',
      'social_comments',
      'social_posts',
      'moltbook_reported_posts',
      'moltbook_posts',

      // Battles
      'battles',
      'battle_queue',
      'match_history',

      // Agent-related
      'agent_moves',
      'agent_stats',
      'stat_tokens',
      'player_badges',
      'achievements',
      'badges',
      'xp_logs',
      'level_history',
      'evolution_history',
      'login_rewards',

      // Governance
      'governance_votes',
      'governance_human_proposals',
      'governance_agent_proposals',
      'voting_window',
      'priority',
      'proposals',
      'progress',
      'build_queue',

      // Economy
      'credit_transactions',
      'user_credits',
      'premium_subscriptions',
      'skin_purchases',

      // Assets
      'avatar_generations',
      'avatars',
      'avatar_library',
      'skins',
      'skin_stats',
      'image_usage',

      // Analytics
      'analytics_events',
      'bot_health_logs',
      'admin_logs',
      'deprecated_endpoint_hits',

      // Social follows
      'social_follows',

      // Telegram
      'telegram_users',

      // Agents (parent of many tables)
      'agents',

      // Users
      'users',

      // Leaderboard
      'leaderboard',
      'leaderboard_archive',

      // Season
      'season_meta',
    ];

    log.info('Starting deletion in order...');

    let totalDeleted = 0;
    const transaction = db.transaction(() => {
      for (const tableName of deletionOrder) {
        try {
          const result = db.prepare(`DELETE FROM ${tableName}`).run();
          if (result.changes > 0) {
            log.info(`Deleted from ${tableName}`, { records: result.changes });
            totalDeleted += result.changes;
            tableStats[tableName].after = 0;
          }
        } catch (e) {
          // Table might not exist or already empty
          log.debug(`Could not delete from ${tableName}:`, e.message);
        }
      }

      // Delete from any remaining tables not in the list
      for (const { name } of tables) {
        if (!deletionOrder.includes(name)) {
          try {
            const result = db.prepare(`DELETE FROM ${name}`).run();
            if (result.changes > 0) {
              log.info(`Deleted from ${name} (not in order list)`, { records: result.changes });
              totalDeleted += result.changes;
            }
          } catch (e) {
            log.warn(`Could not delete from ${name}:`, e.message);
          }
        }
      }
    });

    transaction();

    log.info('Deletion complete (within transaction)', { totalDeleted });

    // Delete agents AFTER transaction (in case of any constraint issues)
    try {
      const agentsResult = db.prepare('DELETE FROM agents').run();
      if (agentsResult.changes > 0) {
        log.info('Deleted agents (post-transaction)', { records: agentsResult.changes });
        totalDeleted += agentsResult.changes;
      }
    } catch (e) {
      log.error('Failed to delete agents:', e.message);
    }

    log.info('All deletions complete', { totalDeleted });

    // Verify all tables are empty
    let remainingRecords = 0;
    for (const { name } of tables) {
      try {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${name}`).get().count;
        if (count > 0) {
          log.warn(`Table ${name} still has records!`, { count });
          remainingRecords += count;
        }
      } catch (e) {
        // Ignore
      }
    }

    if (remainingRecords > 0) {
      log.error('Some records remain after deletion', { count: remainingRecords });
    } else {
      log.info('All tables verified empty ✓');
    }

    // Vacuum to reclaim disk space
    log.info('Vacuuming database...');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('vacuum');

    // Get database size after
    const sizeAfter = db.pragma('page_count')[0].page_count * db.pragma('page_size')[0].page_size;

    const result = {
      records_before: totalRecordsBefore,
      records_deleted: totalDeleted,
      records_remaining: remainingRecords,
      size_before_mb: (sizeBefore / 1024 / 1024).toFixed(2),
      size_after_mb: (sizeAfter / 1024 / 1024).toFixed(2),
      freed_mb: ((sizeBefore - sizeAfter) / 1024 / 1024).toFixed(2),
      tables_processed: tables.length,
      status: remainingRecords === 0 ? 'success' : 'partial'
    };

    log.info('DATABASE RESET COMPLETE', result);
    return result;
  } catch (err) {
    log.error('Database reset failed:', err);
    throw err;
  }
}

// Run if called directly
if (require.main === module) {
  try {
    console.log('⚠️  WARNING: This will DELETE ALL DATA from the database!');
    console.log('⚠️  This action is IRREVERSIBLE!');
    console.log('');

    const result = resetDatabase();
    console.log('');
    console.log('✅ Database reset complete:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('❌ Database reset failed:', err.message);
    process.exit(1);
  }
}

module.exports = { resetDatabase };
