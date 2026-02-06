/**
 * ClawCombat Telegram Bot Service
 *
 * Text-based gameplay via Telegram:
 * - /start, /help       — Onboarding
 * - /create              — Create lobster (links to web form)
 * - /lobster             — View your lobster
 * - /battle              — Join matchmaking queue
 * - /move <1-4>          — Submit move in active battle
 * - /stats               — View statistics
 * - /leaderboard         — Top 10
 * - /premium             — Premium info
 *
 * Uses Telegram Bot API directly via axios (no heavy deps).
 * Webhook mode: receives updates at POST /telegram/webhook.
 */

const axios = require('axios');
const crypto = require('crypto');
const { getDb } = require('../db/schema');
const { TYPE_EMOJIS, VALID_TYPES } = require('../utils/type-system');
const log = require('../utils/logger').createLogger('TELEGRAM');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
// SECURITY: Fallback URL for development only; in production WEB_URL should be set
const WEB_URL = process.env.WEB_URL || (process.env.NODE_ENV === 'production' ? (() => {
  log.warn('WEB_URL not set in production environment, using default');
  return 'https://clawcombat.com';
})() : 'https://clawcombat.com');

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------

async function sendMessage(chatId, text, options = {}) {
  if (!BOT_TOKEN) return;
  try {
    await axios.post(`${API_BASE}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      ...options,
    });
  } catch (e) {
    log.error('sendMessage error:', { error: e.response?.data?.description || e.message });
  }
}

async function sendPhoto(chatId, photoUrl, caption = '') {
  if (!BOT_TOKEN) return;
  try {
    await axios.post(`${API_BASE}/sendPhoto`, {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: 'Markdown',
    });
  } catch (e) {
    log.error('sendPhoto error:', { error: e.message });
  }
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  if (!BOT_TOKEN) return;
  try {
    await axios.post(`${API_BASE}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
    });
  } catch (e) { log.error('answerCallbackQuery error:', { error: e.message }); }
}

async function editMessageText(chatId, messageId, text, options = {}) {
  if (!BOT_TOKEN) return;
  try {
    await axios.post(`${API_BASE}/editMessageText`, {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
      ...options,
    });
  } catch (e) { log.error('editMessageText error:', { error: e.message }); }
}

// ---------------------------------------------------------------------------
// Agent lookup: find agent linked to this Telegram user
// ---------------------------------------------------------------------------

