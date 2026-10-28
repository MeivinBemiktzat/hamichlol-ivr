/**
 * בדיקת תקינות
 * =============
 * נקודת קצה לבדיקת עשן אחרי פריסה. מחזירה JSON (ולא טקסט כמו שלוחת ימות),
 * כי היא מיועדת לבני אדם ולכלי ניטור, לא למודול ה-API.
 *
 * אינה חושפת שום סוד: רק האם הוגדר טוקן, לא מהו.
 */

import { config } from '../lib/config.js';
import { getProvider } from '../lib/search/index.js';
import { getStorage } from '../lib/storage/index.js';

export default async function handler(req, res) {
  const checks = {};

  // מקור התוכן
  try {
    const provider = getProvider();
    const started = Date.now();
    const results = await provider.search('ירושלים', 1);
    checks.searchProvider = {
      id: provider.id,
      verified: provider.verified,
      ok: results.length > 0,
      ms: Date.now() - started,
    };
  } catch (error) {
    checks.searchProvider = {
      id: config.searchProvider,
      ok: false,
      error: error?.code ?? 'UNKNOWN',
      hint:
        error?.code === 'SOURCE_BLOCKED'
          ? 'המקור חוסם גישה מהשרת. ראו TROUBLESHOOTING.md'
          : undefined,
    };
  }

  // אחסון
  const storage = getStorage();
  checks.storage = { driver: storage.name, ok: true };

  if (storage.name !== 'none') {
    try {
      const probeKey = 'healthcheck';
      await storage.set(probeKey, { at: Date.now() });
      const read = await storage.get(probeKey);
      checks.storage.ok = read !== null;
    } catch (error) {
      checks.storage.ok = false;
      checks.storage.error = error?.code ?? 'UNKNOWN';
    }
  }

  checks.privacy = {
    userIdSaltConfigured: Boolean(process.env.USER_ID_SALT),
    note: 'בלי USER_ID_SALT המערכת פועלת בלי היסטוריה ומועדפים, במכוון',
  };

  checks.transcription = { mode: config.transcription.mode };

  const allOk = Object.values(checks).every(
    (check) => check.ok === undefined || check.ok === true
  );

  res.status(allOk ? 200 : 503).json({
    service: 'michlol-ivr',
    version: config.version,
    status: allOk ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    checks,
  });
}
