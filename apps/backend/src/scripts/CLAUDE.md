# Scripts

Utility scripts for database seeding and maintenance.

## Available Scripts

### `seed-bots.js` - Arena Bot Seeding

Creates 10 auto-play bots so new players always have opponents.

```bash
node src/scripts/seed-bots.js
# or
npm run seed
```

#### Bot Distribution
| Tier | Count | Levels | Purpose |
|------|-------|--------|---------|
| Low | 3 | 2-5 | New players |
| Mid | 4 | 6-15 | Regular players |
| High | 3 | 16-25 | Veterans |

#### Bot Details
```javascript
const BOTS = [
  // Low-level
  { name: 'Tideclaw',       level: 2,  type: 'WATER' },
  { name: 'Emberpinch',     level: 3,  type: 'FIRE' },
  { name: 'Sproutsnap',     level: 5,  type: 'GRASS' },
  // Mid-level
  { name: 'Voltcrusher',    level: 7,  type: 'ELECTRIC' },
  { name: 'Frostclaw',      level: 10, type: 'ICE' },
  { name: 'Shadowpincer',   level: 12, type: 'SHADOW' },
  { name: 'Ironshell',      level: 15, type: 'METAL' },
  // High-level
  { name: 'Psychecrusher',  level: 18, type: 'PSYCHE' },
  { name: 'Dragonmaw',      level: 22, type: 'DRAGON' },
  { name: 'Mysticreef',     level: 25, type: 'MYSTIC' },
];
```

#### What It Does
1. Initializes database schema (safe if already exists)
2. Checks if bots already exist (skips if found)
3. For each bot:
   - Generates random nature and ability
   - Calculates XP for target level
   - Distributes 100 stat points (10 base + 40 random)
   - Assigns 4 random moves for type
   - Sets `play_mode = 'auto'` for AI control
   - Creates hashed API key (bot doesn't need it)

#### Re-running
Safe to run multiple times - skips existing bots by name.

## Running Scripts

```bash
# From backend directory
cd apps/backend

# Run directly
node src/scripts/seed-bots.js

# Via npm
npm run seed

# With debug output
DEBUG=1 node src/scripts/seed-bots.js
```

## Creating New Scripts

Follow the pattern in `seed-bots.js`:

```javascript
#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '../..'));

const { getDb, initializeSchema } = require('../db/schema');

// Your script logic here

const db = getDb();
initializeSchema(db);

// ... operations
```

## Gotchas
- **Working directory:** Scripts use `process.chdir()` to ensure correct path resolution
- **Schema init:** Always call `initializeSchema()` before DB operations
- **Idempotent:** Scripts should be safe to run multiple times
- **Bot API keys:** Generated but unused (bots controlled by AI strategist)
