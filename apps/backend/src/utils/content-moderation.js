/**
 * Content Moderation Utility
 *
 * Provides content moderation for AI-generated social posts using OpenAI Moderation API.
 * Implements a hybrid approach: log flagged content, block severe violations.
 */

const log = require('./logger').createLogger('MODERATION');

// Moderation thresholds (0-1 scale, OpenAI returns probabilities)
const BLOCK_THRESHOLD = 0.8;  // Block content above this threshold
const FLAG_THRESHOLD = 0.5;   // Log/flag content above this threshold

/**
 * Moderate content using OpenAI Moderation API
 * @param {string} content - The content to moderate
 * @returns {Promise<{allowed: boolean, flagged: boolean, categories: object, reason: string|null}>}
 */
async function moderateContent(content) {
  // If OpenAI API key not configured, log warning and allow (graceful degradation)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn('Content moderation skipped: OPENAI_API_KEY not configured');
    return {
      allowed: true,
      flagged: false,
      categories: {},
      reason: null
    };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ input: content })
    });

    if (!response.ok) {
      log.error('OpenAI Moderation API error', {
        status: response.status,
        statusText: response.statusText
      });
      // On API failure, allow content but log warning (graceful degradation)
      return {
        allowed: true,
        flagged: false,
        categories: {},
        reason: 'moderation_api_unavailable'
      };
    }

    const data = await response.json();
    const result = data.results[0];

    // Check if any category exceeds block threshold
    const categoryScores = result.category_scores;
    const flaggedCategories = [];
    const blockedCategories = [];

    for (const [category, score] of Object.entries(categoryScores)) {
      if (score >= BLOCK_THRESHOLD) {
        blockedCategories.push({ category, score });
      } else if (score >= FLAG_THRESHOLD) {
        flaggedCategories.push({ category, score });
      }
    }

    const shouldBlock = blockedCategories.length > 0;
    const shouldFlag = flaggedCategories.length > 0 || shouldBlock;

    if (shouldBlock) {
      log.warn('Content blocked by moderation', {
        categories: blockedCategories,
        contentPreview: content.substring(0, 100)
      });
    } else if (shouldFlag) {
      log.info('Content flagged by moderation', {
        categories: flaggedCategories,
        contentPreview: content.substring(0, 100)
      });
    }

    return {
      allowed: !shouldBlock,
      flagged: shouldFlag,
      categories: {
        flagged: flaggedCategories,
        blocked: blockedCategories
      },
      reason: shouldBlock ? blockedCategories[0].category : null
    };

  } catch (err) {
    log.error('Content moderation error', { error: err.message });
    // On error, allow content but log (graceful degradation)
    return {
      allowed: true,
      flagged: false,
      categories: {},
      reason: 'moderation_error'
    };
  }
}

/**
 * Perform local rule-based checks (fast, no API call)
 * Blocks obvious spam patterns and forbidden content
 */
function localModeration(content) {
  const lower = content.toLowerCase();

  // Block excessive repetition (spam indicator)
  const words = content.split(/\s+/);
  if (words.length >= 10) {
    const wordCounts = {};
    for (const word of words) {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    }
    const maxRepeat = Math.max(...Object.values(wordCounts));
    const totalWords = words.length;
    if (maxRepeat / totalWords > 0.5) {
      return {
        allowed: false,
        reason: 'excessive_repetition'
      };
    }
  }

  // Block excessive caps (spam/shouting)
  const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
  if (content.length > 20 && capsRatio > 0.7) {
    return {
      allowed: false,
      reason: 'excessive_caps'
    };
  }

  // Block known spam patterns
  const spamPatterns = [
    /viagra|cialis/i,
    /click here now/i,
    /\$\$\$/,
    /buy now/i,
    /limited time offer/i
  ];

  for (const pattern of spamPatterns) {
    if (pattern.test(content)) {
      return {
        allowed: false,
        reason: 'spam_pattern'
      };
    }
  }

  return { allowed: true, reason: null };
}

/**
 * Combined moderation: local rules + OpenAI API
 * Returns immediately if local rules block, otherwise calls API
 */
async function moderatePost(content, options = {}) {
  const { skipApi = false } = options;

  // Step 1: Fast local checks
  const localResult = localModeration(content);
  if (!localResult.allowed) {
    log.info('Content blocked by local moderation', {
      reason: localResult.reason,
      contentPreview: content.substring(0, 100)
    });
    return {
      allowed: false,
      blocked_by: 'local',
      reason: localResult.reason,
      flagged: true
    };
  }

  // Step 2: API-based moderation (if not skipped)
  if (skipApi) {
    return {
      allowed: true,
      blocked_by: null,
      reason: null,
      flagged: false
    };
  }

  const apiResult = await moderateContent(content);
  return {
    allowed: apiResult.allowed,
    blocked_by: apiResult.allowed ? null : 'api',
    reason: apiResult.reason,
    flagged: apiResult.flagged,
    categories: apiResult.categories
  };
}

module.exports = {
  moderatePost,
  moderateContent,
  localModeration,
  BLOCK_THRESHOLD,
  FLAG_THRESHOLD
};
