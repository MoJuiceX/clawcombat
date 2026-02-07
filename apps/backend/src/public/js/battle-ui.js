// ============================================
// SHARED BATTLE UI HELPERS
// Used by: demo.html, arena.html, replay.html
// Requires: type-colors.js (must be loaded first)
// ============================================

// --- Utility ---
function escapeHtml(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Speed multiplier (used by replay for 0.5x/2x/4x) ---
var _battleUISpeedMultiplier = 1;

function setSpeedMultiplier(n) {
  _battleUISpeedMultiplier = n || 1;
}

function delay(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, Math.max(50, ms / _battleUISpeedMultiplier));
  });
}

// --- Battle agent info (used by formatHistoryMessage) ---
var battleAgentNames = { player: '', opponent: '' };
var battleAgentTypes = { player: 'neutral', opponent: 'neutral' };

function setBattleAgentInfo(side, name, type) {
  battleAgentNames[side] = name;
  battleAgentTypes[side] = (type || 'neutral').toLowerCase();
}

// --- HP Bar ---
var _hpGhostTimers = { player: null, opponent: null };

function updateHPBar(side, currentHP, maxHP) {
  if (!maxHP || maxHP <= 0) maxHP = 1;
  var pct = (currentHP / maxHP) * 100;
  var bar = document.getElementById(side === 'player' ? 'playerHp' : 'opponentHp');
  var ghost = document.getElementById(side === 'player' ? 'playerHpGhost' : 'opponentHpGhost');
  if (!bar) return;
  var hpText = document.getElementById(side === 'player' ? 'playerHpText' : 'opponentHpText');
  var maxText = document.getElementById(side === 'player' ? 'playerMaxHp' : 'opponentMaxHp');
  var container = document.getElementById(side === 'player' ? 'playerHpContainer' : 'opponentHpContainer');

  // Get current bar width for ghost effect
  // Note: Must handle 0% correctly - parseFloat("0%") = 0 is valid, not unset
  var currentWidth = parseFloat(bar.style.width);
  if (isNaN(currentWidth)) currentWidth = 100;
  var newWidth = Math.max(0, pct);

  // If taking damage, show ghost effect
  if (ghost && newWidth < currentWidth) {
    // Clear any pending ghost shrink
    if (_hpGhostTimers[side]) clearTimeout(_hpGhostTimers[side]);
    // Keep ghost at old position
    ghost.style.width = currentWidth + '%';
    // Shrink ghost after delay
    _hpGhostTimers[side] = setTimeout(function() {
      ghost.style.width = newWidth + '%';
    }, 400 / _battleUISpeedMultiplier);
  } else if (ghost) {
    // Healing or initial set - sync ghost immediately
    ghost.style.width = newWidth + '%';
  }

  bar.style.width = newWidth + '%';
  bar.className = 'hp-bar' + (pct <= 20 ? ' critical' : pct <= 50 ? ' low' : '');
  if (hpText) hpText.textContent = Math.max(0, currentHP);
  if (maxText) maxText.textContent = maxHP;
  if (container) container.classList.toggle('warning', pct < 25);
}

// --- Frame color ---
function setFrameColor(side, type) {
  var color = TYPE_COLORS[(type || 'neutral').toLowerCase()] || TYPE_COLORS.neutral;
  var el = document.getElementById(side === 'player' ? 'playerLobster' : 'opponentLobster');
  if (el) el.style.setProperty('--frame-color', color);
  var hp = document.getElementById(side === 'player' ? 'playerHpContainer' : 'opponentHpContainer');
  if (hp) hp.style.setProperty('--frame-color', color);
}

// --- Damage numbers ---
// effectiveness: 0 = immune, 0.5 = not very, 1 = normal, 2+ = super effective
function showDamageNumber(side, amount, isCrit, isHeal, effectiveness) {
  var arena = document.getElementById('arena');
  var target = document.getElementById(side === 'player' ? 'playerLobster' : 'opponentLobster');
  if (!arena || !target) return;
  var rect = target.getBoundingClientRect();
  var arenaRect = arena.getBoundingClientRect();

  var num = document.createElement('div');
  num.className = 'damage-number';
  if (isCrit) num.classList.add('critical');
  if (isHeal) num.classList.add('heal-number');
  // Color-code by effectiveness
  if (!isHeal && effectiveness !== undefined && effectiveness !== 1) {
    if (effectiveness >= 2) num.classList.add('super-effective');
    else if (effectiveness === 0) num.classList.add('immune');
    else if (effectiveness < 1) num.classList.add('not-effective');
  }

  if (isHeal) {
    num.textContent = '+' + amount;
  } else {
    num.textContent = amount === 0 ? 'IMMUNE!' : '-' + amount;
  }
  num.style.left = (rect.left - arenaRect.left + rect.width / 2 - 30) + 'px';
  num.style.top = (rect.top - arenaRect.top + 20) + 'px';

  arena.appendChild(num);
  setTimeout(function() { num.remove(); }, 1200);
}

