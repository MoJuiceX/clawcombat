# Frontend Battle UI

Browser-side JavaScript for battle animations, audio, and UI.

## Files Overview (~105KB total)

| File | Size | Purpose |
|------|------|---------|
| `battle-particles.js` | 45KB | Canvas particle effects for all 18 types |
| `battle-audio.js` | 26KB | Sound effects, music, WAV caching |
| `battle-ui.js` | 18KB | HP bars, damage numbers, turn history |
| `auth.js` | 8KB | Clerk auth integration |
| `analytics.js` | 6KB | Event tracking |
| `animated-bg.js` | 3KB | Background animations |

## Battle Particles System

Canvas-based particle effects with 9 attack styles:

| Style | Description |
|-------|-------------|
| `beam` | Continuous line from attacker to target |
| `projectile` | Single object traveling to target |
| `arc` | Curved projectile path |
| `charge` | Build-up effect at attacker |
| `slash` | Quick slash lines across target |
| `wave` | Expanding ring/wave |
| `swarm` | Multiple small projectiles |
| `drain` | Particles from target to attacker |
| `status` | Effect on target (no travel) |

### Type Effect Configurations (18 types)
```javascript
// Each type has unique visual properties
var TYPE_EFFECTS = {
  fire: {
    colors: ['#ff4500', '#ff6b35', '#ffa500', '#ffcc00', '#fff'],
    flashColor: 'rgba(255, 100, 0, 0.3)',
    shapes: ['circle', 'star'],
    gravity: -0.05,  // Flames rise
    sound: 'burst'
  },
  // ... 17 more types
};
```

### 140+ Move-Specific Overrides
```javascript
// Signature moves have custom effects
var MOVE_EFFECTS = {
  'poke_fire_flamethrower': { style: 'beam', duration: 800 },
  'poke_electric_thunderbolt': { style: 'projectile', particles: 50 },
  // ...
};
```

## Battle UI Helpers

Used by: `demo.html`, `arena.html`, `replay.html`

### HP Bar System
```javascript
// Animated HP bar with ghost effect
updateHPBar('player', currentHP, maxHP);
// Shows red ghost bar during damage, green for healing
```

### Damage Numbers
```javascript
// Floating damage with effectiveness colors
showDamageNumber('opponent', 150, 2.0);  // Super effective (red)
showDamageNumber('player', 50, 0.5);     // Not very (gray)
```

### Type Colors (ClawCombat naming)
```javascript
var TYPE_COLORS = {
  neutral: '#A8A878', fire: '#F08030', water: '#6890F0',
  electric: '#F8D030', grass: '#78C850', ice: '#98D8D8',
  martial: '#C03028', venom: '#A040A0', earth: '#E0C068',
  air: '#A890F0', psyche: '#F85888', insect: '#A8B820',
  stone: '#B8A038', ghost: '#705898', dragon: '#7038F8',
  shadow: '#705848', metal: '#B8B8D0', mystic: '#EE99AC'
};
```

## Battle Audio

WAV-based sound effects with browser caching.

### Sound Categories
```javascript
// Attack sounds by type
playSound('burst');    // Fire, earth, stone
playSound('wave');     // Water, psyche
playSound('electric'); // Electric (lightning crackle)
playSound('slash');    // Grass, air, martial
playSound('hit');      // Default impact
playSound('status');   // Status effects

// UI sounds
playSound('victory');
playSound('defeat');
playSound('levelup');
```

### Music System
```javascript
// Background battle music
BattleMusic.play();   // Start loop
BattleMusic.stop();   // Fade out
BattleMusic.setVolume(0.5);
```

## Speed Multiplier (Replay)

```javascript
// For replay mode: 0.5x, 1x, 2x, 4x speeds
setSpeedMultiplier(2);  // Double speed
delay(1000);            // Actually waits 500ms
```

## Integration with Backend

These files are served statically from `/public/js/`.
They consume battle data from:
- `/api/demo/battle` - Anonymous demo battles
- `/api/arena/battle/:id` - Authenticated battles
- `/api/battles/:id/replay` - Battle replays

## Gotchas
- **Type naming:** Frontend uses ClawCombat names (martial, venom, earth) not Pokemon names
- **Canvas resize:** Particle canvas must be resized on window resize
- **Audio autoplay:** Browsers block autoplay - requires user interaction first
- **Speed multiplier:** All delays divided by multiplier (50ms minimum)
- **Ghost HP bar:** Delayed shrink requires timer cleanup on rapid damage
