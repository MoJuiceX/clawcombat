// ============================================
// CANVAS PARTICLE SYSTEM - Attack Effects
// Supports: beam, projectile, arc, charge, slash, wave, swarm, drain, status
// ============================================
(function() {
  var canvas, ctx;
  var particles = [];
  var animationId = null;

  // ============================================
  // TYPE EFFECT CONFIGURATIONS
  // ============================================
  var TYPE_EFFECTS = {
    fire: {
      colors: ['#ff4500', '#ff6b35', '#ffa500', '#ffcc00', '#fff'],
      flashColor: 'rgba(255, 100, 0, 0.3)',
      shapes: ['circle', 'star'],
      gravity: -0.05,
      sound: 'burst'
    },
    water: {
      colors: ['#0066ff', '#0099ff', '#00ccff', '#66d9ff', '#fff'],
      flashColor: 'rgba(0, 100, 255, 0.3)',
      shapes: ['circle'],
      gravity: 0.1,
      sound: 'wave'
    },
    electric: {
      colors: ['#ffff00', '#ffcc00', '#fff', '#ffe066'],
      flashColor: 'rgba(255, 255, 100, 0.4)',
      shapes: ['bolt', 'line'],
      gravity: 0,
      sound: 'electric'
    },
    grass: {
      colors: ['#22c55e', '#4ade80', '#86efac', '#166534'],
      flashColor: 'rgba(50, 200, 100, 0.25)',
      shapes: ['leaf'],
      gravity: 0.02,
      sound: 'slash'
    },
    ice: {
      colors: ['#a5f3fc', '#67e8f9', '#22d3ee', '#fff'],
      flashColor: 'rgba(150, 220, 255, 0.3)',
      shapes: ['snowflake', 'star'],
      gravity: 0.03,
      sound: 'beam'
    },
    martial: {
      colors: ['#dc2626', '#ef4444', '#fca5a5', '#fff'],
      flashColor: 'rgba(255, 50, 50, 0.3)',
      shapes: ['star', 'ring'],
      gravity: 0,
      sound: 'strike'
    },
    venom: {
      colors: ['#a855f7', '#c084fc', '#7c3aed', '#581c87'],
      flashColor: 'rgba(150, 50, 200, 0.3)',
      shapes: ['circle'],
      gravity: 0.08,
      sound: 'status'
    },
    earth: {
      colors: ['#92400e', '#b45309', '#d97706', '#78350f'],
      flashColor: 'rgba(150, 100, 50, 0.3)',
      shapes: ['square'],
      gravity: 0.15,
      sound: 'burst'
    },
    air: {
      colors: ['#c4b5fd', '#a78bfa', '#8b5cf6', '#e0d5ff'],
      flashColor: 'rgba(180, 160, 255, 0.25)',
      shapes: ['line'],
      gravity: -0.02,
      sound: 'slash'
    },
    psyche: {
      colors: ['#ec4899', '#f472b6', '#f9a8d4', '#d946ef'],
      flashColor: 'rgba(230, 100, 200, 0.3)',
      shapes: ['ring', 'circle'],
      gravity: 0,
      sound: 'wave'
    },
    insect: {
      colors: ['#84cc16', '#a3e635', '#65a30d'],
      flashColor: 'rgba(130, 200, 50, 0.25)',
      shapes: ['circle'],
      gravity: 0,
      sound: 'hit'
    },
    stone: {
      colors: ['#78716c', '#a8a29e', '#57534e', '#d6d3d1'],
      flashColor: 'rgba(120, 110, 100, 0.3)',
      shapes: ['square'],
      gravity: 0.2,
      sound: 'burst'
    },
    ghost: {
      colors: ['#7c3aed', '#8b5cf6', '#a78bfa', '#4c1d95'],
      flashColor: 'rgba(100, 50, 150, 0.35)',
      shapes: ['circle'],
      gravity: -0.02,
      sound: 'status'
    },
    dragon: {
      colors: ['#7c3aed', '#6d28d9', '#5b21b6', '#a78bfa', '#c084fc'],
      flashColor: 'rgba(120, 50, 220, 0.35)',
      shapes: ['star', 'circle'],
      gravity: 0,
      sound: 'beam'
    },
    shadow: {
      colors: ['#1f2937', '#374151', '#4b5563', '#111827'],
      flashColor: 'rgba(30, 30, 40, 0.4)',
      shapes: ['circle'],
      gravity: 0,
      sound: 'status'
    },
    metal: {
      colors: ['#9ca3af', '#d1d5db', '#e5e7eb', '#fff'],
      flashColor: 'rgba(200, 200, 210, 0.3)',
      shapes: ['star', 'line'],
      gravity: 0.1,
      sound: 'slash'
    },
    mystic: {
      colors: ['#f9a8d4', '#f472b6', '#ec4899', '#fbcfe8', '#fff'],
      flashColor: 'rgba(250, 180, 220, 0.3)',
      shapes: ['star'],
      gravity: -0.02,
      sound: 'wave'
    },
    neutral: {
      colors: ['#d1d5db', '#9ca3af', '#e5e7eb', '#fff'],
      flashColor: 'rgba(200, 200, 200, 0.25)',
      shapes: ['circle'],
      gravity: 0,
      sound: 'hit'
    }
  };

  // ============================================
  // MOVE OVERRIDE MAP - Custom patterns for specific moves
  // ============================================
  var MOVE_OVERRIDES = {
    // Musical note moves - singing/sound attacks
    'Lullaby': { pattern: 'wave', particles: ['♪', '♫', '♬'], particleType: 'text' },
    'Dissonance': { pattern: 'wave', particles: ['♪', '♫', '♬'], particleType: 'text' },
    'Soothing Cry': { pattern: 'wave', particles: ['♪', '♫'], particleType: 'text' },
    'Iron Wail': { pattern: 'wave', particles: ['♪', '♫'], particleType: 'text' },
    'Insect Wail': { pattern: 'wave', particles: ['♪', '♫'], particleType: 'text' },

    // Arc trajectories - thrown objects that arc through the air
    'Tsunami Strike': { pattern: 'arc', shortArc: true },  // Faster visual to match sound
    'Stone Throw': { pattern: 'arc' },
    'Cosmic Stone': { pattern: 'arc' },
    'Curse Throw': { pattern: 'arc' },
    'Draco Meteor': { pattern: 'arc', count: 3 },
    'Dust Throw': { pattern: 'arc' },
    'Web Trap': { pattern: 'arc' },

    // Swarm/multi-hit - multiple projectiles with custom visuals
    'Bubble Burst': { pattern: 'swarm', count: 8, swarmStyle: 'bubbles' },
    'Spirit Volley': { pattern: 'swarm', count: 4 },
    'Hive Strike': { pattern: 'swarm', count: 10, swarmStyle: 'bees' },
    'Avalanche': { pattern: 'swarm', count: 8, swarmStyle: 'avalanche' },

    // Charge attacks - rushing forward with trail
    'Blazing Charge': { pattern: 'charge', trail: true },
    'Reckless Charge': { pattern: 'charge', trail: true },
    'Thunder Rush': { pattern: 'charge', trail: true },
    'Branch Breaker': { pattern: 'charge', trail: true },
    'Reckless Swoop': { pattern: 'charge', trail: true },
    'Storm Charge': { pattern: 'charge', trail: true },
    'Flame Charge': { pattern: 'charge', trail: true },
    'Tide Rush': { pattern: 'charge', trail: true },
    'Rapids Charge': { pattern: 'charge', trail: true },
    'Heaven Charge': { pattern: 'charge', trail: true },
    'Mental Crush': { pattern: 'charge' },
    'Exo Slam': { pattern: 'charge' },
    'Metal Grinder': { pattern: 'charge' },
    'Metal Skull': { pattern: 'charge' },
    'Mystic Wheel': { pattern: 'charge' },
    'Toxin Blast': { pattern: 'charge' },
    'Poison Wheel': { pattern: 'charge' },
    'Ground Slam': { pattern: 'charge' },
    'Earth Stomp': { pattern: 'charge' },
    'Frozen Crush': { pattern: 'charge' },
    'Phantom Strike': { pattern: 'charge' },
    'Ghost Rush': { pattern: 'charge' },
    'Rampage': { pattern: 'charge' },
    'Serpent Tackle': { pattern: 'charge' },
    'Shadow Assault': { pattern: 'charge' },
    'Dig Attack': { pattern: 'charge' },

    // Slash moves - melee strike effects
    'Rapid Jab': { pattern: 'slash' },
    'Burning Strike': { pattern: 'slash', slashStyle: 'fire' },
    'Edge Strike': { pattern: 'slash' },
    'Blitz Punch': { pattern: 'slash' },
    'Vitality Punch': { pattern: 'slash' },
    'Spin Kick': { pattern: 'slash' },
    'Scissor Chop': { pattern: 'slash' },
    'Radiant Edge': { pattern: 'slash' },
    'Stem Strike': { pattern: 'slash' },
    'Frost Pike': { pattern: 'slash' },
    'Frozen Knuckle': { pattern: 'slash' },
    'Quick Freeze': { pattern: 'slash' },
    'Exo Lance': { pattern: 'slash' },
    'Life Drain': { pattern: 'slash' },
    'Earth Cleaver': { pattern: 'slash' },
    'Club Strike': { pattern: 'slash' },
    'Sky Strike': { pattern: 'slash' },
    'Sky Razor': { pattern: 'slash' },
    'Phantom Fist': { pattern: 'slash' },
    'Phantom Slash': { pattern: 'slash' },
    'Dragon Claw': { pattern: 'slash' },
    'Dragon Tail': { pattern: 'slash' },
    'Dirty Trick': { pattern: 'slash' },
    'Gnash': { pattern: 'slash' },
    'Swipe': { pattern: 'slash' },
    'Shadow Blade': { pattern: 'slash' },
    'Iron Fist': { pattern: 'slash' },
    'Metal Claw': { pattern: 'slash' },
    'Steel Wing': { pattern: 'slash' },
    'Mineral Blade': { pattern: 'slash' },
    'Thought Edge': { pattern: 'slash' },
    'Claw Crusher': { pattern: 'slash' },
    'Instant Jolt': { pattern: 'slash' },
    'Volt Strike': { pattern: 'slash' },

    // Wave effects - with type-specific emojis
    'Shock Wave': { pattern: 'wave', waveEmoji: '⚡' },
    'Thunder Wave': { pattern: 'wave', waveEmoji: '⚡' },
    'Lava Plume': { pattern: 'wave', waveEmoji: '🔥' },
    'Fire Spin': { pattern: 'wave', waveEmoji: '🔥' },
    'Chi Burst': { pattern: 'wave' },
    'Desert Fury': { pattern: 'wave' },
    'Burning Dunes': { pattern: 'wave' },
    'Earth Splitter': { pattern: 'wave' },
    'Cyclone': { pattern: 'wave' },
    'Downdraft': { pattern: 'wave' },
    'Lava Plume': { pattern: 'wave' },
    'Fire Spin': { pattern: 'wave' },
    'Spore Shock': { pattern: 'wave' },
    'Dream Pollen': { pattern: 'wave' },
    'Fiber Cloud': { pattern: 'wave' },
    'Snowstorm': { pattern: 'wave' },
    'Venom Dust': { pattern: 'wave' },
    'Deadly Dose': { pattern: 'wave' },
    'Toxin Spray': { pattern: 'wave' },
    'Crude Coat': { pattern: 'wave' },
    'Glitter Breeze': { pattern: 'wave' },
    'Perplex': { pattern: 'wave' },
    'Mesmerize': { pattern: 'wave' },
    'Mind Bend': { pattern: 'wave' },
    'Bewilderment': { pattern: 'wave' },
    'Vortex': { pattern: 'wave' },
    'Hijack': { pattern: 'wave' },
    'Deceive': { pattern: 'wave' },
    'Void Sleep': { pattern: 'wave' },
    'Final Curse': { pattern: 'wave' },
    'Shadow Wave': { pattern: 'wave' },
    'Bloom Blast': { pattern: 'wave' },
    'Addling Kiss': { pattern: 'wave' },
    'Captivate': { pattern: 'wave' },
    'Static Field': { pattern: 'wave' },
    'Curse': { pattern: 'wave' },

    // Beam effects - energy rays
    'Flamethrower': { pattern: 'swarm', swarmStyle: 'flames' },  // Wild flames, not beam
    'Thermal Overload': { pattern: 'beam' },
    'Ghost Burn': { pattern: 'beam', colors: ['#ffffff', '#99ccff', '#66b3ff'] },
    'Northern Light': { pattern: 'beam', colors: ['#00ff88', '#00ffcc', '#66ffff', '#ff66ff'] },
    'Deep Freeze': { pattern: 'beam' },
    'Chill Blast': { pattern: 'beam' },
    'Volt Cannon': { pattern: 'beam' },
    'Arc Cannon': { pattern: 'beam' },
    'Life Leech': { pattern: 'drain' },
    'Drain Root': { pattern: 'drain' },
    'Dream Drain': { pattern: 'drain' },
    'Noxious Burst': { pattern: 'beam' },
    'Air Cannon': { pattern: 'beam' },
    'Fate Strike': { pattern: 'beam' },
    'Mind Ray': { pattern: 'beam' },
    'Sixth Sense': { pattern: 'beam' },
    'Beacon Blast': { pattern: 'beam' },
    'Primal Force': { pattern: 'beam' },
    'Hex': { pattern: 'beam' },
    'Serpent Fume': { pattern: 'beam' },
    'Reality Rip': { pattern: 'beam' },
    'Dragon Pulse': { pattern: 'beam' },
    'Burning Rage': { pattern: 'beam' },
    'Flash Cannon': { pattern: 'beam' },

    // Self aura - buff effects on self with unique visuals
    'Store Energy': { pattern: 'self_aura', auraStyle: 'charge' },
    'Regenerate': { pattern: 'self_aura', auraStyle: 'heal' },
    'War Posture': { pattern: 'self_aura' },
    'Ember Ward': { pattern: 'self_aura', auraStyle: 'flame' },
    'Fortify': { pattern: 'self_aura', auraStyle: 'stone' },
    'Steel Skin': { pattern: 'self_aura', auraStyle: 'metal' },
    'Thorn Guard': { pattern: 'self_aura' },
    'Fiber Shield': { pattern: 'self_aura' },
    'Anticipate': { pattern: 'self_aura' },
    'Power Stance': { pattern: 'self_aura' },
    'Toxic Shield': { pattern: 'self_aura' },
    'Detoxify': { pattern: 'self_aura' },
    'Slime Coat': { pattern: 'self_aura' },
    'Dust Recovery': { pattern: 'self_aura' },
    'Perch': { pattern: 'self_aura' },
    'Mirror Mind': { pattern: 'self_aura' },
    'Concentrate': { pattern: 'self_aura' },
    'Bioluminescence': { pattern: 'self_aura' },
    'Geo Barrier': { pattern: 'self_aura' },
    'Stone Sharpen': { pattern: 'self_aura' },
    'Serpent Form': { pattern: 'self_aura' },
    'Malicious Intent': { pattern: 'self_aura' },
    'Royal Guard': { pattern: 'self_aura' },
    'Steel Skin': { pattern: 'self_aura' },
    'Trick Guard': { pattern: 'self_aura' },
    'Lunar Glow': { pattern: 'self_aura' },
    'Earth Magic': { pattern: 'self_aura' },

    // Projectile - standard ranged attacks
    'Hot Coal': { pattern: 'projectile' },
    'Splash Shot': { pattern: 'projectile' },
    'Lightning Strike': { pattern: 'projectile' },
    'Spark': { pattern: 'projectile' },
    'Corrosive': { pattern: 'projectile' },
    'Sludge Shot': { pattern: 'projectile' },
    'Wind Puff': { pattern: 'projectile' },
    'Shadow Ball': { pattern: 'projectile' },
    'Metal Sphere': { pattern: 'projectile' },
    'Life Kiss': { pattern: 'projectile' },
    'Drain Bubble': { pattern: 'drain' },

    // Status drift - status-only moves targeting opponent
    'Mock': { pattern: 'status_drift' },
    'Aggro Dust': { pattern: 'status_drift' }
  };

  // ============================================
  // CANVAS INIT
  // ============================================
  function initCanvas() {
    canvas = document.getElementById('effectCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resizeCanvas();
  }

  function resizeCanvas() {
    var arena = document.getElementById('arena');
    if (!arena || !canvas) return;
    canvas.width = arena.clientWidth;
    canvas.height = arena.clientHeight;
  }

  // ============================================
  // PARTICLE CLASS
  // ============================================
  function Particle(x, y, config) {
    config = config || {};
    this.x = x;
    this.y = y;
    this.startX = x;
    this.startY = y;
    this.life = config.life || 1;
    this.maxLife = this.life;
    this.size = config.size || 5;
    this.speed = config.speed || 2;
    this.angle = config.angle != null ? config.angle : Math.random() * Math.PI * 2;
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this.color = config.color || '#fff';
    this.gravity = config.gravity || 0;
    this.friction = config.friction || 1;
    this.shape = config.shape || 'circle';
    this.text = config.text || null; // For text particles (musical notes, etc.)
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.2;

    // Projectile travel
    this.targetX = config.targetX;
    this.targetY = config.targetY;
    this.travelSpeed = config.travelSpeed || 0;
    this.arrived = !config.targetX;

    // Arc trajectory
    this.isArc = config.isArc || false;
    this.arcProgress = 0;
    this.arcDuration = config.arcDuration || 600;
    this.arcStartTime = Date.now();
    this.arcPeakHeight = config.arcPeakHeight || 80;

    // Beam properties
    this.isBeam = config.isBeam || false;
    this.beamLength = config.beamLength || 0;
    this.beamTargetLength = config.beamTargetLength || 200;

    // Drain (reverse flow)
    this.isDrain = config.isDrain || false;
    this.drainDelay = config.drainDelay || 0;
    this.drainStartTime = Date.now();
  }

  Particle.prototype.update = function() {
    // Arc trajectory (parabolic)
    if (this.isArc && this.targetX !== undefined) {
      var elapsed = Date.now() - this.arcStartTime;
      var t = Math.min(1, elapsed / this.arcDuration);
      this.arcProgress = t;

      // Linear interpolation for x
      this.x = this.startX + (this.targetX - this.startX) * t;

      // Parabolic for y: rises then falls
      var parabola = -4 * this.arcPeakHeight * t * (t - 1);
      var linearY = this.startY + (this.targetY - this.startY) * t;
      this.y = linearY - parabola;

      if (t >= 1) {
        this.arrived = true;
        this.isArc = false;
        // Burst on arrival
        this.vx = (Math.random() - 0.5) * 4;
        this.vy = (Math.random() - 0.5) * 4;
        this.life = Math.min(this.life, 0.25);
        this.maxLife = this.life;
      }
      this.life -= 0.005;
      this.rotation += this.rotationSpeed;
      return;
    }

    // Sine wave particle - oscillates up/down while traveling to target
    if (this.isSineWave) {
      var elapsed = Date.now() - this.sineStartTime;
      var t = Math.min(1, elapsed / this.sineDuration);

      // Ease-out for natural deceleration
      var easedT = 1 - Math.pow(1 - t, 2);

      // Linear X position from start to end
      this.x = this.sineStartX + (this.sineEndX - this.sineStartX) * easedT;

      // Sine wave Y oscillation
      var waveProgress = t * this.sineFrequency * Math.PI * 2 + this.sinePhase;
      var sineOffset = Math.sin(waveProgress) * this.sineAmplitude * (1 - t * 0.5);  // Dampen near end

      // Base Y interpolation plus sine offset
      var baseY = this.sineStartY + (this.sineEndY - this.sineStartY) * easedT;
      this.y = baseY + sineOffset + this.sineVerticalOffset;

      // Fade based on progress
      this.life = Math.max(0, 1 - t * 0.9);

      if (t >= 1) {
        this.life = 0;
      }
      return;
    }

    // Waving text (musical notes) - travel to defender with gentle motion
    if (this.isWavingText) {
      var elapsed = Date.now() - this.waveStartTime;
      var t = Math.min(1, elapsed / this.waveDuration);

      var easedT = 1 - Math.pow(1 - t, 2.5);

      this.x = this.waveStartX + (this.waveEndX - this.waveStartX) * easedT;

      var waveOffset = Math.sin(t * Math.PI * 3 + this.wavePhase) * this.waveAmplitude * (1 - t * 0.7);
      var baseY = this.waveStartY + (this.waveEndY - this.waveStartY) * easedT;
      this.y = baseY + waveOffset;

      this.life = Math.max(0, 1 - t * 0.85);

      if (t >= 1) {
        this.life = 0;
      }
      return;
    }

    // Traveling ring - center moves toward target while ring expands (legacy, keeping for compatibility)
    if (this.isTravelingRing) {
      var elapsed = Date.now() - this.ringStartTime;
      var t = Math.min(1, elapsed / this.ringDuration);

      // Ease-out for natural deceleration
      var easedT = 1 - Math.pow(1 - t, 2.5);

      // Lerp center position from start to end
      var centerX = this.ringStartX + (this.ringEndX - this.ringStartX) * easedT;
      var centerY = this.ringStartY + (this.ringEndY - this.ringStartY) * easedT;

      // Ring expands during travel, shrinks at impact
      var radiusCurve = t < 0.75 ? (t / 0.75) : 1 - (t - 0.75) * 2;
      radiusCurve = Math.max(0, radiusCurve);
      var currentRadius = this.ringMaxRadius * radiusCurve;

      // Position = center + radial offset
      this.x = centerX + Math.cos(this.ringAngle) * currentRadius;
      this.y = centerY + Math.sin(this.ringAngle) * currentRadius;

      // Rotate ring slightly
      this.ringAngle += 0.015;

      // Fade based on progress
      this.life = Math.max(0, 1 - t * 1.1);

      if (t >= 1) {
        this.life = 0;
      }
      return;
    }

    // Converging particles (Store Energy style)
    if (this.isConverging) {
      var dx = this.convergeTargetX - this.x;
      var dy = this.convergeTargetY - this.y;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 5) {
        this.x += dx * this.convergeSpeed;
        this.y += dy * this.convergeSpeed;
        this.convergeSpeed *= 1.02;  // Accelerate as it gets closer
      } else {
        this.life = 0;  // Disappear when reached center
      }

      this.life -= 0.015;
      this.rotation += 0.1;
      return;
    }

    // Gathering phase - converge toward target point
    if (this.isGathering) {
      var gatherElapsed = Date.now() - this.gatherStartTime;

      if (gatherElapsed < this.gatherDuration) {
        var dx = this.gatherTargetX - this.x;
        var dy = this.gatherTargetY - this.y;

        // Ease toward target
        this.x += dx * this.gatherEase;
        this.y += dy * this.gatherEase;

        // Shrink as it converges
        var progress = gatherElapsed / this.gatherDuration;
        this.size *= (1 - progress * 0.02);

        this.life -= 0.008;
      } else {
        this.isGathering = false;
        this.life = Math.min(this.life, 0.15);
        this.maxLife = this.life;
      }

      this.rotation += this.rotationSpeed;
      return;
    }

    // Drain delay (reverse flow)
    if (this.isDrain) {
      var drainElapsed = Date.now() - this.drainStartTime;
      if (drainElapsed < this.drainDelay) {
        // Just fade in place during delay
        this.life -= 0.003;
        return;
      }
      // After delay, start moving toward target
      this.isDrain = false;
    }

    // Beam stretch - slower for better visibility
    if (this.isBeam) {
      this.beamLength = Math.min(this.beamLength + 15, this.beamTargetLength);
      this.life -= 0.012;  // Slower fade
      return;
    }

    // Standard projectile travel
    if (!this.arrived && this.targetX !== undefined) {
      var dx = this.targetX - this.x;
      var dy = this.targetY - this.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this.travelSpeed * 1.5) {
        this.arrived = true;
        var burstAngle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(burstAngle) * (this.speed * 0.7);
        this.vy = Math.sin(burstAngle) * (this.speed * 0.7);
        this.life = Math.min(this.life, 0.5);  // Longer post-arrival life for impact visibility
        this.maxLife = this.life;
      } else {
        this.vx = (dx / dist) * this.travelSpeed;
        this.vy = (dy / dist) * this.travelSpeed;
        // Bee zigzag - add chaotic side-to-side movement
        if (this.isBee) {
          this.vx += Math.sin(Date.now() * 0.02 + this.startX) * 3;
          this.vy += Math.cos(Date.now() * 0.025 + this.startY) * 2;
        } else {
          this.vx += (Math.random() - 0.5) * 0.5;
          this.vy += (Math.random() - 0.5) * 0.5;
        }
      }
      this.x += this.vx;
      this.y += this.vy;
      this.life -= 0.008;
    } else {
      // Normal particle physics
      this.x += this.vx;
      this.y += this.vy;
      this.vy += this.gravity;
      this.vx *= this.friction;
      this.vy *= this.friction;
      this.life -= 0.016;
    }

    // Growing flame effect - particles grow as they travel
    if (this.isGrowingFlame && this.size < this.flameMaxSize) {
      this.size *= this.flameGrowthRate;
    }

    this.rotation += this.rotationSpeed;
  };

  Particle.prototype.draw = function(ctx) {
    var alpha = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;

    if (this.isBeam) {
      // Draw beam as stretched line
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.size;
      ctx.lineCap = 'round';
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(this.beamLength, 0);
      ctx.stroke();
      // Bright core
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = this.size * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(this.beamLength, 0);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.fillStyle = this.color;
    ctx.strokeStyle = this.color;

    switch (this.shape) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'star':
        drawStar(ctx, 5, this.size, this.size / 2);
        break;
      case 'square':
        ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
        break;
      case 'line':
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        var lx = this.vx * 4;
        var ly = this.vy * 4;
        ctx.lineTo(lx, ly);
        ctx.stroke();
        break;
      case 'leaf':
        ctx.beginPath();
        ctx.ellipse(0, 0, this.size, this.size / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'snowflake':
        ctx.lineWidth = 1.5;
        for (var i = 0; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, -this.size);
          ctx.stroke();
          ctx.rotate(Math.PI / 3);
        }
        break;
      case 'bolt':
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -this.size);
        ctx.lineTo(this.size * 0.3, -this.size * 0.2);
        ctx.lineTo(-this.size * 0.2, this.size * 0.1);
        ctx.lineTo(0, this.size);
        ctx.stroke();
        break;
      case 'ring':
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'bubble':
        // Translucent bubble with highlight
        ctx.globalAlpha = alpha * 0.6;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();
        // Bubble outline
        ctx.globalAlpha = alpha * 0.8;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Highlight
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-this.size * 0.3, -this.size * 0.3, this.size * 0.25, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'text':
        // Draw text particles (musical notes, etc.)
        ctx.font = 'bold ' + Math.round(this.size) + 'px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 8;
        ctx.fillText(this.text || '?', 0, 0);
        break;
    }
    ctx.restore();
  };

  function drawStar(ctx, spikes, outer, inner) {
    ctx.beginPath();
    for (var i = 0; i < spikes * 2; i++) {
      var r = i % 2 === 0 ? outer : inner;
      var a = (i * Math.PI) / spikes - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  function getElementCenter(elementId) {
    var el = document.getElementById(elementId);
    var arenaEl = document.getElementById('arena');
    if (!el || !arenaEl) return null;
    var arenaRect = arenaEl.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    return {
      x: elRect.left - arenaRect.left + elRect.width / 2,
      y: elRect.top - arenaRect.top + elRect.height / 2
    };
  }

  function powerScale(power) {
    var p = Math.max(20, Math.min(150, power || 60));
    return {
      particleCount: Math.round(25 + (p / 120) * 100),  // More particles for visibility
      particleSize: 0.8 + (p / 120) * 1.0,              // Larger particles
      shakeAmplitude: p >= 80 ? 2 + (p - 80) / 10 : 0,
      shakeDuration: p >= 80 ? 100 + (p - 80) * 3 : 0,
      travelSpeed: 6 + (p / 120) * 4,                   // Slower travel (6-10 px/frame) so particles are visible during flight
      flashOpacity: p >= 100 ? 0.15 + (p - 100) / 200 : 0
    };
  }

  function randomColor(colors) {
    return colors[Math.floor(Math.random() * colors.length)];
  }

  function randomShape(shapes) {
    return shapes[Math.floor(Math.random() * shapes.length)];
  }

  // ============================================
  // PATTERN: BEAM (instant line)
  // ============================================
  function spawnBeam(type, startX, startY, endX, endY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var dx = endX - startX;
    var dy = endY - startY;
    var angle = Math.atan2(dy, dx);
    var distance = Math.sqrt(dx * dx + dy * dy);

    // Main beam
    particles.push(new Particle(startX, startY, {
      color: randomColor(colors),
      size: (5 + Math.random() * 4) * scale.particleSize,
      isBeam: true,
      beamTargetLength: distance,
      angle: angle,
      life: 1.2  // Longer life for more visible beam
    }));

    // Trailing particles along beam path
    var count = Math.round(scale.particleCount * 0.5);
    for (var i = 0; i < count; i++) {
      var t = Math.random();
      var px = startX + dx * t + (Math.random() - 0.5) * 15;
      var py = startY + dy * t + (Math.random() - 0.5) * 15;
      particles.push(new Particle(px, py, {
        color: randomColor(colors),
        size: (3 + Math.random() * 4) * scale.particleSize,
        shape: randomShape(fx.shapes),
        speed: 1 + Math.random(),
        gravity: fx.gravity,
        life: 0.6 + Math.random() * 0.4  // Longer life
      }));
    }
  }

  // ============================================
  // PATTERN: PROJECTILE (straight travel)
  // ============================================
  function spawnProjectile(type, startX, startY, endX, endY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var count = Math.round(scale.particleCount * 0.8);

    for (var i = 0; i < count; i++) {
      var offsetX = (Math.random() - 0.5) * 25;
      var offsetY = (Math.random() - 0.5) * 25;
      particles.push(new Particle(
        startX + offsetX,
        startY + offsetY,
        {
          color: randomColor(colors),
          size: (4 + Math.random() * 5) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 2 + Math.random() * 2,
          life: 1.5 + Math.random() * 0.5,  // Longer life for visibility
          targetX: endX + (Math.random() - 0.5) * 25,
          targetY: endY + (Math.random() - 0.5) * 25,
          travelSpeed: scale.travelSpeed * (0.85 + Math.random() * 0.3),
          gravity: fx.gravity
        }
      ));
    }
  }

  // ============================================
  // PATTERN: ARC (parabolic throw)
  // ============================================
  function spawnArc(type, startX, startY, endX, endY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var count = Math.round(scale.particleCount * 0.5);
    var peakHeight = 60 + scale.particleSize * 30;

    // Short arc for moves like Tsunami Strike - faster to match sound
    var isShortArc = opts.shortArc || false;
    var baseDuration = isShortArc ? 350 : 500;
    var durationVariance = isShortArc ? 100 : 200;
    var baseLife = isShortArc ? 0.8 : 1.5;

    for (var i = 0; i < count; i++) {
      var offsetX = (Math.random() - 0.5) * 15;
      var offsetY = (Math.random() - 0.5) * 15;
      var delayOffset = i * (isShortArc ? 5 : 10); // Faster stagger for short arc

      particles.push(new Particle(
        startX + offsetX,
        startY + offsetY,
        {
          color: randomColor(colors),
          size: (4 + Math.random() * 5) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 2,
          life: baseLife,
          isArc: true,
          targetX: endX + (Math.random() - 0.5) * 25,
          targetY: endY + (Math.random() - 0.5) * 25,
          arcDuration: baseDuration + Math.random() * durationVariance + delayOffset,
          arcPeakHeight: peakHeight + (Math.random() - 0.5) * 20,
          gravity: fx.gravity
        }
      ));
    }
  }

  // ============================================
  // PATTERN: SLASH (quick melee)
  // ============================================
  function spawnSlash(type, targetX, targetY, scale, isPlayer, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var count = Math.round(scale.particleCount * 0.6);
    var slashStyle = opts.slashStyle || 'default';

    // FIRE slash style - fire emojis
    if (slashStyle === 'fire') {
      var fireEmojis = ['🔥', '🔥', '💥'];
      var fireCount = 6;

      for (var f = 0; f < fireCount; f++) {
        var delay = f * 40;  // Staggered for slower effect
        (function(d, idx) {
          setTimeout(function() {
            var offsetX = (Math.random() - 0.5) * 50;
            var offsetY = (Math.random() - 0.5) * 40;
            particles.push(new Particle(
              targetX + offsetX,
              targetY + offsetY,
              {
                color: randomColor(['#ff4500', '#ff6b35', '#ffa500']),
                size: (18 + Math.random() * 8) * scale.particleSize,
                shape: 'text',
                text: fireEmojis[idx % fireEmojis.length],
                speed: 1.5 + Math.random(),
                angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.6,
                gravity: -0.04,  // Rise up
                friction: 0.97,
                life: 0.5 + Math.random() * 0.3
              }
            ));
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay, f);
      }
      return;
    }

    // Default slash - line particles
    var slashAngle = isPlayer ? -Math.PI / 4 : Math.PI / 4;
    var slashLength = 60 * scale.particleSize;

    for (var i = 0; i < 8; i++) {
      var t = i / 7 - 0.5;
      var px = targetX + Math.cos(slashAngle) * slashLength * t;
      var py = targetY + Math.sin(slashAngle) * slashLength * t;
      particles.push(new Particle(px, py, {
        color: '#fff',
        size: (6 + Math.random() * 4) * scale.particleSize,
        shape: 'line',
        speed: 0.5,
        angle: slashAngle,
        life: 0.2,
        friction: 0.95
      }));
    }

    // Impact burst
    for (var j = 0; j < count; j++) {
      particles.push(new Particle(
        targetX + (Math.random() - 0.5) * 30,
        targetY + (Math.random() - 0.5) * 30,
        {
          color: randomColor(colors),
          size: (3 + Math.random() * 3) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 3 + Math.random() * 4,
          gravity: fx.gravity,
          life: 0.3 + Math.random() * 0.2
        }
      ));
    }
  }

  // ============================================
  // PATTERN: CHARGE (trail behind attacker)
  // ============================================
  function spawnChargeTrail(type, startX, startY, endX, endY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var count = Math.round(scale.particleCount * 1.2);

    // Trail from start toward end - sweeping effect synced with attacker movement
    var dx = endX - startX;
    var dy = endY - startY;
    var sweepDuration = 120; // ms - attacker reaches defender at 30% of 400ms
    var particleLife = 0.18;  // Short life so trail sweeps cleanly

    for (var i = 0; i < count; i++) {
      var t = (i / count) * 0.95; // Evenly distributed along path
      var spawnDelay = t * sweepDuration; // Stagger spawns to follow attacker
      var px = startX + dx * t + (Math.random() - 0.5) * 30;
      var py = startY + dy * t + (Math.random() - 0.5) * 20;

      // Spawn particles with delay based on position along path
      (function(x, y, delay) {
        setTimeout(function() {
          particles.push(new Particle(x, y, {
            color: randomColor(colors),
            size: (6 + Math.random() * 5) * scale.particleSize,
            shape: randomShape(fx.shapes),
            speed: 2.5 + Math.random() * 3,
            angle: Math.atan2(dy, dx) + Math.PI + (Math.random() - 0.5) * 0.7,
            gravity: fx.gravity,
            friction: 0.90,
            life: particleLife + Math.random() * 0.1
          }));
          // Ensure animation loop is running
          if (!animationId && particles.length > 0) animateParticles();
        }, delay);
      })(px, py, spawnDelay);
    }

    // Impact burst when attacker reaches defender (at 120ms)
    setTimeout(function() {
      var burstCount = Math.round(count * 0.8);
      for (var j = 0; j < burstCount; j++) {
        particles.push(new Particle(
          endX + (Math.random() - 0.5) * 45,
          endY + (Math.random() - 0.5) * 45,
          {
            color: randomColor(colors),
            size: (6 + Math.random() * 6) * scale.particleSize,
            shape: randomShape(fx.shapes),
            speed: 5 + Math.random() * 5,
            gravity: fx.gravity,
            life: 0.35 + Math.random() * 0.15
          }
        ));
      }
      if (!animationId && particles.length > 0) animateParticles();
    }, sweepDuration);
  }

  // ============================================
  // PATTERN: WAVE (expanding ring)
  // ============================================
  function spawnWave(type, startX, startY, endX, endY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;

    // Special handling for text particles (musical notes traveling to defender)
    if (opts.textParticles && opts.textParticles.length > 0) {
      var noteCount = 6;  // Fewer notes that finish with the sound
      for (var n = 0; n < noteCount; n++) {
        var noteChar = opts.textParticles[n % opts.textParticles.length];
        var delay = n * 60;  // Faster succession

        setTimeout((function(char, idx) {
          return function() {
            var p = new Particle(startX + (Math.random() - 0.5) * 30, startY + (Math.random() - 0.5) * 20, {
              color: randomColor(colors),
              size: (18 + Math.random() * 10) * scale.particleSize,
              shape: 'text',
              text: char,
              speed: 0,
              life: 0.8  // Shorter life
            });
            // Travel to defender with gentle wave motion
            p.isWavingText = true;
            p.waveStartX = startX;
            p.waveStartY = startY;
            p.waveEndX = endX;
            p.waveEndY = endY;
            p.waveDuration = 350;  // Faster travel to match sound duration
            p.waveStartTime = Date.now();
            p.waveAmplitude = 15 + Math.random() * 10;
            p.wavePhase = idx * 0.8;
            particles.push(p);
            if (!animationId && particles.length > 0) animateParticles();
          };
        })(noteChar, n), delay);
      }
      return;
    }

    // Check for emoji wave style
    var waveEmoji = opts.waveEmoji || null;

    // SINE WAVE PATTERN - particles oscillate up/down while traveling to defender
    var waveCount = waveEmoji ? 6 : 5;  // More particles for emoji waves
    var waveDelay = 70;
    var travelDuration = 400;
    var waveAmplitude = 40;  // How much particles oscillate up/down
    var waveFrequency = 2.5; // Number of wave cycles

    for (var w = 0; w < waveCount; w++) {
      (function(waveIndex) {
        setTimeout(function() {
          var particlesInWave = waveEmoji ? 1 : 8;  // Single emoji or multiple particles per wave
          for (var i = 0; i < particlesInWave; i++) {
            var p = new Particle(startX, startY, {
              color: randomColor(colors),
              size: waveEmoji ? (20 + Math.random() * 8) * scale.particleSize : (5 + Math.random() * 3) * scale.particleSize,
              shape: waveEmoji ? 'text' : 'circle',
              text: waveEmoji,
              speed: 0,
              life: 1.2
            });

            // Mark as sine wave particle
            p.isSineWave = true;
            p.sineStartX = startX;
            p.sineStartY = startY;
            p.sineEndX = endX;
            p.sineEndY = endY;
            p.sineDuration = travelDuration;
            p.sineStartTime = Date.now();
            p.sineAmplitude = waveAmplitude * (0.8 + Math.random() * 0.4);
            p.sineFrequency = waveFrequency;
            p.sinePhase = waveIndex * 0.7 + i * 0.3;  // Stagger phases for wave effect
            p.sineVerticalOffset = (i - particlesInWave / 2) * 8;  // Spread vertically

            particles.push(p);
          }
          if (!animationId && particles.length > 0) animateParticles();
        }, waveIndex * waveDelay);
      })(w);
    }

    // Impact burst at target when waves arrive
    var impactTime = travelDuration + (waveCount - 1) * waveDelay;
    setTimeout(function() {
      var burstCount = Math.round(scale.particleCount * 0.4);
      for (var j = 0; j < burstCount; j++) {
        particles.push(new Particle(
          endX + (Math.random() - 0.5) * 35,
          endY + (Math.random() - 0.5) * 35,
          {
            color: randomColor(colors),
            size: waveEmoji ? (14 + Math.random() * 6) * scale.particleSize : (4 + Math.random() * 5) * scale.particleSize,
            shape: waveEmoji ? 'text' : randomShape(fx.shapes),
            text: waveEmoji,
            speed: 4 + Math.random() * 4,
            gravity: fx.gravity,
            life: 0.35 + Math.random() * 0.2
          }
        ));
      }
      if (!animationId && particles.length > 0) animateParticles();
    }, impactTime);
  }

  // ============================================
  // PATTERN: SWARM (staggered multi-hit)
  // ============================================
  function spawnSwarm(type, startX, startY, endX, endY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var swarmStyle = opts.swarmStyle || 'default';

    // FLAMES style - wild fire bursting toward defender (Flamethrower)
    if (swarmStyle === 'flames') {
      var flameCount = Math.round(scale.particleCount * 0.5);  // Fewer particles for shorter duration
      var fireEmojis = ['🔥', '🔥', '🔥', '💥'];
      var fireColors = ['#ff4500', '#ff6b35', '#ffa500', '#ffcc00', '#fff'];

      for (var f = 0; f < flameCount; f++) {
        var delay = f * 12;  // Very fast succession - all spawn within ~300ms
        (function(d, idx) {
          setTimeout(function() {
            // Mix of emojis and particles
            var useEmoji = idx % 3 === 0;
            var p = new Particle(
              startX + (Math.random() - 0.5) * 30,
              startY + (Math.random() - 0.5) * 20,
              {
                color: randomColor(fireColors),
                size: useEmoji ? (8 + Math.random() * 4) * scale.particleSize : (3 + Math.random() * 2) * scale.particleSize,  // Start SMALL
                shape: useEmoji ? 'text' : 'circle',
                text: useEmoji ? fireEmojis[Math.floor(Math.random() * fireEmojis.length)] : null,
                speed: 2 + Math.random() * 2,
                life: 0.45,  // Shorter life to match sound
                targetX: endX + (Math.random() - 0.5) * 40,
                targetY: endY + (Math.random() - 0.5) * 30,
                travelSpeed: scale.travelSpeed * (1.0 + Math.random() * 0.4),  // Faster travel
                gravity: -0.02
              }
            );
            // Mark as growing flame
            p.isGrowingFlame = true;
            p.flameGrowthRate = 1.04 + Math.random() * 0.02;  // Grow 4-6% per frame (faster growth)
            p.flameMaxSize = useEmoji ? (22 + Math.random() * 8) * scale.particleSize : (10 + Math.random() * 5) * scale.particleSize;
            particles.push(p);
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay, f);
      }
      return;
    }

    // BUBBLES style - big floating bubbles that pop (faster to match sound)
    if (swarmStyle === 'bubbles') {
      var bubbleCount = Math.round(scale.particleCount * 0.7);  // Fewer bubbles
      for (var b = 0; b < bubbleCount; b++) {
        var delay = b * 35;  // Faster spawn
        (function(d, idx) {
          setTimeout(function() {
            particles.push(new Particle(
              startX + (Math.random() - 0.5) * 25,
              startY + (Math.random() - 0.5) * 25,
              {
                color: randomColor(['#66d9ff', '#99e6ff', '#b3ecff', '#fff']),
                size: (8 + Math.random() * 6) * scale.particleSize,
                shape: 'bubble',
                speed: 1,
                life: 0.7,  // Shorter life
                targetX: endX + (Math.random() - 0.5) * 30,
                targetY: endY + (Math.random() - 0.5) * 30,
                travelSpeed: scale.travelSpeed * 0.8,  // Faster travel
                gravity: -0.02
              }
            ));
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay, b);
      }
      return;
    }

    // BEES style - chaotic zigzag movement
    if (swarmStyle === 'bees') {
      var beeCount = scale.particleCount;
      for (var bee = 0; bee < beeCount; bee++) {
        var delay = bee * 40;
        (function(d) {
          setTimeout(function() {
            particles.push(new Particle(
              startX + (Math.random() - 0.5) * 35,
              startY + (Math.random() - 0.5) * 35,
              {
                color: randomColor(['#fbbf24', '#fcd34d', '#1f2937', '#fff']),  // Yellow/black
                size: (3 + Math.random() * 2) * scale.particleSize,
                shape: 'circle',
                speed: 2 + Math.random() * 2,
                life: 1.0,
                targetX: endX + (Math.random() - 0.5) * 50,
                targetY: endY + (Math.random() - 0.5) * 50,
                travelSpeed: scale.travelSpeed * 0.9,
                gravity: 0,
                isBee: true  // Marked for zigzag update
              }
            ));
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay);
      }
      return;
    }

    // AVALANCHE style - falling ice/snow chunks
    if (swarmStyle === 'avalanche') {
      var chunkCount = scale.particleCount;
      for (var c = 0; c < chunkCount; c++) {
        var delay = c * 50;
        (function(d) {
          setTimeout(function() {
            // Start higher and to the side
            var offsetX = (Math.random() - 0.3) * 60;
            var offsetY = -40 - Math.random() * 30;
            particles.push(new Particle(
              startX + offsetX,
              startY + offsetY,
              {
                color: randomColor(['#a5f3fc', '#67e8f9', '#e0f2fe', '#fff']),
                size: (5 + Math.random() * 5) * scale.particleSize,
                shape: 'square',  // Ice chunks
                speed: 2,
                life: 1.2,
                targetX: endX + (Math.random() - 0.5) * 40,
                targetY: endY + (Math.random() - 0.5) * 30,
                travelSpeed: scale.travelSpeed * 0.7,
                gravity: 0.15  // Fall down
              }
            ));
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay);
      }
      return;
    }

    // DEFAULT swarm style
    var waves = 5;
    var perWave = Math.round(scale.particleCount / waves);

    for (var w = 0; w < waves; w++) {
      for (var i = 0; i < perWave; i++) {
        var delayFactor = w * 0.15;
        particles.push(new Particle(
          startX + (Math.random() - 0.5) * 30,
          startY + (Math.random() - 0.5) * 30,
          {
            color: randomColor(colors),
            size: (2 + Math.random() * 2) * scale.particleSize,
            shape: randomShape(fx.shapes),
            speed: 2 + Math.random(),
            life: 0.8 + Math.random() * 0.3 + delayFactor,
            targetX: endX + (Math.random() - 0.5) * 40,
            targetY: endY + (Math.random() - 0.5) * 40,
            travelSpeed: (scale.travelSpeed * 0.8) * (0.8 + w * 0.1),
            gravity: 0
          }
        ));
      }
    }
  }

  // ============================================
  // PATTERN: DRAIN (reverse flow)
  // ============================================
  function spawnDrain(type, attackerX, attackerY, defenderX, defenderY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var gatherCount = Math.round(scale.particleCount * 0.5);
    var drainCount = Math.round(scale.particleCount * 0.6);

    // === TIMING ===
    var GATHER_DURATION = 350;
    var DRAIN_DELAY = 300;

    // === PHASE 1: GATHER - particles converge TO defender ===
    var gatherRadius = 55 + scale.particleSize * 15;

    for (var i = 0; i < gatherCount; i++) {
      var angle = (i / gatherCount) * Math.PI * 2 + Math.random() * 0.3;
      var radiusVariance = gatherRadius * (0.8 + Math.random() * 0.4);
      var spawnX = defenderX + Math.cos(angle) * radiusVariance;
      var spawnY = defenderY + Math.sin(angle) * radiusVariance;

      particles.push(new Particle(spawnX, spawnY, {
        color: randomColor(colors),
        size: (3 + Math.random() * 3) * scale.particleSize,
        shape: randomShape(fx.shapes),
        speed: 0,
        life: 0.6 + Math.random() * 0.2,
        isGathering: true,
        gatherTargetX: defenderX + (Math.random() - 0.5) * 10,
        gatherTargetY: defenderY + (Math.random() - 0.5) * 10,
        gatherEase: 0.04 + Math.random() * 0.03,
        gatherStartTime: Date.now(),
        gatherDuration: GATHER_DURATION + Math.random() * 100
      }));
    }

    // === PHASE 2: DRAIN - particles flow TO attacker ===
    setTimeout(function() {
      for (var j = 0; j < drainCount; j++) {
        var delay = j * (150 / drainCount);

        (function(d) {
          setTimeout(function() {
            particles.push(new Particle(
              defenderX + (Math.random() - 0.5) * 25,
              defenderY + (Math.random() - 0.5) * 25,
              {
                color: '#4ade80',
                size: (3 + Math.random() * 4) * scale.particleSize,
                shape: 'circle',
                speed: 2,
                life: 1.0,
                targetX: attackerX + (Math.random() - 0.5) * 25,
                targetY: attackerY + (Math.random() - 0.5) * 25,
                travelSpeed: scale.travelSpeed * 0.6,
                gravity: 0
              }
            ));
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay);
      }
    }, DRAIN_DELAY);

    // Small impact flash at start
    for (var k = 0; k < gatherCount * 0.3; k++) {
      particles.push(new Particle(
        defenderX + (Math.random() - 0.5) * 20,
        defenderY + (Math.random() - 0.5) * 20,
        {
          color: randomColor(colors),
          size: (2 + Math.random() * 2) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 1.5 + Math.random() * 2,
          gravity: fx.gravity,
          life: 0.2 + Math.random() * 0.1
        }
      ));
    }
  }

  // ============================================
  // PATTERN: STATUS (drift to target)
  // ============================================
  function spawnStatusDrift(type, startX, startY, endX, endY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var count = Math.round(15 * scale.particleSize);

    for (var i = 0; i < count; i++) {
      particles.push(new Particle(
        startX + (Math.random() - 0.5) * 30,
        startY + (Math.random() - 0.5) * 30,
        {
          color: randomColor(colors),
          size: (3 + Math.random() * 3) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 1,
          life: 1.0 + Math.random() * 0.3,
          targetX: endX + (Math.random() - 0.5) * 30,
          targetY: endY + (Math.random() - 0.5) * 30,
          travelSpeed: 5 + Math.random() * 2,
          gravity: 0,
          friction: 0.99
        }
      ));
    }
  }

  // ============================================
  // PATTERN: SELF AURA (buff on self)
  // ============================================
  function spawnSelfAura(type, targetX, targetY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var count = Math.round(20 * scale.particleSize);
    var auraStyle = opts.auraStyle || 'default';

    // CHARGE style - particles converge inward (Store Energy)
    if (auraStyle === 'charge') {
      var chargeColors = ['#ffff00', '#ffcc00', '#fff', '#ffe066'];
      var chargeCount = 16;

      // Electric bolts converging inward
      for (var c = 0; c < chargeCount; c++) {
        var delay = c * 30;
        (function(d, idx) {
          setTimeout(function() {
            var angle = (idx / chargeCount) * Math.PI * 2;
            var startRadius = 70 + Math.random() * 20;
            var startX = targetX + Math.cos(angle) * startRadius;
            var startY = targetY + Math.sin(angle) * startRadius;

            var p = new Particle(startX, startY, {
              color: randomColor(chargeColors),
              size: (4 + Math.random() * 3) * scale.particleSize,
              shape: 'bolt',
              speed: 0,
              life: 0.8
            });

            // Converge toward center
            p.isConverging = true;
            p.convergeTargetX = targetX + (Math.random() - 0.5) * 15;
            p.convergeTargetY = targetY + (Math.random() - 0.5) * 15;
            p.convergeSpeed = 0.08 + Math.random() * 0.04;

            particles.push(p);
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay, c);
      }

      // Central energy buildup after particles converge
      setTimeout(function() {
        for (var b = 0; b < 12; b++) {
          particles.push(new Particle(
            targetX + (Math.random() - 0.5) * 20,
            targetY + (Math.random() - 0.5) * 20,
            {
              color: randomColor(chargeColors),
              size: (5 + Math.random() * 4) * scale.particleSize,
              shape: 'star',
              speed: 2 + Math.random() * 2,
              gravity: -0.02,
              friction: 0.96,
              life: 0.4 + Math.random() * 0.2
            }
          ));
        }
        if (!animationId && particles.length > 0) animateParticles();
      }, 350);

      return;
    }

    // HEAL style - green healing particles rising (Regenerate)
    if (auraStyle === 'heal') {
      var healColors = ['#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#fff'];
      var healEmojis = ['💚', '✨', '💫'];
      var healCount = 14;

      for (var h = 0; h < healCount; h++) {
        var delay = h * 40;
        (function(d, idx) {
          setTimeout(function() {
            var useEmoji = idx % 4 === 0;
            var startX = targetX + (Math.random() - 0.5) * 50;
            var startY = targetY + Math.random() * 20;

            particles.push(new Particle(startX, startY, {
              color: randomColor(healColors),
              size: useEmoji ? (16 + Math.random() * 6) * scale.particleSize : (3 + Math.random() * 3) * scale.particleSize,
              shape: useEmoji ? 'text' : 'circle',
              text: useEmoji ? healEmojis[Math.floor(Math.random() * healEmojis.length)] : null,
              speed: 1 + Math.random(),
              angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.3,
              gravity: -0.04,  // Float upward
              friction: 0.98,
              life: 0.7 + Math.random() * 0.3
            }));
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay, h);
      }
      return;
    }

    // FLAME style - fire surrounding attacker (Ember Ward)
    if (auraStyle === 'flame') {
      var flameColors = ['#ff4500', '#ff6b35', '#ffa500', '#ffcc00'];
      var flameEmojis = ['🔥', '🔥', '🔥', '💥'];
      var flameCount = 16;

      // Flames rising around the attacker
      for (var f = 0; f < flameCount; f++) {
        var delay = f * 25;
        (function(d, idx) {
          setTimeout(function() {
            var useEmoji = idx % 3 === 0;
            var angle = (idx / flameCount) * Math.PI * 2;
            var radius = 25 + Math.random() * 15;
            var startX = targetX + Math.cos(angle) * radius;
            var startY = targetY + Math.sin(angle) * radius * 0.6;

            particles.push(new Particle(startX, startY, {
              color: randomColor(flameColors),
              size: useEmoji ? (14 + Math.random() * 6) * scale.particleSize : (4 + Math.random() * 3) * scale.particleSize,
              shape: useEmoji ? 'text' : 'star',
              text: useEmoji ? flameEmojis[Math.floor(Math.random() * flameEmojis.length)] : null,
              speed: 1.5 + Math.random(),
              angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.4,
              gravity: -0.05,  // Flames rise
              friction: 0.97,
              life: 0.5 + Math.random() * 0.3
            }));
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay, f);
      }
      return;
    }

    // STONE style - rocks forming protective barrier (Fortify)
    if (auraStyle === 'stone') {
      var stoneColors = ['#a8a29e', '#78716c', '#57534e', '#d6d3d1'];
      var stoneEmojis = ['🪨', '💎', '⬛'];
      var stoneCount = 12;

      // Stones rising from ground and orbiting
      for (var s = 0; s < stoneCount; s++) {
        var delay = s * 35;
        (function(d, idx) {
          setTimeout(function() {
            var useEmoji = idx % 3 === 0;
            var angle = (idx / stoneCount) * Math.PI * 2;
            var startX = targetX + Math.cos(angle) * 40;
            var startY = targetY + 30;  // Start from below

            var p = new Particle(startX, startY, {
              color: randomColor(stoneColors),
              size: useEmoji ? (14 + Math.random() * 6) * scale.particleSize : (5 + Math.random() * 4) * scale.particleSize,
              shape: useEmoji ? 'text' : 'square',
              text: useEmoji ? stoneEmojis[Math.floor(Math.random() * stoneEmojis.length)] : null,
              speed: 2,
              angle: -Math.PI / 2,
              gravity: 0.02,  // Slow down as they rise
              friction: 0.95,
              life: 0.6 + Math.random() * 0.2
            });
            particles.push(p);
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay, s);
      }
      return;
    }

    // METAL style - metallic sheen/plates (Steel Skin)
    if (auraStyle === 'metal') {
      var metalColors = ['#9ca3af', '#d1d5db', '#e5e7eb', '#6b7280', '#fff'];
      var metalEmojis = ['🛡️', '⚙️', '🔩'];
      var metalCount = 14;

      // Metallic particles forming a shield layer
      for (var m = 0; m < metalCount; m++) {
        var delay = m * 30;
        (function(d, idx) {
          setTimeout(function() {
            var useEmoji = idx % 4 === 0;
            var angle = (idx / metalCount) * Math.PI * 2;
            var radius = 30 + Math.random() * 10;
            var startX = targetX + Math.cos(angle) * (radius + 20);
            var startY = targetY + Math.sin(angle) * (radius * 0.7);

            var p = new Particle(startX, startY, {
              color: randomColor(metalColors),
              size: useEmoji ? (16 + Math.random() * 6) * scale.particleSize : (4 + Math.random() * 3) * scale.particleSize,
              shape: useEmoji ? 'text' : 'square',
              text: useEmoji ? metalEmojis[Math.floor(Math.random() * metalEmojis.length)] : null,
              speed: 0,
              life: 0.7
            });
            // Converge slightly toward center
            p.isConverging = true;
            p.convergeTargetX = targetX + Math.cos(angle) * radius * 0.5;
            p.convergeTargetY = targetY + Math.sin(angle) * radius * 0.3;
            p.convergeSpeed = 0.04;
            particles.push(p);
            if (!animationId && particles.length > 0) animateParticles();
          }, d);
        })(delay, m);
      }
      return;
    }

    // DEFAULT style - expanding rings and rising sparkles
    // Expanding rings
    for (var r = 0; r < 2; r++) {
      for (var i = 0; i < 12; i++) {
        var angle = (i / 12) * Math.PI * 2;
        particles.push(new Particle(
          targetX + Math.cos(angle) * (15 + r * 10),
          targetY + Math.sin(angle) * (15 + r * 10),
          {
            color: randomColor(colors),
            size: (3 + Math.random() * 2) * scale.particleSize,
            shape: 'ring',
            speed: 1.5 + r,
            angle: angle,
            gravity: 0,
            friction: 0.97,
            life: 0.5 + Math.random() * 0.2
          }
        ));
      }
    }

    // Rising sparkles
    for (var j = 0; j < count; j++) {
      particles.push(new Particle(
        targetX + (Math.random() - 0.5) * 50,
        targetY + (Math.random() - 0.5) * 30,
        {
          color: randomColor(colors),
          size: (2 + Math.random() * 3) * scale.particleSize,
          shape: 'star',
          speed: 1 + Math.random(),
          angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.5,
          gravity: -0.03,
          friction: 0.98,
          life: 0.6 + Math.random() * 0.3
        }
      ));
    }
  }

  // ============================================
  // PATTERN: BURST (impact at target)
  // ============================================
  function spawnBurst(type, targetX, targetY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var count = Math.round(scale.particleCount);

    for (var i = 0; i < count; i++) {
      particles.push(new Particle(
        targetX + (Math.random() - 0.5) * 20,
        targetY + (Math.random() - 0.5) * 20,
        {
          color: randomColor(colors),
          size: (3 + Math.random() * 5) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 3 + Math.random() * 5,
          gravity: fx.gravity,
          friction: 0.97,
          life: 0.4 + Math.random() * 0.3
        }
      ));
    }
  }

  // ============================================
  // INTRO & POSITIONING
  // ============================================
  function playBattleIntro() {
    var arenaEl = document.getElementById('arena');
    if (!arenaEl) return;
    arenaEl.classList.add('battle-intro');
    setTimeout(function() { arenaEl.classList.remove('battle-intro'); }, 1500);

    // Spawn intro fog/smoke particles
    spawnIntroFog();
  }

  // Ground mist/dust for dramatic battle intro - subtle rising wisps
  function spawnIntroFog() {
    if (!canvas) return;
    // Subtle purple/indigo mist matching arena aesthetic
    var mistColors = ['rgba(139,92,246,0.15)', 'rgba(168,85,247,0.12)', 'rgba(99,102,241,0.10)', 'rgba(147,51,234,0.08)'];
    var mistCount = 15;

    for (var i = 0; i < mistCount; i++) {
      var delay = i * 60;
      (function(d, idx) {
        setTimeout(function() {
          // Spawn along bottom, rise gently and fade
          var startX = Math.random() * canvas.width;
          var startY = canvas.height - 20 + Math.random() * 40;

          particles.push(new Particle(startX, startY, {
            color: mistColors[Math.floor(Math.random() * mistColors.length)],
            size: 40 + Math.random() * 30,
            shape: 'circle',
            speed: 0,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -0.5 - Math.random() * 0.3,  // Rise upward
            friction: 0.99,
            gravity: 0,
            life: 0.8 + Math.random() * 0.4
          }));
          if (!animationId && particles.length > 0) animateParticles();
        }, d);
      })(delay, i);
    }
  }

  // Victory effect - winner glow + confetti
  function playVictoryEffect(isPlayer) {
    if (!canvas) return;
    var winnerEl = document.getElementById(isPlayer ? 'playerLobster' : 'opponentLobster');
    var loserEl = document.getElementById(isPlayer ? 'opponentLobster' : 'playerLobster');

    // Add glow class to winner
    if (winnerEl) {
      winnerEl.classList.add('winner-glow');
    }

    // Fade loser
    if (loserEl) {
      loserEl.classList.add('loser-fade');
    }

    // Get winner position for confetti
    var winnerPos = getElementCenter(isPlayer ? 'playerLobster' : 'opponentLobster');
    if (!winnerPos) return;

    // Confetti burst
    var confettiColors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9', '#fd79a8'];
    var confettiEmojis = ['🎉', '✨', '⭐', '🌟', '💫'];
    var confettiCount = 30;

    for (var i = 0; i < confettiCount; i++) {
      var delay = i * 25;
      (function(d, idx) {
        setTimeout(function() {
          var useEmoji = idx % 4 === 0;
          var angle = Math.random() * Math.PI * 2;
          var speed = 3 + Math.random() * 4;

          particles.push(new Particle(
            winnerPos.x + (Math.random() - 0.5) * 30,
            winnerPos.y + (Math.random() - 0.5) * 20,
            {
              color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
              size: useEmoji ? 16 + Math.random() * 8 : 4 + Math.random() * 4,
              shape: useEmoji ? 'text' : (Math.random() > 0.5 ? 'square' : 'circle'),
              text: useEmoji ? confettiEmojis[Math.floor(Math.random() * confettiEmojis.length)] : null,
              speed: speed,
              angle: angle,
              gravity: 0.08,
              friction: 0.98,
              rotationSpeed: (Math.random() - 0.5) * 0.3,
              life: 1.5 + Math.random() * 0.5
            }
          ));
          if (!animationId && particles.length > 0) animateParticles();
        }, d);
      })(delay, i);
    }

    // Second burst slightly delayed
    setTimeout(function() {
      for (var j = 0; j < 15; j++) {
        var angle = Math.random() * Math.PI * 2;
        particles.push(new Particle(
          winnerPos.x + (Math.random() - 0.5) * 40,
          winnerPos.y - 20,
          {
            color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
            size: 3 + Math.random() * 3,
            shape: 'star',
            speed: 2 + Math.random() * 3,
            angle: -Math.PI/2 + (Math.random() - 0.5) * 1,
            gravity: 0.05,
            friction: 0.97,
            life: 1.2
          }
        ));
      }
      if (!animationId && particles.length > 0) animateParticles();
    }, 400);
  }

  // Defeat effect - just fade the loser (no particles)
  function playDefeatEffect(isPlayer) {
    var loserEl = document.getElementById(isPlayer ? 'playerLobster' : 'opponentLobster');
    if (loserEl) {
      loserEl.classList.add('loser-fade');
    }
  }

  function positionBattleLog() {
    var historyPanel = document.getElementById('historyPanel');
    if (!historyPanel) return;
    var parent = historyPanel.parentElement;
    if (parent && parent.classList.contains('battle-layout')) return;
    var arenaEl = document.getElementById('arena');
    var movePanel = document.getElementById('movePanel');
    if (!arenaEl || !movePanel) return;
    var arenaRect = arenaEl.getBoundingClientRect();
    var moveRect = movePanel.getBoundingClientRect();
    historyPanel.style.top = Math.max(10, arenaRect.top) + 'px';
    historyPanel.style.bottom = Math.max(10, window.innerHeight - moveRect.bottom) + 'px';
    historyPanel.style.maxHeight = 'none';
    var historyContent = document.getElementById('historyContent');
    if (historyContent) historyContent.style.maxHeight = 'none';
  }

  // ============================================
  // MAIN API
  // ============================================
  // playAttackAnimation(moveType, isPlayer, options)
  //   moveType: 'fire', 'water', etc.
  //   isPlayer: true = player is attacking
  //   options: { pattern, category, power, moveName, moveDescription }
  function playAttackAnimation(moveType, isPlayer, options) {
    if (!canvas || !ctx) return;
    options = options || {};

    var category = (options.category || 'special').toLowerCase();
    var power = options.power || 60;
    var pattern = options.pattern || null;
    var desc = (options.moveDescription || '').toLowerCase();
    var moveName = options.moveName || '';
    var typeLower = (moveType || 'neutral').toLowerCase();
    var scale = powerScale(power);
    var moveOverride = MOVE_OVERRIDES[moveName] || null;

    // Apply critical hit boost
    if (options.crit) {
      scale.particleCount = Math.round(scale.particleCount * 1.5);
      scale.particleSize *= 1.3;
      scale.shakeAmplitude = Math.max(scale.shakeAmplitude, 4) * 1.5;
      scale.shakeDuration = Math.max(scale.shakeDuration, 150) * 1.5;
    }

    var attackerEl = isPlayer ? 'playerLobster' : 'opponentLobster';
    var defenderEl = isPlayer ? 'opponentLobster' : 'playerLobster';
    var attackerPos = getElementCenter(attackerEl);
    var defenderPos = getElementCenter(defenderEl);
    if (!defenderPos) return;
    if (!attackerPos) attackerPos = defenderPos;

    // Check MOVE_OVERRIDES first for pattern
    if (!pattern && moveOverride && moveOverride.pattern) {
      pattern = moveOverride.pattern;
    }

    // Auto-select pattern if not provided and no override
    if (!pattern) {
      if (power === 0) {
        var effect = options.moveEffect;
        if (effect && effect.target === 'self') {
          pattern = 'self_aura';
        } else {
          pattern = 'status_drift';
        }
      } else if (category === 'physical') {
        if (/charges?|slams?|tackles?|rush/i.test(desc)) {
          pattern = 'charge';
        } else if (/throws?|hurls?/i.test(desc)) {
          pattern = 'arc';
        } else {
          pattern = 'slash';
        }
      } else {
        // Special
        if (/beam|ray|laser|stream|breath/i.test(desc)) {
          pattern = 'beam';
        } else if (/throws?|hurls?|lobs?/i.test(desc)) {
          pattern = 'arc';
        } else if (/wave|pulse|aura|engulfs?/i.test(desc)) {
          pattern = 'wave';
        } else if (/swarm|barrage|multi/i.test(desc)) {
          pattern = 'swarm';
        } else if (/drains?|absorbs?|leeches?|steals?/i.test(desc)) {
          pattern = 'drain';
        } else {
          pattern = 'projectile';
        }
      }
    }

    // Apply override count if specified
    if (moveOverride && moveOverride.count) {
      scale.particleCount = moveOverride.count;
    }

    // Apply override colors if specified
    var customColors = null;
    if (moveOverride && moveOverride.colors) {
      customColors = moveOverride.colors;
    }

    // Handle special text particles (musical notes, etc.)
    var textParticles = null;
    if (moveOverride && moveOverride.particleType === 'text' && moveOverride.particles) {
      textParticles = moveOverride.particles;
    }

    // Build spawn options for custom effects
    var swarmStyle = moveOverride && moveOverride.swarmStyle ? moveOverride.swarmStyle : null;
    var slashStyle = moveOverride && moveOverride.slashStyle ? moveOverride.slashStyle : null;
    var waveEmoji = moveOverride && moveOverride.waveEmoji ? moveOverride.waveEmoji : null;
    var auraStyle = moveOverride && moveOverride.auraStyle ? moveOverride.auraStyle : null;
    var shortArc = moveOverride && moveOverride.shortArc ? moveOverride.shortArc : false;
    var spawnOpts = { customColors: customColors, textParticles: textParticles, swarmStyle: swarmStyle, slashStyle: slashStyle, waveEmoji: waveEmoji, auraStyle: auraStyle, shortArc: shortArc };

    // Spawn particles based on pattern
    switch (pattern) {
      case 'beam':
        spawnBeam(typeLower, attackerPos.x, attackerPos.y, defenderPos.x, defenderPos.y, scale, spawnOpts);
        break;
      case 'projectile':
        spawnProjectile(typeLower, attackerPos.x, attackerPos.y, defenderPos.x, defenderPos.y, scale, spawnOpts);
        break;
      case 'arc':
        spawnArc(typeLower, attackerPos.x, attackerPos.y, defenderPos.x, defenderPos.y, scale, spawnOpts);
        break;
      case 'charge':
        // Spawn charge trail immediately - particles sweep to defender in sync with attacker
        spawnChargeTrail(typeLower, attackerPos.x, attackerPos.y, defenderPos.x, defenderPos.y, scale, spawnOpts);
        break;
      case 'slash':
        // Delay slash particles until attacker reaches defender (35% of 350ms strike animation)
        setTimeout(function() {
          spawnSlash(typeLower, defenderPos.x, defenderPos.y, scale, isPlayer, spawnOpts);
          // Restart animation loop if it stopped
          if (!animationId && particles.length > 0) animateParticles();
        }, 120);
        break;
      case 'wave':
        spawnWave(typeLower, attackerPos.x, attackerPos.y, defenderPos.x, defenderPos.y, scale, spawnOpts);
        break;
      case 'swarm':
        spawnSwarm(typeLower, attackerPos.x, attackerPos.y, defenderPos.x, defenderPos.y, scale, spawnOpts);
        break;
      case 'drain':
        spawnDrain(typeLower, attackerPos.x, attackerPos.y, defenderPos.x, defenderPos.y, scale, spawnOpts);
        break;
      case 'status_drift':
        spawnStatusDrift(typeLower, attackerPos.x, attackerPos.y, defenderPos.x, defenderPos.y, scale, spawnOpts);
        break;
      case 'self_aura':
        spawnSelfAura(typeLower, attackerPos.x, attackerPos.y, scale, spawnOpts);
        break;
      default:
        spawnBurst(typeLower, defenderPos.x, defenderPos.y, scale, spawnOpts);
    }

    if (!animationId) animateParticles();

    // Return scale info for caller to use (shake, flash)
    return {
      scale: scale,
      pattern: pattern,
      flashColor: (TYPE_EFFECTS[typeLower] || TYPE_EFFECTS.neutral).flashColor
    };
  }

  // ============================================
  // ANIMATION LOOP
  // ============================================
  var MAX_PARTICLES = 500; // Cap to prevent memory accumulation in long battles

  function animateParticles() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter(function(p) { return p.life > 0; });

    // Cap particle count to prevent memory issues
    if (particles.length > MAX_PARTICLES) {
      // Remove oldest particles (beginning of array) to stay under cap
      particles = particles.slice(particles.length - MAX_PARTICLES);
    }

    particles.forEach(function(p) { p.update(); p.draw(ctx); });
    if (particles.length > 0) animationId = requestAnimationFrame(animateParticles);
    else animationId = null;
  }

  // ============================================
  // EXPOSE API
  // ============================================
  window.initCanvas = initCanvas;
  window.resizeCanvas = resizeCanvas;
  window.playBattleIntro = playBattleIntro;
  window.spawnIntroFog = spawnIntroFog;
  window.playVictoryEffect = playVictoryEffect;
  window.playDefeatEffect = playDefeatEffect;
  window.positionBattleLog = positionBattleLog;
  window.playAttackAnimation = playAttackAnimation;
  window.TYPE_EFFECTS = TYPE_EFFECTS;
  window.powerScale = powerScale;
})();
