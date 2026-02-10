/**
 * Lobsterdex - Reusable type encyclopedia component
 *
 * Usage:
 *   // Basic usage (view only)
 *   Lobsterdex.open();
 *
 *   // Selection mode (for practice arena)
 *   Lobsterdex.openForSelection({
 *     mode: 'attacker', // or 'defender'
 *     onSelect: function(type) { console.log('Selected:', type); }
 *   });
 */

(function() {
  'use strict';

  // ═══════════════════════════════════════════
  // DATA
  // ═══════════════════════════════════════════
  var TYPES = [
    'NEUTRAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE',
    'MARTIAL', 'VENOM', 'EARTH', 'AIR', 'PSYCHE', 'INSECT',
    'STONE', 'GHOST', 'DRAGON', 'SHADOW', 'METAL', 'MYSTIC'
  ];

  var TYPE_META = {
    NEUTRAL:  { color: '#A8A878', emoji: '\u26AA' },
    FIRE:     { color: '#F08030', emoji: '\uD83D\uDD25' },
    WATER:    { color: '#6890F0', emoji: '\uD83D\uDCA7' },
    ELECTRIC: { color: '#F8D030', emoji: '\u26A1' },
    GRASS:    { color: '#78C850', emoji: '\uD83C\uDF3F' },
    ICE:      { color: '#98D8D8', emoji: '\u2744\uFE0F' },
    MARTIAL:  { color: '#C03028', emoji: '\uD83E\uDD4A' },
    VENOM:    { color: '#A040A0', emoji: '\u2620\uFE0F' },
    EARTH:    { color: '#E0C068', emoji: '\uD83C\uDF0D' },
    AIR:      { color: '#A890F0', emoji: '\uD83E\uDD85' },
    PSYCHE:   { color: '#F85888', emoji: '\uD83D\uDD2E' },
    INSECT:   { color: '#A8B820', emoji: '\uD83D\uDC1B' },
    STONE:    { color: '#B8A038', emoji: '\uD83E\uDEA8' },
    GHOST:    { color: '#705898', emoji: '\uD83D\uDC7B' },
    DRAGON:   { color: '#7038F8', emoji: '\uD83D\uDC09' },
    SHADOW:   { color: '#705848', emoji: '\uD83C\uDF11' },
    METAL:    { color: '#B8B8D0', emoji: '\u2699\uFE0F' },
    MYSTIC:   { color: '#EE99AC', emoji: '\u2728' }
  };

  var TYPE_MATCHUPS = {
    NEUTRAL: { strong: 'None', weak: 'Martial' },
    FIRE: { strong: 'Grass, Ice, Insect, Metal', weak: 'Water, Stone, Dragon' },
    WATER: { strong: 'Fire, Earth, Stone', weak: 'Electric, Grass' },
    ELECTRIC: { strong: 'Water, Air', weak: 'Earth' },
    GRASS: { strong: 'Water, Earth, Stone', weak: 'Fire, Ice, Venom, Air, Insect' },
    ICE: { strong: 'Grass, Earth, Air, Dragon', weak: 'Fire, Martial, Stone' },
    MARTIAL: { strong: 'Neutral, Ice, Stone, Shadow, Metal', weak: 'Air, Psyche, Mystic' },
    VENOM: { strong: 'Grass, Mystic', weak: 'Earth, Psyche' },
    EARTH: { strong: 'Fire, Electric, Venom, Stone', weak: 'Water, Grass, Ice' },
    AIR: { strong: 'Grass, Martial, Insect', weak: 'Electric, Ice, Stone' },
    PSYCHE: { strong: 'Martial, Venom', weak: 'Insect, Ghost, Shadow' },
    INSECT: { strong: 'Grass, Psyche, Shadow', weak: 'Fire, Air, Stone' },
    STONE: { strong: 'Fire, Ice, Air, Insect', weak: 'Water, Grass, Martial, Earth' },
    GHOST: { strong: 'Psyche, Ghost', weak: 'Shadow' },
    DRAGON: { strong: 'Dragon', weak: 'Ice, Dragon, Mystic' },
    SHADOW: { strong: 'Psyche, Ghost', weak: 'Martial, Insect, Mystic' },
    METAL: { strong: 'Ice, Stone, Mystic', weak: 'Fire, Martial, Earth' },
    MYSTIC: { strong: 'Martial, Dragon, Shadow', weak: 'Venom, Metal' }
  };

  var TYPE_MOVES = {
    FIRE: [
      { name: 'Fire Blast', power: 110, desc: 'Intense fire attack. 10% burn chance.' },
      { name: 'Inferno', power: 100, desc: 'Engulfs foe in flames. Always burns.' },
      { name: 'Heat Wave', power: 95, desc: 'Hot wind hits all foes.' },
      { name: 'Flamethrower', power: 90, desc: 'Reliable fire beam. 10% burn.' },
      { name: 'Lava Plume', power: 80, desc: 'Scarlet flames. 30% burn chance.' },
      { name: 'Fire Punch', power: 75, desc: 'Fiery punch. May cause burn.' },
      { name: 'Flame Burst', power: 70, desc: 'Flames burst and hit nearby foes.' },
      { name: 'Ember', power: 40, desc: 'A small flame attack. May cause burn.' }
    ],
    WATER: [
      { name: 'Hydro Pump', power: 110, desc: 'Powerful water blast.' },
      { name: 'Surf', power: 90, desc: 'Giant wave hits all foes.' },
      { name: 'Aqua Tail', power: 90, desc: 'Swings tail like a wave.' },
      { name: 'Scald', power: 80, desc: 'Hot water. 30% burn chance.' },
      { name: 'Waterfall', power: 80, desc: 'Charges with water. May flinch.' },
      { name: 'Water Pulse', power: 60, desc: 'Ultrasonic wave. May confuse.' },
      { name: 'Bubble', power: 40, desc: 'Shoots bubbles. May lower speed.' },
      { name: 'Rain Dance', power: 0, desc: 'Summons rain for 5 turns.' }
    ],
    GRASS: [
      { name: 'Leaf Storm', power: 130, desc: 'Powerful but lowers Sp.Atk.' },
      { name: 'Solar Beam', power: 120, desc: 'Charges sun, then fires.' },
      { name: 'Leaf Blade', power: 90, desc: 'Sharp leaf. High crit rate.' },
      { name: 'Energy Ball', power: 90, desc: 'Nature power. May lower Sp.Def.' },
      { name: 'Seed Bomb', power: 80, desc: 'Hard seeds barrage foe.' },
      { name: 'Giga Drain', power: 75, desc: 'Drains HP from the foe.' },
      { name: 'Razor Leaf', power: 55, desc: 'Sharp leaves. High crit rate.' },
      { name: 'Vine Whip', power: 45, desc: 'Strikes with vines.' }
    ],
    ELECTRIC: [
      { name: 'Thunder', power: 110, desc: 'Lightning strike. 30% paralyze.' },
      { name: 'Thunderbolt', power: 90, desc: 'Strong shock. 10% paralyze.' },
      { name: 'Wild Charge', power: 90, desc: 'Reckless charge. Has recoil.' },
      { name: 'Discharge', power: 80, desc: 'Hits all nearby. May paralyze.' },
      { name: 'Volt Switch', power: 70, desc: 'Attack then switch out.' },
      { name: 'Spark', power: 65, desc: 'Electric tackle. May paralyze.' },
      { name: 'Thunder Shock', power: 40, desc: 'Electric jolt. May paralyze.' },
      { name: 'Thunder Wave', power: 0, desc: 'Weak shock that paralyzes.' }
    ],
    ICE: [
      { name: 'Blizzard', power: 110, desc: 'Howling blizzard. May freeze.' },
      { name: 'Ice Beam', power: 90, desc: 'Freezing beam. 10% freeze.' },
      { name: 'Icicle Crash', power: 85, desc: 'Ice drop. May flinch.' },
      { name: 'Ice Punch', power: 75, desc: 'Icy fist. May freeze.' },
      { name: 'Freeze Dry', power: 70, desc: 'Super effective on Water.' },
      { name: 'Aurora Beam', power: 65, desc: 'Rainbow beam. May lower Atk.' },
      { name: 'Powder Snow', power: 40, desc: 'Icy snow. May freeze.' },
      { name: 'Hail', power: 0, desc: 'Summons hail for 5 turns.' }
    ],
    NEUTRAL: [
      { name: 'Hyper Beam', power: 150, desc: 'Devastating. Must recharge.' },
      { name: 'Giga Impact', power: 150, desc: 'Full power. Must recharge.' },
      { name: 'Return', power: 102, desc: 'Power based on friendship.' },
      { name: 'Body Slam', power: 85, desc: 'Full body drop. May paralyze.' },
      { name: 'Slam', power: 80, desc: 'Slams foe with body.' },
      { name: 'Facade', power: 70, desc: 'Doubles when status affected.' },
      { name: 'Tackle', power: 40, desc: 'Basic charging attack.' },
      { name: 'Quick Attack', power: 40, desc: 'Always strikes first.' }
    ],
    MARTIAL: [
      { name: 'High Jump Kick', power: 130, desc: 'Miss causes crash damage.' },
      { name: 'Close Combat', power: 120, desc: 'Strong but lowers defenses.' },
      { name: 'Focus Blast', power: 120, desc: 'Mental focus. May lower Sp.Def.' },
      { name: 'Aura Sphere', power: 80, desc: 'Never misses.' },
      { name: 'Brick Break', power: 75, desc: 'Breaks barriers.' },
      { name: 'Drain Punch', power: 75, desc: 'Drains HP from foe.' },
      { name: 'Low Kick', power: 60, desc: 'More damage to heavy foes.' },
      { name: 'Karate Chop', power: 50, desc: 'Chopping attack. High crit.' }
    ],
    VENOM: [
      { name: 'Gunk Shot', power: 120, desc: 'Garbage blast. May poison.' },
      { name: 'Sludge Bomb', power: 90, desc: 'Filthy sludge. 30% poison.' },
      { name: 'Poison Jab', power: 80, desc: 'Toxic stab. May poison.' },
      { name: 'Cross Poison', power: 70, desc: 'High crit. May poison.' },
      { name: 'Venoshock', power: 65, desc: 'Doubles on poisoned foes.' },
      { name: 'Sludge', power: 65, desc: 'Sludge throw. May poison.' },
      { name: 'Poison Sting', power: 15, desc: 'Toxic barb. May poison.' },
      { name: 'Toxic', power: 0, desc: 'Badly poisons the foe.' }
    ],
    EARTH: [
      { name: 'Earthquake', power: 100, desc: 'Massive tremor hits all.' },
      { name: 'Earth Power', power: 90, desc: 'Ground erupts. May lower Sp.Def.' },
      { name: 'Dig', power: 80, desc: 'Digs underground, strikes next turn.' },
      { name: 'Drill Run', power: 80, desc: 'Spinning strike. High crit.' },
      { name: 'Stomping Tantrum', power: 75, desc: 'Doubles if last move failed.' },
      { name: 'Bulldoze', power: 60, desc: 'Stomps ground. Lowers speed.' },
      { name: 'Sand Tomb', power: 35, desc: 'Traps foe in sand.' },
      { name: 'Mud Slap', power: 20, desc: 'Mud throw. Lowers accuracy.' }
    ],
    AIR: [
      { name: 'Brave Bird', power: 120, desc: 'Reckless dive. Has recoil.' },
      { name: 'Hurricane', power: 110, desc: 'Fierce wind. May confuse.' },
      { name: 'Fly', power: 90, desc: 'Flies up, strikes next turn.' },
      { name: 'Air Slash', power: 75, desc: 'Sharp wind. May flinch.' },
      { name: 'Aerial Ace', power: 60, desc: 'Swift strike. Never misses.' },
      { name: 'Acrobatics', power: 55, desc: 'Doubles without held item.' },
      { name: 'Gust', power: 40, desc: 'Whips up wind.' },
      { name: 'Tailwind', power: 0, desc: 'Doubles team speed for 4 turns.' }
    ],
    PSYCHE: [
      { name: 'Future Sight', power: 120, desc: 'Attack hits 2 turns later.' },
      { name: 'Dream Eater', power: 100, desc: 'Eats dreams. Heals self.' },
      { name: 'Psychic', power: 90, desc: 'Strong psychic. May lower Sp.Def.' },
      { name: 'Psyshock', power: 80, desc: 'Psychic wave hits Def stat.' },
      { name: 'Zen Headbutt', power: 80, desc: 'Focus headbutt. May flinch.' },
      { name: 'Psybeam', power: 65, desc: 'Odd beam. May confuse.' },
      { name: 'Confusion', power: 50, desc: 'Psychic wave. May confuse.' },
      { name: 'Hypnosis', power: 0, desc: 'Puts foe to sleep.' }
    ],
    INSECT: [
      { name: 'Megahorn', power: 120, desc: 'Powerful horn attack.' },
      { name: 'Bug Buzz', power: 90, desc: 'Vibration. May lower Sp.Def.' },
      { name: 'X-Scissor', power: 80, desc: 'Slashes in X pattern.' },
      { name: 'Signal Beam', power: 75, desc: 'Odd beam. May confuse.' },
      { name: 'Leech Life', power: 80, desc: 'Drains HP from the foe.' },
      { name: 'U-turn', power: 70, desc: 'Attack then switch out.' },
      { name: 'Fury Cutter', power: 40, desc: 'Doubles each consecutive hit.' },
      { name: 'Sticky Web', power: 0, desc: 'Lowers speed of foes on entry.' }
    ],
    STONE: [
      { name: 'Head Smash', power: 150, desc: 'Reckless. Heavy recoil.' },
      { name: 'Stone Edge', power: 100, desc: 'Sharp rocks. High crit rate.' },
      { name: 'Rock Slide', power: 75, desc: 'Rocks fall. May flinch.' },
      { name: 'Power Gem', power: 80, desc: 'Fires gems at the foe.' },
      { name: 'Ancient Power', power: 60, desc: 'May raise all stats.' },
      { name: 'Rock Throw', power: 50, desc: 'Throws a rock at foe.' },
      { name: 'Sandstorm', power: 0, desc: 'Summons sandstorm for 5 turns.' },
      { name: 'Stealth Rock', power: 0, desc: 'Damages foes on entry.' }
    ],
    GHOST: [
      { name: 'Shadow Ball', power: 80, desc: 'Shadow blob. May lower Sp.Def.' },
      { name: 'Phantom Force', power: 90, desc: 'Vanish, then strike.' },
      { name: 'Shadow Claw', power: 70, desc: 'Sharp shadows. High crit.' },
      { name: 'Hex', power: 65, desc: 'Doubles on status-afflicted foes.' },
      { name: 'Shadow Sneak', power: 40, desc: 'Always strikes first.' },
      { name: 'Lick', power: 30, desc: 'Licks foe. May paralyze.' },
      { name: 'Destiny Bond', power: 0, desc: 'If KOd, foe faints too.' },
      { name: 'Curse', power: 0, desc: 'Ghost: Hurts self to curse foe.' }
    ],
    DRAGON: [
      { name: 'Outrage', power: 120, desc: '2-3 turns, then confused.' },
      { name: 'Draco Meteor', power: 130, desc: 'Powerful but lowers Sp.Atk.' },
      { name: 'Dragon Claw', power: 80, desc: 'Sharp claws attack.' },
      { name: 'Dragon Pulse', power: 85, desc: 'Shockwave from mouth.' },
      { name: 'Dragon Rush', power: 100, desc: 'Tackles with menace. May flinch.' },
      { name: 'Twister', power: 40, desc: 'Whips up tornado. May flinch.' },
      { name: 'Dragon Breath', power: 60, desc: 'Breath attack. May paralyze.' },
      { name: 'Dragon Dance', power: 0, desc: 'Raises Attack and Speed.' }
    ],
    SHADOW: [
      { name: 'Dark Pulse', power: 80, desc: 'Dark aura. May flinch.' },
      { name: 'Foul Play', power: 95, desc: 'Uses foes Attack stat.' },
      { name: 'Knock Off', power: 65, desc: 'Removes foes item.' },
      { name: 'Crunch', power: 80, desc: 'Crunches with fangs. May lower Def.' },
      { name: 'Sucker Punch', power: 70, desc: 'Priority if foe attacks.' },
      { name: 'Pursuit', power: 40, desc: 'Doubles if foe switches.' },
      { name: 'Bite', power: 60, desc: 'Bites foe. May flinch.' },
      { name: 'Nasty Plot', power: 0, desc: 'Sharply raises Sp.Atk.' }
    ],
    METAL: [
      { name: 'Iron Head', power: 80, desc: 'Hard head slam. May flinch.' },
      { name: 'Flash Cannon', power: 80, desc: 'Light beam. May lower Sp.Def.' },
      { name: 'Metal Claw', power: 50, desc: 'Metal claws. May raise Atk.' },
      { name: 'Steel Wing', power: 70, desc: 'Hard wings strike.' },
      { name: 'Meteor Mash', power: 90, desc: 'Meteor punch. May raise Atk.' },
      { name: 'Bullet Punch', power: 40, desc: 'Always strikes first.' },
      { name: 'Gyro Ball', power: 0, desc: 'More damage if slower than foe.' },
      { name: 'Iron Defense', power: 0, desc: 'Sharply raises Defense.' }
    ],
    MYSTIC: [
      { name: 'Moonblast', power: 95, desc: 'Moon power. May lower Sp.Atk.' },
      { name: 'Play Rough', power: 90, desc: 'Plays rough. May lower Atk.' },
      { name: 'Dazzling Gleam', power: 80, desc: 'Blinding light hits all.' },
      { name: 'Draining Kiss', power: 50, desc: 'Drains HP from foe.' },
      { name: 'Disarming Voice', power: 40, desc: 'Never misses.' },
      { name: 'Sweet Kiss', power: 0, desc: 'Confuses the foe.' },
      { name: 'Charm', power: 0, desc: 'Sharply lowers foes Atk.' },
      { name: 'Misty Terrain', power: 0, desc: 'Prevents status for 5 turns.' }
    ]
  };

  var VARIANTS = ['cadet', 'crawler', 'peeper', 'scout', 'sentinel', 'titan'];
  var VARIANT_NAMES = ['Cadet', 'Crawler', 'Peeper', 'Scout', 'Sentinel', 'Titan'];

  // Stat colors for natures display
  var STAT_COLORS = {
    atk: '#f97316',   // Attack - orange
    def: '#3b82f6',   // Defense - blue
    spd: '#ec4899',   // Speed - pink
    spa: '#a855f7',   // Claw (Sp.Atk) - purple
    spd_def: '#22c55e' // Shell (Sp.Def) - green
  };
  var STAT_NAMES = {
    atk: 'Attack', def: 'Defense', spd: 'Speed', spa: 'Claw', spd_def: 'Shell'
  };

  // Natures organized by boosted stat (4 per row after Hardy)
  var NATURES_NEUTRAL = { name: 'Hardy', boost: null, reduce: null };
  var NATURES_GROUPED = [
    // Attack boosters (Row 1)
    { name: 'Lonely', boost: 'atk', reduce: 'def' },
    { name: 'Brave', boost: 'atk', reduce: 'spd' },
    { name: 'Adamant', boost: 'atk', reduce: 'spa' },
    { name: 'Naughty', boost: 'atk', reduce: 'spd_def' },
    // Defense boosters (Row 2)
    { name: 'Bold', boost: 'def', reduce: 'atk' },
    { name: 'Relaxed', boost: 'def', reduce: 'spd' },
    { name: 'Impish', boost: 'def', reduce: 'spa' },
    { name: 'Lax', boost: 'def', reduce: 'spd_def' },
    // Speed boosters (Row 3)
    { name: 'Timid', boost: 'spd', reduce: 'atk' },
    { name: 'Hasty', boost: 'spd', reduce: 'def' },
    { name: 'Jolly', boost: 'spd', reduce: 'spa' },
    { name: 'Naive', boost: 'spd', reduce: 'spd_def' },
    // Claw boosters (Row 4)
    { name: 'Modest', boost: 'spa', reduce: 'atk' },
    { name: 'Mild', boost: 'spa', reduce: 'def' },
    { name: 'Quiet', boost: 'spa', reduce: 'spd' },
    { name: 'Rash', boost: 'spa', reduce: 'spd_def' },
    // Shell boosters (Row 5)
    { name: 'Calm', boost: 'spd_def', reduce: 'atk' },
    { name: 'Gentle', boost: 'spd_def', reduce: 'def' },
    { name: 'Sassy', boost: 'spd_def', reduce: 'spd' },
    { name: 'Careful', boost: 'spd_def', reduce: 'spa' }
  ];

  // ═══════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════
  var initialized = false;
  var selectedType = 'FIRE';
  var selectedVariant = 'cadet';
  var selectionMode = null; // null, 'attacker', or 'defender'
  var onSelectCallback = null;
  // Track attacker/defender selections separately
  var attackerType = 'FIRE';
  var defenderType = 'WATER';
  var attackerVariant = 'cadet';
  var defenderVariant = 'cadet';
  var attackerNature = 'Hardy';
  var defenderNature = 'Hardy';

  // ═══════════════════════════════════════════
  // HTML TEMPLATE
  // ═══════════════════════════════════════════
  function createDexHTML() {
    return '\
<div class="lightbox-overlay" id="lb-dex" onclick="Lobsterdex.closeOverlay(event)">\
  <button class="dex-close-btn" onclick="Lobsterdex.close()">&#10005;</button>\
  <div class="dex-book" id="dex-book" onclick="event.stopPropagation()">\
    <div class="dex-page-right">\
      <div class="dex-selection-header" id="dex-selection-header">\
        <div class="dex-selection-buttons">\
          <img class="dex-preview-img" id="dex-preview-attacker" src="/references/fire/cadet-balanced.webp" alt="Attacker">\
          <button class="dex-selection-btn" id="dex-sel-attacker" onclick="Lobsterdex.setSelectionMode(\'attacker\')">Attacker</button>\
          <button class="dex-selection-btn" id="dex-sel-defender" onclick="Lobsterdex.setSelectionMode(\'defender\')">Defender</button>\
          <img class="dex-preview-img" id="dex-preview-defender" src="/references/water/cadet-balanced.webp" alt="Defender">\
        </div>\
      </div>\
      <div class="dex-right-screen">\
        <div class="dex-panel" id="dexPanelTypes">\
          <div class="dex-panel-header">\
            <div class="dex-type-name" id="dexTypeName">Fire Type</div>\
            <div class="dex-type-matchups" id="dexTypeMatchups">Strong vs: Grass, Ice, Insect<br>Weak vs: Water, Stone, Dragon</div>\
          </div>\
          <div class="dex-type-grid" id="dexTypeGrid"></div>\
        </div>\
        <div class="dex-panel" id="dexPanelMoves" style="display:none;">\
          <div class="dex-panel-title">Moves</div>\
          <div class="dex-moves-list" id="dexMovesList"></div>\
          <div class="dex-move-info-box" id="dexMoveInfoBox">Hover over <span class="dex-info-icon-mini">i</span> for move info</div>\
        </div>\
        <div class="dex-panel" id="dexPanelNatures" style="display:none;">\
          <div class="dex-natures-legend">\
            <span class="dex-legend-item"><i style="background:#f97316"></i>Attack</span>\
            <span class="dex-legend-item"><i style="background:#3b82f6"></i>Defense</span>\
            <span class="dex-legend-item"><i style="background:#ec4899"></i>Speed</span>\
            <span class="dex-legend-item"><i style="background:#a855f7"></i>Claw</span>\
            <span class="dex-legend-item"><i style="background:#22c55e"></i>Shell</span>\
          </div>\
          <div class="dex-natures-list" id="dexNaturesList"></div>\
        </div>\
      </div>\
      <div class="dex-nav-buttons">\
        <button class="dex-nav-btn active" data-panel="types">TYPES</button>\
        <button class="dex-nav-btn" data-panel="natures">NATURES</button>\
        <button class="dex-nav-btn" data-panel="moves">MOVES</button>\
      </div>\
    </div>\
    <div class="dex-cover">\
      <div class="dex-cover-front">\
        <div class="dex-cover-lens"></div>\
        <div class="dex-cover-title-section">\
          <div class="dex-cover-line"></div>\
          <div class="dex-cover-title">LOBSTERDEX</div>\
          <div class="dex-cover-line"></div>\
        </div>\
        <div class="dex-cover-hint">Click to open</div>\
      </div>\
      <div class="dex-cover-back">\
        <div class="dex-screen-frame">\
          <div class="dex-screen">\
            <img id="dexLobsterImage" src="/references/fire/cadet-balanced.webp" alt="Lobster">\
          </div>\
        </div>\
        <div class="dex-variant-row" id="dexVariantRow"></div>\
        <div class="dex-variant-label" id="dexVariantLabel">Cadet</div>\
        <button class="dex-confirm-btn" id="dex-confirm-btn" onclick="Lobsterdex.confirmSelection()">Practice with These</button>\
      </div>\
    </div>\
  </div>\
</div>';
  }

  // ═══════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════
  function init() {
    if (initialized) return;
    initialized = true;

    // Inject HTML if not present
    if (!document.getElementById('lb-dex')) {
      var container = document.createElement('div');
      container.innerHTML = createDexHTML();
      document.body.appendChild(container.firstChild);
    }

    var typeGrid = document.getElementById('dexTypeGrid');
    var naturesList = document.getElementById('dexNaturesList');

    // Populate type grid
    TYPES.forEach(function(t) {
      var btn = document.createElement('button');
      btn.className = 'dex-type-btn ' + t.toLowerCase() + (t === selectedType ? ' active' : '');
      btn.textContent = t;
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        selectType(t);
      });
      typeGrid.appendChild(btn);
    });

    // Populate natures - Hardy at top, then grouped by boost stat
    // Hardy (neutral) in special header - starts selected by default
    naturesList.innerHTML = '<div class="dex-nature-hardy selected" data-nature="Hardy"><div class="dex-nature-name">Hardy</div><div class="dex-nature-neutral">Balanced (No stat changes)</div></div>';

    // Grouped natures (4 per row by boost stat)
    NATURES_GROUPED.forEach(function(n) {
      var html = '<div class="dex-nature-item dex-nature-' + n.boost + '" data-nature="' + n.name + '">';
      html += '<div class="dex-nature-name">' + n.name + '</div>';
      html += '<div class="dex-nature-stats">';
      html += '<span class="dex-stat-boost" style="color:' + STAT_COLORS[n.boost] + '">+' + STAT_NAMES[n.boost] + '</span>';
      html += '<span class="dex-stat-reduce" style="color:' + STAT_COLORS[n.reduce] + '">-' + STAT_NAMES[n.reduce] + '</span>';
      html += '</div>';
      html += '</div>';
      naturesList.innerHTML += html;
    });

    // Add click handlers for nature selection
    naturesList.querySelectorAll('[data-nature]').forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        selectNature(item.dataset.nature);
      });
    });

    // Initialize displays
    updateTypeInfo(selectedType);
    updateMovesList(selectedType);
    updateVariants(selectedType);

    // Book click to toggle
    document.getElementById('dex-book').addEventListener('click', function(e) {
      if (e.target.closest('.dex-type-btn, .dex-nav-btn, .dex-variant-thumb, .dex-move-info-btn, .dex-selection-btn, .dex-confirm-btn, .dex-preview-img, .dex-selection-header')) return;
      document.getElementById('dex-book').classList.toggle('open');
    });

    // Nav button switching
    document.querySelectorAll('.dex-nav-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        document.querySelectorAll('.dex-nav-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var panel = btn.dataset.panel;
        document.getElementById('dexPanelTypes').style.display = panel === 'types' ? 'flex' : 'none';
        document.getElementById('dexPanelMoves').style.display = panel === 'moves' ? 'flex' : 'none';
        document.getElementById('dexPanelNatures').style.display = panel === 'natures' ? 'flex' : 'none';
      });
    });

    // Escape key to close
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && document.getElementById('lb-dex').classList.contains('active')) {
        close();
      }
    });
  }

  // ═══════════════════════════════════════════
  // TYPE SELECTION
  // ═══════════════════════════════════════════
  function selectType(type) {
    selectedType = type;
    selectedVariant = 'cadet';
    document.querySelectorAll('.dex-type-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.textContent === type);
    });
    document.getElementById('dexLobsterImage').src = '/references/' + type.toLowerCase() + '/cadet-balanced.webp';
    updateTypeInfo(type);
    updateMovesList(type);
    updateVariants(type);
    // Update preview for current selection mode
    updateSelectionPreview(type);
  }

  function updateSelectionPreview(type) {
    if (!selectionMode) return;
    // When type changes, reset variant to 'cadet' for this mode
    if (selectionMode === 'attacker') {
      attackerType = type;
      attackerVariant = 'cadet';
      var previewImg = document.getElementById('dex-preview-attacker');
      if (previewImg) previewImg.src = '/references/' + type.toLowerCase() + '/cadet-balanced.webp';
    } else if (selectionMode === 'defender') {
      defenderType = type;
      defenderVariant = 'cadet';
      var previewImg = document.getElementById('dex-preview-defender');
      if (previewImg) previewImg.src = '/references/' + type.toLowerCase() + '/cadet-balanced.webp';
    }
  }

  function selectNature(nature) {
    // Save nature for the current mode
    if (selectionMode === 'attacker') {
      attackerNature = nature;
    } else if (selectionMode === 'defender') {
      defenderNature = nature;
    }
    // Update visual selection
    updateNatureVisual(nature);
  }

  function updateNatureVisual(nature) {
    document.querySelectorAll('.dex-nature-item, .dex-nature-hardy').forEach(function(item) {
      item.classList.toggle('selected', item.dataset.nature === nature);
    });
  }

  function getCurrentNature() {
    if (selectionMode === 'attacker') return attackerNature;
    if (selectionMode === 'defender') return defenderNature;
    return 'Hardy';
  }

  function updateTypeInfo(type) {
    var displayName = type.charAt(0) + type.slice(1).toLowerCase();
    document.getElementById('dexTypeName').textContent = displayName + ' Type';
    var matchup = TYPE_MATCHUPS[type];
    document.getElementById('dexTypeMatchups').innerHTML = 'Strong vs: ' + matchup.strong + '<br>Weak vs: ' + matchup.weak;
  }

  function updateMovesList(type) {
    var moves = TYPE_MOVES[type] || [];
    var list = document.getElementById('dexMovesList');
    var infoBox = document.getElementById('dexMoveInfoBox');
    list.innerHTML = moves.map(function(move) {
      return '<div class="dex-move-item"><span class="dex-move-name">' + move.name + '</span><span class="dex-move-power">' + (move.power > 0 ? 'PWR ' + move.power : 'Status') + '</span><button class="dex-move-info-btn" data-desc="' + move.desc + '">i</button></div>';
    }).join('');
    list.querySelectorAll('.dex-move-info-btn').forEach(function(btn) {
      btn.addEventListener('mouseenter', function(e) {
        e.stopPropagation();
        infoBox.textContent = btn.dataset.desc;
        infoBox.style.color = '#e2e8f0';
      });
      btn.addEventListener('mouseleave', function() {
        infoBox.innerHTML = 'Hover over <span class="dex-info-icon-mini">i</span> for move info';
        infoBox.style.color = '#94a3b8';
      });
    });
  }

  function updateVariants(type) {
    var row = document.getElementById('dexVariantRow');
    var label = document.getElementById('dexVariantLabel');
    row.innerHTML = VARIANTS.map(function(v, i) {
      return '<div class="dex-variant-thumb' + (v === selectedVariant ? ' active' : '') + '" data-variant="' + v + '" data-name="' + VARIANT_NAMES[i] + '"><img src="/references/' + type.toLowerCase() + '/' + v + '-balanced.webp" alt="' + VARIANT_NAMES[i] + '"></div>';
    }).join('');

    // Update label to show current variant
    var currentIndex = VARIANTS.indexOf(selectedVariant);
    if (currentIndex >= 0 && label) {
      label.textContent = VARIANT_NAMES[currentIndex];
    }

    row.querySelectorAll('.dex-variant-thumb').forEach(function(thumb) {
      thumb.addEventListener('click', function(e) {
        e.stopPropagation();
        selectedVariant = thumb.dataset.variant;
        document.querySelectorAll('.dex-variant-thumb').forEach(function(t) { t.classList.remove('active'); });
        thumb.classList.add('active');
        document.getElementById('dexLobsterImage').src = '/references/' + selectedType.toLowerCase() + '/' + selectedVariant + '-balanced.webp';
        // Update variant label
        if (label) {
          label.textContent = thumb.dataset.name;
        }
        // Save variant for current mode and update preview
        updateVariantForMode(selectedVariant);
      });
    });
  }

  function updateVariantForMode(variant) {
    if (!selectionMode) return;
    var imgPath = '/references/' + selectedType.toLowerCase() + '/' + variant + '-balanced.webp';
    if (selectionMode === 'attacker') {
      attackerVariant = variant;
      var previewImg = document.getElementById('dex-preview-attacker');
      if (previewImg) previewImg.src = imgPath;
    } else if (selectionMode === 'defender') {
      defenderVariant = variant;
      var previewImg = document.getElementById('dex-preview-defender');
      if (previewImg) previewImg.src = imgPath;
    }
  }

  // ═══════════════════════════════════════════
  // OPEN / CLOSE
  // ═══════════════════════════════════════════
  function open() {
    init();
    selectionMode = null;
    onSelectCallback = null;
    document.getElementById('dex-selection-header').classList.remove('active');
    document.getElementById('dex-confirm-btn').classList.remove('active');
    document.getElementById('lb-dex').classList.add('active');
    document.getElementById('dex-book').classList.remove('open');
    document.body.style.overflow = 'hidden';
  }

  function openForSelection(options) {
    init();
    options = options || {};
    selectionMode = options.mode || 'attacker';
    onSelectCallback = options.onSelect || null;

    // Set initial attacker/defender types and variants from options (from practice mode)
    attackerVariant = options.attackerVariant || 'cadet';
    defenderVariant = options.defenderVariant || 'cadet';

    if (options.attackerType) {
      attackerType = options.attackerType.toUpperCase();
      var atkPreview = document.getElementById('dex-preview-attacker');
      if (atkPreview) atkPreview.src = '/references/' + attackerType.toLowerCase() + '/' + attackerVariant + '-balanced.webp';
    }
    if (options.defenderType) {
      defenderType = options.defenderType.toUpperCase();
      var defPreview = document.getElementById('dex-preview-defender');
      if (defPreview) defPreview.src = '/references/' + defenderType.toLowerCase() + '/' + defenderVariant + '-balanced.webp';
    }

    // Always reset natures to Hardy (balanced) when opening
    // User must explicitly click to change them
    attackerNature = 'Hardy';
    defenderNature = 'Hardy';

    // Set selectedType and variant to match the current mode's lobster
    selectedType = (selectionMode === 'attacker') ? attackerType : defenderType;
    selectedVariant = (selectionMode === 'attacker') ? attackerVariant : defenderVariant;

    // Update displays for the current mode
    document.querySelectorAll('.dex-type-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.textContent === selectedType);
    });
    document.getElementById('dexLobsterImage').src = '/references/' + selectedType.toLowerCase() + '/' + selectedVariant + '-balanced.webp';
    updateTypeInfo(selectedType);
    updateMovesList(selectedType);
    updateVariants(selectedType);

    // Show Hardy as selected (the default)
    updateNatureVisual('Hardy');

    // Show selection header and confirm button
    document.getElementById('dex-selection-header').classList.add('active');
    document.getElementById('dex-confirm-btn').classList.add('active');

    // Update button states
    document.getElementById('dex-sel-attacker').classList.toggle('active', selectionMode === 'attacker');
    document.getElementById('dex-sel-defender').classList.toggle('active', selectionMode === 'defender');

    document.getElementById('lb-dex').classList.add('active');
    // In selection mode, start with book open so user can see content immediately
    document.getElementById('dex-book').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    document.getElementById('dex-book').classList.remove('open');
    setTimeout(function() {
      document.getElementById('lb-dex').classList.remove('active');
      document.body.style.overflow = '';
    }, 100);
  }

  function closeOverlay(e) {
    if (e && e.target !== e.currentTarget) return;
    close();
  }

  function setSelectionMode(mode) {
    selectionMode = mode;
    document.getElementById('dex-sel-attacker').classList.toggle('active', mode === 'attacker');
    document.getElementById('dex-sel-defender').classList.toggle('active', mode === 'defender');
    // Switch to the type and variant for the selected mode
    var newType = (mode === 'attacker') ? attackerType : defenderType;
    var newVariant = (mode === 'attacker') ? attackerVariant : defenderVariant;
    selectedType = newType;
    selectedVariant = newVariant;
    // Update displays
    document.querySelectorAll('.dex-type-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.textContent === newType);
    });
    document.getElementById('dexLobsterImage').src = '/references/' + newType.toLowerCase() + '/' + newVariant + '-balanced.webp';
    updateTypeInfo(newType);
    updateMovesList(newType);
    updateVariants(newType);
    // Highlight the correct variant
    document.querySelectorAll('.dex-variant-thumb').forEach(function(t) {
      t.classList.toggle('active', t.dataset.variant === newVariant);
    });
    // Update variant label
    var variantIndex = VARIANTS.indexOf(newVariant);
    if (variantIndex >= 0) {
      document.getElementById('dexVariantLabel').textContent = VARIANT_NAMES[variantIndex];
    }
    // Restore nature selection for this mode
    var modeNature = (mode === 'attacker') ? attackerNature : defenderNature;
    updateNatureVisual(modeNature);
  }

  function confirmSelection() {
    if (onSelectCallback) {
      // Pass both attacker and defender selections including variants
      onSelectCallback({
        attacker: { type: attackerType, variant: attackerVariant, nature: attackerNature },
        defender: { type: defenderType, variant: defenderVariant, nature: defenderNature }
      });
    }
    close();
  }

  // ═══════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════
  window.Lobsterdex = {
    open: open,
    openForSelection: openForSelection,
    close: close,
    closeOverlay: closeOverlay,
    setSelectionMode: setSelectionMode,
    confirmSelection: confirmSelection,
    getSelectedType: function() { return selectedType; },
    getTypes: function() { return TYPES.slice(); },
    getTypeMeta: function() { return TYPE_META; }
  };

})();
