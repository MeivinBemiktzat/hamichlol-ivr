/**
 * lib/yemotSession.js
 * ====================
 * ניהול "טוקן רציני" מול ה-Management API של ימות המשיח.
 *
 * למה לא פשוט להשתמש ב-token=<מספר_מערכת>:<סיסמה> בכל קריאה?
 * -------------------------------------------------------------
 * לפי תיעוד ימות המשיח (apiforum.yemot.tel, "התחברות", נועם חיון,
 * מפתח ימות המשיח), הפרמטר token שנשלח בכל קריאה יכול להיות אחד משניים:
 *   1. "username:password" ישירות (הסיסמה עצמה, בטקסט גלוי, בכל בקשה).
 *   2. טוקן אמיתי שמתקבל ממש פעם מפקודת Login (עם username+password),
 *      וממנה והלאה משתמשים רק בטוקן הזה - ללא חשיפת הסיסמה שוב.
 *      הטוקן תקף כל עוד נעשה בו שימוש (פג אחרי 30 דקות חוסר פעילות).
 *
 * המודול הזה מממש את אפשרות 2: מבצע Login פעם אחת, שומר את הטוקן
 * שהתקבל בזיכרון התהליך (module-level cache), ומשתמש בו שוב בקריאות
 * הבאות. אם קריאה נכשלת בגלל טוקן שפג - מתחבר מחדש אוטומטית, פעם אחת,
 * ומנסה שוב.
 *
 * הערה חשובה לסביבת Vercel serverless:
 * מופע (instance) של פונקציית Vercel יכול "להתקרר" (cold start) בכל רגע,
 * ואז הקאש בזיכרון מתאפס - זה תקין וצפוי. לכן אין להסתמך על כך שהטוקן
 * תמיד יהיה בזיכרון; יש תמיד לבדוק ולהתחבר מחדש במידת הצורך.
 * אין צורך ב-DB חיצוני בשביל זה - זה רק אופטימיזציה (חוסך Login מיותר
 * בתוך אותו מופע חם), לא דרישה לתקינות.
 */

'use strict';

const fetch = require('node-fetch');

const MANAGEMENT_API_BASE = 'https://www.call2all.co.il/ym/api';

// קאש בזיכרון התהליך בלבד - לא בין מופעים שונים של הפונקציה.
let cachedToken = null;

/**
 * מבצע התחברות (Login) מול ה-Management API ומחזיר טוקן session אמיתי.
 * דורש YEMOT_SYSTEM_NUMBER ו-YEMOT_SYSTEM_PASSWORD במשתני הסביבה
 * (מוגדרים פעם אחת בצד השרת בלבד - ראה README).
 */
async function login() {
  const username = process.env.YEMOT_SYSTEM_NUMBER;
  const password = process.env.YEMOT_SYSTEM_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'חסרים משתני סביבה YEMOT_SYSTEM_NUMBER / YEMOT_SYSTEM_PASSWORD - ' +
        'אלו נדרשים כדי לבצע Login מול ימות המשיח ולקבל טוקן session.'
    );
  }

  const url = `${MANAGEMENT_API_BASE}/Login?username=${encodeURIComponent(
    username
  )}&password=${encodeURIComponent(password)}`;

  const res = await fetch(url, { method: 'GET' });
  const data = await res.json().catch(() => null);

  if (!data || data.responseStatus !== 'OK' || !data.token) {
    const msg = data && data.message ? data.message : 'תגובה לא תקינה מימות';
    throw new Error(`Login לימות נכשל: ${msg}`);
  }

  cachedToken = data.token;
  return cachedToken;
}

/**
 * מחזיר טוקן session בתוקף - מהקאש אם קיים, אחרת מתחבר מחדש.
 */
async function getToken() {
  if (cachedToken) {
    return cachedToken;
  }
  return login();
}

/**
 * מבצע קריאת GET מול ה-Management API עם הטוקן הנוכחי, ומתחבר מחדש
 * פעם אחת ומנסה שוב אם מתברר שהטוקן פג/לא תקין.
 *
 * @param {string} command - שם הפקודה, למשל 'DownloadFile'
 * @param {object} params - פרמטרים נוספים לשליחה (ללא token - הוא מתווסף אוטומטית)
 * @param {object} [options] - options של node-fetch (למשל אם רוצים bytes גולמיים)
 * @returns {Promise<Response>} תגובת ה-fetch הגולמית (הקורא מחליט איך לפרסר)
 */
async function callManagementApi(command, params, options = {}) {
  const attempt = async (token) => {
    const qs = new URLSearchParams({ token, ...params });
    const url = `${MANAGEMENT_API_BASE}/${command}?${qs.toString()}`;
    return fetch(url, { method: 'GET', ...options });
  };

  let token = await getToken();
  let res = await attempt(token);

  // אם הטוקן פג/לא תקין, ימות בדרך כלל יחזיר JSON עם responseStatus
  // שגוי. מאחר שלפעמים התגובה היא בינארית (כמו בהורדת קובץ), בודקים
  // רק אם זה בכלל JSON ורק סטטוס HTTP לא תקין/401/403 כסימן לפוג תוקף.
  if (res.status === 401 || res.status === 403) {
    cachedToken = null;
    token = await getToken();
    res = await attempt(token);
  }

  return res;
}

module.exports = {
  getToken,
  callManagementApi,
};
