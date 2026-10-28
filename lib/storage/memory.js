/**
 * אחסון בזיכרון
 * ==============
 * משמש לבדיקות, ולהרצה מקומית בלי להגדיר שום שירות חיצוני.
 * אינו מתמיד בין מופעי פונקציה, ולכן אינו מתאים לייצור.
 */

export class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.writeCount = 0;
    this.readCount = 0;
  }

  async get(key) {
    this.readCount += 1;
    const value = this.map.get(key);
    return value === undefined ? null : structuredClone(value);
  }

  async set(key, value) {
    this.writeCount += 1;
    this.map.set(key, structuredClone(value));
  }

  async delete(key) {
    this.writeCount += 1;
    return this.map.delete(key);
  }

  async has(key) {
    return this.map.has(key);
  }

  get name() {
    return 'memory';
  }
}

export default MemoryStorage;
