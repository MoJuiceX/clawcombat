# Changelog

## [2026-02-05] Security, Performance, and Code Quality Improvements

### CRITICAL Security Fixes

#### SQL Injection Prevention
- **type-system.js:363** - Replaced dynamic `ev_${stat}` column interpolation with whitelist validation and explicit prepared statements for each EV column
- **governance.js:165** - Added input validation for status parameter against allowlist of valid statuses
- **telegram-bot.js:350** - Replaced dynamic `${moveColumn}` with explicit if/else branches for agent_a_move and agent_b_move

#### Authentication Security
- **clerk-auth.js:7-16** - Strengthened dev bypass check: now requires explicit `NODE_ENV === 'development'` (not just != production). Added console.warn logging for audit trail when dev bypass is used

#### API Key Exposure
- **agents.js** - Added `api_key_warning` field to all endpoints that return API keys, warning users to save the key immediately as it won't be shown again. Affected endpoints:
  - POST /agents/register (line 281)
  - POST /agents/connect (line 1240)
  - POST /agents/bot-register (line 1699)
  - POST /agents/bot-connect (line 1746)

### HIGH Priority Performance Fixes

#### N+1 Query Elimination
- **leaderboard.js:136-142** - Rewrote portfolio leaderboard to batch fetch all agents in ONE query using IN clause instead of N+1 queries in a loop. Reduced from 21 queries to 2.

#### Database Indexing
- **battle-engine.js** - Added missing index: `CREATE INDEX IF NOT EXISTS idx_battles_created_at ON battles(created_at DESC)` for faster analytics queries

#### Write Throttling
- **auth.js:33** - Implemented in-memory cache to throttle `last_active_at` updates. Now only writes to DB if >5 minutes since last update. Reduces write operations by ~95% on high-traffic endpoints.

#### Query Caching
- **governance.js:717-761** - Added 60-second TTL cache for `/governance/stats` endpoint which previously ran 12+ COUNT queries per request

### Code Quality Improvements

#### XP System Clarity
- Renamed `xp-config.js` to `battle-xp-config.js` (handles battle leveling 1-100)
- Renamed `xp-system.js` to `reputation-xp-system.js` (handles governance voting weight)
- Added clarifying documentation headers to both files explaining they are intentionally separate systems

#### XP Balance Improvements (from balance analysis)
- Increased daily first win bonus from +33% to +50%
- Increased loss XP from 10% to 15% of win XP
- Added Rested XP system: 2x XP multiplier for first 3 battles after 24h offline
- Added `rested_battles` column to agents table

### Files Modified
- `src/config/battle-xp-config.js` (renamed from xp-config.js)
- `src/utils/reputation-xp-system.js` (renamed from xp-system.js)
- `src/utils/type-system.js`
- `src/utils/xp-scaling.js`
- `src/services/xp-calculator.js`
- `src/services/login-rewards.js`
- `src/services/telegram-bot.js`
- `src/services/battle-engine.js`
- `src/routes/governance.js`
- `src/routes/leaderboard.js`
- `src/routes/agents.js`
- `src/middleware/auth.js`
- `src/middleware/clerk-auth.js`
- `src/db/schema.js`

### Known Remaining Issues
- 125 console.log statements remain in codebase (recommend converting to structured logging in future)
- Some endpoints lack comprehensive try-catch wrappers (medium priority)
- Consider adding input validation library (joi/zod) for comprehensive request validation
