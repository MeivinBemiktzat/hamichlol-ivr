/**
 * עזרי בדיקה
 * ===========
 * כל הבדיקות רצות בלי שום גישה לרשת. ספק החיפוש מוחלף בספק מדומה,
 * וכך הבדיקות אינן תלויות בזמינות של אתר חיצוני ורצות באלפיות שנייה.
 */

import { registerProvider } from '../lib/search/index.js';
import { config } from '../lib/config.js';
import { sharedCache } from '../lib/cache.js';
import { setStorage } from '../lib/storage/index.js';
import { MemoryStorage } from '../lib/storage/memory.js';

/** בונה בקשה מדומה בסגנון מה שימות שולחת */
export function makeRequest(params = {}, { method = 'POST' } = {}) {
  return {
    method,
    url: '/api/yemot',
    headers: { host: 'example.test' },
    body: {
      ApiCallId: 'call-test-1',
      ApiPhone: '0501234567',
      ApiDID: '0771234567',
      ApiExtension: '/5',
      ApiTime: String(Math.floor(Date.now() / 1000)),
      ...params,
    },
  };
}

/** ספק חיפוש מדומה, עם אפשרות להזריק תקלות */
export class FakeProvider {
  constructor({ id = 'fake', name = 'מדומה', articles = {}, searchResults = null, failWith = null } = {}) {
    this.id = id;
    this.name = name;
    this.verified = true;
    this.articles = articles;
    this.searchResults = searchResults;
    this.failWith = failWith;
    this.searchCalls = 0;
    this.articleCalls = 0;
    this.suggestCalls = 0;
  }

  async search(query, limit = 5) {
    this.searchCalls += 1;
    if (this.failWith) throw this.failWith;
    if (this.searchResults !== null) return this.searchResults.slice(0, limit);

    return Object.keys(this.articles)
      .filter((title) => title.includes(query))
      .slice(0, limit)
      .map((title, index) => ({ title, snippet: '', pageId: index + 1 }));
  }

  async getArticle(title) {
    this.articleCalls += 1;
    if (this.failWith) throw this.failWith;

    const text = this.articles[title];
    if (text === undefined) {
      const { NotFoundError } = await import('../lib/errors.js');
      throw new NotFoundError({ title });
    }
    if (text === '') {
      const { EmptyContentError } = await import('../lib/errors.js');
      throw new EmptyContentError({ title });
    }
    return { title, text };
  }

  async suggest() {
    this.suggestCalls += 1;
    return ['הצעה ראשונה', 'הצעה שנייה'];
  }
}

/** מתקין ספק מדומה כספק הפעיל, ומחזיר אותו */
export function useFakeProvider(options) {
  const provider = new FakeProvider(options);
  registerProvider('fake', provider);
  config.searchProvider = 'fake';
  sharedCache.clear();
  return provider;
}

/** מתקין אחסון בזיכרון ומחזיר אותו */
export function useMemoryStorage() {
  const storage = new MemoryStorage();
  setStorage(storage);
  process.env.USER_ID_SALT = 'test-salt-for-unit-tests';
  return storage;
}

/** מכבה אחסון לגמרי */
export function useNoStorage() {
  setStorage({
    name: 'none',
    async get() { return null; },
    async set() {},
    async delete() { return false; },
    async has() { return false; },
  });
}

/** מפרק תשובת ימות לשורות פעולה */
export function parseResponse(body) {
  const lines = String(body).split('\n').filter(Boolean);
  const actions = lines.map((line) => {
    const separator = line.indexOf('=');
    return {
      action: line.slice(0, separator),
      value: line.slice(separator + 1),
      raw: line,
    };
  });

  return {
    lines,
    actions,
    /** מחזיר את שם המשתנה שנשאל בפקודת read, אם יש */
    readVariable() {
      const readAction = actions.find((a) => a.action === 'read');
      if (!readAction) return null;
      const lastEquals = readAction.value.lastIndexOf('=');
      const fields = readAction.value.slice(lastEquals + 1);
      return fields.split(',')[0];
    },
    has(action) {
      return actions.some((a) => a.action === action);
    },
    text() {
      return body;
    },
  };
}

/** מדמה את מה שימות תשלח בבקשה הבאה: כל מה שנאסף עד כה, ועוד התשובה החדשה */
export function nextParams(previous, variableName, value) {
  return { ...previous, [variableName]: value };
}
