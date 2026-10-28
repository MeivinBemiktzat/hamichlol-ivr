import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { handleCall } from '../lib/router.js';
import { parseCall } from '../lib/yemot/params.js';
import { makeRequest, useFakeProvider, useMemoryStorage, useNoStorage, parseResponse } from './helpers.js';
import { SourceBlockedError, SourceUnavailableError } from '../lib/errors.js';
import { config } from '../lib/config.js';
import { sharedCache } from '../lib/cache.js';

/**
 * ערכים לדוגמה לבדיקות.
 * "תלמוד בבלי" ארוך בכוונה, כדי שייווצרו כמה מקטעים ואפשר יהיה לבדוק ניווט.
 */
const LONG_TEXT = Array.from(
  { length: 30 },
  (_, i) => `זהו משפט מספר ${i + 1} בערך לדוגמה, והוא נכתב כדי למלא מקום ולייצר מספר מקטעי הקראה.`
).join(' ');

const ARTICLES = {
  'תלמוד בבלי': `התלמוד הבבלי הוא חיבור מרכזי. הוא נערך בבבל. ${LONG_TEXT}`,
  'תלמוד ירושלמי': 'התלמוד הירושלמי נערך בארץ ישראל. הוא קצר יותר מהבבלי.',
  'ערך ריק': '',
};

/** מריץ צעד אחד בשיחה ומחזיר את התשובה ואת הפרמטרים המצטברים */
async function step(collected, answer = null) {
  const params = { ...collected };
  if (answer) params[answer.name] = answer.value;

  const call = parseCall(makeRequest(params));
  const body = await handleCall(call);

  return { body, parsed: parseResponse(body), params };
}

