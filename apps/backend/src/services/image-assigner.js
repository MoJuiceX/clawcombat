/**
 * Image Assigner Service
 *
 * Assigns reference images to lobsters based on:
 * - Type: User/bot selected (1 of 18)
 * - Variant: Determined by highest stat (1 of 7)
 * - Base: System assigned via round-robin (1 of 6)
 *
 * Goals:
 * - Ensure all 756 type-base-variant combinations get used evenly
 * - Cycle through multiple images when a combo has 2-3 options
 * - Persist usage tracking to database for fairness across restarts
 */

const fs = require('fs');
const log = require('../utils/logger').createLogger('IMAGE_ASSIGNER');
const path = require('path');
const { getDb } = require('../db/schema');

// Constants
const TYPES = ['air', 'dragon', 'earth', 'electric', 'fire', 'ghost', 'grass', 'ice', 'insect', 'martial', 'metal', 'mystic', 'neutral', 'psyche', 'shadow', 'stone', 'venom', 'water'];
const BASES = ['crawler', 'peeper', 'cadet', 'scout', 'sentinel', 'titan'];
const VARIANTS = ['attack', 'balanced', 'defense', 'hp', 'speed', 'claw', 'shell'];

// Stat name to variant mapping
const STAT_TO_VARIANT = {
  attack: 'attack',
  defense: 'defense',
  hp: 'hp',
  speed: 'speed',
  sp_atk: 'claw',   // Special Attack = Claw
  sp_def: 'shell',  // Special Defense = Shell
  claw: 'claw',     // Allow direct naming too
  shell: 'shell'
};

// Reference images directory
const REFERENCES_DIR = path.join(__dirname, '..', 'public', 'references');

// Image library cache
let imageLibrary = null;

/**
 * Build the image library by scanning the references directory
 * Returns: { type: { base: { variant: [image paths] } } }
 */
function buildImageLibrary() {
  if (imageLibrary) return imageLibrary;

  imageLibrary = {};

  // Initialize structure
  for (const type of TYPES) {
    imageLibrary[type] = {};
    for (const base of BASES) {
      imageLibrary[type][base] = {};
      for (const variant of VARIANTS) {
        imageLibrary[type][base][variant] = [];
      }
    }
  }

  // Scan each type directory
  for (const type of TYPES) {
    const typeDir = path.join(REFERENCES_DIR, type);
    if (!fs.existsSync(typeDir)) continue;

    const files = fs.readdirSync(typeDir).filter(f =>
      f.endsWith('.webp') || f.endsWith('.png')
    );

    for (const file of files) {
      const filename = file.toLowerCase().replace(/\.(webp|png)$/, '');

      // Match base-variant pattern
      for (const base of BASES) {
        for (const variant of VARIANTS) {
          // Check patterns: "base-variant" or "Type-base-variant"
          const pattern1 = `${base}-${variant}`;
          const pattern2 = `${type}-${base}-${variant}`;
          const pattern3 = `${type.charAt(0).toUpperCase()}${type.slice(1)}-${base}-${variant}`.toLowerCase();

          if (filename.startsWith(pattern1) ||
              filename.startsWith(pattern2) ||
              filename.startsWith(pattern3)) {
            const imagePath = `${type}/${file}`;
            if (!imageLibrary[type][base][variant].includes(imagePath)) {
              imageLibrary[type][base][variant].push(imagePath);
            }
          }
        }
      }
    }
  }

  // Log library stats
  let totalImages = 0;
  let coveredCombos = 0;
  for (const type of TYPES) {
    for (const base of BASES) {
      for (const variant of VARIANTS) {
        const images = imageLibrary[type][base][variant];
        totalImages += images.length;
        if (images.length > 0) coveredCombos++;
      }
    }
  }
  log.info('Image library loaded', { totalImages, coveredCombos, totalCombinations: 756 });

  return imageLibrary;
}

// Minimum difference required for a stat to be considered "dominant"
// If highest stat isn't at least this much higher than second highest, use balanced
const VARIANT_THRESHOLD = 3;

/**
 * Determine variant from stats
 * @param {Object} stats - { attack, defense, hp, speed, sp_atk/claw, sp_def/shell }
 * @returns {string} variant name
 */
