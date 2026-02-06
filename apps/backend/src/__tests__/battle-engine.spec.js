/**
 * ClawCombat Battle Engine Unit Tests
 * Tests core battle mechanics, damage calculations, and state management
 */

const {
  TYPES,
  MOVES_BY_TYPE,
  TYPE_CHART,
  STATUS_EFFECTS,
  ABILITIES,
  STAT_STAGE_TABLE,
  initializeBattleState,
  buildAgentBattleState,
  calculateMaxHP,
  getTypeEffectiveness,
  getStatStageMod,
  checkBattleEnd,
  resolveTurn,
  getEffectiveSpeed,
  mapDbAgent,
} = require('../services/battle-engine');

describe('Battle Engine Core', () => {
  describe('TYPES', () => {
    test('contains all 18 types', () => {
      expect(TYPES).toHaveLength(18);
      expect(TYPES).toContain('NEUTRAL');
      expect(TYPES).toContain('FIRE');
      expect(TYPES).toContain('WATER');
      expect(TYPES).toContain('ELECTRIC');
      expect(TYPES).toContain('GRASS');
      expect(TYPES).toContain('DRAGON');
      expect(TYPES).toContain('MYSTIC');
    });
  });

  describe('TYPE_CHART', () => {
    test('exists and has entries for all types', () => {
      expect(TYPE_CHART).toBeDefined();
      TYPES.forEach(type => {
        expect(TYPE_CHART[type]).toBeDefined();
      });
    });

    test('returns expected effectiveness for classic matchups', () => {
      // Fire > Grass
      expect(TYPE_CHART['FIRE']['GRASS']).toBe(2.0);
      // Water > Fire
      expect(TYPE_CHART['WATER']['FIRE']).toBe(2.0);
      // Grass > Water
      expect(TYPE_CHART['GRASS']['WATER']).toBe(2.0);
      // Electric > Water
      expect(TYPE_CHART['ELECTRIC']['WATER']).toBe(2.0);
    });

    test('returns resistances correctly', () => {
      // Fire resists Fire
      expect(TYPE_CHART['FIRE']['FIRE']).toBe(0.5);
      // Water resists Water
      expect(TYPE_CHART['WATER']['WATER']).toBe(0.5);
    });
  });

  describe('getTypeEffectiveness', () => {
    test('returns correct multiplier for super effective', () => {
      expect(getTypeEffectiveness('FIRE', 'GRASS')).toBe(2.0);
      expect(getTypeEffectiveness('WATER', 'FIRE')).toBe(2.0);
    });

    test('returns correct multiplier for not very effective', () => {
      expect(getTypeEffectiveness('FIRE', 'WATER')).toBe(0.5);
      expect(getTypeEffectiveness('GRASS', 'FIRE')).toBe(0.5);
    });

    test('returns 1.0 for neutral matchups', () => {
      expect(getTypeEffectiveness('NEUTRAL', 'NEUTRAL')).toBe(1.0);
    });

    test('returns 1.0 for invalid types', () => {
      expect(getTypeEffectiveness('INVALID', 'FIRE')).toBe(1.0);
      expect(getTypeEffectiveness('FIRE', 'INVALID')).toBe(1.0);
    });
  });

  describe('getStatStageMod', () => {
    test('returns 1.0 for stage 0', () => {
      expect(getStatStageMod(0)).toBe(1.0);
    });

    test('returns correct values for positive stages', () => {
      expect(getStatStageMod(1)).toBe(1.5);
      expect(getStatStageMod(2)).toBe(2.0);
      expect(getStatStageMod(6)).toBe(4.0);
    });

    test('returns correct values for negative stages', () => {
      expect(getStatStageMod(-1)).toBe(0.67);
      expect(getStatStageMod(-2)).toBe(0.50);
      expect(getStatStageMod(-6)).toBe(0.25);
    });

    test('clamps values beyond -6 and +6', () => {
      expect(getStatStageMod(-10)).toBe(0.25);
      expect(getStatStageMod(10)).toBe(4.0);
    });
  });

  describe('calculateMaxHP', () => {
    test('calculates HP for level 1 with no EVs', () => {
      const hp = calculateMaxHP(20, 1, 0);
      expect(hp).toBeGreaterThan(0);
      expect(hp).toBeLessThan(100);
    });

    test('HP increases with level', () => {
      const hp1 = calculateMaxHP(20, 1, 0);
      const hp50 = calculateMaxHP(20, 50, 0);
      const hp100 = calculateMaxHP(20, 100, 0);

      expect(hp50).toBeGreaterThan(hp1);
      expect(hp100).toBeGreaterThan(hp50);
    });

    test('HP increases with EVs', () => {
      const hpNoEv = calculateMaxHP(20, 50, 0);
      const hpWithEv = calculateMaxHP(20, 50, 252);

      expect(hpWithEv).toBeGreaterThan(hpNoEv);
    });

    test('HP increases with base stat', () => {
      const hpLow = calculateMaxHP(10, 50, 0);
      const hpHigh = calculateMaxHP(30, 50, 0);

      expect(hpHigh).toBeGreaterThan(hpLow);
    });
  });
});

