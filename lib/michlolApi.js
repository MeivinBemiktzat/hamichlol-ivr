/**
 * lib/michlolApi.js
 * ===================
 * חיפוש ושליפת תמצית ערכים מתוך אתר "המכלול" (hamichlol.org.il),
 * שרץ על תוכנת MediaWiki, דרך ה-API הציבורי הסטנדרטי שלו.
 *
 * תיעוד (מאומת מראש על ידי המשתמש, לא MediaWiki הכללי אלא ספציפית
 * מול www.hamichlol.org.il/w/api.php):
 *   - חיפוש:  action=query&list=search&srsearch=<q>&srlimit=5&format=json
 *             -> query.search[].title
 *   - תמצית: action=query&prop=extracts&explaintext=1&exintro=1&titles=<t>&format=json
 *             -> query.pages.<id>.extract
 */

'use strict';

const fetch = require('node-fetch');

const MICHLOL_API_BASE = 'https://www.hamichlol.org.il/w/api.php';
const MICHLOL_USER_AGENT = 'michlol-yemot-voice-search/1.0 (yemot IVR integration)';

/**
 * מחפש ערכים במכלול לפי שאילתת טקסט חופשי, ומחזיר עד srlimit כותרות.
 *
 * @param {string} query - מחרוזת החיפוש (לדוגמה: טקסט שתומלל מההקלטה)
 * @param {number} [limit=5] - מספר תוצאות מקסימלי
 * @returns {Promise<string[]>} רשימת כותרות ערכים (יכולה להיות ריקה)
 */
async function searchMichlol(query, limit = 5) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    format: 'json',
  });

  const url = `${MICHLOL_API_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': MICHLOL_USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`חיפוש במכלול נכשל (HTTP ${res.status})`);
  }

  const data = await res.json();
  const results = (data && data.query && data.query.search) || [];
  return results.map((item) => item.title).filter(Boolean);
}

/**
 * שולף תמצית טקסט נקי (ללא ויקי-סינטקס) מתוך ערך לפי כותרת מדויקת.
 *
 * @param {string} title - כותרת הערך (כפי שחזרה מ-searchMichlol)
 * @returns {Promise<string>} טקסט התמצית, או מחרוזת ריקה אם לא נמצא
 */
async function getExtract(title) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    exintro: '1',
    titles: title,
    format: 'json',
  });

  const url = `${MICHLOL_API_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': MICHLOL_USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`שליפת תמצית מהמכלול נכשלה (HTTP ${res.status})`);
  }

  const data = await res.json();
  const pages = (data && data.query && data.query.pages) || {};
  const pageIds = Object.keys(pages);

  if (pageIds.length === 0) {
    return '';
  }

  // MediaWiki מחזיר את הדפים כאובייקט עם מפתח = page id (כולל "-1" אם לא נמצא)
  const firstPage = pages[pageIds[0]];
  if (!firstPage || firstPage.missing !== undefined) {
    return '';
  }

  return firstPage.extract || '';
}

module.exports = {
  searchMichlol,
  getExtract,
};