function determineVariant(stats) {
  if (!stats || typeof stats !== 'object') {
    return 'balanced';
  }

  // Normalize stat names
  const normalized = {
    attack: stats.attack || 0,
    defense: stats.defense || 0,
    hp: stats.hp || 0,
    speed: stats.speed || 0,
    claw: stats.sp_atk || stats.claw || 0,
    shell: stats.sp_def || stats.shell || 0
  };

  // Sort stats by value (descending)
  const sorted = Object.entries(normalized).sort((a, b) => b[1] - a[1]);
  const [highestStat, highestValue] = sorted[0];
  const [, secondHighestValue] = sorted[1];

  // If no meaningful stats, return balanced
  if (highestValue <= 0) {
    return 'balanced';
  }

  // If highest stat isn't significantly higher than second highest, return balanced
  // Example: 18 vs 17 (diff=1) → balanced
  // Example: 25 vs 18 (diff=7) → specialized
  const difference = highestValue - secondHighestValue;
  if (difference < VARIANT_THRESHOLD) {
    return 'balanced';
  }

  // Map stat to variant
  return STAT_TO_VARIANT[highestStat] || 'balanced';
}

/**
 * Get usage key for tracking
 */
function getUsageKey(type, base, variant) {
  return `${type}|${base}|${variant}`;
}

/**
 * Get usage data from database
 * @param {string} key - type|base|variant key
 * @returns {Object} { usage_count, image_index }
 */
function getUsageFromDb(key) {
  const db = getDb();
  const row = db.prepare('SELECT usage_count, image_index FROM image_usage WHERE type_base_variant = ?').get(key);
  return row || { usage_count: 0, image_index: 0 };
}

/**
 * Increment usage in database (atomic operation)
 * @param {string} key - type|base|variant key
 * @param {number} imageCount - total images available for cycling
 * @returns {Object} { usage_count, image_index } after increment
 */
function incrementUsageInDb(key, imageCount) {
  const db = getDb();

  // Use INSERT OR REPLACE with atomic increment
  // This handles both new entries and updates in one atomic operation
  const stmt = db.prepare(`
    INSERT INTO image_usage (type_base_variant, usage_count, image_index, updated_at)
    VALUES (?, 1, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(type_base_variant) DO UPDATE SET
      usage_count = usage_count + 1,
      image_index = (image_index + 1) % ?,
      updated_at = CURRENT_TIMESTAMP
    RETURNING usage_count, image_index
  `);

  try {
    const result = stmt.get(key, imageCount || 1);
    return result || { usage_count: 1, image_index: 0 };
  } catch (e) {
    // Fallback for older SQLite without RETURNING
    db.prepare(`
      INSERT INTO image_usage (type_base_variant, usage_count, image_index, updated_at)
      VALUES (?, 1, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(type_base_variant) DO UPDATE SET
        usage_count = usage_count + 1,
        image_index = (image_index + 1) % ?,
        updated_at = CURRENT_TIMESTAMP
    `).run(key, imageCount || 1);

    return getUsageFromDb(key);
  }
}

/**
 * Select the least-used base for a given type and variant
 * @param {string} type - The lobster type
 * @param {string} variant - The stat variant
 * @returns {string} base name
 */
function selectBase(type, variant) {
  const library = buildImageLibrary();
  const db = getDb();

  // Find all bases that have images for this type-variant
  const availableBases = BASES.filter(base =>
    library[type]?.[base]?.[variant]?.length > 0
  );

  if (availableBases.length === 0) {
    log.warn('No images found, falling back to balanced variant', { type, variant });
    // Try balanced variant as fallback
    const balancedBases = BASES.filter(base =>
      library[type]?.[base]?.['balanced']?.length > 0
    );
    if (balancedBases.length > 0) {
      return balancedBases[Math.floor(Math.random() * balancedBases.length)];
    }
    return BASES[Math.floor(Math.random() * BASES.length)];
  }

  // Get usage counts for each available base from database
  const baseCounts = availableBases.map(base => {
    const key = getUsageKey(type, base, variant);
    const usage = getUsageFromDb(key);
    return {
      base,
      count: usage.usage_count
    };
  });

  // Sort by count (ascending) and pick the least used
  baseCounts.sort((a, b) => a.count - b.count);

  // Get all bases with the minimum count (for random selection among ties)
  const minCount = baseCounts[0].count;
  const leastUsedBases = baseCounts.filter(b => b.count === minCount);

  // Random selection among tied least-used bases
  const selected = leastUsedBases[Math.floor(Math.random() * leastUsedBases.length)];

  return selected.base;
}

/**
 * Select the next image for a type-base-variant combo (cycles through multiples)
 * Also increments the usage counter atomically
 * @param {string} type
 * @param {string} base
 * @param {string} variant
 * @returns {string} image path relative to references/
 */
