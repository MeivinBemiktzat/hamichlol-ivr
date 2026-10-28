/**
 * פענוח הפרמטרים שימות המשיח שולחת למודול
 * ==========================================
 *
 * ימות שולחת בכל בקשה קבוצת פרמטרים קבועה, ובנוסף כל ערך שנאסף מהמתקשר
 * קודם לכן באותה שיחה. התיעוד הרשמי (topic/56) מגדיר את הפרמטרים הבאים:
 *
 *   ApiCallId        מזהה ייחודי לשיחה
 *   ApiPhone         מספר הטלפון של המתקשר
 *   ApiDID           מספר המערכת הראשי
 *   ApiRealDID       המספר שאליו חייג המתקשר בפועל
 *   ApiExtension     השלוחה שבה נמצא המתקשר
 *   ApiEnterID       סוג ההזדהות ומזהה המשתמש, אם התחבר
 *   ApiEnterIDName   שם המשויך להזדהות
 *   ApiTime          שניות מאז 1970
 *   hangup=yes       נשלח כשהמתקשר מנתק
 *
 * פרמטרים סטטיים שהוגדרו בשלוחה (api_add_0=key=value) מגיעים כמו פרמטר רגיל.
 * כך מגיע גם הטוקן האישי של בעל המערכת, אם הוא הוגדר בשלוחה.
 */

import { config } from '../config.js';

/** הפרמטרים שימות שולחת מעצמה, ולא נאספו מהמתקשר */
const SYSTEM_PARAMS = new Set([
  'ApiCallId',
  'ApiPhone',
  'ApiDID',
  'ApiRealDID',
  'ApiExtension',
  'ApiEnterID',
  'ApiEnterIDName',
  'ApiTime',
  'ApiHangupExtension',
  'ReferredFrom',
  'hangup',
]);

/**
 * שמות הפרמטרים שעשויים להכיל טוקן אישי.
 * הם נחסמים בלוגים ולא נשמרים באחסון. ראו lib/logger.js.
 */
export const SECRET_PARAM_NAMES = new Set([
  'token',
  'Token',
  'api_token',
  'ApiToken',
  'yemot_token',
  'password',
  'Password',
]);

/** ערך שימות שולחת כשהמתקשר לא הקיש כלום */
const EMPTY_VALUES = new Set(['', 'None', 'none', 'null']);

/**
 * ממיר גוף בקשה או query string לאובייקט פרמטרים שטוח.
 * תומך גם ב-GET וגם ב-POST (ימות שולחת POST כש-api_url_post=yes).
 */
export function collectRawParams(req) {
  const result = {};

  // פרמטרים מה-URL
  const url = new URL(req.url ?? '/', `http://${req.headers?.host ?? 'localhost'}`);
  for (const [key, value] of url.searchParams.entries()) {
    result[key] = value;
  }

  // פרמטרים מגוף הבקשה. Vercel מפענח JSON ו-urlencoded לבד.
  const body = req.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string' || typeof value === 'number') {
        result[key] = String(value);
      }
    }
  } else if (typeof body === 'string' && body.length > 0) {
    for (const [key, value] of new URLSearchParams(body).entries()) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * מנקה ערך שהגיע מהמתקשר.
 * ימות מחליפה כוכבית בלוכסן לפי ההגדרה replaceChar, ולכן מסירים אותו.
 */
export function cleanValue(value) {
  if (value === null || value === undefined) return '';
  const trimmed = String(value).trim();
  if (EMPTY_VALUES.has(trimmed)) return '';
  return trimmed;
}

/**
 * בונה אובייקט שיחה מסודר מהפרמטרים הגולמיים.
 *
 * @returns {{
 *   callId: string, phone: string, did: string, extension: string,
 *   isHangup: boolean, time: number,
 *   userToken: string|null,
 *   collected: Record<string,string>,
 *   raw: Record<string,string>
 * }}
 */
export function parseCall(req) {
  const raw = collectRawParams(req);

  /** ערכים שנאספו מהמתקשר, בלי פרמטרי המערכת ובלי סודות */
  const collected = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SYSTEM_PARAMS.has(key)) continue;
    if (SECRET_PARAM_NAMES.has(key)) continue;
    const clean = cleanValue(value);
    if (clean !== '') collected[key] = clean;
  }

  /**
   * טוקן אישי שהוגדר בהגדרות השלוחה.
   * הוא נשמר בנפרד, לא נכנס ל-collected, לא נרשם בלוג ולא נשמר באחסון.
   * כרגע המערכת אינה זקוקה לו, כי החיפוש מתבצע מול מקור ציבורי.
   */
  let userToken = null;
  for (const name of SECRET_PARAM_NAMES) {
    if (raw[name]) {
      userToken = String(raw[name]);
      break;
    }
  }

  return {
    callId: cleanValue(raw.ApiCallId) || 'unknown',
    phone: cleanValue(raw.ApiPhone) || '',
    did: cleanValue(raw.ApiDID) || '',
    realDid: cleanValue(raw.ApiRealDID) || '',
    extension: cleanValue(raw.ApiExtension) || '',
    enterId: cleanValue(raw.ApiEnterID) || '',
    isHangup: cleanValue(raw.hangup).toLowerCase() === 'yes',
    time: Number.parseInt(raw.ApiTime, 10) || Math.floor(Date.now() / 1000),
    userToken,
    collected,
    raw,
  };
}

/**
 * מזהה משתמש יציב לצורך היסטוריה ומועדפים.
 *
 * מטעמי פרטיות לא שומרים את מספר הטלפון עצמו באחסון, אלא גיבוב חד-כיווני
 * שלו. כך גם אם האחסון ייחשף, לא ניתן לשחזר ממנו מספרי טלפון.
 * המלח (salt) הוא סוד תשתית שמוגדר ב-Vercel, ואם הוא חסר המערכת עובדת
 * בלי שמירת היסטוריה במקום לשמור מזהים חלשים.
 */
export async function userKey(phone) {
  const salt = process.env.USER_ID_SALT;
  if (!salt || !phone) return null;

  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${phone}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** בדיקה שהשאילתה סבירה לפני שליחתה למקור החיצוני */
export function validateQuery(query) {
  const clean = String(query ?? '').trim();
  if (!clean) return { ok: false, reason: 'empty' };
  if (clean.length > config.search.maxQueryLength) {
    return { ok: false, reason: 'too_long' };
  }
  return { ok: true, value: clean };
}

export default { parseCall, collectRawParams, cleanValue, userKey, validateQuery };
