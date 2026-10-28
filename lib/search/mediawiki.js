/**
 * ספק חיפוש מבוסס מדיה-ויקי
 * ===========================
 * מימוש משותף לכל אתר שמריץ מדיה-ויקי עם api.php פתוח.
 * המכלול וויקיפדיה העברית שניהם כאלה, ולכן שניהם משתמשים במחלקה הזו
 * ונבדלים רק בכתובת הבסיס.
 *
 * מצב האימות
 * -----------
 * מול ויקיפדיה העברית הממשק מתועד רשמית ויציב.
 * מול המכלול לא הצלחנו לאמת את הממשק בפועל: האתר מחזיר 403 ודף אתגר של
 * Cloudflare לכל פנייה מהשרת, כולל לקובץ robots.txt. ראו docs/RESEARCH.md.
 * המימוש כאן מניח ממשק מדיה-ויקי סטנדרטי, וזו הנחה מתועדת שלא אומתה.
 */

import { fetchJson } from '../http.js';
import { sharedCache } from '../cache.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { EmptyContentError, NotFoundError } from '../errors.js';

export class MediaWikiProvider {
  /**
   * @param {object} options
   * @param {string} options.id מזהה קצר לספק, משמש במפתחות מטמון
   * @param {string} options.name שם להקראה למתקשר
   * @param {string} options.apiBase כתובת api.php
   * @param {boolean} [options.verified] האם הממשק אומת בפועל
   */
  constructor({ id, name, apiBase, verified = false }) {
    this.id = id;
    this.name = name;
    this.apiBase = apiBase;
    this.verified = verified;
  }

  /** בונה כתובת לממשק, עם הפרמטרים הקבועים שמדיה-ויקי דורש */
  buildUrl(params) {
    const url = new URL(this.apiBase);
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('utf8', '1');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /**
   * חיפוש ערכים.
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<Array<{title:string, snippet:string, pageId:number}>>}
   */
  async search(query, limit = config.search.defaultResultCount) {
    const safeLimit = clamp(limit, config.search.minResultCount, config.search.maxResultCount);
    const cacheKey = `${this.id}:search:${normalizeQuery(query)}:${safeLimit}`;

    return sharedCache.getOrLoad(cacheKey, config.cache.searchTtlMs, async () => {
      const url = this.buildUrl({
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: safeLimit,
        srprop: 'snippet',
        srnamespace: '0', // מרחב הערכים בלבד, בלי דפי שיחה ומשתמשים
      });

      const data = await fetchJson(url);
      const results = data?.query?.search ?? [];

      logger.debug('תוצאות חיפוש', {
        provider: this.id,
        count: results.length,
      });

      return results.map((item) => ({
        title: String(item.title ?? '').trim(),
        snippet: stripMarkup(item.snippet ?? ''),
        pageId: Number(item.pageid ?? 0),
      })).filter((item) => item.title !== '');
    });
  }

  /**
   * שליפת תוכן ערך כטקסט נקי.
   * explaintext מחזיר טקסט בלי תגיות ויקי, וזה בדיוק מה שצריך להקראה.
   *
   * @param {string} title
   * @returns {Promise<{title:string, text:string}>}
   */
  async getArticle(title) {
    const cacheKey = `${this.id}:article:${normalizeQuery(title)}`;

    return sharedCache.getOrLoad(cacheKey, config.cache.articleTtlMs, async () => {
      const url = this.buildUrl({
        action: 'query',
        prop: 'extracts',
        explaintext: '1',
        exsectionformat: 'plain',
        titles: title,
        redirects: '1', // הפניות נפתרות אוטומטית
      });

      const data = await fetchJson(url);
      const pages = data?.query?.pages ?? [];
      const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];

      if (!page || page.missing) {
        throw new NotFoundError({ provider: this.id, title });
      }

      const text = String(page.extract ?? '').trim();
      if (!text) {
        throw new EmptyContentError({ provider: this.id, title });
      }

      return { title: String(page.title ?? title), text };
    });
  }

  /**
   * הצעות לשאילתות דומות, לשימוש כשחיפוש לא החזיר תוצאות.
   * opensearch מחזיר השלמות לפי תחילית, מה שמטפל היטב בשגיאות כתיב בסוף מילה.
   */
  async suggest(query, limit = 3) {
    const cacheKey = `${this.id}:suggest:${normalizeQuery(query)}:${limit}`;

    try {
      return await sharedCache.getOrLoad(cacheKey, config.cache.searchTtlMs, async () => {
        const url = this.buildUrl({
          action: 'opensearch',
          search: query,
          limit,
          namespace: '0',
        });

        const data = await fetchJson(url);
        // opensearch מחזיר מערך: [שאילתה, [כותרות], [תיאורים], [קישורים]]
        const titles = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
        return titles.map((t) => String(t).trim()).filter(Boolean);
      });
    } catch (error) {
      // הצעות הן תוספת נחמדה ולא פונקציה קריטית, ולכן כשלון כאן לא מפיל כלום
      logger.warn('שליפת הצעות נכשלה', { provider: this.id, error: error?.code });
      return [];
    }
  }
}

/** מסיר תגיות HTML שמדיה-ויקי מחזיר בתוך snippet */
export function stripMarkup(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** נרמול שאילתה למפתח מטמון, כדי שחיפושים זהים ייחשבו זהים */
export function normalizeQuery(query) {
  return String(query ?? '')
    .trim()
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // הסרת ניקוד וטעמים
    .replace(/["'`״׳]/g, '')
    .replace(/\s+/g, ' ');
}

function clamp(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(Math.max(parsed, min), max);
}

export default { MediaWikiProvider, stripMarkup, normalizeQuery };
