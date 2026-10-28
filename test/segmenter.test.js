import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { segment, splitSentences, cleanArticleText, prepareArticle } from '../lib/content/segmenter.js';

describe('חיתוך תוכן למקטעים', () => {
  test('פיצול למשפטים', () => {
    const sentences = splitSentences('משפט ראשון. משפט שני! ושלישי?');
    assert.equal(sentences.length, 3);
    assert.equal(sentences[0], 'משפט ראשון.');
  });

  test('ראשי תיבות לא נחתכים באמצע', () => {
    const sentences = splitSentences('הוא אמר וכו. והמשיך הלאה. סוף');
    assert.ok(
      sentences[0].includes('וכו.'),
      `ראשי התיבות נחתכו: ${JSON.stringify(sentences)}`
    );
  });

  test('מספר עשרוני אינו סוף משפט', () => {
    const sentences = splitSentences('הערך הוא 3.14 בקירוב. וזהו');
    assert.ok(sentences[0].includes('3.14'), 'המספר העשרוני נחתך');
    assert.equal(sentences.length, 2);
  });

  test('מקטע אינו חורג מהאורך המרבי', () => {
    const text = Array.from({ length: 40 }, (_, i) => `משפט מספר ${i} עם מעט תוכן נוסף.`).join(' ');
    const segments = segment(text, { maxChars: 200 });

    assert.ok(segments.length > 1, 'הטקסט היה צריך להתחלק');
    for (const s of segments) {
      assert.ok(s.length <= 200, `מקטע ארוך מדי: ${s.length} תווים`);
    }
  });

  test('משפטים אינם נחתכים באמצע כשהם נכנסים במקטע', () => {
    const text = 'ראשון קצר. שני קצר. שלישי קצר.';
    const segments = segment(text, { maxChars: 100 });

    for (const s of segments) {
      assert.ok(
        /[.!?:]$/.test(s.trim()),
        `מקטע הסתיים באמצע משפט: "${s}"`
      );
    }
  });

  test('משפט ארוך מהמקטע נחתך בגבול מילה ולא באמצע מילה', () => {
    const longSentence = `${'מילה '.repeat(100)}סוף.`;
    const segments = segment(longSentence, { maxChars: 50 });

    assert.ok(segments.length > 1);
    for (const s of segments) {
      assert.ok(!s.startsWith(' ') && !s.endsWith(' '));
      // כל חלק מורכב ממילים שלמות
      assert.ok(
        s.split(' ').every((word) => word === 'סוף.' || word === 'מילה'),
        `מילה נחתכה: "${s}"`
      );
    }
  });

  test('טקסט ריק מחזיר מערך ריק', () => {
    assert.deepEqual(segment(''), []);
    assert.deepEqual(segment('   '), []);
    assert.deepEqual(segment(null), []);
  });

  test('פרקים שאין טעם להקריא מוסרים', () => {
    const raw = [
      'פתיח של הערך.',
      '== היסטוריה ==',
      'תוכן היסטורי.',
      '== קישורים חיצוניים ==',
      'אתר רשמי',
      'עוד קישור',
    ].join('\n');

    const cleaned = cleanArticleText(raw);
    assert.ok(cleaned.includes('תוכן היסטורי'));
    assert.ok(!cleaned.includes('אתר רשמי'), 'פרק הקישורים החיצוניים לא הוסר');
  });

  test('כותרת פרק נשמרת כמשפט', () => {
    const cleaned = cleanArticleText('פתיח.\n== רקע ==\nתוכן.');
    assert.ok(cleaned.includes('רקע'));
  });

  test('ערך ארוך מאוד נקטע עם הודעה ברורה', () => {
    const huge = 'משפט קצר מאוד. '.repeat(5000);
    const segments = segment(huge, { maxChars: 100, maxSegments: 5 });

    assert.equal(segments.length, 6, 'חמישה מקטעים ועוד הודעת סיום');
    assert.ok(segments[5].includes('מסתיימת'));
  });

  test('prepareArticle מחזיר מבנה מלא', () => {
    const prepared = prepareArticle({ title: 'ערך לדוגמה', text: 'משפט אחד. משפט שני.' });

    assert.equal(prepared.title, 'ערך לדוגמה');
    assert.ok(prepared.totalSegments >= 1);
    assert.equal(prepared.segments.length, prepared.totalSegments);
  });
});
