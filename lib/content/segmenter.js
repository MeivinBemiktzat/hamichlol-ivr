/**
 * חיתוך תוכן למקטעי הקראה
 * =========================
 * ערך אנציקלופדי יכול להיות אלפי מילים. הקראה רצופה כזו בטלפון היא בלתי
 * נסבלת, ולכן מחלקים את התוכן למקטעים שהמתקשר מנווט ביניהם.
 *
 * הדרישה המרכזית: לא לקטוע משפטים באופן שרירותי. לכן החיתוך נעשה בגבולות
 * משפט, ורק כשאין ברירה בגבול מילה.
 */

import { config } from '../config.js';

/**
 * סימני סוף משפט בעברית.
 * נקודתיים נכללות כי בערכים אנציקלופדיים הן פותחות רשימה, וזו נקודת עצירה
 * טבעית להקראה.
 */
const SENTENCE_END = /([.!?:])\s+/g;

/** כותרות פרקים שמדיה-ויקי מחזיר בפורמט explaintext */
const HEADING_PATTERN = /^\s*={2,}\s*(.+?)\s*={2,}\s*$/;

/**
 * מפצל טקסט למשפטים.
 * ראשי תיבות נפוצים בעברית מוגנים מחיתוך שגוי.
 */
export function splitSentences(text) {
  const protectedText = protectAbbreviations(text);

  const parts = [];
  let lastIndex = 0;
  let match;

  SENTENCE_END.lastIndex = 0;
  while ((match = SENTENCE_END.exec(protectedText)) !== null) {
    const end = match.index + match[1].length;
    const sentence = protectedText.slice(lastIndex, end).trim();
    if (sentence) parts.push(sentence);
    lastIndex = SENTENCE_END.lastIndex;
  }

  const tail = protectedText.slice(lastIndex).trim();
  if (tail) parts.push(tail);

  return parts.map(restoreAbbreviations).filter(Boolean);
}

/**
 * ראשי תיבות עבריים מכילים גרשיים ולעיתים נקודות, ופיצול תמים היה חותך
 * אותם באמצע. מחליפים זמנית את הנקודה בתו שמור.
 */
const PLACEHOLDER = '\u0001';
const ABBREVIATIONS = [
  'וכו.',
  'וגו.',
  'עמ.',
  'עמוד.',
  'ר.',
  'ד.',
  'פרופ.',
  'ע.',
  'ש.',
];

function protectAbbreviations(text) {
  let out = String(text);
  for (const abbr of ABBREVIATIONS) {
    out = out.split(abbr).join(abbr.replace('.', PLACEHOLDER));
  }
  // מספרים עשרוניים: 3.14 אינו סוף משפט
  out = out.replace(/(\d)\.(\d)/g, `$1${PLACEHOLDER}$2`);
  return out;
}

function restoreAbbreviations(text) {
  return text.split(PLACEHOLDER).join('.');
}

/**
 * מנקה טקסט גולמי של מדיה-ויקי לקראת הקראה.
 * מסיר פרקים שאין טעם להקריא בטלפון, כמו רשימות קישורים חיצוניים.
 */
export function cleanArticleText(raw) {
  const SKIP_HEADINGS = [
    'קישורים חיצוניים',
    'הערות שוליים',
    'לקריאה נוספת',
    'ראו גם',
    'מקורות',
    'ביבליוגרפיה',
  ];

  const lines = String(raw).split('\n');
  const kept = [];
  let skipping = false;

  for (const line of lines) {
    const heading = line.match(HEADING_PATTERN);

    if (heading) {
      const title = heading[1].trim();
      skipping = SKIP_HEADINGS.some((skip) => title.startsWith(skip));
      if (!skipping) kept.push(`\n${title}.`);
      continue;
    }

    if (skipping) continue;

    const trimmed = line.trim();
    if (trimmed) kept.push(trimmed);
  }

  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * מחלק טקסט למקטעים להקראה.
 *
 * @param {string} text טקסט נקי
 * @param {object} [options]
 * @param {number} [options.maxChars] אורך מקטע מרבי
 * @param {number} [options.maxSegments] מספר מקטעים מרבי
 * @returns {string[]}
 */
export function segment(text, options = {}) {
  const maxChars = options.maxChars ?? config.content.segmentChars;
  const maxSegments = options.maxSegments ?? config.content.maxSegments;

  const clean = String(text ?? '').trim();
  if (!clean) return [];

  const sentences = splitSentences(clean);
  const segments = [];
  let current = '';

  for (const sentence of sentences) {
    // משפט שארוך מעצמו ממקטע שלם: חותכים אותו בגבול מילה
    if (sentence.length > maxChars) {
      if (current) {
        segments.push(current.trim());
        current = '';
      }
      segments.push(...splitLongSentence(sentence, maxChars));
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;

    if (candidate.length > maxChars) {
      segments.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) segments.push(current.trim());

  if (segments.length > maxSegments) {
    const truncated = segments.slice(0, maxSegments);
    truncated.push('כאן מסתיימת ההקראה. הערך ארוך מהמותר להשמעה בטלפון');
    return truncated;
  }

  return segments;
}

/** חותך משפט ארוך מדי בגבול מילה, ולא באמצע מילה */
function splitLongSentence(sentence, maxChars) {
  const words = sentence.split(/\s+/);
  const chunks = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * מכין ערך שלם להקראה: ניקוי וחיתוך במכה אחת.
 * @returns {{title:string, segments:string[], totalSegments:number}}
 */
export function prepareArticle(article, options = {}) {
  const cleaned = cleanArticleText(article.text);
  const segments = segment(cleaned, options);

  return {
    title: article.title,
    segments,
    totalSegments: segments.length,
  };
}

export default { segment, splitSentences, cleanArticleText, prepareArticle };
