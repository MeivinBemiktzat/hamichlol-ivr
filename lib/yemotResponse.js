/**
 * lib/yemotResponse.js
 * ======================
 * בניית מחרוזות התגובה שהשלוחה מסוג type=api מחזירה לימות המשיח.
 *
 * מבוסס על תיעוד "מודול API" (f2.freeivr.co.il/post/76 ושרשור התגובות שלו,
 * כולל post/78283 עבור read):
 *
 *   read=<הודעה>=<שם_פרמטר>,<שימוש_חוזר>,<סוג_קלט>,...
 *   id_list_message=t-טקסט1.t-טקסט2...
 *
 * ⚠️ הערה קריטית - לא עובדה מאומתת:
 * האורך המקסימלי שקטע t- בודד יכול להכיל לא מתועד במקורות הרשמיים
 * שנבדקו. הפונקציה splitTextToChunks למטה מפצלת טקסט ארוך למספר
 * קטעי t- לפי סוף משפט, עם ברירת מחדל זהירה של ~600 תווים לקטע.
 * יש לכייל את הערך הזה (ראה MAX_CHUNK_LENGTH) רק לאחר בדיקה טלפונית
 * בפועל מול השרת שלכם - ראה README, סעיף "דברים לבדוק לפני פרודקשן".
 */

'use strict';

// ערך התחלתי זהיר לכיול - ראה אזהרה למעלה. ניתן לשנות בלי לגעת בשאר הקוד.
const MAX_CHUNK_LENGTH = 600;

/**
 * בורח מהתווים '=' '&' ',' '.' שעלולים להתנגש עם התחביר של ימות
 * בתוך טקסט TTS חופשי. ימות עצמו לא מתעד escaping רשמי לתווים אלו
 * בתוך t-, לכן הגישה הבטוחה היא להחליף אותם בחלופה מילולית/רווח
 * ולא לסמוך על כך שהם "יעברו בשלום". ראה README - לבדוק בפועל.
 */
function sanitizeForTts(text) {
  return String(text)
    .replace(/&/g, ' ו- ')
    .replace(/=/g, ' ')
    .replace(/\r?\n+/g, ' ')
    .trim();
}

/**
 * מפצלת טקסט ארוך למספר קטעים, מועדפת חלוקה לפי סוף משפט (., !, ?)
 * כדי לא לחתוך באמצע משפט, ועד MAX_CHUNK_LENGTH תווים לקטע.
 *
 * @param {string} text
 * @param {number} [maxLength=MAX_CHUNK_LENGTH]
 * @returns {string[]} מערך קטעי טקסט, כל אחד מוכן לקידומת t-
 */
function splitTextToChunks(text, maxLength = MAX_CHUNK_LENGTH) {
  const clean = sanitizeForTts(text);
  if (!clean) {
    return [];
  }
  if (clean.length <= maxLength) {
    return [clean];
  }

  // פיצול ראשוני למשפטים (שומר את סימן הפיסוק בסוף כל משפט)
  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];

  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;

    if ((current + ' ' + trimmedSentence).trim().length > maxLength) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      // משפט בודד שארוך מ-maxLength בעצמו - חותכים אותו בכוח למקטעים
      if (trimmedSentence.length > maxLength) {
        for (let i = 0; i < trimmedSentence.length; i += maxLength) {
          chunks.push(trimmedSentence.slice(i, i + maxLength).trim());
        }
      } else {
        current = trimmedSentence;
      }
    } else {
      current = (current + ' ' + trimmedSentence).trim();
    }
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * בונה תגובת read: מבקשת פריט מידע נוסף מהמתקשר ושולחת אותו חזרה לשרת.
 *
 * @param {string} ttsMessage - הטקסט שיוקרא למתקשר (ללא קידומת t-; מתווספת כאן)
 * @param {string} paramSpec - חלק ה"סוג קלט" של ה-read, לדוגמה:
 *   "paramName,no,,1,1,10,NO" (הקשת ספרה בודדת)
 *   "paramName,no,record,/1/2,fileName,no,yes,yes,1,30" (הקלטה)
 * @returns {string} מחרוזת read= מוכנה
 */
function buildReadResponse(ttsMessage, paramSpec) {
  const message = `t-${sanitizeForTts(ttsMessage)}`;
  return `read=${message}=${paramSpec}`;
}

/**
 * בונה תגובת id_list_message סופית: מקריאה רצף טקסטים (ומפצלת
 * טקסט ארוך למספר קטעי t- בעצמה), ואופציונלית מוסיפה מעבר לשלוחה.
 *
 * @param {string} text - הטקסט המלא להקראה (יפוצל אוטומטית לפי הצורך)
 * @param {object} [options]
 * @param {string} [options.goToFolder] - אם קיים, מוסיף &go_to_folder=<ערך> בסוף
 * @returns {string} מחרוזת id_list_message= (ו-go_to_folder= אם התבקש) מוכנה
 */
function buildFinalMessage(text, options = {}) {
  const chunks = splitTextToChunks(text);

  if (chunks.length === 0) {
    chunks.push('לא נמצא תוכן להקראה');
  }

  const items = chunks.map((chunk) => `t-${chunk}`).join('.');
  let response = `id_list_message=${items}`;

  if (options.goToFolder) {
    response += `&go_to_folder=${options.goToFolder}`;
  }

  return response;
}

/**
 * בונה תגובת שגיאה ידידותית למתקשר (גם היא id_list_message, מוקראת
 * ואז מנתקת/מעבירה לתפריט הראשי לפי הצורך).
 *
 * @param {string} message - הודעת השגיאה להקראה
 * @param {object} [options] - ראה buildFinalMessage
 */
function buildErrorMessage(message, options = {}) {
  return buildFinalMessage(message, options);
}

module.exports = {
  MAX_CHUNK_LENGTH,
  sanitizeForTts,
  splitTextToChunks,
  buildReadResponse,
  buildFinalMessage,
  buildErrorMessage,
};
