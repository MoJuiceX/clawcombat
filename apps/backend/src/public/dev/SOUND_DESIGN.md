# ClawCombat Attack Sound Design System

## Overview

Every attack has TWO distinct sounds:
1. **Attack Sound** - Plays when animation STARTS (the "whoosh" or "zap")
2. **Impact Sound** - Plays when attack HITS the defender (the "thud" or "crash")

## Available Sound Files (15 total)

| File | Character | Best For |
|------|-----------|----------|
| beam.wav | Sustained energy hum | Beams, rays, continuous attacks |
| charge.wav | Building power, rush | Charge attacks, tackles |
| projectile.wav | Whoosh, travel | Single projectiles, thrown objects |
| slash.wav | Sharp, quick cut | Slashing, cutting, claws |
| wave.wav | Expanding energy | Waves, pulses, area attacks |
| drain.wav | Pulling, sucking | Drain, leech, absorb attacks |
| electric.wav | Crackling, zapping | All electric attacks |
| strike.wav | Light impact | Weak hits (power < 60) |
| hit.wav | Medium impact | Normal hits (power 60-89) |
| burst.wav | Heavy impact | Strong hits (power 90+) |
| shield.wav | Rising energy | Defensive buffs, barriers |
| boost.wav | Power up | Stat boosts, self-buffs |
| status.wav | Mystical effect | Status conditions |
| heal.wav | Restorative chime | Healing moves |
| spin.wav | Whoosh/miss | Misses, dodges |

---

## ATTACK SOUND MAPPING

### By Pattern (Base Sound)

| Pattern | Base Sound | Pitch | Why |
|---------|------------|-------|-----|
| beam | beam.wav | 1.0 | Continuous energy projection |
| projectile | projectile.wav | 1.0 | Single object traveling |
| arc | projectile.wav | 0.75 | Heavier thrown object |
| charge | charge.wav | 1.0 | Buildup then rush forward |
| slash | slash.wav | 1.0 | Quick cutting motion |
| wave | wave.wav | 1.0 | Expanding outward |
| swarm | projectile.wav | 1.4 | Multiple fast projectiles |
| drain | drain.wav | 1.0 | Energy being pulled |
| self_aura | shield.wav | 1.0 | Powering up self |
| status_drift | status.wav | 0.9 | Mystical floating effect |

### By Type (Pitch Modifier)

Types modify the base sound's pitch to give elemental character:

| Type | Pitch Modifier | Character |
|------|---------------|-----------|
| FIRE | -15% (0.85x) | Deep, roaring, crackling |
| WATER | +10% (1.10x) | Fluid, splashing |
| ELECTRIC | OVERRIDE → electric.wav | Crackling, zapping |
| GRASS | +5% (1.05x) | Natural, rustling |
| ICE | +20% (1.20x) | Crystalline, sharp |
| MARTIAL | 0% (1.00x) | Clean, physical |
| VENOM | -8% (0.92x) | Bubbling, toxic |
| EARTH | -20% (0.80x) | Heavy, rumbling |
| AIR | +15% (1.15x) | Light, whistling |
| PSYCHE | +10% (1.10x) | Mental, resonant |
| INSECT | +25% (1.25x) | Buzzing, chittering |
| STONE | -18% (0.82x) | Rocky, grinding |
| GHOST | +15% (1.15x) | Ethereal, hollow |
| DRAGON | -25% (0.75x) | Deep, powerful, roaring |
| SHADOW | -10% (0.90x) | Dark, muffled |
| METAL | -5% (0.95x) | Metallic, ringing |
| MYSTIC | +12% (1.12x) | Magical, sparkling |
| NEUTRAL | 0% (1.00x) | Plain, unmodified |

### Attack Sound Formula

```
Attack Sound = Pattern Base Sound × Type Pitch Modifier

Example: Dragon Pulse (beam + dragon)
- Base: beam.wav at 1.0
- Type modifier: -25%
- Result: beam.wav at 0.75 pitch (deep, powerful beam)

Example: Deep Freeze (beam + ice)
- Base: beam.wav at 1.0
- Type modifier: +20%
- Result: beam.wav at 1.20 pitch (high, crystalline beam)

Example: Volt Cannon (beam + electric)
- Base: beam.wav
- Type: OVERRIDE to electric.wav
- Result: electric.wav at 1.0 (crackling energy)
```

