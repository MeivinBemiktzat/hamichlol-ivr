/**
 * בניית תשובות למודול ה-API של ימות המשיח
 * =========================================
 *
 * ימות המשיח דורשת תשובה בטקסט רגיל (text/plain). תשובה בפורמט JSON או HTML
 * גורמת לשגיאה M1607 ("אין מענה משרת API") והמתקשר מועף מהשלוחה.
 *
 * מבנה התשובה: שורה אחת לכל פעולה, לדוגמה:
 *   id_list_message=t-שלום
 *   go_to_folder=/5
 *
 * מקטעי הקראה מופרדים בנקודה, וכל מקטע נושא קידומת:
 *   t-  טקסט שיוקרא ב-TTS
 *   n-  מספר שיוקרא כמספר
 *   f-  קובץ שמע להשמעה
 *   d-  ספרות שיוקראו אחת אחת
 *
 * כל התחביר כאן נלקח מהתיעוד הרשמי בפורום ימות המשיח (topic/56 ו-topic/11191).
 * מה שלא הצלחנו לאמת מתועד ב-docs/RESEARCH.md ולא מומש.
 */

/**
 * תווים שמשמשים את ימות כמפרידים ולכן אסורים בתוך טקסט להקראה.
 * נקודה מפרידה בין מקטעים, שווה מפריד בין פעולה לערך, ואמפרסנד סוגר תשובה.
 */
const SEPARATOR_PATTERN = /[.=&]/g;

