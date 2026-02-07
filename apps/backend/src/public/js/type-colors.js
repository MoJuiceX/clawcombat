// ============================================
// TYPE_COLORS - Single source of truth
// Include this script before any other JS that needs type colors
// Supports: lowercase (fire), uppercase (FIRE), and Pokemon names (FIGHTING)
// ============================================

var TYPE_COLORS = {
  // ClawCombat names (lowercase) - canonical
  neutral: '#A8A878',
  fire: '#F08030',
  water: '#6890F0',
  electric: '#F8D030',
  grass: '#78C850',
  ice: '#98D8D8',
  martial: '#C03028',
  venom: '#A040A0',
  earth: '#E0C068',
  air: '#A890F0',
  psyche: '#F85888',
  insect: '#A8B820',
  stone: '#B8A038',
  ghost: '#705898',
  dragon: '#7038F8',
  shadow: '#705848',
  metal: '#B8B8D0',
  mystic: '#EE99AC',

  // ClawCombat names (UPPERCASE)
  NEUTRAL: '#A8A878',
  FIRE: '#F08030',
  WATER: '#6890F0',
  ELECTRIC: '#F8D030',
  GRASS: '#78C850',
  ICE: '#98D8D8',
  MARTIAL: '#C03028',
  VENOM: '#A040A0',
  EARTH: '#E0C068',
  AIR: '#A890F0',
  PSYCHE: '#F85888',
  INSECT: '#A8B820',
  STONE: '#B8A038',
  GHOST: '#705898',
  DRAGON: '#7038F8',
  SHADOW: '#705848',
  METAL: '#B8B8D0',
  MYSTIC: '#EE99AC',

  // Pokemon name aliases (for backward compatibility)
  normal: '#A8A878',
  NORMAL: '#A8A878',
  fighting: '#C03028',
  FIGHTING: '#C03028',
  poison: '#A040A0',
  POISON: '#A040A0',
  ground: '#E0C068',
  GROUND: '#E0C068',
  flying: '#A890F0',
  FLYING: '#A890F0',
  psychic: '#F85888',
  PSYCHIC: '#F85888',
  bug: '#A8B820',
  BUG: '#A8B820',
  rock: '#B8A038',
  ROCK: '#B8A038',
  dark: '#705848',
  DARK: '#705848',
  steel: '#B8B8D0',
  STEEL: '#B8B8D0',
  fairy: '#EE99AC',
  FAIRY: '#EE99AC'
};

// Helper function to get color safely (handles any case)
function getTypeColor(typeName) {
  if (!typeName) return '#666';
  return TYPE_COLORS[typeName] || TYPE_COLORS[typeName.toLowerCase()] || TYPE_COLORS[typeName.toUpperCase()] || '#666';
}

// Types that need dark text for contrast (light background colors)
var DARK_TEXT_TYPES = ['neutral', 'NEUTRAL', 'normal', 'NORMAL', 'electric', 'ELECTRIC',
  'ice', 'ICE', 'earth', 'EARTH', 'ground', 'GROUND', 'insect', 'INSECT', 'bug', 'BUG',
  'stone', 'STONE', 'rock', 'ROCK', 'metal', 'METAL', 'steel', 'STEEL', 'mystic', 'MYSTIC', 'fairy', 'FAIRY'];

function needsDarkText(typeName) {
  return DARK_TEXT_TYPES.indexOf(typeName) !== -1 ||
         DARK_TEXT_TYPES.indexOf((typeName || '').toLowerCase()) !== -1;
}
