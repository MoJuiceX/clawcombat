# Move-to-Effect Mapping Reference

This document maps all 174 ClawCombat moves to their visual effect components.

---

## Effect Composition System

Each move's visual effect is composed of:

```
Effect = Base Pattern + Type Color + Power Scale + Special Modifier
```

### Base Patterns (Auto-assigned by category)

| Category | Default Pattern | Description |
|----------|-----------------|-------------|
| `physical` | `projectile` | Ball/object flies to target |
| `special` | `beam` | Energy beam/ray to target |
| `status` (power=0) | `wave` | Expanding aura effect |

### Pattern Overrides

Some moves need specific patterns regardless of category:

| Pattern | Moves That Use It |
|---------|-------------------|
| `arc` | Thrown objects (Stone Throw, Tsunami Strike) |
| `slash` | Quick melee (Edge Strike, Phantom Slash, Dragon Claw) |
| `charge` | Contact moves with recoil (Blazing Charge, Reckless Charge) |
| `wave` | Status moves, AOE effects (Shock Wave, Lava Plume) |
| `swarm` | Multi-hit visuals (Bubble Burst) |

---

## Type Color Palettes

| Type | Primary | Secondary | Tertiary | Shapes |
|------|---------|-----------|----------|--------|
| NEUTRAL | `#c8c8c8` | `#ffffff` | `#e0e0e0` | circle |
| FIRE | `#ff4500` | `#ffa500` | `#ffcc00` | star, circle |
| WATER | `#1e90ff` | `#00bfff` | `#87ceeb` | circle |
| ELECTRIC | `#ffd700` | `#ffff00` | `#ffffff` | bolt, line |
| GRASS | `#32cd32` | `#90ee90` | `#228b22` | leaf |
| ICE | `#87ceeb` | `#ffffff` | `#add8e6` | snowflake, star |
| MARTIAL | `#dc143c` | `#ff6347` | `#ff4500` | star, ring |
| VENOM | `#9400d3` | `#8b008b` | `#32cd32` | circle |
| EARTH | `#8b4513` | `#d2691e` | `#deb887` | square |
| AIR | `#e0ffff` | `#b0e0e6` | `#ffffff` | line |
| PSYCHE | `#ff69b4` | `#da70d6` | `#dda0dd` | ring, star |
| INSECT | `#9acd32` | `#6b8e23` | `#556b2f` | circle |
| STONE | `#808080` | `#a9a9a9` | `#696969` | square |
| GHOST | `#4b0082` | `#8a2be2` | `#9370db` | circle |
| DRAGON | `#4169e1` | `#7b68ee` | `#6a5acd` | star |
| SHADOW | `#1a1a2e` | `#16213e` | `#0f0f23` | circle |
| METAL | `#c0c0c0` | `#708090` | `#b0c4de` | square, line |
| MYSTIC | `#ff1493` | `#ffc0cb` | `#ffb6c1` | star |

---

## Power-Based Scaling

| Power Range | Particle Count | Shake | Flash |
|-------------|----------------|-------|-------|
| 0 (status) | 10 | none | none |
| 1-40 | 12 | none | none |
| 41-60 | 15 | light | none |
| 61-80 | 18 | light | subtle |
| 81-100 | 22 | medium | normal |
| 101-120 | 28 | heavy | bright |
| 121+ | 35 | heavy | flash |

---

## Special Effect Modifiers

### By Effect Type

| effect.type | Visual Modifier |
|-------------|-----------------|
| `status:burned` | Orange-red particles + burn status icon |
| `status:paralysis` | Yellow sparks + paralysis icon |
| `status:poison` | Purple bubbles + poison icon |
| `status:sleep` | Pink pollen + Zzz animation |
| `status:freeze` | Ice shards + freeze overlay |
| `status:confusion` | Spiral + confusion stars |
| `drain` | Green orbs flow FROM target TO attacker |
| `heal` | Green sparkles rise on self |
| `recoil` | Self-flash red after attack lands |
| `stat_boost` | Green upward arrows on self |
| `stat_drop` | Red downward arrows on target |
| `flinch` | Stun stars on target |
| `high_crit` | Extra flash on critical hit |
| `priority` | Speed lines before attack |

