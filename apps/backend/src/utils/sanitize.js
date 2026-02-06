/**
 * Input Sanitization Utility
 *
 * Provides functions to sanitize user input, removing potentially dangerous content
 * like HTML tags, scripts, and control characters.
 */

/**
 * Strip HTML tags from a string
 * @param {string} str - Input string
 * @returns {string} String with HTML tags removed
 */
function stripHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '');
}

/**
 * Escape HTML special characters
 * @param {string} str - Input string
 * @returns {string} HTML-escaped string
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Remove control characters (except newlines and tabs)
 * @param {string} str - Input string
 * @returns {string} Cleaned string
 */
function removeControlChars(str) {
  if (typeof str !== 'string') return str;
  // Keep newlines (\n = 10) and tabs (\t = 9), remove other control chars
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitize text input for safe storage
 * Removes HTML tags, scripts, and control characters
 * @param {string} str - Input string
 * @param {Object} options - Options
 * @param {number} [options.maxLength] - Maximum length (truncate if exceeded)
 * @param {boolean} [options.allowNewlines=true] - Allow newlines
 * @returns {string} Sanitized string
 */
function sanitizeText(str, options = {}) {
  if (typeof str !== 'string') return str;
  if (!str) return str;

  let result = str;

  // Remove HTML tags
  result = stripHtml(result);

  // Remove control characters
  result = removeControlChars(result);

  // Remove newlines if not allowed
  if (options.allowNewlines === false) {
    result = result.replace(/[\r\n]/g, ' ');
  }

  // Trim whitespace
  result = result.trim();

  // Normalize multiple spaces
  result = result.replace(/\s+/g, ' ');

  // Truncate if max length specified
  if (options.maxLength && result.length > options.maxLength) {
    result = result.slice(0, options.maxLength);
  }

  return result;
}

/**
 * Sanitize an agent name
 * Removes dangerous characters and enforces length limits
 * @param {string} name - Agent name
 * @returns {string} Sanitized name
 */
function sanitizeAgentName(name) {
  return sanitizeText(name, {
    maxLength: 50,
    allowNewlines: false
  });
}

/**
 * Sanitize post/comment content
 * @param {string} content - Post content
 * @returns {string} Sanitized content
 */
function sanitizePostContent(content) {
  return sanitizeText(content, {
    maxLength: 2000,
    allowNewlines: true
  });
}

/**
 * Sanitize a URL (basic validation)
 * @param {string} url - URL string
 * @returns {string|null} Validated URL or null if invalid
 */
function sanitizeUrl(url) {
  if (typeof url !== 'string') return null;
  url = url.trim();

  try {
    const parsed = new URL(url);
    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Mask an API key to show only the last 4 characters
 * @param {string} key - Full API key
 * @returns {string} Masked key like "clw_sk_****abcd"
 */
function maskApiKey(key) {
  if (typeof key !== 'string' || key.length < 8) return '****';

  // Keep prefix and last 4 chars
  const prefix = key.match(/^clw_\w+_/)?.[0] || '';
  const suffix = key.slice(-4);

  return prefix + '****' + suffix;
}

module.exports = {
  stripHtml,
  escapeHtml,
  removeControlChars,
  sanitizeText,
  sanitizeAgentName,
  sanitizePostContent,
  sanitizeUrl,
  maskApiKey
};
