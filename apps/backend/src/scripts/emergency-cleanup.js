#!/usr/bin/env node
/**
 * EMERGENCY Database Cleanup
 * Deletes ALL battles to free up space immediately
 * Use only when disk is completely full
 */

const { getDb } = require('../db/schema');
const log = require('../utils/logger').createLogger('EMERGENCY_CLEANUP');

function emergencyCleanup() {
  const db = getDb();

  try {
    log.warn('EMERGENCY CLEANUP STARTING - Will delete ALL battles!');

    // Get size before
    const sizeBefore = db.pragma('page_count')[0].page_count * db.pragma('page_size')[0].page_size;
    const battlesBefore = db.prepare('SELECT COUNT(*) as count FROM battles').get().count;

    log.info('Before cleanup', {
      battles: battlesBefore,
      size_mb: (sizeBefore / 1024 / 1024).toFixed(2)
    });

    // Disable foreign keys temporarily
    db.pragma('foreign_keys = OFF');

    try {
      // Delete ALL battles (nuclear option)
      log.warn('Deleting ALL battles...');
      db.prepare('DELETE FROM battles').run();

      // Delete orphaned social posts
      log.info('Cleaning up social posts...');
      db.prepare('DELETE FROM social_posts WHERE battle_id IS NOT NULL').run();
    } finally {
      // Re-enable foreign keys
      db.pragma('foreign_keys = ON');
    }

    // Vacuum to reclaim space
    log.info('Vacuuming database...');
    db.pragma('vacuum');

    // Get size after
    const sizeAfter = db.pragma('page_count')[0].page_count * db.pragma('page_size')[0].page_size;
    const battlesAfter = db.prepare('SELECT COUNT(*) as count FROM battles').get().count;

    const result = {
      battles_deleted: battlesBefore - battlesAfter,
      battles_remaining: battlesAfter,
      size_before_mb: (sizeBefore / 1024 / 1024).toFixed(2),
      size_after_mb: (sizeAfter / 1024 / 1024).toFixed(2),
      freed_mb: ((sizeBefore - sizeAfter) / 1024 / 1024).toFixed(2)
    };

    log.info('EMERGENCY CLEANUP COMPLETE', result);
    return result;
  } catch (err) {
    log.error('Emergency cleanup failed:', err);
    throw err;
  }
}

// Run if called directly
if (require.main === module) {
  try {
    const result = emergencyCleanup();
    console.log('Emergency cleanup complete:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Emergency cleanup failed:', err.message);
    process.exit(1);
  }
}

module.exports = { emergencyCleanup };
