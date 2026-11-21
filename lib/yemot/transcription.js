/**
 * הורדת הקלטה מימות ושליחתה לנקודת הקצה של תמלול Python.
 * הטוקן מועבר בכותרת Authorization ואינו נרשם בלוגים.
 */
import { config } from '../config.js';

const YEMOT_DOWNLOAD_URL = 'https://www.call2all.co.il/ym/api/DownloadFile';

function transcriptionUrl() {
  if (config.transcription.externalUrl) return config.transcription.externalUrl;
  const host = process.env.VERCEL_URL;
  if (host) return `https://${host}/api/transcribe.py`;
  throw new Error('כתובת שירות התמלול אינה מוגדרת');
}

export async function transcribeRecording({ token, filePath }) {
  if (!token) throw new Error('חסר טוקן API של ימות בהגדרות השלוחה');
  if (typeof filePath !== 'string' || !filePath.startsWith('ivr2:/trash/ApiRecord/')) {
    throw new Error('נתיב ההקלטה אינו תקין');
  }

  const downloadUrl = new URL(YEMOT_DOWNLOAD_URL);
  downloadUrl.searchParams.set('path', filePath);

  const recordingResponse = await fetch(downloadUrl, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(15000),
  });
  if (!recordingResponse.ok) {
    throw new Error(`הורדת ההקלטה מימות נכשלה (HTTP ${recordingResponse.status})`);
  }

  const audio = await recordingResponse.arrayBuffer();
  if (audio.byteLength === 0) throw new Error('קובץ ההקלטה ריק');
  if (audio.byteLength > 4 * 1024 * 1024) throw new Error('קובץ ההקלטה גדול מהמותר');

  const response = await fetch(transcriptionUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: audio,
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `שירות התמלול נכשל (HTTP ${response.status})`);
  }

  const text = String(result.text || '').trim();
  if (!text) throw new Error('לא זוהה דיבור בהקלטה');
  return text;
}
