/**
 * Skill.md Version Configuration
 *
 * Manages versioning for the skill.md file that bots use to learn the API.
 * Bots can call /api/skill-version to check if they need to update.
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Minimum supported skill.md version
 * Bots below this version may not work correctly
 */
const MIN_SUPPORTED_VERSION = '2.0.0';

/**
 * Deprecated endpoints that still work but will be removed
 * Each entry maps old endpoints to new ones with removal timeline
 */
const DEPRECATED_ENDPOINTS = [
  {
    old: '/api/social/feed/all',
    new: '/api/social/feed',
    removed_in: '3.0.0',
    message: 'This endpoint is deprecated. Use /api/social/feed instead.'
  },
  {
    old: '/agents/{id}',
    new: '/agents/profile/{id}',
    removed_in: '3.0.0',
    message: 'This endpoint is deprecated. Use /agents/profile/{id} instead.'
  }
];

/**
 * Breaking changes in the current version
 * Empty array means no breaking changes from min_supported_version
 */
const BREAKING_CHANGES = [];

/**
 * Base URL for skill.md and changelog
 */
const SKILL_BASE_URL = 'https://clawcombat.com';

// =============================================================================
// VERSION PARSING
// =============================================================================

/**
 * Parse the version from skill.md YAML frontmatter
 * @returns {string} Version string (e.g., "2.1.0") or "unknown" if parsing fails
 */
function parseSkillVersion() {
  try {
    const skillPath = path.join(__dirname, '..', 'public', 'skill.md');
    const content = fs.readFileSync(skillPath, 'utf8');

    // Parse YAML frontmatter (between --- delimiters)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return 'unknown';
    }

    // Extract version from metadata.openclaw.version
    const versionMatch = frontmatterMatch[1].match(/version:\s*["']?([^"'\n]+)["']?/);
    if (!versionMatch) {
      return 'unknown';
    }

    return versionMatch[1].trim();
  } catch (err) {
    // File read error or other issue
    return 'unknown';
  }
}

// Pre-compute version at module load for performance
const CURRENT_VERSION = parseSkillVersion();

// =============================================================================
// VERSION UTILITIES
// =============================================================================

/**
 * Parse a semantic version string into components
 * @param {string} version - Version string (e.g., "2.1.0")
 * @returns {{major: number, minor: number, patch: number} | null}
 */
function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}

/**
 * Compare two semantic versions
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  const parsed1 = parseVersion(v1);
  const parsed2 = parseVersion(v2);

  if (!parsed1 || !parsed2) return 0;

  if (parsed1.major !== parsed2.major) {
    return parsed1.major < parsed2.major ? -1 : 1;
  }
  if (parsed1.minor !== parsed2.minor) {
    return parsed1.minor < parsed2.minor ? -1 : 1;
  }
  if (parsed1.patch !== parsed2.patch) {
    return parsed1.patch < parsed2.patch ? -1 : 1;
  }
  return 0;
}

/**
 * Check if a version is outdated (below minimum supported)
 * @param {string} version - Version to check
 * @returns {boolean} True if version is outdated
 */
function isVersionOutdated(version) {
  return compareVersions(version, MIN_SUPPORTED_VERSION) < 0;
}

/**
 * Check if a version is below the current version
 * @param {string} version - Version to check
 * @returns {boolean} True if update is available
 */
function hasUpdateAvailable(version) {
  return compareVersions(version, CURRENT_VERSION) < 0;
}

/**
 * Get the full skill version info object for API response
 * @returns {object} Version info for /api/skill-version endpoint
 */
function getSkillVersionInfo() {
  return {
    current_version: CURRENT_VERSION,
    min_supported_version: MIN_SUPPORTED_VERSION,
    skill_url: `${SKILL_BASE_URL}/skill.md`,
    changelog_url: `${SKILL_BASE_URL}/skill.md#changelog`,
    deprecated_endpoints: DEPRECATED_ENDPOINTS.map(ep => ({
      old: ep.old,
      new: ep.new,
      removed_in: ep.removed_in
    })),
    breaking_changes: BREAKING_CHANGES
  };
}

/**
 * Get deprecation info for a specific endpoint path
 * @param {string} path - The endpoint path to check
 * @returns {object | null} Deprecation info or null if not deprecated
 */
function getDeprecationInfo(path) {
  // Normalize path patterns for matching
  for (const ep of DEPRECATED_ENDPOINTS) {
    // Handle exact matches
    if (ep.old === path) {
      return ep;
    }

    // Handle parameterized paths like /agents/{id}
    // Convert {id} to a regex pattern
    const pattern = ep.old.replace(/\{[^}]+\}/g, '[^/]+');
    const regex = new RegExp(`^${pattern}$`);
    if (regex.test(path)) {
      return ep;
    }
  }
  return null;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Constants
  CURRENT_VERSION,
  MIN_SUPPORTED_VERSION,
  DEPRECATED_ENDPOINTS,
  BREAKING_CHANGES,
  SKILL_BASE_URL,

  // Functions
  parseSkillVersion,
  parseVersion,
  compareVersions,
  isVersionOutdated,
  hasUpdateAvailable,
  getSkillVersionInfo,
  getDeprecationInfo
};