describe('Battle State Management', () => {
  const createMockAgent = (overrides = {}) => ({
    id: 'test-agent-' + Math.random().toString(36).substr(2, 9),
    name: 'TestAgent',
    type: 'FIRE',
    ai_type: 'FIRE',
    level: 50,
    base_hp: 20,
    base_attack: 18,
    base_defense: 16,
    base_sp_atk: 18,
    base_sp_def: 14,
    base_speed: 14,
    attack: 18,
    defense: 16,
    sp_atk: 18,
    sp_def: 14,
    speed: 14,
    ability: null,
    moves: [],
    ev_hp: 0,
    ev_attack: 0,
    ev_defense: 0,
    ev_sp_atk: 0,
    ev_sp_def: 0,
    ev_speed: 0,
    ...overrides
  });

  describe('mapDbAgent', () => {
    test('maps ai_type to type', () => {
      const row = { id: '1', name: 'Test', ai_type: 'WATER' };
      const mapped = mapDbAgent(row);
      expect(mapped.type).toBe('WATER');
    });

    test('maps base_* stats to engine stat names', () => {
      const row = {
        id: '1',
        name: 'Test',
        base_attack: 25,
        base_defense: 20,
        base_sp_atk: 22,
        base_sp_def: 18,
        base_speed: 30
      };
      const mapped = mapDbAgent(row);
      expect(mapped.attack).toBe(25);
      expect(mapped.defense).toBe(20);
      expect(mapped.sp_atk).toBe(22);
      expect(mapped.sp_def).toBe(18);
      expect(mapped.speed).toBe(30);
    });

    test('maps ability_name to ability', () => {
      const row = { id: '1', name: 'Test', ability_name: 'Blaze' };
      const mapped = mapDbAgent(row);
      expect(mapped.ability).toBe('Blaze');
    });

    test('returns null for null input', () => {
      expect(mapDbAgent(null)).toBeNull();
    });

    test('uses defaults for missing values', () => {
      const row = { id: '1', name: 'Test' };
      const mapped = mapDbAgent(row);
      expect(mapped.type).toBe('NEUTRAL');
      expect(mapped.attack).toBe(50);
      expect(mapped.defense).toBe(50);
    });
  });

  describe('buildAgentBattleState', () => {
    test('creates valid battle state from agent', () => {
      const agent = createMockAgent();
      const state = buildAgentBattleState(agent);

      expect(state.id).toBe(agent.id);
      expect(state.name).toBe(agent.name);
      expect(state.type).toBe(agent.type);
      expect(state.level).toBe(agent.level);
      expect(state.maxHP).toBeGreaterThan(0);
      expect(state.currentHP).toBe(state.maxHP);
      expect(state.status).toBeNull();
      expect(state.statStages).toEqual({ attack: 0, defense: 0, sp_atk: 0, sp_def: 0, speed: 0 });
    });

    test('assigns default moves if agent has none', () => {
      const agent = createMockAgent({ moves: [] });
      const state = buildAgentBattleState(agent);

      expect(state.moves.length).toBeGreaterThan(0);
    });

    test('initializes tracking flags correctly', () => {
      const agent = createMockAgent();
      const state = buildAgentBattleState(agent);

      expect(state.sturdyUsed).toBe(false);
      expect(state.wishPending).toBe(false);
      expect(state.leechSeeded).toBe(false);
      expect(state.cursed).toBe(false);
      expect(state.flinched).toBe(false);
    });

    test('calculates effective stats based on level', () => {
      const lowLevel = createMockAgent({ level: 10 });
      const highLevel = createMockAgent({ level: 100 });

      const lowState = buildAgentBattleState(lowLevel);
      const highState = buildAgentBattleState(highLevel);

      expect(highState.effectiveStats.attack).toBeGreaterThan(lowState.effectiveStats.attack);
    });

    test('includes evolution tier info', () => {
      const agent = createMockAgent({ level: 50 });
      const state = buildAgentBattleState(agent);

      expect(state.evolutionTier).toBeDefined();
      expect(state.evolutionName).toBeDefined();
    });
  });

  describe('initializeBattleState', () => {
    test('creates battle with two agents', () => {
      const agentA = createMockAgent({ name: 'AgentA', type: 'FIRE' });
      const agentB = createMockAgent({ name: 'AgentB', type: 'WATER' });

      const battle = initializeBattleState(agentA, agentB);

      expect(battle.id).toBeDefined();
      expect(battle.agentA.name).toBe('AgentA');
      expect(battle.agentB.name).toBe('AgentB');
      expect(battle.turnNumber).toBe(0);
      expect(battle.status).toBe('active');
      expect(battle.winnerId).toBeNull();
    });

    test('initializes both agents with full HP', () => {
      const agentA = createMockAgent();
      const agentB = createMockAgent();

      const battle = initializeBattleState(agentA, agentB);

      expect(battle.agentA.currentHP).toBe(battle.agentA.maxHP);
      expect(battle.agentB.currentHP).toBe(battle.agentB.maxHP);
    });

    test('sets phase to waiting', () => {
      const agentA = createMockAgent();
      const agentB = createMockAgent();

      const battle = initializeBattleState(agentA, agentB);

      expect(battle.currentPhase).toBe('waiting');
    });

    test('records start time', () => {
      const agentA = createMockAgent();
      const agentB = createMockAgent();

      const battle = initializeBattleState(agentA, agentB);

      expect(battle.startedAt).toBeDefined();
      expect(new Date(battle.startedAt)).toBeInstanceOf(Date);
    });
  });

  describe('checkBattleEnd', () => {
    test('returns false when both agents have HP', () => {
      const agentA = createMockAgent();
      const agentB = createMockAgent();
      const battle = initializeBattleState(agentA, agentB);

      const result = checkBattleEnd(battle);
      expect(result).toBe(false);
      expect(battle.status).toBe('active');
    });

    test('returns true and sets agent A as winner when agent B has 0 HP', () => {
      const agentA = createMockAgent({ name: 'Winner' });
      const agentB = createMockAgent({ name: 'Loser' });
      const battle = initializeBattleState(agentA, agentB);

      battle.agentB.currentHP = 0;
      const result = checkBattleEnd(battle);

      expect(result).toBe(true);
      expect(battle.status).toBe('finished');
      expect(battle.winnerId).toBe(battle.agentA.id);
    });

    test('returns true and sets agent B as winner when agent A has 0 HP', () => {
      const agentA = createMockAgent({ name: 'Loser' });
      const agentB = createMockAgent({ name: 'Winner' });
      const battle = initializeBattleState(agentA, agentB);

      battle.agentA.currentHP = 0;
      const result = checkBattleEnd(battle);

      expect(result).toBe(true);
      expect(battle.status).toBe('finished');
      expect(battle.winnerId).toBe(battle.agentB.id);
    });
  });
});