// --- Screen shake ---
function screenShake(amplitude, duration) {
  var arena = document.getElementById('arena');
  if (!arena) return;
  // Support custom amplitude/duration or use defaults
  if (amplitude && duration) {
    arena.style.setProperty('--shake-amplitude', amplitude + 'px');
    arena.classList.add('shake-custom');
    setTimeout(function() {
      arena.classList.remove('shake-custom');
      arena.style.removeProperty('--shake-amplitude');
    }, duration / _battleUISpeedMultiplier);
  } else {
    arena.classList.add('shake');
    setTimeout(function() { arena.classList.remove('shake'); }, 400 / _battleUISpeedMultiplier);
  }
}

// --- Screen flash (for powerful attacks) ---
function flashScreen(color, duration) {
  var arena = document.getElementById('arena');
  if (!arena) return;
  var flash = document.createElement('div');
  flash.className = 'screen-flash';
  flash.style.background = color;
  flash.style.animationDuration = (duration / _battleUISpeedMultiplier) + 'ms';
  arena.appendChild(flash);
  setTimeout(function() { flash.remove(); }, duration / _battleUISpeedMultiplier);
}

// --- Critical hit text ---
function showCriticalText(side) {
  var arena = document.getElementById('arena');
  var target = document.getElementById(side === 'player' ? 'playerLobster' : 'opponentLobster');
  if (!arena || !target) return;
  var rect = target.getBoundingClientRect();
  var arenaRect = arena.getBoundingClientRect();

  var text = document.createElement('div');
  text.className = 'critical-text';
  text.textContent = 'CRITICAL!';
  text.style.left = (rect.left - arenaRect.left + rect.width / 2) + 'px';
  text.style.top = (rect.top - arenaRect.top - 10) + 'px';

  arena.appendChild(text);
  setTimeout(function() { text.remove(); }, 800 / _battleUISpeedMultiplier);
}

// --- Attacker movement (charge/thrust) ---
function triggerAttackerMovement(side, pattern) {
  var el = document.getElementById(side === 'player' ? 'playerLobster' : 'opponentLobster');
  if (!el) return;

  var className = '';
  var duration = 300;

  if (pattern === 'charge') {
    className = 'charging';
    duration = 300;
  } else if (pattern === 'slash') {
    className = 'thrusting';
    duration = 150;
  }

  if (className) {
    el.classList.add(className);
    setTimeout(function() {
      el.classList.remove(className);
    }, duration / _battleUISpeedMultiplier);
  }
}

// --- Action info slide ---
// Action info boxes are now positioned relative to .lobster cards via CSS
// We toggle a 'visible' class to show/hide them
var actionInfoTimers = { player: null, opponent: null };

function showActionInfoSimple(side, text) {
  var isPlayer = side === 'player';
  var el = document.getElementById(isPlayer ? 'playerAction' : 'opponentAction');

  if (actionInfoTimers[side]) clearTimeout(actionInfoTimers[side]);
  if (!el) return;

  el.innerHTML = '<div class="action-row-1"><span class="move-name">' + escapeHtml(text) + '</span></div>';

  // Clear any inline styles that might interfere with CSS classes
  el.style.cssText = '';

  // Force reflow then add visible class
  void el.offsetWidth;
  el.classList.add('visible');

  actionInfoTimers[side] = setTimeout(function() {
    el.classList.remove('visible');
  }, 2500 / _battleUISpeedMultiplier);
}

function hideActionInfo(side) {
  var isPlayer = side === 'player';
  var el = document.getElementById(isPlayer ? 'playerAction' : 'opponentAction');
  if (!el) return;
  el.classList.remove('visible');
  if (actionInfoTimers[side]) clearTimeout(actionInfoTimers[side]);
}

function hideAllActionInfo() {
  hideActionInfo('player');
  hideActionInfo('opponent');
}

// --- Battle history ---
var battleHistoryTurn = 0;

