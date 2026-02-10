#!/usr/bin/env node
/**
 * NUCLEAR CLEANUP
 * Deletes social posts first, then ALL battles
 * Respects foreign keys by deleting in correct order
 */

const { getDb } = require('../db/schema');
const log = require('../utils/logger').createLogger('NUCLEAR');

function nuclearCleanup() {
  const db = getDb();

  try {
    log.warn('NUCLEAR CLEANUP STARTING');

    // Get initial stats
    const battlesBefore = db.prepare('SELECT COUNT(*) as count FROM battles').get().count;
    const postsBefore = db.prepare('SELECT COUNT(*) as count FROM social_posts').get().count;
    const tokensBefore = db.prepare('SELECT COUNT(*) as count FROM social_tokens').get().count;

    log.info('Before cleanup', {
      battles: battlesBefore,
      social_posts: postsBefore,
      social_tokens: tokensBefore
    });

    // STEP 1: Delete social tokens (reference battles)
    log.info('Deleting social tokens...');
    const tokensDeleted = db.prepare('DELETE FROM social_tokens').run();
    log.info(`Deleted ${tokensDeleted.changes} social tokens`);

    // STEP 2: Delete moltbook reported posts (reference battles)
    log.info('Deleting moltbook reported posts...');
    try {
      const moltbookDeleted = db.prepare('DELETE FROM moltbook_reported_posts WHERE battle_id IS NOT NULL').run();
      log.info(`Deleted ${moltbookDeleted.changes} moltbook posts`);
    } catch (e) {
      log.warn('Could not delete moltbook posts:', e.message);
    }

    // STEP 3: Delete all social posts (reference battles)
    log.info('Deleting social posts...');
    const postsDeleted = db.prepare('DELETE FROM social_posts').run();
    log.info(`Deleted ${postsDeleted.changes} social posts`);

    // STEP 4: Now delete all battles (no foreign key issues)
    log.info('Deleting all battles...');
    const battlesDeleted = db.prepare('DELETE FROM battles').run();
    log.info(`Deleted ${battlesDeleted.changes} battles`);

    // Get final stats
    const battlesAfter = db.prepare('SELECT COUNT(*) as count FROM battles').get().count;
    const postsAfter = db.prepare('SELECT COUNT(*) as count FROM social_posts').get().count;
    const tokensAfter = db.prepare('SELECT COUNT(*) as count FROM social_tokens').get().count;

    const result = {
      battles_deleted: battlesDeleted.changes,
      battles_remaining: battlesAfter,
      social_posts_deleted: postsDeleted.changes,
      social_posts_remaining: postsAfter,
      social_tokens_deleted: tokensDeleted.changes,
      social_tokens_remaining: tokensAfter,
      note: 'Database not vacuumed - run /admin/vacuum-database separately'
    };

    log.info('NUCLEAR CLEANUP COMPLETE', result);
    return result;
  } catch (err) {
    log.error('Nuclear cleanup failed:', err);
    throw err;
  }
}

// Run if called directly
if (require.main === module) {
  try {
    const result = nuclearCleanup();
    console.log('Nuclear cleanup complete:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Nuclear cleanup failed:', err.message);
    process.exit(1);
  }
}

module.exports = { nuclearCleanup };
