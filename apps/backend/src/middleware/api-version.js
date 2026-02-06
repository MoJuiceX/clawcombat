'use strict';

/**
 * API Versioning Middleware
 *
 * Provides infrastructure for versioned API endpoints.
 * Supports both URL-based versioning (/api/v1/, /api/v2/) and header-based (Accept-Version).
 */

const log = require('../utils/logger').createLogger('API_VERSION');

// Current supported versions
const SUPPORTED_VERSIONS = ['v1', 'v2'];
const DEFAULT_VERSION = 'v1';
const CURRENT_VERSION = 'v2';

/**
 * Extract API version from request
 * Priority: URL path > Accept-Version header > X-API-Version header > default
 * @param {Request} req - Express request
 * @returns {string} API version (e.g., 'v1', 'v2')
 */
function extractVersion(req) {
  // 1. Check URL path (e.g., /api/v2/agents)
  const pathMatch = req.path.match(/^\/api\/(v\d+)\//);
  if (pathMatch && SUPPORTED_VERSIONS.includes(pathMatch[1])) {
    return pathMatch[1];
  }

  // 2. Check Accept-Version header
  const acceptVersion = req.get('Accept-Version');
  if (acceptVersion && SUPPORTED_VERSIONS.includes(acceptVersion)) {
    return acceptVersion;
  }

  // 3. Check X-API-Version header
  const apiVersion = req.get('X-API-Version');
  if (apiVersion && SUPPORTED_VERSIONS.includes(apiVersion)) {
    return apiVersion;
  }

  // 4. Default version
  return DEFAULT_VERSION;
}

/**
 * API versioning middleware
 * Sets req.apiVersion and response headers
 */
function apiVersioning(req, res, next) {
  const version = extractVersion(req);
  req.apiVersion = version;

  // Set response headers
  res.setHeader('X-API-Version', version);
  res.setHeader('X-API-Current-Version', CURRENT_VERSION);

  // Warn if using deprecated version
  if (version !== CURRENT_VERSION) {
    res.setHeader('X-API-Deprecated', 'true');
    res.setHeader('X-API-Sunset', '2027-01-01'); // Example sunset date

    log.info('Deprecated API version used', {
      requestId: req.requestId,
      version,
      currentVersion: CURRENT_VERSION,
      path: req.path
    });
  }

  next();
}

/**
 * Create version-specific route handler
 * Routes requests to different handlers based on API version
 *
 * @example
 * router.get('/agents', versionedRoute({
 *   v1: (req, res) => res.json({ data: agents }),
 *   v2: (req, res) => res.json({ data: agents, meta: { version: 'v2' } })
 * }));
 *
 * @param {Object} handlers - Object mapping version to handler function
 * @returns {Function} Express middleware
 */
function versionedRoute(handlers) {
  return function (req, res, next) {
    const version = req.apiVersion || DEFAULT_VERSION;
    const handler = handlers[version] || handlers[DEFAULT_VERSION];

    if (!handler) {
      return res.status(400).json({
        error: 'Unsupported API version',
        code: 'UNSUPPORTED_VERSION',
        supportedVersions: SUPPORTED_VERSIONS
      });
    }

    return handler(req, res, next);
  };
}

/**
 * Middleware to require minimum API version
 * @param {string} minVersion - Minimum version required (e.g., 'v2')
 */
function requireVersion(minVersion) {
  const minVersionNum = parseInt(minVersion.replace('v', ''), 10);

  return function (req, res, next) {
    const currentVersionNum = parseInt((req.apiVersion || DEFAULT_VERSION).replace('v', ''), 10);

    if (currentVersionNum < minVersionNum) {
      return res.status(400).json({
        error: `This endpoint requires API version ${minVersion} or higher`,
        code: 'VERSION_TOO_LOW',
        currentVersion: req.apiVersion,
        minimumVersion: minVersion
      });
    }

    next();
  };
}

/**
 * Middleware to mark endpoint as deprecated in specific version
 * @param {string} deprecatedInVersion - Version where this was deprecated
 * @param {string} [successor] - Path to successor endpoint
 */
function deprecatedIn(deprecatedInVersion, successor = null) {
  return function (req, res, next) {
    const version = req.apiVersion || DEFAULT_VERSION;
    const deprecatedNum = parseInt(deprecatedInVersion.replace('v', ''), 10);
    const currentNum = parseInt(version.replace('v', ''), 10);

    if (currentNum >= deprecatedNum) {
      res.setHeader('X-Deprecated-In', deprecatedInVersion);
      if (successor) {
        res.setHeader('X-Deprecated-Successor', successor);
      }

      log.warn('Deprecated endpoint accessed', {
        requestId: req.requestId,
        path: req.path,
        deprecatedIn: deprecatedInVersion,
        successor
      });
    }

    next();
  };
}

/**
 * Get version info for /api/version endpoint
 */
function getVersionInfo() {
  return {
    current: CURRENT_VERSION,
    supported: SUPPORTED_VERSIONS,
    default: DEFAULT_VERSION,
    documentation: '/api/docs'
  };
}

module.exports = {
  apiVersioning,
  versionedRoute,
  requireVersion,
  deprecatedIn,
  extractVersion,
  getVersionInfo,
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  CURRENT_VERSION
};
