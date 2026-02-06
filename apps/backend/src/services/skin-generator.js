// Generative Skins: Condensed cyberlobster prompt system (v5)
// Optimized for FLUX 2 Pro: 40-75 word prompts, subject-first, hex colors
// Tier 1 (Lv 1-19): Young, basic | Tier 2 (Lv 20-59): Evolved | Tier 3 (Lv 60+): Final form

const crypto = require('crypto');

// ── Tier from Level ──
// Evolution occurs at level 20 (first evolution) and level 60 (final evolution)

function getTier(level) {
  if (level < 20) return 1;   // Basic form: Levels 1-19
  if (level < 60) return 2;   // Evolved form: Levels 20-59
  return 3;                    // Final form: Levels 60-100
}

// ── Type definitions: hex color + short glow phrase ──

const TYPE_HEX = {
  NEUTRAL:  { hex: '#A8A878', accent: '#D3D3D3', glow: 'clean silver-white LED strips' },
  FIRE:     { hex: '#F08030', accent: '#FF4500', glow: 'molten orange-red energy core with ember particles' },
  WATER:    { hex: '#6890F0', accent: '#1E90FF', glow: 'blue bioluminescent cooling veins pulsing' },
  ELECTRIC: { hex: '#F8D030', accent: '#FFD700', glow: 'crackling yellow-gold energy arcs between claws' },
  GRASS:    { hex: '#78C850', accent: '#32CD32', glow: 'green bio-luminescent circuits with living vines' },
  ICE:      { hex: '#98D8D8', accent: '#ADD8E6', glow: 'crystalline frost coating with cryogenic mist' },
  MARTIAL:  { hex: '#C03028', accent: '#8B0000', glow: 'crimson fighting spirit aura with cloth claw wraps' },
  VENOM:    { hex: '#A040A0', accent: '#00FF00', glow: 'toxic neon-green liquid dripping from claw tips' },
  EARTH:    { hex: '#E0C068', accent: '#DAA520', glow: 'amber earth energy cracks glowing through shell' },
  AIR:      { hex: '#A890F0', accent: '#87CEEB', glow: 'sky-blue jet trails streaming from legs' },
  PSYCHE:   { hex: '#F85888', accent: '#FF69B4', glow: 'vibrant purple-pink psychic aura with floating symbols' },
  INSECT:   { hex: '#A8B820', accent: '#6B8E23', glow: 'chitinous brown-green organic shell plating' },
  STONE:    { hex: '#B8A038', accent: '#808080', glow: 'granite mineral-encrusted shell with crystal growths' },
  GHOST:    { hex: '#705898', accent: '#9370DB', glow: 'spectral translucent shell sections with ghostly trail' },
  DRAGON:   { hex: '#7038F8', accent: '#4B0082', glow: 'deep indigo cosmic energy with star patterns' },
  SHADOW:   { hex: '#705848', accent: '#2F2F2F', glow: 'vantablack shadow tendrils with red scanner eye' },
  METAL:    { hex: '#B8B8D0', accent: '#C0C0C0', glow: 'chrome-silver mirror surfaces with exposed gears' },
  MYSTIC:   { hex: '#EE99AC', accent: '#FFB6C1', glow: 'glowing arcane runes with iridescent energy ribbons' },
};

// ── 3 Visual Buckets (replaces 12 descriptor functions) ──

// Build bucket: HP + Defense → size/armor phrase (2-4 words)
function getBuildPhrase(hp, defense, tier) {
  const combined = hp + defense;
  if (tier === 1) {
    if (combined <= 20) return 'tiny lightweight frame';
    if (combined <= 34) return 'compact starter frame';
    return 'sturdy heavy frame';
  }
  if (tier === 2) {
    if (combined <= 20) return 'lean combat frame';
    if (combined <= 34) return 'solid war frame';
    return 'massive fortress frame';
  }
  if (combined <= 20) return 'towering legendary frame';
  if (combined <= 34) return 'titanic cosmic frame';
  return 'colossal god-tier frame';
}

// Claws bucket: Attack + SpAtk → claw phrase (2-3 words)
function getClawPhrase(attack, spAtk, tier) {
  const combined = attack + spAtk;
  if (tier === 1) {
    if (combined <= 20) return 'small basic pincers';
    if (combined <= 34) return 'standard titanium claws';
    return 'oversized heavy claws';
  }
  if (tier === 2) {
    if (combined <= 20) return 'reinforced combat claws';
    if (combined <= 34) return 'heavy serrated pincers';
    return 'colossal war claws';
  }
  if (combined <= 20) return 'legendary energy claws';
  if (combined <= 34) return 'reality-shredding pincers';
  return 'godlike cosmic claws';
}

