/**
 * לקוח HTTP למקורות חיצוניים
 * ============================
 * אחראי על: מגבלת זמן, ניסיונות חוזרים מוגבלים לשגיאות זמניות בלבד,
 * השהיה מתגברת בין ניסיונות, הגבלת גודל תשובה, וזיהוי חסימה.
 *
 * מה שלא עושים כאן, במכוון:
 *  - אין ניסיונות חוזרים אינסופיים.
 *  - אין ניסיון לעקוף חסימה של אתר. חסימה מזוהה, מדווחת ומוחזרת כשגיאה.
 */

import { config } from './config.js';
import { logger } from './logger.js';
import { SourceBlockedError, SourceUnavailableError, TimeoutError } from './errors.js';

/** קודי HTTP שמצדיקים ניסיון חוזר: תקלה זמנית בצד השרת או עומס */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** קודים שמעידים על חסימה מכוונת. ניסיון חוזר רק יחמיר. */
const BLOCKED_STATUS = new Set([401, 403, 451]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * מזהה דף אתגר של Cloudflare או שער הגנה דומה.
 * כשזה קורה, המקור חוסם גישה אוטומטית והמערכת מדווחת על כך בבירור
 * במקום לנסות לעקוף.
 */
export function looksLikeChallengePage(body, contentType) {
  if (!body) return false;
  if (contentType && contentType.includes('application/json')) return false;
  const head = body.slice(0, 2000).toLowerCase();
  return (
    head.includes('just a moment') ||
    head.includes('cf-browser-verification') ||
    head.includes('challenges.cloudflare.com') ||
    head.includes('enable javascript and cookies to continue')
  );
}

/**
 * מביא JSON ממקור חיצוני.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRetries]
 * @param {AbortSignal} [options.signal]
 */
export async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? config.http.timeoutMs;
  const maxRetries = options.maxRetries ?? config.http.maxRetries;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      // השהיה מתגברת, כדי לא להציף מקור שכבר מתקשה
      await sleep(config.http.retryBaseDelayMs * 2 ** (attempt - 1));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': config.userAgent,
          Accept: 'application/json',
          'Accept-Language': 'he',
        },
        redirect: 'follow',
      });

      clearTimeout(timer);

      const contentType = response.headers.get('content-type') ?? '';

      if (BLOCKED_STATUS.has(response.status)) {
        const sample = await readLimited(response);
        throw new SourceBlockedError({
          url: safeUrl(url),
          status: response.status,
          challenge: looksLikeChallengePage(sample, contentType),
        });
      }

      if (RETRYABLE_STATUS.has(response.status)) {
        lastError = new SourceUnavailableError({
          url: safeUrl(url),
          status: response.status,
        });
        logger.warn('תשובה זמנית שגויה ממקור חיצוני', {
          url: safeUrl(url),
          status: response.status,
          attempt,
        });
        continue;
      }

      if (!response.ok) {
        throw new SourceUnavailableError({
          url: safeUrl(url),
          status: response.status,
        });
      }

      const body = await readLimited(response);

      if (looksLikeChallengePage(body, contentType)) {
        throw new SourceBlockedError({
          url: safeUrl(url),
          status: response.status,
          challenge: true,
        });
      }

      try {
        return JSON.parse(body);
      } catch {
        throw new SourceUnavailableError({
          url: safeUrl(url),
          reason: 'תשובה שאינה JSON תקין',
          contentType,
        });
      }
    } catch (error) {
      clearTimeout(timer);

      if (error instanceof SourceBlockedError) throw error;

      if (error?.name === 'AbortError') {
        lastError = new TimeoutError({ url: safeUrl(url), timeoutMs });
        logger.warn('פסק זמן בפנייה למקור חיצוני', {
          url: safeUrl(url),
          attempt,
        });
        continue;
      }

      if (error instanceof SourceUnavailableError) {
        lastError = error;
        continue;
      }

      lastError = new SourceUnavailableError({
        url: safeUrl(url),
        reason: error?.message,
      });
    }
  }

  throw lastError ?? new SourceUnavailableError({ url: safeUrl(url) });
}

/**
 * קורא את גוף התשובה עם תקרת גודל, כדי שמקור שמחזיר תשובה ענקית
 * לא יפיל את הפונקציה על זיכרון.
 */
async function readLimited(response) {
  const limit = config.http.maxResponseBytes;
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);

  if (Number.isFinite(declared) && declared > limit) {
    throw new SourceUnavailableError({
      reason: 'תשובה גדולה מהמותר',
      declared,
      limit,
    });
  }

  const text = await response.text();
  return text.length > limit ? text.slice(0, limit) : text;
}

/** מסיר פרמטרים שעלולים להכיל מידע רגיש לפני רישום בלוג */
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[כתובת לא תקינה]';
  }
}

export default { fetchJson, looksLikeChallengePage };
