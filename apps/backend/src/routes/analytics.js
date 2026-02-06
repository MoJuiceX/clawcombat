/**
 * Analytics API Routes
 *
 * Comprehensive analytics endpoints for the admin dashboard.
 * Requires admin authentication.
 */

const log = require('../utils/logger').createLogger('ANALYTICS');
const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { requireAdmin } = require('../middleware/admin-auth');
const { createSingleValueCache } = require('../utils/cache');

// ============================================================================
// CACHING: Analytics queries are expensive but admin-only (infrequent)
// ============================================================================

// Overview cache (5 minutes TTL) - 11 COUNT queries
const overviewCache = createSingleValueCache({
  name: 'analytics-overview',
  ttlMs: 5 * 60 * 1000 // 5 minutes
});

// Growth cache (10 minutes TTL) - expensive GROUP BY queries
const growthCache = createSingleValueCache({
  name: 'analytics-growth',
  ttlMs: 10 * 60 * 1000 // 10 minutes
});

// Engagement cache (5 minutes TTL)
const engagementCache = createSingleValueCache({
  name: 'analytics-engagement',
  ttlMs: 5 * 60 * 1000
});

// Types cache (5 minutes TTL)
const typesCache = createSingleValueCache({
  name: 'analytics-types',
  ttlMs: 5 * 60 * 1000
});

/**
 * GET /api/analytics/overview
 * High-level platform metrics (cached 5 minutes)
 */
