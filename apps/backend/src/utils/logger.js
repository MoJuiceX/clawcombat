/**
 * Structured Logger
 *
 * Simple logging utility with levels, timestamps, and JSON output option.
 * Can be easily upgraded to winston/pino later by changing this file.
 *
 * Usage:
 *   const log = require('../utils/logger');
 *   log.info('Server started', { port: 3000 });
 *   log.error('Failed to connect', { error: err.message });
 *   log.debug('Query result', { rows: 10 });
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Get log level from env, default to 'info'
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;
const useJson = process.env.LOG_FORMAT === 'json';

/**
 * Format a log message
 */
function formatMessage(level, module, message, data) {
  const timestamp = new Date().toISOString();

  if (useJson) {
    return JSON.stringify({
      timestamp,
      level,
      module,
      message,
      ...data,
    });
  }

  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const moduleTag = module ? ` [${module}]` : '';
  const dataStr = data && Object.keys(data).length > 0
    ? ' ' + JSON.stringify(data)
    : '';

  return `${prefix}${moduleTag} ${message}${dataStr}`;
}

/**
 * Create a logger instance, optionally scoped to a module
 */
function createLogger(moduleName = null) {
  return {
    debug(message, data = {}) {
      if (currentLevel <= LOG_LEVELS.debug) {
        console.log(formatMessage('debug', moduleName, message, data));
      }
    },

    info(message, data = {}) {
      if (currentLevel <= LOG_LEVELS.info) {
        console.log(formatMessage('info', moduleName, message, data));
      }
    },

    warn(message, data = {}) {
      if (currentLevel <= LOG_LEVELS.warn) {
        console.warn(formatMessage('warn', moduleName, message, data));
      }
    },

    error(message, data = {}) {
      if (currentLevel <= LOG_LEVELS.error) {
        // If data contains an Error object, extract useful info
        if (data.error instanceof Error) {
          data = {
            ...data,
            error: data.error.message,
            stack: data.error.stack,
          };
        }
        console.error(formatMessage('error', moduleName, message, data));
      }
    },

    /**
     * Create a child logger with a module name
     */
    child(childModule) {
      return createLogger(moduleName ? `${moduleName}:${childModule}` : childModule);
    },
  };
}

// Default logger instance
const defaultLogger = createLogger();

// Export both the default logger and the factory
module.exports = defaultLogger;
module.exports.createLogger = createLogger;
module.exports.LOG_LEVELS = LOG_LEVELS;
