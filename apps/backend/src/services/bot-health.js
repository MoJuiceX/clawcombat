/**
 * Bot Health Monitoring Service
 *
 * Tracks bot activity, errors, and skill.md versions to help identify:
 * - Bots using outdated skill.md versions
 * - Common error patterns
 * - Bot activity and engagement
 */

const { getDb } = require('../db/schema');
const { MS_PER_DAY, MS_PER_HOUR } = require('../config/constants');
const log = require('../utils/logger').createLogger('BOT-HEALTH');

// Current skill.md version (update this when skill.md changes)
const CURRENT_SKILL_MD_VERSION = '2.1.0';

// Common error endpoints that indicate outdated skill.md
const OUTDATED_ENDPOINTS = [
  '/fights/available',
  '/fights',
  '/proposals',
  '/feed',
  '/priority',
  '/judging',
  '/voting'
];

// Whitelist of columns for SQL injection prevention
const ALLOWED_SORT_COLUMNS = ['created_at', 'endpoint', 'status_code', 'success'];

/**
 * Record a bot activity event
 * @param {Object} params
 * @param {string} params.agentId - The agent's ID
 * @param {string} params.endpoint - The endpoint called
 * @param {string} params.method - HTTP method (GET, POST, etc.)
 * @param {number} params.statusCode - HTTP status code
 * @param {boolean} params.success - Whether the request was successful (2xx)
 * @param {string} [params.skillMdVersion] - Version from X-SkillMD-Version header
 * @param {string} [params.errorMessage] - Error message if failed
 * @param {number} [params.responseTimeMs] - Response time in milliseconds
 */
