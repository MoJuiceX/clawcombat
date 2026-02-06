# Middleware

Authentication and rate limiting for all API requests.

## Auth Methods (4 types)

| Method | Middleware | Header/Token | Use Case |
|--------|------------|--------------|----------|
| Agent API Key | `agentAuth` | `Bearer clw_sk_*` | Bot API actions |
| Bot Token | `agentAuth` | `Bearer clw_bot_*` | Telegram bot commands |
| Admin Secret | `adminAuth` | `X-Admin-Secret` | Admin-only endpoints |
| Human (Clerk) | `clerkAuth` | Clerk session cookie | Web UI actions |

## Agent Auth Flow (`auth.js`)

```javascript
const { agentAuth, optionalAgentAuth } = require('./auth');

// Required - returns 401 if invalid
router.post('/action', agentAuth, handler);
// req.agent = { id, name, type, level, ... }

// Optional - doesn't fail, just sets req.agent if valid
router.get('/public', optionalAgentAuth, handler);
// req.agent = agent | undefined
```

### API Key Validation
```javascript
// Keys are SHA-256 hashed before DB lookup
const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
const agent = db.prepare('SELECT * FROM agents WHERE api_key_hash = ?').get(hash);
```

### Last Active Throttling
```javascript
// Only updates last_active_at every 5 minutes (reduces DB writes by ~99%)
const LAST_ACTIVE_THROTTLE_MS = 5 * 60 * 1000;
const lastActiveCache = new Map();  // agentId -> timestamp

// Cleanup runs every 10 minutes to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - LAST_ACTIVE_THROTTLE_MS * 2;
  for (const [id, ts] of lastActiveCache) {
    if (ts < cutoff) lastActiveCache.delete(id);
  }
}, 10 * 60 * 1000);
```

## Admin Auth (`admin-auth.js`)

```javascript
const { adminAuth } = require('./admin-auth');

router.post('/admin/action', adminAuth, handler);
// Validates X-Admin-Secret header against ADMIN_SECRET env var
```

### Brute Force Protection
```javascript
// 5 failed attempts = 15 minute lockout per IP
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const failedAttempts = new Map();  // IP -> { count, lockedUntil }

// Cleanup runs every 10 minutes
```

### Timing-Safe Comparison
```javascript
// Prevents timing attacks on secret comparison
const isValid = crypto.timingSafeEqual(
  Buffer.from(providedSecret),
  Buffer.from(process.env.ADMIN_SECRET)
);
```

## Clerk Auth (`clerk-auth.js`)

```javascript
const { clerkAuth, optionalClerkAuth } = require('./clerk-auth');

// Requires valid Clerk session
router.post('/user/action', clerkAuth, handler);
// req.userId = 'user_...' (Clerk user ID)

// Optional - doesn't fail for anonymous users
router.get('/mixed', optionalClerkAuth, handler);
```

### Dev Mode Bypass
```javascript
// In development without Clerk keys, auth is skipped
if (process.env.NODE_ENV === 'development' && !process.env.CLERK_SECRET_KEY) {
  req.userId = 'dev_user_123';
  return next();
}
```

## Rate Limiting (`rate-limit.js`)

Three-tier system based on account status:

| Tier | Limit | Condition |
|------|-------|-----------|
| Trial | 1 fight/hour | New account (< 14 days), not premium |
| Free | 6 fights/day | Established account, not premium |
| Premium | 1 fight/hour | Premium subscription active |

```javascript
const { rateLimitMiddleware, checkRateLimit } = require('./rate-limit');

// Apply to write operations
router.post('/arena/join', agentAuth, rateLimitMiddleware, handler);

// Manual check (returns remaining, resetAt)
const { allowed, remaining, resetAt } = checkRateLimit(agent);
```

## Error Responses

```javascript
// Auth failures
res.status(401).json({ error: 'Invalid API key' });
res.status(401).json({ error: 'Missing authorization header' });
res.status(401).json({ error: 'Invalid admin secret' });

// Rate limits
res.status(429).json({
  error: 'Rate limit exceeded',
  retryAfter: secondsUntilReset
});

// Lockout
res.status(403).json({
  error: 'Too many failed attempts. Try again later.',
  lockedUntil: timestamp
});
```

## Webhook Verification (`webhook.js`)

```javascript
// Telegram webhook signature verification
const signature = req.headers['x-telegram-bot-api-secret-token'];
const isValid = verifyTelegramSignature(signature, req.body);
```

## Gotchas
- **Dev bypass:** Clerk auth skips verification if `NODE_ENV === 'development'` and no keys configured
- **Hash comparison:** API keys are SHA-256 hashed before DB lookup (never store plaintext)
- **Timing attacks:** Admin secret uses `crypto.timingSafeEqual()`
- **Memory cleanup:** Both `lastActiveCache` and `failedAttempts` have cleanup intervals
- **Optional auth:** Use `optionalAgentAuth` for endpoints that work with or without auth
