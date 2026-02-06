module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/*.spec.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    // Ignore old manual test files that use console.log/assert instead of Jest
    'battle-xp-config.test.js',
    'battles.test.js'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!src/scripts/**'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  // Use in-memory database for tests
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.js']
};