function recordActivity(params) {
  const {
    agentId,
    endpoint,
    method = 'GET',
    statusCode,
    success,
    skillMdVersion,
    errorMessage,
    responseTimeMs
  } = params;

  if (!agentId || !endpoint || statusCode === undefined) {
    log.warn('Invalid activity record params', { agentId, endpoint, statusCode });
    return;
  }

  try {
    const db = getDb();

    // Insert activity log
    db.prepare(`
      INSERT INTO bot_health_logs (agent_id, endpoint, method, status_code, success, skill_md_version, error_message, response_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agentId,
      endpoint,
      method,
      statusCode,
      success ? 1 : 0,
      skillMdVersion || null,
      errorMessage || null,
      responseTimeMs || null
    );

    // Update agent's skill_md_version if provided
    if (skillMdVersion) {
      db.prepare('UPDATE agents SET skill_md_version = ? WHERE id = ?').run(skillMdVersion, agentId);
    }

    // Update error tracking on agent if this was an error
    if (!success) {
      const errorInfo = `${endpoint} (${statusCode})`;
      db.prepare(`
        UPDATE agents
        SET health_last_error = ?,
            health_last_error_at = CURRENT_TIMESTAMP,
            health_error_count_24h = COALESCE(health_error_count_24h, 0) + 1
        WHERE id = ?
      `).run(errorInfo, agentId);
    }
  } catch (err) {
    log.error('Failed to record bot activity', { error: err.message, agentId, endpoint });
  }
}

/**
 * Get health stats for a specific agent
 * @param {string} agentId
 * @returns {Object} Health statistics
 */
function getAgentHealth(agentId) {
  const db = getDb();

  // Get agent info including skill version
  const agent = db.prepare('SELECT id, name, skill_md_version, last_active_at FROM agents WHERE id = ?').get(agentId);
  if (!agent) {
    return null;
  }

  // Get activity stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_calls,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_calls,
      MIN(created_at) as first_seen,
      MAX(created_at) as last_seen
    FROM bot_health_logs
    WHERE agent_id = ?
  `).get(agentId);

  // Get most common errors (top 5)
  const commonErrors = db.prepare(`
    SELECT endpoint || ' (' || status_code || ')' as error,
           COUNT(*) as count
    FROM bot_health_logs
    WHERE agent_id = ? AND success = 0
    GROUP BY endpoint, status_code
    ORDER BY count DESC
    LIMIT 5
  `).all(agentId);

  // Determine if using outdated version
  const isOutdated = agent.skill_md_version && agent.skill_md_version !== CURRENT_SKILL_MD_VERSION;

  // Generate recommendations
  const recommendations = [];

  if (isOutdated) {
    recommendations.push(`Update to skill.md v${CURRENT_SKILL_MD_VERSION} for correct endpoints`);
  }

  // Check if hitting known outdated endpoints
  const outdatedEndpointHits = commonErrors.filter(e => {
    return OUTDATED_ENDPOINTS.some(oe => e.error.includes(oe));
  });

  if (outdatedEndpointHits.length > 0) {
    recommendations.push('Your bot is calling endpoints that no longer exist. Download the latest skill.md from https://clawcombat.com/skill.md');
  }

  // High error rate warning
  const errorRate = stats.total_calls > 0 ? stats.failed_calls / stats.total_calls : 0;
  if (errorRate > 0.1 && stats.total_calls >= 10) {
    recommendations.push(`High error rate (${(errorRate * 100).toFixed(1)}%). Check your API integration.`);
  }

  return {
    agent_id: agentId,
    skill_md_version: agent.skill_md_version || 'unknown',
    current_version: CURRENT_SKILL_MD_VERSION,
    is_outdated: isOutdated,
    stats: {
      total_calls: stats.total_calls || 0,
      successful_calls: stats.successful_calls || 0,
      failed_calls: stats.failed_calls || 0,
      error_rate: stats.total_calls > 0 ? parseFloat((stats.failed_calls / stats.total_calls).toFixed(3)) : 0,
      last_seen: stats.last_seen || null,
      first_seen: stats.first_seen || null,
      most_common_errors: commonErrors.map(e => e.error)
    },
    recommendations
  };
}

/**
 * Get overview of all bot health (admin endpoint)
 * @returns {Object} System-wide bot health overview
 */
function getHealthOverview() {
  const db = getDb();
  const now = Date.now();
  const oneDayAgo = new Date(now - MS_PER_DAY).toISOString();
  const oneHourAgo = new Date(now - MS_PER_HOUR).toISOString();
  const sevenDaysAgo = new Date(now - 7 * MS_PER_DAY).toISOString();

  // Active bots in last 24h
  const activeBots24h = db.prepare(`
    SELECT COUNT(DISTINCT agent_id) as count
    FROM bot_health_logs
    WHERE created_at >= ?
  `).get(oneDayAgo);

  // Active bots in last hour
  const activeBots1h = db.prepare(`
    SELECT COUNT(DISTINCT agent_id) as count
    FROM bot_health_logs
    WHERE created_at >= ?
  `).get(oneHourAgo);

  // Bots using outdated skill.md
  const outdatedBots = db.prepare(`
    SELECT COUNT(*) as count
    FROM agents
    WHERE skill_md_version IS NOT NULL
      AND skill_md_version != ?
      AND status = 'active'
      AND last_active_at >= ?
  `).get(CURRENT_SKILL_MD_VERSION, oneDayAgo);

  // Version distribution (active bots only)
  const versionDistribution = db.prepare(`
    SELECT
      COALESCE(skill_md_version, 'unknown') as version,
      COUNT(*) as count
    FROM agents
    WHERE status = 'active'
      AND last_active_at >= ?
    GROUP BY skill_md_version
    ORDER BY count DESC
  `).all(oneDayAgo);

  // Most common error endpoints (last 24h)
  const commonErrors = db.prepare(`
    SELECT
      endpoint,
      status_code,
      COUNT(*) as count,
      COUNT(DISTINCT agent_id) as unique_bots
    FROM bot_health_logs
    WHERE success = 0 AND created_at >= ?
    GROUP BY endpoint, status_code
    ORDER BY count DESC
    LIMIT 10
  `).all(oneDayAgo);

  // Error rate trend (by hour for last 24h)
  const errorTrend = db.prepare(`
    SELECT
      strftime('%Y-%m-%d %H:00', created_at) as hour,
      COUNT(*) as total,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors,
      ROUND(100.0 * SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as error_rate
    FROM bot_health_logs
    WHERE created_at >= ?
    GROUP BY hour
    ORDER BY hour ASC
  `).all(oneDayAgo);

  // Overall stats for last 24h
  const overall24h = db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
      AVG(response_time_ms) as avg_response_time
    FROM bot_health_logs
    WHERE created_at >= ?
  `).get(oneDayAgo);

  // Bots with high error rates
  const problematicBots = db.prepare(`
    SELECT
      agent_id,
      a.name as agent_name,
      a.skill_md_version,
      COUNT(*) as total_calls,
      SUM(CASE WHEN bhl.success = 0 THEN 1 ELSE 0 END) as failed_calls,
      ROUND(100.0 * SUM(CASE WHEN bhl.success = 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as error_rate
    FROM bot_health_logs bhl
    JOIN agents a ON bhl.agent_id = a.id
    WHERE bhl.created_at >= ?
    GROUP BY agent_id
    HAVING total_calls >= 10 AND error_rate > 10
    ORDER BY error_rate DESC
    LIMIT 10
  `).all(oneDayAgo);

  return {
    current_skill_md_version: CURRENT_SKILL_MD_VERSION,
    summary: {
      active_bots_24h: activeBots24h.count,
      active_bots_1h: activeBots1h.count,
      outdated_bots: outdatedBots.count,
      total_calls_24h: overall24h.total_calls || 0,
      successful_calls_24h: overall24h.successful || 0,
      failed_calls_24h: overall24h.failed || 0,
      overall_error_rate: overall24h.total_calls > 0
        ? parseFloat(((overall24h.failed / overall24h.total_calls) * 100).toFixed(2))
        : 0,
      avg_response_time_ms: overall24h.avg_response_time
        ? Math.round(overall24h.avg_response_time)
        : null
    },
    version_distribution: versionDistribution,
    most_common_errors: commonErrors.map(e => ({
      endpoint: e.endpoint,
      status_code: e.status_code,
      count: e.count,
      unique_bots: e.unique_bots
    })),
    error_rate_trend: errorTrend,
    problematic_bots: problematicBots.map(b => ({
      agent_id: b.agent_id,
      agent_name: b.agent_name,
      skill_md_version: b.skill_md_version || 'unknown',
      total_calls: b.total_calls,
      failed_calls: b.failed_calls,
      error_rate: b.error_rate
    }))
  };
}

/**
 * Clean up old health logs (call periodically)
 * Keeps last 7 days of logs
 */
function cleanupOldLogs() {
  try {
    const db = getDb();
    const sevenDaysAgo = new Date(Date.now() - 7 * MS_PER_DAY).toISOString();

    const result = db.prepare('DELETE FROM bot_health_logs WHERE created_at < ?').run(sevenDaysAgo);
    log.info('Cleaned up old bot health logs', { deletedRows: result.changes });

    // Also reset 24h error counts
    db.prepare("UPDATE agents SET health_error_count_24h = 0 WHERE health_last_error_at < ?").run(
      new Date(Date.now() - MS_PER_DAY).toISOString()
    );

    return result.changes;
  } catch (err) {
    log.error('Failed to cleanup bot health logs', { error: err.message });
    return 0;
  }
}

/**
 * Get recent activity for an agent (for debugging)
 * @param {string} agentId
 * @param {number} limit
 * @returns {Array} Recent activity logs
 */
function getRecentActivity(agentId, limit = 50) {
  const db = getDb();

  return db.prepare(`
    SELECT endpoint, method, status_code, success, skill_md_version, error_message, response_time_ms, created_at
    FROM bot_health_logs
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(agentId, Math.min(limit, 100));
}

module.exports = {
  recordActivity,
  getAgentHealth,
  getHealthOverview,
  cleanupOldLogs,
  getRecentActivity,
  CURRENT_SKILL_MD_VERSION
};
