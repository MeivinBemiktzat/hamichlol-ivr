/**
 * api/michlol.js
 * ================
 * Endpoint ראשי לשלוחת type=api בימות המשיח: חיפוש קולי באתר המכלול
 * (hamichlol.org.il) והקראת התוצאה למתקשר.
 *
 * המודול הוא stateless: ימות מצרף אוטומטית לכל קריאה את כל הפרמטרים
 * שנאספו בשיחה עד כה (ראה "רקע טכני" בהנחיות הפרויקט), ולכן אין צורך
 * בבסיס נתונים לשמירת מצב - השלב הנוכחי נקבע לפי אילו פרמטרים כבר
 * קיימים בבקשה הנוכחית.
 *
 * שלושת השלבים:
 *   (א) בקשה ראשונה, ללא פרמטר הקלטה  -> read עם בקשת הקלטה
 *   (ב) קיים פרמטר הקלטה (ReportFile)  -> הורדה, תמלול, חיפוש במכלול,
 *                                          read עם בקשת בחירה בהקשה
 *   (ג) קיים גם פרמטר הבחירה (ChosenItem) -> שליפת תמצית הערך הנבחר
 *                                             והקראתו חזרה (מפוצל לקטעים)
 *
 * שם תיקיית/קובץ ההקלטה שימות שומר אליה מוגדר כאן כקבועים, ומתואמים
 * עם ext.ini.example - אם משנים אחד, יש לשנות גם את השני.
 */

'use strict';

const { searchMichlol, getExtract } = require('../lib/michlolApi');
const { buildRecordingPath, downloadRecording } = require('../lib/yemotFiles');
const {
  buildReadResponse,
  buildFinalMessage,
  buildErrorMessage,
} = require('../lib/yemotResponse');

// --- קבועים משותפים עם ext.ini.example - אם משנים כאן, לשנות גם שם ---
const RECORDING_FOLDER = '/1/2'; // התיקייה שאליה ההקלטה נשמרת בימות
const RECORDING_FILE_NAME = 'mi_search'; // שם הקובץ (בלי סיומת)
const RECORDING_PARAM_NAME = 'RecFile'; // שם הפרמטר שימות שולח לאחר ההקלטה
const CHOICE_PARAM_NAME = 'ChosenItem'; // שם הפרמטר שימות שולח לאחר הקשת הבחירה
const MAX_RESULTS = 5;
// --- סוף קבועים משותפים ---

// כתובת שירות התמלול (ה-Python microservice הקיים, transcribe.py) -
// נדרש כמשתנה סביבה; אין ברירת מחדל מוטמעת בקוד.
const TOKEN_PARAM_NAME = 'YemotAdvancedToken'; // מוגדר בהגדרות השלוחה

module.exports = async (req, res) => {
  // ימות שולח את הבקשה כ-GET (עם query params) או כ-POST, תלוי בהגדרת
  // השלוחה. תומכים בשניהם כדי לא להתנות על כך.
  const params = { ...(req.query || {}), ...(req.body || {}) };

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  const advancedToken = params[TOKEN_PARAM_NAME] || params.YemotApiKey || params.yemotAdvancedToken;

  try {
    if (!params[CHOICE_PARAM_NAME] && !params[RECORDING_PARAM_NAME]) {
      // --- שלב א: בקשה ראשונה - בקשת הקלטה ---
      return res.status(200).send(buildStageOneResponse());
    }

    if (params[RECORDING_PARAM_NAME] && !params[CHOICE_PARAM_NAME]) {
      // --- שלב ב: יש הקלטה - תמלול, חיפוש, בקשת בחירה ---
      const response = await buildStageTwoResponse(params, req, advancedToken);
      return res.status(200).send(response);
    }

    // --- שלב ג: יש גם בחירה - הקראת התמצית ---
    const response = await buildStageThreeResponse(params, advancedToken);
    return res.status(200).send(response);
  } catch (err) {
    // לעולם לא מחזירים stack trace או HTML למתקשר - רק הודעה מוקראת
    // ידידותית, ומעבר בחזרה לתפריט הראשי (או ניתוק, לפי go_to_folder).
    // eslint-disable-next-line no-console
    console.error('שגיאה בשלוחת חיפוש קולי במכלול:', err);
    return res
      .status(200)
      .send(
        buildErrorMessage(
          'אירעה תקלה בחיפוש. אנא נסו שוב מאוחר יותר.',
          { goToFolder: '/' }
        )
      );
  }
};