---

## IMPACT SOUND MAPPING

### By Power Level (Base Impact)

| Power Range | Base Sound | Character |
|-------------|------------|-----------|
| 0 (Status) | status.wav | No physical impact |
| 1-59 | strike.wav | Light tap |
| 60-89 | hit.wav | Solid impact |
| 90-109 | burst.wav | Heavy hit |
| 110+ | burst.wav + shake | Devastating blow |

### By Type (Impact Modifier)

| Type | Pitch Modifier | Additional Effect |
|------|---------------|-------------------|
| FIRE | -10% | Slightly deeper impact |
| WATER | +5% | Splashy |
| ELECTRIC | +15% | Crackling finish |
| GRASS | 0% | Natural |
| ICE | +10% | Sharp, cracking |
| MARTIAL | -5% | Solid, physical |
| VENOM | 0% | Wet |
| EARTH | -15% | Heavy thud |
| AIR | +10% | Light |
| PSYCHE | +5% | Resonant |
| INSECT | +10% | Quick |
| STONE | -20% | Heavy crunch |
| GHOST | +20% | Hollow |
| DRAGON | -15% | Powerful |
| SHADOW | -5% | Dark |
| METAL | -10% | Metallic ring |
| MYSTIC | +8% | Magical |
| NEUTRAL | 0% | Plain |

### Impact Sound Formula

```
Impact Sound = Power Base Sound × Type Pitch Modifier

Example: Draco Meteor (power 130, dragon)
- Base: burst.wav (power 110+)
- Type modifier: -15%
- Result: burst.wav at 0.85 pitch + screen shake

Example: Splash Shot (power 40, water)
- Base: strike.wav (power < 60)
- Type modifier: +5%
- Result: strike.wav at 1.05 pitch (light splashy hit)
```

---

## COMPLETE ATTACK EXAMPLES

### Flamethrower (beam, fire, power 90)
1. **Attack**: beam.wav at 0.85 pitch (deep fiery beam)
2. **Impact**: burst.wav at 0.90 pitch (heavy fire hit)

### Lightning Strike (projectile, electric, power 75)
1. **Attack**: electric.wav at 1.0 (crackling bolt)
2. **Impact**: hit.wav at 1.15 pitch (zapping impact)

### Rapid Jab (slash, martial, power 40)
1. **Attack**: slash.wav at 1.0 (quick cuts)
2. **Impact**: strike.wav at 0.95 pitch (physical hits)

### Snowstorm (wave, ice, power 110)
1. **Attack**: wave.wav at 1.20 pitch (crystalline expansion)
2. **Impact**: burst.wav at 1.10 pitch + shake (icy devastation)

### Life Leech (drain, grass, power 75)
1. **Attack**: drain.wav at 1.05 pitch (natural drain)
2. **Impact**: hit.wav at 1.0 pitch (energy absorbed)

### Shadow Assault (charge, shadow, power 80)
1. **Attack**: charge.wav at 0.90 pitch (dark rush)
2. **Impact**: hit.wav at 0.95 pitch (shadow strike)

---

## AUDIT CHECKLIST

When testing each effect, verify:

1. [ ] Attack sound plays when animation STARTS
2. [ ] Attack sound matches the pattern (beam sounds like beam, slash sounds like slash)
3. [ ] Attack sound pitch feels right for the type (fire = deep, ice = high)
4. [ ] Impact sound plays when effect REACHES defender
5. [ ] Impact sound intensity matches power (weak = light tap, strong = heavy hit)
6. [ ] Impact sound pitch feels right for the type
7. [ ] Timing is synchronized (sound + visual + shake happen together)
8. [ ] Overall feel: Does this SOUND like what the attack NAME suggests?

---

## ISSUES TO REPORT

- **"timing-off"**: Sound doesn't sync with visual
- **"too-fast"**: Animation too quick to appreciate
- **"too-slow"**: Animation drags
- **"wrong-color"**: Visual doesn't match type
- **"wrong-pattern"**: Animation style doesn't fit the move
- **"looks-weak"**: Effect underwhelming for the power level
- **"not-visible"**: Can't see the effect
- **"wrong-direction"**: Effect goes the wrong way

For sound-specific issues, use the notes field:
- "attack sound too quiet"
- "impact sound missing"
- "sounds like wrong element"
- "needs more bass/treble"
