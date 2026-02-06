/**
 * Middleware Tests
 */

const { generateRequestId, deprecation } = require('../middleware/request-logger');

describe('Request Logger Middleware', () => {
  describe('generateRequestId', () => {
    test('generates unique IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      expect(id1).not.toBe(id2);
    });

    test('generates string IDs', () => {
      const id = generateRequestId();
      expect(typeof id).toBe('string');
    });

    test('generates IDs of reasonable length', () => {
      const id = generateRequestId();
      expect(id.length).toBeGreaterThan(10);
      expect(id.length).toBeLessThan(30);
    });

    test('generates alphanumeric IDs', () => {
      const id = generateRequestId();
      expect(id).toMatch(/^[a-z0-9]+$/);
    });
  });

  describe('deprecation middleware', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
      mockReq = {
        requestId: 'test-123',
        method: 'GET',
        path: '/api/old-endpoint',
        agent: { id: 'agent-1' },
        userId: 'user-1'
      };
      mockRes = {
        headers: {},
        setHeader: jest.fn((name, value) => {
          mockRes.headers[name] = value;
        }),
        getHeader: jest.fn((name) => mockRes.headers[name])
      };
      mockNext = jest.fn();
    });

    test('sets Deprecation header to true when no date provided', () => {
      const middleware = deprecation({});
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
      expect(mockNext).toHaveBeenCalled();
    });

    test('sets Deprecation header with date when provided', () => {
      const middleware = deprecation({ deprecatedAt: '2026-01-01' });
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Deprecation', 'date="2026-01-01"');
    });

    test('sets Sunset header when sunsetAt provided', () => {
      const middleware = deprecation({ sunsetAt: '2026-06-01' });
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Sunset',
        expect.stringContaining('2026')
      );
    });

    test('sets Link header when link provided', () => {
      const middleware = deprecation({ link: 'https://docs.example.com/migration' });
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Link',
        '<https://docs.example.com/migration>; rel="deprecation"; type="text/html"'
      );
    });

    test('sets X-Deprecated-Successor header when successor provided', () => {
      const middleware = deprecation({ successor: '/api/v2/new-endpoint' });
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'X-Deprecated-Successor',
        '/api/v2/new-endpoint'
      );
    });

    test('sets all headers when all options provided', () => {
      const middleware = deprecation({
        deprecatedAt: '2026-01-01',
        sunsetAt: '2026-06-01',
        link: 'https://docs.example.com',
        successor: '/api/v2/endpoint'
      });
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledTimes(4);
      expect(mockNext).toHaveBeenCalled();
    });

    test('appends to existing Link header', () => {
      mockRes.headers['Link'] = '<https://existing.com>; rel="self"';

      const middleware = deprecation({ link: 'https://docs.example.com' });
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Link',
        expect.stringContaining('existing.com')
      );
    });

    test('calls next() to continue request chain', () => {
      const middleware = deprecation({});
      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });
  });
});

describe('Error Codes', () => {
  const { ERROR_CODES } = require('../config/constants');

  test('ERROR_CODES contains authentication errors', () => {
    expect(ERROR_CODES.AUTH_FAILED).toBe('AUTH_FAILED');
    expect(ERROR_CODES.AUTH_MISSING).toBe('AUTH_MISSING');
    expect(ERROR_CODES.AUTH_EXPIRED).toBe('AUTH_EXPIRED');
  });

  test('ERROR_CODES contains rate limiting errors', () => {
    expect(ERROR_CODES.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(ERROR_CODES.FIGHT_LIMIT_EXCEEDED).toBe('FIGHT_LIMIT_EXCEEDED');
  });

  test('ERROR_CODES contains validation errors', () => {
    expect(ERROR_CODES.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(ERROR_CODES.INVALID_TYPE).toBe('INVALID_TYPE');
    expect(ERROR_CODES.INVALID_MOVE).toBe('INVALID_MOVE');
  });

  test('ERROR_CODES contains resource errors', () => {
    expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    expect(ERROR_CODES.AGENT_NOT_FOUND).toBe('AGENT_NOT_FOUND');
    expect(ERROR_CODES.BATTLE_NOT_FOUND).toBe('BATTLE_NOT_FOUND');
  });

  test('ERROR_CODES contains server errors', () => {
    expect(ERROR_CODES.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ERROR_CODES.REQUEST_TIMEOUT).toBe('REQUEST_TIMEOUT');
    expect(ERROR_CODES.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
  });

  test('all error codes are unique', () => {
    const values = Object.values(ERROR_CODES);
    const uniqueValues = [...new Set(values)];
    expect(values.length).toBe(uniqueValues.length);
  });
});