/**
 * שלב א: מבקש מהמתקשר להקליט את נושא החיפוש.
 */
function buildStageOneResponse() {
  const paramSpec = [
    RECORDING_PARAM_NAME, // שם הפרמטר
    'no', // לא להשתמש בערך קיים - תמיד להקליט מחדש
    'record', // סוג קלט: הקלטה לשמירה (לא voice - התמלול נעשה בשירות שלנו)
    RECORDING_FOLDER, // תיקיית שמירה
    RECORDING_FILE_NAME, // שם קובץ
    'no', // בלי תפריט אישור אחרי ההקלטה - אישור מידי ב-#
    'yes', // לשמור גם אם המתקשר מנתק באמצע ההקלטה
    '', // (ערך שמיני - שם קובץ תוספתי, לא בשימוש כאן)
    '1', // אורך מינימלי בשניות
    '', // אורך מקסימלי - ללא הגבלה (יש לכייל בפועל אם נדרש, ראה README)
  ].join(',');

  return buildReadResponse('אנא אמרו מה ברצונכם לחפש במכלול, לאחר הצליל', paramSpec);
}

/**
 * שלב ב: מוריד את ההקלטה, שולח לתמלול, מחפש במכלול, ומבקש מהמתקשר
 * לבחור תוצאה בהקשת ספרה.
 */
async function buildStageTwoResponse(params, req, advancedToken) {
  if (!advancedToken) throw new Error('חסר טוקן API מתקדם. הגדירו YemotAdvancedToken בהגדרות השלוחה');

  // מורידים את קובץ ההקלטה מימות
  const recordingPath = buildRecordingPath(RECORDING_FOLDER, RECORDING_FILE_NAME);
  const wavBytes = await downloadRecording(recordingPath, advancedToken);

  // שולחים לתמלול לשירות הקיים (transcribe.py)
  const transcribedText = await transcribeRecording(wavBytes, req);

  if (!transcribedText) {
    // לא זוהה דיבור - חוזרים לשלב א' (מבקשים הקלטה מחדש) עם הודעה מתאימה.
    // שימו לב: אין צורך "לאפס" את RecFile - שלב א תמיד מבקש הקלטה
    // מחדש (read_answer reuse=no), כך שהבקשה הבאה תהיה הקלטה חדשה.
    const paramSpec = [
      RECORDING_PARAM_NAME,
      'no',
      'record',
      RECORDING_FOLDER,
      RECORDING_FILE_NAME,
      'no',
      'yes',
      '',
      '1',
      '',
    ].join(',');
    return buildReadResponse(
      'לא הצלחנו לזהות דיבור בהקלטה. אנא נסו שוב ואמרו מה ברצונכם לחפש',
      paramSpec
    );
  }

  // מחפשים במכלול
  const titles = await searchMichlol(transcribedText, MAX_RESULTS);

  if (titles.length === 0) {
    return buildFinalMessage(
      `לא נמצאו תוצאות עבור החיפוש: ${transcribedText}`,
      { goToFolder: '/' }
    );
  }

  // בונים הודעה שמונה את התוצאות ומבקשים בחירה בהקשה (1 עד titles.length)
  const announcement = titles
    .map((title, index) => `להקשה ${index + 1}, ${title}`)
    .join('. ');

  const paramSpec = [
    CHOICE_PARAM_NAME, // שם הפרמטר
    'no', // לא להשתמש בערך קיים
    '', // סוג קלט: ריק = ברירת מחדל (הקשה)
    '1', // מקסימום ספרה אחת
    '1', // מינימום ספרה אחת
    '15', // זמן המתנה להקשה (שניות)
    'NO', // לא להשמיע חזרה את מה שהוקש
  ].join(',');

  // שומרים את רשימת הכותרות בתוך ה-TTS עצמו אינו מעשי להעברה הלאה -
  // לכן משתמשים בגישה stateless אמיתית: שולחים את רשימת הכותרות
  // כפרמטר api_add מסוג JSON מקודד ב-query string של הבקשה הבאה הוא
  // *לא* אפשרי (ימות לא מאפשר להזריק פרמטרים דינמיים כאלה). הפתרון:
  // מחפשים במכלול *שוב* בשלב ג על סמך הטקסט המתומלל שכבר קיים
  // בפרמטרים (RecFile תורגם פעם אחת; לכן שומרים את התמלול עצמו דרך
  // שרשור read נוסף - ראה הערה ב-README על מגבלה זו ועל חלופה
  // אפשרית (קאש זמני לפי ApiCallId) אם ייבחר שיפור עתידי.
  return (
    buildReadResponse(
      `נמצאו ${titles.length} תוצאות. ${announcement}. אנא הקישו את מספר התוצאה הרצויה`,
      paramSpec
    ) + `&api_add_0=TranscribedQuery=${encodeURIComponent(transcribedText)}`
  );
}

