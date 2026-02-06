'use strict';

const log = require('../utils/logger').createLogger('HTTP');

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

  // Capture original end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    res.end = originalEnd;
    res.end(chunk, encoding);

    const duration = Date.now() - startTime;
    const logData = {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: duration + 'ms',
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent')?.slice(0, 100), // Truncate long UAs
    };

    // Add auth context if available
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

    // Log level based on status code
    if (res.statusCode >= 500) {
      log.error('Request failed', logData);
    } else if (res.statusCode >= 400) {
      log.warn('Request error', logData);
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

    // Log deprecation usage for monitoring
    log.warn('Deprecated endpoint accessed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      deprecatedAt,
      sunsetAt,
      agentId: req.agent?.id,
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
  deprecation
};
