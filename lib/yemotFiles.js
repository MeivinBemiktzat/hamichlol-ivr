/**
 * הורדת הקלטה מימות בעזרת הטוקן המתקדם שהוגדר בשלוחה.
 * אין תלות במשתני סביבה.
 *
 * ב-DownloadFile ייתכן שהנתיב צריך לכלול קידומת ivr2:.
 * לכן מנסים קודם את הנתיב המדויק שקיבלנו מהגדרת ההקלטה, ואם ימות
 * מחזיר 404 מנסים פעם נוספת עם ivr2: כדי להתאים למבנה הנתיבים של ימות.
 */
'use strict';

const { callManagementApi } = require('./yemotSession');

function buildRecordingPath(folder, fileName) {
  const rawFolder = String(folder || '');
  const cleanFolder = rawFolder.startsWith('/') ? rawFolder : `/${rawFolder}`;
  const cleanFile = String(fileName || 'recording').endsWith('.wav')
    ? String(fileName || 'recording')
    : `${fileName || 'recording'}.wav`;
  return `${cleanFolder.replace(/\/$/, '')}/${cleanFile}`;
}

async function requestRecording(path, advancedToken) {
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
    return { ok: false, status: res.status, detail };
  }

  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => null);
    return {
      ok: false,
      status: 502,
      detail: data?.message || data?.error || data?.responseStatus || 'ימות החזיר JSON במקום קובץ',
    };
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    return { ok: false, status: 502, detail: 'התגובה שהתקבלה אינה קובץ WAV תקין' };
  }

  return { ok: true, bytes, status: res.status };
}

async function downloadRecording(path, advancedToken) {
  const candidates = [path];
  if (!String(path).startsWith('ivr2:')) {
    candidates.push(`ivr2:${String(path).startsWith('/') ? '' : '/'}${path}`);
  }

  let lastResult;
  for (const candidate of candidates) {
    // אין לרשום את הטוקן ללוגים. רושמים רק נתיב ותוצאת ניסיון.
    console.info('[hamichlol-ivr] DownloadFile attempt', {
      path: candidate,
      attempt: candidates.indexOf(candidate) + 1,
      attempts: candidates.length,
    });

    const result = await requestRecording(candidate, advancedToken);
    if (result.ok) {
      console.info('[hamichlol-ivr] DownloadFile success', {
        path: candidate,
        bytes: result.bytes.length,
      });
      return result.bytes;
    }

    lastResult = { ...result, path: candidate };
    console.warn('[hamichlol-ivr] DownloadFile failed', {
      path: candidate,
      status: result.status,
      detail: result.detail,
    });

    // אם הקובץ לא נמצא בנתיב הראשון, ננסה את הצורה עם ivr2:.
    // בשגיאות הרשאה/שרת אין טעם לנסות נתיב חלופי.
    if (result.status !== 404) break;
  }

  const error = new Error(
    `הורדת ההקלטה נכשלה (HTTP ${lastResult?.status || 502})` +
    `${lastResult?.detail ? `: ${lastResult.detail}` : ''}` +
    `; הנתיב האחרון שנבדק: ${lastResult?.path || path}`
  );
  error.code = 'YEMOT_DOWNLOAD_FAILED';
  error.status = lastResult?.status || 502;
  throw error;
}

module.exports = { buildRecordingPath, downloadRecording };
