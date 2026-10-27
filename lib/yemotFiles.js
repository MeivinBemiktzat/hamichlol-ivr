const DOWNLOAD_URL = 'https://www.call2all.co.il/ym/api/DownloadFile';
const TIMEOUT_MS = Number(process.env.YEMOT_DOWNLOAD_TIMEOUT_MS || 15000);

function normalizeRecordingPath(value) {
  let path = String(value || '').trim();
  if (!path) throw new Error('לא התקבל שם קובץ הקלטה');

  // DownloadFile expects an IVR2 path, e.g. ivr2:/api_search/000.wav.
  // The read parameter in the Yemot log is /api_search/000.wav, without ivr2:.
  if (!path.includes('/') && !path.startsWith('ivr2:')) {
    const folder = process.env.RECORDINGS_FOLDER || '/api_search';
    path = folder.replace(/\/$/, '') + '/' + path;
  }

  if (path.startsWith('/') && !path.startsWith('ivr2:')) {
    path = 'ivr2:' + path;
  } else if (!path.startsWith('ivr2:')) {
    path = 'ivr2:/' + path.replace(/^\/+/, '');
  }

  if (!path.endsWith('.wav')) path += '.wav';
  return path;
}

async function downloadRecording(recordingValue, yemotApiKey) {
  if (!yemotApiKey) throw new Error('חסר טוקן API KEY של ימות המשיח');

  const path = normalizeRecordingPath(recordingValue);
  const url = new URL(DOWNLOAD_URL);
  url.searchParams.set('path', path);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // The Yemot API documentation supports API KEY authentication in the authorization header.
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: yemotApiKey,
        'User-Agent': 'hamichlol-ivr/1.0',
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`הורדת ההקלטה נכשלה (HTTP ${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error('ימות החזיר קובץ הקלטה ריק');
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { downloadRecording, normalizeRecordingPath };