describe('זרימת שיחה מלאה', () => {
  beforeEach(() => {
    useFakeProvider({ articles: ARTICLES });
    useMemoryStorage();
    sharedCache.clear();
  });

  test('שיחה חדשה פותחת בתפריט הראשי עם ברכה', async () => {
    const { body, parsed } = await step({});

    assert.ok(body.includes('ברוכים הבאים'), 'חסרה ברכת פתיחה');
    assert.ok(parsed.has('read'), 'התפריט חייב לבקש הקשה');
    assert.equal(parsed.readVariable(), 's_0_main');
  });

  test('התשובה היא טקסט רגיל ולא JSON', async () => {
    const { body } = await step({});
    assert.throws(() => JSON.parse(body));
    assert.ok(!body.trim().startsWith('<'), 'התשובה נראית כמו HTML');
  });

  test('מסלול מלא: תפריט, חיפוש, תוצאות, האזנה', async () => {
    // צעד 1: תפריט ראשי, המתקשר מקיש 1
    const s1 = await step({}, null);
    assert.equal(s1.parsed.readVariable(), 's_0_main');

    // צעד 2: נקלטה הקשה 1, המערכת מבקשת שאילתה
    const s2 = await step({ s_0_main: '1' });
    const queryVar = s2.parsed.readVariable();
    assert.match(queryVar, /^q_\d+$/, `ציפיתי לפרמטר שאילתה, קיבלתי ${queryVar}`);
    assert.ok(s2.body.includes('voice'), 'חיפוש קולי הוא ברירת המחדל');

    // צעד 3: המתקשר אמר "תלמוד", המערכת מציגה תוצאות
    const s3 = await step({ s_0_main: '1', [queryVar]: 'תלמוד' });
    assert.ok(s3.body.includes('נמצאו'), 'לא הוצגו תוצאות');
    assert.ok(s3.body.includes('תלמוד בבלי'));
    const resultsVar = s3.parsed.readVariable();
    assert.match(resultsVar, /^s_\d+_results$/);

    // צעד 4: המתקשר בוחר תוצאה 1 ומתחיל להאזין
    const s4 = await step({ s_0_main: '1', [queryVar]: 'תלמוד', [resultsVar]: '1' });
    assert.ok(s4.body.includes('מקטע'), 'לא התחילה הקראה');
    const listenVar = s4.parsed.readVariable();
    assert.match(listenVar, /^s_\d+_listen_r0_0$/, `מצב האזנה שגוי: ${listenVar}`);
  });

  test('אין לולאה אינסופית אחרי קליטת שאילתה', async () => {
    // זה היה באג אמיתי: המערכת חזרה לבקש את השאילתה שוב ושוב
    const s = await step({ s_0_main: '1', q_1: 'תלמוד' });
    const variable = s.parsed.readVariable();

    assert.ok(
      !variable.startsWith('q_'),
      `המערכת ביקשה שאילתה פעם נוספת במקום להציג תוצאות: ${variable}`
    );
  });

  test('ניווט בין מקטעים: הבא, חזרה, קודם, התחלה', async () => {
    const base = { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' };

    // מקטע הבא
    const next = await step({ ...base, s_3_listen_r0_0: '1' });
    assert.match(next.parsed.readVariable(), /_listen_r0_1$/, 'לא עבר למקטע הבא');

    // חזרה על אותו מקטע
    const again = await step({ ...base, s_3_listen_r0_1: '2' });
    assert.match(again.parsed.readVariable(), /_listen_r0_1$/, 'לא חזר על אותו מקטע');

    // מקטע קודם
    const prev = await step({ ...base, s_3_listen_r0_2: '3' });
    assert.match(prev.parsed.readVariable(), /_listen_r0_1$/, 'לא חזר למקטע הקודם');

    // תחילת הערך
    const start = await step({ ...base, s_3_listen_r0_2: '4' });
    assert.match(start.parsed.readVariable(), /_listen_r0_0$/, 'לא קפץ לתחילת הערך');
  });

  test('מקטע קודם במקטע הראשון לא יורד מתחת לאפס', async () => {
    const base = { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' };
    const result = await step({ ...base, s_3_listen_r0_0: '3' });
    assert.match(result.parsed.readVariable(), /_listen_r0_0$/);
  });

  test('אפס מחזיר לתפריט הראשי מכל מסך', async () => {
    const screens = [
      { s_0_main: '1', q_1: 'תלמוד', s_2_results: '0' },
      { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1', s_3_listen_r0_5: '0' },
      { s_0_main: '4', s_1_settings: '0' },
    ];

    for (const collected of screens) {
      const { parsed } = await step(collected);
      assert.match(
        parsed.readVariable(),
        /_main$/,
        `לא חזר לתפריט הראשי מ: ${JSON.stringify(collected)}`
      );
    }
  });

  test('כוכבית מתוך תוצאות מחזירה לחיפוש חדש', async () => {
    const { parsed } = await step({ s_0_main: '1', q_1: 'תלמוד', s_2_results: '*' });
    assert.match(parsed.readVariable(), /^q_\d+$/, 'לא ביקש שאילתה חדשה');
  });

  test('חיפוש ללא תוצאות מציע שאילתות דומות', async () => {
    const { body } = await step({ s_0_main: '1', q_1: 'משהו שלא קיים בכלל' });
    assert.ok(body.includes('לא נמצאו תוצאות'));
    assert.ok(body.includes('אולי התכוונתם'), 'לא הוצעו שאילתות דומות');
  });

  test('בחירה לא חוקית בתוצאות אינה מפילה את השיחה', async () => {
    const { body } = await step({ s_0_main: '1', q_1: 'תלמוד', s_2_results: '7' });
    assert.ok(body.length > 0);
    assert.ok(body.includes('read=') || body.includes('id_list_message='));
  });

  test('ערך בלי תוכן מטופל בהודעה ברורה', async () => {
    const { body } = await step({ s_0_main: '1', q_1: 'ערך ריק', s_2_results: '1' });
    assert.ok(body.includes('אין') && body.includes('תוכן'), `התקבל: ${body.slice(0, 200)}`);
  });

  test('הקשה ריקה בתפריט חוזרת על התפריט ולא תוקעת', async () => {
    const { parsed } = await step({ s_0_main: '' });
    assert.match(parsed.readVariable(), /_main$/);
  });

  test('ניתוק באמצע פעולה מסתיים בשקט בלי לקרוס', async () => {
    const call = parseCall(
      makeRequest({ s_0_main: '1', q_1: 'תלמוד', hangup: 'yes' })
    );
    const body = await handleCall(call);
    assert.equal(body, '', 'ניתוק לא אמור לייצר תשובה');
  });

  test('לולאה אינסופית נעצרת', async () => {
    const { body } = await step({ s_500_main: '1' });
    assert.ok(body.includes('go_to_folder'), 'לא בוצע מילוט מהלולאה');
  });
});

describe('טיפול בתקלות מקור חיצוני', () => {
  beforeEach(() => {
    useMemoryStorage();
    sharedCache.clear();
  });

  test('מקור חסום מחזיר הודעה ידידותית בלי פרטים טכניים', async () => {
    useFakeProvider({
      failWith: new SourceBlockedError({ url: 'https://internal.test', status: 403 }),
    });

    const { body } = await step({ s_0_main: '1', q_1: 'תלמוד' });

    assert.ok(body.includes('חוסם') || body.includes('זמין'), `התקבל: ${body}`);
    assert.ok(!body.includes('403'), 'קוד HTTP דלף למתקשר');
    assert.ok(!body.includes('internal.test'), 'שם שרת דלף למתקשר');
  });

  test('מקור לא זמין אינו מפיל את השיחה', async () => {
    useFakeProvider({ failWith: new SourceUnavailableError({ status: 500 }) });

    const { body } = await step({ s_0_main: '1', q_1: 'תלמוד' });

    assert.ok(body.length > 0, 'לא הוחזרה תשובה');
    assert.ok(!body.includes('500'));
    assert.ok(body.includes('go_to_folder') || body.includes('read='));
  });

  test('שגיאה לא צפויה אינה חושפת עקבת שגיאה', async () => {
    useFakeProvider({ failWith: new Error('ENOTFOUND internal-db.local:5432') });

    const { body } = await step({ s_0_main: '1', q_1: 'תלמוד' });

    assert.ok(!body.includes('ENOTFOUND'));
    assert.ok(!body.includes('5432'));
    assert.ok(!body.includes('internal-db'));
  });
});

describe('היסטוריה, מועדפים ובידוד בין משתמשים', () => {
  beforeEach(() => {
    useFakeProvider({ articles: ARTICLES });
    useMemoryStorage();
    sharedCache.clear();
  });

  /** מריץ צעד עבור מספר טלפון מסוים */
  async function stepAs(phone, collected) {
    const call = parseCall(makeRequest({ ApiPhone: phone, ...collected }));
    const body = await handleCall(call);
    return { body, parsed: parseResponse(body) };
  }

  test('שמירה במועדפים ואז הופעה ברשימה', async () => {
    const phone = '0501111111';
    const base = { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' };

    const saved = await stepAs(phone, { ...base, s_3_listen_r0_0: '5' });
    assert.ok(saved.body.includes('נשמר במועדפים'), `התקבל: ${saved.body.slice(0, 150)}`);

    const list = await stepAs(phone, { s_0_main: '3' });
    assert.ok(list.body.includes('תלמוד בבלי'), 'הערך לא הופיע במועדפים');
  });

  test('הקשה חוזרת על 5 מסירה מהמועדפים', async () => {
    const phone = '0502222222';
    const base = { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' };

    await stepAs(phone, { ...base, s_3_listen_r0_0: '5' });
    const removed = await stepAs(phone, { ...base, s_4_listen_r0_0: '5' });

    assert.ok(removed.body.includes('הוסר מהמועדפים'), `התקבל: ${removed.body.slice(0, 150)}`);
  });

  test('נתוני משתמשים מבודדים זה מזה', async () => {
    const userA = '0503333333';
    const userB = '0504444444';
    const base = { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' };

    await stepAs(userA, { ...base, s_3_listen_r0_0: '5' });

    const listB = await stepAs(userB, { s_0_main: '3' });
    assert.ok(
      listB.body.includes('אין ערכים במועדפים'),
      'משתמש ב רואה את המועדפים של משתמש א'
    );
  });

  test('מספר הטלפון עצמו אינו נשמר באחסון', async () => {
    const storage = useMemoryStorage();
    const phone = '0509999999';
    const base = { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' };

    await stepAs(phone, { ...base, s_3_listen_r0_0: '5' });

    const allKeys = [...storage.map.keys()].join(' ');
    const allValues = JSON.stringify([...storage.map.values()]);

    assert.ok(!allKeys.includes(phone), 'מספר הטלפון נשמר כמפתח');
    assert.ok(!allValues.includes(phone), 'מספר הטלפון נשמר בתוכן');
    assert.ok(allKeys.length > 0, 'לא נשמר כלום בכלל');
  });

  test('היסטוריה נרשמת בכניסה לערך', async () => {
    const phone = '0505555555';
    await stepAs(phone, { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' });

    const history = await stepAs(phone, { s_0_main: '2' });
    assert.ok(history.body.includes('תלמוד בבלי'), 'הערך לא נרשם בהיסטוריה');
  });

  test('בחירה מההיסטוריה פותחת את הערך עם מקור נכון', async () => {
    const phone = '0506666666';
    await stepAs(phone, { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' });

    const opened = await stepAs(phone, { s_0_main: '2', s_1_history: '1' });
    assert.match(
      opened.parsed.readVariable(),
      /_listen_h0_0$/,
      `מקור שגוי: ${opened.parsed.readVariable()}`
    );
  });

  test('כיבוי היסטוריה מוחק גם את מה שכבר נשמר', async () => {
    const phone = '0507777777';
    await stepAs(phone, { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' });

    const off = await stepAs(phone, { s_0_main: '4', s_1_settings: '3' });
    assert.ok(off.body.includes('כובתה'), `התקבל: ${off.body.slice(0, 150)}`);

    const history = await stepAs(phone, { s_0_main: '2' });
    assert.ok(history.body.includes('כבויה'), 'ההיסטוריה עדיין פעילה');
  });

  test('מחיקת כל הנתונים דורשת אישור', async () => {
    const phone = '0508888888';
    const confirm = await stepAs(phone, { s_0_main: '4', s_1_settings: '4' });

    assert.ok(confirm.body.includes('האם למחוק'), 'לא נדרש אישור למחיקה');
    assert.match(confirm.parsed.readVariable(), /_confirmdelete_all$/);
  });

  test('ביטול מחיקה אינו מוחק', async () => {
    const phone = '0501212121';
    const base = { s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' };
    await stepAs(phone, { ...base, s_3_listen_r0_0: '5' });

    await stepAs(phone, { s_0_main: '4', s_1_settings: '4', s_2_confirmdelete_all: '2' });

    const list = await stepAs(phone, { s_0_main: '3' });
    assert.ok(list.body.includes('תלמוד בבלי'), 'הנתונים נמחקו למרות הביטול');
  });
});

describe('המערכת פועלת גם בלי אחסון', () => {
  beforeEach(() => {
    useFakeProvider({ articles: ARTICLES });
    useNoStorage();
    sharedCache.clear();
  });

  test('חיפוש והאזנה עובדים בלי אחסון מוגדר', async () => {
    const { body, parsed } = await step({ s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' });

    assert.ok(body.includes('מקטע'), 'ההאזנה לא עבדה בלי אחסון');
    assert.match(parsed.readVariable(), /_listen_r0_0$/);
  });

  test('כשל אחסון אינו מפיל את השיחה', async () => {
    const { setStorage } = await import('../lib/storage/index.js');
    setStorage({
      name: 'broken',
      async get() { throw new Error('אחסון קרס'); },
      async set() { throw new Error('אחסון קרס'); },
      async delete() { throw new Error('אחסון קרס'); },
      async has() { throw new Error('אחסון קרס'); },
    });

    const { body } = await step({ s_0_main: '1', q_1: 'תלמוד', s_2_results: '1' });
    assert.ok(body.includes('מקטע'), 'כשל אחסון הפיל את ההאזנה');
  });
});

describe('הגדרות', () => {
  beforeEach(() => {
    useFakeProvider({ articles: ARTICLES });
    useMemoryStorage();
    sharedCache.clear();
  });

  test('החלפת שיטת חיפוש לקולית ובחזרה', async () => {
    const phone = '0501010101';

    async function stepAs(collected) {
      const call = parseCall(makeRequest({ ApiPhone: phone, ...collected }));
      return parseResponse(await handleCall(call));
    }

    const toggled = await stepAs({ s_0_main: '4', s_1_settings: '1' });
    assert.ok(toggled.text().includes('שיטת החיפוש שונתה'));

    const search = await stepAs({ s_0_main: '1' });
    assert.ok(
      search.text().includes('מקשי הטלפון'),
      'שיטת החיפוש לא השתנתה להקשה'
    );
  });

  test('שינוי מספר תוצאות', async () => {
    const phone = '0502020202';

    async function stepAs(collected) {
      const call = parseCall(makeRequest({ ApiPhone: phone, ...collected }));
      return await handleCall(call);
    }

    const changed = await stepAs({
      s_0_main: '4',
      s_1_settings: '2',
      s_2_setresultcount: '3',
    });

    assert.ok(changed.includes('שונה ל 3'), `התקבל: ${changed.slice(0, 150)}`);
  });

  test('מספר תוצאות מחוץ לטווח נדחה בלי לקרוס', async () => {
    const call = parseCall(
      makeRequest({ s_0_main: '4', s_1_settings: '2', s_2_setresultcount: '0' })
    );
    const body = await handleCall(call);
    assert.ok(body.includes('read='), 'המערכת לא החזירה מסך תקין');
  });

  test('גרסת המערכת מושמעת', async () => {
    const call = parseCall(makeRequest({ s_0_main: '4', s_1_settings: '5' }));
    const body = await handleCall(call);
    assert.ok(body.includes(config.version.replace(/\./g, ' ')) || body.includes('גרסת'));
  });
});