function formatHistoryMessage(message) {
  if (!message) return '';
  var html = escapeHtml(message);

  var pName = battleAgentNames.player;
  var oName = battleAgentNames.opponent;
  var pColor = TYPE_COLORS[battleAgentTypes.player] || '#93c5fd';
  var oColor = TYPE_COLORS[battleAgentTypes.opponent] || '#fca5a5';

  if (pName) {
    html = html.replace(new RegExp(escapeRegex(pName), 'g'),
      '<span class="entry-agent-name" style="color:' + pColor + '">' + escapeHtml(pName) + '</span>');
  }
  if (oName) {
    html = html.replace(new RegExp(escapeRegex(oName), 'g'),
      '<span class="entry-agent-name" style="color:' + oColor + '">' + escapeHtml(oName) + '</span>');
  }

  html = html.replace(/dealt (\d+) damage/g, function(match, num) {
    return '<span class="nowrap">dealt <span class="entry-damage damage">-' + num + '</span> damage</span>';
  });
  html = html.replace(/(healed|restored|recovered|drained) (\d+)/gi, function(match, verb, num) {
    return '<span class="nowrap">' + verb + ' <span class="entry-damage heal">+' + num + '</span></span>';
  });
  html = html.replace(/took (\d+) (burn|poison|curse|leech)/gi, function(match, num, dtype) {
    return '<span class="nowrap">took <span class="entry-damage damage">-' + num + '</span> ' + dtype + '</span>';
  });
  // Critical hits - add on same line as damage
  html = html.replace(/A critical hit!/g, '<span class="entry-effect critical">CRIT!</span>');

  // Effectiveness - put on its own row (third line)
  html = html.replace(/[!\s]*It['']?s super effective!?/gi, '<br><span class="entry-effect super-effective">Super effective!</span>');
  html = html.replace(/[!\s]*It['']?s not very effective\.{0,3}/gi, '<br><span class="entry-effect not-effective">Not very effective</span>');
  html = html.replace(/[!\s]*It has no effect!?/gi, '<br><span class="entry-effect no-effect">No effect!</span>');

  // Status effects - on their own row
  html = html.replace(/[!\s]*inflicted with (burn|paralysis|poison|freeze|sleep|confusion)/gi, function(match, status) {
    return '<br><span class="entry-effect status">' + status.toUpperCase() + '</span>';
  });

  return html;
}

function addToHistory(message, side) {
  if (!message) return;
  var historyContent = document.getElementById('historyContent');
  if (!historyContent) return;
  var entry = document.createElement('div');
  if (side === 'player') {
    entry.className = 'history-entry player-entry';
  } else if (side === 'opponent') {
    entry.className = 'history-entry opponent-entry';
  } else {
    entry.className = 'history-entry system-entry';
  }
  entry.innerHTML = formatHistoryMessage(message);
  historyContent.appendChild(entry);
  historyContent.scrollLeft = historyContent.scrollWidth;
  historyContent.scrollTop = historyContent.scrollHeight;
}

// Combined use_move + damage in one entry: "Name used Move!\nMove dealt X damage!\nInfo"
function addCombinedToHistory(useMoveMsg, damageMsg, side) {
  var combined = (useMoveMsg || '') + '\n' + (damageMsg || '');
  var historyContent = document.getElementById('historyContent');
  if (!historyContent) return;
  var entry = document.createElement('div');
  if (side === 'player') {
    entry.className = 'history-entry player-entry';
  } else if (side === 'opponent') {
    entry.className = 'history-entry opponent-entry';
  } else {
    entry.className = 'history-entry system-entry';
  }
  // Format each line separately, join with <br>
  var lines = combined.split('\n');
  var htmlParts = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim()) htmlParts.push(formatHistoryMessage(lines[i].trim()));
  }
  entry.innerHTML = htmlParts.join('<br>');
  historyContent.appendChild(entry);
  historyContent.scrollLeft = historyContent.scrollWidth;
  historyContent.scrollTop = historyContent.scrollHeight;
}

function addAttackGap() {
  var historyContent = document.getElementById('historyContent');
  if (!historyContent) return;
  var gap = document.createElement('div');
  gap.className = 'history-attack-gap';
  historyContent.appendChild(gap);
}

function addTurnSeparator(turnNum) {
  var historyContent = document.getElementById('historyContent');
  if (!historyContent) return;
  var sep = document.createElement('div');
  sep.className = 'history-turn-separator';
  sep.innerHTML = '<span>Turn ' + turnNum + '</span>';
  historyContent.appendChild(sep);
  historyContent.scrollLeft = historyContent.scrollWidth;
  historyContent.scrollTop = historyContent.scrollHeight;
}

