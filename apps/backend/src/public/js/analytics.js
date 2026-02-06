// ClawCombat Analytics Module
// Lightweight event tracking that integrates with Plausible, GA4, or custom backend
(function() {
  'use strict';

  var config = {
    // Set to 'plausible', 'gtag', or 'custom'
    provider: 'custom',
    // Custom backend endpoint for storing events
    customEndpoint: '/api/events',
    // Debug mode - logs events to console
    debug: false,
    // Session ID for grouping events
    sessionId: null
  };

  // Generate unique session ID
  function generateSessionId() {
    return 'sess_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  // Get or create session ID
  function getSessionId() {
    if (config.sessionId) return config.sessionId;
    try {
      config.sessionId = sessionStorage.getItem('claw_session_id');
      if (!config.sessionId) {
        config.sessionId = generateSessionId();
        sessionStorage.setItem('claw_session_id', config.sessionId);
      }
    } catch (e) {
      config.sessionId = generateSessionId();
    }
    return config.sessionId;
  }

  // Get device type
  function getDeviceType() {
    var ua = navigator.userAgent;
    if (/mobile/i.test(ua)) return 'mobile';
    if (/tablet/i.test(ua)) return 'tablet';
    return 'desktop';
  }

  // Get referrer domain
  function getReferrerDomain() {
    try {
      if (!document.referrer) return null;
      var url = new URL(document.referrer);
      if (url.hostname === window.location.hostname) return null;
      return url.hostname;
    } catch (e) {
      return null;
    }
  }

  // Track event via Plausible
  function trackPlausible(eventName, props) {
    if (window.plausible) {
      window.plausible(eventName, { props: props });
    }
  }

  // Track event via Google Analytics 4
  function trackGtag(eventName, props) {
    if (window.gtag) {
      window.gtag('event', eventName, props);
    }
  }

  // Track event via custom backend
  function trackCustom(eventName, props) {
    var payload = {
      event: eventName,
      props: props || {},
      url: window.location.pathname,
      referrer: getReferrerDomain(),
      device: getDeviceType(),
      session_id: getSessionId(),
      timestamp: new Date().toISOString()
    };

    // Use sendBeacon for reliability (works even on page unload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon(config.customEndpoint, JSON.stringify(payload));
    } else {
      // Fallback to fetch
      fetch(config.customEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function() {});
    }
  }

  // Main track function
  function track(eventName, props) {
    props = props || {};

    // Add user ID if signed in
    if (window.ClawAuth && window.ClawAuth.isSignedIn()) {
      var user = window.ClawAuth.getUser();
      if (user) {
        props.user_id = user.id;
      }
    }

    if (config.debug) {
      console.log('[Analytics]', eventName, props);
    }

    switch (config.provider) {
      case 'plausible':
        trackPlausible(eventName, props);
        break;
      case 'gtag':
        trackGtag(eventName, props);
        break;
      case 'custom':
      default:
        trackCustom(eventName, props);
        break;
    }
  }

  // Track page view
  function trackPageView(pageName) {
    var props = {
      page: pageName || document.title,
      path: window.location.pathname
    };
    track('page_view', props);
  }

  // Auto-track page views
  function autoTrackPageViews() {
    // Track initial page view
    trackPageView();

    // Track SPA navigation if History API is used
    var originalPushState = history.pushState;
    history.pushState = function() {
      originalPushState.apply(history, arguments);
      trackPageView();
    };

    window.addEventListener('popstate', function() {
      trackPageView();
    });
  }

  // Configure analytics
  function configure(options) {
    if (options.provider) config.provider = options.provider;
    if (options.customEndpoint) config.customEndpoint = options.customEndpoint;
    if (options.debug !== undefined) config.debug = options.debug;
  }

  // Public API
  window.ClawAnalytics = {
    configure: configure,
    track: track,
    trackPageView: trackPageView,

    // Convenience methods for common events
    trackSignIn: function() {
      track('sign_in', { method: 'clerk' });
    },
    trackSignUp: function() {
      track('sign_up', { method: 'clerk' });
    },
    trackLobsterClaimed: function(lobsterId, lobsterName) {
      track('lobster_claimed', { lobster_id: lobsterId, lobster_name: lobsterName });
    },
    trackLobsterCreated: function(lobsterId, lobsterName, lobsterType) {
      track('lobster_created', { lobster_id: lobsterId, lobster_name: lobsterName, type: lobsterType });
    },
    trackBattleQueued: function(lobsterId) {
      track('battle_queued', { lobster_id: lobsterId });
    },
    trackBattleStarted: function(battleId, lobsterId) {
      track('battle_started', { battle_id: battleId, lobster_id: lobsterId });
    },
    trackBattleCompleted: function(battleId, won, xpGained) {
      track('battle_completed', { battle_id: battleId, won: won, xp_gained: xpGained });
    },
    trackPremiumViewed: function() {
      track('premium_page_viewed');
    },
    trackPremiumSubscribed: function() {
      track('premium_subscribed');
    },
    trackUpgradeClicked: function(source) {
      track('upgrade_clicked', { source: source });
    },
    trackReplayViewed: function(battleId) {
      track('replay_viewed', { battle_id: battleId });
    },
    trackShareClicked: function(platform, contentType) {
      track('share_clicked', { platform: platform, content_type: contentType });
    }
  };

  // Auto-track page views when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoTrackPageViews);
  } else {
    autoTrackPageViews();
  }
})();