---

## Complete Move Mapping

### NEUTRAL (9 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Pummel | `projectile` | - |
| Lucky Strike | `projectile` | coin sparkle |
| Rapid Jab | `slash` | priority lines |
| Lullaby | `wave` | musical notes (♪♫♬) |
| Dissonance | `wave` | musical notes + spiral |
| Regenerate | `self_aura` | heal sparkles |
| War Posture | `self_aura` | stat boost arrows |
| Mock | `wave` | stat drop arrows |
| Reckless Charge | `charge` | recoil flash |

### FIRE (10 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Blazing Charge | `charge` | flame trail + recoil |
| Burning Strike | `slash` | burn chance |
| Hot Coal | `projectile` | ember particles |
| Ember Ward | `self_aura` | shield glow |
| Ghost Burn | `wave` | blue-white flames |
| Thermal Overload | `beam` | explosion + stat drop |
| Flamethrower | `beam` | continuous flame |
| Flame Charge | `charge` | flame trail + speed boost |
| Lava Plume | `wave` | eruption from below |
| Fire Spin | `wave` | fire vortex |

### WATER (8 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Tsunami Strike | `arc` | giant wave |
| Splash Shot | `projectile` | water droplets |
| Bubble Burst | `swarm` | multiple bubbles |
| Tide Rush | `charge` | water streak + priority |
| Drain Bubble | `projectile` | drain flow back |
| Fortify | `self_aura` | water shield |
| Rapids Charge | `charge` | water rush + flinch |
| Claw Crusher | `slash` | high crit flash |

### ELECTRIC (11 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Storm Charge | `charge` | lightning body |
| Volt Cannon | `beam` | electric beam |
| Arc Cannon | `beam` | branching lightning |
| Lightning Strike | `projectile` | bolt from above |
| Spark | `projectile` | small sparks |
| Instant Jolt | `slash` | priority + zap |
| Shock Wave | `wave` | expanding ring |
| Store Energy | `self_aura` | charging glow |
| Static Field | `wave` | field on target |
| Thunder Rush | `charge` | recoil + sparks |
| Volt Strike | `slash` | flinch + sparks |

### GRASS (10 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Radiant Edge | `slash` | glowing leaf blade |
| Stem Strike | `slash` | vine whip |
| Life Leech | `beam` | drain green orbs |
| Thorn Guard | `self_aura` | thorns + priority |
| Spore Shock | `wave` | yellow spores |
| Dream Pollen | `wave` | pink pollen + sleep |
| Drain Root | `beam` | roots + drain |
| Fiber Shield | `self_aura` | vine wrap + boost |
| Fiber Cloud | `wave` | cotton cloud |
| Branch Breaker | `charge` | branch slam + recoil |

### ICE (8 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Frost Pike | `slash` | ice spear thrust |
| Frozen Knuckle | `slash` | icy fist + freeze |
| Northern Light | `beam` | aurora beam |
| Quick Freeze | `slash` | priority ice streak |
| Deep Freeze | `beam` | massive ice explosion |
| Frozen Crush | `charge` | ice slam + flinch |
| Chill Blast | `beam` | ice beam + high crit |
| Snowstorm | `wave` | blizzard swirl |

### MARTIAL (8 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Chi Burst | `wave` | orange energy wave |
| Edge Strike | `slash` | karate chop + high crit |
| Blitz Punch | `slash` | speed blur + priority |
| Anticipate | `self_aura` | focus glow + priority |
| Vitality Punch | `slash` | drain green flow |
| Power Stance | `self_aura` | power-up red glow |
| Spin Kick | `slash` | spinning arc + flinch |
| Scissor Chop | `slash` | X-slash + high crit |

### VENOM (11 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Toxin Blast | `charge` | toxic explosion |
| Noxious Burst | `beam` | purple burst |
| Poison Wheel | `charge` | spinning toxic |
| Corrosive | `projectile` | acid drip |
| Sludge Shot | `projectile` | sludge ball |
| Toxic Shield | `self_aura` | barrier + priority |
| Venom Dust | `wave` | poison cloud |
| Deadly Dose | `wave` | skull icon |
| Detoxify | `self_aura` | cleansing heal |
| Slime Coat | `self_aura` | slime layer + boost |
| Toxin Spray | `wave` | poison mist |

