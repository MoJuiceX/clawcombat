// ClawCombat shared auth module
// Loads Clerk, manages sign-in state, provides token for API calls
(function() {
  var clerk = null;
  var clerkReady = false;
  var readyCallbacks = [];

  // Load Clerk SDK
  function loadClerkSDK(publishableKey) {
    return new Promise(function(resolve, reject) {
      if (window.Clerk) { resolve(window.Clerk); return; }
      var script = document.createElement('script');
      script.src = 'https://cdn.clerk.com/clerk.browser.js';
      script.crossOrigin = 'anonymous';
      script.onload = function() {
        var Clerk = window.Clerk;
        if (!Clerk) { reject(new Error('Clerk SDK failed to load')); return; }
        Clerk.load({ publishableKey: publishableKey }).then(function() {
          resolve(Clerk);
        }).catch(reject);
      };
      script.onerror = function() { reject(new Error('Failed to load Clerk script')); };
      document.head.appendChild(script);
    });
  }

  // Initialize
  async function init() {
    try {
      var res = await fetch('/api/config');
      var config = await res.json();
      if (!config.clerkPublishableKey) {
        console.warn('[Auth] No Clerk publishable key configured');
        clerkReady = true;
        runCallbacks();
        return;
      }
      clerk = await loadClerkSDK(config.clerkPublishableKey);
      clerkReady = true;
      updateUI();
      runCallbacks();
    } catch (e) {
      console.error('[Auth] Init failed:', e);
      clerkReady = true;
      runCallbacks();
    }
  }

  function runCallbacks() {
    readyCallbacks.forEach(function(cb) { try { cb(); } catch(e) {} });
    readyCallbacks = [];
  }

  // Update nav UI based on sign-in state
  function updateUI() {
    var container = document.getElementById('auth-btn-container');
    if (!container) return;

    if (clerk && clerk.user) {
      var dropdownId = 'auth-dropdown-' + Date.now();

      container.innerHTML =
        '<div class="auth-dropdown-wrapper" style="position:relative;">' +
          '<button id="auth-dropdown-btn" style="display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#6366f1,#4f46e5);border:none;padding:8px 16px;border-radius:8px;cursor:pointer;color:#fff;font-size:13px;font-weight:700;">' +
            '<span>Dashboard</span>' +
            '<span style="font-size:10px;opacity:0.7;">&#9662;</span>' +
          '</button>' +
          '<div id="' + dropdownId + '" class="auth-dropdown" style="display:none;position:absolute;right:0;top:100%;margin-top:6px;background:#12121a;border:1px solid #2a2a3e;border-radius:10px;min-width:180px;box-shadow:0 10px 40px rgba(0,0,0,0.5);z-index:1000;overflow:hidden;">' +
            '<a href="/arena.html" style="display:block;padding:12px 16px;color:#ccc;text-decoration:none;font-size:13px;border-bottom:1px solid #1e1e2e;">My Arena</a>' +
            '<a href="/portfolio.html" style="display:block;padding:12px 16px;color:#ccc;text-decoration:none;font-size:13px;border-bottom:1px solid #1e1e2e;">My Portfolio</a>' +
            '<a id="auth-premium-link" href="/premium.html" style="display:block;padding:12px 16px;color:#a855f7;text-decoration:none;font-size:13px;font-weight:600;border-bottom:1px solid #1e1e2e;">&#11088; Upgrade to Premium</a>' +
            '<button id="auth-signout-btn" style="display:block;width:100%;text-align:left;padding:12px 16px;background:none;border:none;color:#888;font-size:13px;cursor:pointer;">Sign Out</button>' +
          '</div>' +
        '</div>';

      var dropdownBtn = document.getElementById('auth-dropdown-btn');
      var dropdown = document.getElementById(dropdownId);
      var isOpen = false;

      dropdownBtn.onclick = function(e) {
        e.stopPropagation();
        isOpen = !isOpen;
        dropdown.style.display = isOpen ? 'block' : 'none';
      };

      document.addEventListener('click', function() {
        if (isOpen) {
          isOpen = false;
          dropdown.style.display = 'none';
        }
      });

      // Hover effects for dropdown items
      var links = dropdown.querySelectorAll('a, button');
      links.forEach(function(link) {
        link.onmouseenter = function() { this.style.background = '#1a1a2e'; };
        link.onmouseleave = function() { this.style.background = 'none'; };
      });

      document.getElementById('auth-signout-btn').onclick = function() {
        clerk.signOut().then(function() { window.location.reload(); });
      };

      // Track premium upgrade link click
      document.getElementById('auth-premium-link').onclick = function() {
        if (window.ClawAnalytics) ClawAnalytics.trackUpgradeClicked('nav_dropdown');
      };
    } else {
      container.innerHTML =
        '<button id="auth-signin-btn" class="btn-login" style="background:transparent;border:1px solid #3a3a5e;color:#888;padding:8px 20px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;transition:all 0.2s;">Login</button>';
      var loginBtn = document.getElementById('auth-signin-btn');
      loginBtn.onmouseenter = function() { this.style.borderColor = '#6366f1'; this.style.color = '#fff'; };
      loginBtn.onmouseleave = function() { this.style.borderColor = '#3a3a5e'; this.style.color = '#888'; };
      loginBtn.onclick = function() {
        if (clerk) clerk.openSignIn();
      };
    }
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // Public API
  window.ClawAuth = {
    // Wait for auth to be ready
    onReady: function(cb) {
      if (clerkReady) { cb(); return; }
      readyCallbacks.push(cb);
    },

    // Get current user or null
    getUser: function() {
      return clerk && clerk.user ? clerk.user : null;
    },

    // Check if signed in
    isSignedIn: function() {
      return !!(clerk && clerk.user);
    },

    // Get session token for API calls
    getToken: async function() {
      if (!clerk || !clerk.session) return null;
      try {
        return await clerk.session.getToken();
      } catch (e) {
        console.error('[Auth] getToken failed:', e);
        return null;
      }
    },

    // Make authenticated fetch call
    apiFetch: async function(url, options) {
      options = options || {};
      options.headers = options.headers || {};
      var token = await this.getToken();
      if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
      }
      if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
      }
      return fetch(url, options);
    },

    // Open sign-in dialog. Returns promise that resolves when signed in.
    signIn: function() {
      return new Promise(function(resolve) {
        if (!clerk) { resolve(false); return; }
        if (clerk.user) { resolve(true); return; }
        clerk.openSignIn({
          afterSignInUrl: window.location.href,
          afterSignUpUrl: window.location.href,
        });
        // Poll for sign-in completion
        var check = setInterval(function() {
          if (clerk.user) {
            clearInterval(check);
            updateUI();
            // Track sign-in event
            if (window.ClawAnalytics) {
              // Check if this is a new user (created within last minute)
              var createdAt = clerk.user.createdAt ? new Date(clerk.user.createdAt) : null;
              var isNewUser = createdAt && (Date.now() - createdAt.getTime()) < 60000;
              if (isNewUser) {
                ClawAnalytics.trackSignUp();
              } else {
                ClawAnalytics.trackSignIn();
              }
            }
            resolve(true);
          }
        }, 500);
      });
    },

    // Open sign-up dialog
    signUp: function() {
      if (clerk) {
        clerk.openSignUp({
          afterSignUpUrl: window.location.href,
          afterSignInUrl: window.location.href,
        });
      }
    },

    // Force refresh UI
    refreshUI: function() { updateUI(); }
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