/** תווים שאינם נקראים היטב ב-TTS ורק מבלבלים את המאזין */
const NOISE_PATTERN = /[<>|{}[\]\\^~`*_#]/g;

/**
 * מנקה טקסט לקראת הקראה ב-TTS.
 * נקודות מוחלפות ברווח כדי לא לשבור את מבנה המקטעים, אבל המשמעות נשמרת
 * כי ימות עוצרת ממילא בין מקטעים.
 */
export function sanitizeSpeech(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(NOISE_PATTERN, ' ')
    .replace(SEPARATOR_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** מקטע טקסט להקראה */
export function text(value) {
  const clean = sanitizeSpeech(value);
  return clean ? `t-${clean}` : '';
}

/** מקטע מספר, יוקרא כמספר שלם ("עשרים ושלוש") */
export function number(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return '';
  return `n-${parsed}`;
}

/** מקטע ספרות, כל ספרה בנפרד ("שתיים שלוש") */
export function digits(value) {
  const clean = String(value ?? '').replace(/\D/g, '');
  return clean ? `d-${clean}` : '';
}

/** מקטע קובץ שמע. הנתיב יחסי ל-api_dir או מוחלט אם מתחיל בלוכסן. */
export function file(path) {
  const clean = String(path ?? '').trim();
  return clean ? `f-${clean}` : '';
}

/**
 * מחבר מקטעים למחרוזת הקראה אחת.
 * מקטעים ריקים מסוננים, כדי שלא ייווצרו נקודות כפולות ששוברות את התחביר.
 */
export function joinSegments(segments) {
  return segments
    .flat()
    .filter((segment) => typeof segment === 'string' && segment.length > 0)
    .join('.');
}

/**
 * השמעת הודעה בלי לבקש קלט מהמתקשר.
 * @param {string[]} segments מקטעים שנוצרו ב-text/number/file
 */
export function idListMessage(segments) {
  const joined = joinSegments(segments);
  if (!joined) return '';
  return `id_list_message=${joined}`;
}

/**
 * ברירות מחדל לשדות הפקודה read.
 * סדר השדות לפי התיעוד של api_NNN, שהוא אותו סדר שבו משתמש read.
 */
const READ_DEFAULTS = {
  /** yes = להשתמש בערך שכבר נאסף בשיחה. no = לשאול מחדש. */
  reuse: 'no',
  /** מספר ספרות מרבי. ריק = ללא הגבלה. */
  max: '',
  /** מספר ספרות מזערי */
  min: '1',
  /** שניות המתנה לקלט */
  timeout: '7',
  /** אופן הקראת הערך חזרה: NO לא מקריא בכלל */
  playbackFormat: 'No',
  /** yes = חסימת כוכבית */
  blockStar: '',
  /** yes = חסימת אפס */
  blockZero: 'No',
  /** החלפת תו: שני תווים, הראשון מוחלף בשני */
  replaceChar: '*/',
  /** מקשים מותרים, מופרדים בנקודה לערכים רב-ספרתיים. ריק = הכול. */
  allowedKeys: '',
  /** כמה פעמים לשאול לפני שמחזירים ערך ריק */
  attempts: '',
  /** Ok = לקבל ערך ריק ולהמשיך */
  acceptEmpty: '',
  /** הערך שיישלח כשהתשובה ריקה */
  emptyValue: '',
};

/**
 * מבקש קלט מהמתקשר ומחזיר אותו בבקשה הבאה בפרמטר בשם variableName.
 *
 * @param {object} options
 * @param {string[]} options.segments מקטעי ההודעה שתושמע לפני הקלט
 * @param {string} options.variableName שם הפרמטר שיחזור אלינו
 * @param {object} [options.fields] דריסה של ברירות המחדל שלמעלה
 */
export function read({ segments, variableName, fields = {} }) {
  const prompt = joinSegments(segments);
  const name = sanitizeVariableName(variableName);
  const f = { ...READ_DEFAULTS, ...fields };

  const ordered = [
    name,
    f.reuse,
    f.max,
    f.min,
    f.timeout,
    f.playbackFormat,
    f.blockStar,
    f.blockZero,
    f.replaceChar,
    f.allowedKeys,
    f.attempts,
    f.acceptEmpty,
    f.emptyValue,
  ];

  // גוזמים שדות ריקים מהסוף כדי לא לשלוח פסיקים מיותרים
  while (ordered.length > 1 && ordered[ordered.length - 1] === '') {
    ordered.pop();
  }

  return `read=${prompt}=${ordered.join(',')}`;
}

/**
 * מבקש הקלטה קולית ומקבל אותה מתומללת לטקסט.
 * זיהוי הדיבור מתבצע בצד ימות, ולכן אין צורך להוריד קובץ שמע ולתמלל בעצמנו.
 *
 * סדר השדות שונה מקלט מקשים: שדה 3 הוא 'voice', ואחריו שפה והגדרות הקלטה.
 */
export function readVoice({
  segments,
  variableName,
  language = 'he-IL',
  allowKeypad = true,
  silenceSeconds = 2,
  maxSeconds = 10,
}) {
  const prompt = joinSegments(segments);
  const name = sanitizeVariableName(variableName);

  const ordered = [
    name,
    'no', // לא להשתמש בערך קודם, תמיד לשאול מחדש
    'voice',
    language,
    allowKeypad ? '' : 'no',
    '', // מספר ספרות מרבי בקלט מקשים משולב
    '', // record - זיהוי מתוך הקלטה בלבד
    String(silenceSeconds),
    String(maxSeconds),
  ];

  while (ordered.length > 1 && ordered[ordered.length - 1] === '') {
    ordered.pop();
  }

  return `read=${prompt}=${ordered.join(',')}`;
}

/**
 * מעביר את המתקשר לשלוחה אחרת.
 * נתיב שמתחיל בלוכסן הוא מוחלט מהשורש, אחרת הוא יחסי לשלוחה הנוכחית.
 */
export function goToFolder(path) {
  return `go_to_folder=${String(path).trim()}`;
}

/** מנתק את השיחה. בימות זו שלוחת מערכת קבועה. */
export function hangup() {
  return goToFolder('hangup');
}

/** חוזר לשלוחה הראשית של המערכת */
export function goToRoot() {
  return goToFolder('/');
}

/** הערה לצורכי ניפוי שגיאות. ימות מתעלמת ממנה. */
export function noop(note) {
  return `noop=${sanitizeSpeech(note)}`;
}

/**
 * שמות משתנים נשלחים חזרה כפרמטרים ב-HTTP, ולכן מוגבלים לאותיות אנגליות,
 * ספרות וקו תחתון. המערכת משתמשת בשם המשתנה גם כדי לקודד את מצב השיחה,
 * ולכן חשוב שהוא יישאר יציב וצפוי. ראו lib/state/session.js.
 */
export function sanitizeVariableName(name) {
  const clean = String(name ?? '').replace(/[^A-Za-z0-9_]/g, '');
  if (!clean) throw new Error('שם משתנה ריק או לא חוקי בפקודת read');
  return clean;
}

/**
 * מחבר מספר פעולות לתשובה אחת.
 * ימות קוראת שורה-שורה, ולכן הסדר כאן הוא סדר הביצוע.
 */
export function buildResponse(actions) {
  return actions
    .flat()
    .filter((action) => typeof action === 'string' && action.length > 0)
    .join('\n');
}

export default {
  text,
  number,
  digits,
  file,
  idListMessage,
  read,
  readVoice,
  goToFolder,
  goToRoot,
  hangup,
  noop,
  buildResponse,
  joinSegments,
  sanitizeSpeech,
  sanitizeVariableName,
};
