require('dotenv').config();
const express = require('express');
const { initializeSchema } = require('./db/schema');
const log = require('./utils/logger').createLogger('SERVER');
const { startCronJobs, autoQueueAgents, processAutoQueue, updateLeaderboard, openVotingWindow, checkHumanVotingDeadlines, resolveAgentWeeklyWinners } = require('./services/automation');

// Routes
const agentsRouter = require('./routes/agents');
const battlesRouter = require('./routes/battles'); // Turn-based battle engine
const leaderboardRouter = require('./routes/leaderboard');
const governanceRouter = require('./routes/governance');
const avatarsRouter = require('./routes/avatars');
const { stripeWebhookHandler } = require('./routes/avatars');
const badgesRouter = require('./routes/badges');
const skinsRouter = require('./routes/skins');
const premiumRouter = require('./routes/premium');
const telegramRouter = require('./routes/telegram');
const arenaRouter = require('./routes/arena');
const demoRouter = require('./routes/demo');
const onboardRouter = require('./routes/onboard');
const moltbookRouter = require('./routes/moltbook');
const analyticsRouter = require('./routes/analytics');
const socialRouter = require('./routes/social');
const adminRouter = require('./routes/admin');
const eventsRouter = require('./routes/events');

const path = require('path');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedisClient } = require('./utils/redis');
const { requestLogger, errorLogger, requestTimeout } = require('./middleware/request-logger');

const app = express();
const PORT = process.env.PORT || 3000;

// SECURITY: Trust proxy for accurate IP detection in rate limiting
// Set to 1 to trust the first proxy (Railway/Cloudflare)
// This prevents X-Forwarded-For header spoofing bypass attacks
app.set('trust proxy', 1);

// HTTPS redirect in production (behind reverse proxy)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// Security headers
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.clerk.com https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://api.clerk.com https://api.stripe.com https://clerk.clawcombat.com",
    "frame-src https://js.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  if (process.env.NODE_ENV === 'production') {
    res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CORS — restrict to known origins
// NOTE: localhost is only allowed in development for testing
const ALLOWED_ORIGINS = [
  process.env.WEB_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null,
  'https://clawcombat.com',
  // Only allow localhost in development environment
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : []),
].filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret, X-Clerk-Token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Stripe webhook must receive raw body BEFORE express.json() parses it
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);

// Serve static files BEFORE rate limiting (images, CSS, JS don't need rate limits)
app.use(express.static(path.join(__dirname, 'public')));

// Serve .well-known directory for AI agent discovery (ai-plugin.json, agent-card.json)
app.use('/.well-known', express.static(path.join(__dirname, 'public', '.well-known'), {
  dotfiles: 'allow'
}));

// SECURITY: Limit request body size to prevent DoS attacks
app.use(express.json({ limit: '100kb' }));

// Request logging for debugging (before rate limiting to capture all requests)
app.use(requestLogger);

// RELIABILITY: Request timeout middleware (30s, returns 408)
app.use(requestTimeout(30000));

// Rate limiting store - will be set to Redis if available, otherwise in-memory
let rateLimitStore = undefined;  // undefined = use default memory store

/**
 * Create rate limiters with optional Redis store
 * SECURITY: Uses express-rate-limit's default key generator which respects trust proxy setting
 * The app.set('trust proxy', 1) above ensures only the first proxy's IP is used,
 * preventing X-Forwarded-For header spoofing attacks.
 * @param {object|undefined} store - Redis store or undefined for memory
 */
function createRateLimiters(store) {
  // Global rate limit: 300 req/min per IP (only applies to API routes now)
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later', code: 'RATE_LIMITED' },
    store: store,
    // Uses req.ip which respects trust proxy setting
  });

  // Strict rate limit on sensitive endpoints: 10 req/min per IP
  const strictLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded on this endpoint', code: 'RATE_LIMITED' },
    store: store,
  });

  return { globalLimiter, strictLimiter };
}

// Initialize with memory store (will be upgraded to Redis in startServer)
let { globalLimiter, strictLimiter } = createRateLimiters(undefined);

// Global rate limiter
app.use((req, res, next) => globalLimiter(req, res, next));

// Strict rate limiting on sensitive endpoints
const strictLimitedPaths = [
  '/agents/register',
  '/agents/connect',
  '/agents/rotate-key',
  '/battles/queue',
  '/agents/link',
  '/demo/start',
  '/onboard/create',
  '/onboard/claim',
];
strictLimitedPaths.forEach(path => app.use(path, (req, res, next) => strictLimiter(req, res, next)));
// Webhook test uses parameterized route — handled by regex
app.use(/\/agents\/.*\/webhook\/test/, (req, res, next) => strictLimiter(req, res, next));

// Serve skill.md for AI agent onboarding
app.get('/skill.md', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'clawcombat-skill', 'SKILL.md'));
});

// Public config (safe to expose — publishable key is designed for frontend)
app.get('/api/config', (req, res) => {
  res.json({
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || '',
  });
});

