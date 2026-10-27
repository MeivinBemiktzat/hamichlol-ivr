const API_URL = 'https://www.hamichlol.org.il/w/api.php';
const TIMEOUT_MS = Number(process.env.MICHLOL_API_TIMEOUT_MS || 10000);

async function request(params) {
  const url = new URL(API_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'hamichlol-ivr/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`המכלול החזיר HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchMichlol(query, limit = 5) {
  const data = await request({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    format: 'json',
  });

  return (data?.query?.search || []).slice(0, limit).map((item) => ({
    title: item.title,
  }));
}

async function getMichlolExtract(title) {
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
  if (!page || page.missing !== undefined) return null;

  return {
    title: page.title || title,
    extract: String(page.extract || '').trim(),
  };
}

module.exports = { searchMichlol, getMichlolExtract };
