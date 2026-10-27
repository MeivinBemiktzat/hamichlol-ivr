const { searchMichlol, getMichlolExtract } = require('../lib/michlolApi');
const { downloadRecording } = require('../lib/yemotFiles');
const { readResponse, idListMessageResponse, textMessageResponse } = require('../lib/yemotResponse');

const RECORDING_PARAM = process.env.RECORDING_PARAM || 'SearchRecording';
const CHOICE_PARAM = process.env.CHOICE_PARAM || 'MichlolChoice';
const TOKEN_PARAM = process.env.TOKEN_PARAM || 'YemotApiKey';
const TRANSCRIBE_URL = process.env.TRANSCRIBE_URL;
const RESULT_COUNT = Math.min(5, Math.max(1, Number(process.env.RESULT_COUNT || 5)));
const TTS_CHUNK_SIZE = Number(process.env.TTS_CHUNK_SIZE || 600);
const TIMEOUT_MS = Number(process.env.TRANSCRIBE_TIMEOUT_MS || 15000);

function getParams(req) {
  const params = new URLSearchParams();
  for (const [key, value] of new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams) {
    params.set(key, value);
  }
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    for (const [key, value] of Object.entries(req.body)) params.set(key, String(value ?? ''));
  }
  return params;
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return Object.fromEntries(new URLSearchParams(req.body)); }
  }
  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return Object.fromEntries(new URLSearchParams(raw)); }
  }
  return {};
}

async function transcribe(wavBytes) {
  if (!TRANSCRIBE_URL) throw new Error('חסר משתנה הסביבה TRANSCRIBE_URL');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'User-Agent': 'hamichlol-ivr/1.0' },
      body: wavBytes,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `שירות התמלול החזיר HTTP ${response.status}`);
    return String(data.text || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

function send(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

function errorMessage(message) {
  return textMessageResponse(`אירעה תקלה בשירות. ${message}`, TTS_CHUNK_SIZE);
}

async function handler(req, res) {
  try {
    const body = await parseBody(req);
    req.body = body;
    const params = getParams(req);

    const recording = params.get(RECORDING_PARAM);
    const choice = params.get(CHOICE_PARAM);
    const yemotApiKey = params.get(TOKEN_PARAM) || process.env.YEMOT_API_KEY;

    // Step A: first request — ask the caller to record the search query.
    if (!recording) {
      const recordSpec = `${RECORDING_PARAM},,record,${process.env.RECORDINGS_FOLDER || '/api_search'},,no,yes,1,30`;
      return send(res, readResponse('t-אנא אמרו בקול ברור מה תרצו לחפש במכלול', recordSpec));
    }

    // Step B: recording exists, but no result selection yet.
    if (!choice) {
      if (!yemotApiKey) return send(res, errorMessage('חסר טוקן API KEY של ימות המשיח בהגדרות השלוחה'));

      const wav = await downloadRecording(recording, yemotApiKey);
      const query = await transcribe(wav);
      if (!query) {
        return send(res, readResponse('t-לא הצלחתי להבין את ההקלטה, אנא נסו שוב', `${RECORDING_PARAM},,record,${process.env.RECORDINGS_FOLDER || '/api_search'},,no,yes,1,30`));
      }

      const results = await searchMichlol(query, RESULT_COUNT);
      if (!results.length) {
        return send(res, textMessageResponse(`לא נמצאו תוצאות לחיפוש ${query}. אנא נסו חיפוש אחר`, TTS_CHUNK_SIZE));
      }

      const items = [`t-נמצאו ${results.length} תוצאות`];
      results.forEach((result, index) => items.push(`t-לתוצאה ${index + 1} ${result.title}`));
      const choiceSpec = `${CHOICE_PARAM},,,1,1,7,NO`;
      items.push('t-אנא הקישו את מספר התוצאה הרצויה');

      // No database/state store is used. On the next request Yemot sends the previously
      // collected parameters again, including SearchRecording and the new MichlolChoice.
      // The endpoint therefore repeats transcription + search in step C and selects by index.
      return send(res, `${idListMessageResponse(items)}&read=t-אנא הקישו את מספר התוצאה הרצויה=${choiceSpec}`);
    }

    // Step C: selection exists. Because this module is intentionally stateless, repeat the
    // search from the already-collected recording and use the selected numeric index.
    const selectedIndex = Number(choice);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > RESULT_COUNT) {
      return send(res, readResponse('t-בחירה לא חוקית, אנא הקישו מספר בין אחת לחמש', `${CHOICE_PARAM},,,1,1,7,NO`));
    }

    if (!yemotApiKey) return send(res, errorMessage('חסר טוקן API KEY של ימות המשיח בהגדרות השלוחה'));
    const wav = await downloadRecording(recording, yemotApiKey);
    const query = await transcribe(wav);
    if (!query) return send(res, textMessageResponse('לא הצלחתי להבין את ההקלטה, אנא בצעו את החיפוש מחדש', TTS_CHUNK_SIZE));

    const results = await searchMichlol(query, RESULT_COUNT);
    const selected = results[selectedIndex - 1];
    if (!selected) return send(res, textMessageResponse('התוצאה שבחרתם כבר אינה זמינה, אנא בצעו את החיפוש מחדש', TTS_CHUNK_SIZE));

    const article = await getMichlolExtract(selected.title);
    if (!article || !article.extract) {
      return send(res, textMessageResponse(`לא נמצאה תמצית זמינה עבור ${selected.title}`, TTS_CHUNK_SIZE));
    }

    return send(res, textMessageResponse(`${article.title}. ${article.extract}`, TTS_CHUNK_SIZE));
  } catch (error) {
    console.error('[hamichlol-ivr]', error?.message || error);
    return send(res, errorMessage('נא לנסות שוב מאוחר יותר'));
  }
}

module.exports = handler;
