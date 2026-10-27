const { searchMichlol, getMichlolExtract } = require('../lib/michlolApi');
const { downloadRecording } = require('../lib/yemotFiles');
const { readResponse, textMessageResponse } = require('../lib/yemotResponse');

const RECORDING_PARAM = process.env.RECORDING_PARAM || 'SearchRecording';
const CHOICE_PARAM = process.env.CHOICE_PARAM || 'MichlolChoice';
const TOKEN_PARAM = process.env.TOKEN_PARAM || 'YemotApiKey';
const TRANSCRIBE_URL = process.env.TRANSCRIBE_URL || null;
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

async function transcribe(wavBytes, req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const endpoint = TRANSCRIBE_URL || `${protocol}://${host}/api/transcribe`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'User-Agent': 'hamichlol-ivr/1.0' },
      body: wavBytes,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `שירות התמלול החזיר HTTP ${response.status}`);
      error.code = data.code || `TRANSCRIBE_HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return String(data.text || '').trim();
  } finally {
    clearTimeout(timer);
  }
}


function logStep(event, details = {}) {
  console.log(JSON.stringify({ scope: 'hamichlol-ivr', event, at: new Date().toISOString(), ...details }));
}

function safeError(error) {
  return {
    name: error?.name || 'Error',
    message: String(error?.message || error || 'unknown').slice(0, 500),
    code: error?.code || undefined,
    cause: error?.cause ? String(error.cause.message || error.cause).slice(0, 250) : undefined,
  };
}

function send(res, body) {
  logStep('response_sent', { status: 200, responseLength: String(body || '').length, responseType: String(body || '').split('=')[0] });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

function errorMessage(message) {
  return textMessageResponse(`אירעה תקלה בשירות. ${message}`, TTS_CHUNK_SIZE);
}

async function handler(req, res) {
  const startedAt = Date.now();
  const requestId = req.headers['x-vercel-id'] || req.headers['x-request-id'] || `ivr-${Date.now().toString(36)}`;
  logStep('request_start', {
    requestId,
    method: req.method,
    urlPath: String(req.url || '').split('?')[0],
    contentType: req.headers['content-type'] || null,
    vercelRegion: process.env.VERCEL_REGION || null,
  });
  try {
    const body = await parseBody(req);
    req.body = body;
    const params = getParams(req);

    const recording = params.get(RECORDING_PARAM);
    const choice = params.get(CHOICE_PARAM);
    const yemotApiKey = params.get(TOKEN_PARAM) || process.env.YEMOT_API_KEY;
    logStep('params_parsed', {
      requestId,
      parameterNames: [...params.keys()].filter((key) => key !== TOKEN_PARAM),
      hasRecording: Boolean(recording),
      recordingValue: recording ? String(recording).slice(0, 160) : null,
      hasChoice: Boolean(choice),
      choice: choice || null,
      hasYemotApiKey: Boolean(yemotApiKey),
    });

    // Step A: first request — ask the caller to record the search query.
    if (!recording) {
      logStep('stage_record_prompt', { requestId });
      const recordSpec = `${RECORDING_PARAM},,record,${process.env.RECORDINGS_FOLDER || '/api_search'},,no,yes,1,30`;
      return send(res, readResponse('t-אנא אמרו בקול ברור מה תרצו לחפש במכלול', recordSpec));
    }

    // Step B: recording exists, but no result selection yet.
    if (!choice) {
      if (!yemotApiKey) return send(res, errorMessage('חסר טוקן API KEY של ימות המשיח בהגדרות השלוחה'));

      logStep('stage_search_start', { requestId });
      const wav = await downloadRecording(recording, yemotApiKey);
      logStep('recording_downloaded', { requestId, bytes: wav.length, wavHeader: wav.subarray(0, 12).toString('hex') });
      const query = await transcribe(wav, req);
      logStep('transcription_complete', { requestId, textLength: query.length, hasText: Boolean(query), transcript: query.slice(0, 200) });
      if (!query) {
        return send(res, readResponse('t-לא זוהה טקסט בהקלטה. אנא אמרו את מילות החיפוש לאחר הצפצוף', `${RECORDING_PARAM},,record,${process.env.RECORDINGS_FOLDER || '/api_search'},,no,yes,1,30`));
      }

      const results = await searchMichlol(query, RESULT_COUNT);
      logStep('search_complete', { requestId, resultCount: results.length, titles: results.map((item) => item.title) });
      if (!results.length) {
        return send(res, textMessageResponse(`לא נמצאו תוצאות לחיפוש ${query}. אנא נסו חיפוש אחר`, TTS_CHUNK_SIZE));
      }

      const items = [`t-נמצאו ${results.length} תוצאות`];
      results.forEach((result, index) => items.push(`t-לתוצאה ${index + 1} ${result.title}`));
      items.push('t-אנא הקישו את מספר התוצאה הרצויה');
      const choiceSpec = `${CHOICE_PARAM},,,1,1,7,NO`;

      // Yemot read has one action per response. Its prompt supports a dot-separated
      // sequence of playback items, so announce the results and collect the choice together.
      // No database/state store is used; step C repeats transcription + search.
      return send(res, readResponse(items.join('.'), choiceSpec));
    }

    // Step C: selection exists. Because this module is intentionally stateless, repeat the
    // search from the already-collected recording and use the selected numeric index.
    logStep('stage_article_start', { requestId, choice });
    const selectedIndex = Number(choice);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > RESULT_COUNT) {
      return send(res, readResponse('t-בחירה לא חוקית, אנא הקישו מספר בין אחת לחמש', `${CHOICE_PARAM},,,1,1,7,NO`));
    }

    if (!yemotApiKey) return send(res, errorMessage('חסר טוקן API KEY של ימות המשיח בהגדרות השלוחה'));
    const wav = await downloadRecording(recording, yemotApiKey);
    logStep('recording_downloaded', { requestId, bytes: wav.length, wavHeader: wav.subarray(0, 12).toString('hex') });
    const query = await transcribe(wav, req);
    logStep('transcription_complete', { requestId, textLength: query.length, hasText: Boolean(query), transcript: query.slice(0, 200) });
    if (!query) return send(res, textMessageResponse('לא זוהה טקסט בהקלטה. אנא בצעו את החיפוש מחדש', TTS_CHUNK_SIZE));

    const results = await searchMichlol(query, RESULT_COUNT);
    logStep('search_complete', { requestId, resultCount: results.length, titles: results.map((item) => item.title) });
    const selected = results[selectedIndex - 1];
    if (!selected) return send(res, textMessageResponse('התוצאה שבחרתם כבר אינה זמינה, אנא בצעו את החיפוש מחדש', TTS_CHUNK_SIZE));

    logStep('article_selected', { requestId, selectedIndex, title: selected.title });
    const article = await getMichlolExtract(selected.title);
    logStep('article_loaded', { requestId, found: Boolean(article), extractLength: article?.extract?.length || 0 });
    if (!article || !article.extract) {
      return send(res, textMessageResponse(`לא נמצאה תמצית זמינה עבור ${selected.title}`, TTS_CHUNK_SIZE));
    }

    return send(res, textMessageResponse(`${article.title}. ${article.extract}`, TTS_CHUNK_SIZE));
  } catch (error) {
    logStep('request_failed', { requestId, durationMs: Date.now() - startedAt, error: safeError(error) });
    if (error?.code === 'SHORT_AUDIO') {
      return send(res, readResponse('t-נראה שההקלטה קצרה מדי. אנא המתינו לצפצוף ואמרו את מילות החיפוש', `${RECORDING_PARAM},,record,${process.env.RECORDINGS_FOLDER || '/api_search'},,no,yes,1,30`));
    }
    if (error?.code === 'NO_SPEECH') {
      return send(res, readResponse('t-לא זוהה דיבור בהקלטה. אנא אמרו בקול ברור את מילות החיפוש', `${RECORDING_PARAM},,record,${process.env.RECORDINGS_FOLDER || '/api_search'},,no,yes,1,30`));
    }
    if (error?.code === 'GOOGLE_UNAVAILABLE') {
      return send(res, errorMessage('שירות התמלול אינו זמין כרגע. אנא נסו שוב מאוחר יותר'));
    }
    if (String(error?.code || '').startsWith('TRANSCRIBE_HTTP_')) {
      return send(res, errorMessage('שירות התמלול החזיר שגיאה. אנא נסו שוב מאוחר יותר'));
    }
    if (String(error?.message || '').includes('HTTP 403') && String(error?.message || '').includes('המכלול')) {
      return send(res, errorMessage('שירות החיפוש במכלול חסם את הבקשה כרגע. אנא נסו שוב מאוחר יותר'));
    }
    return send(res, errorMessage('אירעה תקלה לא צפויה. אנא נסו שוב מאוחר יותר'));
  } finally {
    logStep('request_finished', { requestId, durationMs: Date.now() - startedAt });
  }
}

module.exports = handler;
