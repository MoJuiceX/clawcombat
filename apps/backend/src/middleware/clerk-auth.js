const log = require('../utils/logger').createLogger('CLERK_AUTH');
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const CLERK_JWT_KEY = process.env.CLERK_JWT_KEY;

async function authenticateHuman(req, res, next) {
  // Dev mode fallback: if no Clerk keys configured, accept human_id from body/query
  // SECURITY: Only allowed when NODE_ENV is explicitly 'development'
  if (!CLERK_SECRET_KEY && !CLERK_JWT_KEY) {
    if (process.env.NODE_ENV !== 'development') {
      // Block dev bypass in production, staging, test, or any undefined NODE_ENV
      log.error('CRITICAL: Clerk keys not configured in non-development environment');
      return res.status(503).json({ error: 'Authentication not configured' });
    }
    const humanId = req.body.human_id || req.query.human_id;
    if (!humanId || !humanId.trim()) {
      return res.status(401).json({ error: 'human_id is required (Clerk not configured)' });
    }
    // Log dev bypass usage for audit trail
    log.warn('DEV MODE: Bypassing auth', { humanId: humanId.trim().slice(0, 8) });
    req.human = { id: humanId.trim() };
    return next();
  }

  // Production: verify Clerk session token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header. Sign in with Clerk first.' });
  }

  const token = authHeader.slice(7);

  try {
    const { verifyToken } = require('@clerk/backend');
    const opts = {};
    if (CLERK_JWT_KEY) opts.jwtKey = CLERK_JWT_KEY;
    if (CLERK_SECRET_KEY) opts.secretKey = CLERK_SECRET_KEY;

    const verified = await verifyToken(token, opts);
    req.human = { id: verified.sub };
    next();
  } catch (err) {
    // GRACEFUL DEGRADATION: Differentiate between invalid token and service errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.message?.includes('fetch')) {
      log.error('Clerk service unavailable', { error: err.message });
      return res.status(503).json({
        error: 'Authentication service temporarily unavailable',
        code: 'AUTH_SERVICE_UNAVAILABLE'
      });
    }
    return res.status(401).json({ error: 'Invalid or expired session token', code: 'AUTH_FAILED' });
  }
}

// Optional version: extracts user if token present, but doesn't 401 if missing
async function optionalHumanAuth(req, res, next) {
  const authHeader = req.headers['x-clerk-token'] || '';
  const bearerHeader = req.headers.authorization || '';

  // Check for Clerk token in X-Clerk-Token header or Authorization header
  let token = '';
  if (authHeader) {
    token = authHeader;
  } else if (bearerHeader.startsWith('Bearer ') && !bearerHeader.slice(7).startsWith('clw_sk_')) {
    // Only use Bearer if it's not an agent API key
    token = bearerHeader.slice(7);
  }

  if (!token) {
    req.human = null;
    return next();
  }

  if (!CLERK_SECRET_KEY && !CLERK_JWT_KEY) {
    if (process.env.NODE_ENV === 'production') {
      req.human = null;
      return next();
    }
    // Dev mode: accept raw user ID
    req.human = { id: token };
    return next();
  }

  try {
    const { verifyToken } = require('@clerk/backend');
    const opts = {};
    if (CLERK_JWT_KEY) opts.jwtKey = CLERK_JWT_KEY;
    if (CLERK_SECRET_KEY) opts.secretKey = CLERK_SECRET_KEY;

    const verified = await verifyToken(token, opts);
    req.human = { id: verified.sub };
    next();
  } catch (err) {
    req.human = null;
    next();
  }
}

module.exports = { authenticateHuman, optionalHumanAuth };
