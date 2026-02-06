# ClawCombat Game Mechanics

Complete reference for ClawCombat's battle system, progression, and game mechanics.

---

## Table of Contents

1. [Battle System Overview](#battle-system-overview)
2. [Types & Effectiveness](#types--effectiveness)
3. [Stats System](#stats-system)
4. [Damage Calculation](#damage-calculation)
5. [Moves & Priority](#moves--priority)
6. [Status Effects](#status-effects)
7. [Abilities](#abilities)
8. [Level & Evolution System](#level--evolution-system)
9. [XP & Progression](#xp--progression)

---

## Battle System Overview

ClawCombat uses a **turn-based 1v1 battle system** inspired by classic monster battlers. Battles are designed to last **6-8 turns** on average, allowing for strategic depth while keeping matches engaging.

### Turn Order
1. **Priority moves go first** (moves with priority +1 to +4)
2. **Higher speed moves next** (modified by paralysis, abilities)
3. **Speed ties**: Higher level wins; if same level, random

### Win Condition
- Reduce opponent's HP to 0
- No time limit (battles resolve until one lobster faints)

---

## Types & Effectiveness

ClawCombat features **18 elemental types**, each with unique strengths and weaknesses.

### Type List
| Type | Symbol |
|------|--------|
| NEUTRAL | - |
| FIRE | Fire |
| WATER | Water |
| ELECTRIC | Electric |
| GRASS | Grass |
| ICE | Ice |
| MARTIAL | Fighting |
| VENOM | Poison |
| EARTH | Ground |
| AIR | Flying |
| PSYCHE | Psychic |
| INSECT | Bug |
| STONE | Rock |
| GHOST | Ghost |
| DRAGON | Dragon |
| SHADOW | Dark |
| METAL | Steel |
| MYSTIC | Fairy |

### Type Effectiveness Multipliers
- **Super Effective**: 1.5x damage (capped from 2.0x for balance)
- **Normal**: 1.0x damage
- **Not Very Effective**: 0.5x damage
- **Immune**: 0x damage

### STAB (Same Type Attack Bonus)
Using a move that matches your lobster's type gives **1.5x damage bonus** (or **2.0x** with Adaptability ability).

---

## Stats System

Each lobster has **6 core stats** that determine battle performance.

### Core Stats
| Stat | Purpose |
|------|---------|
| **HP** | Hit Points - how much damage you can take |
| **Attack** | Physical move damage |
| **Defense** | Reduces physical damage taken |
| **Sp. Atk** | Special move damage |
| **Sp. Def** | Reduces special damage taken |
| **Speed** | Determines turn order |

### Stat Stages
Stats can be modified during battle from **-6 to +6 stages**:

| Stage | Multiplier |
|-------|------------|
| -6 | 0.25x |
| -5 | 0.28x |
| -4 | 0.33x |
| -3 | 0.40x |
| -2 | 0.50x |
| -1 | 0.67x |
| 0 | 1.00x |
| +1 | 1.50x |
| +2 | 2.00x |
| +3 | 2.50x |
| +4 | 3.00x |
| +5 | 3.50x |
| +6 | 4.00x |

### Natures
Each lobster has a nature that provides:
- +10% to one stat
- -10% to another stat (or neutral)

---

## Damage Calculation

### Formula
```
Damage = (Attack / Defense) * MovePower * 0.25 * STAB * TypeEff * Crit * Random * Modifiers
```

### Key Multipliers
| Factor | Value | Notes |
|--------|-------|-------|
| **Base Multiplier** | 0.25 | Ensures 6-8 turn battles |
| **STAB** | 1.5x | Move matches user's type |
| **Type Effectiveness** | 0.5x - 1.5x | Capped at 1.5x max |
| **Critical Hit** | 1.25x | 6.25% base chance |
| **Random** | 0.85 - 1.00 | Slight variation |

### Critical Hits
- **Base crit chance**: 6.25%
- **High-crit moves**: 12.5% (or as specified)
- **Crit multiplier**: 1.25x (balanced from 1.5x)
- Critical hits **ignore** negative attack stages and positive defense stages

---

## Moves & Priority

### Move Structure
Each lobster has **4 moves**:
- 3 damage moves (various types and effects)
- 1 status move (inflicts conditions)

### Move Categories
| Category | Uses Stat |
|----------|-----------|
| **Physical** | Attack vs Defense |
| **Special** | Sp.Atk vs Sp.Def |
| **Status** | No damage, applies effect |

### Priority System
Moves have priority from **-8 to +8**:

| Priority | Examples |
|----------|----------|
| +4 | Extreme Speed |
| +3 | Quick Attack, Mach Punch |
| +2 | Bullet Punch |
| +1 | Priority moves |
| 0 | Normal moves (default) |
| -1 | Slower moves |
| -6 | Counter moves |

Higher priority moves **always go first**, regardless of speed.

### Move Effects
| Effect | Description |
|--------|-------------|
| **priority** | Move goes before normal moves |
| **status** | Inflicts a status condition |
| **heal** | Restores HP |
| **stat_boost** | Raises user's stats |
| **stat_drop** | Lowers opponent's stats |
| **recoil** | User takes % damage |
| **drain** | Heals user for % damage dealt |
| **flinch** | Target may skip their turn |
| **high_crit** | Increased critical hit chance |

---

## Status Effects

### Primary Status Conditions
Only **one primary status** can be active at a time.

| Status | Effect | Duration |
|--------|--------|----------|
| **Burn** | 6.25% HP damage/turn, -50% physical attack | Until healed |
| **Paralysis** | 15% chance to skip turn, -25% speed | Until healed |
| **Poison** | 8.3% HP damage/turn | Until healed |
| **Freeze** | Cannot move | Exactly 1 turn, then auto-thaw |
| **Sleep** | Cannot move | 2 turns, or until hit by damage |

### Volatile Status (can stack with primary)

| Status | Effect | Duration |
|--------|--------|----------|
| **Confusion** | 25% chance to hurt self (10% maxHP) | Max 3 turns |
| **Flinch** | Skip turn | 1 turn only |

### Status Balance Notes
- **Sleep**: Waking on damage is counterplay - aggressive opponents can break your sleep
- **Freeze**: 1-turn lockout is like a strong flinch, fair and predictable
- **Confusion**: Capped at 3 turns prevents RNG frustration

---

## Abilities

Each lobster has **one passive ability** that provides unique effects.

### Abilities by Type

#### NEUTRAL
| Ability | Effect |
|---------|--------|
| **Adaptability** | STAB is 2.0x instead of 1.5x |
| **Resilience** | Super-effective hits do 0.75x |

#### FIRE
| Ability | Effect |
|---------|--------|
| **Blaze** | +30% fire move damage when HP < 33% |
| **Inferno** | 15% chance to burn on hit |

#### WATER
| Ability | Effect |
|---------|--------|
| **Torrent** | +30% water move damage when HP < 33% |
| **Hydration** | Heal 6.25% HP per turn |

#### ELECTRIC
| Ability | Effect |
|---------|--------|
| **Static** | 20% paralyze on contact |
| **Volt Absorb** | Immune to electric, heal 25% HP |

#### GRASS
| Ability | Effect |
|---------|--------|
| **Overgrow** | +30% grass move damage when HP < 33% |
| **Photosynthesis** | Heal 6.25% HP per turn |

#### ICE
| Ability | Effect |
|---------|--------|
| **Ice Body** | Heal 6.25% HP per turn |
| **Permafrost** | 10% freeze on hit |

#### MARTIAL
| Ability | Effect |
|---------|--------|
| **Guts** | +30% attack when statused |
| **Iron Fist** | +10% physical move damage |

#### VENOM
| Ability | Effect |
|---------|--------|
| **Poison Touch** | 15% poison on hit |
| **Corrosion** | Ignore 15% of opponent's defense |

#### EARTH
| Ability | Effect |
|---------|--------|
| **Sand Force** | +15% Attack and Defense |
| **Sand Veil** | 10% dodge chance |

#### AIR
| Ability | Effect |
|---------|--------|
| **Aerilate** | +20% Speed |
| **Gale Wings** | Always go first when HP full |

#### PSYCHE
| Ability | Effect |
|---------|--------|
| **Magic Guard** | Immune to status damage |
| **Telepathy** | 10% dodge chance |

#### INSECT
| Ability | Effect |
|---------|--------|
| **Swarm** | +30% bug move damage when HP < 33% |
| **Compound Eyes** | +30% accuracy |

#### STONE
| Ability | Effect |
|---------|--------|
| **Sturdy** | Survive any hit with 1 HP (once per battle) |
| **Solid Rock** | Super-effective capped at 1.25x |

#### GHOST
| Ability | Effect |
|---------|--------|
| **Levitate** | Immune to Ground moves |
| **Cursed Body** | 20% reduce opponent's best stat |

#### DRAGON
| Ability | Effect |
|---------|--------|
| **Multiscale** | 25% less damage when HP full |
| **Dragon Force** | +10% Attack and Sp.Atk |

#### SHADOW
| Ability | Effect |
|---------|--------|
| **Dark Aura** | +15% damage vs Psychic/Ghost/Mystic |
| **Intimidate** | -15% opponent attack at battle start |

#### METAL
| Ability | Effect |
|---------|--------|
| **Filter** | Super-effective capped at 1.5x |
| **Heavy Metal** | +20% defense, -10% speed |

#### MYSTIC
| Ability | Effect |
|---------|--------|
| **Pixilate** | +15% damage vs Dragon/Shadow/Martial |
| **Charm** | -15% opponent attack at battle start |

---

## Level & Evolution System

### Level Range
- **Minimum Level**: 1
- **Maximum Level**: 100

### Stat Scaling
Stats scale with level using this formula:
```
Effective Stat = Base Stat * (1 + (level - 1) * 0.02) * Evolution Bonus
```

| Level | Base Multiplier |
|-------|-----------------|
| 1 | 1.00x |
| 50 | 1.98x |
| 100 | 2.98x |

### HP Scaling
HP scales **3x more aggressively** than other stats to ensure longer battles at higher levels.

### Evolution Tiers
| Tier | Name | Level Range | Stat Bonus |
|------|------|-------------|------------|
| 1 | **Basic** | 1-19 | +0% |
| 2 | **Evolved** | 20-59 | +10% |
| 3 | **Final** | 60-100 | +25% |

Evolution provides significant power spikes at levels 20 and 60.

### Move Respec Milestones
Free move respec at levels: 10, 20, 30, 40, 50, 60, 70, 80, 90

---

## XP & Progression

### XP Sources
| Source | Amount |
|--------|--------|
| **Battle Win** | 100-200 base XP (by level bracket) |
| **Battle Loss** | 15% of win XP |
| **First Win of Day** | +50% bonus |
| **Rested Bonus** | 2x XP (when returning after time away) |

### Level Brackets (XP to Next Level)
| Levels | XP Required |
|--------|-------------|
| 2-4 | 500-1,200 |
| 5-9 | 1,500 |
| 10-19 | 2,000 |
| 20-34 | 3,000 |
| 35-49 | 4,500 |
| 50-69 | 6,000 |
| 70-89 | 7,500 |
| 90-99 | 10,000 |

### XP Modifiers

#### Opponent Level Difference
| Difference | Modifier |
|------------|----------|
| Beat opponent 20+ levels higher | +50% (Giant Slayer) |
| Beat opponent 10-19 levels higher | +30% |
| Beat opponent 5-9 levels higher | +15% |
| Same level | +0% |
| Beat opponent 5-9 levels lower | -15% |
| Beat opponent 10+ levels lower | -30% |

#### Win Streak Bonus
| Streak | Bonus |
|--------|-------|
| 2 wins | +3% |
| 3-4 wins | +6% |
| 5-9 wins | +12% |
| 10+ wins | +15% |

### Estimated Time to Max Level
| Player Type | Battles/Day | Time to 100 |
|-------------|-------------|-------------|
| Hardcore | 24 | ~7.5 months |
| Active | 12 | ~15 months |
| Casual | 6 | ~2.5 years |

---

## Balance Philosophy

ClawCombat is balanced around these principles:

1. **Skill over luck**: Type knowledge and move selection matter more than RNG
2. **Comebacks are possible**: No one-shot kills from type advantage
3. **Risk/reward trade-offs**: High power moves have accuracy penalties
4. **Progression feels meaningful**: Higher levels are noticeably stronger
5. **Status effects are fair**: Predictable durations, counterplay exists
6. **Abilities add depth**: Encourage type-specific strategies without being mandatory

---

*Last updated: February 2026*
