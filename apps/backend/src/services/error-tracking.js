'use strict';

/**
 * Error Tracking Service
 *
 * Provides centralized error tracking with Sentry integration.
 * Falls back gracefully when Sentry is not configured.
 */

const log = require('../utils/logger').createLogger('ERROR_TRACKING');

// Sentry SDK (optional dependency)
let Sentry = null;
let isSentryInitialized = false;

/**
 * Initialize error tracking
 * Call this once during app startup
 * @param {Object} options - Configuration options
 */
function init(options = {}) {
  const dsn = options.dsn || process.env.SENTRY_DSN;

  if (!dsn) {
    log.info('Sentry DSN not configured, error tracking disabled');
    return false;
  }

  try {
    // Dynamically require Sentry to make it an optional dependency
    Sentry = require('@sentry/node');

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: options.release || process.env.npm_package_version || '1.0.0',

      // Performance monitoring
      tracesSampleRate: options.tracesSampleRate ?? 0.1, // 10% of transactions

      // Error sampling
      sampleRate: options.sampleRate ?? 1.0, // 100% of errors

      // Integrations
      integrations: [
        // Capture unhandled promise rejections
        Sentry.captureConsoleIntegration({ levels: ['error'] }),
      ],

      // Before sending, filter sensitive data
      beforeSend(event, hint) {
        // Remove sensitive headers
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
          delete event.request.headers['x-admin-secret'];
        }

        // Remove sensitive data from request body
        if (event.request?.data) {
          const data = typeof event.request.data === 'string'
            ? JSON.parse(event.request.data)
            : event.request.data;

          // Redact known sensitive fields
          const sensitiveFields = [
            'password', 'api_key', 'secret', 'session_token', 'claim_code',
            'webhook_secret', 'bot_token', 'access_token', 'refresh_token',
            'private_key', 'stripe_key', 'clerk_key'
          ];
          for (const field of sensitiveFields) {
            if (data[field]) data[field] = '[REDACTED]';
          }

          // Redact any field ending in _key, _token, or _secret
          for (const key of Object.keys(data)) {
            if (/_key$|_token$|_secret$/.test(key)) {
              data[key] = '[REDACTED]';
            }
          }

          event.request.data = JSON.stringify(data);
        }

        return event;
      },

      // Tags for filtering
      initialScope: {
        tags: {
          service: 'clawcombat-backend',
        },
      },
    });

    isSentryInitialized = true;
    log.info('Sentry initialized successfully', { environment: process.env.NODE_ENV });
    return true;
  } catch (err) {
    log.warn('Failed to initialize Sentry', { error: err.message });
    return false;
  }
}

/**
 * Capture an exception
 * @param {Error} error - The error to capture
 * @param {Object} context - Additional context
 */
function captureException(error, context = {}) {
  // Always log locally
  log.error('Exception captured', {
    error: error.message,
    stack: error.stack,
    ...context
  });

  if (isSentryInitialized && Sentry) {
    Sentry.withScope((scope) => {
      // Add custom context
      if (context.user) {
        scope.setUser(context.user);
      }
      if (context.tags) {
        Object.entries(context.tags).forEach(([key, value]) => {
          scope.setTag(key, value);
        });
      }
      if (context.extra) {
        Object.entries(context.extra).forEach(([key, value]) => {
          scope.setExtra(key, value);
        });
      }

      Sentry.captureException(error);
    });
  }
}

/**
 * Capture a message
 * @param {string} message - The message to capture
 * @param {string} level - Severity level (info, warning, error)
 * @param {Object} context - Additional context
 */
function captureMessage(message, level = 'info', context = {}) {
  log.info('Message captured', { message, level, ...context });

  if (isSentryInitialized && Sentry) {
    Sentry.withScope((scope) => {
      scope.setLevel(level);
      if (context.tags) {
        Object.entries(context.tags).forEach(([key, value]) => {
          scope.setTag(key, value);
        });
      }
      Sentry.captureMessage(message);
    });
  }
}

/**
 * Set user context for subsequent errors
 * @param {Object} user - User information
 */
function setUser(user) {
  if (isSentryInitialized && Sentry) {
    Sentry.setUser({
      id: user.id,
      username: user.name,
      email: user.email,
      // Don't include sensitive data
    });
  }
}

/**
 * Clear user context
 */
function clearUser() {
  if (isSentryInitialized && Sentry) {
    Sentry.setUser(null);
  }
}

/**
 * Add breadcrumb for debugging
 * @param {Object} breadcrumb - Breadcrumb data
 */
function addBreadcrumb(breadcrumb) {
  if (isSentryInitialized && Sentry) {
    Sentry.addBreadcrumb({
      category: breadcrumb.category || 'default',
      message: breadcrumb.message,
      level: breadcrumb.level || 'info',
      data: breadcrumb.data,
    });
  }
}

/**
 * Express error handling middleware
 * Use as the last middleware in the chain
 */
function errorHandler(err, req, res, next) {
  // Capture the error
  captureException(err, {
    user: req.agent ? { id: req.agent.id, username: req.agent.name } : undefined,
    tags: {
      path: req.path,
      method: req.method,
    },
    extra: {
      requestId: req.requestId,
      query: req.query,
      params: req.params,
    },
  });

  // Don't expose internal errors in production
  const statusCode = err.statusCode || err.status || 500;
  const message = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'Internal server error'
    : err.message;

  res.status(statusCode).json({
    error: message,
    code: err.code || 'INTERNAL_ERROR',
    requestId: req.requestId,
  });
}

/**
 * Express request handler wrapper for Sentry
 * Wraps async route handlers to capture errors
 */
function requestHandler() {
  if (isSentryInitialized && Sentry) {
    return Sentry.Handlers.requestHandler();
  }
  return (req, res, next) => next();
}

/**
 * Express tracing handler for performance monitoring
 */
function tracingHandler() {
  if (isSentryInitialized && Sentry) {
    return Sentry.Handlers.tracingHandler();
  }
  return (req, res, next) => next();
}

/**
 * Flush pending events before shutdown
 * @param {number} timeout - Timeout in ms (default: 2000)
 */
async function flush(timeout = 2000) {
  if (isSentryInitialized && Sentry) {
    await Sentry.flush(timeout);
  }
}

/**
 * Close Sentry connection
 */
async function close() {
  if (isSentryInitialized && Sentry) {
    await Sentry.close();
    isSentryInitialized = false;
  }
}

module.exports = {
  init,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  addBreadcrumb,
  errorHandler,
  requestHandler,
  tracingHandler,
  flush,
  close,
  isInitialized: () => isSentryInitialized,
};