### EARTH (10 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Earth Cleaver | `slash` | ground crack |
| Desert Fury | `wave` | sandstorm blast |
| Ground Slam | `charge` | earthquake impact |
| Earth Stomp | `charge` | ground pound |
| Burning Dunes | `wave` | hot sand swirl |
| Dust Recovery | `self_aura` | healing dust |
| Dust Throw | `projectile` | sand throw |
| Earth Splitter | `wave` | massive ground split |
| Club Strike | `slash` | rock club + flinch |
| Dig Attack | `charge` | underground + high crit |

### AIR (9 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Cyclone | `wave` | tornado |
| Reckless Swoop | `charge` | dive bomb + recoil |
| Wind Puff | `projectile` | air gust |
| Sky Strike | `slash` | aerial strike |
| Perch | `self_aura` | feather rest heal |
| Downdraft | `wave` | wind push down |
| Sky Razor | `slash` | air blade + flinch |
| Air Cannon | `beam` | compressed air |
| Heaven Charge | `charge` | sky dive slam |

### PSYCHE (11 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Mental Crush | `charge` | mind impact |
| Fate Strike | `beam` | destiny energy |
| Mind Ray | `beam` | pink/purple beam |
| Perplex | `wave` | spiral confusion |
| Mirror Mind | `self_aura` | reflective + priority |
| Mesmerize | `wave` | hypnotic swirl |
| Dream Drain | `beam` | dream siphon + drain |
| Concentrate | `self_aura` | focus glow + boost |
| Mind Bend | `wave` | mental distortion |
| Sixth Sense | `beam` | premonition + flinch |
| Thought Edge | `slash` | psychic blade + high crit |

### INSECT (10 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Exo Lance | `slash` | stinger thrust |
| Insect Wail | `wave` | bug screech |
| Hive Strike | `swarm` | swarm attack + high crit |
| Glitter Breeze | `wave` | shimmering scales |
| Beacon Blast | `beam` | bright flash + confusion |
| Aggro Dust | `wave` | irritant + priority |
| Life Drain | `slash` | bug bite + drain |
| Bioluminescence | `self_aura` | glowing aura |
| Web Trap | `projectile` | web spray |
| Exo Slam | `charge` | exoskeleton bash |

### STONE (8 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Cosmic Stone | `arc` | meteor strike |
| Primal Force | `beam` | ancient energy |
| Stone Throw | `arc` | rock toss |
| Geo Barrier | `self_aura` | stone wall + priority |
| Stone Sharpen | `self_aura` | rock grind + boost |
| Crude Coat | `wave` | rock dust slow |
| Avalanche | `swarm` | falling rocks + flinch |
| Mineral Blade | `slash` | crystal slash + high crit |

### GHOST (10 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Phantom Strike | `charge` | ghost fist |
| Spirit Volley | `swarm` | ghost projectiles |
| Curse Throw | `arc` | cursed object |
| Phantom Fist | `slash` | ghostly punch |
| Phantom Slash | `slash` | ghost claw + high crit |
| Ghost Rush | `charge` | phase-through + priority |
| Bewilderment | `wave` | spooky faces |
| Shadow Ball | `projectile` | dark sphere |
| Hex | `beam` | curse symbol |
| Curse | `wave` | flame curse |

### DRAGON (10 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Rampage | `charge` | feral charge |
| Serpent Fume | `beam` | dragon breath |
| Vortex | `wave` | dragon wind + flinch |
| Serpent Form | `self_aura` | transformation |
| Serpent Tackle | `charge` | dragon charge + flinch |
| Reality Rip | `beam` | dimension tear + high crit |
| Dragon Claw | `slash` | dragon slash |
| Dragon Pulse | `beam` | dragon energy |
| Draco Meteor | `arc` | meteor shower |
| Dragon Tail | `slash` | tail swipe + flinch |

