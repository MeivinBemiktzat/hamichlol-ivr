/**
 * שכבת מקור התוכן
 * =================
 * כל שאר המערכת מדברת רק עם הממשק שכאן, ולא יודעת מאיזה אתר מגיע המידע.
 * החלפת מקור התוכן היא שינוי של משתנה סביבה אחד, בלי לגעת בתפריטים,
 * בהקראה או בניהול המצב.
 *
 * הממשק שכל ספק חייב לממש:
 *   search(query, limit)  -> [{title, snippet, pageId}]
 *   getArticle(title)     -> {title, text}
 *   suggest(query, limit) -> [title]
 */

import { MediaWikiProvider } from './mediawiki.js';
import { config } from '../config.js';

/**
 * המכלול.
 *
 * אזהרה מתועדת: לא הצלחנו לאמת את הממשק בפועל. האתר מחזיר 403 ודף אתגר
 * של Cloudflare לכל פנייה מהשרת. המימוש מניח מדיה-ויקי סטנדרטי.
 * אם הגישה נחסמת גם מ-Vercel, יש לפנות למפעילי המכלול ולבקש גישה, או
 * להחליף זמנית את הספק. ראו docs/RESEARCH.md.
 */
export const michlolProvider = new MediaWikiProvider({
  id: 'michlol',
  name: 'המכלול',
  apiBase: config.michlol.apiBase,
  verified: false,
});

/**
 * ויקיפדיה העברית.
 * הממשק מתועד רשמית ופתוח לשימוש, ולכן משמש כספק חלופי מוכח.
 */
export const wikipediaProvider = new MediaWikiProvider({
  id: 'wikipedia',
  name: 'ויקיפדיה',
  apiBase: config.wikipedia.apiBase,
  verified: true,
});

const PROVIDERS = {
  michlol: michlolProvider,
  wikipedia: wikipediaProvider,
};

/**
 * מחזיר את הספק הפעיל.
 * @param {string} [id] דריסה מפורשת, בעיקר לבדיקות
 */
export function getProvider(id) {
  const key = id ?? config.searchProvider;
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(`ספק תוכן לא מוכר: ${key}. הערכים האפשריים: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

/** רישום ספק נוסף, לשימוש בבדיקות ובהרחבות עתידיות */
export function registerProvider(id, provider) {
  PROVIDERS[id] = provider;
}

export default { getProvider, registerProvider, michlolProvider, wikipediaProvider };
