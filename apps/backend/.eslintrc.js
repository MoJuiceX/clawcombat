/**
 * ESLint Configuration for ClawCombat Backend
 *
 * Run: npx eslint src/
 * Fix: npx eslint src/ --fix
 */
module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // Error prevention
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],

    // Code quality
    'no-var': 'warn',
    'prefer-const': 'warn',
    'eqeqeq': ['warn', 'always', { null: 'ignore' }],
    'no-throw-literal': 'error',

    // Style (relaxed - don't want to reformat entire codebase)
    'semi': ['warn', 'always'],
    'quotes': ['off'], // Mixed quotes in codebase
    'indent': ['off'], // Mixed indentation
    'comma-dangle': ['off'],

    // Allow these patterns
    'no-empty': ['error', { allowEmptyCatch: true }], // Allow empty catch with comment
    'no-console': 'off', // Console is used for logging (will be replaced gradually)
  },
  ignorePatterns: [
    'node_modules/',
    'coverage/',
    '*.min.js',
    'src/public/js/*.js', // Frontend JS has different patterns
  ],
};