### SHADOW (12 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Shadow Assault | `charge` | dark rush |
| Burning Rage | `beam` | dark fire + flinch |
| Dirty Trick | `slash` | sneaky attack |
| Gnash | `slash` | dark bite + flinch |
| Swipe | `slash` | quick dark slash |
| Hijack | `wave` | mind control + priority |
| Deceive | `wave` | illusion confusion |
| Void Sleep | `wave` | dark cloud + sleep |
| Malicious Intent | `self_aura` | evil aura + boost |
| Final Curse | `wave` | death curse |
| Shadow Wave | `wave` | dark wave + flinch |
| Shadow Blade | `slash` | dark sword + high crit |

### METAL (10 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Metal Grinder | `charge` | gear/blade grind |
| Iron Fist | `slash` | fast metal punch + priority |
| Metal Sphere | `projectile` | iron ball |
| Royal Guard | `self_aura` | shield stance + priority |
| Steel Skin | `self_aura` | metal coating |
| Iron Wail | `wave` | metal screech |
| Metal Skull | `charge` | headbutt + flinch |
| Flash Cannon | `beam` | metal beam |
| Metal Claw | `slash` | iron claw + boost |
| Steel Wing | `slash` | metal wing + boost |

### MYSTIC (9 moves)

| Move | Pattern | Special |
|------|---------|---------|
| Mystic Wheel | `charge` | magical wheel |
| Bloom Blast | `wave` | flower explosion |
| Soothing Cry | `wave` | healing sound |
| Life Kiss | `projectile` | pink hearts + drain |
| Trick Guard | `self_aura` | fairy barrier + priority |
| Addling Kiss | `wave` | confusing kiss |
| Lunar Glow | `self_aura` | moon healing |
| Earth Magic | `self_aura` | nature magic + boost |
| Captivate | `wave` | charm effect |

---

## Implementation Config (JSON)

```javascript
// effect-config.js
const MOVE_OVERRIDES = {
  // Musical notes for singing moves
  'Lullaby': { particles: ['♪', '♫', '♬'], pattern: 'wave' },
  'Dissonance': { particles: ['♪', '♫', '♬'], pattern: 'wave' },
  'Soothing Cry': { particles: ['♪', '♫'], pattern: 'wave' },

  // Arc trajectories for thrown objects
  'Tsunami Strike': { pattern: 'arc' },
  'Stone Throw': { pattern: 'arc' },
  'Cosmic Stone': { pattern: 'arc' },
  'Curse Throw': { pattern: 'arc' },
  'Draco Meteor': { pattern: 'arc' },

  // Multi-hit swarm effects
  'Bubble Burst': { pattern: 'swarm', count: 5 },
  'Spirit Volley': { pattern: 'swarm', count: 4 },
  'Hive Strike': { pattern: 'swarm', count: 6 },
  'Avalanche': { pattern: 'swarm', count: 5 },

  // Charge attacks with trails
  'Blazing Charge': { pattern: 'charge', trail: true },
  'Reckless Charge': { pattern: 'charge', trail: true },
  'Thunder Rush': { pattern: 'charge', trail: true },
  'Branch Breaker': { pattern: 'charge', trail: true },
  'Reckless Swoop': { pattern: 'charge', trail: true },
};

// Default pattern selection
function getPattern(move) {
  if (MOVE_OVERRIDES[move.name]?.pattern) {
    return MOVE_OVERRIDES[move.name].pattern;
  }
  if (move.power === 0) return 'wave';  // Status moves
  if (move.category === 'physical') return 'projectile';
  return 'beam';  // Special moves
}
```

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Total moves | 174 |
| Physical moves | 69 |
| Special moves | 105 |
| Status-only moves | 33 |
| Moves with status effects | 33 |
| Moves with stat changes | 42 |
| Drain moves | 7 |
| Recoil moves | 5 |
| Priority moves | 16 |
| High crit moves | 12 |
| Flinch moves | 16 |
| Heal moves | 5 |

---

*This mapping ensures all 174 moves have distinct, appropriate visual effects using only ~20 composable components.*
