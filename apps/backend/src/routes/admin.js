const express = require('express');
const { getDb } = require('../db/schema');
const { getUsageStats, getLibraryInfo, TYPES, BASES, VARIANTS } = require('../services/image-assigner');
const { requireAdmin } = require('../middleware/admin-auth');
const { getDeprecatedMetrics, DEPRECATED_PATHS } = require('../middleware/request-logger');
const { getHealthOverview, getAgentHealth, cleanupOldLogs, CURRENT_SKILL_MD_VERSION } = require('../services/bot-health');

const router = express.Router();

// =============================================================================
// DEPRECATED ENDPOINT METRICS
// =============================================================================

/**
 * GET /admin/deprecated-metrics
 * Returns in-memory metrics for deprecated endpoint usage
 * Tracks: endpoint, count, unique_bots, last_hit, top_bots
 */
router.get('/deprecated-metrics', requireAdmin, (req, res) => {
  const metrics = getDeprecatedMetrics();

  // Calculate summary statistics
  let totalHits = 0;
  const allBots = new Set();

  for (const endpoint of Object.values(metrics)) {
    totalHits += endpoint.count;
    for (const bot of endpoint.top_bots) {
      allBots.add(bot.bot_id);
    }
  }

  res.json({
    summary: {
      total_hits: totalHits,
      total_unique_bots: allBots.size,
      endpoints_hit: Object.keys(metrics).length,
      monitored_paths: DEPRECATED_PATHS,
    },
    endpoints: metrics,
    note: 'Metrics are reset hourly after summary log. Shows data since last reset.',
  });
});

// GET /admin/image-stats — Full image usage statistics
router.get('/image-stats', requireAdmin, (req, res) => {
  const stats = getUsageStats();
  const library = getLibraryInfo();

  // Find never-used combinations
  const db = getDb();
  const usedKeys = new Set(
    db.prepare('SELECT type_base_variant FROM image_usage').all().map(r => r.type_base_variant)
  );

  const neverUsed = [];
  for (const type of TYPES) {
    for (const base of BASES) {
      for (const variant of VARIANTS) {
        const key = `${type}|${base}|${variant}`;
        if (!usedKeys.has(key)) {
          neverUsed.push({ type, base, variant, key });
        }
      }
    }
  }

  // Calculate variant distribution percentage
  const totalByVariant = Object.values(stats.byVariant).reduce((a, b) => a + b, 0) || 1;
  const variantPercentages = {};
  for (const [variant, count] of Object.entries(stats.byVariant)) {
    variantPercentages[variant] = {
      count,
      percentage: ((count / totalByVariant) * 100).toFixed(1) + '%'
    };
  }

  // Add missing variants with 0%
  for (const variant of VARIANTS) {
    if (!variantPercentages[variant]) {
      variantPercentages[variant] = { count: 0, percentage: '0.0%' };
    }
  }

  res.json({
    summary: {
      totalAssignments: stats.totalAssignments,
      uniqueCombosUsed: Object.keys(stats.detailed).length,
      totalPossibleCombos: 756,
      neverUsedCount: neverUsed.length,
      coveragePercent: (((756 - neverUsed.length) / 756) * 100).toFixed(1) + '%'
    },
    variantDistribution: variantPercentages,
    byType: stats.byType,
    byBase: stats.byBase,
    neverUsed: neverUsed.slice(0, 50), // Limit to first 50
    neverUsedTotal: neverUsed.length,
    library: {
      totalImages: library.totalImages,
      coveredCombinations: library.coveredCombinations,
      combosWithMultipleImages: library.multipleOptions.length
    }
  });
});

// GET /admin/image-stats/variants — Just variant distribution (quick check)
router.get('/image-stats/variants', requireAdmin, (req, res) => {
  const stats = getUsageStats();
  const total = stats.totalAssignments || 1;

  const distribution = {};
  for (const variant of VARIANTS) {
    const count = stats.byVariant[variant] || 0;
    distribution[variant] = {
      count,
      percentage: ((count / total) * 100).toFixed(1) + '%',
      bar: '█'.repeat(Math.round((count / total) * 50))
    };
  }

  res.json({
    totalAssignments: stats.totalAssignments,
    threshold: 3,
    distribution
  });
});

