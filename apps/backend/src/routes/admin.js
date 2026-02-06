const express = require('express');
const { getDb } = require('../db/schema');
const { getUsageStats, getLibraryInfo, TYPES, BASES, VARIANTS } = require('../services/image-assigner');
const { requireAdmin } = require('../middleware/admin-auth');

const router = express.Router();

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

module.exports = router;