/**
 * שלב ג: שולף את התמצית של התוצאה שנבחרה ומקריא אותה.
 *
 * הערה: מאחר שרשימת התוצאות (הכותרות) לא נשמרת בין קריאות (ראה הערה
 * בשלב ב), מריצים כאן שוב את אותו חיפוש על בסיס הטקסט המתומלל
 * ששמור בפרמטר TranscribedQuery, ובוחרים מתוכו את הפריט לפי המספר
 * שהוקש. זה כרוך בקריאת API נוספת למכלול, אך נמנע מהצורך ב-DB.
 */
async function buildStageThreeResponse(params, advancedToken) {
  if (!advancedToken) throw new Error('חסר טוקן API מתקדם. הגדירו YemotAdvancedToken בהגדרות השלוחה');
  const transcribedText = params.TranscribedQuery
    ? decodeURIComponent(params.TranscribedQuery)
    : '';

  if (!transcribedText) {
    throw new Error('חסר פרמטר TranscribedQuery - לא ניתן לשחזר את תוצאות החיפוש');
  }

  const choiceRaw = params[CHOICE_PARAM_NAME];
  const choiceIndex = parseInt(choiceRaw, 10) - 1; // ההקשה היא 1-based

  const titles = await searchMichlol(transcribedText, MAX_RESULTS);

  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= titles.length) {
    return buildErrorMessage('הבחירה שהוקשה אינה תקינה', { goToFolder: '/' });
  }

  const chosenTitle = titles[choiceIndex];
  const extract = await getExtract(chosenTitle);

  if (!extract) {
    return buildFinalMessage(`לא נמצא תוכן עבור הערך ${chosenTitle}`, {
      goToFolder: '/',
    });
  }

  return buildFinalMessage(`${chosenTitle}. ${extract}`, { goToFolder: '/' });
}

/**
 * שולח את בייטי ה-wav לשירות התמלול הקיים (transcribe.py) ומחזיר טקסט.
 */
async function transcribeRecording(wavBytes, req) {
  const fetch = require('node-fetch');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const endpoint = `${protocol}://${host}/api/transcribe`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wavBytes,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data) {
    const msg = data && data.error ? data.error : `HTTP ${res.status}`;
    throw new Error(`שירות התמלול החזיר שגיאה: ${msg}`);
  }

  return (data.text || '').trim();
}
