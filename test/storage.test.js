import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage } from '../lib/storage/memory.js';
import { HuggingFaceStorage } from '../lib/storage/huggingface.js';
import { NullStorage, createStorage, safeStorageCall } from '../lib/storage/index.js';
import { StorageError } from '../lib/errors.js';
import {
  emptyProfile,
  addToHistory,
  toggleFavorite,
  clearHistory,
  clearAll,
} from '../lib/state/userdata.js';
import { config } from '../lib/config.js';

const originalFetch = globalThis.fetch;

describe('אחסון בזיכרון', () => {
  test('כתיבה וקריאה', async () => {
    const storage = new MemoryStorage();
    await storage.set('abc', { value: 1 });
    assert.deepEqual(await storage.get('abc'), { value: 1 });
  });

  test('מפתח שאינו קיים מחזיר null ולא שגיאה', async () => {
    const storage = new MemoryStorage();
    assert.equal(await storage.get('nope'), null);
  });

  test('הערך מועתק ולא משותף בהפניה', async () => {
    const storage = new MemoryStorage();
    const original = { list: [1, 2] };
    await storage.set('k', original);

    original.list.push(3);
    const stored = await storage.get('k');

    assert.equal(stored.list.length, 2, 'שינוי חיצוני דלף לאחסון');
  });
});

describe('אחסון ריק', () => {
  test('לא שומר ולא קורס', async () => {
    const storage = new NullStorage();
    await storage.set('k', { a: 1 });
    assert.equal(await storage.get('k'), null);
    assert.equal(await storage.has('k'), false);
  });
});

describe('בחירת מנוע אחסון', () => {
  test('ברירת המחדל היא ללא אחסון', () => {
    const storage = createStorage({ driver: 'none' });
    assert.equal(storage.name, 'none');
  });

  test('Hugging Face בלי טוקן נופל בחזרה לאחסון ריק במקום לקרוס', () => {
    const storage = createStorage({ driver: 'huggingface', repo: null, token: null });
    assert.equal(storage.name, 'none');
  });

  test('Hugging Face עם הגדרות תקינות נבנה', () => {
    const storage = createStorage({
      driver: 'huggingface',
      repo: 'user/dataset',
      token: 'hf_fake',
    });
    assert.equal(storage.name, 'huggingface');
  });
});

describe('Hugging Face', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('בלי מאגר או טוקן נזרקת שגיאה ברורה', () => {
    assert.throws(() => new HuggingFaceStorage({ repo: null, token: 't' }), /מאגר/);
    assert.throws(() => new HuggingFaceStorage({ repo: 'a/b', token: null }), /טוקן/);
  });

  test('מפתח מתורגם לנתיב מפוזר בתת-תיקיות', () => {
    const storage = new HuggingFaceStorage({ repo: 'u/d', token: 't' });
    assert.equal(storage.pathFor('abcdef12'), 'data/ab/abcdef12.json');
  });

  test('מפתח לא חוקי נדחה', () => {
    const storage = new HuggingFaceStorage({ repo: 'u/d', token: 't' });
    assert.throws(() => storage.pathFor('../../etc/passwd'), StorageError);
  });

  test('קובץ שאינו קיים מחזיר null ולא שגיאה', async () => {
    globalThis.fetch = async () => new Response('', { status: 404 });

    const storage = new HuggingFaceStorage({ repo: 'u/d', token: 't' });
    assert.equal(await storage.get('abc'), null);
  });

  test('הטוקן נשלח בכותרת ולא בכתובת', async () => {
    let seenUrl = null;
    let seenHeaders = null;

    globalThis.fetch = async (url, options) => {
      seenUrl = url;
      seenHeaders = options.headers;
      return new Response('{}', { status: 200 });
    };

    const storage = new HuggingFaceStorage({ repo: 'u/d', token: 'hf_secret123' });
    await storage.get('abc');

    assert.ok(!seenUrl.includes('hf_secret123'), 'הטוקן דלף לכתובת ה-URL');
    assert.equal(seenHeaders.Authorization, 'Bearer hf_secret123');
  });

  test('כשלון שרת מוחזר כשגיאת אחסון', async () => {
    globalThis.fetch = async () => new Response('', { status: 500 });

    const storage = new HuggingFaceStorage({ repo: 'u/d', token: 't' });
    await assert.rejects(() => storage.get('abc'), StorageError);
  });

  test('כתיבה נשלחת כ-NDJSON לממשק ה-commit', async () => {
    let seenBody = null;
    let seenType = null;

    globalThis.fetch = async (url, options) => {
      seenBody = options.body;
      seenType = options.headers['Content-Type'];
      return new Response('{}', { status: 200 });
    };

    const storage = new HuggingFaceStorage({ repo: 'u/d', token: 't' });
    await storage.set('abc', { hello: 'world' });

    assert.equal(seenType, 'application/x-ndjson');

    const lines = seenBody.split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).key, 'header');
    assert.equal(JSON.parse(lines[1]).key, 'file');

    const decoded = Buffer.from(JSON.parse(lines[1]).value.content, 'base64').toString('utf8');
    assert.deepEqual(JSON.parse(decoded), { hello: 'world' });
  });
});

