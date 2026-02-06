/**
 * Sentry Instrumentation
 *
 * This file MUST be imported before all other modules to ensure proper
 * auto-instrumentation of Express, SQLite, and other libraries.
 *
 * Usage: require('./instrument') at the very top of index.js
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/express/
 */
'use strict';

const Sentry = require('@sentry/node');

// Only initialize if SENTRY_DSN is configured
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,

    // Environment tag (production, staging, development)
    environment: process.env.NODE_ENV || 'development',

    // Release version for tracking deployments
    // Uses RAILWAY_GIT_COMMIT_SHA if available (Railway sets this automatically)
    release: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.npm_package_version || '1.0.0',

    // Performance monitoring: capture 10% of transactions in production, 100% in dev
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Profile 10% of sampled transactions for performance insights
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Don't send PII by default (IP addresses, cookies, user data)
    // We explicitly set user context where needed
    sendDefaultPii: false,

    // Filter out sensitive data from request bodies
    beforeSend(event, hint) {
      // Scrub sensitive headers
      if (event.request?.headers) {
        const sensitiveHeaders = [
          'authorization',
          'x-admin-secret',
          'cookie',
          'x-clerk-token',
        ];
        for (const header of sensitiveHeaders) {
          if (event.request.headers[header]) {
            event.request.headers[header] = '[REDACTED]';
          }
        }
      }

      // Scrub sensitive data from request body
      if (event.request?.data) {
        const sensitiveFields = [
          'password',
          'api_key',
          'apiKey',
          'secret',
          'token',
          'stripe_secret',
        ];
        try {
          const data = typeof event.request.data === 'string'
            ? JSON.parse(event.request.data)
            : event.request.data;

          for (const field of sensitiveFields) {
            if (data[field]) {
              data[field] = '[REDACTED]';
            }
          }
          event.request.data = JSON.stringify(data);
        } catch {
          // Not JSON, leave as-is
        }
      }

      return event;
    },

    // Ignore certain errors that are expected/non-actionable
    ignoreErrors: [
      // Rate limiting is expected behavior
      'Rate limit exceeded',
      'Too many requests',
      // Client disconnects
      'ECONNRESET',
      'EPIPE',
      // Request timeouts
      'Request Timeout',
    ],

    // Integrations are auto-detected for Express, SQLite, etc.
    // Add any custom integrations here if needed
  });

  console.log(`[Sentry] Initialized for ${process.env.NODE_ENV || 'development'} environment`);
} else {
  console.log('[Sentry] Skipped initialization (SENTRY_DSN not configured)');
}

module.exports = Sentry;
