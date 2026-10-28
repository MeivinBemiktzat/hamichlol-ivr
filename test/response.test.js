import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Y from '../lib/yemot/response.js';

describe('בניית תשובות לימות', () => {
  test('טקסט מקבל קידומת t-', () => {
    assert.equal(Y.text('שלום'), 't-שלום');
  });

  test('נקודה בטקסט מוחלפת, כדי לא לשבור את הפרדת המקטעים', () => {
    const result = Y.text('משפט ראשון. משפט שני');
    assert.ok(!result.slice(2).includes('.'), 'אסור שתישאר נקודה בתוך מקטע טקסט');
    assert.ok(result.includes('משפט ראשון'));
    assert.ok(result.includes('משפט שני'));
  });

  test('שווה ואמפרסנד מוסרים מהטקסט', () => {
    const result = Y.text('א=ב&ג');
    assert.ok(!result.slice(2).includes('='));
    assert.ok(!result.includes('&'));
  });

  test('מספר מקבל קידומת n-', () => {
    assert.equal(Y.number(42), 'n-42');
    assert.equal(Y.number('7'), 'n-7');
    assert.equal(Y.number('לא מספר'), '');
  });

  test('ספרות מקבלות קידומת d- ורק ספרות', () => {
    assert.equal(Y.digits('05-012'), 'd-05012');
  });

  test('מקטעים ריקים מסוננים ולא יוצרים נקודות כפולות', () => {
    const joined = Y.joinSegments([Y.text('א'), Y.text(''), Y.text('ב')]);
    assert.equal(joined, 't-א.t-ב');
    assert.ok(!joined.includes('..'));
  });

  test('id_list_message נבנה נכון', () => {
    const result = Y.idListMessage([Y.text('שלום'), Y.number(5)]);
    assert.equal(result, 'id_list_message=t-שלום.n-5');
  });

  test('id_list_message ריק מחזיר מחרוזת ריקה ולא פקודה שבורה', () => {
    assert.equal(Y.idListMessage([]), '');
  });

  test('read בונה שם משתנה ושדות', () => {
    const result = Y.read({
      segments: [Y.text('הקישו מספר')],
      variableName: 's_0_main',
      fields: { max: '1', min: '1' },
    });

    assert.ok(result.startsWith('read=t-הקישו מספר='));
    assert.ok(result.includes('s_0_main,'));
  });

  test('read גוזם שדות ריקים מהסוף', () => {
    const result = Y.read({
      segments: [Y.text('בדיקה')],
      variableName: 'v',
    });
    assert.ok(!result.endsWith(','), 'אסור שהתשובה תסתיים בפסיק מיותר');
  });

  test('readVoice מבקש זיהוי דיבור בשפה הנכונה', () => {
    const result = Y.readVoice({
      segments: [Y.text('אמרו את שם הערך')],
      variableName: 'q_1',
      language: 'he-IL',
    });

    assert.ok(result.includes('q_1,no,voice,he-IL'));
  });

  test('שם משתנה לא חוקי זורק שגיאה', () => {
    assert.throws(() => Y.sanitizeVariableName('שלום'), /שם משתנה/);
    assert.throws(() => Y.sanitizeVariableName(''), /שם משתנה/);
  });

  test('שם משתנה חוקי עובר כמו שהוא', () => {
    assert.equal(Y.sanitizeVariableName('s_7_listen_r2_14'), 's_7_listen_r2_14');
  });

  test('buildResponse מחבר שורות ומסנן ריקים', () => {
    const result = Y.buildResponse([
      Y.idListMessage([Y.text('א')]),
      '',
      Y.goToFolder('/5'),
    ]);

    assert.equal(result, 'id_list_message=t-א\ngo_to_folder=/5');
  });

  test('התשובה לעולם אינה JSON, כי ימות דוחה JSON בשגיאה M1607', () => {
    const result = Y.buildResponse([Y.idListMessage([Y.text('בדיקה')])]);
    assert.throws(() => JSON.parse(result), 'התשובה חייבת להיות טקסט ולא JSON');
  });
});
