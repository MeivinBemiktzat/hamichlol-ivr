/**
 * ניהול מצב שיחה בלי אחסון חיצוני
 * ==================================
 *
 * הבעיה
 * -----
 * פונקציה ב-Vercel היא חסרת מצב: כל בקשה עשויה לרוץ במופע אחר, ולכן אי אפשר
 * להחזיק מצב שיחה בזיכרון. הפתרון המקובל הוא אחסון חיצוני, אבל ב-IVR זה גובה
 * מחיר כבד: כל צעד בשיחה היה דורש קריאה וכתיבה לרשת בזמן שאדם ממתין על הקו.
 *
 * הפתרון
 * ------
 * ימות המשיח שולחת בכל בקשה את כל הערכים שנאספו עד כה באותה שיחה. אנחנו
 * מנצלים את זה: המצב מקודד בתוך *שם המשתנה* שאנחנו מבקשים.
 *
 * מבנה השם:
 *     s_<step>_<screen>_<arg1>_<arg2>
 *
 * לדוגמה, כשהמתקשר נמצא במקטע 14 של תוצאה מספר 2, בצעד 7 של השיחה:
 *     s_7_listen_2_14
 *
 * כשהוא מקיש 1, ימות מחזירה לנו את הפרמטר s_7_listen_2_14=1. מתוך השם אנחנו
 * יודעים בדיוק איפה הוא היה, ומתוך הערך מה הוא ביקש.
 *
 * מספר הצעד עולה בכל מסך, ולכן גם כשמצטברים פרמטרים רבים באותה שיחה, הצעד
 * הגבוה ביותר הוא תמיד המסך הנוכחי. כך המצב חד-משמעי בלי שום תלות בסדר
 * הפרמטרים, שאינו מובטח ב-HTTP.
 *
 * התוצאה: אפס קריאות ואפס כתיבות לאחסון במהלך שיחה, וזמן תגובה שנקבע רק
 * על ידי מקור התוכן.
 *
 * מגבלה מתועדת
 * -------------
 * שמות משתנים חוזרים אל השרת כפרמטרי HTTP, ולכן מוגבלים לאותיות אנגליות,
 * ספרות וקו תחתון. לכן ארגומנטים חייבים להיות מספרים או מזהים קצרים, ולא
 * טקסט חופשי. שאילתת החיפוש עצמה, שהיא טקסט בעברית, נשמרת בערך של פרמטר
 * נפרד (q_<step>) ולא בשם.
 */

/** תחילית לכל שם משתנה שמקודד מצב */
const PREFIX = 's';

/** תחילית לפרמטר שמחזיק את שאילתת החיפוש */
const QUERY_PREFIX = 'q';

/** שמות המסכים. חייבים להיות אותיות אנגליות בלבד, בלי קו תחתון. */
export const Screen = {
  MAIN: 'main',
  SEARCHINPUT: 'searchinput',
  SEARCHMODE: 'searchmode',
  RESULTS: 'results',
  LISTEN: 'listen',
  HISTORY: 'history',
  FAVORITES: 'favorites',
  SETTINGS: 'settings',
  SETRESULTCOUNT: 'setresultcount',
  HELP: 'help',
  CONFIRMDELETE: 'confirmdelete',
};

const SCREEN_VALUES = new Set(Object.values(Screen));

/**
 * בונה שם משתנה שמקודד מצב.
 * @param {number} step מספר הצעד בשיחה, עולה מונוטונית
 * @param {string} screen אחד מערכי Screen
 * @param {Array<number|string>} args ארגומנטים מספריים או מזהים קצרים
 */
export function encodeState(step, screen, args = []) {
  if (!SCREEN_VALUES.has(screen)) {
    throw new Error(`מסך לא מוכר: ${screen}`);
  }
  if (!Number.isInteger(step) || step < 0) {
    throw new Error(`מספר צעד לא חוקי: ${step}`);
  }

  const safeArgs = args.map((arg) => {
    const clean = String(arg).replace(/[^A-Za-z0-9]/g, '');
    if (clean === '') {
      throw new Error('ארגומנט מצב ריק או לא חוקי');
    }
    return clean;
  });

  return [PREFIX, step, screen, ...safeArgs].join('_');
}

/**
 * מפענח שם משתנה בחזרה למצב.
 * @returns {{step:number, screen:string, args:string[]}|null}
 */
export function decodeState(name) {
  if (typeof name !== 'string') return null;
  const parts = name.split('_');
  if (parts.length < 3) return null;
  if (parts[0] !== PREFIX) return null;

  const step = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(step) || step < 0) return null;

  const screen = parts[2];
  if (!SCREEN_VALUES.has(screen)) return null;

  return { step, screen, args: parts.slice(3) };
}

/** שם הפרמטר שיחזיק את שאילתת החיפוש בצעד נתון */
export function encodeQueryName(step) {
  if (!Number.isInteger(step) || step < 0) {
    throw new Error(`מספר צעד לא חוקי: ${step}`);
  }
  return `${QUERY_PREFIX}_${step}`;
}

/**
 * מאתר את המצב הנוכחי מתוך כל הפרמטרים שנאספו בשיחה.
 * המסך עם מספר הצעד הגבוה ביותר הוא המסך שהמתקשר ענה עליו זה עתה.
 *
 * @param {Record<string,string>} collected
 * @returns {{step:number, screen:string, args:string[], value:string}|null}
 */
export function currentState(collected) {
  let best = null;

  for (const [name, value] of Object.entries(collected)) {
    const decoded = decodeState(name);
    if (!decoded) continue;
    if (best === null || decoded.step > best.step) {
      best = { ...decoded, value: String(value) };
    }
  }

  return best;
}

/**
 * מאתר את שאילתת החיפוש האחרונה שהמתקשר מסר.
 * @returns {{step:number, query:string}|null}
 */
export function currentQuery(collected) {
  let best = null;

  for (const [name, value] of Object.entries(collected)) {
    if (!name.startsWith(`${QUERY_PREFIX}_`)) continue;
    const step = Number.parseInt(name.slice(QUERY_PREFIX.length + 1), 10);
    if (!Number.isInteger(step)) continue;
    const query = String(value).trim();
    if (!query) continue;
    if (best === null || step > best.step) {
      best = { step, query };
    }
  }

  return best;
}

/**
 * מספר הצעד הבא בשיחה.
 * מבוסס על הצעד הגבוה ביותר שראינו, כולל פרמטרי שאילתה, ולכן עולה תמיד.
 */
export function nextStep(collected) {
  let max = -1;

  for (const name of Object.keys(collected)) {
    const decoded = decodeState(name);
    if (decoded && decoded.step > max) {
      max = decoded.step;
      continue;
    }
    if (name.startsWith(`${QUERY_PREFIX}_`)) {
      const step = Number.parseInt(name.slice(QUERY_PREFIX.length + 1), 10);
      if (Number.isInteger(step) && step > max) max = step;
    }
  }

  return max + 1;
}

/**
 * הגנה מפני לולאה אינסופית בין שלוחות.
 * אם מספר הצעדים בשיחה חרג מהסביר, מסיימים בנימוס במקום להמשיך לנצח.
 */
export const MAX_STEPS = 300;

export function isRunaway(collected) {
  return nextStep(collected) > MAX_STEPS;
}

export default {
  Screen,
  encodeState,
  decodeState,
  encodeQueryName,
  currentState,
  currentQuery,
  nextStep,
  isRunaway,
  MAX_STEPS,
};
