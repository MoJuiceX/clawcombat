#!/usr/bin/env node
/**
 * Quick Delete Battles
 * Deletes battles in small batches WITHOUT vacuum
 * Use when disk is so full that vacuum can't run
 */

const { getDb } = require('../db/schema');
const log = require('../utils/logger').createLogger('QUICK_DELETE');

function quickDelete() {
  const db = getDb();

  try {
    // Get initial count
    const before = db.prepare('SELECT COUNT(*) as count FROM battles').get().count;
    log.info('Battles before deletion', { count: before });

    let totalDeleted = 0;

    // Delete in batches of 100 to avoid memory issues
    for (let i = 0; i < 50; i++) {  // Max 5000 battles
      const batch = db.prepare('SELECT id FROM battles LIMIT 100').all();

      if (batch.length === 0) break;

      const ids = batch.map(b => b.id);
      const placeholders = ids.map(() => '?').join(',');

      // Delete this batch
      const deleted = db.prepare(`DELETE FROM battles WHERE id IN (${placeholders})`).run(...ids);
      totalDeleted += deleted.changes;

      log.info(`Batch ${i + 1}: deleted ${deleted.changes} battles`);

      if (deleted.changes === 0) break;
    }

    const after = db.prepare('SELECT COUNT(*) as count FROM battles').get().count;

    log.info('Quick delete complete', {
      deleted: totalDeleted,
      remaining: after
    });

    return {
      battles_deleted: totalDeleted,
      battles_remaining: after,
      note: 'Run VACUUM separately to reclaim disk space'
    };
  } catch (err) {
    log.error('Quick delete failed:', err);
    throw err;
  }
}

// Run if called directly
if (require.main === module) {
  try {
    const result = quickDelete();
    console.log('Quick delete complete:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Quick delete failed:', err.message);
    process.exit(1);
  }
}

module.exports = { quickDelete };