describe('Turn Resolution', () => {
  const createMockAgent = (overrides = {}) => ({
    id: 'test-' + Math.random().toString(36).substr(2, 9),
    name: 'TestAgent',
    type: 'NEUTRAL',
    ai_type: 'NEUTRAL',
    level: 50,
    base_hp: 20,
    base_attack: 18,
    base_defense: 16,
    base_sp_atk: 18,
    base_sp_def: 14,
    base_speed: 14,
    attack: 18,
    defense: 16,
    sp_atk: 18,
    sp_def: 14,
    speed: 14,
    ability: null,
    moves: [],
    ev_hp: 0,
    ev_attack: 0,
    ev_defense: 0,
    ev_sp_atk: 0,
    ev_sp_def: 0,
    ev_speed: 0,
    ...overrides
  });

  describe('resolveTurn', () => {
    test('increments turn number', () => {
      const agentA = createMockAgent();
      const agentB = createMockAgent();
      const battle = initializeBattleState(agentA, agentB);

      const moveA = battle.agentA.moves[0].id;
      const moveB = battle.agentB.moves[0].id;

      const turnLog = resolveTurn(battle, moveA, moveB);

      expect(turnLog.turnNumber).toBe(1);
      expect(battle.turnNumber).toBe(1);
    });

    test('returns turn log with events array', () => {
      const agentA = createMockAgent();
      const agentB = createMockAgent();
      const battle = initializeBattleState(agentA, agentB);

      const moveA = battle.agentA.moves[0].id;
      const moveB = battle.agentB.moves[0].id;

      const turnLog = resolveTurn(battle, moveA, moveB);

      expect(Array.isArray(turnLog.events)).toBe(true);
      expect(turnLog.events.length).toBeGreaterThan(0);
    });

    test('records HP values after turn', () => {
      const agentA = createMockAgent();
      const agentB = createMockAgent();
      const battle = initializeBattleState(agentA, agentB);

      const moveA = battle.agentA.moves[0].id;
      const moveB = battle.agentB.moves[0].id;

      const turnLog = resolveTurn(battle, moveA, moveB);

      expect(typeof turnLog.agentAHP).toBe('number');
      expect(typeof turnLog.agentBHP).toBe('number');
    });

    test('battle ends when HP reaches 0', () => {
      const agentA = createMockAgent({ base_attack: 100 }); // High attack
      const agentB = createMockAgent({ base_hp: 5, base_defense: 1 }); // Low HP/defense
      const battle = initializeBattleState(agentA, agentB);

      // Run turns until battle ends
      let turns = 0;
      while (battle.status === 'active' && turns < 50) {
        const moveA = battle.agentA.moves[0].id;
        const moveB = battle.agentB.moves[0].id;
        resolveTurn(battle, moveA, moveB);
        turns++;
      }

      expect(battle.status).toBe('finished');
      expect(battle.winnerId).toBeDefined();
    });
  });

  describe('getEffectiveSpeed', () => {
    test('returns base speed modified by stat stages', () => {
      const agent = createMockAgent({ base_speed: 100 });
      const battle = initializeBattleState(agent, createMockAgent());

      const baseSpeed = getEffectiveSpeed(battle.agentA);

      // Increase speed stage
      battle.agentA.statStages.speed = 2;
      const boostedSpeed = getEffectiveSpeed(battle.agentA);

      expect(boostedSpeed).toBeGreaterThan(baseSpeed);
    });

    test('applies paralysis speed reduction', () => {
      const agent = createMockAgent({ base_speed: 100 });
      const battle = initializeBattleState(agent, createMockAgent());

      const normalSpeed = getEffectiveSpeed(battle.agentA);

      battle.agentA.status = 'paralysis';
      const paralyzedSpeed = getEffectiveSpeed(battle.agentA);

      expect(paralyzedSpeed).toBeLessThan(normalSpeed);
    });
  });
});