router.get('/overview', requireAdmin, (req, res) => {
  try {
    // Check cache first
    const cached = overviewCache.get();
    if (cached) {
      return res.json(cached);
    }

    const db = getDb();

    // Total counts
    const totalAgents = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'active'").get().cnt;
    const claimedAgents = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'active' AND owner_id IS NOT NULL").get().cnt;
    const unclaimedAgents = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'active' AND owner_id IS NULL").get().cnt;
    const totalBattles = db.prepare("SELECT COUNT(*) as cnt FROM battles").get().cnt;
    const completedBattles = db.prepare("SELECT COUNT(*) as cnt FROM battles WHERE status = 'finished'").get().cnt;
    const activeBattles = db.prepare("SELECT COUNT(*) as cnt FROM battles WHERE status = 'active'").get().cnt;
    const queueSize = db.prepare("SELECT COUNT(*) as cnt FROM battle_queue").get().cnt;

    // Active in last 7 days (had a battle)
    const activeAgents7d = db.prepare(`
      SELECT COUNT(DISTINCT agent_id) as cnt FROM (
        SELECT agent_a_id as agent_id FROM battles WHERE created_at >= datetime('now', '-7 days')
        UNION ALL
        SELECT agent_b_id as agent_id FROM battles WHERE created_at >= datetime('now', '-7 days')
      )
    `).get().cnt;

    // Active in last 24h
    const activeAgents24h = db.prepare(`
      SELECT COUNT(DISTINCT agent_id) as cnt FROM (
        SELECT agent_a_id as agent_id FROM battles WHERE created_at >= datetime('now', '-1 day')
        UNION ALL
        SELECT agent_b_id as agent_id FROM battles WHERE created_at >= datetime('now', '-1 day')
      )
    `).get().cnt;

    // Premium users
    let premiumUsers = 0;
    try {
      premiumUsers = db.prepare("SELECT COUNT(*) as cnt FROM premium_subscriptions WHERE status = 'active'").get().cnt;
    } catch (e) { /* table might not exist */ }

    // Battles today
    const battlesToday = db.prepare("SELECT COUNT(*) as cnt FROM battles WHERE DATE(created_at) = DATE('now')").get().cnt;

    // Signups today
    const signupsToday = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE DATE(created_at) = DATE('now')").get().cnt;

    // Average battles per agent
    const avgBattles = totalAgents > 0 ? Math.round(totalBattles / totalAgents) : 0;

    const result = {
      agents: {
        total: totalAgents,
        claimed: claimedAgents,
        unclaimed: unclaimedAgents,
        active_7d: activeAgents7d,
        active_24h: activeAgents24h,
        premium: premiumUsers
      },
      battles: {
        total: totalBattles,
        completed: completedBattles,
        active: activeBattles,
        queue_size: queueSize,
        today: battlesToday,
        avg_per_agent: avgBattles
      },
      signups: {
        today: signupsToday
      }
    };

    // Cache the result
    overviewCache.set(result);

    res.json(result);
  } catch (err) {
    log.error('Overview error:', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

/**
 * GET /api/analytics/growth
 * Daily growth metrics for charts
 */
router.get('/growth', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days, 10) || 30;

    // Daily signups
    const dailySignups = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM agents
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).all(days);

    // Daily battles
    const dailyBattles = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM battles
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).all(days);

    // Daily active users (unique agents in battles)
    const dailyActive = db.prepare(`
      SELECT date, COUNT(DISTINCT agent_id) as count FROM (
        SELECT DATE(created_at) as date, agent_a_id as agent_id FROM battles WHERE created_at >= datetime('now', '-' || ? || ' days')
        UNION ALL
        SELECT DATE(created_at) as date, agent_b_id as agent_id FROM battles WHERE created_at >= datetime('now', '-' || ? || ' days')
      )
      GROUP BY date
      ORDER BY date DESC
    `).all(days, days);

    // Cumulative totals
    const cumulativeAgents = db.prepare(`
      SELECT DATE(created_at) as date,
             (SELECT COUNT(*) FROM agents WHERE created_at <= a.created_at AND status = 'active') as cumulative
      FROM agents a
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).all(days);

    res.json({
      daily_signups: dailySignups,
      daily_battles: dailyBattles,
      daily_active: dailyActive,
      cumulative_agents: cumulativeAgents
    });
  } catch (err) {
    log.error('Growth error:', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch growth data' });
  }
});

/**
 * GET /api/analytics/engagement
 * User engagement metrics
 */
router.get('/engagement', requireAdmin, (req, res) => {
  try {
    const db = getDb();

    // Win rate distribution (buckets: 0-20%, 20-40%, 40-60%, 60-80%, 80-100%)
    const winRateDistribution = db.prepare(`
      SELECT
        CASE
          WHEN total_fights = 0 THEN 'No battles'
          WHEN CAST(total_wins AS REAL) / total_fights < 0.2 THEN '0-20%'
          WHEN CAST(total_wins AS REAL) / total_fights < 0.4 THEN '20-40%'
          WHEN CAST(total_wins AS REAL) / total_fights < 0.6 THEN '40-60%'
          WHEN CAST(total_wins AS REAL) / total_fights < 0.8 THEN '60-80%'
          ELSE '80-100%'
        END as bucket,
        COUNT(*) as count
      FROM agents
      WHERE status = 'active'
      GROUP BY bucket
    `).all();

    // Level distribution
    const levelDistribution = db.prepare(`
      SELECT
        CASE
          WHEN COALESCE(level, 1) <= 5 THEN '1-5'
          WHEN level <= 10 THEN '6-10'
          WHEN level <= 20 THEN '11-20'
          WHEN level <= 50 THEN '21-50'
          ELSE '50+'
        END as bucket,
        COUNT(*) as count
      FROM agents
      WHERE status = 'active'
      GROUP BY bucket
    `).all();

    // Battle count distribution
    const battleDistribution = db.prepare(`
      SELECT
        CASE
          WHEN COALESCE(total_fights, 0) = 0 THEN '0'
          WHEN total_fights <= 5 THEN '1-5'
          WHEN total_fights <= 20 THEN '6-20'
          WHEN total_fights <= 50 THEN '21-50'
          WHEN total_fights <= 100 THEN '51-100'
          ELSE '100+'
        END as bucket,
        COUNT(*) as count
      FROM agents
      WHERE status = 'active'
      GROUP BY bucket
    `).all();

    // Hourly battle activity (for last 7 days)
    const hourlyActivity = db.prepare(`
      SELECT
        strftime('%H', created_at) as hour,
        COUNT(*) as count
      FROM battles
      WHERE created_at >= datetime('now', '-7 days')
      GROUP BY hour
      ORDER BY hour
    `).all();

    // Retention: agents who battled in week 1 and week 2
    const retentionData = db.prepare(`
      SELECT
        COUNT(DISTINCT CASE WHEN week1 > 0 THEN agent_id END) as week1_users,
        COUNT(DISTINCT CASE WHEN week1 > 0 AND week2 > 0 THEN agent_id END) as retained_users
      FROM (
        SELECT
          agent_id,
          SUM(CASE WHEN battle_date BETWEEN datetime('now', '-14 days') AND datetime('now', '-7 days') THEN 1 ELSE 0 END) as week1,
          SUM(CASE WHEN battle_date >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as week2
        FROM (
          SELECT agent_a_id as agent_id, created_at as battle_date FROM battles
          UNION ALL
          SELECT agent_b_id as agent_id, created_at as battle_date FROM battles
        )
        GROUP BY agent_id
      )
    `).get();

    const retention7d = retentionData.week1_users > 0
      ? Math.round((retentionData.retained_users / retentionData.week1_users) * 100)
      : 0;

    res.json({
      win_rate_distribution: winRateDistribution,
      level_distribution: levelDistribution,
      battle_distribution: battleDistribution,
      hourly_activity: hourlyActivity,
      retention: {
        week1_users: retentionData.week1_users,
        retained_users: retentionData.retained_users,
        retention_rate: retention7d
      }
    });
  } catch (err) {
    log.error('Engagement error:', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch engagement data' });
  }
});

/**
 * GET /api/analytics/leaderboard
 * Top players and trending agents
 */
router.get('/leaderboard', requireAdmin, (req, res) => {
  try {
    const db = getDb();

    // Top 20 by level
    const topByLevel = db.prepare(`
      SELECT id, name, level, total_wins, total_fights, elo, ai_type
      FROM agents
      WHERE status = 'active'
      ORDER BY COALESCE(level, 1) DESC, COALESCE(elo, 1000) DESC
      LIMIT 20
    `).all();

    // Top 20 by win rate (min 10 battles)
    const topByWinRate = db.prepare(`
      SELECT id, name, level, total_wins, total_fights, elo, ai_type,
             ROUND(CAST(total_wins AS REAL) / total_fights * 100, 1) as win_rate
      FROM agents
      WHERE status = 'active' AND total_fights >= 10
      ORDER BY win_rate DESC, total_fights DESC
      LIMIT 20
    `).all();

    // Most active (most battles in last 7 days)
    const mostActive = db.prepare(`
      SELECT agent_id, a.name, COUNT(*) as battles_7d, a.level
      FROM (
        SELECT agent_a_id as agent_id FROM battles WHERE created_at >= datetime('now', '-7 days')
        UNION ALL
        SELECT agent_b_id as agent_id FROM battles WHERE created_at >= datetime('now', '-7 days')
      ) b
      JOIN agents a ON b.agent_id = a.id
      WHERE a.status = 'active'
      GROUP BY agent_id
      ORDER BY battles_7d DESC
      LIMIT 20
    `).all();

    // Newest agents (last 7 days)
    const newest = db.prepare(`
      SELECT id, name, level, total_wins, total_fights, ai_type, created_at
      FROM agents
      WHERE status = 'active' AND created_at >= datetime('now', '-7 days')
      ORDER BY created_at DESC
      LIMIT 20
    `).all();

    res.json({
      top_by_level: topByLevel,
      top_by_win_rate: topByWinRate,
      most_active: mostActive,
      newest: newest
    });
  } catch (err) {
    log.error('Leaderboard error:', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch leaderboard data' });
  }
});

/**
 * GET /api/analytics/types
 * Type distribution and effectiveness
 */
router.get('/types', requireAdmin, (req, res) => {
  try {
    const db = getDb();

    // Type distribution
    const typeDistribution = db.prepare(`
      SELECT COALESCE(ai_type, 'NEUTRAL') as type, COUNT(*) as count
      FROM agents
      WHERE status = 'active'
      GROUP BY ai_type
      ORDER BY count DESC
    `).all();

    // Type win rates
    const typeWinRates = db.prepare(`
      SELECT
        COALESCE(ai_type, 'NEUTRAL') as type,
        SUM(total_wins) as total_wins,
        SUM(total_fights) as total_fights,
        CASE WHEN SUM(total_fights) > 0
          THEN ROUND(CAST(SUM(total_wins) AS REAL) / SUM(total_fights) * 100, 1)
          ELSE 0
        END as win_rate
      FROM agents
      WHERE status = 'active'
      GROUP BY ai_type
      HAVING total_fights > 0
      ORDER BY win_rate DESC
    `).all();

    res.json({
      type_distribution: typeDistribution,
      type_win_rates: typeWinRates
    });
  } catch (err) {
    log.error('Types error:', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch type data' });
  }
});

/**
 * GET /api/analytics/moltbook
 * Moltbook viral analytics
 */
router.get('/moltbook', requireAdmin, (req, res) => {
  try {
    const db = getDb();

    // Template performance
    let templateStats = [];
    try {
      templateStats = db.prepare(`
        SELECT template_id, template_type, times_used, avg_engagement_score, last_used_at
        FROM template_performance
        ORDER BY times_used DESC
        LIMIT 20
      `).all();
    } catch (e) { /* table might not exist */ }

    // Recent reported posts
    let recentPosts = [];
    try {
      recentPosts = db.prepare(`
        SELECT mrp.*, a.name as agent_name
        FROM moltbook_reported_posts mrp
        LEFT JOIN agents a ON mrp.agent_id = a.id
        ORDER BY mrp.reported_at DESC
        LIMIT 50
      `).all();
    } catch (e) { /* table might not exist */ }

    // Post volume by day
    let volumeByDay = [];
    try {
      volumeByDay = db.prepare(`
        SELECT
          DATE(reported_at) as date,
          COUNT(*) as posts_reported,
          COUNT(DISTINCT agent_id) as unique_agents
        FROM moltbook_reported_posts
        WHERE reported_at >= DATE('now', '-30 days')
        GROUP BY DATE(reported_at)
        ORDER BY date DESC
      `).all();
    } catch (e) { /* table might not exist */ }

    // Monitor run history
    let monitorRuns = [];
    try {
      monitorRuns = db.prepare(`
        SELECT * FROM moltbook_monitor_runs
        ORDER BY started_at DESC
        LIMIT 10
      `).all();
    } catch (e) { /* table might not exist */ }

    // Total posts
    let totalPosts = 0;
    try {
      totalPosts = db.prepare('SELECT COUNT(*) as cnt FROM moltbook_reported_posts').get().cnt;
    } catch (e) { /* table might not exist */ }

    // Agents with moltbook handles
    let agentsWithHandles = 0;
    try {
      agentsWithHandles = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE moltbook_handle IS NOT NULL AND moltbook_handle != ''").get().cnt;
    } catch (e) { /* column might not exist */ }

    res.json({
      template_stats: templateStats,
      recent_posts: recentPosts,
      volume_by_day: volumeByDay,
      monitor_runs: monitorRuns,
      totals: {
        posts: totalPosts,
        agents_with_handles: agentsWithHandles
      }
    });
  } catch (err) {
    log.error('Moltbook error:', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch moltbook data' });
  }
});

/**
 * GET /api/analytics/onboarding
 * Onboarding funnel analytics
 */
router.get('/onboarding', requireAdmin, (req, res) => {
  try {
    const db = getDb();

    // Agents created (onboarding started)
    const created = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'active'").get().cnt;

    // First battles completed
    let firstBattles = 0;
    try {
      firstBattles = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE first_battle_completed = 1").get().cnt;
    } catch (e) {
      // Column might not exist, estimate from agents with battles
      firstBattles = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE total_fights > 0").get().cnt;
    }

    // Claimed (has owner)
    const claimed = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE owner_id IS NOT NULL AND status = 'active'").get().cnt;

    // Continued playing (5+ battles)
    const continued = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE total_fights >= 5 AND status = 'active'").get().cnt;

    // Conversion rates
    const firstBattleRate = created > 0 ? Math.round((firstBattles / created) * 100) : 0;
    const claimRate = firstBattles > 0 ? Math.round((claimed / firstBattles) * 100) : 0;
    const retentionRate = claimed > 0 ? Math.round((continued / claimed) * 100) : 0;

    res.json({
      funnel: {
        created: created,
        first_battle: firstBattles,
        claimed: claimed,
        continued: continued
      },
      rates: {
        first_battle: firstBattleRate,
        claim: claimRate,
        retention: retentionRate
      }
    });
  } catch (err) {
    log.error('Onboarding error:', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch onboarding data' });
  }
});

// ============================================================================
// HEALTH CHECK DASHBOARD
// ============================================================================

/**
 * GET /api/analytics/health
 * System health dashboard - DB, caches, queues, memory
 */
router.get('/health', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const startTime = Date.now();

    // 1. Database health
    const dbStart = Date.now();
    const dbCheck = db.prepare('SELECT 1 as ok').get();
    const dbLatency = Date.now() - dbStart;

    // 2. Table counts (quick health indicators)
    const counts = {
      agents: db.prepare("SELECT COUNT(*) as c FROM agents WHERE status = 'active'").get().c,
      battles_active: db.prepare("SELECT COUNT(*) as c FROM battles WHERE status = 'active'").get().c,
      battles_pending: db.prepare("SELECT COUNT(*) as c FROM battles WHERE status = 'pending'").get().c,
      queue_depth: db.prepare("SELECT COUNT(*) as c FROM battle_queue").get().c,
      social_posts: db.prepare("SELECT COUNT(*) as c FROM social_posts").get().c,
    };

    // 3. Cache stats (from our caches)
    const cacheStats = {
      overview: { name: 'analytics-overview', ttl: '5min', cached: overviewCache.get() !== null },
      growth: { name: 'analytics-growth', ttl: '10min', cached: growthCache.get() !== null },
      engagement: { name: 'analytics-engagement', ttl: '5min', cached: engagementCache.get() !== null },
      types: { name: 'analytics-types', ttl: '5min', cached: typesCache.get() !== null },
    };

    // 4. Memory usage
    const memUsage = process.memoryUsage();
    const memory = {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
      external: Math.round(memUsage.external / 1024 / 1024) + ' MB',
    };

    // 5. Uptime
    const uptimeSeconds = process.uptime();
    const uptime = {
      seconds: Math.floor(uptimeSeconds),
      formatted: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${Math.floor(uptimeSeconds % 60)}s`
    };

    // 6. Recent activity (last 5 minutes)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const recentActivity = {
      battles_started: db.prepare("SELECT COUNT(*) as c FROM battles WHERE created_at >= ?").get(fiveMinAgo).c,
      agents_created: db.prepare("SELECT COUNT(*) as c FROM agents WHERE created_at >= ?").get(fiveMinAgo).c,
      social_posts: db.prepare("SELECT COUNT(*) as c FROM social_posts WHERE created_at >= ?").get(fiveMinAgo).c,
    };

    // 7. External services health check
    const externalServices = {
      clerk: {
        configured: !!(process.env.CLERK_SECRET_KEY || process.env.CLERK_JWT_KEY),
        status: 'unknown'
      },
      stripe: {
        configured: !!process.env.STRIPE_SECRET_KEY,
        status: 'unknown'
      },
      redis: {
        configured: !!process.env.REDIS_URL,
        status: 'unknown'
      },
      replicate: {
        configured: !!process.env.REPLICATE_API_TOKEN,
        status: 'unknown'
      }
    };

    // Check Redis connection if configured
    if (process.env.REDIS_URL) {
      try {
        const { getRedisClient } = require('../utils/redis');
        const redis = await getRedisClient();
        externalServices.redis.status = redis ? 'connected' : 'unavailable';
      } catch {
        externalServices.redis.status = 'error';
      }
    }

    // 8. Overall status
    const totalLatency = Date.now() - startTime;
    const status = dbCheck?.ok === 1 && dbLatency < 100 ? 'healthy' : 'degraded';

    res.json({
      status,
      timestamp: new Date().toISOString(),
      latency: {
        db: dbLatency + 'ms',
        total: totalLatency + 'ms'
      },
      database: {
        connected: dbCheck?.ok === 1,
        counts
      },
      caches: cacheStats,
      externalServices,
      memory,
      uptime,
      recentActivity,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    log.error('Health check failed:', { error: err.message });
    res.status(500).json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
