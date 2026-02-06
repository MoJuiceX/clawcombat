// ============================================
// AUDIO MANAGER — Enhanced Web Audio API Engine
// Type-specific sounds, filters, BGM, volume controls
// ============================================
var NativeAudio = window.Audio;
var Audio = (function() {
  var ctx = null;
  var muted = localStorage.getItem('clawcombat_muted') === 'true';
  var sfxVol = parseFloat(localStorage.getItem('clawcombat_sfx_vol') || '0.55');
  var MUSIC_MAX = 0.08;
  var musicVol = Math.min(parseFloat(localStorage.getItem('clawcombat_music_vol') || '0.02'), MUSIC_MAX);
  var shakeEnabled = localStorage.getItem('clawcombat_shake') !== 'false';
  var settingsOpen = false;

  // BGM state
  var bgmTracks = {};
  var currentTrack = null;
  var bgmPaused = false;       // true when user paused playback
  var sessionTrack = null;     // track chosen for this battle session (persists across pause/resume)

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function updateBtn() {
    var btn = document.getElementById('muteBtn');
    if (btn) btn.innerHTML = muted ? '&#128263;' : '&#128266;';
  }
  setTimeout(function() {
    updateBtn();
    var ss = document.getElementById('sfxSlider');
    var ms = document.getElementById('musicSlider');
    var st = document.getElementById('shakeToggle');
    if (ss) ss.value = Math.round(sfxVol * 100 / 0.7);
    if (ms) ms.value = Math.round(musicVol * 100 / MUSIC_MAX);
    if (st) st.checked = shakeEnabled;
  }, 100);

  // --- WAV sample cache & player ---
  var wavCache = {};
  var wavPaths = {
    strike: '/sounds/strike.wav',
    hit: '/sounds/hit.wav',
    burst: '/sounds/burst.wav',
    beam: '/sounds/beam.wav',
    charge: '/sounds/charge.wav',
    projectile: '/sounds/projectile.wav',
    electric: '/sounds/electric.wav',
    slash: '/sounds/slash.wav',
    wave: '/sounds/wave.wav',
    spin: '/sounds/spin.wav',
    drain: '/sounds/drain.wav',
    shield: '/sounds/shield.wav',
    boost: '/sounds/boost.wav',
    status: '/sounds/status.wav',
    heal: '/sounds/heal.wav'
  };

  function loadWav(name) {
    if (wavCache[name]) return wavCache[name];
    var path = wavPaths[name];
    if (!path) return null;
    wavCache[name] = fetch(path)
      .then(function(r) { return r.arrayBuffer(); })
      .then(function(buf) { return getCtx().decodeAudioData(buf); })
      .then(function(decoded) { wavCache[name] = decoded; return decoded; })
      .catch(function() { wavCache[name] = null; return null; });
    return wavCache[name];
  }

  function playWav(name, vol, rate) {
    var buf = wavCache[name];
    if (!buf || buf instanceof Promise) return false;
    var c = getCtx();
    var src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate || 1.0;
    var g = c.createGain();
    g.gain.value = (vol || 0.5) * sfxVol;
    src.connect(g);
    g.connect(c.destination);
    src.start(0);
    return true;
  }

  // Play WAV at given rate, fading out over its full duration
  function playWavFade(name, vol, rate) {
    var buf = wavCache[name];
    if (!buf || buf instanceof Promise) return false;
    var c = getCtx();
    var src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate || 1.0;
    var duration = buf.duration / (rate || 1.0);
    var g = c.createGain();
    var startVol = (vol || 0.5) * sfxVol;
    var t = c.currentTime;
    g.gain.setValueAtTime(startVol, t);
    // Hold full volume for first 40%, then fade to silence
    g.gain.setValueAtTime(startVol, t + duration * 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(g);
    g.connect(c.destination);
    src.start(0);
    src.stop(t + duration);
    return true;
  }

  // Preload all WAV samples on first user interaction
  var wavsPreloaded = false;
  function preloadWavs() {
    if (wavsPreloaded) return;
    wavsPreloaded = true;
    Object.keys(wavPaths).forEach(function(name) { loadWav(name); });
  }
  document.addEventListener('click', preloadWavs, { once: true });
  document.addEventListener('keydown', preloadWavs, { once: true });

  // --- Synth primitives ---
  function osc(type, freq, start, dur, vol, dest) {
    var c = getCtx();
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime((vol || 0.3) * sfxVol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    o.connect(g);
    g.connect(dest || c.destination);
    o.start(start);
    o.stop(start + dur);
    return o;
  }

  function noise(start, dur, vol) {
    var c = getCtx();
    var bufferSize = c.sampleRate * Math.max(dur, 0.01);
    var buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource();
    src.buffer = buffer;
    var g = c.createGain();
    g.gain.setValueAtTime((vol || 0.15) * sfxVol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(g);
    g.connect(c.destination);
    src.start(start);
    src.stop(start + dur);
  }

  // Filtered oscillator — richer type-specific sounds
  function filtOsc(type, freq, start, dur, vol, filterType, filterFreq, modRate) {
    var c = getCtx();
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime((vol || 0.3) * sfxVol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    o.connect(g);

    var output = g;
    if (filterType) {
      var f = c.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = filterFreq || 1000;
      f.Q.value = 2;
      g.connect(f);
      output = f;
    }
    if (modRate) {
      var lfo = c.createOscillator();
      var lfoG = c.createGain();
      lfo.frequency.value = modRate;
      lfoG.gain.value = freq * 0.1;
      lfo.connect(lfoG);
      lfoG.connect(o.frequency);
      lfo.start(start);
      lfo.stop(start + dur);
    }
    output.connect(c.destination);
    o.start(start);
    o.stop(start + dur);
  }

  // Filtered noise — for impact textures
  function filtNoise(start, dur, vol, filterType, filterFreq) {
    var c = getCtx();
    var bufferSize = c.sampleRate * Math.max(dur, 0.01);
    var buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource();
    src.buffer = buffer;
    var g = c.createGain();
    g.gain.setValueAtTime((vol || 0.15) * sfxVol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(g);
    if (filterType) {
      var f = c.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = filterFreq || 800;
      f.Q.value = 1;
      g.connect(f);
      f.connect(c.destination);
    } else {
      g.connect(c.destination);
    }
    src.start(start);
    src.stop(start + dur);
  }

  // Screen shake
  function screenShake(intensity) {
    if (!shakeEnabled) return;
    var el = document.getElementById('battle-arena') || document.body;
    el.style.transition = 'none';
    var shakes = intensity > 0.7 ? 6 : 4;
    var mag = intensity > 0.7 ? 6 : 3;
    var i = 0;
    var interval = setInterval(function() {
      if (i >= shakes) {
        el.style.transform = '';
        clearInterval(interval);
        return;
      }
      var x = (Math.random() - 0.5) * mag * 2;
      var y = (Math.random() - 0.5) * mag * 2;
      el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      i++;
    }, 40);
  }

  // --- Type-specific attack sound profiles ---
  var typeProfiles = {
    FIRE:     { wave: 'sawtooth', freq: 250, filter: 'lowpass', filterFreq: 600, mod: 8 },
    WATER:    { wave: 'sine',     freq: 350, filter: 'lowpass', filterFreq: 1200, mod: 5 },
    GRASS:    { wave: 'triangle', freq: 300, filter: 'bandpass', filterFreq: 800, mod: 3 },
    ELECTRIC: { wave: 'square',   freq: 600, filter: 'highpass', filterFreq: 1500, mod: 40 },
    ICE:      { wave: 'sine',     freq: 500, filter: 'highpass', filterFreq: 2000, mod: 12 },
    SHADOW:   { wave: 'sawtooth', freq: 150, filter: 'lowpass', filterFreq: 400, mod: 6 },
    METAL:    { wave: 'square',   freq: 400, filter: 'bandpass', filterFreq: 1800, mod: 0 },
    PSYCHE:   { wave: 'sine',     freq: 700, filter: 'bandpass', filterFreq: 1400, mod: 8 },
    DRAGON:   { wave: 'sawtooth', freq: 200, filter: 'lowpass', filterFreq: 500, mod: 10 },
    MYSTIC:   { wave: 'sine',     freq: 800, filter: 'highpass', filterFreq: 1600, mod: 6 },
    COSMIC:   { wave: 'sine',     freq: 900, filter: 'bandpass', filterFreq: 2000, mod: 15 },
    NEUTRAL:  { wave: 'square',   freq: 200, filter: null, filterFreq: 0, mod: 0 }
  };

  // --- Sound definitions (WAV primary, synth fallback) ---
  var sounds = {
    // Normal hit: strike.wav, pitch-shifted by type
    hit: function(moveType) {
      var typeRates = { FIRE: 0.9, WATER: 1.1, ELECTRIC: 1.4, GRASS: 1.0, ICE: 1.2, SHADOW: 0.7, METAL: 0.85, PSYCHE: 1.3, DRAGON: 0.75, MYSTIC: 1.25 };
      var rate = typeRates[moveType] || 1.0;
      if (playWav('strike', 0.55, rate)) return;
      // synth fallback
      var c = getCtx(); var t = c.currentTime;
      var p = typeProfiles[moveType] || typeProfiles.NEUTRAL;
      filtNoise(t, 0.12, 0.3, 'lowpass', 400);
      filtOsc(p.wave, p.freq, t, 0.1, 0.25, p.filter, p.filterFreq, p.mod);
      filtOsc(p.wave, p.freq * 0.6, t + 0.03, 0.1, 0.2, p.filter, p.filterFreq, 0);
    },
    // Critical hit: hit.wav (harder impact)
    hitCrit: function(moveType) {
      if (playWav('hit', 0.7, 1.0)) { screenShake(0.8); return; }
      var c = getCtx(); var t = c.currentTime;
      var p = typeProfiles[moveType] || typeProfiles.NEUTRAL;
      filtNoise(t, 0.2, 0.45, 'lowpass', 500);
      filtOsc(p.wave, p.freq * 1.5, t, 0.06, 0.4, p.filter, p.filterFreq, p.mod);
      filtOsc('square', p.freq * 2, t + 0.02, 0.08, 0.35, p.filter, p.filterFreq * 1.2, 0);
      filtOsc(p.wave, p.freq * 0.7, t + 0.06, 0.14, 0.28, p.filter, p.filterFreq, 0);
      screenShake(0.8);
    },
    // Super effective: burst.wav
    hitSuper: function(moveType) {
      if (playWav('burst', 0.7, 1.0)) { screenShake(1.0); return; }
      var c = getCtx(); var t = c.currentTime;
      var p = typeProfiles[moveType] || typeProfiles.NEUTRAL;
      filtNoise(t, 0.22, 0.4, 'lowpass', 500);
      filtOsc(p.wave, p.freq * 2, t, 0.05, 0.35, p.filter, p.filterFreq, p.mod);
      filtOsc('square', p.freq * 1.4, t + 0.03, 0.07, 0.3, p.filter, p.filterFreq, 0);
      filtOsc(p.wave, p.freq, t + 0.06, 0.12, 0.28, p.filter, p.filterFreq, 0);
      osc('sine', 800, t + 0.1, 0.1, 0.18);
      screenShake(1.0);
    },
    // Miss: spin.wav (whoosh)
    miss: function() {
      if (playWav('spin', 0.4, 1.2)) return;
      var c = getCtx(); var t = c.currentTime;
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(400, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.18);
      g.gain.setValueAtTime(0.15 * sfxVol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + 0.18);
    },
    // Faint: drain.wav
    faint: function() {
      // Fade music out over 2.5s alongside the faint SFX
      if (bgmActiveEl && !bgmActiveEl.paused) {
        clearBGMTimers();
        fadeOut(bgmActiveEl, 2500, function() { bgmActiveEl = null; });
        currentTrack = null;
        updateMusicBtns();
      }
      if (playWavFade('drain', 0.6, 1.6)) { screenShake(0.6); return; }
      var c = getCtx(); var t = c.currentTime;
      for (var i = 0; i < 6; i++) {
        filtOsc('square', 350 - i * 45, t + i * 0.07, 0.12, 0.22 - i * 0.03, 'lowpass', 600 - i * 60, 0);
      }
      filtNoise(t + 0.08, 0.35, 0.18, 'lowpass', 300);
      screenShake(0.6);
    },
    // Victory: triumphant fanfare (C major → G → C octave)
    victory: function() {
      var c = getCtx(); var t = c.currentTime;
      // Fanfare arpeggio: C5-E5-G5 quick, then sustained C6 chord
      var fanfare = [
        { f: 523, t: 0,    d: 0.18 },  // C5
        { f: 659, t: 0.12, d: 0.18 },  // E5
        { f: 784, t: 0.24, d: 0.18 },  // G5
        { f: 784, t: 0.40, d: 0.12 },  // G5 (grace)
        { f: 1047, t: 0.50, d: 0.70 }, // C6 (sustained)
      ];
      // Layer 1: bright square wave melody
      for (var i = 0; i < fanfare.length; i++) {
        var n = fanfare[i];
        osc('square', n.f, t + n.t, n.d, 0.18);
      }
      // Layer 2: warm sine harmony (thirds below)
      var harmony = [
        { f: 440, t: 0,    d: 0.18 },  // A4
        { f: 523, t: 0.12, d: 0.18 },  // C5
        { f: 659, t: 0.24, d: 0.18 },  // E5
        { f: 659, t: 0.40, d: 0.12 },  // E5
        { f: 784, t: 0.50, d: 0.70 },  // G5
      ];
      for (var i = 0; i < harmony.length; i++) {
        var h = harmony[i];
        osc('sine', h.f, t + h.t, h.d, 0.14);
      }
      // Layer 3: sub-bass root notes for fullness
      osc('sine', 262, t + 0.0, 0.35, 0.12);  // C4
      osc('sine', 392, t + 0.40, 0.15, 0.10);  // G4
      osc('sine', 523, t + 0.50, 0.80, 0.10);  // C5
      // Layer 4: shimmer on the final chord
      osc('triangle', 2093, t + 0.55, 0.50, 0.06); // C7 shimmer
      osc('triangle', 2637, t + 0.60, 0.40, 0.04); // E7 shimmer
    },
    // Defeat: drain.wav slowed down
    defeat: function() {
      if (playWav('drain', 0.5, 0.6)) return;
      var c = getCtx(); var t = c.currentTime;
      var notes = [400, 350, 300, 200];
      for (var i = 0; i < notes.length; i++) {
        filtOsc('sawtooth', notes[i], t + i * 0.18, 0.28, 0.2, 'lowpass', 500, 0);
      }
    },
    // Status inflict: status.wav
    statusInflict: function() {
      if (playWav('status', 0.5, 1.0)) return;
      var c = getCtx(); var t = c.currentTime;
      filtOsc('sine', 600, t, 0.08, 0.2, 'bandpass', 900, 6);
      filtOsc('sine', 800, t + 0.06, 0.08, 0.15, 'bandpass', 900, 6);
      filtOsc('sine', 600, t + 0.12, 0.12, 0.1, 'bandpass', 900, 0);
    },
    // Heal: heal.wav
    heal: function() {
      if (playWav('heal', 0.5, 1.0)) return;
      var c = getCtx(); var t = c.currentTime;
      var notes = [400, 500, 600, 800];
      for (var i = 0; i < notes.length; i++) {
        osc('sine', notes[i], t + i * 0.08, 0.15, 0.18);
      }
    },
    // Match found: charge.wav
    matchFound: function() {
      if (playWav('charge', 0.6, 1.0)) return;
      var c = getCtx(); var t = c.currentTime;
      osc('square', 440, t, 0.1, 0.25);
      osc('square', 554, t + 0.1, 0.1, 0.25);
      osc('square', 659, t + 0.2, 0.1, 0.25);
      osc('square', 880, t + 0.3, 0.22, 0.3);
    },
    // Move select: projectile.wav (short click)
    moveSelect: function() {
      if (playWav('projectile', 0.35, 1.5)) return;
      var c = getCtx(); var t = c.currentTime;
      filtOsc('square', 600, t, 0.04, 0.12, 'highpass', 1000, 0);
    },
    // Timer tick: synth only (needs to be very short/precise)
    timerTick: function() {
      var c = getCtx(); var t = c.currentTime;
      osc('sine', 1000, t, 0.04, 0.1);
    },
    // Turn start: beam.wav (short burst)
    turnStart: function() {
      if (playWav('beam', 0.35, 1.3)) return;
      var c = getCtx(); var t = c.currentTime;
      osc('sine', 660, t, 0.08, 0.12);
      osc('sine', 880, t + 0.06, 0.1, 0.1);
    },
    // Level up: boost.wav pitched up
    levelUp: function() {
      if (playWav('boost', 0.6, 1.3)) return;
      var c = getCtx(); var t = c.currentTime;
      var notes = [300, 400, 500, 600, 800, 1000];
      for (var i = 0; i < notes.length; i++) {
        osc('square', notes[i], t + i * 0.06, 0.12, 0.2);
        osc('sine', notes[i] * 2, t + i * 0.06, 0.08, 0.08);
      }
    },
    // Stat boost: shield.wav
    statBoost: function() {
      if (playWav('shield', 0.4, 1.0)) return;
      var c = getCtx(); var t = c.currentTime;
      osc('sine', 500, t, 0.1, 0.12);
      osc('sine', 700, t + 0.06, 0.1, 0.12);
    },
    // Stat drop: slash.wav slowed
    statDrop: function() {
      if (playWav('slash', 0.35, 0.7)) return;
      var c = getCtx(); var t = c.currentTime;
      osc('sine', 500, t, 0.1, 0.12);
      osc('sine', 350, t + 0.06, 0.1, 0.12);
    },
    // Surrender: drain.wav slow
    surrender: function() {
      if (playWav('drain', 0.4, 0.5)) return;
      var c = getCtx(); var t = c.currentTime;
      filtOsc('sawtooth', 300, t, 0.3, 0.2, 'lowpass', 400, 0);
      filtOsc('sawtooth', 200, t + 0.15, 0.3, 0.15, 'lowpass', 300, 0);
    }
  };

  // --- BGM System with fade-in & crossfade loop ---
  var FADE_IN_MS = 3000;       // 3s fade in
  var CROSSFADE_MS = 4000;     // 4s crossfade at loop point
  var bgmFadeInterval = null;
  var bgmCrossfadeTimeout = null;
  var bgmActiveEl = null;      // currently playing Audio element

  function createTrackEl(src) {
    try {
      var a = new NativeAudio(src);
      a.loop = false; // we handle looping via crossfade
      a.volume = 0;
      a.preload = 'auto';
      a.addEventListener('error', function() {
        console.error('[MUSIC] Track load error:', a.error);
      });
      return a;
    } catch (e) {
      console.error('[MUSIC] Failed to create Audio:', e);
      return null;
    }
  }

  function initBGM() {
    [1, 2, 3].forEach(function(n) {
      if (!bgmTracks[n]) bgmTracks[n] = '/sounds/bgm_level' + n + '.wav';
    });
    console.log('[MUSIC] BGM init complete');
  }

  function getTargetVol() {
    return musicVol;
  }

  function clearBGMTimers() {
    if (bgmFadeInterval) { clearInterval(bgmFadeInterval); bgmFadeInterval = null; }
    if (bgmCrossfadeTimeout) { clearTimeout(bgmCrossfadeTimeout); bgmCrossfadeTimeout = null; }
  }

  function fadeIn(el, targetVol, durationMs, onDone) {
    el.volume = 0;
    var steps = 30;
    var stepMs = durationMs / steps;
    var volStep = targetVol / steps;
    var current = 0;
    var iv = setInterval(function() {
      current += volStep;
      if (current >= targetVol) {
        el.volume = targetVol;
        clearInterval(iv);
        if (onDone) onDone();
      } else {
        el.volume = current;
      }
    }, stepMs);
    return iv;
  }

  function fadeOut(el, durationMs, onDone) {
    var startVol = el.volume;
    if (startVol <= 0) { if (onDone) onDone(); return null; }
    var steps = 30;
    var stepMs = durationMs / steps;
    var volStep = startVol / steps;
    var current = startVol;
    var iv = setInterval(function() {
      current -= volStep;
      if (current <= 0) {
        el.volume = 0;
        el.pause();
        clearInterval(iv);
        if (onDone) onDone();
      } else {
        el.volume = current;
      }
    }, stepMs);
    return iv;
  }

  function scheduleCrossfade(trackLevel) {
    if (!bgmActiveEl) return;
    // Check time remaining periodically
    bgmCrossfadeTimeout = setInterval(function() {
      if (!bgmActiveEl || bgmActiveEl.paused) {
        clearInterval(bgmCrossfadeTimeout);
        bgmCrossfadeTimeout = null;
        return;
      }
      var remaining = bgmActiveEl.duration - bgmActiveEl.currentTime;
      if (remaining <= CROSSFADE_MS / 1000 && remaining > 0 && bgmActiveEl.duration > 0) {
        clearInterval(bgmCrossfadeTimeout);
        bgmCrossfadeTimeout = null;
        doCrossfade(trackLevel);
      }
    }, 250);
  }

  function doCrossfade(trackLevel) {
    var src = bgmTracks[trackLevel];
    if (!src) return;
    // Create fresh element for the next loop
    var nextEl = createTrackEl(src);
    if (!nextEl) return;
    var vol = getTargetVol();
    // Fade out old, fade in new simultaneously
    var oldEl = bgmActiveEl;
    fadeOut(oldEl, CROSSFADE_MS);
    nextEl.volume = 0;
    nextEl.play().then(function() {
      fadeIn(nextEl, vol, CROSSFADE_MS);
    }).catch(function(e) { console.error('[MUSIC] Crossfade play failed:', e.message); });
    bgmActiveEl = nextEl;
    // Schedule next crossfade
    scheduleCrossfade(trackLevel);
  }

  function startTrack(level, fade) {
    clearBGMTimers();
    // Stop any playing element
    if (bgmActiveEl) { bgmActiveEl.pause(); bgmActiveEl = null; }

    var src = bgmTracks[level];
    if (!src) return;
    var el = createTrackEl(src);
    if (!el) return;
    var vol = getTargetVol();

    bgmActiveEl = el;
    currentTrack = level;

    el.play().then(function() {
      console.log('[MUSIC] Playback started, duration=' + el.duration.toFixed(1) + 's');
      if (fade) {
        fadeIn(el, vol, FADE_IN_MS);
      } else {
        el.volume = vol;
      }
      // Schedule crossfade for seamless loop
      scheduleCrossfade(level);
    }).catch(function(e) { console.error('[MUSIC] Play failed:', e.message); });

    updateMusicBtns();
  }

  function stopTrack(fade) {
    clearBGMTimers();
    if (bgmActiveEl) {
      if (fade) {
        var el = bgmActiveEl;
        bgmActiveEl = null;
        fadeOut(el, 1500);
      } else {
        bgmActiveEl.pause();
        bgmActiveEl = null;
      }
    }
    currentTrack = null;
    updateMusicBtns();
  }

  function pauseTrack() {
    clearBGMTimers();
    if (bgmActiveEl && !bgmActiveEl.paused) {
      bgmActiveEl.pause();
      bgmPaused = true;
    }
  }

  function resumeTrack() {
    if (bgmPaused && bgmActiveEl) {
      var vol = getTargetVol();
      bgmActiveEl.volume = vol;
      bgmActiveEl.play().then(function() {
        scheduleCrossfade(sessionTrack || currentTrack);
      }).catch(function(e) { console.error('[MUSIC] Resume failed:', e.message); });
      bgmPaused = false;
    }
  }

  function updateMusicBtns() {
    var btns = document.querySelectorAll('#musicBtns .music-btn');
    btns.forEach(function(b, i) {
      if (currentTrack === (i + 1)) {
        b.style.background = '#059669';
        b.style.borderColor = '#10b981';
        b.style.boxShadow = '0 0 8px #10b981';
      } else {
        b.style.background = '#374151';
        b.style.borderColor = '#4b5563';
        b.style.boxShadow = 'none';
      }
    });
  }

  setTimeout(initBGM, 200);

  return {
    _unlocked: false,
    unlock: function() {
      // Resume AudioContext
      try { getCtx(); } catch(e) {}
      // Preload WAV samples
      preloadWavs();
      if (!this._unlocked) {
        this._unlocked = true;
        // Start random battle music on first unlock only
        this.playRandomMusic();
        console.log('[AUDIO] Unlocked');
      }
    },
    play: function(name, moveType) {
      if (muted) return;
      try {
        if (sounds[name]) {
          if (name === 'hit' || name === 'hitCrit' || name === 'hitSuper') {
            sounds[name](moveType);
          } else {
            sounds[name]();
          }
        }
      } catch (e) { /* audio ctx not allowed yet */ }
    },
    toggleMute: function() {
      muted = !muted;
      localStorage.setItem('clawcombat_muted', muted);
      updateBtn();
      if (muted && bgmActiveEl) {
        bgmActiveEl.pause();
        clearBGMTimers();
      } else if (!muted && currentTrack) {
        startTrack(currentTrack, false);
      }
    },
    isMuted: function() { return muted; },
    toggleSettings: function() {
      var panel = document.getElementById('audioSettingsPanel');
      if (!panel) return;
      settingsOpen = panel.style.display === 'none';
      panel.style.display = settingsOpen ? 'block' : 'none';
    },
    setSfxVolume: function(pct) {
      var v = parseInt(pct) || 0;
      sfxVol = (Math.max(0, Math.min(100, v)) / 100) * 0.7;
      localStorage.setItem('clawcombat_sfx_vol', sfxVol);
    },
    setMusicVolume: function(pct) {
      var v = parseInt(pct) || 0;
      musicVol = (Math.max(0, Math.min(100, v)) / 100) * MUSIC_MAX;
      localStorage.setItem('clawcombat_music_vol', musicVol);
      var vol = getTargetVol();
      if (bgmActiveEl && !bgmActiveEl.paused) bgmActiveEl.volume = vol;
    },
    setShake: function(on) {
      shakeEnabled = on;
      localStorage.setItem('clawcombat_shake', on);
    },
    toggleMusic: function(level) {
      console.log('[MUSIC] toggleMusic(' + level + ') muted=' + muted + ' currentTrack=' + currentTrack);
      if (muted) {
        muted = false;
        localStorage.setItem('clawcombat_muted', 'false');
        updateBtn();
      }
      if (currentTrack === level) {
        stopTrack(true);
      } else {
        startTrack(level, true);
      }
    },
    playMusic: function(level) {
      if (muted) return;
      if (currentTrack === level) return;
      startTrack(level, true);
    },
    playRandomMusic: function() {
      // Pick one track per battle session; reuse if already chosen
      if (!sessionTrack) {
        sessionTrack = Math.floor(Math.random() * 3) + 1;
      }
      this.playMusic(sessionTrack);
    },
    pauseMusic: function() {
      pauseTrack();
    },
    resumeMusic: function() {
      if (muted) return;
      if (bgmPaused) {
        resumeTrack();
      } else if (sessionTrack && !bgmActiveEl) {
        // Track was fully stopped (e.g. after faint), restart the session track
        startTrack(sessionTrack, true);
      }
    },
    stopMusic: function() {
      stopTrack(true);
    }
  };
})();

// Close audio settings when clicking outside
document.addEventListener('click', function(e) {
  var panel = document.getElementById('audioSettingsPanel');
  var btn = document.getElementById('audioSettingsBtn');
  if (panel && panel.style.display !== 'none' && !panel.contains(e.target) && e.target !== btn) {
    panel.style.display = 'none';
  }
});
