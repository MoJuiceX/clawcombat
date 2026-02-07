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

module.exports = router;