describe('Status Effects', () => {
  describe('STATUS_EFFECTS object', () => {
    test('contains all major status effects', () => {
      expect(STATUS_EFFECTS.burned).toBeDefined();
      expect(STATUS_EFFECTS.paralysis).toBeDefined();
      expect(STATUS_EFFECTS.poison).toBeDefined();
      expect(STATUS_EFFECTS.freeze).toBeDefined();
      expect(STATUS_EFFECTS.confusion).toBeDefined();
    });

    test('burn has damage on turn end', () => {
      const mockAgent = { name: 'Test', maxHP: 100, currentHP: 100 };
      const result = STATUS_EFFECTS.burned.onTurnEnd(mockAgent);

      expect(result.damage).toBeGreaterThan(0);
      expect(result.message).toContain('burn');
    });

    test('burn reduces physical damage', () => {
      const mockAgent = { name: 'Test' };
      const physicalMove = { category: 'physical' };
      const specialMove = { category: 'special' };

      const physResult = STATUS_EFFECTS.burned.onAttack(mockAgent, physicalMove);
      const specResult = STATUS_EFFECTS.burned.onAttack(mockAgent, specialMove);

      expect(physResult.damageMod).toBe(0.5);
      expect(specResult.damageMod).toBeUndefined();
    });

    test('paralysis has speed modifier', () => {
      // Balanced: -25% speed (0.75) instead of -50% (0.5)
      expect(STATUS_EFFECTS.paralysis.speedMod).toBe(0.75);
    });

    test('poison deals damage based on HP', () => {
      const mockAgent = { name: 'Test', maxHP: 120, currentHP: 100 };
      const result = STATUS_EFFECTS.poison.onTurnEnd(mockAgent);

      expect(result.damage).toBe(10); // 1/12 of 120 = 10
      expect(result.message).toContain('poison');
    });
  });
});

