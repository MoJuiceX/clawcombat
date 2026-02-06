# ClawCombat Backend Audit Report

**Generated**: 2026-02-06
**Scope**: /Users/abit_hex/ClawCombat/apps/backend/
**Auditor**: Automated Code Audit

---

## Executive Summary

This audit analyzed the ClawCombat backend codebase with a focus on the visual effects system, code quality, and potential bugs. The codebase is generally well-structured with good separation of concerns, but several issues were identified that warrant attention.

### Summary by Severity

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH | 4 |
| MEDIUM | 12 |
| LOW | 15+ |

---

## CRITICAL Issues

### 1. Variable Scope Bug in arena.html (Line 1228)

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/public/arena.html`
**Lines**: 389, 1228

**Issue**: The variable `urlParams` is declared inside the `initAuth()` function (line 389) but is referenced outside that function's scope (line 1228). This will cause a `ReferenceError` when the page loads.

```javascript
// Line 389 - urlParams is declared inside initAuth()
async function initAuth() {
  const urlParams = new URLSearchParams(window.location.search);
  // ...
}

// Line 1228 - urlParams is referenced OUTSIDE initAuth() scope
window.addEventListener('DOMContentLoaded', async function() {
  initCanvas();
  await initAuth();
  var agentParam = urlParams.get('agentId');  // ERROR: urlParams is not defined
  // ...
});
```

**Impact**: The `agentId` URL parameter will never be properly read, potentially breaking battle resumption functionality.

**Recommendation**: Move `urlParams` declaration to module scope, or re-declare it in the DOMContentLoaded handler.

---

## HIGH Priority Issues

### 1. BUG Comment in battle-engine.js (Line 175)

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/services/battle-engine.js`
**Line**: 175

**Issue**: A standalone `// BUG` comment exists without explanation, indicating an unresolved or undocumented bug.

```javascript
// BUG
Swarm: { type: 'INSECT', description: '+30% bug moves when HP < 33%', trigger: 'damage_calc' },
```

**Recommendation**: Investigate this BUG marker. It appears to be related to the ability system - verify that the Swarm ability is functioning correctly when HP drops below 33%.

### 2. Duplicate TYPE_COLORS Definitions

**Files**:
- `/Users/abit_hex/ClawCombat/apps/backend/src/public/js/battle-particles.js`
- `/Users/abit_hex/ClawCombat/apps/backend/src/public/js/battle-ui.js`

**Issue**: `TYPE_COLORS` (or `TYPE_EFFECTS`) mapping is defined in both files with potential for inconsistency.

**battle-particles.js** defines TYPE_EFFECTS with colors:
```javascript
var TYPE_EFFECTS = {
  fire: { color: '#FF6B35', accent: '#FFD93D', ...},
  water: { color: '#4FC3F7', accent: '#81D4FA', ...},
  // ...18 types total
};
```

**battle-ui.js** defines separate TYPE_COLORS:
```javascript
var TYPE_COLORS = {
  fire: '#FF6B35',
  water: '#4FC3F7',
  // ...
};
```

**Recommendation**: Consolidate into a single shared configuration file to prevent drift.

### 3. Extensive Code Duplication Across HTML Files

**Files**:
- `/Users/abit_hex/ClawCombat/apps/backend/src/public/demo.html`
- `/Users/abit_hex/ClawCombat/apps/backend/src/public/arena.html`
- `/Users/abit_hex/ClawCombat/apps/backend/src/public/replay.html`

**Duplicated Code Patterns**:

1. **Canvas initialization** - Nearly identical `initCanvas()` functions
2. **Battle rendering** - `drawBattleScene()` with identical lobster drawing logic
3. **HP bar management** - Same HP bar update code
4. **Animation loops** - Duplicate `requestAnimationFrame` patterns
5. **Type color mappings** - Inline type color definitions
6. **Status effect rendering** - Same status icon code

**Estimated Duplication**: ~500-800 lines across the three files

**Recommendation**: Extract shared code into:
- `battle-canvas.js` - Canvas and drawing utilities
- `battle-state.js` - Battle state management
- `battle-renderer.js` - Shared rendering code

### 4. Hardcoded Webhook Timeout Mismatch Risk

**Files**:
- `/Users/abit_hex/ClawCombat/apps/backend/src/services/battle-engine.js` (line 1096)
- `/Users/abit_hex/ClawCombat/apps/backend/src/services/webhook.js` (line 3)

**Issue**: Both files define `TIMEOUT_MS` independently:

```javascript
// battle-engine.js:1096
const WEBHOOK_TIMEOUT_MS = 30000;

// webhook.js:3
const TIMEOUT_MS = 30000; // Must match battle-engine checkTimeouts
```

The comment in webhook.js acknowledges they must match, but they're duplicated instead of shared.

**Recommendation**: Export the timeout constant from a shared config module.

---

## MEDIUM Priority Issues

### 1. Console.log Statements in Production Code

**Total Found**: 150+ console.log/error/warn statements

**Notable Categories**:

| Category | Count | Example Location |
|----------|-------|------------------|
| Service logging | 40+ | automation.js, battle-engine.js |
| Error logging | 50+ | routes/*.js |
| Debug logging | 20+ | image-gen.js, xp-calculator.js |
| Client-side logging | 30+ | public/*.html, public/js/*.js |

**High-Priority Removals** (debug statements):

```javascript
// src/services/image-gen.js:60
console.log(`[AVATAR] FLUX 2 Pro: references=${referenceImages.join(', ')}`);

// src/services/battle-engine.js:1488
console.log(`[BATTLE] Backfilled ${rows.length} battles with sequential numbers`);

// src/services/automation.js:391
console.log(`[AUTO] Matched lv${queue[i].level} vs lv${queue[bestMatch].level}...`);
```

**Recommendation**:
1. Implement a proper logging library (winston, pino)
2. Add log levels (debug, info, warn, error)
3. Remove console.log statements from client-side code or wrap in debug flag

### 2. Hardcoded Magic Numbers

| File | Line | Value | Context | Recommendation |
|------|------|-------|---------|----------------|
| battle-particles.js | 1258 | `500` | MAX_PARTICLES cap | Move to config |
| battle-engine.js | 1648 | `30000` | TIMEOUT_MS | Already a constant, but duplicated |
| battle-engine.js | 1649 | `3` | MAX_CONSECUTIVE_TIMEOUTS | Move to config |
| automation.js | 264 | `100` | MAX_TURNS | Already a constant in demo.js too |
| demo.js | 17 | `100` | MAX_TURNS | Duplicated from automation.js |
| demo.js | 18 | `10000` | MAX_DEMO_SESSIONS | Move to config |
| agents.js | 66 | `5` | MAX_AGENTS_PER_OWNER | Should be in config |
| webhook.js | 14 | `2` | MAX_ATTEMPTS | Move to config |
| admin-auth.js | 13 | `5` | MAX_FAILED_ATTEMPTS | Move to config |

### 3. Inconsistent Error Response Formats

**Issue**: Error responses vary across routes:

```javascript
// Pattern 1: Simple message
res.status(400).json({ error: 'name required' });

// Pattern 2: With code
res.status(403).json({ error: 'Maximum 5 agents per user', code: 'LIMIT_REACHED' });

// Pattern 3: With details
res.status(500).json({ error: 'Failed to fetch logs' });

// Pattern 4: With path (404 handler)
res.status(404).json({ error: 'Not found', path: req.path });
```

**Recommendation**: Standardize error responses with a consistent schema:
```javascript
{
  error: string,      // Human-readable message
  code: string,       // Machine-readable error code
  details?: object    // Optional additional context
}
```

### 4. Empty/Minimal Catch Blocks

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/services/telegram-bot.js`

```javascript
// Line 66, 79, 732
} catch (e) { console.error('[TELEGRAM]', e.message); }
```

**Issue**: Errors are logged but not properly handled or propagated.

### 5. Speed Multiplier Not Synchronized

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/public/js/battle-ui.js`

```javascript
var _battleUISpeedMultiplier = 1;
function setSpeedMultiplier(n) {
  _battleUISpeedMultiplier = n;
}
```

**Issue**: Speed multiplier is set in battle-ui.js but battle-particles.js has its own timing. Changing speed in one doesn't affect the other, potentially causing visual desync.

### 6. Missing Input Validation

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/routes/events.js`

```javascript
// Lines 16-17: Rate limiting with hardcoded values
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 100;
```

The events route stores arbitrary event data without schema validation.

### 7. Unused MOVE_OVERRIDES Entries

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/public/js/battle-particles.js`

The `MOVE_OVERRIDES` object contains 100+ entries mapping move names to particle patterns. Some of these moves may not exist in the current move database, representing potential dead configuration.

**Recommendation**: Cross-reference with actual moves in the database and remove unused entries.

### 8. CSS Animation Performance

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/public/css/arena.css`

Several animations use properties that trigger layout/paint:
```css
@keyframes burnFlicker {
  0%, 100% { opacity: 1; filter: brightness(1); }
  50% { opacity: 0.7; filter: brightness(1.3); }
}
```

**Recommendation**: For better performance, prefer `transform` and `opacity` for animations. The `filter` property can be expensive.

### 9. Potential Memory Leak in Demo Sessions

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/routes/demo.js`

```javascript
const demoSessions = new Map();
const MAX_DEMO_SESSIONS = 10000;

if (demoSessions.size >= MAX_DEMO_SESSIONS) {
  // Only blocks new sessions, doesn't clean up old ones
}
```

**Issue**: Demo sessions are stored in memory but cleanup logic may not be aggressive enough.

### 10. XP Config Comment Mismatch

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/services/xp-calculator.js`

```javascript
// Line 9: Comment says +33%
* - Daily first win bonus (+33%)

// But battle-xp-config.js has:
const DAILY_FIRST_WIN_BONUS = 0.50; // +50% XP
```

**Issue**: Comment in xp-calculator.js is outdated (says 33%, actual value is 50%).

### 11. Require Inside Function Body

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/index.js`

```javascript
// Lines 139, 165, 220-222, 249-251, 274-275, 291-292, 313-314
app.get('/api/reference-images', (req, res) => {
  const fs = require('fs');  // Require inside handler
  // ...
});
```

**Issue**: `require()` statements inside route handlers are inefficient (though cached by Node).

**Recommendation**: Move all requires to the top of the file.

### 12. leaderboard.html Uses Different Type Mapping

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/public/leaderboard.html` (line 282)

```javascript
GROUND:'#E0C068', FLYING:'#A890F0', PSYCHIC:'#F85888', BUG:'#A8B820',
```

**Issue**: Uses Pokemon-style type names (GROUND, FLYING, BUG) instead of ClawCombat types (EARTH, AIR, INSECT). This may be legacy code.

---

## LOW Priority Issues

### 1. TODO/FIXME Comments

Only one actual code-related comment found:

| File | Line | Comment |
|------|------|---------|
| battle-engine.js | 175 | `// BUG` (no explanation) |

The codebase is notably clean of TODO/FIXME comments, which is positive.

### 2. Test File Console Logging

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/routes/__tests__/battles.test.js`

```javascript
console.log(`  ✓ ${name}`);
console.log(`  ✗ ${name}`);
```

**Recommendation**: Use proper test reporter output.

### 3. Image Gen Tester Excessive Logging

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/services/image-gen-tester.js`

Contains 20+ console.log statements for test output. This is acceptable for a test utility but should not be included in production builds.

### 4. Hardcoded Development Bypass

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/public/arena.html` (line 392)

```javascript
if (devHumanId && location.hostname === 'localhost') {
  clerkToken = null;
  window._devHumanId = devHumanId;
```

**Note**: This is properly guarded by hostname check but should be documented.

### 5. CSS Variable Naming Inconsistency

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/public/css/arena.css`

Type variables use different naming:
- Some use full names: `--type-electric`, `--type-martial`
- Status effects don't follow same pattern: `--burn`, `--poison`

### 6. Audio System Verbose Logging

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/public/js/battle-audio.js`

```javascript
console.log('[MUSIC] BGM init complete');
console.log('[MUSIC] Playback started, duration=' + el.duration.toFixed(1) + 's');
console.log('[AUDIO] Unlocked');
```

**Recommendation**: Wrap in debug flag or remove for production.

### 7. XP Config Test File Should Not Be in src/

**File**: `/Users/abit_hex/ClawCombat/apps/backend/src/config/battle-xp-config.test.js`

Test file is in config directory instead of `__tests__` directory.

### 8. Unused Import Potential

The `require()` calls in route handlers (mentioned above) suggest the code evolved over time. A full unused import scan is recommended.

---

## Detailed Findings by Category

### Dead Code & Unused Functions

No significant dead code was found. The codebase appears actively maintained with proper cleanup. However:

1. **MOVE_OVERRIDES** in battle-particles.js may contain entries for moves that no longer exist
2. The BUG type mapping in leaderboard.html appears to be legacy Pokemon-style naming

### Console.log Statements

| Type | Count | Action Recommended |
|------|-------|-------------------|
| Intentional service logging | ~60 | Keep, but use proper logger |
| Error logging | ~50 | Keep, standardize format |
| Debug/development | ~25 | Remove or wrap in DEBUG flag |
| Client-side | ~30 | Remove or wrap in DEBUG flag |

### Hardcoded Values

See Medium Priority Issue #2 for complete list. Key recommendations:
1. Create `/src/config/constants.js` for shared magic numbers
2. Move timeout values to environment variables where appropriate
3. Document any values that must remain hardcoded

### Error Handling Issues

1. **Inconsistent formats** across routes
2. **Swallowed errors** in some catch blocks
3. **Missing error middleware** usage in some routes
4. **No request ID** for error correlation

### XP Configuration Status

The XP system is well-designed with proper separation between:
- `/src/config/battle-xp-config.js` - Configuration constants and helpers
- `/src/services/xp-calculator.js` - XP calculation logic

**One inconsistency found**: Comment in xp-calculator.js mentions 33% first win bonus, but actual value is 50%.

---

## Recommendations

### Immediate Actions (Critical/High)

1. **Fix urlParams scope bug** in arena.html - This is actively breaking functionality
2. **Investigate BUG comment** in battle-engine.js line 175
3. **Consolidate TYPE_COLORS** into a shared module

### Short-term Actions (Medium)

1. **Implement structured logging** - Replace console.log with winston/pino
2. **Standardize error responses** - Create error response middleware
3. **Extract shared HTML code** - Create reusable JS modules for battle rendering
4. **Create constants config** - Consolidate magic numbers

### Long-term Actions (Low)

1. **Move test files** to proper `__tests__` directories
2. **Audit MOVE_OVERRIDES** for unused entries
3. **Performance audit** of CSS animations
4. **Client-side code cleanup** - Remove development console.logs

---

## Files Analyzed

### Core Application
- `/src/index.js`

### Services
- `/src/services/automation.js`
- `/src/services/battle-engine.js`
- `/src/services/image-assigner.js`
- `/src/services/image-gen.js`
- `/src/services/image-gen-tester.js`
- `/src/services/moltbook-monitor.js`
- `/src/services/premium.js`
- `/src/services/skin-generator.js`
- `/src/services/telegram-bot.js`
- `/src/services/webhook.js`
- `/src/services/xp-calculator.js`

### Routes
- `/src/routes/admin.js`
- `/src/routes/agents.js`
- `/src/routes/analytics.js`
- `/src/routes/arena.js`
- `/src/routes/avatars.js`
- `/src/routes/badges.js`
- `/src/routes/battles.js`
- `/src/routes/demo.js`
- `/src/routes/events.js`
- `/src/routes/governance.js`
- `/src/routes/leaderboard.js`
- `/src/routes/moltbook.js`
- `/src/routes/onboard.js`
- `/src/routes/premium.js`
- `/src/routes/skins.js`
- `/src/routes/social.js`
- `/src/routes/telegram.js`

### Configuration
- `/src/config/battle-xp-config.js`
- `/src/config/stat-scaling.js`

### Utilities
- `/src/utils/type-system.js`
- `/src/utils/xp-scaling.js`

### Middleware
- `/src/middleware/admin-auth.js`
- `/src/middleware/auth.js`
- `/src/middleware/clerk-auth.js`
- `/src/middleware/rate-limit.js`

### Public Files (Visual Effects System)
- `/src/public/js/battle-particles.js` (1287 lines)
- `/src/public/js/battle-ui.js` (495+ lines)
- `/src/public/js/battle-audio.js`
- `/src/public/js/analytics.js`
- `/src/public/js/auth.js`
- `/src/public/css/arena.css` (1775 lines)

### HTML Pages
- `/src/public/arena.html`
- `/src/public/demo.html`
- `/src/public/replay.html`
- `/src/public/index.html`
- `/src/public/claim.html`
- `/src/public/create.html`
- `/src/public/leaderboard.html`
- `/src/public/onboarding.html`
- `/src/public/play.html`
- `/src/public/premium.html`
- `/src/public/image-selector.html`

### Database
- `/src/db/schema.js`

### Tests
- `/src/__tests__/setup.js`
- `/src/__tests__/battle-xp-config.spec.js`
- `/src/routes/__tests__/battles.test.js`
- `/src/config/battle-xp-config.test.js`

---

## Conclusion

The ClawCombat backend codebase is well-structured overall, with good separation of concerns between services, routes, and configuration. The main areas requiring attention are:

1. **The critical urlParams scope bug** that breaks arena page functionality
2. **Code duplication** across HTML battle pages
3. **Console.log proliferation** that should be replaced with proper logging
4. **Hardcoded values** that should be centralized

The visual effects system (battle-particles.js, battle-ui.js, arena.css) is comprehensive and well-implemented, though the TYPE_COLORS/TYPE_EFFECTS duplication should be addressed to prevent future inconsistencies.

The XP configuration system is clean and well-documented, with only a minor comment inconsistency found.