function clearHistory() {
  var historyContent = document.getElementById('historyContent');
  if (!historyContent) return;
  historyContent.innerHTML = '';
  battleHistoryTurn = 0;
  var turnEl = document.getElementById('historyTurn');
  if (turnEl) turnEl.textContent = 'Turn 1';
}

// ============================================
// PHASE 2: STATUS ICON MANAGEMENT
// ============================================
// Track active status effects per side
var _activeStatuses = {
  player: {},
  opponent: {}
};

// Status effect to icon/class mapping
var STATUS_ICONS = {
  burn: { icon: '🔥', class: 'burn' },
  poison: { icon: '☠️', class: 'poison' },
  paralysis: { icon: '⚡', class: 'paralysis' },
  paralyze: { icon: '⚡', class: 'paralysis' },
  freeze: { icon: '❄️', class: 'freeze' },
  frozen: { icon: '❄️', class: 'freeze' },
  sleep: { icon: '💤', class: 'sleep' },
  asleep: { icon: '💤', class: 'sleep' },
  confusion: { icon: '😵', class: 'confusion' },
  confused: { icon: '😵', class: 'confusion' }
};

// Ensure status icons container exists for a side
function ensureStatusIconsContainer(side) {
  var lobster = document.getElementById(side === 'player' ? 'playerLobster' : 'opponentLobster');
  if (!lobster) return null;

  var container = lobster.querySelector('.status-icons');
  if (!container) {
    container = document.createElement('div');
    container.className = 'status-icons';
    // Insert after the lobster-frame div
    var frame = lobster.querySelector('.lobster-frame');
    if (frame) {
      frame.parentNode.insertBefore(container, frame.nextSibling);
    } else {
      lobster.appendChild(container);
    }
  }
  return container;
}

// Add a status icon to a lobster
function addStatusIcon(side, status) {
  var statusKey = status.toLowerCase();
  var statusInfo = STATUS_ICONS[statusKey];
  if (!statusInfo) return;

  // Already have this status?
  if (_activeStatuses[side][statusKey]) return;

  var container = ensureStatusIconsContainer(side);
  if (!container) return;

  var icon = document.createElement('div');
  icon.className = 'status-icon ' + statusInfo.class;
  icon.setAttribute('data-status', statusKey);
  // Icon is set via CSS ::after content

  container.appendChild(icon);
  _activeStatuses[side][statusKey] = true;
}

// Remove a status icon from a lobster
function removeStatusIcon(side, status) {
  var statusKey = status.toLowerCase();
  if (!_activeStatuses[side][statusKey]) return;

  var container = ensureStatusIconsContainer(side);
  if (!container) return;

  var icon = container.querySelector('.status-icon[data-status="' + statusKey + '"]');
  if (icon) {
    icon.remove();
  }
  delete _activeStatuses[side][statusKey];
}

// Clear all status icons for a side
function clearStatusIcons(side) {
  var container = ensureStatusIconsContainer(side);
  if (container) {
    container.innerHTML = '';
  }
  _activeStatuses[side] = {};
}

// Clear all status icons for both sides
function clearAllStatusIcons() {
  clearStatusIcons('player');
  clearStatusIcons('opponent');
}

// ============================================
// PHASE 2: CRITICAL HIT ZOOM EFFECT
// ============================================
function triggerCritZoom(side) {
  var el = document.getElementById(side === 'player' ? 'playerLobster' : 'opponentLobster');
  if (!el) return;

  el.classList.add('crit-zoom');
  setTimeout(function() {
    el.classList.remove('crit-zoom');
  }, 400 / _battleUISpeedMultiplier);
}

// ============================================
// PHASE 2: EFFECTIVENESS CALLOUTS
// ============================================
function showEffectivenessCallout(type) {
  var arena = document.getElementById('arena');
  if (!arena) return;

  var callout = document.createElement('div');
  var duration = 800;

  if (type === 'super') {
    callout.className = 'super-effective-callout';
    callout.textContent = 'SUPER EFFECTIVE!';
    duration = 800;
  } else if (type === 'not-very') {
    callout.className = 'not-effective-callout';
    callout.textContent = 'Not very effective...';
    duration = 600;
  } else if (type === 'immune') {
    callout.className = 'immune-callout';
    callout.textContent = 'NO EFFECT!';
    duration = 500;
  } else {
    return;
  }

  arena.appendChild(callout);
  setTimeout(function() { callout.remove(); }, duration / _battleUISpeedMultiplier);
}
