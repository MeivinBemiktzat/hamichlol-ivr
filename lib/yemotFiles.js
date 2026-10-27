/**
 * הורדת הקלטה מימות בעזרת הטוקן המתקדם שהוגדר בשלוחה.
 * אין תלות במשתני סביבה.
 */
'use strict';

const { callManagementApi } = require('./yemotSession');

function buildRecordingPath(folder, fileName) {
  const cleanFolder = String(folder || '').startsWith('/') ? String(folder || '') : `/${folder || ''}`;
  const cleanFile = String(fileName || 'recording').endsWith('.wav')
    ? String(fileName || 'recording')
    : `${fileName || 'recording'}.wav`;
  // אם בבדיקה מול חשבון ימות מסוים נדרשת קידומת כגון ivr2:, יש לשנות כאן.
  return `${cleanFolder}/${cleanFile}`;
}

async function downloadRecording(path, advancedToken) {
  const res = await callManagementApi('DownloadFile', { path }, {}, advancedToken);
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    let detail = '';
    if (contentType.includes('json')) {
      const data = await res.json().catch(() => null);
      detail = data?.message || data?.error || data?.responseStatus || '';
    } else {
      detail = (await res.text().catch(() => '')).slice(0, 160);
    }
    const error = new Error(`הורדת ההקלטה נכשלה (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
    error.code = 'YEMOT_DOWNLOAD_FAILED';
    error.status = res.status;
    throw error;
  }

  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => null);
    const error = new Error(`ימות החזיר הודעת שגיאה במקום הקלטה: ${data?.message || data?.error || data?.responseStatus || 'תגובה לא צפויה'}`);
    error.code = 'YEMOT_DOWNLOAD_FAILED';
    throw error;
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    const error = new Error('הקובץ שהורד מימות אינו קובץ WAV תקין');
    error.code = 'INVALID_WAV';
    throw error;
  }
  return bytes;
}

module.exports = { buildRecordingPath, downloadRecording };
