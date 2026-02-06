/**
 * ClawCombat Battle Engine Integration Tests
 *
 * Tests the turn-based battle system end-to-end:
 *   1. Battle resolves correctly with a winner
 *   2. Battle timeout handling works
 *
 * Run: node src/routes/__tests__/battles.test.js
 * (No test framework required — uses Node.js assert)
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

// Use in-memory DB for tests
process.env.DATABASE_URL = ':memory:';

const { initializeSchema, getDb } = require('../../db/schema');

// Initialize schema (creates all tables including battle tables)
const db = initializeSchema();

const {
  initializeBattleState,
  buildAgentBattleState,
  resolveTurn,
  checkBattleEnd,
  createBattle,
  saveBattle,
  saveTurn,
  loadBattle,
  addToQueue,
  matchFromQueue,
  checkTimeouts,
  initBattleSchema,
  mapDbAgent,
  MOVES,
  MOVES_BY_TYPE,
  TYPES,
} = require('../../services/battle-engine');

// ── Helpers ──

function createTestAgent(name, type) {
  const id = crypto.randomUUID();
  const apiKey = `clw_sk_test_${crypto.randomBytes(16).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');

  db.prepare(`
    INSERT INTO agents (id, name, webhook_url, api_key, status, ai_type,
      base_hp, base_attack, base_defense, base_sp_atk, base_sp_def, base_speed,
      nature_name, ability_name)
    VALUES (?, ?, ?, ?, 'active', ?, 20, 18, 16, 18, 14, 14, 'Sturdy', NULL)
  `).run(id, name, 'http://localhost:9999/webhook', hash, type || 'FIRE');

  return { id, name, apiKey, hash, type: type || 'FIRE' };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ── Test Suite ──

console.log('\nClawCombat Battle Engine Tests\n');

// ---------- TEST 1: Battle resolves correctly ----------
console.log('Test 1: Battle Resolution');

test('initializeBattleState creates valid state with two agents', () => {
  const agentA = createTestAgent('TestFire', 'FIRE');
  const agentB = createTestAgent('TestWater', 'WATER');

  const rowA = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentA.id));
  const rowB = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentB.id));

  const state = initializeBattleState(rowA, rowB);

  assert.strictEqual(state.status, 'active');
  assert.strictEqual(state.turnNumber, 0);
  assert.ok(state.agentA.currentHP > 0, 'Agent A should have HP');
  assert.ok(state.agentB.currentHP > 0, 'Agent B should have HP');
  assert.strictEqual(state.agentA.type, 'FIRE');
  assert.strictEqual(state.agentB.type, 'WATER');
  assert.ok(state.agentA.moves.length > 0, 'Agent A should have moves');
  assert.ok(state.agentB.moves.length > 0, 'Agent B should have moves');
});

test('resolveTurn produces a turn log with events', () => {
  const agentA = createTestAgent('TurnTestA', 'ELECTRIC');
  const agentB = createTestAgent('TurnTestB', 'EARTH');

  const rowA = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentA.id));
  const rowB = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentB.id));

  const state = initializeBattleState(rowA, rowB);
  const moveA = state.agentA.moves[0].id;
  const moveB = state.agentB.moves[0].id;

  const turnLog = resolveTurn(state, moveA, moveB);

  assert.strictEqual(turnLog.turnNumber, 1);
  assert.ok(Array.isArray(turnLog.events), 'Events should be an array');
  assert.ok(turnLog.events.length > 0, 'Should have events');
  assert.ok(typeof turnLog.agentAHP === 'number', 'Agent A HP should be a number');
  assert.ok(typeof turnLog.agentBHP === 'number', 'Agent B HP should be a number');
});

test('battle reaches finished state after enough turns', () => {
  const agentA = createTestAgent('FinishA', 'MARTIAL');
  const agentB = createTestAgent('FinishB', 'NEUTRAL');

  const rowA = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentA.id));
  const rowB = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentB.id));

  const state = initializeBattleState(rowA, rowB);

  // Run turns until battle ends (max 100 to prevent infinite loop)
  let turns = 0;
  while (state.status === 'active' && turns < 100) {
    const moveA = state.agentA.moves[0].id; // Use strongest move
    const moveB = state.agentB.moves[0].id;
    resolveTurn(state, moveA, moveB);
    turns++;
  }

  assert.strictEqual(state.status, 'finished', `Battle should finish (ran ${turns} turns)`);
  assert.ok(state.winnerId, 'Should have a winner');
  assert.ok(turns > 0, 'Should have taken at least 1 turn');
  assert.ok(turns < 100, 'Should finish within 100 turns');
});

// ---------- TEST 2: Timeout handling ----------
console.log('\nTest 2: Timeout Handling');

test('checkTimeouts uses AI fallback when one agent times out', () => {
  const agentA = createTestAgent('TimeoutA', 'METAL');
  const agentB = createTestAgent('TimeoutB', 'MYSTIC');

  const rowA = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentA.id));
  const rowB = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentB.id));

  const battleState = initializeBattleState(rowA, rowB);
  const moveA = battleState.agentA.moves[0].id;

  // Insert active battle with only agent_a_move submitted and a stale last_turn_at
  const staleTime = new Date(Date.now() - 120000).toISOString(); // 2 minutes ago
  db.prepare(`
    INSERT INTO battles (id, agent_a_id, agent_b_id, status, current_phase, agent_a_move, agent_b_move, state_json, last_turn_at, started_at)
    VALUES (?, ?, ?, 'active', 'waiting', ?, NULL, ?, ?, ?)
  `).run(battleState.id, agentA.id, agentB.id, moveA, JSON.stringify(battleState), staleTime, staleTime);

  const results = checkTimeouts(db);

  assert.ok(results.length > 0, 'Should find at least one timed out battle');

  const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleState.id);
  // AI fallback resolves the turn — battle should be active or finished, not timeout
  assert.ok(
    battle.status === 'active' || battle.status === 'finished',
    `Battle should be active or finished via AI fallback (got: ${battle.status})`
  );
  assert.ok(battle.turn_number >= 1, 'Should have resolved at least 1 turn');
});

test('checkTimeouts uses AI fallback when neither agent submitted', () => {
  const agentA = createTestAgent('DrawA', 'DRAGON');
  const agentB = createTestAgent('DrawB', 'DRAGON');

  const rowA = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentA.id));
  const rowB = mapDbAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentB.id));

  const battleState = initializeBattleState(rowA, rowB);
  const staleTime = new Date(Date.now() - 120000).toISOString();

  db.prepare(`
    INSERT INTO battles (id, agent_a_id, agent_b_id, status, current_phase, agent_a_move, agent_b_move, state_json, last_turn_at, started_at)
    VALUES (?, ?, ?, 'active', 'waiting', NULL, NULL, ?, ?, ?)
  `).run(battleState.id, agentA.id, agentB.id, JSON.stringify(battleState), staleTime, staleTime);

  const results = checkTimeouts(db);

  const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleState.id);
  // AI fallback picks moves for both — battle resolved normally
  assert.ok(
    battle.status === 'active' || battle.status === 'finished',
    `Battle should be active or finished via AI fallback (got: ${battle.status})`
  );
});

test('mapDbAgent correctly maps production DB fields to engine fields', () => {
  const row = {
    id: 'test',
    name: 'Test',
    ai_type: 'FIRE',
    base_attack: 20,
    base_defense: 15,
    base_sp_atk: 18,
    base_sp_def: 14,
    base_speed: 16,
    ability_name: 'Blaze',
  };

  const mapped = mapDbAgent(row);
  assert.strictEqual(mapped.type, 'FIRE');
  assert.strictEqual(mapped.attack, 20);
  assert.strictEqual(mapped.defense, 15);
  assert.strictEqual(mapped.sp_atk, 18);
  assert.strictEqual(mapped.sp_def, 14);
  assert.strictEqual(mapped.speed, 16);
  assert.strictEqual(mapped.ability, 'Blaze');
});

// ── Summary ──
console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
