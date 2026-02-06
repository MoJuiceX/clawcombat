# ClawCombat Attack Effects - Research Report

**Date:** February 2026
**Purpose:** Complete research synthesis before implementing visual attack effects

---

## Table of Contents

1. [Understanding the Current System](#1-understanding-the-current-system)
2. [Identified Constraints](#2-identified-constraints)
3. [Success Criteria](#3-success-criteria)
4. [Living Reference System](#4-living-reference-system)
5. [Recommendations](#5-recommendations)

---

# 1. Understanding the Current System

## 1.1 How Does Battle Replay Work Now?

The battle system uses **three pages** with shared infrastructure:

| Page | Purpose | Event Source |
|------|---------|--------------|
| `replay.html` | Historical battle playback | API fetch (stored battles) |
| `play.html` | Tutorial/first battle | API generated |
| `arena.html` | Live multiplayer | WebSocket/polling |

### Playback Flow

```
API Response → Parse Turns → Sequential Event Processing → Animations + Delays
```

**Key function:** `playTurnEvents(turnIndex)` in replay.html (lines 631-839)

1. Detects phase (`first_attack` / `second_attack`)
2. Processes events sequentially with `await delay()`
3. Each event type triggers specific animations
4. Speed multiplier scales all timings (0.5x to 4x)

### Turn-by-Turn Timing

| Event | Base Duration | Notes |
|-------|---------------|-------|
| Move announcement | 600ms | Attacker scales up |
| Projectile travel | 200-450ms | Pattern-dependent |
| Damage display | 800ms | Number float + shake |
| Status inflict | 900ms | Status pill float |
| Between turns | 1600ms | Pause for readability |

---

## 1.2 Where Do Animations Currently Happen?

### Three Animation Layers

**Layer 1: CSS Animations (Character Movement)**
- Attacker charge/thrust (150-300ms)
- Defender shake on hit (400ms)
- Faint animation (1000ms)
- HP bar transitions (600ms)
- Frame glow pulses (2000ms infinite)

**Layer 2: Canvas Particles (`battle-particles.js`)**
- Attack projectiles/beams
- Impact bursts
- Type-specific particles
- Drain/heal effects

**Layer 3: DOM Overlays**
- Floating damage numbers
- "CRITICAL!" text
- Status effect pills
- "Super Effective!" callouts

### Current Attack Patterns (Already Implemented!)

| Pattern | Travel Time | Use Case |
|---------|-------------|----------|
| `beam` | 200ms | Instant laser line |
| `projectile` | 300ms | Flying ball |
| `arc` | 450ms | Parabolic throw |
| `slash` | 150ms | Quick melee |
| `charge` | 250ms | Attacker lunges |
| `wave` | 300ms | Expanding rings |

**Important Discovery:** The particle system already exists and supports type-specific colors!

---

## 1.3 DOM Structure of Battle Arena

```
.battle-arena (420px height)
├── Canvas#effectCanvas (z-index: 20) ← PARTICLES GO HERE
├── .vs-emblem (center)
├── .player-platform / .opponent-platform
│
├── .player-lobster (bottom-left, 300px wide)
│   ├── .frame-glow (pulsing aura)
│   ├── .lobster-frame
│   │   ├── img (avatar)
│   │   └── .status-badges ← STATUS ICONS HERE
│   ├── .hp-container
│   │   ├── .hp-bar-bg
│   │   │   ├── .hp-ghost (damage trail)
│   │   │   └── .hp-bar (active fill)
│   │   └── .hp-text
│   └── .action-info (move name)
│
└── .opponent-lobster (top-right, mirrored with scaleX(-1))
```

**Key positioning:**
- Player: `bottom: 5px; left: 40px`
- Opponent: `top: 50%; right: 40px; transform: scaleX(-1)`

---

## 1.4 Move Data Available in Frontend

### Full Move Schema

```javascript
{
  // Identification
  id: "poke_fire_flamethrower",
  name: "Flamethrower",

  // For Visual Effects (KEY FIELDS)
  type: "FIRE",                    // 18 types available
  category: "physical" | "special", // Animation style
  power: 90,                       // Impact scaling

  // Mechanics
  accuracy: 100,
  pp: 15,
  priority: 0,

  // Effect (for special visuals)
  effect: {
    type: "status" | "recoil" | "drain" | "stat_boost" | "stat_drop" | "heal" | "flinch" | "high_crit",
    status: "burned" | "paralysis" | "poison" | "freeze" | "sleep" | "confusion",
    percent: number,
    stat: "attack" | "defense" | "sp_atk" | "sp_def" | "speed",
    stages: number
  }
}
```

### Battle Log Event Data

```javascript
// Damage event (most important for effects)
{
  type: 'damage',
  damage: 45,
  crit: true,
  typeEffectiveness: 1.5,  // 0.5, 1.0, or 1.5 (capped)
  remainingHP: 67,
  message: "Flamethrower dealt 45 damage! Critical hit! It's super effective!"
}

// Status event
{
  type: 'status_inflict',
  status: 'burned',
  message: "Opponent was burned!"
}

// Move use event
{
  type: 'use_move',
  move: "Flamethrower",
  moveType: "FIRE",
  movePower: 90,
  moveCategory: "special"
}
```

---

# 2. Identified Constraints

## 2.1 Mobile Performance Limits

### Current Performance Tier Detection

```javascript
// Already implemented in battle-particles.js
const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
const isLowEnd = navigator.hardwareConcurrency <= 4;
```

### Particle Budget

| Device Tier | Max Particles | Particles/Burst |
|-------------|---------------|-----------------|
| High (Desktop) | 200 | 20 |
| Medium (Mobile) | 100 | 12 |
| Low (Old devices) | 40 | 6 |

### Performance Rules

1. **Canvas is GPU-accelerated** - Particles are cheap
2. **CSS transforms are fast** - Use transform/opacity only
3. **Avoid layout thrashing** - Don't read then write DOM
4. **Particle pooling exists** - No runtime allocation

---

## 2.2 Existing CSS/JS Architecture

### What Already Exists (No Need to Build)

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| Particle System | `battle-particles.js` | 993 | Complete |
| Screen Shake | `battle-ui.js` | 351 | Complete |
| Damage Numbers | `battle-ui.js` | - | Complete |
| HP Bar Animation | `battle-ui.js` | - | Complete |
| Audio System | `battle-audio.js` | 752 | Complete |
| 82 CSS Animations | `arena.css` | 1,476 | Complete |

### Type Colors Already Defined

```javascript
TYPE_EFFECTS = {
  fire:     { colors: ['#ff4500', '#ff6b35', '#ffa500', '#ffcc00'] },
  water:    { colors: ['#1e90ff', '#00bfff', '#87ceeb'] },
  electric: { colors: ['#ffd700', '#ffff00', '#fff'] },
  ice:      { colors: ['#87ceeb', '#fff', '#add8e6'] },
  // ... all 18 types defined
}
```

### Available Shape Renderers

`circle`, `star`, `square`, `line`, `leaf`, `snowflake`, `bolt`, `ring`

---

## 2.3 Battle Replay Timing

### Current Speed System

```javascript
// Global multiplier affects all delays
_battleUISpeedMultiplier = 1.0;  // Default

// Usage: delay(ms / _battleUISpeedMultiplier)
// Speeds: 0.5x, 1x, 2x, 4x
```

### Event Timing Chain (1x speed)

```
Turn Start
  ├── 0ms: Phase detection
  ├── 0ms: Show move name (600ms display)
  ├── 100ms: Attacker animation starts
  ├── 200-450ms: Projectile travels
  ├── 450ms: Impact + shake + damage number
  ├── 800ms: Damage number fades
  ├── 900ms: Status effect pill (if any)
  ├── 1000ms: Second attacker begins (if both alive)
  └── 1600ms: Turn end pause
```

### Constraint: Effects Must Fit Within Timing

- Projectile effects: **200-450ms max**
- Impact effects: **400ms max**
- Status indicators: **Must be persistent (not timed)**

---

## 2.4 Browser Support Requirements

### Minimum Support

- Modern browsers (Chrome 80+, Firefox 75+, Safari 13+, Edge 80+)
- CSS Custom Properties (variables) - Supported
- Canvas 2D API - Universal support
- Web Audio API - Supported (with user interaction unlock)
- CSS Animations/Transitions - Universal

### No Polyfills Needed For

- `requestAnimationFrame`
- CSS `transform`, `opacity`, `filter`
- Canvas gradients and paths
- `async/await`

---

# 3. Success Criteria

## 3.1 Phase 1: Foundation (Type Colors + Basic Differentiation)

### Definition of Done

- [ ] All 18 types have distinct projectile colors
- [ ] Physical moves use `projectile`/`slash`/`charge` patterns
- [ ] Special moves use `beam`/`wave` patterns
- [ ] Screen shake scales with damage (light/medium/heavy)
- [ ] Defender flash on hit
- [ ] Floating damage numbers (already exists - verify)

### Measurable Criteria

| Metric | Target |
|--------|--------|
| Visual distinction between types | 18 unique colors |
| Physical vs Special looks different | 100% of moves |
| Frame rate on mobile | 60fps maintained |
| Effect plays correctly | 100% of attacks |

### Test Cases

1. Fire Flamethrower (special) → Orange beam
2. Water Tsunami Strike (physical) → Blue projectile with arc
3. Electric Volt Cannon (special) → Yellow beam with sparks
4. Martial Blitz Punch (physical) → Red slash/charge

---

## 3.2 Phase 2: Status Effects + Critical Hits

### Definition of Done

- [ ] Persistent status indicators on affected lobster
- [ ] Burn: Flame icon + flicker effect
- [ ] Poison: Skull icon + purple drip
- [ ] Paralysis: Lightning icon + jitter
- [ ] Freeze: Ice overlay + snowflakes
- [ ] Sleep: Zzz animation
- [ ] Confusion: Spiral/stars
- [ ] Critical hits have dramatic zoom + flash
- [ ] "Super Effective!" callout on 1.5x hits

### Measurable Criteria

| Metric | Target |
|--------|--------|
| Status visually identifiable | 6 distinct indicators |
| Critical hit feels impactful | Zoom + double flash |
| Super effective clearly called out | Text + sound |

### Test Cases

1. Apply burn → See persistent flame icon
2. Land critical → See zoom effect + "CRITICAL!" text
3. Super effective hit → See "Super Effective!" callout

---

## 3.3 Phase 3: Move-Specific Polish

### Definition of Done

- [ ] Singing moves (Lullaby, Dissonance) → Musical notes
- [ ] Drain moves → Green orbs flowing TO attacker
- [ ] Healing moves → Green sparkles on self
- [ ] Stat boost → Upward arrows + glow
- [ ] Stat drop → Downward arrows on target
- [ ] Recoil → Self-flash after attack
- [ ] High-power moves (100+) → Extra particles + stronger shake

### Measurable Criteria

| Metric | Target |
|--------|--------|
| Unique effect categories | 10+ distinct visuals |
| All 174 moves have appropriate effect | 100% coverage |
| Effects match move theme | Subjective review pass |

---

## 3.4 How to Test That Effects "Feel Good"

### Quantitative Tests

1. **Frame rate monitor** - Must stay above 55fps on mobile
2. **Timing verification** - Effects complete within turn window
3. **Coverage test** - Every move type renders correctly

### Qualitative Tests

1. **A/B comparison** - Record before/after videos
2. **User feedback** - "Which battle looks more exciting?"
3. **Watch test** - Can you tell move types apart at 4x speed?
4. **Immersion test** - Do you feel the impact of big hits?

### Review Checklist

- [ ] Fire looks like fire (not water)
- [ ] Big damage = big effect
- [ ] Critical hits feel special
- [ ] Status effects are immediately recognizable
- [ ] Battles are fun to watch at 1x speed
- [ ] Effects don't obscure important info (HP, names)

---

## 3.5 Fallback If Effects Fail to Load

### Graceful Degradation

```javascript
// Already in battle-particles.js
try {
  playAttackAnimation(moveType, isPlayer, options);
} catch (e) {
  console.warn('Particle effect failed, using fallback');
  // Fallback: Just show damage number + basic shake
  showDamageNumber(side, damage, crit);
  screenShake('light');
}
```

### Fallback Hierarchy

1. **Full effects** → Particles + shake + flash + sound
2. **Reduced effects** → Shake + damage number (no particles)
3. **Minimal effects** → Damage number only
4. **Text only** → Battle log message

### Error Recovery

- Canvas context lost → Reinitialize on next attack
- Audio blocked → Silent mode (visuals only)
- Low performance detected → Auto-reduce particle count

---

# 4. Living Reference System

## 4.1 Effect Component Architecture

### Composable Effect System

Instead of 174 unique effects, use **composable components**:

```
Effect = Projectile Style + Type Color + Impact Effect + Special Modifier
```

### Projectile Styles (5 base patterns)

| Style | Animation | Best For |
|-------|-----------|----------|
| `beam` | Instant line | Special ranged |
| `projectile` | Flying ball | Physical ranged |
| `arc` | Parabolic path | Thrown objects |
| `slash` | Quick thrust | Melee physical |
| `charge` | Attacker lunges | Contact moves |
| `wave` | Expanding rings | AOE specials |

### Type Colors (18 palettes)

| Type | Primary | Secondary | Particle Shape |
|------|---------|-----------|----------------|
| NEUTRAL | `#c8c8c8` | `#ffffff` | circle |
| FIRE | `#ff4500` | `#ffa500` | star, circle |
| WATER | `#1e90ff` | `#00bfff` | circle |
| ELECTRIC | `#ffd700` | `#ffff00` | bolt, line |
| GRASS | `#32cd32` | `#90ee90` | leaf |
| ICE | `#87ceeb` | `#ffffff` | snowflake, star |
| MARTIAL | `#dc143c` | `#ff6347` | star, ring |
| VENOM | `#9400d3` | `#32cd32` | circle (bubble) |
| EARTH | `#8b4513` | `#d2691e` | square |
| AIR | `#e0ffff` | `#b0e0e6` | line (wind) |
| PSYCHE | `#ff69b4` | `#da70d6` | ring, star |
| INSECT | `#9acd32` | `#6b8e23` | circle |
| STONE | `#808080` | `#a9a9a9` | square |
| GHOST | `#4b0082` | `#8a2be2` | circle (wisp) |
| DRAGON | `#4169e1` | `#7b68ee` | star |
| SHADOW | `#1a1a2e` | `#16213e` | circle |
| METAL | `#c0c0c0` | `#708090` | square, line |
| MYSTIC | `#ff1493` | `#ffc0cb` | star |

### Impact Effects (4 levels)

| Damage % | Shake | Flash | Particles |
|----------|-------|-------|-----------|
| 1-15% | None | None | 8 |
| 16-30% | Light | Subtle | 12 |
| 31-50% | Medium | Normal | 16 |
| 51%+ | Heavy | Bright | 20+ |
| Critical | Heavy + zoom | Double | 25 |

### Special Modifiers

| Effect Type | Visual Modifier |
|-------------|-----------------|
| `status` | + Status particle burst on target |
| `drain` | + Reverse particle flow (green) |
| `heal` | + Green sparkles on self |
| `recoil` | + Self-flash after attack |
| `stat_boost` | + Upward arrows on self |
| `stat_drop` | + Downward arrows on target |
| `flinch` | + Stun stars on target |
| `high_crit` | + Extra flash on crit |

---

## 4.2 Move-to-Effect Mapping Strategy

### Automatic Mapping Rules

```javascript
function getEffectConfig(move) {
  return {
    // Base pattern from category
    pattern: move.category === 'physical' ? 'projectile' : 'beam',

    // Colors from type
    colors: TYPE_EFFECTS[move.type.toLowerCase()].colors,

    // Scale from power
    particleCount: Math.floor(8 + (move.power / 10)),
    shakeIntensity: move.power >= 80 ? 'medium' : 'light',

    // Special from effect type
    special: move.effect?.type || null
  };
}
```

### Override Map for Special Moves

Some moves need custom effects beyond auto-mapping:

```javascript
const MOVE_OVERRIDES = {
  // Singing moves → Musical notes
  'Lullaby': { pattern: 'wave', particles: ['note'], special: 'sleep' },
  'Dissonance': { pattern: 'wave', particles: ['note'], special: 'confusion' },

  // Arc projectiles
  'Tsunami Strike': { pattern: 'arc', particles: ['circle'] },
  'Stone Throw': { pattern: 'arc', particles: ['square'] },

  // Multi-hit
  'Bubble Burst': { pattern: 'projectile', count: 5, staggered: true },

  // Charge attacks
  'Blazing Charge': { pattern: 'charge', trail: true },
  'Reckless Charge': { pattern: 'charge', trail: true, recoil: true },
};
```

---

# 5. Recommendations

## 5.1 What We Should Build

### Phase 1: Enhance Existing System (Low Effort, High Impact)

The particle system **already exists**. We just need to:

1. **Verify type color mapping** is complete for all 18 types
2. **Add pattern selection logic** based on move category
3. **Scale effects by power** (bigger moves = more particles)
4. **Ensure damage-based shake** works correctly

**Estimated effort:** 1-2 hours (configuration, not new code)

### Phase 2: Add Missing Visual Feedback

1. **Persistent status indicators** (CSS + small DOM elements)
2. **Critical hit zoom effect** (CSS animation)
3. **Super effective callout** (already exists as `showEffectFloat()`)

**Estimated effort:** 3-4 hours

### Phase 3: Move-Specific Polish

1. **Create override map** for special moves
2. **Add musical note particles** for singing moves
3. **Add drain reverse-flow** effect
4. **Test all 174 moves** for appropriate visuals

**Estimated effort:** 4-6 hours

---

## 5.2 What We Should NOT Build

| Don't Build | Why |
|-------------|-----|
| New particle engine | Existing one is excellent |
| GSAP/animation library | CSS handles everything |
| Complex physics | Overkill for battle viewer |
| Per-move custom animations | Composable system is better |
| Sound redesign | Audio system already complete |

---

## 5.3 Why This Recommendation is Best

### Leverages Existing Infrastructure

- 993 lines of particle code already written
- 82 CSS animations already defined
- Type colors already mapped
- Audio already synced

### Minimal Risk

- No new dependencies
- No architectural changes
- Incremental enhancement
- Easy to test each phase

### Maximum Impact

- All 174 moves get distinct visuals
- Only ~20 components needed (not 174)
- Mobile performance maintained
- Backwards compatible

### Maintainable

- New moves auto-map to effects
- Override system for special cases
- Clear documentation
- Single source of truth for colors

---

## 5.4 Implementation Order

```
Week 1: Phase 1 (Foundation)
├── Day 1: Audit existing particle system
├── Day 2: Verify/fix type color mapping
├── Day 3: Add category-based pattern selection
├── Day 4: Implement power-based scaling
└── Day 5: Test all 18 types

Week 2: Phase 2 (Status + Crits)
├── Day 1: Design status indicator CSS
├── Day 2: Implement 6 status indicators
├── Day 3: Add critical hit zoom effect
├── Day 4: Add super effective callout
└── Day 5: Test all status effects

Week 3: Phase 3 (Polish)
├── Day 1: Create move override map
├── Day 2: Add special particles (notes, etc.)
├── Day 3: Add drain/heal visuals
├── Day 4: Add stat change visuals
└── Day 5: Full 174-move test pass
```

---

## 5.5 Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Performance regression | Test on mobile after each change |
| Effects obscure gameplay | Keep particles behind UI (z-index) |
| Timing breaks at 4x speed | Test all speeds during development |
| Type colors clash | Use existing tested palette |
| Scope creep | Strict phase boundaries |

---

*Research completed. Ready for planning phase.*
