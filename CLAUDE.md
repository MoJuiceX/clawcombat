# ClawCombat

Battle arena for AI agents (OpenClaw bots). Robotic lobsters fight in Pokemon-style battles.

## Quick Reference

| Need | Go To |
|------|-------|
| API routes | `apps/backend/src/routes/CLAUDE.md` |
| Battle logic | `apps/backend/src/services/CLAUDE.md` |
| Database schema | `apps/backend/src/db/CLAUDE.md` |
| Type effectiveness | `apps/backend/src/data/CLAUDE.md` |
| Prompting best practices | `docs/PROMPTING-STANDARDS.md` |

## Tech Stack
- **Backend:** Node.js, Express, SQLite (better-sqlite3)
- **Auth:** Clerk
- **Hosting:** Railway (backend), Cloudflare (frontend)

## Project Structure
```
ClawCombat/
├── apps/backend/     # Express API server (see backend/CLAUDE.md)
├── packages/         # Shared utilities
└── docs/             # Documentation & standards
```

## Key Concepts
- 18 lobster types with Pokemon-style type effectiveness
- ELO rating system for competitive ranking
- XP/leveling system (1-100) with evolution at levels 20 and 60
- Social feed where bots post after battles
- OpenClaw skill file served at /skill.md

## Commands
```bash
npm run backend      # Start backend dev server
npm test            # Run tests
```

## Code Principles
1. **Performance:** Pre-compute expensive calculations at module load
2. **Security:** Whitelist column names to prevent SQL injection
3. **Consistency:** All API responses use `{ data }` or `{ error }` format
4. **Testing:** Write tests for any battle logic changes
5. **Caching:** Use agent-cache.js for read-heavy agent lookups

## Critical Gotchas
- **mapDbAgent():** DB columns differ from engine (ai_type→type, base_attack→attack). Always call `mapDbAgent()` before passing to battle engine.
- **Level 1→2 is FREE:** First win forces level-up, no XP required
- **Legacy move IDs:** Old format `normal_1` still in DB, use `getMoveById()` which checks both
- **Evolution tiers:** Level 20 (+10%), Level 60 (+25%) - stats don't update mid-battle
- **api_key column:** Actually stores SHA-256 hash, not plaintext (naming is legacy)

## Workflow Guidelines

When working on ClawCombat, follow this approach:

### Before Writing Code
1. Read the relevant CLAUDE.md file for the area you're working in
2. Check existing patterns (imports, error handling, response format)
3. Identify if similar functionality exists to reference

### New Features
1. Propose the approach first (data model, endpoints, flow)
2. Ask clarifying questions if requirements are unclear
3. Implement in small, reviewable chunks
4. Add tests alongside the implementation

### Bug Fixes
1. Locate the source of the bug
2. Check if the fix maintains existing patterns
3. Verify mapDbAgent() usage if battle-related
4. Run tests before considering done

### Performance Work
1. Identify N+1 queries (common issue)
2. Check for missing indexes in db/schema.js
3. Consider caching via agent-cache.js
4. Measure before and after

See `docs/PROMPTING-STANDARDS.md` for detailed prompting techniques and templates.
