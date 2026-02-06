/**
 * Application Constants
 *
 * Centralized constants to avoid magic numbers throughout the codebase.
 * Import specific constants: const { MS_PER_DAY, TRIAL_DAYS } = require('../config/constants');
 */

// ============================================================================
// TIME DURATIONS (in milliseconds)
// ============================================================================

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

// ============================================================================
// FEATURE-SPECIFIC DURATIONS
// ============================================================================

// Auth & Security
const LAST_ACTIVE_THROTTLE_MS = 5 * MS_PER_MINUTE;  // Throttle last_active updates
const ADMIN_LOCKOUT_MS = 15 * MS_PER_MINUTE;        // Lockout after failed attempts
const MAX_FAILED_ADMIN_ATTEMPTS = 5;

// Caching
const CACHE_TTL_SHORT = 30 * MS_PER_SECOND;         // Agent profiles, leaderboard
const CACHE_TTL_MEDIUM = MS_PER_MINUTE;             // Governance stats
const CACHE_TTL_LONG = 5 * MS_PER_MINUTE;           // Analytics
const CACHE_TTL_SEMANTIC = MS_PER_DAY;              // AI response cache
const CACHE_CLEANUP_INTERVAL = MS_PER_HOUR;

// Content Expiration
const SOCIAL_POST_EXPIRY_MS = 30 * MS_PER_DAY;      // Posts expire after 30 days
const SOCIAL_TOKEN_EXPIRY_MS = MS_PER_DAY;          // Battle tokens expire in 24h
const VOTE_WINDOW_MS = MS_PER_DAY;                  // Governance vote window
const CLAIM_CODE_EXPIRY_MS = MS_PER_DAY;            // Agent claim codes

// Trial & Subscription
const TRIAL_PERIOD_MS = 14 * MS_PER_DAY;            // 14-day trial
const PREMIUM_PERIOD_MS = 30 * MS_PER_DAY;          // Monthly subscription

// ============================================================================
// RATE LIMITS
// ============================================================================

const RATE_LIMIT_TRIAL = { fights: 1, perMs: MS_PER_HOUR };
const RATE_LIMIT_FREE = { fights: 6, perMs: MS_PER_DAY };
const RATE_LIMIT_PREMIUM = { fights: 1, perMs: MS_PER_HOUR };
const RATE_LIMIT_EVENTS = { count: 60, perMs: MS_PER_MINUTE };

// ============================================================================
// GAME CONSTANTS
// ============================================================================

// Battle
const MAX_BATTLE_TURNS = 50;

// ============================================================================
// CONTENT LIMITS
// ============================================================================

const MAX_POST_LENGTH = 280;
const MAX_NAME_LENGTH = 50;
const LEADERBOARD_PAGE_SIZE = 20;
const LEADERBOARD_MAX_SIZE = 100;
const FEED_PAGE_SIZE = 50;
const FEED_MAX_SIZE = 200;

// ============================================================================
// ERROR CODES (Structured error codes for API responses)
// ============================================================================

const ERROR_CODES = {
  // Authentication
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_MISSING: 'AUTH_MISSING',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  AUTH_SERVICE_UNAVAILABLE: 'AUTH_SERVICE_UNAVAILABLE',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',
  FIGHT_LIMIT_EXCEEDED: 'FIGHT_LIMIT_EXCEEDED',

  // Validation
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_MOVE: 'INVALID_MOVE',

  // Resources
  NOT_FOUND: 'NOT_FOUND',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  BATTLE_NOT_FOUND: 'BATTLE_NOT_FOUND',
  POST_NOT_FOUND: 'POST_NOT_FOUND',

  // State
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  ALREADY_QUEUED: 'ALREADY_QUEUED',
  ALREADY_IN_BATTLE: 'ALREADY_IN_BATTLE',
  NOT_OWNER: 'NOT_OWNER',

  // External services
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  WEBHOOK_FAILED: 'WEBHOOK_FAILED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Time units
  MS_PER_SECOND,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  MS_PER_WEEK,

  // Auth & Security
  LAST_ACTIVE_THROTTLE_MS,
  ADMIN_LOCKOUT_MS,
  MAX_FAILED_ADMIN_ATTEMPTS,

  // Caching
  CACHE_TTL_SHORT,
  CACHE_TTL_MEDIUM,
  CACHE_TTL_LONG,
  CACHE_TTL_SEMANTIC,
  CACHE_CLEANUP_INTERVAL,

  // Content Expiration
  SOCIAL_POST_EXPIRY_MS,
  SOCIAL_TOKEN_EXPIRY_MS,
  VOTE_WINDOW_MS,
  CLAIM_CODE_EXPIRY_MS,

  // Trial & Subscription
  TRIAL_PERIOD_MS,
  PREMIUM_PERIOD_MS,

  // Rate Limits
  RATE_LIMIT_TRIAL,
  RATE_LIMIT_FREE,
  RATE_LIMIT_PREMIUM,
  RATE_LIMIT_EVENTS,

  // Battle
  MAX_BATTLE_TURNS,

  // Content limits
  MAX_POST_LENGTH,
  MAX_NAME_LENGTH,
  LEADERBOARD_PAGE_SIZE,
  LEADERBOARD_MAX_SIZE,
  FEED_PAGE_SIZE,
  FEED_MAX_SIZE,

  // Error codes
  ERROR_CODES,
};
