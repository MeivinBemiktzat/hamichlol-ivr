/**
 * חיפוש OpenSearch ושליפת תמציות מ-MediaWiki של המכלול.
 * משתמש ב-OpenSearch כפי שנבדק ידנית; אינו מנסה לעקוף חסימות של האתר.
 */
'use strict';

const fetch = require('node-fetch');

const WIKIPEDIA_API_BASE = 'https://he.wikipedia.org/w/rest.php/v1';

const MICHLOL_USER_AGENT =
  'hamichlol-ivr/1.2 (https://github.com/MeivinBemiktzat/hamichlol-ivr; Yemot IVR voice-search integration)';
const REQUEST_HEADERS = {
  'User-Agent': MICHLOL_USER_AGENT,
  'Api-User-Agent': MICHLOL_USER_AGENT,
  'Accept': 'application/json',
  'Accept-Language': 'he,en;q=0.8',
};

async function callWikipediaApi(url, label) {
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: REQUEST_HEADERS,
      timeout: 10000,
    });
  } catch (err) {
    console.error('[hamichlol-ivr] wikipedia_network_error', {
      endpoint: label,
      message: err.message,
    });
    const error = new Error(`לא ניתן להתחבר ל-API של ויקיפדיה: ${err.message}`);
    error.code = 'WIKIPEDIA_NETWORK_ERROR';
    throw error;
  }

  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    const details = {
      endpoint: label,
      status: res.status,
      server: res.headers.get('server'),
      cfRay: res.headers.get('cf-ray'),
      bodySnippet: body.replace(/\\s+/g, ' ').slice(0, 200),
    };
    console.error('[hamichlol-ivr] wikipedia_api_http_error', details);
    const error = new Error(
      `בקשת API לוויקיפדיה נכשלה (HTTP ${res.status}, endpoint=${label})` +
      `${details.cfRay ? `, cf-ray=${details.cfRay}` : ''}`
    );
    error.code = 'WIKIPEDIA_API_HTTP_ERROR';
    error.status = res.status;
    throw error;
  }

  try {
    return await res.json();
  } catch (err) {
    const error = new Error('ויקיפדיה החזירה תגובת JSON לא תקינה');
    error.code = 'WIKIPEDIA_INVALID_JSON';
    throw error;
  }
}

/**
 * מחפש ערכים לפי שאילתת טקסט חופשי ומחזיר עד limit כותרות.
 */
async function searchMichlol(query, limit = 5) {
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  const url = new URL(`${WIKIPEDIA_API_BASE}/search/page`);
  url.searchParams.set('q', String(query || '').trim());
  url.searchParams.set('limit', String(safeLimit));

  const data = await callWikipediaApi(url.toString(), 'search/page');
  const pages = Array.isArray(data && data.pages) ? data.pages : [];
  const titles = pages
    .map((page) => page && page.title)
    .filter((title) => typeof title === 'string' && title.trim());

  console.info('[hamichlol-ivr] wikipedia_search_success', {
    queryLength: String(query || '').length,
    resultCount: titles.length,
  });
  return titles;
}

/**
 * מחזיר את תקציר הערך כטקסט נקי.
 */
async function getExtract(title) {
  const encodedTitle = encodeURIComponent(String(title || '').trim().replace(/ /g, '_'));
  const htmlUrl = `${WIKIPEDIA_API_BASE}/page/${encodedTitle}/html`;
  let html;

  try {
    const response = await fetch(htmlUrl, {
      method: 'GET',
      headers: { ...REQUEST_HEADERS, Accept: 'text/html' },
      timeout: 10000,
    });
    if (!response.ok) {
      const error = new Error(`שליפת תוכן מוויקיפדיה נכשלה (HTTP ${response.status})`);
      error.code = 'WIKIPEDIA_CONTENT_HTTP_ERROR';
      error.status = response.status;
      console.error('[hamichlol-ivr] wikipedia_content_http_error', {
        status: response.status,
        titleLength: String(title || '').length,
      });
      throw error;
    }
    html = await response.text();
  } catch (err) {
    if (err.code) throw err;
    const error = new Error(`לא ניתן לשלוף תוכן מוויקיפדיה: ${err.message}`);
    error.code = 'WIKIPEDIA_CONTENT_NETWORK_ERROR';
    throw error;
  }

  const text = html
    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
    .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>[\\s\\S]*?<\\/sup>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\s+/g, ' ')
    .trim();

  // ה-HTML עשוי לכלול עמוד שלם; מחזירים טקסט קצר יחסית להשמעה.
  return text.slice(0, 6000);
}

module.exports = { searchMichlol, getExtract };
