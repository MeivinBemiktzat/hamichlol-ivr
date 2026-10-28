#!/usr/bin/env node
/**
 * בדיקת עשן אחרי פריסה
 * ======================
 * מריצה סדרת בקשות אמיתיות מול הפריסה ומוודאת שהמערכת מגיבה כראוי.
 * אינה דורשת שום תלות חיצונית.
 *
 * שימוש:
 *   node scripts/smoke.js https://my-project.vercel.app
 */

const base = process.argv[2] ?? process.env.SMOKE_BASE_URL;

if (!base) {
  console.error('שימוש: node scripts/smoke.js https://my-project.vercel.app');
  process.exit(2);
}

const endpoint = `${base.replace(/\/+$/, '')}/api/yemot`;
const healthEndpoint = `${base.replace(/\/+$/, '')}/api/health`;

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
}

async function callYemot(params) {
  const body = new URLSearchParams({
    ApiCallId: `smoke-${Date.now()}`,
    ApiPhone: '0500000000',
    ApiDID: '0000000000',
    ApiExtension: '/5',
    ApiTime: String(Math.floor(Date.now() / 1000)),
    ...params,
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  return { status: response.status, text: await response.text() };
}

async function main() {
  console.log(`בדיקת עשן מול ${base}\n`);

  // 1. בדיקת תקינות
  console.log('בדיקת תקינות:');
  try {
    const response = await fetch(healthEndpoint);
    const data = await response.json();

    check('נקודת הבדיקה מגיבה', response.status === 200 || response.status === 503);
    check('מקור התוכן זמין', data?.checks?.searchProvider?.ok === true,
      data?.checks?.searchProvider?.hint ?? data?.checks?.searchProvider?.error ?? '');
    console.log(`    מקור: ${data?.checks?.searchProvider?.id}, גרסה: ${data?.version}`);
  } catch (error) {
    check('נקודת הבדיקה מגיבה', false, error.message);
  }

  // 2. תפריט ראשי
  console.log('\nתפריט ראשי:');
  const menu = await callYemot({});
  check('קוד תגובה 200', menu.status === 200, `התקבל ${menu.status}`);
  check('התשובה אינה ריקה', menu.text.length > 0);
  check('התשובה מכילה פקודת read', menu.text.includes('read='));
  check('התשובה אינה JSON', !isJson(menu.text));
  check('התשובה אינה HTML', !menu.text.trim().startsWith('<'));

  // 3. חיפוש
  console.log('\nחיפוש:');
  const search = await callYemot({ s_0_main: '1', q_1: 'ירושלים' });
  check('קוד תגובה 200', search.status === 200);
  check('התקבלו תוצאות או הודעה ברורה',
    search.text.includes('נמצאו') || search.text.includes('לא נמצאו'),
    search.text.slice(0, 120));

  // 4. שגיאה לא חושפת פרטים
  console.log('\nאבטחה:');
  check('אין קוד HTTP בתשובה', !/\b(403|404|500|502|503)\b/.test(search.text));
  check('אין טוקן בתשובה', !/token|bearer|hf_/i.test(search.text));

  // 5. ניתוק
  console.log('\nניתוק:');
  const hangup = await callYemot({ s_0_main: '1', hangup: 'yes' });
  check('ניתוק מוחזר בקוד 200', hangup.status === 200);

  console.log(`\nסיכום: ${passed} עברו, ${failed} נכשלו`);
  process.exit(failed > 0 ? 1 : 0);
}

function isJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error('בדיקת העשן קרסה:', error.message);
  process.exit(1);
});
