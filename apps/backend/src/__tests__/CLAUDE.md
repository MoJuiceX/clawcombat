# Tests

Jest unit and integration tests. 110 tests across all modules.

## Prompting Context

When working on tests, Claude should act as a **quality assurance engineer** focused on:
- Edge case coverage and boundary testing
- Mock patterns for database and external services
- Test isolation and deterministic results
- Regression prevention for game-critical logic

### Good Prompts for Test Work
- "Add tests for the new tournament bracket system"
- "The XP calculator tests don't cover level 99→100 boundary - add coverage"
- "This critical bug wasn't caught by tests - help me write a regression test"

### Questions Claude Should Ask
- What edge cases exist? (zero, negative, max values)
- Should this mock the database or use real data?
- What's the deterministic way to test random behavior?
- Is this a unit test (*.spec.js) or integration test (*.test.js)?

## Commands

```bash
npm test                    # Run all 110 tests
npm test -- --watch        # Watch mode (re-run on changes)
npm test -- battle         # Run tests matching "battle"
npm test -- --coverage     # Generate coverage report
npm test -- --verbose      # Show individual test names
DEBUG_TESTS=1 npm test     # Enable console output in tests
```

## File Naming Convention

| Pattern | Type | Example |
|---------|------|---------|
| `*.spec.js` | Unit tests | `battle-engine.spec.js` |
| `*.test.js` | Integration tests | `api.test.js` |

## Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `battle-engine.spec.js` | 45 | Damage calc, type effectiveness, STAB, crits |
| `battle-xp-config.spec.js` | 20 | XP brackets, level-up logic |
| `auth.spec.js` | 15 | All middleware paths (401, 403, success) |
| `elo.spec.js` | 10 | ELO calculations, K-factors |
| `type-system.spec.js` | 12 | Type matrix, immunities |
| `achievements.spec.js` | 8 | Badge unlock conditions |

## Test Setup (`setup.js`)

```javascript
// Silences console output unless DEBUG_TESTS=1
if (!process.env.DEBUG_TESTS) {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
}

// Global test timeout
jest.setTimeout(10000);
```

## Mock Patterns

### Mock Database
```javascript
const mockDb = {
  prepare: jest.fn().mockReturnValue({
    get: jest.fn(),
    all: jest.fn(),
    run: jest.fn().mockReturnValue({ changes: 1 })
  }),
  exec: jest.fn(),
  transaction: jest.fn(fn => fn)
};

// Pass db as parameter (dependency injection)
const result = myFunction(mockDb, ...args);
```

### Mock Agent
```javascript
const mockAgent = {
  id: 1,
  name: 'TestAgent',
  type: 'fire',
  level: 50,
  xp: 25000,
  elo: 1200,
  hp: 100,
  attack: 80,
  defense: 70,
  sp_attack: 90,
  sp_defense: 75,
  speed: 85,
  moves: ['poke_fire_flamethrower', 'poke_fire_ember'],
  nature: 'adamant',
  status: 'active'
};
```

### Mock Request/Response
```javascript
const mockReq = {
  body: { agentId: 1 },
  params: { id: '1' },
  headers: { authorization: 'Bearer clw_sk_test123' },
  agent: mockAgent,  // Set by agentAuth middleware
  userId: 'user_123' // Set by clerkAuth middleware
};

const mockRes = {
  json: jest.fn().mockReturnThis(),
  status: jest.fn().mockReturnThis()
};

const mockNext = jest.fn();
```

## Testing Battle Engine

```javascript
describe('calculateDamage', () => {
  it('applies type effectiveness', () => {
    const damage = calculateDamage(fireAgent, grassAgent, flamethrower);
    expect(damage).toBeGreaterThan(baseDamage * 1.9); // ~2x
  });

  it('applies STAB bonus', () => {
    const withStab = calculateDamage(fireAgent, normalAgent, flamethrower);
    const noStab = calculateDamage(waterAgent, normalAgent, flamethrower);
    expect(withStab).toBeCloseTo(noStab * 1.5, 1);
  });

  it('handles immunities', () => {
    const damage = calculateDamage(normalAgent, ghostAgent, tackle);
    expect(damage).toBe(0);
  });
});
```

## Testing Auth Middleware

```javascript
describe('agentAuth', () => {
  it('returns 401 for missing header', async () => {
    const req = { headers: {} };
    await agentAuth(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 for invalid key', async () => {
    const req = { headers: { authorization: 'Bearer invalid' } };
    mockDb.prepare().get.mockReturnValue(null);
    await agentAuth(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('sets req.agent for valid key', async () => {
    const req = { headers: { authorization: 'Bearer clw_sk_valid' } };
    mockDb.prepare().get.mockReturnValue(mockAgent);
    await agentAuth(req, mockRes, mockNext);
    expect(req.agent).toEqual(mockAgent);
    expect(mockNext).toHaveBeenCalled();
  });
});
```

## Coverage Expectations

| Module | Target | Critical Paths |
|--------|--------|----------------|
| Battle engine | 100% | Damage calculations |
| XP system | 100% | All bracket boundaries |
| Auth | 100% | 401, 403, success paths |
| ELO | 95% | K-factor transitions |
| Type system | 100% | All 18×18 combinations |

## Running Specific Tests

```bash
# By filename
npm test -- battle-engine

# By test name
npm test -- -t "applies STAB"

# Multiple patterns
npm test -- "(battle|xp)"

# With coverage for specific file
npm test -- --coverage --collectCoverageFrom="src/services/battle-engine.js"
```

## Gotchas
- **Console silence:** Use `DEBUG_TESTS=1` to see console output
- **Async tests:** Always `await` or return promises
- **Mock cleanup:** Use `beforeEach(() => jest.clearAllMocks())`
- **DB injection:** Pass `mockDb` as parameter, don't import real db
- **Random values:** Mock `Math.random()` for deterministic tests
