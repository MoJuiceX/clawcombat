# Unused Code Audit Report
**Generated:** 2026-02-06
**Scope:** `/sessions/dreamy-laughing-ramanujan/mnt/abit_hex/ClawCombat/apps/backend/src`
**Total Files Analyzed:** 82 JavaScript files

---

## Executive Summary

This audit identified unused exports and dead code that can be safely removed to reduce codebase bloat. All findings are categorized by confidence level (HIGH/MEDIUM/LOW) to help prioritize cleanup efforts.

**Total Findings:** 12 unused exports and constants

---

## 1. Unused Exports in Services

### 1.1 image-gen.js - Exported but Unused Functions

| Item | Type | File | Confidence | Notes |
|------|------|------|------------|-------|
| `getReferenceImageUrl` | Function Export | `services/image-gen.js:19-26` | **HIGH** | Defined in image-gen.js but never imported anywhere in the codebase. Used internally by `buildReferenceImages()` but the public export is unused. |
| `buildReferenceImages` | Function Export | `services/image-gen.js:29-39` | **HIGH** | Exported from image-gen.js but never imported by any other file. Used internally only. |
| `REFERENCE_VERSION` | Constant Export | `services/image-gen.js:11` | **MEDIUM** | Exported but never imported elsewhere. Used internally in image-gen.js. |

**Current Usage:**
- Both functions are used internally within image-gen.js
- No other files import these exports
- Consider: Keep if planning to expose image generation configuration via API; otherwise these can be made private (internal helper functions)

---

### 1.2 skin-generator.js - Exported but Unused Functions

| Item | Type | File | Confidence | Notes |
|------|------|------|------------|-------|
| `getStage` | Function Export | `services/skin-generator.js` | **HIGH** | Exported but never imported by any file in the codebase. |
| `getStageAttitude` | Function Export | `services/skin-generator.js` | **HIGH** | Exported but never imported by any file in the codebase. |
| `TYPE_HEX` | Constant Export | `services/skin-generator.js` | **HIGH** | Exported but never used anywhere. Appears to be legacy type system data. |
| `TYPE_GLOW` | Constant Export | `services/skin-generator.js` | **HIGH** | Exported but never used anywhere. Appears to be legacy type system data. |

**Current Exports Used:**
- `buildSkinPrompt` - Used in: avatars.js, xp-calculator.js
- `hashAgentStats` - Used in: avatars.js, xp-calculator.js, skins.js
- `getTier` - Used in: xp-calculator.js, skins.js, agents.js
- `checkTierEvolution` - Used in: skins.js

---

## 2. Unused Constants in Constants File

### 2.1 config/constants.js - Unused Exports

| Item | Type | File | Confidence | Notes |
|------|------|------|------------|-------|
| `QUICK_WIN_THRESHOLD` | Constant | `config/constants.js:59` | **HIGH** | Defined and exported but never imported or used anywhere in codebase. Related to battle engine. |
| `MAX_TOKENS_PER_STAT` | Constant | `config/constants.js:62` | **HIGH** | Defined and exported but never used. Possibly legacy from old stat system. |
| `TOKEN_VALUE` | Constant | `config/constants.js:63` | **HIGH** | Defined and exported but never used. |
| `STARTING_ELO` | Constant | `config/constants.js:64` | **HIGH** | Defined and exported but never used. Hardcoded values used instead. |
| `MIN_ELO` | Constant | `config/constants.js:65` | **HIGH** | Defined and exported but never used. |
| `VALID_TYPES_COUNT` | Constant | `config/constants.js:68` | **HIGH** | Defined and exported but never used. |
| `STAB_MULTIPLIER` | Constant | `config/constants.js:69` | **HIGH** | Defined and exported but never used. |
| `CRIT_MULTIPLIER` | Constant | `config/constants.js:70` | **HIGH** | Defined and exported but never used. |
| `BASE_CRIT_RATE` | Constant | `config/constants.js:71` | **HIGH** | Defined and exported but never used. |
| `SOCIAL_POST_EXPIRY_MS` | Constant | `config/constants.js:35` | **MEDIUM** | Defined and exported but never used. Suggests social post expiration was planned but not implemented. |

**Verification:**
- Grep search across entire backend/src directory shows zero usage of these constants outside their definition file
- These appear to be either placeholders for future features or remnants from refactoring

---

## 3. Routes & Middleware Analysis

### 3.1 Route Files - All Routers Are Used