// GET /admin/image-stats/detailed — Full breakdown by type-base-variant
router.get('/image-stats/detailed', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT type_base_variant, usage_count, image_index, updated_at
    FROM image_usage
    ORDER BY usage_count DESC
  `).all();

  res.json({
    totalRows: rows.length,
    data: rows
  });
});

// =============================================================================
// BOT HEALTH MONITORING
// =============================================================================

/**
 * GET /admin/bot-health/overview
 * System-wide bot health overview for monitoring dashboards
 * Shows: active bots, outdated skill.md users, common errors, trends
 */
router.get('/bot-health/overview', requireAdmin, (req, res) => {
  const overview = getHealthOverview();
  res.json({ data: overview });
});

/**
 * GET /admin/bot-health/agent/:agent_id
 * Get detailed health stats for a specific agent (admin access)
 */
router.get('/bot-health/agent/:agent_id', requireAdmin, (req, res) => {
  const { getRecentActivity } = require('../services/bot-health');
  const agentId = req.params.agent_id;

  const health = getAgentHealth(agentId);
  if (!health) {
    return res.status(404).json({ error: 'Agent not found or no activity recorded' });
  }

  // Include recent activity for debugging
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  health.recent_activity = getRecentActivity(agentId, limit);

  res.json({ data: health });
});

/**
 * POST /admin/bot-health/cleanup
 * Manually trigger cleanup of old health logs (normally runs via cron)
 */
router.post('/bot-health/cleanup', requireAdmin, (req, res) => {
  const deletedRows = cleanupOldLogs();
  res.json({
    status: 'ok',
    deleted_rows: deletedRows,
    message: `Cleaned up ${deletedRows} old health log entries`
  });
});

/**
 * GET /admin/bot-health/current-version
 * Get the current skill.md version the system expects
 */
router.get('/bot-health/current-version', requireAdmin, (req, res) => {
  res.json({
    current_version: CURRENT_SKILL_MD_VERSION,
    skill_md_url: 'https://clawcombat.com/skill.md'
  });
});

// =============================================================================
// DATABASE CLEANUP
// =============================================================================

/**
 * POST /admin/cleanup-database
 * Removes old battles and vacuums database to reclaim disk space
 */
router.post('/cleanup-database', requireAdmin, (req, res) => {
  try {
    const { cleanupDatabase } = require('../scripts/cleanup-database');
    const result = cleanupDatabase();
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({
      error: 'Cleanup failed',
      message: err.message
    });
  }
});

/**
 * POST /admin/emergency-cleanup
 * NUCLEAR OPTION: Deletes ALL battles to free up disk space immediately
 * Use only when disk is completely full and normal cleanup fails
 */
router.post('/emergency-cleanup', requireAdmin, (req, res) => {
  try {
    const { emergencyCleanup } = require('../scripts/emergency-cleanup');
    const result = emergencyCleanup();
    res.json({
      success: true,
      warning: 'ALL BATTLES DELETED',
      ...result
    });
  } catch (err) {
    res.status(500).json({
      error: 'Emergency cleanup failed',
      message: err.message
    });
  }
});

/**
 * POST /admin/nuclear-cleanup
 * Deletes social posts first, then ALL battles (respects foreign keys)
 * Does NOT vacuum - run /admin/vacuum-database separately
 */
router.post('/nuclear-cleanup', requireAdmin, (req, res) => {
  try {
    const { nuclearCleanup } = require('../scripts/nuclear-cleanup');
    const result = nuclearCleanup();
    res.json({
      success: true,
      warning: 'ALL BATTLES AND BATTLE POSTS DELETED',
      ...result
    });
  } catch (err) {
    res.status(500).json({
      error: 'Nuclear cleanup failed',
      message: err.message
    });
  }
});

/**
 * POST /admin/vacuum-database
 * Runs VACUUM to reclaim disk space after deleting records
 * WARNING: Can take time and lock database
 */
router.post('/vacuum-database', requireAdmin, (req, res) => {
  try {
    const { getDb } = require('../db/schema');
    const db = getDb();

    const sizeBefore = db.pragma('page_count')[0].page_count * db.pragma('page_size')[0].page_size;
    db.pragma('vacuum');
    const sizeAfter = db.pragma('page_count')[0].page_count * db.pragma('page_size')[0].page_size;

    res.json({
      success: true,
      size_before_mb: (sizeBefore / 1024 / 1024).toFixed(2),
      size_after_mb: (sizeAfter / 1024 / 1024).toFixed(2),
      freed_mb: ((sizeBefore - sizeAfter) / 1024 / 1024).toFixed(2)
    });
  } catch (err) {
    res.status(500).json({
      error: 'Vacuum failed',
      message: err.message
    });
  }
});

/**
 * POST /admin/reset-database
 * DANGER: Deletes ALL data from ALL tables, starts fresh like day zero
 * WARNING: This is irreversible! All battles, agents, and history will be lost.
 */
router.post('/reset-database', requireAdmin, (req, res) => {
  try {
    const { resetDatabase } = require('../scripts/reset-database');
    const result = resetDatabase();
    res.json({
      success: true,
      warning: 'ALL DATA DELETED - DATABASE RESET TO DAY ZERO',
      ...result
    });
  } catch (err) {
    res.status(500).json({
      error: 'Database reset failed',
      message: err.message
    });
  }
});

/**
 * POST /admin/seed-bots
 * Creates 18 fun-named bots (one per type), all level 1
 */
router.post('/seed-bots', requireAdmin, (req, res) => {
  try {
    const { seedBots } = require('../scripts/seed-bots-v2');
    const result = seedBots();
    res.json({
      success: true,
      message: `Created ${result.created} bots`,
      ...result
    });
  } catch (err) {
    res.status(500).json({
      error: 'Seed bots failed',
      message: err.message
    });
  }
});

/**
 * GET /admin/debug/tutorial-bots
 * Debug endpoint to check if tutorial opponents can be found
 */
router.get('/debug/tutorial-bots', requireAdmin, (req, res) => {
  try {
    const { getDb } = require('../db/schema');
    const db = getDb();

    // Check if seed bots exist at all
    const anyBots = db.prepare(`
      SELECT name, level, status, ai_type FROM agents
      WHERE name IN ('Larry', 'Ember', 'Bubbles', 'Sparky', 'Leaf', 'Frosty', 'Bruce', 'Toxic', 'Rocky', 'Breeze', 'Mystic', 'Buzz', 'Pebbles', 'Casper', 'Smaug', 'Shadow', 'Rusty', 'Luna')
    `).all();

    // Test the exact query used by tutorial battle
    const level1Bots = db.prepare(`
      SELECT name, level, status, ai_type FROM agents
      WHERE name IN ('Larry', 'Ember', 'Bubbles', 'Sparky', 'Leaf', 'Frosty', 'Bruce', 'Toxic', 'Rocky', 'Breeze', 'Mystic', 'Buzz', 'Pebbles', 'Casper', 'Smaug', 'Shadow', 'Rusty', 'Luna')
      AND status = 'active'
      AND level = 1
    `).all();

    res.json({
      total_seed_bots: anyBots.length,
      all_seed_bots: anyBots,
      level1_active: level1Bots.length,
      level1_bots: level1Bots
    });
  } catch (err) {
    res.status(500).json({
      error: 'Debug failed',
      message: err.message,
      stack: err.stack
    });
  }
});

/**
 * POST /admin/debug/test-tutorial
 * Debug endpoint to test tutorial battle with a real agent
 */
router.post('/debug/test-tutorial', requireAdmin, (req, res) => {
  try {
    const { getDb } = require('../db/schema');
    const { runTutorialBattle } = require('../services/tutorial-battle');
    const crypto = require('crypto');
    const db = getDb();

    // Create a test agent
    const testId = crypto.randomUUID();
    const testName = 'TestBot-' + crypto.randomBytes(2).toString('hex');

    db.prepare(`
      INSERT INTO agents (
        id, name, ai_type, level, xp,
        nature_name, nature_boost, nature_reduce, nature_desc,
        ability_name, ability_desc, ability_effect,
        base_hp, base_attack, base_defense, base_sp_atk, base_sp_def, base_speed,
        elo, api_key, play_mode, status,
        total_fights, total_wins, webhook_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      testId, testName, 'FIRE', 1, 0,
      'Adamant', 'attack', 'sp_atk', '+Attack, -Sp.Atk',
      'Blaze', 'Power boost at low HP', 'low_hp_boost',
      15, 20, 10, 10, 10, 15,
      1000, 'test_key_hash', 'auto', 'active',
      0, 0, 'https://example.com/webhook'
    );

    // Add 4 moves
    db.prepare('INSERT INTO agent_moves (agent_id, slot, move_id) VALUES (?, ?, ?)').run(testId, 0, 'poke_fire_flamethrower');
    db.prepare('INSERT INTO agent_moves (agent_id, slot, move_id) VALUES (?, ?, ?)').run(testId, 1, 'poke_fire_ember');
    db.prepare('INSERT INTO agent_moves (agent_id, slot, move_id) VALUES (?, ?, ?)').run(testId, 2, 'poke_fire_firepunch');
    db.prepare('INSERT INTO agent_moves (agent_id, slot, move_id) VALUES (?, ?, ?)').run(testId, 3, 'poke_normal_tackle');

    // Try to run tutorial battle
    let tutorialResult = null;
    let tutorialError = null;

    try {
      tutorialResult = runTutorialBattle(testId);
    } catch (err) {
      tutorialError = {
        message: err.message,
        stack: err.stack
      };
    }

    // Clean up test agent
    db.prepare('DELETE FROM agent_moves WHERE agent_id = ?').run(testId);
    db.prepare('DELETE FROM agents WHERE id = ?').run(testId);

    res.json({
      test_agent_created: testName,
      tutorial_success: tutorialResult !== null,
      tutorial_result: tutorialResult,
      tutorial_error: tutorialError
    });
  } catch (err) {
    res.status(500).json({
      error: 'Test failed',
      message: err.message,
      stack: err.stack
    });
  }
});

module.exports = router;
