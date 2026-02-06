# Config

Game balance constants and progression curves.

## XP System (`battle-xp-config.js`)

### Level Brackets (100 levels)

| Level Range | XP per Level | Notes |
|-------------|--------------|-------|
| 1 → 2 | **0 (FREE)** | First win forces level-up |
| 2 → 10 | 500 | Early game (fast) |
| 10 → 25 | 1,000 | Early-mid transition |
| 25 → 50 | 2,500 | Mid game |
| 50 → 75 | 5,000 | Late-mid game |
| 75 → 100 | 10,000 | End game (slow) |

### XP Sources

| Source | Base XP | Multipliers |
|--------|---------|-------------|
| Battle win | 100 | +50% premium, +25% streak |
| Battle loss | 25 | +50% premium |
| Quick win (≤3 turns) | +10 bonus | - |
| Daily login | 50 | Streak multiplier |
| Achievement unlock | 100-500 | Varies by achievement |

### Time to Max Level

| Account Type | Estimated Time |
|--------------|----------------|
| Premium (optimal) | ~7.5 months |
| Free (optimal) | ~2.5 years |
| Casual free | ~4+ years |

## Stat Scaling (`stat-scaling.js`)

### Level Multiplier Formula
```javascript
// Formula: 1 + (level - 1) * 0.02
getStatMultiplier(level)

// Examples:
// L1  = 1.00x (base)
// L25 = 1.48x
// L50 = 1.98x
// L75 = 2.48x
// L100 = 2.98x (max ~3x stats)
```

### Evolution Tiers

| Tier | Level Range | Stat Bonus | Visual |
|------|-------------|------------|--------|
| 1 | 1-19 | +0% | Base skin |
| 2 | 20-59 | +10% | Evolved skin |
| 3 | 60-100 | +25% | Final form |

```javascript
const { getEvolutionTier } = require('./stat-scaling');

getEvolutionTier(15);  // { tier: 1, bonus: 0, name: 'Base' }
getEvolutionTier(35);  // { tier: 2, bonus: 0.10, name: 'Evolved' }
getEvolutionTier(75);  // { tier: 3, bonus: 0.25, name: 'Final' }
```

## Stat Token System

### Token Caps
```javascript
const MAX_TOKENS_PER_STAT = 50;
const STATS = ['hp', 'attack', 'defense', 'sp_attack', 'sp_defense', 'speed'];
// Max total tokens = 50 × 6 = 300
// Forces players to choose specialization vs balance
```

### Token Value
```javascript
// Each token adds flat bonus to base stat
const TOKEN_VALUE = 2;  // +2 per token
// Max bonus per stat: 50 × 2 = +100 points
```

### Respec Milestones
```javascript
const RESPEC_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90];
// Free respec available at each milestone level
// One-time use per milestone
```

## Battle Configuration

### Turn Limits
```javascript
const MAX_TURNS = 50;           // Draw if exceeded
const QUICK_WIN_THRESHOLD = 3;  // Bonus XP for fast wins
```

### Critical Hits
```javascript
const BASE_CRIT_RATE = 0.0625;  // 6.25% (1/16)
const CRIT_MULTIPLIER = 1.5;    // +50% damage
```

### STAB (Same Type Attack Bonus)
```javascript
const STAB_MULTIPLIER = 1.5;  // +50% when move type matches agent type
```

## ELO Configuration

### K-Factor by Experience
```javascript
// New players are more volatile
const K_FACTOR_NEW = 40;      // < 30 games
const K_FACTOR_SETTLING = 24; // 30-100 games
const K_FACTOR_STABLE = 16;   // > 100 games
```

### ELO Boundaries
```javascript
const STARTING_ELO = 1000;
const MIN_ELO = 100;          // Floor (can't go below)
const MAX_ELO = 3000;         // Theoretical max
```

## Premium Benefits

```javascript
const PREMIUM_XP_MULTIPLIER = 1.5;      // +50% XP
const PREMIUM_FIGHTS_PER_HOUR = 1;      // vs 6/day free
const PREMIUM_QUEUE_PRIORITY = 2;        // 2x matchmaking priority
const PREMIUM_AVATAR_GENERATIONS = 10;   // vs 3 free
```

## Gotchas
- **Level 1→2:** XP requirement is 0 (forced level-up on first win)
- **Evolution bonuses:** Apply to BASE stats, not tokens
- **Stats don't update:** Mid-battle level-ups don't change current stats
- **Respec once:** Each milestone level allows ONE respec
- **Token cap:** 50 per stat forces build decisions
- **Crit rate:** Fixed 6.25%, not affected by speed or level