✅ **All 17 route files are properly imported and mounted in index.js:**
- agents.js ✓ (line 8)
- battles.js ✓ (line 9)
- leaderboard.js ✓ (line 10)
- governance.js ✓ (line 11)
- avatars.js ✓ (line 12)
- badges.js ✓ (line 14)
- skins.js ✓ (line 15)
- premium.js ✓ (line 16)
- telegram.js ✓ (line 17)
- arena.js ✓ (line 18)
- demo.js ✓ (line 19)
- onboard.js ✓ (line 20)
- moltbook.js ✓ (line 21)
- analytics.js ✓ (line 22)
- social.js ✓ (line 23)
- admin.js ✓ (line 24)
- events.js ✓ (line 25)

---

## 4. Internal Functions (Not Exported - Correctly Scoped)

The following functions are defined but NOT exported, which is correct since they're used internally:

✅ **xp-calculator.js:**
- `buildXPReason()` - Used internally by awardBattleXP()
- `awardGiantSlayerBadge()` - Used internally by awardBattleXP()
- `triggerTierEvolution()` - Used internally by awardBattleXP()

✅ **automation.js:**
- `closeVotingAndSetPriority()` - Used internally (cron job)
- `checkPriorityProgress()` - Used internally (cron job)
- `cleanupUnclaimedAgents()` - Used internally (cron job)

✅ **routes/badges.js:**
- `recalculateBadges()` - Exported separately for admin endpoint (correctly done on line 109)

---

## 5. Dead Code Blocks & Comments

### 5.1 Commented-out Code

**Status:** No large commented-out code blocks found. The codebase is clean in this regard.

- Searched for multi-line comment blocks (`/* */`) and comment lines (`//`)
- Found mostly legitimate JSDoc documentation, not dead code
- No significant commented-out logic to remove

---

## Detailed Findings Summary

### High Confidence Findings (Ready for Removal)

```
Total: 13 unused exports/constants
├── image-gen.js: 3 exports (getReferenceImageUrl, buildReferenceImages, REFERENCE_VERSION)
├── skin-generator.js: 4 exports (getStage, getStageAttitude, TYPE_HEX, TYPE_GLOW)
└── config/constants.js: 9 constants (QUICK_WIN_THRESHOLD, MAX_TOKENS_PER_STAT, TOKEN_VALUE, STARTING_ELO, MIN_ELO, VALID_TYPES_COUNT, STAB_MULTIPLIER, CRIT_MULTIPLIER, BASE_CRIT_RATE)
```

### Medium Confidence Findings

```
Total: 1 unused export
└── config/constants.js: 1 constant (SOCIAL_POST_EXPIRY_MS)
```

---

## Recommendations

### Priority 1: Safe to Remove Now

1. **skin-generator.js exports** - Remove: `getStage`, `getStageAttitude`, `TYPE_HEX`, `TYPE_GLOW`
   - These are clearly legacy code
   - No imports anywhere
   - Impact: None (not used)

2. **config/constants.js unused constants** - Remove: `QUICK_WIN_THRESHOLD`, `MAX_TOKENS_PER_STAT`, `TOKEN_VALUE`, `STARTING_ELO`, `MIN_ELO`, `VALID_TYPES_COUNT`, `STAB_MULTIPLIER`, `CRIT_MULTIPLIER`, `BASE_CRIT_RATE`
   - All have zero usage
   - Appears to be placeholder/legacy code
   - Impact: None if not used

### Priority 2: Evaluate Before Removing

1. **image-gen.js exports** - `getReferenceImageUrl`, `buildReferenceImages`, `REFERENCE_VERSION`
   - Currently unused but could be useful for future API expansion
   - Consider: Are you planning to expose image generation configuration?
   - If not needed: Remove and make these private functions
   - If possibly useful: Document why they're exported

2. **config/constants.js** - `SOCIAL_POST_EXPIRY_MS`
   - Suggests a feature that was planned but not implemented
   - Check if social feed expiration is planned

### Priority 3: Code Quality Improvements

- All route files are properly mounted ✓
- No dead route files found ✓
- No large commented code blocks ✓
- Internal functions are correctly scoped ✓

---

## Testing Recommendations

Before removing any exports:

1. Run `grep -r "EXPORT_NAME"` to verify no usage in:
   - Frontend code (if any)
   - Tests
   - External scripts
   - Vendor code

2. Check git history to understand why these exports were created

3. Run full test suite after removal

---

## Cleanup Checklist

- [ ] Review image-gen.js exports with team
- [ ] Review skin-generator.js exports for deprecation
- [ ] Audit config/constants.js for legacy values
- [ ] Verify no external consumers (frontend, tests, scripts)
- [ ] Create PR with removal of high-confidence items
- [ ] Update any related documentation

---

## Notes

- This audit focuses on **code accessibility** (exports) not functionality
- Internal functions are correctly scoped and are not included
- All route files are properly mounted
- The codebase is relatively clean with minimal dead code
- Most unused items appear to be placeholders or legacy from refactoring
