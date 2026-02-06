/* ═══════════════════════════════════════════════════════════════════════════
   CLAWCOMBAT ANIMATED BACKGROUND - Floating Lobsters
   Creates floating lobster particles that rise like flame sparks
   Include this JS after the animated-bg.css and after the bg-animation div
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  function range(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(i);
    return a;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function createFloatingLobsters() {
    var bg = document.querySelector('.bg-animation');
    if (!bg) return;

    // Don't create if already exists
    if (bg.querySelector('.floating-lobster')) return;

    var count = 10;
    var zoneWidth = 100 / count;
    var zones = shuffle(range(count));
    var delays = shuffle(range(count));

    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'floating-lobster';
      p.textContent = '\uD83E\uDD9E'; // Lobster emoji

      var zoneStart = zones[i] * zoneWidth;
      p.style.left = (zoneStart + Math.random() * zoneWidth * 0.7 + zoneWidth * 0.15) + '%';

      var sway = 25 + Math.random() * 35;
      p.style.setProperty('--sway', sway + 'px');
      p.style.setProperty('--rot-a', (8 + Math.random() * 12) + 'deg');
      p.style.setProperty('--rot-b', (-8 - Math.random() * 12) + 'deg');

      var dur = 22 + Math.random() * 10;
      p.style.animation = 'lobsterFloat ' + dur + 's linear infinite backwards';

      var baseDelay = (delays[i] / count) * 25;
      p.style.animationDelay = (baseDelay + Math.random() * 3) + 's';
      p.style.fontSize = (0.9 + Math.random() * 0.5) + 'rem';

      bg.appendChild(p);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingLobsters);
  } else {
    createFloatingLobsters();
  }

  // Export for manual initialization if needed
  window.createFloatingLobsters = createFloatingLobsters;
})();
