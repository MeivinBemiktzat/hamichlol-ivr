import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  Screen,
  encodeState,
  decodeState,
  encodeQueryName,
  currentState,
  currentQuery,
  nextStep,
  isRunaway,
  MAX_STEPS,
} from '../lib/state/session.js';

describe('קידוד מצב שיחה בשם המשתנה', () => {
  test('קידוד ופענוח הם הפוכים זה לזה', () => {
    const name = encodeState(7, Screen.LISTEN, ['r2', 14]);
    assert.equal(name, 's_7_listen_r2_14');

    const decoded = decodeState(name);
    assert.deepEqual(decoded, { step: 7, screen: 'listen', args: ['r2', '14'] });
  });

  test('מסך בלי ארגומנטים', () => {
    const name = encodeState(0, Screen.MAIN);
    assert.equal(name, 's_0_main');
    assert.deepEqual(decodeState(name).args, []);
  });

  test('מסך לא מוכר נדחה', () => {
    assert.throws(() => encodeState(1, 'nosuchscreen'), /מסך לא מוכר/);
  });

  test('צעד שלילי נדחה', () => {
    assert.throws(() => encodeState(-1, Screen.MAIN), /צעד/);
  });

  test('פענוח של שם זר מחזיר null ולא קורס', () => {
    assert.equal(decodeState('ApiPhone'), null);
    assert.equal(decodeState('q_3'), null);
    assert.equal(decodeState('s_x_main'), null);
    assert.equal(decodeState(''), null);
    assert.equal(decodeState(null), null);
  });

  test('המצב הנוכחי הוא בעל הצעד הגבוה ביותר, בלי תלות בסדר הפרמטרים', () => {
    const collected = {
      s_0_main: '1',
      s_5_listen_r0_3: '1',
      s_2_results: '2',
      q_1: 'תלמוד',
    };

    const state = currentState(collected);
    assert.equal(state.step, 5);
    assert.equal(state.screen, 'listen');
    assert.equal(state.value, '1');
  });

  test('בלי שום מצב מוחזר null', () => {
    assert.equal(currentState({ ApiPhone: '050' }), null);
  });

  test('השאילתה האחרונה היא בעלת הצעד הגבוה ביותר', () => {
    const collected = { q_1: 'ראשונה', q_8: 'אחרונה', q_4: 'אמצעית' };
    assert.deepEqual(currentQuery(collected), { step: 8, query: 'אחרונה' });
  });

  test('שאילתה ריקה אינה נחשבת', () => {
    assert.equal(currentQuery({ q_1: '   ' }), null);
  });

  test('nextStep עולה תמיד, גם כשהמקסימום הוא פרמטר שאילתה', () => {
    assert.equal(nextStep({}), 0);
    assert.equal(nextStep({ s_0_main: '1' }), 1);
    assert.equal(nextStep({ s_0_main: '1', q_3: 'משהו' }), 4);
    assert.equal(nextStep({ s_9_results: '2', q_3: 'משהו' }), 10);
  });

  test('שם פרמטר שאילתה נבנה נכון', () => {
    assert.equal(encodeQueryName(5), 'q_5');
  });

  test('זיהוי לולאה אינסופית', () => {
    assert.equal(isRunaway({ s_0_main: '1' }), false);
    assert.equal(isRunaway({ [`s_${MAX_STEPS + 5}_main`]: '1' }), true);
  });

  test('כל שם משתנה שנוצר תקף לשימוש כפרמטר HTTP', () => {
    for (const screen of Object.values(Screen)) {
      const name = encodeState(3, screen, ['r1', 7]);
      assert.match(name, /^[A-Za-z0-9_]+$/, `שם לא חוקי: ${name}`);
    }
  });
});
