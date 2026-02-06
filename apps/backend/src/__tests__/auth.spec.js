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

      const mockStatement = {
        get: jest.fn().mockReturnValue(null),
        run: jest.fn(),
      };
      mockDb.prepare.mockReturnValue(mockStatement);

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

      const mockSelectStatement = {
        get: jest.fn().mockReturnValue(mockAgent),
      };
      const mockUpdateStatement = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockSelectStatement) // SELECT query
        .mockReturnValueOnce(mockUpdateStatement); // UPDATE query

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

      const mockSelectStatement = {
        get: jest.fn().mockReturnValue(mockAgent),
      };
      const mockUpdateStatement = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockSelectStatement)
        .mockReturnValueOnce(mockUpdateStatement);

      authenticateAgent(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.agent).toBe(mockAgent);

      // Verify bot token query uses bot_token_hash column
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('bot_token_hash')
      );
    });

    test('uses api_key column for regular API keys', () => {
      const apiKey = 'clw_sk_regularkey';
      mockReq.headers.authorization = `Bearer ${apiKey}`;

      const mockSelectStatement = {
        get: jest.fn().mockReturnValue(null),
      };
      mockDb.prepare.mockReturnValue(mockSelectStatement);

      authenticateAgent(mockReq, mockRes, mockNext);

      // Verify regular API key query uses api_key column
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('api_key')
      );
    });

    test('only checks active agents', () => {
      mockReq.headers.authorization = 'Bearer clw_sk_test';

      const mockStatement = {
        get: jest.fn().mockReturnValue(null),
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      authenticateAgent(mockReq, mockRes, mockNext);

      // Verify status = 'active' is in the query
      expect(mockStatement.get).toHaveBeenCalledWith(
        expect.any(String),
        'active'
      );
    });
  });

  describe('last_active_at throttling', () => {
    test('updates last_active on first authentication', () => {
      const apiKey = 'clw_sk_newkey';
      mockReq.headers.authorization = `Bearer ${apiKey}`;

      const mockAgent = { id: 'agent-new', status: 'active' };

      const mockSelectStatement = { get: jest.fn().mockReturnValue(mockAgent) };
      const mockUpdateStatement = { run: jest.fn() };

      mockDb.prepare
        .mockReturnValueOnce(mockSelectStatement)
        .mockReturnValueOnce(mockUpdateStatement);

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
