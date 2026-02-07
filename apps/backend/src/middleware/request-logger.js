'use strict';

const log = require('../utils/logger').createLogger('HTTP');
const crypto = require('crypto');

// =============================================================================
// DEPRECATED ENDPOINTS TRACKING
// =============================================================================

/**
 * List of deprecated endpoint patterns
 * These will be logged at DEBUG level instead of WARN to reduce log noise
 */
const DEPRECATED_PATHS = [
  '/proposals',
  '/fights',
  '/fights/available',
  '/priority',
  '/judging',  // Matches /judging/*
  '/voting',
  '/feed',
];

/**
 * Check if a path is a known deprecated endpoint
 * @param {string} path - Request path
 * @returns {boolean}
 */
function isDeprecatedPath(path) {
  return DEPRECATED_PATHS.some(deprecated =>
    path === deprecated || path.startsWith(deprecated + '/')
  );
}

/**
 * In-memory metrics for deprecated endpoint tracking
 * Structure: { endpoint: { count, unique_bots: Set<string>, last_hit: Date, bot_hits: Map<bot_id, count> } }
 */
const deprecatedMetrics = new Map();

/**
 * Track a deprecated endpoint hit
 * @param {string} endpoint - The deprecated endpoint path
 * @param {string|null} botId - The bot ID if available
 */
function trackDeprecatedHit(endpoint, botId) {
  // Normalize endpoint (strip trailing slashes, group /judging/* patterns)
  let normalizedEndpoint = endpoint.replace(/\/+$/, '');
  if (normalizedEndpoint.startsWith('/judging/')) {
    normalizedEndpoint = '/judging/*';
  }

  if (!deprecatedMetrics.has(normalizedEndpoint)) {
    deprecatedMetrics.set(normalizedEndpoint, {
      count: 0,
      unique_bots: new Set(),
      last_hit: null,
      bot_hits: new Map(),
    });
  }

  const metrics = deprecatedMetrics.get(normalizedEndpoint);
  metrics.count++;
  metrics.last_hit = new Date();

  if (botId) {
    metrics.unique_bots.add(botId);
    const currentBotHits = metrics.bot_hits.get(botId) || 0;
    metrics.bot_hits.set(botId, currentBotHits + 1);
  }
}

/**
 * Get current deprecated endpoint metrics
 * @returns {Object} Metrics object for API response
 */
function getDeprecatedMetrics() {
  const result = {};
  for (const [endpoint, metrics] of deprecatedMetrics) {
    result[endpoint] = {
      count: metrics.count,
      unique_bots: metrics.unique_bots.size,
      last_hit: metrics.last_hit ? metrics.last_hit.toISOString() : null,
      top_bots: Array.from(metrics.bot_hits.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id, count]) => ({ bot_id: id, hits: count })),
    };
  }
  return result;
}

/**
 * Reset metrics (called after hourly summary log)
 */
function resetDeprecatedMetrics() {
  deprecatedMetrics.clear();
}

// =============================================================================
// BOT TRACKING
// =============================================================================

/**
 * Extract agent/bot ID from Bearer token without full auth
 * This is a lightweight lookup for logging purposes only
 * @param {string|undefined} authHeader - Authorization header value
 * @returns {string|null} Agent ID or null
 */
function extractBotIdFromAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);

  // Only attempt lookup for valid token formats
  if (!token.startsWith('clw_sk_') && !token.startsWith('clw_bot_')) {
    return null;
  }

  try {
    const { getDb } = require('../db/schema');
    const db = getDb();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    let agent;
    if (token.startsWith('clw_bot_')) {
      agent = db.prepare('SELECT id FROM agents WHERE bot_token_hash = ? AND status = ?').get(tokenHash, 'active');
    } else {
      agent = db.prepare('SELECT id FROM agents WHERE api_key = ? AND status = ?').get(tokenHash, 'active');
    }

    return agent ? agent.id : null;
  } catch (e) {
    // Don't fail request logging if bot lookup fails
    return null;
  }
}

// =============================================================================
// HOURLY SUMMARY LOGGING
// =============================================================================

let lastSummaryLog = Date.now();
const SUMMARY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Log hourly summary of deprecated endpoint hits and reset metrics
 */
function logDeprecatedSummaryIfNeeded() {
  const now = Date.now();
  if (now - lastSummaryLog < SUMMARY_INTERVAL_MS) {
    return;
  }

  lastSummaryLog = now;

  // Only log if there are actual hits
  if (deprecatedMetrics.size === 0) {
    return;
  }

  const summaryParts = [];
  let totalHits = 0;
  const allBots = new Set();

  for (const [endpoint, metrics] of deprecatedMetrics) {
    totalHits += metrics.count;
    for (const botId of metrics.unique_bots) {
      allBots.add(botId);
    }
    summaryParts.push(`${endpoint} hit ${metrics.count} times by ${metrics.unique_bots.size} bots`);
  }

  log.info('Deprecated endpoint summary', {
    total_hits: totalHits,
    total_unique_bots: allBots.size,
    breakdown: summaryParts,
    period_hours: 1,
  });

  // Reset metrics for next period
  resetDeprecatedMetrics();
}

// =============================================================================
// REQUEST LOGGING MIDDLEWARE
// =============================================================================

