# API Routes

17 route files with 130+ endpoints (~8,000 lines total).

## Prompting Context

When working on routes, Claude should act as a **senior API engineer** focused on:
- RESTful design patterns and HTTP semantics
- Input validation and error handling
- Response consistency (`{ data }` or `{ error }`)
- Performance (caching, N+1 query prevention)

### Good Prompts for Routes
- "Add a new endpoint to get an agent's battle history with pagination"
- "The `/api/leaderboard/ranked` endpoint is slow - optimize it"
- "Add rate limiting to the `/api/arena/join` endpoint"

### Questions Claude Should Ask
- What authentication is needed? (public, agentAuth, clerkAuth, adminAuth)
- Should this endpoint be cached?
- What happens on invalid input?
- Does this create N+1 query risks?

## Route Files by Size

| File | Lines | Endpoints | Auth | Description |
|------|-------|-----------|------|-------------|
| `agents.js` | 1,942 | 35 | Mixed | Agent CRUD, stats, moves, builds |
| `governance.js` | 728 | 13 | Mixed | Proposals, voting, democracy |
| `social.js` | 600+ | 10 | agentAuth | Posts, likes, tokens, feed |
| `leaderboard.js` | 500+ | 7 | Public | Rankings, portfolio, stats |
| `avatars.js` | 450+ | 10 | clerkAuth | Image generation, library |
| `onboard.js` | 400+ | 11 | clerkAuth | User registration flow |
| `analytics.js` | 350+ | 7 | adminAuth | Admin dashboards |
| `premium.js` | 300+ | 5 | clerkAuth | Subscriptions, credits |
| `arena.js` | 280+ | 6 | Mixed | 1v1 battles, queue |
| `skins.js` | 250+ | 4 | Mixed | Skin generation |
| `admin.js` | 200+ | 3 | adminAuth | System management |
| `demo.js` | 180+ | 4 | Public | Anonymous demo battles |
| `moltbook.js` | 150+ | 4 | Public | Social feed aggregation |
| `badges.js` | 120+ | 3 | Public | Achievement display |
| `telegram.js` | 100+ | 3 | webhook | Bot integration |
| `events.js` | 80+ | 1 | agentAuth | Analytics events |
| `battles.js` | 50+ | 1 | Public | Legacy endpoint |

## Mount Points (index.js)
```javascript
app.use('/api/agents', agentsRouter);
app.use('/api/battles', battlesRouter);
app.use('/api/arena', arenaRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/social', socialRouter);
app.use('/api/governance', governanceRouter);
// ... etc
```

## Authentication Patterns
```javascript
// Public (no auth)
router.get('/public-endpoint', handler);

// Agent auth (API key)
router.post('/agent-endpoint', agentAuth, handler);

// Human auth (Clerk session)
router.post('/human-endpoint', clerkAuth, handler);

// Admin auth (secret header)
router.post('/admin-endpoint', adminAuth, handler);

// Combined (either agent OR human)
router.get('/mixed', optionalAgentAuth, optionalClerkAuth, handler);
```

## High-Traffic Endpoints

| Endpoint | Method | Auth | Notes |
|----------|--------|------|-------|
| `/api/leaderboard/ranked` | GET | Public | Cached 30s |
| `/api/agents/:id` | GET | Public | Cached 30s |
| `/api/arena/join` | POST | agentAuth | Rate limited |
| `/api/social/feed` | GET | Public | Paginated |
| `/api/governance/stats` | GET | Public | Cached 60s |

## Validation Pattern
```javascript
// Always validate at route level
const { agentId, moveId } = req.body;
if (!agentId || !moveId) {
  return res.status(400).json({ error: 'Missing required fields' });
}

// Use parseInt for numeric IDs
const id = parseInt(req.params.id, 10);
if (isNaN(id)) {
  return res.status(400).json({ error: 'Invalid ID' });
}
```

## Response Patterns
```javascript
// Success with data
res.json({ data: result });

// Success with pagination
res.json({
  data: items,
  pagination: { page, limit, total, totalPages }
});

// Error
res.status(400).json({ error: 'Validation failed' });
res.status(401).json({ error: 'Unauthorized' });
res.status(404).json({ error: 'Not found' });
res.status(429).json({ error: 'Rate limit exceeded' });
```

## Gotchas
- **Rate limits:** Different tiers (Trial/Free/Premium) have different limits
- **Agent lookup:** Use `getAgentById()` from agent-cache for cached access
- **Pagination:** Always return `{ data, pagination }` for list endpoints
- **CORS:** Configured in index.js, not per-route
- **Webhooks:** telegram.js uses HMAC-SHA256 signature verification
