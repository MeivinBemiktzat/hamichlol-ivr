/**
 * אחסון על Hugging Face
 * =======================
 *
 * למה מאגר datasets ולא Buckets
 * ------------------------------
 * ל-Hugging Face יש שני סוגי אחסון. Buckets הוא מוצר בתשלום (12 עד 18 דולר
 * לטרה-בייט לחודש), והממשק הרשמי שלו הוא ספריית פייתון, בלי endpoint תואם-S3
 * מתועד. מאגר datasets, לעומת זאת, חינמי כשהוא ציבורי, ויש לו ממשק HTTP
 * ישיר שעובד מצוין מ-Node.js.
 *
 * מה נשמר כאן ומה לא
 * -------------------
 * כאן נשמרים רק נתונים שמשתנים לעיתים רחוקות: מועדפים, היסטוריה והעדפות.
 * מצב השיחה עצמו אינו נשמר כאן בכוונה, אלא מקודד בשמות המשתנים של ימות
 * (ראו lib/state/session.js). הסיבה: אחסון מבוסס גיט מבצע commit בכל כתיבה,
 * והתיעוד הרשמי ממליץ לא לכתוב בתדירות גבוהה. ב-IVR, שבו כל הקשה היא צעד,
 * זה היה מוסיף המתנה לכל פעולה.
 *
 * פרטיות
 * -------
 * המפתח נגזר מגיבוב חד-כיווני של מספר הטלפון עם מלח סודי, ולכן מספרי טלפון
 * אינם נשמרים באחסון. ראו userKey ב-lib/yemot/params.js.
 */

import { config } from '../config.js';
import { logger } from '../logger.js';
import { StorageError } from '../errors.js';

export class HuggingFaceStorage {
  /**
   * @param {object} options
   * @param {string} options.repo מזהה המאגר בצורת owner/name
   * @param {string} options.token טוקן גישה עם הרשאת כתיבה
   * @param {string} [options.endpoint]
   */
  constructor({ repo, token, endpoint = 'https://huggingface.co' }) {
    if (!repo) throw new Error('חסר שם מאגר Hugging Face (HF_DATASET_REPO)');
    if (!token) throw new Error('חסר טוקן Hugging Face (HF_TOKEN)');

    this.repo = repo;
    this.token = token;
    this.endpoint = endpoint.replace(/\/+$/, '');
  }

  get name() {
    return 'huggingface';
  }

  /**
   * נתיב הקובץ בתוך המאגר עבור מפתח נתון.
   *
   * המפתח נבדק ונדחה אם אינו חוקי, ולא "מנוקה". ניקוי שקט היה הופך שני
   * מפתחות שונים לאותו נתיב, וזו דליפה בין משתמשים. מפתחות המערכת הם
   * ממילא תווים הקסדצימליים בלבד (ראו userKey), ולכן בדיקה קפדנית בטוחה.
   */
  pathFor(key) {
    const value = String(key ?? '');

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
      throw new StorageError({ reason: 'מפתח אחסון לא חוקי' });
    }

    // פיזור לתת-תיקיות לפי שני תווים ראשונים, כדי לא לרכז אלפי קבצים בתיקייה אחת
    const prefix = value.length >= 2 ? value.slice(0, 2) : `_${value}`;
    return `data/${prefix}/${value}.json`;
  }

  async get(key) {
    const path = this.pathFor(key);
    const url = `${this.endpoint}/datasets/${this.repo}/resolve/main/${path}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.http.timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': config.userAgent,
        },
        signal: controller.signal,
      });

      // קובץ שלא קיים הוא מצב תקין, לא שגיאה
      if (response.status === 404) return null;

      if (!response.ok) {
        throw new StorageError({ status: response.status, operation: 'get' });
      }

      const text = await response.text();
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (error?.name === 'AbortError') {
        throw new StorageError({ operation: 'get', reason: 'פסק זמן' });
      }
      throw new StorageError({ operation: 'get', reason: error?.message });
    } finally {
      clearTimeout(timer);
    }
  }

  async set(key, value) {
    const path = this.pathFor(key);
    const content = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

    // ממשק ה-commit של Hugging Face מקבל NDJSON: שורת כותרת ואז שורה לכל קובץ
    const body = [
      JSON.stringify({
        key: 'header',
        value: { summary: `עדכון ${path}` },
      }),
      JSON.stringify({
        key: 'file',
        value: { path, content, encoding: 'base64' },
      }),
    ].join('\n');

    await this.commit(body, 'set');
  }

  async delete(key) {
    const path = this.pathFor(key);

    const body = [
      JSON.stringify({ key: 'header', value: { summary: `מחיקת ${path}` } }),
      JSON.stringify({ key: 'deletedFile', value: { path } }),
    ].join('\n');

    try {
      await this.commit(body, 'delete');
      return true;
    } catch (error) {
      // מחיקת קובץ שאינו קיים אינה שגיאה מבחינת המערכת
      logger.warn('מחיקה מהאחסון נכשלה', { key, code: error?.code });
      return false;
    }
  }

  async has(key) {
    const value = await this.get(key);
    return value !== null;
  }

  /** שולח commit למאגר */
  async commit(ndjsonBody, operation) {
    const url = `${this.endpoint}/api/datasets/${this.repo}/commit/main`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.http.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/x-ndjson',
          'User-Agent': config.userAgent,
        },
        body: ndjsonBody,
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new StorageError({
          status: response.status,
          operation,
          detail: detail.slice(0, 200),
        });
      }

      return true;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (error?.name === 'AbortError') {
        throw new StorageError({ operation, reason: 'פסק זמן' });
      }
      throw new StorageError({ operation, reason: error?.message });
    } finally {
      clearTimeout(timer);
    }
  }
}

export default HuggingFaceStorage;
