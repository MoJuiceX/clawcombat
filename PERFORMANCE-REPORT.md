# ClawCombat Backend Performance Report

Generated: 2026-02-06
Analyzed Path: ~/ClawCombat/apps/backend/

---

## Executive Summary

The ClawCombat backend is a Node.js/Express.js application using better-sqlite3 for data persistence. The codebase demonstrates several good practices, including WAL mode for SQLite and comprehensive indexing on key tables. However, significant performance optimization opportunities exist across database queries, API endpoints, memory management, frontend particle systems, and caching strategies.

**Critical findings include:**
- **N+1 query patterns** in multiple automation and governance routes, where database queries are executed inside loops
- **Missing database optimizations**: SQLite synchronous mode and memory mapping are not configured for maximum performance
- **Canvas particle system inefficiencies**: Object creation in animation loops, lack of object pooling, and potential for memory accumulation
- **Unbounded setInterval timers** in cleanup routines that never clear their references
- **No caching layer** for frequently-accessed static data like leaderboard, agent stats, and move definitions
- **CSS animation performance concerns**: Multiple complex animations with continuous `filter` and `box-shadow` animations that trigger compositing

**Overall Severity Assessment:** Medium-High. While the application will function correctly, these issues will cause performance degradation under load, especially during peak battle activity with many concurrent users.

---

## Critical Issues (Immediate Action Required)

