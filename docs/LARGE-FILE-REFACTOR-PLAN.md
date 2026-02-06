# Large File Refactoring Plan

Analysis and recommendations for splitting the largest files into smaller, maintainable modules.

---

## File Size Overview

| File | Lines | Priority | Recommendation |
|------|-------|----------|----------------|
| `services/battle-engine.js` | 2711 | **HIGH** | Split into 5 modules |
| `routes/agents.js` | 1955 | **HIGH** | Split into 3 modules |
| `routes/onboard.js` | 1032 | MEDIUM | Split into 2 modules |
| `db/schema.js` | 961 | LOW | Keep as-is (schema definition) |
| `routes/governance.js` | 791 | LOW | Acceptable size |

---

## 1. battle-engine.js (2711 lines) → 5 Modules

**Current structure:** One massive file handling everything battle-related.

### Recommended Split:

```
services/battle-engine/
├── index.js              # Main exports, orchestration
├── damage-calculator.js  # Damage formulas, type effectiveness
├── turn-executor.js      # Turn logic, move execution
├── state-manager.js      # Battle state, status effects
├── matchmaking.js        # Queue management, pairing
└── webhooks.js           # External bot notifications
```

### Module Breakdown:

**damage-calculator.js (~400 lines)**
- `calculateDamage()`
- `getTypeMultiplier()`
- `calculateCritical()`
- `applySTAB()`
- Type chart constants

**turn-executor.js (~500 lines)**
- `executeTurn()`
- `executeMove()`
- `applyMoveEffects()`
- `checkFaint()`
- Turn order logic

**state-manager.js (~400 lines)**
- `createBattleState()`
- `updateBattleState()`
- `applyStatusEffect()`
- `tickStatusEffects()`
- Status effect constants

**matchmaking.js (~400 lines)**
- `findMatch()`
- `queueAgent()`
- `dequeueAgent()`
- ELO-based pairing
- Queue management

**webhooks.js (~300 lines)**
- `notifyBattleStart()`
- `notifyTurnResult()`
- `notifyBattleEnd()`
- Webhook retry logic

**index.js (~200 lines)**
- Re-exports all public functions
- `executeBattle()` orchestrator
- Router setup

### Migration Steps:
1. Create `services/battle-engine/` directory
2. Extract damage calculator first (fewest dependencies)
3. Update imports in dependent files
4. Run tests after each extraction
5. Keep old file as backup until stable

---

## 2. routes/agents.js (1955 lines) → 3 Modules

**Current structure:** All agent-related endpoints in one file.

### Recommended Split:

```
routes/agents/
├── index.js           # Route mounting, shared middleware
├── crud.js            # Create, read, update, delete agents
├── stats.js           # XP, leveling, stats, EVs
└── management.js      # API keys, claiming, linking
```

### Module Breakdown:

**crud.js (~600 lines)**
- `POST /agents` - Create agent
- `GET /agents/:id` - Get agent
- `PUT /agents/:id` - Update agent
- `DELETE /agents/:id` - Delete agent
- `GET /agents` - List agents

**stats.js (~500 lines)**
- `GET /agents/:id/stats` - Get stats
- `POST /agents/:id/allocate-ev` - Allocate EVs
- `GET /agents/:id/xp-history` - XP logs
- `GET /agents/:id/achievements` - Badges
- Level calculation helpers

**management.js (~500 lines)**
- `POST /agents/register` - Register new agent
- `POST /agents/rotate-key` - Rotate API key
- `POST /agents/claim` - Claim agent
- `POST /agents/link` - Link to Telegram
- `GET /agents/:id/webhook` - Webhook config

**index.js (~200 lines)**
- Import and mount sub-routers
- Shared validation middleware
- Error handlers

### Migration Steps:
1. Create `routes/agents/` directory
2. Start with management.js (most isolated)
3. Move crud.js next
4. Update index.js imports
5. Test each endpoint after move

---

## 3. routes/onboard.js (1032 lines) → 2 Modules

**Current structure:** Demo system + onboarding flow mixed.

### Recommended Split:

```
routes/
├── onboard.js         # Core onboarding flow
└── demo.js            # Demo/tutorial battles (move existing)
```

Or:

```
routes/onboard/
├── index.js           # Route mounting
├── flow.js            # Onboarding steps
└── demo-battles.js    # Demo battle logic
```

### Module Breakdown:

**flow.js (~500 lines)**
- `POST /onboard/create` - Create temp agent
- `POST /onboard/claim` - Claim agent
- `GET /onboard/status` - Check progress
- Claim code generation
- Trial period logic

**demo-battles.js (~400 lines)**
- Demo battle state management
- Tutorial opponent logic
- Demo session cleanup
- Practice mode

---

## Implementation Priority

### Phase 1: Critical (Do First)
1. **battle-engine.js** - Highest complexity, most prone to bugs
   - Start with `damage-calculator.js` extraction
   - Estimated effort: 4-6 hours

### Phase 2: Important
2. **agents.js** - Large but more straightforward
   - Start with `management.js` extraction
   - Estimated effort: 2-3 hours

### Phase 3: Nice to Have
3. **onboard.js** - Less critical, already functional
   - Estimated effort: 1-2 hours

---

## Testing Strategy

For each extraction:

1. **Before refactor:**
   ```bash
   npm test -- battle-engine  # Capture baseline
   ```

2. **Create new module:**
   - Copy relevant functions
   - Update imports
   - Export public API

3. **Update original:**
   - Import from new module
   - Remove duplicated code
   - Keep old code commented (temporarily)

4. **Test:**
   ```bash
   npm test -- battle-engine  # Should pass same tests
   ```

5. **Cleanup:**
   - Remove commented old code
   - Update CLAUDE.md files
   - Commit with descriptive message

---

## Claude CLI Prompt for Refactoring

When ready to execute, use this prompt:

```
Refactor services/battle-engine.js into smaller modules.

1. Create services/battle-engine/ directory
2. Extract damage-calculator.js with these functions:
   - calculateDamage
   - getTypeMultiplier
   - calculateCritical
   - applySTAB
3. Update imports in the main file
4. Run tests to verify: npm test -- battle-engine
5. Commit: git commit -m "refactor: Extract damage calculator from battle-engine"

Do NOT break existing functionality. Run tests after each step.
```

---

## Notes

- **Don't rush** - These refactors can introduce subtle bugs
- **Test coverage first** - Ensure good test coverage before refactoring
- **One module at a time** - Don't try to split everything at once
- **Keep backwards compatibility** - Re-export from index.js
