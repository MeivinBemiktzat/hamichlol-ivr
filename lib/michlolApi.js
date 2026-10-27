/**
 * חיפוש OpenSearch ושליפת תמציות מ-MediaWiki של המכלול.
 * משתמש ב-OpenSearch כפי שנבדק ידנית; אינו מנסה לעקוף חסימות של האתר.
 */
'use strict';

const fetch = require('node-fetch');

const MICHLOL_API_BASES = [
  'https://www.hamichlol.org.il/w/api.php',
  'https://hamichlol.org.il/w/api.php',
];
const MICHLOL_USER_AGENT =
  'hamichlol-ivr/1.1 (https://github.com/MeivinBemiktzat/hamichlol-ivr; Yemot IVR voice-search integration)';
const REQUEST_HEADERS = {
  'User-Agent': MICHLOL_USER_AGENT,
  'Api-User-Agent': MICHLOL_USER_AGENT,
  'Accept': 'application/json',
  'Accept-Language': 'he,en;q=0.8',
};

async function callMichlolApi(params) {
  let lastError;

  for (const base of MICHLOL_API_BASES) {
    const url = `${base}?${params.toString()}`;
    let res;

    try {
      res = await fetch(url, {
        method: 'GET',
        headers: REQUEST_HEADERS,
        timeout: 10000,
      });
    } catch (err) {
      lastError = new Error(`לא ניתן להתחבר ל-API של המכלול: ${err.message}`);
      lastError.code = 'MICHLOL_NETWORK_ERROR';
      console.error('[hamichlol-ivr] michlol_api_network_error', {
        host: new URL(base).host,
        message: err.message,
      });
      continue;
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch (err) {
        const error = new Error('המכלול החזיר תגובת JSON לא תקינה');
        error.code = 'MICHLOL_INVALID_JSON';
        throw error;
      }
    }

    const body = (await res.text().catch(() => '')).slice(0, 500);
    const details = {
      host: new URL(base).host,
      status: res.status,
      server: res.headers.get('server'),
      cfRay: res.headers.get('cf-ray'),
      contentType: res.headers.get('content-type'),
      bodySnippet: body.replace(/\s+/g, ' ').slice(0, 300),
    };

    console.error('[hamichlol-ivr] michlol_api_http_error', details);

    lastError = new Error(
      `בקשת API למכלול נכשלה (HTTP ${res.status}, host=${details.host})` +
      `${details.cfRay ? `, cf-ray=${details.cfRay}` : ''}` +
      `${details.bodySnippet ? `: ${details.bodySnippet}` : ''}`
    );
    lastError.code = 'MICHLOL_API_HTTP_ERROR';
    lastError.status = res.status;

    // נסה את שם המארח החלופי רק לאחר תגובת HTTP. אם האתר חוסם
    // במפורש את הבקשה, הלוג יחשוף את סוג התגובה ולא יסתיר את הסיבה.
  }

  throw lastError || new Error('לא התקבלה תגובה מה-API של המכלול');
}

/**
 * מחפש ערכים לפי שאילתת טקסט חופשי ומחזיר עד limit כותרות.
 */
async function searchMichlol(query, limit = 5) {
  const params = new URLSearchParams({
    action: 'opensearch',
    search: String(query || ''),
    limit: String(limit),
    namespace: '0',
    format: 'json',
  });

  const data = await callMichlolApi(params);

  // OpenSearch מחזיר מערך: [מונח, כותרות, תיאורים, כתובות].
  // הכותרות נמצאות באיבר [1], בניגוד למבנה query.search של action=query.
  if (!Array.isArray(data) || !Array.isArray(data[1])) {
    console.error('[hamichlol-ivr] michlol_opensearch_unexpected_response', {
      responseType: Array.isArray(data) ? 'array' : typeof data,
      responseKeys: data && !Array.isArray(data) && typeof data === 'object'
        ? Object.keys(data).slice(0, 10)
        : [],
    });
    const error = new Error('המכלול החזיר מבנה תשובה לא צפוי לחיפוש OpenSearch');
    error.code = 'MICHLOL_INVALID_OPENSEARCH_RESPONSE';
    throw error;
  }

  const titles = data[1].filter((title) => typeof title === 'string' && title.trim());
  console.info('[hamichlol-ivr] michlol_opensearch_success', {
    queryLength: String(query || '').length,
    resultCount: titles.length,
  });
  return titles.slice(0, limit);
}

/**
 * מחזיר את תקציר הערך כטקסט נקי.
 */
async function getExtract(title) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    exintro: '1',
    titles: String(title || ''),
    format: 'json',
  });

  const data = await callMichlolApi(params);
  const pages = (data && data.query && data.query.pages) || {};
  const pageIds = Object.keys(pages);

  if (!pageIds.length) return '';

  const page = pages[pageIds[0]];
  if (!page || page.missing !== undefined) return '';
  return page.extract || '';
}

module.exports = { searchMichlol, getExtract };
