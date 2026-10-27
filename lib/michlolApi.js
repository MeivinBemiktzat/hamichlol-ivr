const API_URL = 'https://www.hamichlol.org.il/w/api.php';
const TIMEOUT_MS = Number(process.env.MICHLOL_API_TIMEOUT_MS || 10000);
const USER_AGENT = process.env.MICHLOL_USER_AGENT || 'Hamichlol-IVR/1.0 (Vercel serverless; contact: repository MeivinBemiktzat/hamichlol-ivr)';

function logApi(event, details = {}) {
  console.log(JSON.stringify({ scope: 'michlol-api', event, at: new Date().toISOString(), ...details }));
}

async function request(params) {
  const url = new URL(API_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const startedAt = Date.now();
  logApi('request_start', { action: params.action, list: params.list || undefined, prop: params.prop || undefined, timeoutMs: TIMEOUT_MS });
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.7',
      },
      signal: controller.signal,
    });
    const responseText = await response.text();
    logApi('response_received', { action: params.action, status: response.status, durationMs: Date.now() - startedAt, contentType: response.headers.get('content-type'), bodyLength: responseText.length });
    if (!response.ok) {
      const excerpt = responseText.replace(/\\s+/g, ' ').slice(0, 350);
      logApi('http_error', { action: params.action, status: response.status, durationMs: Date.now() - startedAt, bodyExcerpt: excerpt });
      throw new Error(`המכלול החזיר HTTP ${response.status}; ${excerpt || 'ללא גוף תגובה'}`);
    }
    try {
      return JSON.parse(responseText);
    } catch (error) {
      logApi('invalid_json', { action: params.action, durationMs: Date.now() - startedAt, bodyExcerpt: responseText.slice(0, 200) });
      throw new Error('המכלול החזיר תשובה שאינה JSON תקין');
    }
  } catch (error) {
    logApi('request_failed', { action: params.action, durationMs: Date.now() - startedAt, error: error.name === 'AbortError' ? 'timeout' : String(error.message || error).slice(0, 350) });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function searchMichlol(query, limit = 5) {
  logApi('search_start', { queryLength: String(query || '').length, limit });
  const data = await request({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    format: 'json',
  });

  const results = (data?.query?.search || []).slice(0, limit).map((item) => ({
    title: item.title,
  }));
  logApi('search_complete', { resultCount: results.length });
  return results;
}

async function getMichlolExtract(title) {
  logApi('extract_start', { titleLength: String(title || '').length });
  const data = await request({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    exintro: '1',
    titles: title,
    format: 'json',
  });

  const pages = data?.query?.pages || {};
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) {
    logApi('extract_missing', { foundPage: Boolean(page), missing: page?.missing !== undefined });
    return null;
  }

  logApi('extract_complete', { extractLength: String(page.extract || '').length });
  return {
    title: page.title || title,
    extract: String(page.extract || '').trim(),
  };
}

module.exports = { searchMichlol, getMichlolExtract };