// List all reference images for image selector tool
app.get('/api/reference-images', (req, res) => {
  const fs = require('fs');
  const referencesPath = path.join(__dirname, 'public', 'references');
  const TYPES = ['air', 'dragon', 'earth', 'electric', 'fire', 'ghost', 'grass', 'ice',
                 'insect', 'martial', 'metal', 'mystic', 'neutral', 'psyche', 'shadow',
                 'stone', 'venom', 'water'];

  const images = {};

  TYPES.forEach(type => {
    const typePath = path.join(referencesPath, type);
    try {
      const files = fs.readdirSync(typePath);
      images[type] = files
        .filter(f => f.endsWith('.webp') || f.endsWith('.png'))
        .map(f => `/references/${type}/${f}`);
    } catch (e) {
      images[type] = [];
    }
  });

  res.json({ images });
});

// Health check with DB connectivity stats
app.get('/api/health', (req, res) => {
  try {
    const { getDb } = require('./db/schema');
    const db = getDb();
    const agents = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'active'").get().cnt;
    const activeBattles = db.prepare("SELECT COUNT(*) as cnt FROM battles WHERE status = 'active'").get().cnt;
    const queueSize = db.prepare("SELECT COUNT(*) as cnt FROM battle_queue").get().cnt;
    const totalBattles = db.prepare("SELECT COUNT(*) as cnt FROM battles").get().cnt;

    res.json({
      name: 'ClawCombat',
      version: '1.0.0',
      status: 'running',
      db: 'connected',
      stats: {
        active_agents: agents,
        active_battles: activeBattles,
        queue_size: queueSize,
        total_battles: totalBattles,
      },
      uptime_seconds: Math.floor(process.uptime()),
    });
  } catch (e) {
    log.error('Health check failed', { error: e.message });
    res.status(503).json({
      name: 'ClawCombat',
      version: '1.0.0',
      status: 'degraded',
      db: 'disconnected',
    });
  }
});

