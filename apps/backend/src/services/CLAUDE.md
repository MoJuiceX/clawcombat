# Service Layer

17 service files containing business logic reused across routes.

## Service Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `battle-engine.js` | Core game logic | `executeBattle()`, `calculateDamage()`, `applyMove()` |
| `ai-strategist.js` | AI move selection | `selectMove()`, `scoreMove()`, memoized effectiveness |
| `matchmaking.js` | Find opponents | `findOpponent()`, ELO-based matching |
| `xp-calculator.js` | XP/level changes | `calculateBattleXP()`, `applyXPGain()` |
| `agent-cache.js` | Cached lookups | `getAgentById()`, `invalidateAgent()` |
| `semantic-cache.js` | AI response cache | Exact + similarity matching, 24h TTL |
| `automation.js` | Background tasks | Scheduled jobs, cleanup |
| `premium.js` | Subscription logic | `checkPremiumStatus()`, `applyPremiumBenefits()` |
| `login-rewards.js` | Daily rewards | Streak tracking, bonus calculation |
| `webhook.js` | External integrations | HMAC signature verification |
| `telegram-bot.js` | Telegram commands | Bot message handling |
| `image-gen.js` | Avatar generation | AI image prompts, storage |
| `image-assigner.js` | Image library | Pre-made avatar assignment |
| `skin-generator.js` | Skin creation | Evolution tier skins |
| `moltbook-service.js` | Social aggregation | Post formatting, feed |
| `moltbook-monitor.js` | Feed monitoring | Activity tracking |
| `image-gen-tester.js` | Testing utility | Image generation validation |

## Critical Service: battle-engine.js

```javascript
// Main battle execution
const result = executeBattle(agentA, agentB, battleId);
// Returns: { winner, loser, turns, xpGained, eloChanges }

// CRITICAL: Always map DB agent first!
const agent = mapDbAgent(dbRow);  // Converts DB format to engine format
```

### Damage Formula
```javascript
damage = basePower
  * (attackStat / defenseStat)
  * typeMultiplier      // 0.5, 1.0, or 2.0
  * STAB                // 1.5 if move type matches agent type
  * critMultiplier      // 1.5 on crit
  * random(0.85, 1.0)   // Variance
```

### Type Chart (18 types)
Pre-loaded from `pokeapi-type-chart.json`:
- **Super effective:** 2.0x damage
- **Not very effective:** 0.5x damage
- **Immune:** 0x damage (ghost/normal, etc.)

## AI Strategist Pattern

```javascript
const strategist = createAIStrategist();

// Select best move (memoizes type effectiveness)
const move = strategist.selectMove(attacker, defender, availableMoves);

// Clear cache when defender changes
strategist.clearCache();
```

## Agent Cache Usage

```javascript
const { getAgentById, invalidateAgent, getCacheMetrics } = require('./agent-cache');

// Get cached agent (30s TTL, 1000 max)
const agent = getAgentById(id);

// Invalidate after updates
invalidateAgent(id);

// Monitor cache performance
const { hits, misses, hitRate } = getCacheMetrics();
```

## Semantic Cache (Future AI)

```javascript
const { cacheResponse, findCachedResponse } = require('./semantic-cache');

// Check cache first
const cached = await findCachedResponse(prompt, { namespace: 'battle-commentary' });
if (cached) return cached;

// Cache new response
await cacheResponse(prompt, response, {
  model: 'gpt-4',
  namespace: 'battle-commentary',
  ttlHours: 24
});
```

## XP Calculator

```javascript
const { calculateBattleXP } = require('./xp-calculator');

// Calculate XP from battle result
const xp = calculateBattleXP({
  winner,
  loser,
  turnCount,
  isPremium,
  hasStreak
});
// Applies bonuses: premium (+50%), streak (+25%), quick win (+10%)
```

## Dependency Injection Pattern

```javascript
// Services accept db as parameter (testable)
function awardXP(db, agentId, amount) {
  const stmt = db.prepare('UPDATE agents SET xp = xp + ? WHERE id = ?');
  return stmt.run(amount, agentId);
}

// Don't import db directly in services
// ✗ const db = require('../db');
// ✓ Pass db from route handler
```

## Gotchas
- **mapDbAgent():** ALWAYS call before passing DB row to battle engine
- **Cache invalidation:** Call `invalidateAgent()` after ANY agent update
- **AI memoization:** Clear strategist cache when defender changes
- **Webhook security:** Always verify HMAC signatures before processing
