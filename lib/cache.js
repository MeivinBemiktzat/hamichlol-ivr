/**
 * מטמון בזיכרון הפונקציה
 * ========================
 * מטמון זה חי בתוך מופע הפונקציה ב-Vercel. מופע נשאר חם בין בקשות סמוכות,
 * ולכן המטמון מועיל מאוד בתוך שיחה אחת: מתקשר שמנווט בין מקטעי ערך לא גורם
 * לפנייה חוזרת למקור בכל הקשה.
 *
 * מה שהוא לא: מטמון משותף בין מופעים. זה מכוון. מטמון משותף היה מצריך שירות
 * חיצוני ותוספת השהיה, בשביל רווח קטן בשימוש אמיתי.
 *
 * מדיניות פינוי: LRU עם תפוגה לפי זמן.
 */

import { config } from './config.js';

export class TtlCache {
  constructor({ maxEntries = 200 } = {}) {
    this.maxEntries = maxEntries;
    /** @type {Map<string, {value:any, expiresAt:number}>} */
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      this.misses += 1;
      return undefined;
    }

    // מחיקה והכנסה מחדש מעבירה את הרשומה לסוף, וכך Map משמש כ-LRU
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.map.has(key)) this.map.delete(key);

    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });

    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  /**
   * מחזיר ערך מהמטמון, ואם אינו קיים מייצר אותו.
   *
   * בקשות מקבילות לאותו מפתח מחכות לאותה הבטחה במקום לפנות שוב למקור.
   * זו ההגנה מפני בקשות כפולות מיותרות.
   */
  async getOrLoad(key, ttlMs, loader) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const pendingKey = `__pending__${key}`;
    const pending = this.map.get(pendingKey);
    if (pending && pending.expiresAt > Date.now()) {
      return pending.value;
    }

    const promise = loader().then(
      (value) => {
        this.map.delete(pendingKey);
        this.set(key, value, ttlMs);
        return value;
      },
      (error) => {
        this.map.delete(pendingKey);
        throw error;
      }
    );

    // ההבטחה עצמה נשמרת לזמן קצר, כדי לאחד בקשות מקבילות
    this.map.set(pendingKey, {
      value: promise,
      expiresAt: Date.now() + config.http.timeoutMs + 1000,
    });

    return promise;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size() {
    return this.map.size;
  }

  stats() {
    return { size: this.map.size, hits: this.hits, misses: this.misses };
  }
}

/** מטמון משותף לכל המערכת */
export const sharedCache = new TtlCache({ maxEntries: config.cache.maxEntries });

export default { TtlCache, sharedCache };