function selectImage(type, base, variant) {
  const library = buildImageLibrary();
  const images = library[type]?.[base]?.[variant] || [];

  if (images.length === 0) {
    log.warn('No image found for combination', { type, base, variant });
    // Fallback to balanced variant
    const fallbackImages = library[type]?.[base]?.['balanced'] || [];
    if (fallbackImages.length > 0) {
      const key = getUsageKey(type, base, 'balanced');
      const usage = getUsageFromDb(key);
      const imageIndex = usage.image_index % fallbackImages.length;
      incrementUsageInDb(key, fallbackImages.length);
      return fallbackImages[imageIndex];
    }
    return null;
  }

  const key = getUsageKey(type, base, variant);

  // Get current index BEFORE incrementing
  const usage = getUsageFromDb(key);
  const imageIndex = usage.image_index % images.length;
  const selectedImage = images[imageIndex];

  // Increment usage atomically
  incrementUsageInDb(key, images.length);

  return selectedImage;
}

/**
 * Main assignment function
 * @param {string} type - User/bot selected type (e.g., 'fire', 'water')
 * @param {Object} stats - Stat allocation { attack, defense, hp, speed, sp_atk/claw, sp_def/shell }
 * @returns {Object} { type, base, variant, image, stats }
 */
function assignImage(type, stats) {
  // Validate type
  const normalizedType = type?.toLowerCase();
  if (!TYPES.includes(normalizedType)) {
    throw new Error(`Invalid type: ${type}. Must be one of: ${TYPES.join(', ')}`);
  }

  // Determine variant from stats
  const variant = determineVariant(stats);

  // Select least-used base
  const base = selectBase(normalizedType, variant);

  // Select image (cycles through multiples) and increment counter
  const image = selectImage(normalizedType, base, variant);

  return {
    type: normalizedType,
    base,
    variant,
    image,  // Path relative to /references/ (e.g., "fire/crawler-attack.webp")
    imagePath: image ? `/references/${image}` : `/references/${normalizedType}/crawler-balanced.webp`,  // Fallback
    stats
  };
}

/**
 * Get current usage statistics from database
 */
function getUsageStats() {
  const db = getDb();
  const rows = db.prepare('SELECT type_base_variant, usage_count FROM image_usage ORDER BY type_base_variant').all();

  const stats = {
    totalAssignments: 0,
    byType: {},
    byBase: {},
    byVariant: {},
    detailed: {}
  };

  for (const row of rows) {
    const [type, base, variant] = row.type_base_variant.split('|');
    const count = row.usage_count;

    stats.totalAssignments += count;
    stats.byType[type] = (stats.byType[type] || 0) + count;
    stats.byBase[base] = (stats.byBase[base] || 0) + count;
    stats.byVariant[variant] = (stats.byVariant[variant] || 0) + count;
    stats.detailed[row.type_base_variant] = count;
  }

  return stats;
}

/**
 * Reset usage tracking (for testing or new seasons)
 */
function resetUsageTracker() {
  const db = getDb();
  db.prepare('DELETE FROM image_usage').run();
  log.info('Usage tracker reset');
}

/**
 * Get library info (for debugging/admin)
 */
function getLibraryInfo() {
  const library = buildImageLibrary();
  const info = {
    types: TYPES.length,
    bases: BASES.length,
    variants: VARIANTS.length,
    totalCombinations: TYPES.length * BASES.length * VARIANTS.length,
    coveredCombinations: 0,
    totalImages: 0,
    multipleOptions: [],
    missing: []
  };

  for (const type of TYPES) {
    for (const base of BASES) {
      for (const variant of VARIANTS) {
        const images = library[type]?.[base]?.[variant] || [];
        if (images.length > 0) {
          info.coveredCombinations++;
          info.totalImages += images.length;
          if (images.length > 1) {
            info.multipleOptions.push({
              combo: `${type}/${base}/${variant}`,
              count: images.length,
              images
            });
          }
        } else {
          info.missing.push(`${type}/${base}/${variant}`);
        }
      }
    }
  }

  return info;
}

/**
 * Invalidate library cache (call when images are added/removed)
 */
function invalidateLibraryCache() {
  imageLibrary = null;
  log.info('Library cache invalidated');
}

// Export
module.exports = {
  assignImage,
  determineVariant,
  selectBase,
  selectImage,
  getUsageStats,
  resetUsageTracker,
  getLibraryInfo,
  buildImageLibrary,
  invalidateLibraryCache,
  TYPES,
  BASES,
  VARIANTS
};
