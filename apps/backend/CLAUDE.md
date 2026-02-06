# Backend Service

Express.js API server with SQLite database for ClawCombat - an AI agent battle game.

## Quick Stats
- **17 route files** (~8,000 lines, 130+ endpoints)
- **17 service files** (business logic)
- **8 utility files** (pure functions)
- **42 database tables**, 80+ indexes
- **110 Jest tests** (unit + integration)

## Architecture
```
src/
├── routes/      # 17 files - API endpoints (one per resource)
├── services/    # 17 files - Business logic, caching
├── utils/       # 8 files - Pure utility functions
├── data/        # Static data (191 moves, types, natures)
├── middleware/  # Auth (agent, admin, clerk), rate limiting
├── db/          # Schema, migrations (42 tables)
├── config/      # XP brackets, stat scaling
└── __tests__/   # Jest tests (*.spec.js = unit, *.test.js = integration)
```

## Database
- SQLite with better-sqlite3 (synchronous API)
- Schema in `src/db/schema.js` (42 tables)
- **WAL mode** enabled for concurrent writes
- **Foreign keys ON** for referential integrity
- Always use prepared statements
- Whitelist column names (prevent SQL injection)

## Authentication (3 methods)

| Method | Middleware | Header | Use Case |
|--------|------------|--------|----------|
| Agent API Key | `agentAuth` | `Bearer clw_sk_*` | Bot actions |
| Admin Secret | `adminAuth` | `X-Admin-Secret` | Admin endpoints |
| Clerk Session | `clerkAuth` | Cookie/JWT | Web UI |

## Response Format
```javascript
// Success
res.json({ data: result });

// Error
res.status(400).json({ error: "Description" });

// Paginated
res.json({ data: [...], pagination: { page, limit, total } });
```

## Caching Strategy (8 caches)

| Cache | TTL | Location | Purpose |
|-------|-----|----------|---------|
| `agentCache` | 30s | agent-cache.js | Profile lookups |
| `leaderboardCache` | 30s | leaderboard.js | Ranking queries |
| `lastActiveCache` | 5min | auth.js | Throttle DB writes |
| `governanceStatsCache` | 60s | governance.js | Voting stats |
| `eventCounts` | 60s | events.js | Rate limiting |
| `failedAttempts` | 15min | admin-auth.js | Brute force protection |
| `demoSessions` | 30min | demo.js | Anonymous demos |
| `semanticCache` | 24h | semantic-cache.js | Future AI responses |

See `src/utils/cache.js` for TTLCache utility.

## Performance Rules
1. Pre-compute matrices at module load (see TYPE_CHART)
2. Use O(1) lookups over O(n) array searches
3. Cache expensive calculations (leaderboard, stats)
4. Batch database updates where possible
5. Use composite indexes for multi-column WHERE

## Large File Handling

**If ANY file exceeds the 25k token limit, read it in chunks:**

```javascript
// Read large files in 500-line chunks
Read(file, { offset: 0, limit: 500 });     // Lines 1-500
Read(file, { offset: 500, limit: 500 });   // Lines 501-1000
Read(file, { offset: 1000, limit: 500 });  // Lines 1001-1500
// Continue until file is fully read

// Or use Grep to find specific functions/patterns
Grep("functionName", "path/to/file.js");
```

**Known large files in this project:**
- `services/battle-engine.js` (~1400 lines) - 3 chunks
- `routes/agents.js` (~1900 lines) - 4 chunks
- `db/schema.js` (~800 lines) - 2 chunks
- `index.js` (~900 lines) - 2 chunks

## Key Gotchas
- **mapDbAgent():** Always call before passing DB agent to battle engine
- **N+1 queries:** Batch-fetch related records
- **Status constraints:** Triggers enforce valid status values
- **Legacy move IDs:** Use `getMoveById()` (handles both formats)
- **Level 1→2:** XP requirement is 0 (forced level-up on first win)

## Commands
```bash
npm run dev       # Start with nodemon
npm test          # Run all 110 tests
npm test battle   # Run tests matching "battle"
```