// Legs bucket: Speed → movement phrase (2-3 words)
function getLegPhrase(speed, tier) {
  if (tier === 1) {
    if (speed <= 16) return 'slow servo legs';
    if (speed <= 33) return 'standard walking legs';
    return 'fast agile legs';
  }
  if (tier === 2) {
    if (speed <= 16) return 'steady combat legs';
    if (speed <= 33) return 'swift articulated legs';
    return 'blur-fast legs';
  }
  if (speed <= 16) return 'hypersonic legs';
  if (speed <= 33) return 'quantum-fast legs';
  return 'teleporting legs';
}

// ── Tier-specific modifiers ──

const TIER_STAGE = {
  1: 'young',
  2: 'veteran battle-scarred',
  3: 'ancient legendary',
};

const TIER_MOOD = {
  1: 'eager newcomer stance',
  2: 'confident battle stance',
  3: 'commanding godlike stance',
};

const TIER_STYLE = {
  1: '3D digital art, cyberpunk gaming aesthetic, cute fierce crustacean, clean construction, bright esports arena, shot on Sony A7IV 50mm f/2.8, studio lighting',
  2: '3D digital art, cyberpunk gaming aesthetic, fierce armored crustacean warrior, battle-worn details, neon arena lighting, shot on Sony A7IV 50mm f/2.8',
  3: '3D digital art, cyberpunk cosmic aesthetic, terrifying godlike crustacean, reality-warping effects, cosmic lighting, shot on Sony A7IV 85mm f/1.4',
};

// ── Build the condensed cyberlobster prompt (40-75 words) ──

function buildSkinPrompt(agent, tierOverride) {
  const hp      = agent.base_hp || 17;
  const attack  = agent.base_attack || 17;
  const defense = agent.base_defense || 17;
  const spAtk   = agent.base_sp_atk || 17;
  const spDef   = agent.base_sp_def || 16;
  const speed   = agent.base_speed || 16;

  const type = (agent.ai_type || 'NEUTRAL').toUpperCase();
  const level = Math.floor((agent.xp || 0) / 1000) + 1;
  const tier = tierOverride || getTier(level);

  const typeInfo = TYPE_HEX[type] || TYPE_HEX.NEUTRAL;
  const typeLower = type.toLowerCase();

  // Subject first (most important for FLUX 2 Pro)
  const subject = `Chibi cybernetic robot lobster, ${TIER_STAGE[tier]} ${typeLower}-type`;

  // Type color + glow (hex codes work directly in FLUX 2 Pro)
  const color = `shell color ${typeInfo.hex}, ${typeInfo.glow}`;

  // Stat-driven modifiers (3 buckets = ~9 words)
  const build = getBuildPhrase(hp, defense, tier);
  const claws = getClawPhrase(attack, spAtk, tier);
  const legs = getLegPhrase(speed, tier);

  // Compose final prompt
  const prompt = `${subject}, ${color}, ${build}, ${claws}, ${legs}, 6 walking legs, small dark glossy black eyes, segmented tail. ${TIER_MOOD[tier]}. ${TIER_STYLE[tier]}.`;

  return prompt;
}

// ── Hash agent stats for cache invalidation ──

function hashAgentStats(agent) {
  const level = Math.floor((agent.xp || 0) / 1000) + 1;
  const tier = getTier(level);
  const statsObj = {
    v: 'cyberlobster-v5-condensed',
    tier,
    hp: agent.base_hp || 17,
    atk: agent.base_attack || 17,
    def: agent.base_defense || 17,
    spa: agent.base_sp_atk || 17,
    spd: agent.base_sp_def || 16,
    spe: agent.base_speed || 16,
    type: agent.ai_type || 'NEUTRAL',
    xp: agent.xp || 0,
  };
  return crypto.createHash('sha256').update(JSON.stringify(statsObj)).digest('hex');
}

// ── Auto-evolution: check if tier crossed after XP gain ──

function checkTierEvolution(oldXp, newXp) {
  const oldLevel = Math.floor((oldXp || 0) / 1000) + 1;
  const newLevel = Math.floor((newXp || 0) / 1000) + 1;
  const oldTier = getTier(oldLevel);
  const newTier = getTier(newLevel);

  if (newTier > oldTier) {
    return { evolved: true, oldTier, newTier, oldLevel, newLevel };
  }
  return { evolved: false, oldTier, newTier, oldLevel, newLevel };
}

module.exports = {
  buildSkinPrompt,
  hashAgentStats,
  getTier,
  checkTierEvolution,
};
