import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, looksLikeChallengePage } from '../lib/http.js';
import { SourceBlockedError, SourceUnavailableError, TimeoutError } from '../lib/errors.js';
import { config } from '../lib/config.js';

const originalFetch = globalThis.fetch;

function mockFetch(handler) {
  globalThis.fetch = handler;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('לקוח HTTP', () => {
  beforeEach(() => {
    config.http.retryBaseDelayMs = 1; // לא להאט את הבדיקות
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    config.http.retryBaseDelayMs = 250;
  });

  test('בקשה תקינה מחזירה JSON', async () => {
    mockFetch(async () => jsonResponse({ ok: true }));
    const result = await fetchJson('https://example.test/api');
    assert.deepEqual(result, { ok: true });
  });

  test('נשלח User-Agent מזהה, כפי שמדיניות מדיה-ויקי דורשת', async () => {
    let seenHeaders = null;
    mockFetch(async (url, options) => {
      seenHeaders = options.headers;
      return jsonResponse({});
    });

    await fetchJson('https://example.test/api');
    assert.ok(seenHeaders['User-Agent'], 'לא נשלח User-Agent');
    assert.ok(seenHeaders['User-Agent'].length > 5);
  });

  test('שגיאה זמנית גוררת ניסיון חוזר ואז הצלחה', async () => {
    let attempts = 0;
    mockFetch(async () => {
      attempts += 1;
      if (attempts < 3) return new Response('', { status: 503 });
      return jsonResponse({ recovered: true });
    });

    const result = await fetchJson('https://example.test/api', { maxRetries: 3 });
    assert.deepEqual(result, { recovered: true });
    assert.equal(attempts, 3);
  });

  test('מספר הניסיונות מוגבל ואינו אינסופי', async () => {
    let attempts = 0;
    mockFetch(async () => {
      attempts += 1;
      return new Response('', { status: 500 });
    });

    await assert.rejects(
      () => fetchJson('https://example.test/api', { maxRetries: 2 }),
      SourceUnavailableError
    );
    assert.equal(attempts, 3, 'ניסיון ראשון ועוד שניים חוזרים');
  });

  test('חסימה אינה גוררת ניסיון חוזר, כי ניסיון חוזר רק יחמיר', async () => {
    let attempts = 0;
    mockFetch(async () => {
      attempts += 1;
      return new Response('Access denied', { status: 403 });
    });

    await assert.rejects(() => fetchJson('https://example.test/api'), SourceBlockedError);
    assert.equal(attempts, 1, 'חסימה נוסתה יותר מפעם אחת');
  });

  test('דף אתגר של Cloudflare מזוהה כחסימה גם בקוד 200', async () => {
    mockFetch(async () =>
      new Response('<html><title>Just a moment...</title></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    await assert.rejects(() => fetchJson('https://example.test/api'), SourceBlockedError);
  });

  test('זיהוי דף אתגר', () => {
    assert.equal(looksLikeChallengePage('<title>Just a moment...</title>', 'text/html'), true);
    assert.equal(looksLikeChallengePage('{"ok":true}', 'application/json'), false);
    assert.equal(looksLikeChallengePage('', 'text/html'), false);
  });

  test('תשובה שאינה JSON תקין מטופלת כשגיאה ולא מפילה', async () => {
    mockFetch(async () =>
      new Response('not json at all', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await assert.rejects(
      () => fetchJson('https://example.test/api', { maxRetries: 0 }),
      SourceUnavailableError
    );
  });

  test('פסק זמן מוחזר כשגיאת TimeoutError', async () => {
    mockFetch(async (url, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    );

    await assert.rejects(
      () => fetchJson('https://example.test/api', { timeoutMs: 20, maxRetries: 0 }),
      TimeoutError
    );
  });

  test('כשל רשת מוחזר כשגיאה מסודרת', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed');
    });

    await assert.rejects(
      () => fetchJson('https://example.test/api', { maxRetries: 0 }),
      SourceUnavailableError
    );
  });

  test('תשובה גדולה מהמותר נדחית', async () => {
    mockFetch(async () =>
      new Response('x'.repeat(100), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(999 * 1024 * 1024),
        },
      })
    );

    await assert.rejects(
      () => fetchJson('https://example.test/api', { maxRetries: 0 }),
      SourceUnavailableError
    );
  });

  test('הודעת השגיאה למתקשר אינה חושפת פרטים טכניים', async () => {
    mockFetch(async () => new Response('', { status: 500 }));

    try {
      await fetchJson('https://internal-server.test/secret/path', { maxRetries: 0 });
      assert.fail('היה צריך להיזרק');
    } catch (error) {
      assert.ok(!error.spoken.includes('500'), 'קוד HTTP דלף למתקשר');
      assert.ok(!error.spoken.includes('internal-server'), 'שם שרת דלף למתקשר');
      assert.ok(error.spoken.length > 0);
    }
  });
});
