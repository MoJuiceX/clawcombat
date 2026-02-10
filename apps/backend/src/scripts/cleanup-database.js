#!/usr/bin/env node
/**
 * Database Cleanup Script
 * Removes old battles and vacuums database to reclaim disk space
 */

const { getDb } = require('../db/schema');
const log = require('../utils/logger').createLogger('CLEANUP');

function cleanupDatabase() {
  const db = getDb();

  try {
    // Get current stats
    const before = db.prepare('SELECT COUNT(*) as count FROM battles').get();
    const sizeBefore = db.pragma('page_count')[0].page_count * db.pragma('page_size')[0].page_size;

    log.info('Database before cleanup', {
      battles: before.count,
      size_mb: (sizeBefore / 1024 / 1024).toFixed(2)
    });

    // Delete battles older than 1 day (keep only very recent ones for disk space)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const deleted = db.prepare(`
      DELETE FROM battles
      WHERE created_at < ?
      AND status = 'finished'
    `).run(oneDayAgo);

    log.info('Deleted old battles', { count: deleted.changes });

    // Delete old battle logs (keep last 1000 battles worth) - if table exists
    try {
      db.prepare(`
        DELETE FROM battle_logs
        WHERE battle_id NOT IN (
          SELECT id FROM battles
          ORDER BY created_at DESC
          LIMIT 1000
        )
      `).run();
    } catch (e) {
      // Table might not exist - skip
    }

    // Delete orphaned data
    try {
      db.prepare(`DELETE FROM agent_moves WHERE agent_id NOT IN (SELECT id FROM agents)`).run();
    } catch (e) {}
    try {
      db.prepare(`DELETE FROM social_posts WHERE agent_id NOT IN (SELECT id FROM agents)`).run();
    } catch (e) {}
    try {
      db.prepare(`DELETE FROM social_likes WHERE post_id NOT IN (SELECT id FROM social_posts)`).run();
    } catch (e) {}

    // Vacuum to reclaim space
    log.info('Vacuuming database...');
    db.pragma('vacuum');

    // Get final stats
    const after = db.prepare('SELECT COUNT(*) as count FROM battles').get();
    const sizeAfter = db.pragma('page_count')[0].page_count * db.pragma('page_size')[0].page_size;

    log.info('Database after cleanup', {
      battles: after.count,
      size_mb: (sizeAfter / 1024 / 1024).toFixed(2),
      freed_mb: ((sizeBefore - sizeAfter) / 1024 / 1024).toFixed(2)
    });

    return {
      battles_deleted: deleted.changes,
      size_before_mb: (sizeBefore / 1024 / 1024).toFixed(2),
      size_after_mb: (sizeAfter / 1024 / 1024).toFixed(2),
      freed_mb: ((sizeBefore - sizeAfter) / 1024 / 1024).toFixed(2)
    };
  } catch (err) {
    log.error('Cleanup failed:', err);
    throw err;
  }
}

// Run if called directly
if (require.main === module) {
  try {
    const result = cleanupDatabase();
    console.log('Cleanup complete:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  }
}

module.exports = { cleanupDatabase };
