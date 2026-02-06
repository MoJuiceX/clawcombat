/**
 * Jest Test Setup
 * Sets up in-memory database for testing
 */

// Use in-memory SQLite for tests
process.env.DATABASE_URL = ':memory:';
process.env.NODE_ENV = 'test';

// Suppress console.log during tests unless debugging
if (!process.env.DEBUG_TESTS) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    // Keep warn and error visible for debugging
    warn: console.warn,
    error: console.error,
  };
}
