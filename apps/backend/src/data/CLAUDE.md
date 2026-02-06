# Data

Static game data loaded at module initialization. All computed once at startup.

## Prompting Context

When working on game data, Claude should act as a **game balance designer** focused on:
- Type effectiveness and competitive balance
- Move power curves and distribution
- Effect design (burn, freeze, stat changes)
- Fair progression across 18 types

### Good Prompts for Data Work
- "Add 5 new Ice-type moves following our power distribution curve"
- "The Dragon type feels overpowered - analyze its matchups and suggest nerfs"
- "Create a new 'CYBER' type with interesting matchups against Steel and Electric"

### Questions Claude Should Ask
- Does this maintain type balance across all 18 types?
- How does this affect existing move pools?
- What's the power curve for this type? (weak/medium/strong moves)
- Should this have a status effect?

## Files Overview

| File | Size | Purpose |
|------|------|---------|
| `moves.js` | 191 moves | Move pool with damage, type, effects |
| `battle-names.js` | 600 names | Random match name generator |
| `pokeapi-type-chart.json` | 18x18 | Type effectiveness matrix |
| `pokeapi-natures.json` | 25 natures | Stat modifiers |
| `pokeapi-moves.json` | Source data | Original PokeAPI move data |
| `legacy-move-map.json` | 100+ entries | Old ID → new ID mapping |
| `moltbook-post-templates.json` | Templates | Social post formats |

## Move Pool (`moves.js`)

191 moves across 18 types (~10-12 per type).

```javascript
const { MOVES, MOVES_BY_TYPE, getMoveById } = require('./moves');

// Get move by ID (handles both formats)
const move = getMoveById('poke_fire_flamethrower');
// { id, name, type, power, accuracy, pp, effect, effectChance }

// Get all moves of a type
const fireMoves = MOVES_BY_TYPE['fire'];
// Array of 11 fire-type moves
```

### Move Structure
```javascript
{
  id: 'poke_fire_flamethrower',
  name: 'Flamethrower',
  type: 'fire',
  power: 90,
  accuracy: 100,
  pp: 15,
  damageClass: 'special',
  effect: 'burn',
  effectChance: 10
}
```

### Legacy Move Compatibility

Database may contain old-format move IDs:

```javascript
// Old format: "normal_1", "fire_2"
// New format: "poke_fire_flamethrower"

// getMoveById() checks BOTH:
const move = MOVES[id] || LEGACY_MOVE_MAP[id];

// ALWAYS use getMoveById() - never access MOVES directly
```

## Type Chart (`pokeapi-type-chart.json`)

18x18 effectiveness matrix loaded at startup.

```javascript
const TYPE_CHART = require('./pokeapi-type-chart.json');

// Direct O(1) lookup
const multiplier = TYPE_CHART['fire']['grass'];  // 2.0
const multiplier = TYPE_CHART['fire']['water'];  // 0.5
const multiplier = TYPE_CHART['normal']['ghost']; // 0
```

### Type List (18 types)
```
normal, fire, water, electric, grass, ice,
fighting, poison, ground, flying, psychic,
bug, rock, ghost, dragon, dark, steel, fairy
```

## Natures (`pokeapi-natures.json`)

25 natures with stat modifiers.

```javascript
const NATURES = require('./pokeapi-natures.json');

// Each nature: +10% one stat, -10% another
// 5 neutral natures have no effect
const nature = NATURES['adamant'];
// { increased_stat: 'attack', decreased_stat: 'special-attack' }
```

### Neutral Natures (no effect)
- Hardy, Docile, Serious, Bashful, Quirky

## Battle Names (`battle-names.js`)

Random name generator for matches.

```javascript
const { generateBattleName } = require('./battle-names');

const name = generateBattleName();
// "The Fierce Showdown", "Electric Clash", etc.

// 600 combinations (20 adjectives × 30 nouns)
```

## Export Pattern

All data files export constants computed at require() time:

```javascript
// moves.js
const MOVES = {};
const MOVES_BY_TYPE = {};
const LEGACY_MOVE_MAP = require('./legacy-move-map.json');

// Pre-compute lookups ONCE
for (const move of rawMoves) {
  MOVES[move.id] = move;
  if (!MOVES_BY_TYPE[move.type]) MOVES_BY_TYPE[move.type] = [];
  MOVES_BY_TYPE[move.type].push(move);
}

module.exports = { MOVES, MOVES_BY_TYPE, getMoveById, LEGACY_MOVE_MAP };
```

## Pre-loaded Data (not fetched at runtime)

All JSON files are:
1. Imported from PokeAPI (one-time)
2. Modified for ClawCombat balance
3. Loaded at server startup
4. Never fetched dynamically

## Gotchas
- **Legacy move IDs:** Database may have old format - ALWAYS use `getMoveById()`
- **Type chart:** Uses 0/0.5/1/2 multipliers (not 0.8/1.0/1.2)
- **Move balance:** Power values modified from PokeAPI originals
- **Nature names:** Lowercase in code, Title Case in display
- **Immutable data:** Never modify these objects at runtime