### 1. N+1 Query Patterns in Loops

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/services/automation.js:65-68`

```javascript
for (const pid of proposalIds) {
  const total = db.prepare(
    'SELECT COALESCE(SUM(vote), 0) as total FROM human_votes WHERE voting_window_id = ? AND proposal_id = ?'
  ).get(window.id, pid).total;
```

**Impact:** 3 separate database queries when a single query could suffice.

**Fix:**
```javascript
const totals = db.prepare(`
  SELECT proposal_id, COALESCE(SUM(vote), 0) as total
  FROM human_votes
  WHERE voting_window_id = ? AND proposal_id IN (?, ?, ?)
  GROUP BY proposal_id
`).all(window.id, ...proposalIds);
```

---

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/services/moltbook-monitor.js:38-43`

```javascript
for (const post of posts) {
  const existing = this.db.prepare(`
    SELECT id FROM moltbook_discovered_posts WHERE moltbook_post_id = ?
  `).get(post.id);
```

**Impact:** N queries for N posts when batch checking could be done with a single IN clause.

**Fix:** Batch check all post IDs at once:
```javascript
const existingIds = new Set(
  db.prepare(`
    SELECT moltbook_post_id FROM moltbook_discovered_posts
    WHERE moltbook_post_id IN (${posts.map(() => '?').join(',')})
  `).all(...posts.map(p => p.id)).map(r => r.moltbook_post_id)
);
```

---

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/routes/governance.js:629-630`

```javascript
for (const item of buildItems) {
  const proposal = db.prepare('SELECT * FROM governance_human_proposals WHERE id = ?').get(item.proposal_id);
```

**Impact:** One query per build item.

**Fix:** Fetch all proposals in a single query using IN clause.

---

### 2. Missing SQLite Performance Pragmas

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/db/schema.js:19-20`

Current configuration:
```javascript
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
```

**Missing optimizations:**
```javascript
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');  // Safe with WAL, faster than FULL
db.pragma('temp_store = MEMORY');   // Keep temp tables in memory
db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O
db.pragma('cache_size = -64000');   // 64MB page cache
db.pragma('busy_timeout = 5000');   // 5s wait on locked DB
```

**Impact:** These pragmas can improve query performance by 20-50% according to SQLite performance tuning benchmarks.

---

### 3. Canvas Particle System Memory Issues

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/public/js/battle-particles.js:359-402`

The particle system creates new objects for every particle spawn:
```javascript
function Particle(x, y, config) {
  config = config || {};
  this.x = x;
  this.y = y;
  // ... creates new object every time
}
```

**Issues:**
1. **No object pooling**: New Particle objects created constantly, causing GC pressure
2. **Array filtering every frame** (line 1263): `particles = particles.filter(...)` creates a new array each frame
3. **setTimeout inside spawn functions** (line 847): Creates closures that capture variables

**Impact:** On mobile devices and during long battles, this causes frame drops and memory accumulation.

**Fix:** Implement object pooling:
```javascript
var particlePool = [];
var POOL_SIZE = 500;

function getParticle() {
  return particlePool.pop() || new Particle(0, 0, {});
}

function releaseParticle(p) {
  if (particlePool.length < POOL_SIZE) {
    particlePool.push(p);
  }
}

// In animation loop, instead of filter:
var writeIdx = 0;
for (var i = 0; i < particles.length; i++) {
  if (particles[i].life > 0) {
    particles[writeIdx++] = particles[i];
  } else {
    releaseParticle(particles[i]);
  }
}
particles.length = writeIdx;
```

---

## High Priority Recommendations

### 4. Unbounded setInterval Timers Without Cleanup

**Locations:**
- `/Users/abit_hex/ClawCombat/apps/backend/src/services/automation.js:441`
- `/Users/abit_hex/ClawCombat/apps/backend/src/routes/demo.js:21`
- `/Users/abit_hex/ClawCombat/apps/backend/src/middleware/admin-auth.js:17`
- `/Users/abit_hex/ClawCombat/apps/backend/src/routes/events.js:38`

These intervals run indefinitely and are never cleared, even if the server is shutting down gracefully.

**Fix:** Store interval references and clear them on SIGTERM/SIGINT:
```javascript
const intervals = [];
intervals.push(setInterval(() => { /* ... */ }, 10000));

process.on('SIGTERM', () => {
  intervals.forEach(clearInterval);
  process.exit(0);
});
```

---

### 5. CSS Animations Causing Paint/Composite Overhead

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/public/css/arena.css`

Several animations use expensive properties:

**Line 289-297:** `.frame-glow` animates `filter: blur()` continuously:
```css
@keyframes frameGlow {
  0%, 100% { opacity: 0.25; filter: blur(8px); }
  50% { opacity: 0.45; filter: blur(12px); }
}
```

**Line 324-331:** `.frame-border-inner` animates `box-shadow` continuously:
```css
@keyframes innerPulse {
  0%, 100% { box-shadow: inset 0 0 15px ...; }
  50% { box-shadow: inset 0 0 20px ...; }
}
```

**Issue:** `filter` and `box-shadow` animations trigger paint operations on every frame, causing jank on lower-end devices.

**Fix:** Use `will-change` hints and prefer `transform`/`opacity` where possible:
```css
.frame-glow {
  will-change: opacity;
  /* Consider using a static blur and animating only opacity */
}
```

For status icons (lines 768-854), each has a unique animation running continuously even when not visible.

**Recommendation:** Only animate status icons when they first appear, or use CSS `animation-play-state` to pause when not in viewport.

---

### 6. Battle Webhook Payload Excessive Database Queries

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/services/battle-engine.js:1188-1400`

The `buildTurnPayload` function executes **11+ separate database queries** when a battle ends:
- Lines 1205-1210: Query battle history
- Lines 1223-1229: Query last match
- Lines 1239-1265: Multiple queries for agent stats, rank, recent battles
- Lines 1270-1278: Query opponent rank
- Lines 1337-1398: Social feed queries (3 more queries)

**Impact:** Every battle end triggers 11+ queries in sequence, slowing down battle resolution.

**Fix:** Combine into fewer queries or cache frequently-accessed data:
1. Pre-compute ranks in the leaderboard table (already exists but underutilized)
2. Cache recent battles data with a short TTL
3. Use a single CTE query to fetch agent stats and rank together

---

### 7. No Compression Middleware

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/index.js`

The Express app does not use gzip compression.

**Fix:** Add compression middleware:
```javascript
const compression = require('compression');
app.use(compression());
```

**Impact:** Reduces response payload sizes by 60-80% for JSON and HTML content.

---

## Medium Priority Recommendations

### 8. Leaderboard Computed on Every Request

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/routes/leaderboard.js`

Each leaderboard request queries the agents table directly with complex sorting.

**Recommendation:**
- Cache leaderboard results for 60 seconds
- Use the existing `leaderboard` table which is updated via cron

```javascript
const leaderboardCache = { data: null, expires: 0 };

router.get('/', (req, res) => {
  if (Date.now() < leaderboardCache.expires) {
    return res.json(leaderboardCache.data);
  }
  // ... fetch and cache for 60s
});
```

---

### 9. Move Definitions Loaded Repeatedly

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/data/moves.js` is `require()`d in multiple files.

While Node.js caches requires, the `getMoveById()` and `getMovesForType()` functions could benefit from memoization since move data never changes at runtime.

---

### 10. Frontend: requestAnimationFrame Not Cancelled on Page Unload

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/public/js/battle-particles.js:1272`

```javascript
if (particles.length > 0) animationId = requestAnimationFrame(animateParticles);
else animationId = null;
```

The animation frame request is stored but never cancelled when navigating away.

**Fix:** Add visibility and unload handlers:
```javascript
document.addEventListener('visibilitychange', function() {
  if (document.hidden && animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
});
```

---

### 11. Missing Index for Combined Battle Queries

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/services/battle-engine.js:1576-1578`

```javascript
const activeBattle = db.prepare(`
  SELECT * FROM battles WHERE (agent_a_id = ? OR agent_b_id = ?) AND status IN ('active', 'pending')
`).get(agentId, agentId);
```

While individual indexes exist on `agent_a_id`, `agent_b_id`, and `status`, a composite index would be more efficient.

**Fix:** Add covering index:
```sql
CREATE INDEX IF NOT EXISTS idx_battles_active_agents
ON battles(status, agent_a_id, agent_b_id)
WHERE status IN ('active', 'pending');
```

---

### 12. Type Chart Loaded from JSON on Every Battle

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/services/battle-engine.js:56`

```javascript
const TYPE_CHART = require('../data/pokeapi-type-chart.json');
```

This is fine due to Node.js caching, but the `getTypeEffectiveness` function (line 229) does redundant null checks every call.

**Recommendation:** Pre-validate the chart at startup:
```javascript
// At module load, validate all type combinations exist
for (const t1 of TYPES) {
  for (const t2 of TYPES) {
    if (TYPE_CHART[t1]?.[t2] === undefined) {
      throw new Error(`Missing type chart entry: ${t1} vs ${t2}`);
    }
  }
}
```

---

## Low Priority / Future Considerations

### 13. Battle History Stored as Full JSON

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/services/battle-engine.js:1528`

```javascript
state_json = ?,
```

The entire battle state is stored as JSON, which grows with each turn. For long battles (100 turns), this can be several hundred KB.

**Consideration:** Store only essential state and derive turn history from `battle_turns` table.

---

### 14. CSS Scanlines Pattern Could Use GPU Layer

**Location:** `/Users/abit_hex/ClawCombat/apps/backend/src/public/css/arena.css:126-132`

```css
.arena-scanlines {
  background: repeating-linear-gradient(...);
  pointer-events: none;
  z-index: 4;
}
```

**Recommendation:** Add `transform: translateZ(0)` or `will-change: transform` to promote to its own compositor layer, preventing repaint of underlying content.

---

### 15. Consider HTTP/2 for Multiplexing

The application serves multiple static assets. Enabling HTTP/2 via Nginx reverse proxy would allow concurrent asset loading over a single connection.

---

### 16. Bundle Analysis

**Current Dependencies (production):**
```json
{
  "@clerk/backend": "^2.29.7",
  "axios": "^1.13.4",
  "better-sqlite3": "^12.6.2",
  "dotenv": "^17.2.3",
  "express": "^4.22.1",
  "express-rate-limit": "^8.2.1",
  "node-cron": "^4.2.1",
  "stripe": "^20.3.0",
  "uuid": "^13.0.0"
}
```

**Observations:**
- Dependencies are reasonable for the functionality
- `axios` (used for webhooks) could be replaced with native `fetch` in Node.js 22+ to reduce bundle
- `uuid` can be replaced with `crypto.randomUUID()` (already done in some places but not consistently)

---

## Detailed Findings

### 1. Database Query Analysis

#### N+1 Query Problems

| File | Line | Description | Impact |
|------|------|-------------|--------|
| `automation.js` | 65-68 | Loop queries for proposal votes | 3 queries instead of 1 |
| `moltbook-monitor.js` | 38-43 | Loop check for existing posts | N queries for N posts |
| `governance.js` | 629-630 | Loop fetch for proposals | N queries for N items |
| `automation.js` | 137-140 | Loop update for agents | Could use batch UPDATE |
| `battle-engine.js` | 1205-1265 | Battle end webhook queries | 11+ sequential queries |

#### Missing Indexes

The schema has good index coverage, but these additions would help:

```sql
-- Composite index for active battle lookup
CREATE INDEX idx_battles_active_lookup ON battles(status, agent_a_id, agent_b_id)
WHERE status IN ('active', 'pending');

-- Covering index for leaderboard queries
CREATE INDEX idx_agents_leaderboard ON agents(status, level DESC, elo DESC)
WHERE status = 'active';

-- Social feed hot posts query
CREATE INDEX idx_social_posts_hot ON social_posts(created_at, likes_count)
WHERE parent_id IS NULL AND expires_at > datetime('now');
```

#### Other Query Issues

1. **`MAX(battle_number)` on every battle creation** (`battle-engine.js:1495`): Consider using a sequence table or AUTOINCREMENT
2. **Uncached COUNT queries** in analytics routes: Cache with 5-minute TTL

---

### 2. API Endpoint Performance

| Endpoint Pattern | Issue | Severity |
|-----------------|-------|----------|
| `/api/battles/:id/replay` | Loads all turns, parses JSON for each | Medium |
| `/api/leaderboard` | No caching, sorts on every request | Medium |
| `/api/governance/stats` | 12 separate COUNT queries | High |
| `/api/social/feed/*` | Complex JOINs without LIMIT optimization | Medium |
| Webhook payloads | 11+ queries per battle end | High |

---

### 3. Memory Usage Patterns

| Location | Pattern | Risk |
|----------|---------|------|
| `battle-particles.js` | No object pooling | GC pressure, frame drops |
| `automation.js` setInterval | Never cleared | Minor leak on server restart |
| `demo.js` session storage | Cleaned every minute | OK |
| `battle-engine.js` state_json | Large JSON blobs in memory | OK for normal load |

---

### 4. Caching Opportunities

| Data | Access Pattern | Recommendation |
|------|---------------|----------------|
| Leaderboard | Every page load | Cache 60s |
| Type chart | Every damage calc | Already cached via require |
| Move definitions | Every battle | Consider Map for O(1) lookup |
| Agent stats (for webhooks) | Every battle end | Cache 30s per agent |
| Governance stats | Dashboard views | Cache 5 minutes |

---

### 5. Bundle/Dependency Analysis

**Frontend Assets:**
- `battle-particles.js`: 1287 lines - Could split pattern functions
- `battle-ui.js`: 495 lines - OK
- `arena.css`: 1775 lines - Consider splitting responsive styles

**No minification detected** for frontend JS files. Consider build step with esbuild or terser.

---

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 hours)

1. Add SQLite performance pragmas to `schema.js`
2. Add compression middleware to Express
3. Add `will-change` hints to CSS animations
4. Cancel animation frame on visibility change

**Estimated Impact:** 15-25% improvement in perceived performance

### Phase 2: Query Optimization (4-6 hours)

1. Fix N+1 queries in automation.js, governance.js, moltbook-monitor.js
2. Add composite indexes for common query patterns
3. Implement leaderboard caching

**Estimated Impact:** 30-50% reduction in database load

### Phase 3: Frontend Optimization (6-8 hours)

1. Implement particle object pooling
2. Optimize in-place array update in animation loop
3. Add IntersectionObserver to pause animations when not visible
4. Minify and bundle frontend assets

**Estimated Impact:** 60fps consistency on mobile, reduced memory usage

### Phase 4: Architecture Improvements (1-2 days)

1. Refactor battle end webhook to use cached/precomputed data
2. Add Redis or in-memory cache layer for hot data
3. Implement proper graceful shutdown with interval cleanup
4. Consider database connection pooling for high load

**Estimated Impact:** Scalability to 10x current load

---

## Research References

### Express.js & Node.js Performance
- [Express.js Performance Best Practices](https://expressjs.com/en/advanced/best-practice-performance.html)
- [ExpressJS Performance Optimization: Top Best Practices to Consider in 2025](https://dev.to/dhruvil_joshi14/expressjs-performance-optimization-top-best-practices-to-consider-in-2025-2k6k)
- [Boost Your Apps: Top Node.js Performance Best Practices for 2025](https://dev.to/satyam_gupta_0d1ff2152dcc/boost-your-apps-top-nodejs-performance-best-practices-for-2025-3cco)
- [Express.js Best Practices for Performance in Production](https://sematext.com/blog/expressjs-best-practices/)

### SQLite Optimization
- [SQLite Performance Tuning - phiresky's blog](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [SQLite Optimizations For Ultra High-Performance - PowerSync](https://www.powersync.com/blog/sqlite-optimizations-for-ultra-high-performance)
- [better-sqlite3 Performance Documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)

### Canvas & Animation Performance
- [Optimizing Canvas - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [requestAnimationFrame - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [JavaScript Particles Background: Complete 2026 Guide](https://copyprogramming.com/howto/javascript-particles-background-js-code-example)

---

## Appendix: Code Snippets

### A. Optimized SQLite Configuration

```javascript
// /Users/abit_hex/ClawCombat/apps/backend/src/db/schema.js
function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);

    // Performance optimizations
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 268435456');
    db.pragma('cache_size = -64000');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
  }
  return db;
}
```

### B. Particle Object Pool Implementation

```javascript
// battle-particles.js - Object pooling pattern
var particlePool = [];
var POOL_SIZE = 500;

function Particle() {
  this.reset(0, 0, {});
}

Particle.prototype.reset = function(x, y, config) {
  config = config || {};
  this.x = x;
  this.y = y;
  this.startX = x;
  this.startY = y;
  this.life = config.life || 1;
  this.maxLife = this.life;
  this.size = config.size || 5;
  // ... rest of properties
  return this;
};

function acquireParticle(x, y, config) {
  var p = particlePool.length > 0 ? particlePool.pop() : new Particle();
  return p.reset(x, y, config);
}

function releaseParticle(p) {
  if (particlePool.length < POOL_SIZE) {
    particlePool.push(p);
  }
}

// Optimized animation loop without array allocation
function animateParticles() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // In-place compaction instead of filter
  var writeIdx = 0;
  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    if (p.life > 0) {
      p.update();
      p.draw(ctx);
      particles[writeIdx++] = p;
    } else {
      releaseParticle(p);
    }
  }
  particles.length = writeIdx;

  if (particles.length > 0) {
    animationId = requestAnimationFrame(animateParticles);
  } else {
    animationId = null;
  }
}
```

### C. Batch Query Example

```javascript
// Before: N+1 in automation.js
for (const pid of proposalIds) {
  const total = db.prepare(
    'SELECT COALESCE(SUM(vote), 0) as total FROM human_votes WHERE voting_window_id = ? AND proposal_id = ?'
  ).get(window.id, pid).total;
}

// After: Single query with IN clause
const placeholders = proposalIds.map(() => '?').join(',');
const voteTotals = db.prepare(`
  SELECT proposal_id, COALESCE(SUM(vote), 0) as total
  FROM human_votes
  WHERE voting_window_id = ?
  AND proposal_id IN (${placeholders})
  GROUP BY proposal_id
`).all(window.id, ...proposalIds);

const totalsMap = Object.fromEntries(
  voteTotals.map(r => [r.proposal_id, r.total])
);
```

### D. Simple In-Memory Cache

```javascript
// Generic cache helper
function createCache(ttlMs) {
  const cache = new Map();

  return {
    get(key) {
      const entry = cache.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expires) {
        cache.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      cache.set(key, { value, expires: Date.now() + ttlMs });
    },
    clear() {
      cache.clear();
    }
  };
}

// Usage for leaderboard
const leaderboardCache = createCache(60000); // 1 minute

router.get('/', (req, res) => {
  const cacheKey = `${req.query.type || 'all'}_${req.query.page || 1}`;
  const cached = leaderboardCache.get(cacheKey);
  if (cached) return res.json(cached);

  // ... fetch from DB
  leaderboardCache.set(cacheKey, result);
  res.json(result);
});
```

---

*Report generated by Claude Code performance analysis. Recommendations are based on static code analysis and industry best practices. Actual performance impact should be measured with profiling tools after implementation.*
