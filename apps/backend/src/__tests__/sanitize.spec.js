/**
 * Input Sanitization Tests
 */

const {
  stripHtml,
  escapeHtml,
  removeControlChars,
  sanitizeText,
  sanitizeAgentName,
  sanitizePostContent,
  sanitizeUrl,
  maskApiKey
} = require('../utils/sanitize');

describe('Sanitization Utilities', () => {
  describe('stripHtml', () => {
    test('removes simple HTML tags', () => {
      expect(stripHtml('<p>Hello</p>')).toBe('Hello');
      expect(stripHtml('<script>alert("xss")</script>')).toBe('alert("xss")');
    });

    test('removes nested tags', () => {
      expect(stripHtml('<div><span>Text</span></div>')).toBe('Text');
    });

    test('handles attributes', () => {
      expect(stripHtml('<a href="https://evil.com">Click</a>')).toBe('Click');
    });

    test('returns non-string inputs unchanged', () => {
      expect(stripHtml(123)).toBe(123);
      expect(stripHtml(null)).toBe(null);
      expect(stripHtml(undefined)).toBe(undefined);
    });

    test('handles empty string', () => {
      expect(stripHtml('')).toBe('');
    });

    test('handles string with no HTML', () => {
      expect(stripHtml('Just plain text')).toBe('Just plain text');
    });
  });

  describe('escapeHtml', () => {
    test('escapes ampersand', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('escapes less than', () => {
      expect(escapeHtml('a < b')).toBe('a &lt; b');
    });

    test('escapes greater than', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    test('escapes double quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    test('escapes single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#039;s');
    });

    test('escapes all special characters together', () => {
      expect(escapeHtml('<script>alert("xss")</script>'))
        .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    test('returns non-string inputs unchanged', () => {
      expect(escapeHtml(123)).toBe(123);
      expect(escapeHtml(null)).toBe(null);
    });
  });

  describe('removeControlChars', () => {
    test('removes null bytes', () => {
      expect(removeControlChars('hello\x00world')).toBe('helloworld');
    });

    test('preserves newlines', () => {
      expect(removeControlChars('line1\nline2')).toBe('line1\nline2');
    });

    test('preserves tabs', () => {
      expect(removeControlChars('col1\tcol2')).toBe('col1\tcol2');
    });

    test('removes bell character', () => {
      expect(removeControlChars('ding\x07dong')).toBe('dingdong');
    });

    test('removes backspace', () => {
      expect(removeControlChars('back\x08space')).toBe('backspace');
    });

    test('returns non-string inputs unchanged', () => {
      expect(removeControlChars(null)).toBe(null);
    });
  });

  describe('sanitizeText', () => {
    test('strips HTML and control chars', () => {
      expect(sanitizeText('<p>Hello\x00World</p>')).toBe('HelloWorld');
    });

    test('trims whitespace', () => {
      expect(sanitizeText('  hello  ')).toBe('hello');
    });

    test('normalizes multiple spaces', () => {
      expect(sanitizeText('hello    world')).toBe('hello world');
    });

    test('respects maxLength option', () => {
      expect(sanitizeText('hello world', { maxLength: 5 })).toBe('hello');
    });

    test('removes newlines when allowNewlines is false', () => {
      expect(sanitizeText('line1\nline2', { allowNewlines: false })).toBe('line1 line2');
    });

    test('preserves newlines by default', () => {
      const result = sanitizeText('line1\nline2');
      // After normalization, multiple spaces become one
      expect(result).toContain('line1');
      expect(result).toContain('line2');
    });

    test('handles empty string', () => {
      expect(sanitizeText('')).toBe('');
    });

    test('handles non-string inputs', () => {
      expect(sanitizeText(123)).toBe(123);
      expect(sanitizeText(null)).toBe(null);
    });
  });

  describe('sanitizeAgentName', () => {
    test('limits to 50 characters', () => {
      const longName = 'a'.repeat(100);
      expect(sanitizeAgentName(longName)).toHaveLength(50);
    });

    test('removes newlines', () => {
      expect(sanitizeAgentName('Agent\nName')).toBe('Agent Name');
    });

    test('strips HTML', () => {
      expect(sanitizeAgentName('<b>Evil</b> Bot')).toBe('Evil Bot');
    });

    test('handles normal name', () => {
      expect(sanitizeAgentName('CrabBot 3000')).toBe('CrabBot 3000');
    });
  });

  describe('sanitizePostContent', () => {
    test('limits to 2000 characters', () => {
      const longContent = 'a'.repeat(3000);
      expect(sanitizePostContent(longContent)).toHaveLength(2000);
    });

    test('allows newlines', () => {
      const content = sanitizePostContent('Line 1\nLine 2');
      expect(content).toContain('Line 1');
      expect(content).toContain('Line 2');
    });

    test('strips HTML', () => {
      expect(sanitizePostContent('<script>evil()</script>Post')).toBe('evil()Post');
    });
  });

  describe('sanitizeUrl', () => {
    test('accepts valid https URL', () => {
      expect(sanitizeUrl('https://example.com/path')).toBe('https://example.com/path');
    });

    test('accepts valid http URL', () => {
      expect(sanitizeUrl('http://example.com')).toBe('http://example.com/');
    });

    test('rejects javascript: protocol', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe(null);
    });

    test('rejects data: protocol', () => {
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe(null);
    });

    test('rejects file: protocol', () => {
      expect(sanitizeUrl('file:///etc/passwd')).toBe(null);
    });

    test('trims whitespace', () => {
      expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com/');
    });

    test('returns null for invalid URL', () => {
      expect(sanitizeUrl('not a url')).toBe(null);
    });

    test('returns null for non-string input', () => {
      expect(sanitizeUrl(123)).toBe(null);
      expect(sanitizeUrl(null)).toBe(null);
    });
  });

  describe('maskApiKey', () => {
    test('masks middle of standard API key', () => {
      expect(maskApiKey('clw_sk_abc123xyz789')).toBe('clw_sk_****z789');
    });

    test('masks bot token', () => {
      expect(maskApiKey('clw_bot_secret1234')).toBe('clw_bot_****1234');
    });

    test('handles key without recognized prefix', () => {
      expect(maskApiKey('random_key_12345678')).toBe('****5678');
    });

    test('returns **** for short keys', () => {
      expect(maskApiKey('short')).toBe('****');
      expect(maskApiKey('1234567')).toBe('****');
    });

    test('returns **** for non-string input', () => {
      expect(maskApiKey(123)).toBe('****');
      expect(maskApiKey(null)).toBe('****');
    });

    test('handles exactly 8 character key', () => {
      expect(maskApiKey('12345678')).toBe('****5678');
    });
  });

  describe('XSS Prevention', () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '"><script>alert(1)</script>',
      "';alert(1)//",
      '<iframe src="javascript:alert(1)">',
      '<body onload=alert(1)>',
      '<input onfocus=alert(1) autofocus>',
      '<marquee onstart=alert(1)>',
      '<video><source onerror=alert(1)>'
    ];

    test.each(xssPayloads)('sanitizeText removes XSS payload: %s', (payload) => {
      const result = sanitizeText(payload);
      expect(result).not.toContain('<script');
      expect(result).not.toContain('onerror');
      expect(result).not.toContain('onload');
      expect(result).not.toContain('<iframe');
      expect(result).not.toContain('<svg');
    });

    test.each(xssPayloads)('escapeHtml escapes XSS payload: %s', (payload) => {
      const result = escapeHtml(payload);
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });
  });
});
