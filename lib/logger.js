/**
 * לוגים
 * =====
 * שני כללים מנחים:
 *  1. אף טוקן, סיסמה או מספר טלפון מלא לא נרשם בלוג.
 *  2. למתקשר חוזרת הודעה ידידותית, ואילו הפרטים הטכניים נשארים בלוג בלבד.
 */

import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

/** דפוסים של ערכים שאסור שיופיעו בלוג */
const REDACT_KEYS = /^(token|password|secret|authorization|api_?key|hf_?token)$/i;

/**
 * ממסך מספר טלפון: שומר רק את שלוש הספרות האחרונות.
 * מספיק כדי לקשר בין שורות לוג של אותה שיחה, בלי לזהות אדם.
 */
export function maskPhone(phone) {
  const clean = String(phone ?? '').replace(/\D/g, '');
  if (clean.length <= 3) return '***';
  return `***${clean.slice(-3)}`;
}

/** מנקה אובייקט מפרטים רגישים לפני רישום */
export function redact(value, depth = 0) {
  if (depth > 4) return '[עומק מרבי]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (REDACT_KEYS.test(key)) {
        out[key] = '[הוסתר]';
      } else if (/phone/i.test(key)) {
        out[key] = maskPhone(inner);
      } else {
        out[key] = redact(inner, depth + 1);
      }
    }
    return out;
  }

  if (typeof value === 'string' && value.length > 300) {
    return `${value.slice(0, 300)}...[${value.length} תווים]`;
  }

  return value;
}

function emit(level, message, context) {
  if (LEVELS[level] < threshold) return;

  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? { context: redact(context) } : {}),
  };

  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  debug: (message, context) => emit('debug', message, context),
  info: (message, context) => emit('info', message, context),
  warn: (message, context) => emit('warn', message, context),
  error: (message, context) => emit('error', message, context),
};

export default logger;
