# Utilities

9 pure helper function files used across the codebase.

## Utility Files

| File | Purpose | Key Exports |
|------|---------|-------------|
| `type-system.js` | Type effectiveness | `getTypeMultiplier()`, `VALID_TYPES` (18 types) |
| `elo.js` | Rating calculations | `calculateEloChange()`, K-factor by games played |
| `cache.js` | TTL cache factory | `createTTLCache()` with metrics |
| `logger.js` | Structured logging | `log.info()`, `log.error()`, levels |
| `achievements.js` | Badge checks | `checkAchievements()`, unlock conditions |
| `natures.js` | Nature stat modifiers | `getNatureModifier()`, 25 natures |
| `xp-scaling.js` | Level-based scaling | `getStatMultiplier()`, `getEvolutionTier()` |
| `voting-window.js` | Governance timing | `getCurrentVotingWeek()`, `isVotingOpen()` |
| `reputation-xp-system.js` | Social XP | Reputation-to-XP conversion |

## Type System (18 Types)

```javascript
const { getTypeMultiplier, VALID_TYPES } = require('./type-system');

// VALID_TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice',
//                'fighting', 'poison', 'ground', 'flying', 'psychic',
//                'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy']

// O(1) lookup from pre-computed matrix
const multiplier = getTypeMultiplier('fire', 'grass');  // 2.0
const multiplier = getTypeMultiplier('fire', 'water');  // 0.5
const multiplier = getTypeMultiplier('normal', 'ghost'); // 0 (immune)
```

## ELO System

```javascript
const { calculateEloChange } = require('./elo');

// Dynamic K-factor based on games played
// < 30 games: K=40 (volatile)
// 30-100 games: K=24 (settling)
// > 100 games: K=16 (stable)

const { winnerDelta, loserDelta } = calculateEloChange(winnerElo, loserElo, winnerGames);
// winnerDelta: +5 to +32 (depends on upset factor)
// loserDelta: -5 to -32
```

## Logger Utility

```javascript
const log = require('./utils/logger');
// Or create a scoped logger
const log = require('./utils/logger').createLogger('MODULE_NAME');

log.debug('Verbose info', { key: 'value' });
log.info('Normal operation', { port: 3000 });
log.warn('Something unusual', { warning: 'message' });
log.error('Something failed', { error: err.message });

// Environment variables:
// LOG_LEVEL=debug|info|warn|error (default: info)
// LOG_FORMAT=json (for production, default: human-readable)
```

## Cache Utility

```javascript
const { createTTLCache } = require('./cache');

const myCache = createTTLCache({
  name: 'my-cache',           // For logging
  ttlMs: 30 * 1000,           // 30 second TTL
  maxSize: 1000,              // LRU eviction above this
  cleanupIntervalMs: 60000    // Cleanup every minute
});

myCache.set(key, value);
const val = myCache.get(key);  // Returns undefined if expired

// Built-in metrics
const { hits, misses, hitRate } = myCache.getMetrics();
```

## Stat Scaling (Level-based)

```javascript
const { getStatMultiplier, getEvolutionTier } = require('./xp-scaling');

// Formula: 1 + (level - 1) * 0.02
getStatMultiplier(1);   // 1.00x
getStatMultiplier(50);  // 1.98x
getStatMultiplier(100); // 2.98x

// Evolution tiers add bonus multipliers
getEvolutionTier(15);   // { tier: 1, bonus: 0 }
getEvolutionTier(35);   // { tier: 2, bonus: 0.10 }
getEvolutionTier(75);   // { tier: 3, bonus: 0.25 }
```

## Natures (25 total)

```javascript
const { getNatureModifier, NATURES } = require('./natures');

// Each nature boosts one stat +10%, reduces another -10%
// Example: 'Adamant' = +attack, -special_attack
const modifier = getNatureModifier('adamant', 'attack');     // 1.1
const modifier = getNatureModifier('adamant', 'sp_attack');  // 0.9
const modifier = getNatureModifier('adamant', 'defense');    // 1.0
```

## Achievements

```javascript
const { checkAchievements } = require('./achievements');

// Returns array of newly unlocked achievement IDs
const unlocked = checkAchievements(agent, {
  battlesWon: 100,
  currentStreak: 10,
  maxLevel: 50
});
// ['centurion', 'hot_streak', 'halfway_there']
```

## Performance Pattern

All utilities use pre-computation:

```javascript
// PRE-COMPUTE at module load (runs once)
const TYPE_EFFECTIVENESS_MATRIX = {};
for (const attacker of VALID_TYPES) {
  TYPE_EFFECTIVENESS_MATRIX[attacker] = {};
  for (const defender of VALID_TYPES) {
    TYPE_EFFECTIVENESS_MATRIX[attacker][defender] = computeEffectiveness(attacker, defender);
  }
}

// O(1) lookup in hot path (called thousands of times)
function getTypeMultiplier(attacker, defender) {
  return TYPE_EFFECTIVENESS_MATRIX[attacker]?.[defender] ?? 1.0;
}
```

## Export Pattern
```javascript
// Export individual functions, not classes
module.exports = {
  getTypeMultiplier,
  VALID_TYPES,
  TYPE_EFFECTIVENESS_MATRIX
};
```

## Gotchas
- **Type system:** Two different multiplier scales exist (see battle-engine vs type-system)
- **ELO floor:** Minimum ELO is 100 (can't go below)
- **Nature neutral:** 5 natures have no effect (Hardy, Docile, Serious, Bashful, Quirky)
- **Cache cleanup:** Always set cleanupIntervalMs to avoid memory leaks
