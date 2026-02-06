/**
 * ClawCombat Auth Middleware Unit Tests
 * Tests API key authentication and rate limiting
 */

const crypto = require('crypto');

// Mock the database before requiring auth module
jest.mock('../db/schema', () => {
  const mockDb = {
    prepare: jest.fn(),
  };
  return {
    getDb: jest.fn(() => mockDb),
    initializeSchema: jest.fn(() => mockDb),
  };
});

// Mock agent queries - the auth module now uses centralized query helpers
const mockGetActiveAgentByKeyHash = jest.fn();
const mockGetActiveAgentByBotToken = jest.fn();
jest.mock('../services/agent-queries', () => ({
  getActiveAgentByKeyHash: (...args) => mockGetActiveAgentByKeyHash(...args),
  getActiveAgentByBotToken: (...args) => mockGetActiveAgentByBotToken(...args),
}));

const { authenticateAgent, hashApiKey } = require('../middleware/auth');
const { getDb } = require('../db/schema');

describe('Auth Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;
  let mockDb;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    mockReq = {
      headers: {},
      ip: '127.0.0.1',
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();

    // Get the mocked db
    mockDb = getDb();
  });

  describe('hashApiKey', () => {
    test('returns SHA256 hash of input', () => {
      const key = 'clw_sk_test123';
      const hash = hashApiKey(key);

      // Verify it's a valid hex string (SHA256 = 64 chars)
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // Verify deterministic
      expect(hashApiKey(key)).toBe(hash);
    });

    test('different keys produce different hashes', () => {
      const hash1 = hashApiKey('key1');
      const hash2 = hashApiKey('key2');

      expect(hash1).not.toBe(hash2);
    });

    test('matches expected crypto output', () => {
      const key = 'test_key';
      const expected = crypto.createHash('sha256').update(key).digest('hex');

      expect(hashApiKey(key)).toBe(expected);
    });
  });

  describe('authenticateAgent', () => {
    test('returns 401 when no Authorization header', () => {
      authenticateAgent(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Missing or invalid Authorization header'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('returns 401 when Authorization header missing Bearer prefix', () => {
      mockReq.headers.authorization = 'clw_sk_test123';

      authenticateAgent(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Missing or invalid Authorization header'
      });
    });

    test('returns 401 for invalid API key', () => {
      mockReq.headers.authorization = 'Bearer clw_sk_invalid';

      mockGetActiveAgentByKeyHash.mockReturnValue(null);

      authenticateAgent(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid API key or inactive agent'
      });
    });

    test('authenticates valid API key (clw_sk_ prefix)', () => {
      const apiKey = 'clw_sk_validkey123';
      mockReq.headers.authorization = `Bearer ${apiKey}`;

      const mockAgent = {
        id: 'agent-123',
        name: 'TestAgent',
        status: 'active',
      };

      mockGetActiveAgentByKeyHash.mockReturnValue(mockAgent);

      const mockUpdateStatement = { run: jest.fn() };
      mockDb.prepare.mockReturnValue(mockUpdateStatement);

      authenticateAgent(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.agent).toBe(mockAgent);
    });

    test('authenticates valid bot token (clw_bot_ prefix)', () => {
      const botToken = 'clw_bot_validtoken123';
      mockReq.headers.authorization = `Bearer ${botToken}`;

      const mockAgent = {
        id: 'agent-456',
        name: 'BotAgent',
        status: 'active',
      };

      mockGetActiveAgentByBotToken.mockReturnValue(mockAgent);

      const mockUpdateStatement = { run: jest.fn() };
      mockDb.prepare.mockReturnValue(mockUpdateStatement);

      authenticateAgent(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.agent).toBe(mockAgent);

      // Verify bot token helper was called (not API key helper)
      expect(mockGetActiveAgentByBotToken).toHaveBeenCalled();
      expect(mockGetActiveAgentByKeyHash).not.toHaveBeenCalled();
    });

    test('uses api_key helper for regular API keys', () => {
      const apiKey = 'clw_sk_regularkey';
      mockReq.headers.authorization = `Bearer ${apiKey}`;

      mockGetActiveAgentByKeyHash.mockReturnValue(null);

      authenticateAgent(mockReq, mockRes, mockNext);

      // Verify API key helper was called (not bot token helper)
      expect(mockGetActiveAgentByKeyHash).toHaveBeenCalled();
      expect(mockGetActiveAgentByBotToken).not.toHaveBeenCalled();
    });

    test('only checks active agents via helper functions', () => {
      mockReq.headers.authorization = 'Bearer clw_sk_test';

      mockGetActiveAgentByKeyHash.mockReturnValue(null);

      authenticateAgent(mockReq, mockRes, mockNext);

      // The helper function name 'getActiveAgentByKeyHash' indicates it only returns active agents
      // This is enforced by the SQL in agent-queries.js: "status = 'active'"
      expect(mockGetActiveAgentByKeyHash).toHaveBeenCalledWith(expect.any(String));
    });
  });

  describe('last_active_at throttling', () => {
    test('updates last_active on first authentication', () => {
      const apiKey = 'clw_sk_newkey';
      mockReq.headers.authorization = `Bearer ${apiKey}`;

      const mockAgent = { id: 'agent-new', status: 'active' };

      mockGetActiveAgentByKeyHash.mockReturnValue(mockAgent);

      const mockUpdateStatement = { run: jest.fn() };
      mockDb.prepare.mockReturnValue(mockUpdateStatement);

      authenticateAgent(mockReq, mockRes, mockNext);

      // Should update last_active_at
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE agents SET last_active_at')
      );
      expect(mockUpdateStatement.run).toHaveBeenCalled();
    });
  });
});

describe('API Key Security', () => {
  test('API keys are properly hashed before storage comparison', () => {
    // This is a design test - verifying the security pattern
    const rawKey = 'clw_sk_secret_key_12345';
    const hash = hashApiKey(rawKey);

    // Hash should be different from raw key
    expect(hash).not.toBe(rawKey);
    expect(hash).not.toContain('clw_sk_');

    // Hash should be consistent
    expect(hashApiKey(rawKey)).toBe(hash);
  });

  test('collision resistance - similar keys produce different hashes', () => {
    const key1 = 'clw_sk_test1';
    const key2 = 'clw_sk_test2';

    expect(hashApiKey(key1)).not.toBe(hashApiKey(key2));
  });
});
