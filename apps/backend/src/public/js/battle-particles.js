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
    'Tsunami Strike': { pattern: 'arc' },
    'Stone Throw': { pattern: 'arc' },
    'Cosmic Stone': { pattern: 'arc' },
    'Curse Throw': { pattern: 'arc' },
    'Draco Meteor': { pattern: 'arc', count: 3 },
    'Dust Throw': { pattern: 'arc' },
    'Web Trap': { pattern: 'arc' },

    // Swarm/multi-hit - multiple projectiles
    'Bubble Burst': { pattern: 'swarm', count: 5 },
    'Spirit Volley': { pattern: 'swarm', count: 4 },
    'Hive Strike': { pattern: 'swarm', count: 6 },
    'Avalanche': { pattern: 'swarm', count: 5 },

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
    'Burning Strike': { pattern: 'slash' },
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

    // Wave effects - expanding auras
    'Shock Wave': { pattern: 'wave' },
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
    'Flamethrower': { pattern: 'beam' },
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

    // Self aura - buff effects on self
    'Regenerate': { pattern: 'self_aura' },
    'War Posture': { pattern: 'self_aura' },
    'Ember Ward': { pattern: 'self_aura' },
    'Fortify': { pattern: 'self_aura' },
    'Store Energy': { pattern: 'self_aura' },
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

    // Beam stretch
    if (this.isBeam) {
      this.beamLength = Math.min(this.beamLength + 30, this.beamTargetLength);
      this.life -= 0.025;
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
        this.life = Math.min(this.life, 0.3);
        this.maxLife = this.life;
      } else {
        this.vx = (dx / dist) * this.travelSpeed;
        this.vy = (dy / dist) * this.travelSpeed;
        this.vx += (Math.random() - 0.5) * 0.5;
        this.vy += (Math.random() - 0.5) * 0.5;
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
      particleCount: Math.round(20 + (p / 120) * 80),
      particleSize: 0.6 + (p / 120) * 0.8,
      shakeAmplitude: p >= 80 ? 2 + (p - 80) / 10 : 0,
      shakeDuration: p >= 80 ? 100 + (p - 80) * 3 : 0,
      travelSpeed: 22 + (p / 120) * 14,  // Faster travel (22-36 px/frame) for better sound sync
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
      size: (4 + Math.random() * 3) * scale.particleSize,
      isBeam: true,
      beamTargetLength: distance,
      angle: angle,
      life: 0.6
    }));

    // Trailing particles along beam path
    var count = Math.round(scale.particleCount * 0.3);
    for (var i = 0; i < count; i++) {
      var t = Math.random();
      var px = startX + dx * t + (Math.random() - 0.5) * 10;
      var py = startY + dy * t + (Math.random() - 0.5) * 10;
      particles.push(new Particle(px, py, {
        color: randomColor(colors),
        size: (2 + Math.random() * 3) * scale.particleSize,
        shape: randomShape(fx.shapes),
        speed: 1 + Math.random(),
        gravity: fx.gravity,
        life: 0.3 + Math.random() * 0.2
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
      var offsetX = (Math.random() - 0.5) * 20;
      var offsetY = (Math.random() - 0.5) * 20;
      particles.push(new Particle(
        startX + offsetX,
        startY + offsetY,
        {
          color: randomColor(colors),
          size: (3 + Math.random() * 4) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 2 + Math.random() * 2,
          life: 1.0 + Math.random() * 0.3,
          targetX: endX + (Math.random() - 0.5) * 20,
          targetY: endY + (Math.random() - 0.5) * 20,
          travelSpeed: scale.travelSpeed * (0.9 + Math.random() * 0.2),
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

    for (var i = 0; i < count; i++) {
      var offsetX = (Math.random() - 0.5) * 15;
      var offsetY = (Math.random() - 0.5) * 15;
      var delayOffset = i * 10; // Stagger spawns

      particles.push(new Particle(
        startX + offsetX,
        startY + offsetY,
        {
          color: randomColor(colors),
          size: (4 + Math.random() * 5) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 2,
          life: 1.5,
          isArc: true,
          targetX: endX + (Math.random() - 0.5) * 25,
          targetY: endY + (Math.random() - 0.5) * 25,
          arcDuration: 500 + Math.random() * 200 + delayOffset,
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

    // Slash line particles
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
    var count = Math.round(scale.particleCount * 0.6);

    // Trail from start toward end
    var dx = endX - startX;
    var dy = endY - startY;

    for (var i = 0; i < count; i++) {
      var t = Math.random() * 0.7; // Along the charge path
      var px = startX + dx * t + (Math.random() - 0.5) * 30;
      var py = startY + dy * t + (Math.random() - 0.5) * 20;

      particles.push(new Particle(px, py, {
        color: randomColor(colors),
        size: (4 + Math.random() * 4) * scale.particleSize,
        shape: randomShape(fx.shapes),
        speed: 1 + Math.random() * 2,
        angle: Math.atan2(dy, dx) + Math.PI + (Math.random() - 0.5) * 0.5,
        gravity: fx.gravity,
        friction: 0.96,
        life: 0.4 + Math.random() * 0.3
      }));
    }

    // Impact burst at end
    for (var j = 0; j < count * 0.5; j++) {
      particles.push(new Particle(
        endX + (Math.random() - 0.5) * 40,
        endY + (Math.random() - 0.5) * 40,
        {
          color: randomColor(colors),
          size: (5 + Math.random() * 5) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 4 + Math.random() * 4,
          gravity: fx.gravity,
          life: 0.35 + Math.random() * 0.2
        }
      ));
    }
  }

  // ============================================
  // PATTERN: WAVE (expanding ring)
  // ============================================
  function spawnWave(type, startX, startY, endX, endY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
    var count = Math.round(scale.particleCount * 0.4);
    var rings = 3;

    // Special handling for text particles (musical notes, etc.)
    if (opts.textParticles && opts.textParticles.length > 0) {
      // Spawn floating text particles drifting toward target
      var noteCount = Math.max(6, count);
      for (var n = 0; n < noteCount; n++) {
        var noteChar = opts.textParticles[n % opts.textParticles.length];
        var offsetX = (Math.random() - 0.5) * 60;
        var offsetY = (Math.random() - 0.5) * 40;
        var delay = n * 50;

        setTimeout((function(char, ox, oy) {
          return function() {
            particles.push(new Particle(startX + ox, startY + oy, {
              color: randomColor(colors),
              size: (16 + Math.random() * 8) * scale.particleSize,
              shape: 'text',
              text: char,
              speed: 1.5 + Math.random() * 1.5,
              angle: Math.atan2(endY - startY, endX - startX) + (Math.random() - 0.5) * 0.8,
              gravity: -0.03,
              friction: 0.99,
              life: 0.8 + Math.random() * 0.4
            }));
          };
        })(noteChar, offsetX, offsetY), delay);
      }
      return; // Skip regular wave for text particle moves
    }

    for (var r = 0; r < rings; r++) {
      var ringDelay = r * 80;
      var ringRadius = 20 + r * 30;

      for (var i = 0; i < count / rings; i++) {
        var angle = (i / (count / rings)) * Math.PI * 2;
        var px = startX + Math.cos(angle) * (10 + r * 5);
        var py = startY + Math.sin(angle) * (10 + r * 5);

        particles.push(new Particle(px, py, {
          color: randomColor(colors),
          size: (3 + Math.random() * 3) * scale.particleSize,
          shape: 'ring',
          speed: 4 + r,
          angle: angle,
          gravity: 0,
          friction: 0.98,
          life: 0.5 + Math.random() * 0.2
        }));
      }
    }

    // Impact at target
    for (var j = 0; j < count * 0.3; j++) {
      particles.push(new Particle(
        endX + (Math.random() - 0.5) * 30,
        endY + (Math.random() - 0.5) * 30,
        {
          color: randomColor(colors),
          size: (3 + Math.random() * 3) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 2 + Math.random() * 2,
          gravity: fx.gravity,
          life: 0.3 + Math.random() * 0.2
        }
      ));
    }
  }

  // ============================================
  // PATTERN: SWARM (staggered multi-hit)
  // ============================================
  function spawnSwarm(type, startX, startY, endX, endY, scale, opts) {
    opts = opts || {};
    var fx = TYPE_EFFECTS[type] || TYPE_EFFECTS.neutral;
    var colors = opts.customColors || fx.colors;
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
    var count = Math.round(scale.particleCount * 0.6);

    // Impact at defender first
    for (var i = 0; i < count * 0.4; i++) {
      particles.push(new Particle(
        defenderX + (Math.random() - 0.5) * 30,
        defenderY + (Math.random() - 0.5) * 30,
        {
          color: randomColor(colors),
          size: (3 + Math.random() * 3) * scale.particleSize,
          shape: randomShape(fx.shapes),
          speed: 2 + Math.random() * 2,
          gravity: fx.gravity,
          life: 0.3 + Math.random() * 0.2
        }
      ));
    }

    // Drain particles flow back to attacker (after delay)
    for (var j = 0; j < count * 0.6; j++) {
      particles.push(new Particle(
        defenderX + (Math.random() - 0.5) * 40,
        defenderY + (Math.random() - 0.5) * 40,
        {
          color: '#4ade80', // Green for life drain
          size: (3 + Math.random() * 3) * scale.particleSize,
          shape: 'circle',
          speed: 2,
          life: 1.2,
          isDrain: true,
          drainDelay: 150 + Math.random() * 100,
          targetX: attackerX + (Math.random() - 0.5) * 20,
          targetY: attackerY + (Math.random() - 0.5) * 20,
          travelSpeed: scale.travelSpeed * 0.7
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
    var spawnOpts = { customColors: customColors, textParticles: textParticles };

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
        spawnChargeTrail(typeLower, attackerPos.x, attackerPos.y, defenderPos.x, defenderPos.y, scale, spawnOpts);
        break;
      case 'slash':
        spawnSlash(typeLower, defenderPos.x, defenderPos.y, scale, isPlayer, spawnOpts);
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
  window.positionBattleLog = positionBattleLog;
  window.playAttackAnimation = playAttackAnimation;
  window.TYPE_EFFECTS = TYPE_EFFECTS;
  window.powerScale = powerScale;
})();
