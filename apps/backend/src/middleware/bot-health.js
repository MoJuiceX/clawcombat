/**
 * Bot Health Tracking Middleware
 *
 * Records bot activity for authenticated agent requests.
 * Tracks endpoint usage, success/failure, and skill.md version.
 */

const { recordActivity } = require('../services/bot-health');

/**
 * Middleware that records bot activity after response is sent
 * Must be placed AFTER authenticateAgent middleware
 *
 * Usage:
 *   router.get('/endpoint', agentAuth, botHealthTracker, handler);
 *
 * Or apply globally after auth:
 *   app.use(optionalBotHealthTracker);  // For routes with optional auth
 */
function botHealthTracker(req, res, next) {
  // Only track if agent is authenticated
  if (!req.agent) {
    return next();
  }

  const startTime = Date.now();
  const agentId = req.agent.id;
  const endpoint = req.originalUrl.split('?')[0]; // Remove query params
  const method = req.method;

  // Extract skill.md version from header
  const skillMdVersion = req.headers['x-skillmd-version'] || req.headers['x-skill-md-version'];

  // Hook into response finish event
  res.on('finish', () => {
    const responseTimeMs = Date.now() - startTime;
    const statusCode = res.statusCode;
    const success = statusCode >= 200 && statusCode < 400;

    // Get error message from response if available
    let errorMessage = null;
    if (!success && res._body && typeof res._body === 'object') {
      errorMessage = res._body.error || res._body.message || null;
    }

    // Record the activity asynchronously (don't block response)
    setImmediate(() => {
      recordActivity({
        agentId,
        endpoint,
        method,
        statusCode,
        success,
        skillMdVersion,
        errorMessage,
        responseTimeMs
      });
    });
  });

  next();
}

/**
 * Express middleware factory for response body capture
 * Use this before botHealthTracker if you want to capture error messages
 *
 * Usage:
 *   app.use(captureResponseBody);
 *   app.use(botHealthTracker);
 */
function captureResponseBody(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function(body) {
    res._body = body;
    return originalJson(body);
  };

  next();
}

/**
 * Wrapper that applies bot health tracking to a route
 * Convenient for adding to existing routes
 *
 * Usage:
 *   router.get('/endpoint', agentAuth, withHealthTracking(handler));
 */
function withHealthTracking(handler) {
  return [botHealthTracker, handler];
}

module.exports = {
  botHealthTracker,
  captureResponseBody,
  withHealthTracking
};