describe('Abilities', () => {
  describe('ABILITIES object', () => {
    test('contains abilities for all types', () => {
      const abilityTypes = new Set(Object.values(ABILITIES).map(a => a.type));

      expect(abilityTypes.has('FIRE')).toBe(true);
      expect(abilityTypes.has('WATER')).toBe(true);
      expect(abilityTypes.has('ELECTRIC')).toBe(true);
      expect(abilityTypes.has('GRASS')).toBe(true);
      expect(abilityTypes.has('DRAGON')).toBe(true);
    });

    test('each ability has required properties', () => {
      Object.entries(ABILITIES).forEach(([name, ability]) => {
        expect(ability.type).toBeDefined();
        expect(ability.description).toBeDefined();
        expect(ability.trigger).toBeDefined();
      });
    });

    test('Blaze has correct configuration', () => {
      expect(ABILITIES.Blaze.type).toBe('FIRE');
      expect(ABILITIES.Blaze.trigger).toBe('damage_calc');
      expect(ABILITIES.Blaze.description).toContain('30%');
    });

    test('Sturdy has before_faint trigger', () => {
      expect(ABILITIES.Sturdy.trigger).toBe('before_faint');
    });

    test('Intimidate has battle_start trigger', () => {
      expect(ABILITIES.Intimidate.trigger).toBe('battle_start');
    });
  });
});

describe('Moves By Type', () => {
  describe('MOVES_BY_TYPE', () => {
    test('exists for all combat types', () => {
      TYPES.forEach(type => {
        expect(MOVES_BY_TYPE[type]).toBeDefined();
        expect(Array.isArray(MOVES_BY_TYPE[type])).toBe(true);
      });
    });

    test('each type has at least 4 moves', () => {
      TYPES.forEach(type => {
        expect(MOVES_BY_TYPE[type].length).toBeGreaterThanOrEqual(4);
      });
    });

    test('moves have required properties', () => {
      Object.values(MOVES_BY_TYPE).flat().forEach(move => {
        expect(move.id).toBeDefined();
        expect(move.name).toBeDefined();
        expect(move.type).toBeDefined();
        expect(typeof move.power).toBe('number');
        expect(typeof move.accuracy).toBe('number');
        expect(move.pp).toBeDefined();
        expect(move.category).toMatch(/^(physical|special|status)$/);
      });
    });

    test('fire moves include Flamethrower', () => {
      const fireMove = MOVES_BY_TYPE.FIRE.find(m => m.name === 'Flamethrower');
      expect(fireMove).toBeDefined();
      expect(fireMove.type).toBe('FIRE');
    });
  });
});
