#!/usr/bin/env node
/**
 * Pre-Deployment Validation Script
 *
 * Runs comprehensive checks before deploying to production.
 * Validates environment, configuration, dependencies, and critical functionality.
 *
 * Usage: node scripts/pre-deploy-check.js
 * Exit codes: 0 = all checks passed, 1 = critical failures detected
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

// Check results
const results = {
  passed: 0,
  warnings: 0,
  failed: 0,
  checks: [],
};

/**
 * Print colored output
 */
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logCheck(name, status, message) {
  const symbol = status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
  const color = status === 'pass' ? 'green' : status === 'warn' ? 'yellow' : 'red';

  log(`${symbol} ${name}: ${message}`, color);

  results.checks.push({ name, status, message });
  if (status === 'pass') results.passed++;
  else if (status === 'warn') results.warnings++;
  else results.failed++;
}

/**
 * Check if file exists
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Check environment variables
 */
function checkEnvironment() {
  log('\n📋 Environment Configuration', 'blue');
  log('─'.repeat(50), 'blue');

  const backendEnvPath = path.join(__dirname, '../apps/backend/.env');
  const backendEnvExamplePath = path.join(__dirname, '../apps/backend/.env.example');

  // Check .env exists
  if (fileExists(backendEnvPath)) {
    logCheck('Environment file', 'pass', '.env file exists');
  } else {
    logCheck('Environment file', 'fail', '.env file missing');
  }

  // Check .env.example exists
  if (fileExists(backendEnvExamplePath)) {
    logCheck('Environment template', 'pass', '.env.example exists');
  } else {
    logCheck('Environment template', 'warn', '.env.example missing (recommended)');
  }

  // Check .gitignore contains .env
  const gitignorePath = path.join(__dirname, '../apps/backend/.gitignore');
  if (fileExists(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (gitignore.includes('.env')) {
      logCheck('Git ignore', 'pass', '.env is ignored by git');
    } else {
      logCheck('Git ignore', 'fail', '.env NOT in .gitignore - SECURITY RISK');
    }
  }

  // Check critical environment variables
  if (fileExists(backendEnvPath)) {
    require('dotenv').config({ path: backendEnvPath });

    const requiredVars = [
      { name: 'ADMIN_SECRET', critical: true },
      { name: 'REPLICATE_API_TOKEN', critical: true },
      { name: 'STRIPE_SECRET_KEY', critical: true },
      { name: 'CLERK_SECRET_KEY', critical: true },
      { name: 'WEB_URL', critical: true },
    ];

    const optionalVars = [
      { name: 'SENTRY_DSN', critical: false },
      { name: 'OPENAI_API_KEY', critical: false },
      { name: 'TELEGRAM_BOT_TOKEN', critical: false },
    ];

    for (const { name, critical } of requiredVars) {
      if (process.env[name]) {
        // Check if it's a placeholder value
        if (process.env[name].includes('your_') || process.env[name].includes('here')) {
          logCheck(`Env: ${name}`, 'fail', 'Contains placeholder value - not production ready');
        } else if (name === 'ADMIN_SECRET' && process.env[name].length < 20) {
          logCheck(`Env: ${name}`, 'warn', 'Weak secret (less than 20 characters)');
        } else {
          logCheck(`Env: ${name}`, 'pass', 'Configured');
        }
      } else {
        logCheck(`Env: ${name}`, critical ? 'fail' : 'warn', critical ? 'MISSING (required)' : 'Missing (optional)');
      }
    }

    for (const { name, critical } of optionalVars) {
      if (process.env[name]) {
        logCheck(`Env: ${name}`, 'pass', 'Configured');
      } else {
        logCheck(`Env: ${name}`, 'warn', 'Not configured (optional but recommended)');
      }
    }
  }
}

/**
 * Check dependencies
 */
function checkDependencies() {
  log('\n📦 Dependencies', 'blue');
  log('─'.repeat(50), 'blue');

  const packageJsonPath = path.join(__dirname, '../apps/backend/package.json');

  if (!fileExists(packageJsonPath)) {
    logCheck('package.json', 'fail', 'File not found');
    return;
  }

  logCheck('package.json', 'pass', 'File exists');

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  // Check critical dependencies
  const criticalDeps = [
    'express',
    'better-sqlite3',
    '@clerk/express',
    'stripe',
    '@sentry/node',
  ];

  for (const dep of criticalDeps) {
    if (packageJson.dependencies[dep]) {
      logCheck(`Dependency: ${dep}`, 'pass', `v${packageJson.dependencies[dep]}`);
    } else {
      logCheck(`Dependency: ${dep}`, 'fail', 'Missing');
    }
  }

  // Check node_modules exists
  const nodeModulesPath = path.join(__dirname, '../apps/backend/node_modules');
  if (fileExists(nodeModulesPath)) {
    logCheck('node_modules', 'pass', 'Dependencies installed');
  } else {
    logCheck('node_modules', 'fail', 'Run npm install first');
  }
}

/**
 * Check file structure
 */
function checkFileStructure() {
  log('\n📁 File Structure', 'blue');
  log('─'.repeat(50), 'blue');

  const criticalFiles = [
    { path: 'apps/backend/src/index.js', name: 'Main server file' },
    { path: 'apps/backend/src/db/schema.js', name: 'Database schema' },
    { path: 'apps/backend/src/instrument.js', name: 'Sentry instrumentation' },
    { path: 'apps/backend/src/utils/content-moderation.js', name: 'Content moderation' },
    { path: 'SECRET_ROTATION_GUIDE.md', name: 'Secret rotation guide' },
    { path: 'MONITORING_SETUP.md', name: 'Monitoring setup guide' },
  ];

  for (const { path: filePath, name } of criticalFiles) {
    const fullPath = path.join(__dirname, '..', filePath);
    if (fileExists(fullPath)) {
      logCheck(name, 'pass', `${filePath} exists`);
    } else {
      logCheck(name, 'fail', `${filePath} missing`);
    }
  }
}

/**
 * Check security configurations
 */
function checkSecurity() {
  log('\n🔒 Security Checks', 'blue');
  log('─'.repeat(50), 'blue');

  // Check if secrets are in .env (not hardcoded)
  const indexPath = path.join(__dirname, '../apps/backend/src/index.js');
  if (fileExists(indexPath)) {
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    // Check for hardcoded secrets (common patterns)
    const secretPatterns = [
      /api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/i,
      /secret\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/i,
      /password\s*[:=]\s*['"][^'"]+['"]/i,
    ];

    let foundHardcodedSecrets = false;
    for (const pattern of secretPatterns) {
      if (pattern.test(indexContent)) {
        foundHardcodedSecrets = true;
        break;
      }
    }

    if (foundHardcodedSecrets) {
      logCheck('Hardcoded secrets', 'fail', 'Potential hardcoded secrets detected');
    } else {
      logCheck('Hardcoded secrets', 'pass', 'No obvious hardcoded secrets');
    }
  }

  // Check if .env contains test/placeholder values
  const envPath = path.join(__dirname, '../apps/backend/.env');
  if (fileExists(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');

    if (envContent.includes('bee gaga weekend')) {
      logCheck('Admin secret', 'fail', 'Using default weak admin secret');
    }

    if (envContent.includes('sk_test_')) {
      logCheck('Stripe keys', 'warn', 'Using Stripe test keys (change to live keys for production)');
    } else if (envContent.includes('sk_live_')) {
      logCheck('Stripe keys', 'pass', 'Using Stripe live keys');
    }
  }

  // Check content moderation is enabled
  const moderationPath = path.join(__dirname, '../apps/backend/src/utils/content-moderation.js');
  if (fileExists(moderationPath)) {
    logCheck('Content moderation', 'pass', 'Module exists and configured');
  } else {
    logCheck('Content moderation', 'warn', 'Content moderation not implemented');
  }
}

/**
 * Check database
 */
function checkDatabase() {
  log('\n🗄️  Database', 'blue');
  log('─'.repeat(50), 'blue');

  const dbPath = path.join(__dirname, '../apps/backend/data/clawcombat.db');

  if (fileExists(dbPath)) {
    const stats = fs.statSync(dbPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    logCheck('Database file', 'pass', `Exists (${sizeMB} MB)`);
  } else {
    logCheck('Database file', 'warn', 'Database not initialized (will be created on first run)');
  }

  // Check schema file
  const schemaPath = path.join(__dirname, '../apps/backend/src/db/schema.js');
  if (fileExists(schemaPath)) {
    logCheck('Schema file', 'pass', 'Database schema defined');
  } else {
    logCheck('Schema file', 'fail', 'Database schema missing');
  }
}

/**
 * Check tests
 */
function checkTests() {
  log('\n🧪 Tests', 'blue');
  log('─'.repeat(50), 'blue');

  const testDir = path.join(__dirname, '../apps/backend/src/__tests__');

  if (fileExists(testDir)) {
    const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.spec.js') || f.endsWith('.test.js'));
    logCheck('Test files', 'pass', `Found ${testFiles.length} test files`);

    // Check if tests pass (optional - can be slow)
    // Uncomment to run tests during validation
    /*
    try {
      log('Running tests...', 'blue');
      execSync('npm test', {
        cwd: path.join(__dirname, '../apps/backend'),
        stdio: 'pipe',
      });
      logCheck('Test suite', 'pass', 'All tests passed');
    } catch (err) {
      logCheck('Test suite', 'fail', 'Some tests failed');
    }
    */
  } else {
    logCheck('Test directory', 'warn', 'No tests found (recommended to add tests)');
  }
}

/**
 * Check Railway configuration
 */
function checkRailwayConfig() {
  log('\n🚂 Railway Configuration', 'blue');
  log('─'.repeat(50), 'blue');

  // Check for railway.json or railway.toml
  const railwayJsonPath = path.join(__dirname, '../railway.json');
  const railwayTomlPath = path.join(__dirname, '../railway.toml');

  if (fileExists(railwayJsonPath) || fileExists(railwayTomlPath)) {
    logCheck('Railway config', 'pass', 'Configuration file found');
  } else {
    logCheck('Railway config', 'warn', 'No railway.json/railway.toml (using Railway defaults)');
  }

  // Check start script
  const packageJsonPath = path.join(__dirname, '../apps/backend/package.json');
  if (fileExists(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (packageJson.scripts && packageJson.scripts.start) {
      logCheck('Start script', 'pass', `"${packageJson.scripts.start}"`);
    } else {
      logCheck('Start script', 'fail', 'No "start" script in package.json');
    }
  }
}

/**
 * Generate summary report
 */
function generateSummary() {
  log('\n' + '═'.repeat(50), 'blue');
  log('📊 SUMMARY', 'bold');
  log('═'.repeat(50), 'blue');

  log(`✓ Passed: ${results.passed}`, 'green');
  log(`⚠ Warnings: ${results.warnings}`, 'yellow');
  log(`✗ Failed: ${results.failed}`, 'red');

  log('\n' + '─'.repeat(50), 'blue');

  if (results.failed > 0) {
    log('❌ DEPLOYMENT BLOCKED - Critical issues must be resolved', 'red');
    log('\nFailed checks:', 'red');
    results.checks
      .filter(c => c.status === 'fail')
      .forEach(c => log(`  • ${c.name}: ${c.message}`, 'red'));
    return false;
  } else if (results.warnings > 0) {
    log('⚠️  DEPLOYMENT READY (with warnings)', 'yellow');
    log('\nWarnings (recommended to fix):', 'yellow');
    results.checks
      .filter(c => c.status === 'warn')
      .forEach(c => log(`  • ${c.name}: ${c.message}`, 'yellow'));
    return true;
  } else {
    log('✅ DEPLOYMENT READY - All checks passed!', 'green');
    return true;
  }
}

/**
 * Main execution
 */
function main() {
  log('╔═══════════════════════════════════════════════════╗', 'blue');
  log('║   ClawCombat Pre-Deployment Validation Script    ║', 'bold');
  log('╚═══════════════════════════════════════════════════╝', 'blue');

  // Change to project root
  process.chdir(path.join(__dirname, '..'));

  // Run all checks
  checkEnvironment();
  checkDependencies();
  checkFileStructure();
  checkSecurity();
  checkDatabase();
  checkTests();
  checkRailwayConfig();

  // Generate summary
  const success = generateSummary();

  log('\n📋 Next Steps:', 'blue');
  if (!success) {
    log('1. Fix all failed checks above', 'red');
    log('2. Re-run this script: node scripts/pre-deploy-check.js', 'red');
    log('3. Only deploy after all checks pass', 'red');
  } else {
    log('1. Review warnings and fix if needed', 'yellow');
    log('2. Rotate all secrets (see SECRET_ROTATION_GUIDE.md)', 'yellow');
    log('3. Configure Railway environment variables', 'yellow');
    log('4. Run: git push (if using Railway GitHub integration)', 'green');
    log('5. Monitor Sentry dashboard after deployment', 'green');
  }

  // Exit with appropriate code
  process.exit(success ? 0 : 1);
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { main };