describe('safeStorageCall', () => {
  test('כשלון מוחזר כערך ברירת מחדל ולא נזרק', async () => {
    const result = await safeStorageCall(async () => {
      throw new StorageError({ reason: 'בדיקה' });
    }, 'ברירת מחדל');

    assert.equal(result, 'ברירת מחדל');
  });

  test('הצלחה מוחזרת כרגיל', async () => {
    const result = await safeStorageCall(async () => 'ערך', null);
    assert.equal(result, 'ערך');
  });
});

describe('נתוני משתמש', () => {
  test('פרופיל ריק מכיל את ברירות המחדל', () => {
    const profile = emptyProfile();
    assert.equal(profile.preferences.resultCount, config.search.defaultResultCount);
    assert.deepEqual(profile.history, []);
    assert.deepEqual(profile.favorites, []);
  });

  test('היסטוריה בלי כפילויות, והאחרון בראש', () => {
    let profile = emptyProfile();
    profile = addToHistory(profile, { title: 'א' });
    profile = addToHistory(profile, { title: 'ב' });
    profile = addToHistory(profile, { title: 'א' });

    assert.equal(profile.history.length, 2);
    assert.equal(profile.history[0].title, 'א');
  });

  test('היסטוריה מוגבלת בכמות', () => {
    let profile = emptyProfile();
    for (let i = 0; i < 100; i += 1) {
      profile = addToHistory(profile, { title: `ערך ${i}` });
    }
    assert.equal(profile.history.length, config.privacy.maxHistoryItems);
  });

  test('כשהיסטוריה כבויה לא נשמר כלום', () => {
    let profile = emptyProfile();
    profile.preferences.historyEnabled = false;
    profile = addToHistory(profile, { title: 'א' });

    assert.equal(profile.history.length, 0);
  });

  test('מועדפים נוספים ומוסרים', () => {
    let profile = emptyProfile();

    const added = toggleFavorite(profile, 'ערך');
    assert.equal(added.added, true);
    assert.equal(added.profile.favorites.length, 1);

    const removed = toggleFavorite(added.profile, 'ערך');
    assert.equal(removed.added, false);
    assert.equal(removed.profile.favorites.length, 0);
  });

  test('מועדפים מוגבלים בכמות', () => {
    let profile = emptyProfile();
    for (let i = 0; i < config.privacy.maxFavorites; i += 1) {
      profile = toggleFavorite(profile, `ערך ${i}`).profile;
    }

    const overflow = toggleFavorite(profile, 'אחד יותר מדי');
    assert.equal(overflow.full, true);
    assert.equal(overflow.profile.favorites.length, config.privacy.maxFavorites);
  });

  test('מחיקת היסטוריה אינה מוחקת מועדפים', () => {
    let profile = emptyProfile();
    profile = addToHistory(profile, { title: 'בהיסטוריה' });
    profile = toggleFavorite(profile, 'במועדפים').profile;

    const cleared = clearHistory(profile);
    assert.equal(cleared.history.length, 0);
    assert.equal(cleared.favorites.length, 1);
  });

  test('מחיקת הכול שומרת על בחירת הפרטיות של המשתמש', () => {
    let profile = emptyProfile();
    profile.preferences.historyEnabled = false;
    profile = toggleFavorite(profile, 'ערך').profile;

    const cleared = clearAll(profile);
    assert.equal(cleared.favorites.length, 0);
    assert.equal(
      cleared.preferences.historyEnabled,
      false,
      'בחירת הפרטיות אופסה בניגוד לרצון המשתמש'
    );
  });
});