function findAgentByTelegram(telegramUserId) {
  const db = getDb();
  return db.prepare('SELECT * FROM agents WHERE telegram_user_id = ? AND status = ?')
    .get(String(telegramUserId), 'active');
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleStart(chatId, user) {
  const msg = `*Welcome to ClawCombat!*

Battle AI-powered cyberlobsters in text-based combat.

*Quick Start:*
/connect - Instantly create a lobster and start battling!

*Commands:*
/connect - Create lobster (one command!)
/create - Create via web form
/lobster - View your lobster
/battle - Find an opponent
/move - Use a move in battle
/stats - Your statistics
/leaderboard - Top operators
/help - All commands

Or visit: ${WEB_URL}`;

  await sendMessage(chatId, msg);
}

async function handleHelp(chatId) {
  const msg = `*ClawCombat Commands:*

/connect - Create lobster instantly (one command!)
/create - Create via web form
/lobster - View your lobster details
/battle - Find an opponent
/move <1-4> - Use move in battle
/stats - Your statistics
/leaderboard - Top 10 operators
/premium - Premium info
/link <code> - Link to web account

*Quick Start:*
Just type /connect and you're ready to battle!

*Manual Battle Flow:*
1. /battle - Find opponent
2. Wait for match
3. /move 1 - Use move #1
4. Continue until victory
5. Earn XP!

Full game: ${WEB_URL}`;

  await sendMessage(chatId, msg);
}

async function handleCreate(chatId, user) {
  const agent = findAgentByTelegram(user.id);

  if (agent) {
    await sendMessage(chatId, `You already have a lobster: *${agent.name}*\n\nUse /lobster to view it.`);
    return;
  }

  // Direct user to web creation flow
  await sendMessage(chatId, `*Create your Battle Lobster!*

Play a demo battle or create your own lobster:

${WEB_URL}

After creating your lobster, use /link <code> to connect it to Telegram.

Or if you already have a lobster, use /link to connect your account.`);
}

async function handleLobster(chatId, user) {
  const agent = findAgentByTelegram(user.id);

  if (!agent) {
    await sendMessage(chatId, 'You don\'t have a lobster linked yet.\n\nUse /create to make one, or /link <code> to connect an existing account.');
    return;
  }

  const db = getDb();

  // Get moves from agent_moves table
  let moveList;
  try {
    const agentMoves = db.prepare('SELECT move_id, slot FROM agent_moves WHERE agent_id = ? ORDER BY slot').all(agent.id);
    moveList = agentMoves.map(m => `${m.slot}. ${m.move_id}`).join('\n');
  } catch (e) {
    moveList = 'No moves assigned';
  }

  const typeEmoji = TYPE_EMOJIS[agent.ai_type] || '';
  const wins = agent.total_wins || 0;
  const fights = agent.total_fights || 0;
  const losses = fights - wins;

  const msg = `*${typeEmoji} ${agent.name}* (Level ${agent.level || 1})

*Type:* ${agent.ai_type || 'NEUTRAL'}
*XP:* ${agent.xp || 0}

*Base Stats:*
❤️ HP: ${agent.base_hp || 17}/50
⚔️ Attack: ${agent.base_attack || 17}/50
🛡️ Defense: ${agent.base_defense || 17}/50
💥 Claw: ${agent.base_sp_atk || 17}/50
🐚 Shell: ${agent.base_sp_def || 16}/50
⚡ Speed: ${agent.base_speed || 16}/50

*Nature:* ${agent.nature_name || 'Balanced'}
*Ability:* ${agent.ability_name || 'None'}

*Record:* ${wins}W - ${losses}L`;

  if (agent.avatar_url) {
    await sendPhoto(chatId, agent.avatar_url, msg);
  } else {
    await sendMessage(chatId, msg);
  }
}

async function handleBattle(chatId, user) {
  const agent = findAgentByTelegram(user.id);

  if (!agent) {
    await sendMessage(chatId, 'Link your lobster first with /link <code>');
    return;
  }

  const db = getDb();

  // Check match limit
  const { canQueue } = require('./premium');
  const limitCheck = canQueue(db, agent.id);
  if (!limitCheck.allowed) {
    await sendMessage(chatId, `${limitCheck.error}\n\nUpgrade: ${WEB_URL}/premium`);
    return;
  }

  // Check if already in active battle
  const activeBattle = db.prepare(`
    SELECT id FROM battles
    WHERE (agent_a_id = ? OR agent_b_id = ?) AND status = 'active'
  `).get(agent.id, agent.id);

  if (activeBattle) {
    await sendMessage(chatId, `You're already in a battle!\n\nBattle ID: \`${activeBattle.id}\`\nUse /move <1-4> to submit your move.`);
    return;
  }

  // Try to join queue
  const { addToQueue, matchFromQueue, sendWebhook } = require('./battle-engine');
  const result = addToQueue(db, agent.id);

  if (result.status === 'already_queued') {
    await sendMessage(chatId, 'You\'re already in the matchmaking queue. Waiting for an opponent...');
    return;
  }

  if (result.status === 'already_in_battle') {
    await sendMessage(chatId, `You're in an active battle: \`${result.battleId}\`\nUse /move <1-4>`);
    return;
  }

  // Try immediate match
  const battle = matchFromQueue(db);
  if (battle) {
    const { incrementMatchCount } = require('./premium');
    incrementMatchCount(db, battle.agentA.id);
    incrementMatchCount(db, battle.agentB.id);

    const opponentId = battle.agentA.id === agent.id ? battle.agentB.id : battle.agentA.id;
    const opponent = db.prepare('SELECT name, ai_type, level FROM agents WHERE id = ?').get(opponentId);
    const yourSide = battle.agentA.id === agent.id ? 'A' : 'B';
    const yourMoves = yourSide === 'A' ? battle.agentA.moves : battle.agentB.moves;

    const moveButtons = yourMoves.map((m, i) => ({
      text: `${i + 1}. ${m.name} (${m.type})`,
      callback_data: `move_${battle.id}_${m.id}`,
    }));

    // Pair buttons in rows of 2
    const keyboard = [];
    for (let i = 0; i < moveButtons.length; i += 2) {
      const row = [moveButtons[i]];
      if (moveButtons[i + 1]) row.push(moveButtons[i + 1]);
      keyboard.push(row);
    }

    await sendMessage(chatId, `*Battle Found!*

*You:* ${TYPE_EMOJIS[agent.ai_type] || ''} ${agent.name} (Lv ${agent.level || 1})
*Opponent:* ${TYPE_EMOJIS[opponent?.ai_type] || ''} ${opponent?.name || '???'} (Lv ${opponent?.level || 1})

Use /move <1-4> or tap a button:`, {
      reply_markup: JSON.stringify({ inline_keyboard: keyboard }),
    });
    return;
  }

  await sendMessage(chatId, '🔍 *Searching for opponent...*\n\nYou\'ve joined the matchmaking queue. You\'ll be notified when a match is found.');
}

async function handleMove(chatId, user, args) {
  const agent = findAgentByTelegram(user.id);
  if (!agent) {
    await sendMessage(chatId, 'Link your lobster first with /link <code>');
    return;
  }

  const moveNum = parseInt(args[0], 10);
  if (!moveNum || moveNum < 1 || moveNum > 4) {
    await sendMessage(chatId, 'Usage: /move <1-4>');
    return;
  }

  const db = getDb();

  // Find active battle
  const battle = db.prepare(`
    SELECT * FROM battles
    WHERE (agent_a_id = ? OR agent_b_id = ?) AND status = 'active'
  `).get(agent.id, agent.id);

  if (!battle) {
    await sendMessage(chatId, 'You\'re not in an active battle. Use /battle to find one.');
    return;
  }

  const battleState = JSON.parse(battle.state_json);
  const isAgentA = battle.agent_a_id === agent.id;
  const yourMoves = isAgentA ? battleState.agentA.moves : battleState.agentB.moves;

  if (moveNum > yourMoves.length) {
    await sendMessage(chatId, `You only have ${yourMoves.length} moves. Use /move <1-${yourMoves.length}>`);
    return;
  }

  const selectedMove = yourMoves[moveNum - 1];

  // Check PP
  if (selectedMove.currentPP <= 0) {
    await sendMessage(chatId, `${selectedMove.name} has no PP left! Choose another move.`);
    return;
  }

  // Submit move via battle engine
  const alreadyMoved = isAgentA ? battle.agent_a_move : battle.agent_b_move;

  if (alreadyMoved) {
    await sendMessage(chatId, 'You\'ve already submitted a move for this turn. Waiting for opponent...');
    return;
  }

  // Use explicit column updates to prevent SQL injection (no dynamic column names)
  if (isAgentA) {
    db.prepare('UPDATE battles SET agent_a_move = ? WHERE id = ?').run(selectedMove.id, battle.id);
  } else {
    db.prepare('UPDATE battles SET agent_b_move = ? WHERE id = ?').run(selectedMove.id, battle.id);
  }

  // Check if both moves are in
  const updated = db.prepare('SELECT * FROM battles WHERE id = ?').get(battle.id);

  if (updated.agent_a_move && updated.agent_b_move) {
    // Both moves submitted — resolve turn
    const { resolveTurn, saveTurn, applyBattleResults } = require('./battle-engine');
    const updatedState = JSON.parse(updated.state_json);
    const turnResult = resolveTurn(updatedState, updated.agent_a_move, updated.agent_b_move);
    saveTurn(db, battle.id, turnResult);

    updatedState._pendingMoveA = null;
    updatedState._pendingMoveB = null;

    if (updatedState.status === 'finished') {
      const loserId = updatedState.winnerId === battle.agent_a_id ? battle.agent_b_id : battle.agent_a_id;
      applyBattleResults(db, updatedState.winnerId, loserId, battle.id);
      updatedState.currentPhase = 'finished';
    } else {
      updatedState.currentPhase = 'waiting';
    }

    db.prepare(`
      UPDATE battles SET
        agent_a_move = NULL, agent_b_move = NULL,
        turn_number = ?, current_phase = ?, status = ?,
        winner_id = ?, state_json = ?, last_turn_at = ?,
        ended_at = ?
      WHERE id = ?
    `).run(
      updatedState.turnNumber, updatedState.currentPhase,
      updatedState.status, updatedState.winnerId,
      JSON.stringify(updatedState), new Date().toISOString(),
      updatedState.status === 'finished' ? new Date().toISOString() : null,
      battle.id
    );

    // Build turn result message
    const eventText = turnResult.events.map(e => {
      if (e.type === 'damage') return `${e.attackerName} used *${e.moveName}*! ${e.damage} damage${e.effectiveness !== 1 ? ` (${e.effectiveness > 1 ? 'super effective!' : 'not very effective...'})` : ''}`;
      if (e.type === 'miss') return `${e.attackerName} used *${e.moveName}* but missed!`;
      if (e.type === 'status') return `${e.target} is now ${e.status}!`;
      if (e.type === 'battle_end') return '🏁 *Battle Over!*';
      return e.type;
    }).join('\n');

    let resultMsg = `*Turn ${turnResult.turnNumber}:*\n${eventText}\n\nHP: ${isAgentA ? turnResult.agentAHP : turnResult.agentBHP} | Opp: ${isAgentA ? turnResult.agentBHP : turnResult.agentAHP}`;

    if (updatedState.status === 'finished') {
      const won = updatedState.winnerId === agent.id;
      resultMsg += won
        ? '\n\n🏆 *You Win!*'
        : '\n\n💀 *You Lost...*';
    } else {
      resultMsg += '\n\nUse /move <1-4> for next turn!';
    }

    await sendMessage(chatId, resultMsg);

    // Notify opponent if they're on Telegram
    const opponentId = isAgentA ? battle.agent_b_id : battle.agent_a_id;
    const opponent = db.prepare('SELECT telegram_user_id FROM agents WHERE id = ?').get(opponentId);
    if (opponent?.telegram_user_id) {
      const oppMsg = `*Turn ${turnResult.turnNumber}:*\n${eventText}\n\nHP: ${isAgentA ? turnResult.agentBHP : turnResult.agentAHP} | Opp: ${isAgentA ? turnResult.agentAHP : turnResult.agentBHP}`;
      if (updatedState.status === 'finished') {
        const oppWon = updatedState.winnerId === opponentId;
        await sendMessage(opponent.telegram_user_id, oppMsg + (oppWon ? '\n\n🏆 *You Win!*' : '\n\n💀 *You Lost...*'));
      } else {
        await sendMessage(opponent.telegram_user_id, oppMsg + '\n\nYour turn! Use /move <1-4>');
      }
    }
  } else {
    await sendMessage(chatId, `You used *${selectedMove.name}*! Waiting for opponent...`);
  }
}

async function handleStats(chatId, user) {
  const agent = findAgentByTelegram(user.id);

  if (!agent) {
    await sendMessage(chatId, 'No linked lobster. Use /link <code> first.');
    return;
  }

  const wins = agent.total_wins || 0;
  const fights = agent.total_fights || 0;
  const losses = fights - wins;
  const winRate = fights > 0 ? Math.round((wins / fights) * 100) : 0;

  const { getRemainingMatches } = require('./premium');
  const db = getDb();
  const remaining = getRemainingMatches(db, agent.id);

  const msg = `*${agent.name} Stats*

*Level:* ${agent.level || 1}
*XP:* ${agent.xp || 0}

*Battle Record:*
🏆 Wins: ${wins}
❌ Losses: ${losses}
📈 Win Rate: ${winRate}%

*Premium:* ${agent.is_premium ? '✅ Active (Unlimited matches)' : `Free (${remaining !== null ? remaining : '?'}/5 matches remaining today)`}`;

  await sendMessage(chatId, msg);
}

async function handleLeaderboard(chatId) {
  const db = getDb();

  const agents = db.prepare(`
    SELECT name, level, ai_type, total_wins, total_fights, xp
    FROM agents WHERE status = 'active'
    ORDER BY COALESCE(level, 1) DESC,
      CASE WHEN total_fights > 0 THEN CAST(total_wins AS REAL) / total_fights ELSE 0 END DESC,
      total_fights DESC
    LIMIT 10
  `).all();

  let msg = '*🏆 Top 10 Operators*\n\n';

  agents.forEach((a, i) => {
    const emoji = TYPE_EMOJIS[a.ai_type] || '⚪';
    const winRate = a.total_fights > 0 ? Math.round((a.total_wins / a.total_fights) * 100) : 0;
    msg += `${i + 1}. ${emoji} *${a.name}* - Lv${a.level || 1} (${winRate}%)\n`;
  });

  msg += `\nFull leaderboard: ${WEB_URL}/leaderboard.html`;

  await sendMessage(chatId, msg);
}

async function handlePremium(chatId, user) {
  const agent = findAgentByTelegram(user.id);

  if (agent?.is_premium) {
    await sendMessage(chatId, '*✅ Premium Active*\n\nYou have unlimited matches. Expires: ' + (agent.premium_expires_at || 'Never'));
    return;
  }

  await sendMessage(chatId, `*Upgrade to Premium* - $4.99/month

✅ Unlimited matches per day
✅ Priority matchmaking
✅ Exclusive badges

Free tier: 5 matches/day

Upgrade at: ${WEB_URL}/premium`);
}

async function handleLink(chatId, user, args) {
  if (!args[0]) {
    await sendMessage(chatId, `*Link your account:*

1. Go to ${WEB_URL} and create/view your lobster
2. Get your link code from the web dashboard
3. Use: /link <code>

This connects your Telegram to your ClawCombat lobster.`);
    return;
  }

  const code = args[0].trim();
  const db = getDb();

  // Look up link code
  const linkEntry = db.prepare(`
    SELECT * FROM link_codes
    WHERE code = ? AND used = 0 AND expires_at > datetime('now')
  `).get(code);

  if (!linkEntry) {
    await sendMessage(chatId, 'Invalid or expired link code. Get a new one from the web dashboard.');
    return;
  }

  // Link the agent to this Telegram user
  db.prepare('UPDATE agents SET telegram_user_id = ?, telegram_username = ? WHERE id = ?')
    .run(String(user.id), user.username || user.first_name, linkEntry.agent_id);

  // Mark code as used
  db.prepare('UPDATE link_codes SET used = 1 WHERE code = ?').run(code);

  const agent = db.prepare('SELECT name, ai_type FROM agents WHERE id = ?').get(linkEntry.agent_id);

  await sendMessage(chatId, `*✅ Account Linked!*\n\n${TYPE_EMOJIS[agent?.ai_type] || ''} *${agent?.name}* is now connected to your Telegram.\n\nUse /lobster to view, /battle to fight!`);
}

async function handleConnect(chatId, user) {
  // Check if already has a lobster
  const existing = findAgentByTelegram(user.id);
  if (existing) {
    const typeEmoji = TYPE_EMOJIS[existing.ai_type] || '';
    await sendMessage(chatId, `You already have a lobster: ${typeEmoji} *${existing.name}* (Lv ${existing.level || 1})\n\nUse /lobster to view, /battle to fight!`);
    return;
  }

  // Call POST /agents/connect internally
  try {
    const axios_ = require('axios');
    const baseUrl = process.env.BASE_URL || process.env.WEB_URL || 'https://clawcombat.com';
    const resp = await axios_.post(`${baseUrl}/agents/connect`, {
      telegram_user_id: String(user.id),
      telegram_username: user.username || user.first_name || null,
    });

    const data = resp.data;

    if (data.status === 'already_connected') {
      await sendMessage(chatId, `You already have a lobster: ${data.type_emoji} *${data.name}* (Lv ${data.level})\n\nUse /lobster to view, /battle to fight!`);
      return;
    }

    const movesText = data.moves.map((m, i) => `${i + 1}. *${m.name}* (${m.type}, ${m.power || 0} pwr)`).join('\n');

    await sendMessage(chatId, `*Your Lobster is Ready!*

${data.type_emoji} *${data.name}*
*Type:* ${data.type}
*Nature:* ${data.nature.name}
*Ability:* ${data.ability ? data.ability.name : 'None'}

*Moves:*
${movesText}

Your lobster will automatically battle other lobsters. Use /battle to manually queue a fight, or /lobster to check on it!`);
  } catch (e) {
    log.error('/connect error:', { error: e.response?.data || e.message });
    await sendMessage(chatId, 'Failed to create your lobster. Please try again or use /create to make one via the web.');
  }
}

// ---------------------------------------------------------------------------
// Callback query handler (inline button presses)
// ---------------------------------------------------------------------------

async function handleCallbackQuery(callbackQuery) {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const user = callbackQuery.from;

  await answerCallbackQuery(callbackQuery.id);

  // Handle move button press: move_<battleId>_<moveId>
  if (data.startsWith('move_')) {
    const parts = data.split('_');
    const battleId = parts[1];
    const moveId = parts.slice(2).join('_');

    const agent = findAgentByTelegram(user.id);
    if (!agent) return;

    const db = getDb();
    const battle = db.prepare('SELECT * FROM battles WHERE id = ? AND status = ?').get(battleId, 'active');
    if (!battle) {
      await sendMessage(chatId, 'Battle is no longer active.');
      return;
    }

    const isAgentA = battle.agent_a_id === agent.id;
    const moveColumn = isAgentA ? 'agent_a_move' : 'agent_b_move';
    const alreadyMoved = isAgentA ? battle.agent_a_move : battle.agent_b_move;

    if (alreadyMoved) {
      await sendMessage(chatId, 'You\'ve already submitted a move. Waiting for opponent...');
      return;
    }

    db.prepare(`UPDATE battles SET ${moveColumn} = ? WHERE id = ?`).run(moveId, battle.id);

    // Determine move name for display
    const battleState = JSON.parse(battle.state_json);
    const yourMoves = isAgentA ? battleState.agentA.moves : battleState.agentB.moves;
    const selectedMove = yourMoves.find(m => m.id === moveId);

    await editMessageText(chatId, callbackQuery.message.message_id,
      `You chose *${selectedMove?.name || moveId}*! Waiting for opponent...`);

    // Check if both moves in (same logic as handleMove, but simpler - let the API route handle resolution)
    const updated = db.prepare('SELECT * FROM battles WHERE id = ?').get(battle.id);
    if (updated.agent_a_move && updated.agent_b_move) {
      // Trigger resolution via handleMove path
      // For simplicity, just notify - the /move handler or battle tick will resolve
      await sendMessage(chatId, 'Both moves submitted! Resolving turn...');
    }
  }
}

// ---------------------------------------------------------------------------
// Main update processor
// ---------------------------------------------------------------------------

async function processUpdate(update) {
  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return;
    }

    if (!update.message || !update.message.text) return;

    const chatId = update.message.chat.id;
    const user = update.message.from;
    const text = update.message.text.trim();

    // Parse command and args
    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase().replace(/@\w+$/, ''); // Remove @botname suffix
    const args = parts.slice(1);

    switch (command) {
      case '/start':
        await handleStart(chatId, user);
        break;
      case '/help':
        await handleHelp(chatId);
        break;
      case '/create':
        await handleCreate(chatId, user);
        break;
      case '/lobster':
        await handleLobster(chatId, user);
        break;
      case '/battle':
        await handleBattle(chatId, user);
        break;
      case '/move':
        await handleMove(chatId, user, args);
        break;
      case '/stats':
        await handleStats(chatId, user);
        break;
      case '/leaderboard':
        await handleLeaderboard(chatId);
        break;
      case '/premium':
        await handlePremium(chatId, user);
        break;
      case '/link':
        await handleLink(chatId, user, args);
        break;
      case '/connect':
        await handleConnect(chatId, user);
        break;
      default:
        // Ignore non-commands
        break;
    }
  } catch (e) {
    log.error('Update processing error:', { error: e.message });
  }
}

// ---------------------------------------------------------------------------
// Webhook setup
// ---------------------------------------------------------------------------

async function setWebhook(url) {
  if (!BOT_TOKEN) {
    log.info('No bot token, skipping webhook setup');
    return;
  }
  try {
    const resp = await axios.post(`${API_BASE}/setWebhook`, { url });
    log.info('Webhook set', { url, data: resp.data });
  } catch (e) {
    log.error('setWebhook error:', { error: e.message });
  }
}

async function deleteWebhook() {
  if (!BOT_TOKEN) return;
  try {
    await axios.post(`${API_BASE}/deleteWebhook`);
    log.info('Webhook deleted');
  } catch (e) { log.error('deleteWebhook error:', { error: e.message }); }
}

module.exports = {
  processUpdate,
  setWebhook,
  deleteWebhook,
  sendMessage,
};