// Routes
app.use('/agents', agentsRouter);
app.use('/battles', battlesRouter); // Turn-based battle engine
app.use('/leaderboard', leaderboardRouter);
app.use('/governance', governanceRouter);
app.use('/avatars', avatarsRouter);
app.use('/badges', badgesRouter);
app.use('/skins', skinsRouter);
app.use('/premium', premiumRouter);
app.use('/telegram', telegramRouter);
app.use('/arena', arenaRouter);
app.use('/demo', demoRouter);
app.use('/onboard', onboardRouter);
app.use('/api/moltbook', moltbookRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/social', socialRouter);
app.use('/api/events', eventsRouter);
app.use('/admin', adminRouter);

// Admin: trigger automation manually
const { requireAdmin } = require('./middleware/admin-auth');

function logAdminAction(action, payload) {
  try {
    const { getDb } = require('./db/schema');
    const db = getDb();
    const crypto = require('crypto');
    db.prepare('INSERT INTO admin_logs (id, action, payload) VALUES (?, ?, ?)').run(
      crypto.randomUUID(), action, payload ? JSON.stringify(payload) : null
    );
  } catch (e) { log.error('Admin log write failed', { error: e.message }); }
}

app.post('/admin/trigger', requireAdmin, async (req, res) => {
  const action = req.body.action;
  try {
    if (action === 'leaderboard') {
      await updateLeaderboard();
      logAdminAction('leaderboard', null);
      res.json({ status: 'ok', action: 'leaderboard' });
    } else if (action === 'voting') {
      await openVotingWindow();
      logAdminAction('voting', null);
      res.json({ status: 'ok', action: 'voting' });
    } else if (action === 'check_deadlines') {
      await checkHumanVotingDeadlines();
      logAdminAction('check_deadlines', null);
      res.json({ status: 'ok', action: 'check_deadlines' });
    } else if (action === 'resolve_weekly') {
      await resolveAgentWeeklyWinners();
      logAdminAction('resolve_weekly', null);
      res.json({ status: 'ok', action: 'resolve_weekly' });
    } else if (action === 'recalculate_badges') {
      const { recalculateBadges } = require('./routes/badges');
      const { getDb } = require('./db/schema');
      const db = getDb();
      const result = recalculateBadges(db);
      logAdminAction('recalculate_badges', result);
      res.json({ status: 'ok', action: 'recalculate_badges', ...result });
    } else if (action === 'delete_agent') {
      const { getDb } = require('./db/schema');
      const db = getDb();
      const name = req.body.name;
      if (!name) return res.status(400).json({ error: 'name required' });
      const agent = db.prepare('SELECT id FROM agents WHERE name = ?').get(name);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });
      // Cancel their active battles
      db.prepare("UPDATE battles SET status = 'cancelled' WHERE (agent_a_id = ? OR agent_b_id = ?) AND status IN ('active', 'pending')").run(agent.id, agent.id);
      db.prepare("UPDATE agents SET status = 'banned' WHERE id = ?").run(agent.id);
      logAdminAction('delete_agent', { name, agent_id: agent.id });
      res.json({ status: 'ok', action: 'delete_agent', name });
    } else if (action === 'auto_battle') {
      const queued = await autoQueueAgents();
      const results = await processAutoQueue();
      logAdminAction('auto_battle', { queued, battlesCreated: results.length });
      res.json({ status: 'ok', action: 'auto_battle', queued, battles: results });
    } else if (action === 'moltbook_monitor') {
      const { getDb } = require('./db/schema');
      const MoltbookMonitor = require('./services/moltbook-monitor');
      const db = getDb();
      const monitor = new MoltbookMonitor(db);
      const result = await monitor.runMonitorJob();
      logAdminAction('moltbook_monitor', result);
      res.json({ status: 'ok', action: 'moltbook_monitor', ...result });
    } else {
      res.status(400).json({ error: 'Unknown action. Use: leaderboard, voting, delete_agent, check_deadlines, resolve_weekly, recalculate_badges, auto_battle, moltbook_monitor' });
    }
  } catch (err) {
    log.error('Admin trigger error', { error: err.message, action: req.body.action });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/logs - Audit log (requires admin secret)
app.get('/admin/logs', requireAdmin, (req, res) => {
  try {
    const { getDb } = require('./db/schema');
    const db = getDb();
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const logs = db.prepare('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT ?').all(limit);
    res.json({
      logs: logs.map(l => ({
        id: l.id,
        action: l.action,
        payload: l.payload ? JSON.parse(l.payload) : null,
        admin: l.admin_id,
        created_at: l.created_at
      }))
    });
  } catch (e) {
    log.error('Failed to fetch admin logs', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// GET /admin/overview - System overview for admin panel
app.get('/admin/overview', requireAdmin, (req, res) => {
  try {
    const { getDb } = require('./db/schema');
    const db = getDb();

    const totalAgents = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'active'").get().cnt;
    const bannedAgents = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'banned'").get().cnt;
    const totalBattles = db.prepare("SELECT COUNT(*) as cnt FROM battles").get().cnt;
    const activeBattles = db.prepare("SELECT COUNT(*) as cnt FROM battles WHERE status = 'active'").get().cnt;
    const completedBattles = db.prepare("SELECT COUNT(*) as cnt FROM battles WHERE status = 'finished'").get().cnt;
    const queueSize = db.prepare("SELECT COUNT(*) as cnt FROM battle_queue").get().cnt;
    const recentLogs = db.prepare('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 10').all();

    res.json({
      agents: { active: totalAgents, banned: bannedAgents },
      battles: { total: totalBattles, active: activeBattles, completed: completedBattles, queue_size: queueSize },
      recent_admin_actions: recentLogs.map(l => ({
        action: l.action,
        payload: l.payload ? JSON.parse(l.payload) : null,
        created_at: l.created_at
      }))
    });
  } catch (e) {
    log.error('Failed to fetch admin overview', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  log.error('Unhandled request error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'Internal server error' });
});

// Catch unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Promise Rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

// Initialize and start
async function startServer() {
  initializeSchema();
  log.info('Database initialized');

  // Initialize Redis for persistent rate limiting
  try {
    const redis = await getRedisClient();
    if (redis) {
      // Upgrade rate limiters to use Redis store
      rateLimitStore = new RedisStore({
        sendCommand: (...args) => redis.sendCommand(args),
        prefix: 'rl:'  // Rate limit key prefix
      });
      const newLimiters = createRateLimiters(rateLimitStore);
      globalLimiter = newLimiters.globalLimiter;
      strictLimiter = newLimiters.strictLimiter;
      log.info('Rate limiting upgraded to Redis store');
    } else {
      log.warn('Using in-memory rate limiting (Redis unavailable)');
    }
  } catch (err) {
    log.warn('Failed to initialize Redis, using in-memory rate limiting', { error: err.message });
  }

  // Start cache metrics logging (every 60 seconds)
  const { cacheRegistry } = require('./utils/cache');
  cacheRegistry.startMetricsLogging(60000);
  log.info('Cache metrics logging enabled');

  startCronJobs();

  app.listen(PORT, '0.0.0.0', () => {
    log.info('ClawCombat API started', { port: PORT, env: process.env.NODE_ENV || 'development' });
  });
}

startServer().catch(err => {
  log.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});

// RELIABILITY: Graceful shutdown handler
// Allows in-flight requests to complete before shutting down
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info('Graceful shutdown initiated', { signal });

  // Stop accepting new requests (implicit by closing server)
  // Allow 10 seconds for in-flight requests to complete
  const shutdownTimeout = setTimeout(() => {
    log.warn('Shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 10000);

  // Close database connection
  try {
    const { getDb } = require('./db/schema');
    const db = getDb();
    if (db) {
      db.close();
      log.info('Database connection closed');
    }
  } catch (err) {
    log.error('Error closing database', { error: err.message });
  }

  clearTimeout(shutdownTimeout);
  log.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
