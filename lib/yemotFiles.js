/**
 * איתור והורדת הקלטת ApiRecord מימות.
 *
 * ימות שומרת את הקלטות המודול בתיקייה Trash/ApiRecord בשמות אוטומטיים
 * כגון Phone-0527673579-id---1793112719.wav. לכן אין להוריד את
 * /1/2/mi_search.wav: זהו שם ההקלטה שהוגדר ב-read, לא בהכרח הנתיב
 * שבו הקובץ זמין דרך Management API לאחר ההקלטה.
 */
'use strict';

const { callManagementApi } = require('./yemotSession');

const API_RECORD_DIR = 'Trash/ApiRecord';

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function fileNameOf(file) {
  if (typeof file === 'string') return file;
  return file?.name || file?.fileName || file?.filename || '';
}

async function listRecordingFiles(advancedToken) {
  const paths = [`ivr2:${API_RECORD_DIR}`, API_RECORD_DIR, `/${API_RECORD_DIR}`];
  const errors = [];

  for (const path of paths) {
    const res = await callManagementApi('GetIVR2Dir', { path }, {}, advancedToken);
    const body = await res.text();
    let data;
    try { data = JSON.parse(body); } catch (_) { data = null; }

    if (res.ok && data?.responseStatus === 'OK' && Array.isArray(data.files)) {
      console.info('[hamichlol-ivr] recording_directory_listed', {
        path,
        fileCount: data.files.length,
      });
      return data.files;
    }

    errors.push({
      path,
      status: res.status,
      responseStatus: data?.responseStatus || null,
      message: data?.message || body.slice(0, 120),
    });
  }

  console.error('[hamichlol-ivr] recording_directory_list_failed', { errors });
  const error = new Error('לא הצלחנו לקרוא את רשימת ההקלטות בתיקיית ApiRecord');
  error.code = 'YEMOT_RECORDING_LIST_FAILED';
  throw error;
}

async function findLatestRecording({ advancedToken, phone, apiTime }) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    const error = new Error('חסר ApiPhone ולכן אי אפשר לזהות את הקלטת השיחה');
    error.code = 'MISSING_CALLER_PHONE';
    throw error;
  }

  const files = await listRecordingFiles(advancedToken);
  const prefix = `Phone-${normalizedPhone}-id---`;
  const candidates = files
    .map((file) => {
      const name = fileNameOf(file);
      const match = name.match(/^Phone-(\d+)-id---(\d+)\.wav$/i);
      return match ? { name, phone: match[1], timestamp: Number(match[2]) } : null;
    })
    .filter((file) => file && file.phone === normalizedPhone && file.name.startsWith(prefix));

  if (!candidates.length) {
    console.warn('[hamichlol-ivr] recording_not_found_for_phone', {
      phone: normalizedPhone,
      directoryFileCount: files.length,
      matchingNameCount: 0,
    });
    const error = new Error(`לא נמצאה הקלטה של מספר הטלפון ${normalizedPhone} בתיקיית ApiRecord`);
    error.code = 'YEMOT_RECORDING_NOT_FOUND';
    throw error;
  }

  const requestTime = Number(apiTime);
  candidates.sort((a, b) => {
    if (Number.isFinite(requestTime) && requestTime > 0) {
      const deltaA = Math.abs(a.timestamp - requestTime);
      const deltaB = Math.abs(b.timestamp - requestTime);
      if (deltaA !== deltaB) return deltaA - deltaB;
    }
    return b.timestamp - a.timestamp;
  });

  const chosen = candidates[0];
  // ApiRecord עשוי להיווצר כמה שניות אחרי ApiTime. אם הקובץ רחוק מדי
  // מהשיחה, לא מורידים אותו כדי להימנע משליחת הקלטה ישנה לתמלול.
  if (Number.isFinite(requestTime) && requestTime > 0 &&
      Math.abs(chosen.timestamp - requestTime) > 180) {
    console.warn('[hamichlol-ivr] recording_timestamp_mismatch', {
      apiTime: requestTime,
      chosenTimestamp: chosen.timestamp,
      differenceSeconds: Math.abs(chosen.timestamp - requestTime),
      candidateCount: candidates.length,
    });
    const error = new Error('נמצאו הקלטות למספר הזה, אך זמנן אינו תואם לשיחה הנוכחית');
    error.code = 'YEMOT_RECORDING_TIMESTAMP_MISMATCH';
    throw error;
  }

  const path = `ivr2:${API_RECORD_DIR}/${chosen.name}`;
  console.info('[hamichlol-ivr] recording_selected', {
    path,
    candidateCount: candidates.length,
    apiTime: Number.isFinite(requestTime) ? requestTime : null,
    fileTimestamp: chosen.timestamp,
  });
  return path;
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
    console.error('[hamichlol-ivr] recording_download_failed', {
      path,
      status: res.status,
      detail,
    });
    const error = new Error(`הורדת ההקלטה נכשלה (HTTP ${res.status})${detail ? `: ${detail}` : ''}; path=${path}`);
    error.code = 'YEMOT_DOWNLOAD_FAILED';
    error.status = res.status;
    throw error;
  }

  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => null);
    const error = new Error(`ימות החזיר הודעה במקום קובץ: ${data?.message || data?.error || data?.responseStatus || 'תגובה לא צפויה'}`);
    error.code = 'YEMOT_DOWNLOAD_FAILED';
    throw error;
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    const error = new Error('הקובץ שהורד מימות אינו קובץ WAV תקין');
    error.code = 'INVALID_WAV';
    throw error;
  }

  console.info('[hamichlol-ivr] recording_downloaded', {
    path,
    bytes: bytes.length,
    wavHeader: bytes.subarray(0, 12).toString('hex'),
  });
  return bytes;
}

module.exports = { findLatestRecording, downloadRecording };