/**
 * Request logging middleware
 * Logs structured data for debugging API issues
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();
  const requestId = generateRequestId();

  // Attach request ID for correlation
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Extract bot ID early for logging context (before auth middleware runs)
  // This is a lightweight lookup that doesn't affect authentication
  const botIdFromToken = extractBotIdFromAuth(req.headers.authorization);
  if (botIdFromToken) {
    req.botIdFromToken = botIdFromToken;
  }

  // Capture original end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    res.end = originalEnd;
    res.end(chunk, encoding);

    const duration = Date.now() - startTime;

    // Determine bot ID: prefer auth middleware result, fall back to token extraction
    const botId = req.agent?.id || req.botIdFromToken || null;

    const logData = {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: duration + 'ms',
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent')?.slice(0, 100), // Truncate long UAs
    };

    // Add bot/agent ID to log context
    if (botId) {
      logData.botId = botId;
    }

    // Add auth context if available (from auth middleware)
    if (req.agent) {
      logData.agentId = req.agent.id;
      logData.agentName = req.agent.name;
    }
    if (req.userId) {
      logData.userId = req.userId;
    }

    // Add query params for GET requests (sanitized)
    if (req.method === 'GET' && Object.keys(req.query).length > 0) {
      logData.query = sanitizeParams(req.query);
    }

    // Check if this is a deprecated path
    const deprecated = isDeprecatedPath(req.path);

    // Track deprecated endpoint metrics
    if (deprecated && res.statusCode === 404) {
      trackDeprecatedHit(req.path, botId);
      logDeprecatedSummaryIfNeeded();
    }

    // Log level based on status code and deprecated path status
    if (res.statusCode >= 500) {
      log.error('Request failed', logData);
    } else if (res.statusCode >= 400) {
      // Use DEBUG for known deprecated 404s to reduce log noise
      if (deprecated && res.statusCode === 404) {
        log.debug('Deprecated endpoint accessed', logData);
      } else {
        log.warn('Request error', logData);
      }
    } else if (duration > 1000) {
      log.warn('Slow request', logData);
    } else {
      log.info('Request completed', logData);
    }
  };

  next();
}

/**
 * Generate a short unique request ID
 */
function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Sanitize query params (remove sensitive data)
 */
function sanitizeParams(params) {
  const sanitized = { ...params };
  const sensitiveKeys = ['api_key', 'apiKey', 'token', 'password', 'secret'];

  for (const key of sensitiveKeys) {
    if (sanitized[key]) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Error logging middleware (use after routes)
 */
function errorLogger(err, req, res, next) {
  log.error('Unhandled error', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  next(err);
}

/**
 * API deprecation middleware (RFC 8594)
 * Sets standard deprecation headers on deprecated endpoints
 * @param {Object} options - Deprecation options
 * @param {string} [options.deprecatedAt] - ISO date when endpoint was deprecated
 * @param {string} [options.sunsetAt] - ISO date when endpoint will be removed
 * @param {string} [options.link] - URL to migration documentation
 * @param {string} [options.successor] - Path to the replacement endpoint
 */
function deprecation(options = {}) {
  const { deprecatedAt, sunsetAt, link, successor } = options;

  return function(req, res, next) {
    // RFC 8594 Deprecation header
    if (deprecatedAt) {
      res.setHeader('Deprecation', `date="${deprecatedAt}"`);
    } else {
      res.setHeader('Deprecation', 'true');
    }

    // RFC 8594 Sunset header (removal date)
    if (sunsetAt) {
      res.setHeader('Sunset', new Date(sunsetAt).toUTCString());
    }

    // Link header pointing to documentation
    if (link) {
      const existing = res.getHeader('Link');
      const deprecationLink = `<${link}>; rel="deprecation"; type="text/html"`;
      res.setHeader('Link', existing ? `${existing}, ${deprecationLink}` : deprecationLink);
    }

    // Custom header for successor endpoint
    if (successor) {
      res.setHeader('X-Deprecated-Successor', successor);
    }

    // Track metrics for deprecated endpoints
    const botId = req.agent?.id || req.botIdFromToken || null;
    trackDeprecatedHit(req.path, botId);

    // Log deprecation usage at DEBUG level to reduce noise
    // Hourly summary will provide aggregate view
    log.debug('Deprecated endpoint accessed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      deprecatedAt,
      sunsetAt,
      agentId: req.agent?.id,
      botId,
      userId: req.userId
    });

    next();
  };
}

/**
 * Request timeout middleware
 * Returns 408 Request Timeout if request takes longer than specified time
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 */
function requestTimeout(timeoutMs = 30000) {
  return function(req, res, next) {
    // Set response timeout
    req.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        log.warn('Request timeout', {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          timeoutMs
        });
        res.status(408).json({
          error: 'Request Timeout',
          code: 'REQUEST_TIMEOUT',
          message: `Request exceeded ${timeoutMs / 1000}s timeout`
        });
      }
    });

    next();
  };
}

module.exports = {
  requestLogger,
  errorLogger,
  generateRequestId,
  requestTimeout,
  deprecation,
  // Deprecated endpoint tracking
  isDeprecatedPath,
  getDeprecatedMetrics,
  trackDeprecatedHit,
  DEPRECATED_PATHS,
};
