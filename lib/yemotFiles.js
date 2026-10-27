/**
 * lib/yemotFiles.js
 * ===================
 * הורדת קובץ הקלטה ששמר ימות המשיח, דרך פקודת DownloadFile של ה-Management API.
 *
 * מקור: apiforum.yemot.tel/post/469 ו-f2.freeivr.co.il/post/32032
 * (הפקודה DownloadFile, פרמטרים token + path).
 *
 * הערה על נתיב (path):
 * בדוגמאות הרשמיות הנתיב מופיע לעיתים עם קידומת "ivr2:" (לדוגמה
 * "ivr2:/1/1/000.wav") ולעיתים בלי הקידומת (רק "/1/1/000.wav").
 * זה אחד הדברים שסומנו ב-README כדבר שחובה לוודא בבדיקה טלפונית/API
 * בפועל בשרת הספציפי שלכם - לכן מאפשרים כאן קונפיגורציה (ראה
 * YEMOT_RECORDINGS_PATH_PREFIX במשתני הסביבה) ולא קובעים זאת כעובדה.
 */

'use strict';

const { callManagementApi } = require('./yemotSession');

/**
 * בונה את נתיב הקובץ המלא להורדה, מתוך תיקיית השמירה ושם הקובץ
 * שחזרו מימות בפרמטרים של השיחה (ApiExtension / קבצי ה-read).
 *
 * @param {string} folder - לדוגמה "/1/2" (תיקיית השלוחה שבה נשמרה ההקלטה)
 * @param {string} fileName - שם הקובץ, למשל "mi_search_1" (בלי סיומת או עם .wav)
 * @returns {string} נתיב מלא לשליחה ל-DownloadFile
 */
function buildRecordingPath(folder, fileName) {
  const prefix = process.env.YEMOT_RECORDINGS_PATH_PREFIX || ''; // לדוגמה "ivr2:" אם יתברר שנדרש
  const cleanFolder = folder.startsWith('/') ? folder : `/${folder}`;
  const cleanFile = fileName.endsWith('.wav') ? fileName : `${fileName}.wav`;
  return `${prefix}${cleanFolder}/${cleanFile}`;
}

/**
 * מוריד את בייטי קובץ ה-wav של ההקלטה מימות המשיח.
 *
 * @param {string} path - נתיב הקובץ (תוצאה של buildRecordingPath, או נתיב מלא ידוע)
 * @returns {Promise<Buffer>} בייטי קובץ ה-wav
 */
async function downloadRecording(path) {
  const res = await callManagementApi('DownloadFile', { path });

  if (!res.ok) {
    throw new Error(`הורדת ההקלטה מימות נכשלה (HTTP ${res.status})`);
  }

  const contentType = res.headers.get('content-type') || '';

  // אם ימות מחזיר JSON - כנראה שגיאה (קובץ לא נמצא / בעיית הרשאות)
  // ולא בייטי אודיו. מטפלים בזה כאן כדי לתת שגיאה ברורה למעלה.
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => null);
    const msg = data && data.message ? data.message : 'תגובת JSON לא צפויה במקום קובץ אודיו';
    throw new Error(`ימות החזיר שגיאה בהורדת הקובץ: ${msg}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  buildRecordingPath,
  downloadRecording,
};
