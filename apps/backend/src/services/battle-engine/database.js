/**
 * Battle Engine Database
 * Schema initialization and CRUD operations for battles
 */

'use strict';

const log = require('../../utils/logger').createLogger('BATTLE_ENGINE');

const { initializeBattleState } = require('./core');
const { applyAbilityEffects } = require('./effects');

// ============================================================================
// DATABASE SCHEMA & OPERATIONS
// ============================================================================

function initBattleSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS battles (
      id TEXT PRIMARY KEY,
      agent_a_id TEXT NOT NULL,
      agent_b_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      winner_id TEXT,
      turn_number INTEGER DEFAULT 0,
      current_phase TEXT DEFAULT 'waiting',
      agent_a_move TEXT,
      agent_b_move TEXT,
      state_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      ended_at DATETIME,
      last_turn_at DATETIME,
      FOREIGN KEY(agent_a_id) REFERENCES agents(id),
      FOREIGN KEY(agent_b_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS battle_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id TEXT NOT NULL,
      turn_number INTEGER NOT NULL,
      move_a TEXT,
      move_b TEXT,
      events_json TEXT,
      agent_a_hp INTEGER,
      agent_b_hp INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(battle_id) REFERENCES battles(id)
    );

    CREATE TABLE IF NOT EXISTS battle_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL UNIQUE,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(agent_id) REFERENCES agents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_battles_status ON battles(status);
    CREATE INDEX IF NOT EXISTS idx_battles_agent_a ON battles(agent_a_id);
    CREATE INDEX IF NOT EXISTS idx_battles_agent_b ON battles(agent_b_id);
    CREATE INDEX IF NOT EXISTS idx_battles_winner ON battles(winner_id);
    CREATE INDEX IF NOT EXISTS idx_battles_ended ON battles(ended_at);
    CREATE INDEX IF NOT EXISTS idx_battles_last_turn ON battles(last_turn_at);
    CREATE INDEX IF NOT EXISTS idx_battles_created_at ON battles(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_battle_turns_battle ON battle_turns(battle_id);
    CREATE INDEX IF NOT EXISTS idx_battle_turns_compound ON battle_turns(battle_id, turn_number);
    CREATE INDEX IF NOT EXISTS idx_battle_queue_joined ON battle_queue(joined_at);
  `);

  // Migration: add battle_number column
  try { db.exec('ALTER TABLE battles ADD COLUMN battle_number INTEGER'); } catch (e) { /* already exists */ }
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_battles_number ON battles(battle_number)'); } catch (e) { /* */ }

  // Backfill existing battles that don't have a battle_number
  const unNumbered = db.prepare('SELECT COUNT(*) as c FROM battles WHERE battle_number IS NULL').get();
  if (unNumbered.c > 0) {
    const rows = db.prepare('SELECT id FROM battles WHERE battle_number IS NULL ORDER BY created_at ASC, rowid ASC').all();
    const maxNum = db.prepare('SELECT COALESCE(MAX(battle_number), 0) as m FROM battles').get().m;
    const update = db.prepare('UPDATE battles SET battle_number = ? WHERE id = ?');
    const backfill = db.transaction(() => {
      rows.forEach((row, i) => update.run(maxNum + i + 1, row.id));
    });
    backfill();
    log.info('Backfilled battles with sequential numbers', { count: rows.length });
  }
}

function createBattle(db, agentA, agentB) {
  const battleState = initializeBattleState(agentA, agentB, applyAbilityEffects);

  const nextNum = (db.prepare('SELECT COALESCE(MAX(battle_number), 0) + 1 as n FROM battles').get()).n;
  const stmt = db.prepare(`
    INSERT INTO battles (id, agent_a_id, agent_b_id, status, turn_number, current_phase, state_json, started_at, last_turn_at, battle_number)
    VALUES (?, ?, ?, 'active', 0, 'waiting', ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  stmt.run(battleState.id, agentA.id, agentB.id, JSON.stringify(battleState), now, now, nextNum);

  battleState.battleNumber = nextNum;
  return battleState;
}

function saveBattle(db, battleState) {
  const stmt = db.prepare(`
    UPDATE battles SET
      status = ?,
      winner_id = ?,
      turn_number = ?,
      current_phase = ?,
      agent_a_move = ?,
      agent_b_move = ?,
      state_json = ?,
      ended_at = ?,
      last_turn_at = ?
    WHERE id = ?
  `);
  stmt.run(
    battleState.status,
    battleState.winnerId,
    battleState.turnNumber,
    battleState.currentPhase || 'waiting',
    battleState._pendingMoveA || null,
    battleState._pendingMoveB || null,
    JSON.stringify(battleState),
    battleState.status === 'finished' ? new Date().toISOString() : null,
    battleState.lastMoveAt,
    battleState.id
  );
}

function saveTurn(db, battleId, turnData) {
  const stmt = db.prepare(`
    INSERT INTO battle_turns (battle_id, turn_number, move_a, move_b, events_json, agent_a_hp, agent_b_hp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    battleId,
    turnData.turnNumber,
    turnData.moveA,
    turnData.moveB,
    JSON.stringify(turnData.events),
    turnData.agentAHP,
    turnData.agentBHP
  );
}

function loadBattle(db, battleId) {
  const row = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId);
  if (!row) return null;
  const battleState = JSON.parse(row.state_json);
  battleState._dbRow = row;
  return battleState;
}

function getBattleHistory(db, battleId) {
  return db.prepare('SELECT * FROM battle_turns WHERE battle_id = ? ORDER BY turn_number ASC').all(battleId);
}

module.exports = {
  initBattleSchema,
  createBattle,
  saveBattle,
  saveTurn,
  loadBattle,
  getBattleHistory,
};
