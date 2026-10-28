/**
 * הגדרות המערכת
 * ================
 * כל ערך ניתן לדריסה במשתנה סביבה, אבל יש ברירות מחדל שעובדות בלי שום הגדרה.
 *
 * חשוב להבחין בין שני סוגי סודות:
 *  1. סוד תשתית גלובלי - שייך למי שמתקין את המערכת (לדוגמה טוקן Hugging Face
 *     לאחסון). הוא מוגדר כמשתנה סביבה ב-Vercel.
 *  2. טוקן אישי של משתמש ימות - מגיע מהגדרות השלוחה בכל בקשה, ולעולם לא
 *     נשמר במשתנה סביבה ולא באחסון משותף. ראו lib/yemot/params.js.
 */

const env = (key, fallback) => {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
};

const envInt = (key, fallback) => {
  const raw = env(key, null);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const envBool = (key, fallback) => {
  const raw = env(key, null);
  if (raw === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
};

export const config = {
  /** ספק התוכן: 'michlol' או 'wikipedia'. ראו lib/search/index.js */
  searchProvider: env('SEARCH_PROVIDER', 'michlol'),

  michlol: {
    apiBase: env('MICHLOL_API_BASE', 'https://www.hamichlol.org.il/api.php'),
  },

  wikipedia: {
    apiBase: env('WIKIPEDIA_API_BASE', 'https://he.wikipedia.org/w/api.php'),
  },

  /**
   * User-Agent מזהה. מדיניות ה-API של מדיה-ויקי מחייבת זיהוי אמיתי עם דרך
   * ליצירת קשר, ולכן כדאי לעדכן את כתובת המייל בעת ההתקנה.
   */
  userAgent: env(
    'HTTP_USER_AGENT',
    'MichlolIVR/1.0 (telephone accessibility project; +https://github.com/)'
  ),

  /** מגבלות רשת */
  http: {
    timeoutMs: envInt('HTTP_TIMEOUT_MS', 8000),
    maxRetries: envInt('HTTP_MAX_RETRIES', 2),
    retryBaseDelayMs: envInt('HTTP_RETRY_BASE_DELAY_MS', 250),
    maxResponseBytes: envInt('HTTP_MAX_RESPONSE_BYTES', 2 * 1024 * 1024),
  },

  /** מטמון בזיכרון הפונקציה */
  cache: {
    searchTtlMs: envInt('CACHE_SEARCH_TTL_MS', 10 * 60 * 1000),
    articleTtlMs: envInt('CACHE_ARTICLE_TTL_MS', 30 * 60 * 1000),
    maxEntries: envInt('CACHE_MAX_ENTRIES', 200),
  },

  /** חיפוש והקראה */
  search: {
    defaultResultCount: envInt('DEFAULT_RESULT_COUNT', 5),
    minResultCount: 1,
    maxResultCount: 9,
    maxQueryLength: envInt('MAX_QUERY_LENGTH', 80),
  },

  content: {
    /** אורך מקטע הקראה בתווים. מקטע ארוך מדי מעייף את המאזין. */
    segmentChars: envInt('SEGMENT_CHARS', 450),
    /** מספר מקטעים מרבי לערך, כדי לא לייצר האזנה אינסופית */
    maxSegments: envInt('MAX_SEGMENTS', 60),
  },

  /** אחסון */
  storage: {
    /** 'huggingface' | 'memory' | 'none' */
    driver: env('STORAGE_DRIVER', 'none'),
    hfToken: env('HF_TOKEN', null),
    hfRepo: env('HF_DATASET_REPO', null),
    hfEndpoint: env('HF_ENDPOINT', 'https://huggingface.co'),
    /** כתיבות מקובצות: כל כמה זמן לשטוף לאחסון */
    flushIntervalMs: envInt('STORAGE_FLUSH_INTERVAL_MS', 0),
  },

  privacy: {
    /** ברירת מחדל לשמירת היסטוריה. המשתמש יכול לכבות בתפריט ההגדרות. */
    historyEnabledByDefault: envBool('HISTORY_ENABLED_BY_DEFAULT', true),
    maxHistoryItems: envInt('MAX_HISTORY_ITEMS', 20),
    maxFavorites: envInt('MAX_FAVORITES', 50),
  },

  /** תמלול חיצוני. ברירת המחדל היא זיהוי הדיבור המובנה של ימות. */
  transcription: {
    /** 'yemot' (מובנה, מומלץ) או 'external' (api/transcribe.py) */
    mode: env('TRANSCRIPTION_MODE', 'yemot'),
    externalUrl: env('TRANSCRIBE_URL', null),
  },

  logLevel: env('LOG_LEVEL', 'info'),
  version: '1.0.0',
};

export default config;
