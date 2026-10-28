/**
 * ניתוב השיחה
 * ============
 * כאן יושבת כל הלוגיקה של התפריטים. הקובץ מקבל מצב ומחזיר תשובה לימות,
 * והוא טהור מבחינת רשת: כל פנייה החוצה עוברת דרך שכבת החיפוש או האחסון.
 *
 * עקרון מנחה: לכל מסך יש בדיוק פונקציה אחת שבונה אותו, ובדיוק פונקציה אחת
 * שמטפלת בתשובת המתקשר עליו. כך קל לעקוב אחרי הזרימה ולבדוק כל מסך בנפרד.
 */

import Y from './yemot/response.js';
import { Screen, encodeState, encodeQueryName, currentState, currentQuery, nextStep, isRunaway } from './state/session.js';
import { getProvider } from './search/index.js';
import { prepareArticle } from './content/segmenter.js';
import { loadProfile, saveProfile, addToHistory, toggleFavorite, clearHistory, clearAll } from './state/userdata.js';
import { userKey, validateQuery } from './yemot/params.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { spokenFor, NotFoundError, EmptyContentError } from './errors.js';

/** מקשים קבועים בכל המסכים */
const KEY = {
  MAIN_MENU: '0',
  BACK: '*',
  HELP: '9',
};

/**
 * נקודת הכניסה היחידה.
 * @param {object} call אובייקט השיחה מ-parseCall
 * @returns {Promise<string>} גוף התשובה לימות
 */
export async function handleCall(call) {
  // ניתוק: ימות שולחת hangup=yes. אין למי לענות, רק מסיימים בשקט.
  if (call.isHangup) {
    logger.info('המתקשר ניתק', { callId: call.callId, phone: call.phone });
    return '';
  }

  // הגנה מפני לולאה אינסופית בין שלוחות
  if (isRunaway(call.collected)) {
    logger.warn('שיחה חרגה ממספר הצעדים המרבי', { callId: call.callId });
    return Y.buildResponse([
      Y.idListMessage([Y.text('השיחה ארוכה מדי. מעבירים אתכם לתפריט הראשי')]),
      Y.goToRoot(),
    ]);
  }

  const state = currentState(call.collected);
  const step = nextStep(call.collected);

  // אין מצב קודם: זו תחילת השיחה
  if (!state) {
    return renderMainMenu(step, { welcome: true });
  }

  const profile = await loadProfileFor(call);

  /**
   * מסך קליטת השאילתה אינו מייצר משתנה מצב משלו, אלא רק מבקש את השאילתה
   * בפרמטר q_<step>. לכן כשהשאילתה האחרונה חדשה יותר מהמצב האחרון, סימן
   * שהמתקשר זה עתה מסר שאילתה, ויש לעבור למסך התוצאות.
   */
  const latestQuery = currentQuery(call.collected);
  if (latestQuery && latestQuery.step > state.step) {
    return renderResults(call, step, profile);
  }

  switch (state.screen) {
    case Screen.MAIN:
      return handleMainMenu(call, state, step, profile);
    case Screen.SEARCHINPUT:
      return handleSearchInput(call, state, step, profile);
    case Screen.RESULTS:
      return handleResults(call, state, step, profile);
    case Screen.LISTEN:
      return handleListen(call, state, step, profile);
    case Screen.HISTORY:
      return handleHistory(call, state, step, profile);
    case Screen.FAVORITES:
      return handleFavorites(call, state, step, profile);
    case Screen.SETTINGS:
      return handleSettings(call, state, step, profile);
    case Screen.SETRESULTCOUNT:
      return handleSetResultCount(call, state, step, profile);
    case Screen.CONFIRMDELETE:
      return handleConfirmDelete(call, state, step, profile);
    case Screen.HELP:
      return renderMainMenu(step);
    default:
      logger.warn('מסך לא מוכר', { screen: state.screen });
      return renderMainMenu(step);
  }
}

/* ------------------------------------------------------------------ */
/* תפריט ראשי                                                          */
/* ------------------------------------------------------------------ */

function renderMainMenu(step, { welcome = false } = {}) {
  const segments = [];

  if (welcome) {
    segments.push(Y.text('שלום, וברוכים הבאים לקו החיפוש וההאזנה לערכים'));
  }

  segments.push(
    Y.text('לחיפוש ערך הקישו 1'),
    Y.text('לחיפושים אחרונים הקישו 2'),
    Y.text('למועדפים הקישו 3'),
    Y.text('להגדרות הקישו 4'),
    Y.text('להסבר על השימוש בקו הקישו 9')
  );

  return Y.buildResponse([
    Y.read({
      segments,
      variableName: encodeState(step, Screen.MAIN),
      fields: { max: '1', min: '1', timeout: '10', allowedKeys: '1.2.3.4.9', attempts: '2', acceptEmpty: 'Ok' },
    }),
  ]);
}

async function handleMainMenu(call, state, step, profile) {
  switch (state.value) {
    case '1':
      return renderSearchInput(step, profile);
    case '2':
      return renderHistory(step, profile);
    case '3':
      return renderFavorites(step, profile);
    case '4':
      return renderSettings(step, profile);
    case '9':
      return renderHelp(step);
    default:
      // לא הוקש דבר, או הקשה לא חוקית: חוזרים על התפריט
      return renderMainMenu(step);
  }
}

/* ------------------------------------------------------------------ */
/* הסבר                                                                */
/* ------------------------------------------------------------------ */

function renderHelp(step) {
  return Y.buildResponse([
    Y.read({
      segments: [
        Y.text('הקו מאפשר לחפש ערכים ולהאזין להם'),
        Y.text('בתפריט הראשי הקישו 1 לחיפוש'),
        Y.text('תוכלו לומר את שם הערך בקול, או להקיש אותו במקלדת'),
        Y.text('לאחר החיפוש תושמע רשימת תוצאות, והקישו את מספר התוצאה שברצונכם לשמוע'),
        Y.text('בזמן ההאזנה, הקישו 1 למקטע הבא, 2 לחזרה על המקטע, ו 3 למקטע הקודם'),
        Y.text('בכל שלב, הקשה על אפס מחזירה לתפריט הראשי'),
        Y.text('לחזרה לתפריט הראשי הקישו כל מקש'),
      ],
      variableName: encodeState(step, Screen.HELP),
      fields: { max: '1', min: '1', timeout: '12', attempts: '1', acceptEmpty: 'Ok' },
    }),
  ]);
}

/* ------------------------------------------------------------------ */
/* קליטת שאילתת חיפוש                                                  */
/* ------------------------------------------------------------------ */

function renderSearchInput(step, profile) {
  const queryName = encodeQueryName(step);
  const useVoice = profile.preferences.searchMode === 'voice';

  if (useVoice) {
    /**
     * זיהוי הדיבור מתבצע בימות עצמה, והיא מחזירה לנו טקסט מוכן.
     * זה חוסך הורדת קובץ שמע, שליחתו לשירות תמלול וההמתנה לתשובה.
     */
    return Y.buildResponse([
      Y.readVoice({
        segments: [Y.text('אמרו את שם הערך שברצונכם לחפש, אחרי הצפצוף')],
        variableName: queryName,
        language: 'he-IL',
        allowKeypad: true,
        silenceSeconds: 2,
        maxSeconds: 10,
      }),
    ]);
  }

  return Y.buildResponse([
    Y.read({
      segments: [
        Y.text('הקישו את שם הערך באמצעות מקשי הטלפון, ולסיום הקישו סולמית'),
      ],
      variableName: queryName,
      fields: {
        max: String(config.search.maxQueryLength),
        min: '1',
        timeout: '20',
        playbackFormat: 'HebrewKeyboard',
        attempts: '2',
        acceptEmpty: 'Ok',
      },
    }),
  ]);
}

/**
 * אחרי קליטת השאילתה, ימות מחזירה אותה בפרמטר q_<step>.
 * שימו לב: המסך שמגיע לכאן הוא SEARCHINPUT רק כשחוזרים אליו מתוך מסך אחר.
 * בזרימה הרגילה השאילתה מגיעה יחד עם המצב הקודם, ולכן renderResults נקרא
 * ישירות מתוך הטיפול במסך שביקש את החיפוש.
 */
async function handleSearchInput(call, state, step, profile) {
  return renderResults(call, step, profile);
}

/* ------------------------------------------------------------------ */
/* תוצאות חיפוש                                                        */
/* ------------------------------------------------------------------ */

async function renderResults(call, step, profile) {
  const latest = currentQuery(call.collected);

  if (!latest) {
    return Y.buildResponse([
      Y.idListMessage([Y.text('לא התקבלה שאילתת חיפוש')]),
      ...splitResponse(renderSearchInput(step, profile)),
    ]);
  }

  const validation = validateQuery(latest.query);
  if (!validation.ok) {
    const message =
      validation.reason === 'too_long'
        ? 'השאילתה ארוכה מדי'
        : 'לא נקלטה שאילתת חיפוש';

    return Y.buildResponse([
      Y.idListMessage([Y.text(message)]),
      ...splitResponse(renderSearchInput(step, profile)),
    ]);
  }

  const provider = getProvider();
  const limit = profile.preferences.resultCount;

  let results;
  try {
    results = await provider.search(validation.value, limit);
  } catch (error) {
    logger.error('חיפוש נכשל', {
      code: error?.code,
      details: error?.details,
      provider: provider.id,
    });
    return Y.buildResponse([
      Y.idListMessage([Y.text(spokenFor(error))]),
      Y.goToRoot(),
    ]);
  }

  if (results.length === 0) {
    return renderNoResults(validation.value, provider, step, profile);
  }

  const segments = [
    Y.text(`נמצאו ${results.length === 1 ? 'תוצאה אחת' : `${results.length} תוצאות`}`),
  ];

  results.forEach((result, index) => {
    segments.push(Y.text(`להאזנה ל ${result.title}, הקישו ${index + 1}`));
  });

  segments.push(Y.text('לחיפוש חדש הקישו כוכבית'));
  segments.push(Y.text('לתפריט הראשי הקישו אפס'));

  const allowed = [
    ...results.map((_, index) => String(index + 1)),
    KEY.MAIN_MENU,
    KEY.BACK,
  ].join('.');

  return Y.buildResponse([
    Y.read({
      segments,
      variableName: encodeState(step, Screen.RESULTS),
      fields: { max: '1', min: '1', timeout: '12', allowedKeys: allowed, attempts: '2', acceptEmpty: 'Ok' },
    }),
  ]);
}

/** אין תוצאות: מציעים שאילתות דומות במקום להשאיר את המתקשר בלי כלום */
async function renderNoResults(query, provider, step, profile) {
  const suggestions = await provider.suggest(query, 3);

  const segments = [Y.text('לא נמצאו תוצאות לחיפוש זה')];

  if (suggestions.length > 0) {
    segments.push(Y.text('אולי התכוונתם ל'));
    suggestions.forEach((title, index) => {
      segments.push(Y.text(`${index + 1}. ${title}`));
    });
    segments.push(Y.text('הקישו את מספר ההצעה, או כוכבית לחיפוש חדש'));

    const allowed = [
      ...suggestions.map((_, index) => `9${index + 1}`),
      KEY.BACK,
      KEY.MAIN_MENU,
    ].join('.');

    // ההצעות מקודדות כ-9N כדי להבדילן מבחירת תוצאה רגילה
    return Y.buildResponse([
      Y.read({
        segments,
        variableName: encodeState(step, Screen.RESULTS, ['sug']),
        fields: { max: '2', min: '1', timeout: '12', allowedKeys: allowed, attempts: '2', acceptEmpty: 'Ok' },
      }),
    ]);
  }

  segments.push(Y.text('לחיפוש חדש הקישו כוכבית, לתפריט הראשי הקישו אפס'));

  return Y.buildResponse([
    Y.read({
      segments,
      variableName: encodeState(step, Screen.RESULTS),
      fields: { max: '1', min: '1', timeout: '10', allowedKeys: `${KEY.BACK}.${KEY.MAIN_MENU}`, attempts: '2', acceptEmpty: 'Ok' },
    }),
  ]);
}

async function handleResults(call, state, step, profile) {
  const value = state.value;

  if (value === KEY.MAIN_MENU || value === '') return renderMainMenu(step);
  if (value === KEY.BACK) return renderSearchInput(step, profile);

  // בחירה מתוך הצעות: הערך מגיע בצורת 9N
  if (state.args[0] === 'sug' && value.startsWith('9') && value.length === 2) {
    const latest = currentQuery(call.collected);
    const provider = getProvider();
    const suggestions = await provider.suggest(latest?.query ?? '', 3);
    const index = Number.parseInt(value[1], 10) - 1;

    if (index >= 0 && index < suggestions.length) {
      return renderListen(call, step, profile, {
        title: suggestions[index],
        source: `g${index}`,
        segmentIndex: 0,
        query: latest?.query,
      });
    }
    return renderSearchInput(step, profile);
  }

  const index = Number.parseInt(value, 10) - 1;
  if (!Number.isInteger(index) || index < 0) return renderMainMenu(step);

  const latest = currentQuery(call.collected);
  const provider = getProvider();

  let results;
  try {
    results = await provider.search(latest.query, profile.preferences.resultCount);
  } catch (error) {
    return Y.buildResponse([
      Y.idListMessage([Y.text(spokenFor(error))]),
      Y.goToRoot(),
    ]);
  }

  if (index >= results.length) return renderResults(call, step, profile);

  return renderListen(call, step, profile, {
    title: results[index].title,
    source: `r${index}`,
    segmentIndex: 0,
    query: latest.query,
  });
}

/* ------------------------------------------------------------------ */
/* האזנה לערך                                                          */
/* ------------------------------------------------------------------ */

/**
 * מסך ההאזנה.
 *
 * המצב מקודד שני ארגומנטים: מזהה מקור ומספר המקטע.
 * מזהה המקור אומר מאיפה הגיע הערך, וכך אפשר לשחזר את כותרתו בכל צעד
 * בלי לשמור טקסט עברי בשם משתנה, שתומך באותיות אנגליות בלבד:
 *
 *   r<n>  תוצאה מספר n בחיפוש הנוכחי
 *   h<n>  ערך מספר n בהיסטוריה
 *   f<n>  ערך מספר n במועדפים
 *
 * לדוגמה s_7_listen_r2_14 = מקטע 14 בתוצאת החיפוש השלישית.
 */
async function renderListen(call, step, profile, { title, source, segmentIndex, query }) {
  const provider = getProvider();

  let prepared;
  try {
    const article = await provider.getArticle(title);
    prepared = prepareArticle(article);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof EmptyContentError) {
      return Y.buildResponse([
        Y.idListMessage([Y.text(spokenFor(error))]),
        ...splitResponse(await backFrom(call, step, profile, source)),
      ]);
    }
    logger.error('שליפת ערך נכשלה', { code: error?.code, details: error?.details });
    return Y.buildResponse([
      Y.idListMessage([Y.text(spokenFor(error))]),
      Y.goToRoot(),
    ]);
  }

  const total = prepared.totalSegments;
  const current = Math.min(Math.max(segmentIndex, 0), Math.max(total - 1, 0));

  if (total === 0) {
    return Y.buildResponse([
      Y.idListMessage([Y.text('לערך זה אין תוכן להקראה')]),
      ...splitResponse(await backFrom(call, step, profile, source)),
    ]);
  }

  // שמירת היסטוריה רק בכניסה לערך, לא בכל מקטע
  if (current === 0) {
    await recordHistory(call, profile, { title: prepared.title, query });
  }

  const segments = [];

  if (current === 0) {
    segments.push(Y.text(`${prepared.title}.`));
    segments.push(Y.text(`הערך מחולק ל ${total} מקטעים`));
  }

  segments.push(Y.text(`מקטע ${current + 1}`));
  segments.push(Y.text(prepared.segments[current]));

  const isFavorite = profile.favorites.some((item) => item.title === prepared.title);

  if (current < total - 1) {
    segments.push(Y.text('למקטע הבא הקישו 1'));
  } else {
    segments.push(Y.text('זהו המקטע האחרון בערך'));
  }

  segments.push(Y.text('לחזרה על המקטע הקישו 2'));

  if (current > 0) {
    segments.push(Y.text('למקטע הקודם הקישו 3'));
    segments.push(Y.text('לתחילת הערך הקישו 4'));
  }

  segments.push(
    Y.text(isFavorite ? 'להסרה מהמועדפים הקישו 5' : 'לשמירה במועדפים הקישו 5')
  );
  segments.push(Y.text('לחזרה לתוצאות החיפוש הקישו כוכבית'));
  segments.push(Y.text('לתפריט הראשי הקישו אפס'));

  return Y.buildResponse([
    Y.read({
      segments,
      variableName: encodeState(step, Screen.LISTEN, [source, current]),
      fields: {
        max: '1',
        min: '1',
        timeout: '12',
        allowedKeys: `1.2.3.4.5.${KEY.BACK}.${KEY.MAIN_MENU}`,
        attempts: '2',
        acceptEmpty: 'Ok',
      },
    }),
  ]);
}

async function handleListen(call, state, step, profile) {
  const source = state.args[0] ?? 'r0';
  const segmentIndex = Number.parseInt(state.args[1], 10) || 0;
  const value = state.value;

  if (value === KEY.MAIN_MENU) return renderMainMenu(step);

  if (value === KEY.BACK) {
    // חזרה מהיסטוריה או ממועדפים מובילה לרשימה שממנה הגיע הערך
    if (source.startsWith('h')) return renderHistory(step, profile);
    if (source.startsWith('f')) return renderFavorites(step, profile);
    return renderResultsFromCall(call, step, profile);
  }

  const title = await titleForSource(call, profile, source);
  if (!title) return renderMainMenu(step);

  const latest = currentQuery(call.collected);
  const common = { title, source, query: latest?.query };

  switch (value) {
    case '1':
      return renderListen(call, step, profile, {
        ...common,
        segmentIndex: segmentIndex + 1,
      });

    case '3':
      return renderListen(call, step, profile, {
        ...common,
        segmentIndex: Math.max(segmentIndex - 1, 0),
      });

    case '4':
      return renderListen(call, step, profile, { ...common, segmentIndex: 0 });

    case '5': {
      const result = toggleFavorite(profile, title);
      await persistProfile(call, result.profile);

      const message = result.full
        ? 'רשימת המועדפים מלאה'
        : result.added
          ? 'הערך נשמר במועדפים'
          : 'הערך הוסר מהמועדפים';

      return Y.buildResponse([
        Y.idListMessage([Y.text(message)]),
        ...splitResponse(
          await renderListen(call, step, result.profile, { ...common, segmentIndex })
        ),
      ]);
    }

    // '2' = חזרה על המקטע, ריק = לא הוקש דבר. בשני המקרים משמיעים שוב.
    default:
      return renderListen(call, step, profile, { ...common, segmentIndex });
  }
}

/**
 * משחזר את כותרת הערך ממזהה המקור.
 * עבור תוצאות חיפוש זו פנייה חוזרת לספק, אבל היא כמעט תמיד נענית מהמטמון
 * ולכן אינה מוסיפה השהיה מורגשת.
 */
async function titleForSource(call, profile, source) {
  const kind = source[0];
  const index = Number.parseInt(source.slice(1), 10);

  if (!Number.isInteger(index) || index < 0) return null;

  if (kind === 'h') return profile.history[index]?.title ?? null;
  if (kind === 'f') return profile.favorites[index]?.title ?? null;

  const latest = currentQuery(call.collected);
  if (!latest) return null;

  try {
    const provider = getProvider();

    if (kind === 'g') {
      const suggestions = await provider.suggest(latest.query, 3);
      return suggestions[index] ?? null;
    }

    const results = await provider.search(latest.query, profile.preferences.resultCount);
    return results[index]?.title ?? null;
  } catch {
    return null;
  }
}

async function renderResultsFromCall(call, step, profile) {
  return renderResults(call, step, profile);
}

/** חוזר למסך שממנו הגיע המתקשר, לפי מזהה המקור */
async function backFrom(call, step, profile, source) {
  if (source?.startsWith('h')) return renderHistory(step, profile);
  if (source?.startsWith('f')) return renderFavorites(step, profile);
  return renderResults(call, step, profile);
}

/* ------------------------------------------------------------------ */
/* היסטוריה                                                            */
/* ------------------------------------------------------------------ */

function renderHistory(step, profile) {
  if (!profile.preferences.historyEnabled) {
    return Y.buildResponse([
      Y.idListMessage([Y.text('שמירת היסטוריה כבויה. ניתן להפעילה בתפריט ההגדרות')]),
      ...splitResponse(renderMainMenu(step)),
    ]);
  }

  if (profile.history.length === 0) {
    return Y.buildResponse([
      Y.idListMessage([Y.text('אין עדיין חיפושים אחרונים')]),
      ...splitResponse(renderMainMenu(step)),
    ]);
  }

  const items = profile.history.slice(0, 9);
  const segments = [Y.text('הערכים האחרונים שהאזנתם להם')];

  items.forEach((item, index) => {
    segments.push(Y.text(`${index + 1}. ${item.title}`));
  });

  segments.push(Y.text('הקישו את מספר הערך להאזנה'));
  segments.push(Y.text('למחיקת ההיסטוריה הקישו סולמית'));
  segments.push(Y.text('לתפריט הראשי הקישו אפס'));

  const allowed = [...items.map((_, i) => String(i + 1)), '#', KEY.MAIN_MENU].join('.');

  return Y.buildResponse([
    Y.read({
      segments,
      variableName: encodeState(step, Screen.HISTORY),
      fields: { max: '1', min: '1', timeout: '12', allowedKeys: allowed, attempts: '2', acceptEmpty: 'Ok' },
    }),
  ]);
}

async function handleHistory(call, state, step, profile) {
  const value = state.value;

  if (value === KEY.MAIN_MENU || value === '') return renderMainMenu(step);

  if (value === '#') {
    return renderConfirmDelete(step, 'history');
  }

  const index = Number.parseInt(value, 10) - 1;
  const item = profile.history[index];
  if (!item) return renderMainMenu(step);

  return renderListen(call, step, profile, {
    title: item.title,
    source: `h${index}`,
    segmentIndex: 0,
  });
}

/* ------------------------------------------------------------------ */
/* מועדפים                                                             */
/* ------------------------------------------------------------------ */

function renderFavorites(step, profile) {
  if (profile.favorites.length === 0) {
    return Y.buildResponse([
      Y.idListMessage([
        Y.text('אין ערכים במועדפים'),
        Y.text('בזמן האזנה לערך, הקישו 5 כדי לשמור אותו'),
      ]),
      ...splitResponse(renderMainMenu(step)),
    ]);
  }

  const items = profile.favorites.slice(0, 9);
  const segments = [Y.text('הערכים השמורים שלכם')];

  items.forEach((item, index) => {
    segments.push(Y.text(`${index + 1}. ${item.title}`));
  });

  segments.push(Y.text('הקישו את מספר הערך להאזנה'));
  segments.push(Y.text('לתפריט הראשי הקישו אפס'));

  const allowed = [...items.map((_, i) => String(i + 1)), KEY.MAIN_MENU].join('.');

  return Y.buildResponse([
    Y.read({
      segments,
      variableName: encodeState(step, Screen.FAVORITES),
      fields: { max: '1', min: '1', timeout: '12', allowedKeys: allowed, attempts: '2', acceptEmpty: 'Ok' },
    }),
  ]);
}

async function handleFavorites(call, state, step, profile) {
  const value = state.value;
  if (value === KEY.MAIN_MENU || value === '') return renderMainMenu(step);

  const index = Number.parseInt(value, 10) - 1;
  const item = profile.favorites[index];
  if (!item) return renderMainMenu(step);

  return renderListen(call, step, profile, {
    title: item.title,
    source: `f${index}`,
    segmentIndex: 0,
  });
}

/* ------------------------------------------------------------------ */
/* הגדרות                                                              */
/* ------------------------------------------------------------------ */

function renderSettings(step, profile) {
  const p = profile.preferences;

  const segments = [
    Y.text('תפריט הגדרות'),
    Y.text(
      `שיטת החיפוש הנוכחית היא ${p.searchMode === 'voice' ? 'חיפוש קולי' : 'הקשה במקלדת'}`
    ),
    Y.text('לשינוי שיטת החיפוש הקישו 1'),
    Y.text(`מספר התוצאות הנוכחי הוא ${p.resultCount}`),
    Y.text('לשינוי מספר התוצאות הקישו 2'),
    Y.text(
      `שמירת היסטוריה ${p.historyEnabled ? 'מופעלת' : 'כבויה'}`
    ),
    Y.text('לשינוי שמירת ההיסטוריה הקישו 3'),
    Y.text('למחיקת כל הנתונים האישיים הקישו 4'),
    Y.text('לשמיעת גרסת המערכת הקישו 5'),
    Y.text('לתפריט הראשי הקישו אפס'),
  ];

  return Y.buildResponse([
    Y.read({
      segments,
      variableName: encodeState(step, Screen.SETTINGS),
      fields: { max: '1', min: '1', timeout: '12', allowedKeys: `1.2.3.4.5.${KEY.MAIN_MENU}`, attempts: '2', acceptEmpty: 'Ok' },
    }),
  ]);
}

async function handleSettings(call, state, step, profile) {
  const value = state.value;

  switch (value) {
    case '1': {
      const mode = profile.preferences.searchMode === 'voice' ? 'keypad' : 'voice';
      const updated = {
        ...profile,
        preferences: { ...profile.preferences, searchMode: mode },
      };
      await persistProfile(call, updated);

      return Y.buildResponse([
        Y.idListMessage([
          Y.text(
            `שיטת החיפוש שונתה ל ${mode === 'voice' ? 'חיפוש קולי' : 'הקשה במקלדת'}`
          ),
        ]),
        ...splitResponse(renderSettings(step, updated)),
      ]);
    }

    case '2':
      return renderSetResultCount(step, profile);

    case '3': {
      const enabled = !profile.preferences.historyEnabled;
      let updated = {
        ...profile,
        preferences: { ...profile.preferences, historyEnabled: enabled },
      };

      // כיבוי שמירת היסטוריה מוחק גם את מה שכבר נשמר
      if (!enabled) updated = clearHistory(updated);

      await persistProfile(call, updated);

      return Y.buildResponse([
        Y.idListMessage([
          Y.text(
            enabled
              ? 'שמירת היסטוריה הופעלה'
              : 'שמירת היסטוריה כובתה וההיסטוריה נמחקה'
          ),
        ]),
        ...splitResponse(renderSettings(step, updated)),
      ]);
    }

    case '4':
      return renderConfirmDelete(step, 'all');

    case '5':
      return Y.buildResponse([
        Y.idListMessage([
          Y.text(`גרסת המערכת ${config.version}`),
          Y.text(`מקור התוכן ${getProvider().name}`),
        ]),
        ...splitResponse(renderSettings(step, profile)),
      ]);

    default:
      return renderMainMenu(step);
  }
}

function renderSetResultCount(step, profile) {
  return Y.buildResponse([
    Y.read({
      segments: [
        Y.text('הקישו את מספר התוצאות שברצונכם לשמוע בכל חיפוש'),
        Y.text('מספר בין 1 ל 9'),
      ],
      variableName: encodeState(step, Screen.SETRESULTCOUNT),
      fields: { max: '1', min: '1', timeout: '10', allowedKeys: '1.2.3.4.5.6.7.8.9', attempts: '2', acceptEmpty: 'Ok' },
    }),
  ]);
}

async function handleSetResultCount(call, state, step, profile) {
  const count = Number.parseInt(state.value, 10);

  if (!Number.isInteger(count) || count < config.search.minResultCount || count > config.search.maxResultCount) {
    return renderSettings(step, profile);
  }

  const updated = {
    ...profile,
    preferences: { ...profile.preferences, resultCount: count },
  };
  await persistProfile(call, updated);

  return Y.buildResponse([
    Y.idListMessage([Y.text(`מספר התוצאות שונה ל ${count}`)]),
    ...splitResponse(renderSettings(step, updated)),
  ]);
}

/* ------------------------------------------------------------------ */
/* אישור מחיקה                                                         */
/* ------------------------------------------------------------------ */

function renderConfirmDelete(step, scope) {
  const what = scope === 'all' ? 'כל הנתונים האישיים' : 'ההיסטוריה';

  return Y.buildResponse([
    Y.read({
      segments: [
        Y.text(`האם למחוק את ${what}?`),
        Y.text('לאישור הקישו 1'),
        Y.text('לביטול הקישו 2'),
      ],
      variableName: encodeState(step, Screen.CONFIRMDELETE, [scope === 'all' ? 'all' : 'hist']),
      fields: { max: '1', min: '1', timeout: '10', allowedKeys: '1.2', attempts: '2', acceptEmpty: 'Ok' },
    }),
  ]);
}

async function handleConfirmDelete(call, state, step, profile) {
  if (state.value !== '1') {
    return renderMainMenu(step);
  }

  const scope = state.args[0];
  const updated = scope === 'all' ? clearAll(profile) : clearHistory(profile);
  await persistProfile(call, updated);

  return Y.buildResponse([
    Y.idListMessage([
      Y.text(scope === 'all' ? 'כל הנתונים האישיים נמחקו' : 'ההיסטוריה נמחקה'),
    ]),
    ...splitResponse(renderMainMenu(step)),
  ]);
}

/* ------------------------------------------------------------------ */
/* עזר                                                                 */
/* ------------------------------------------------------------------ */

/**
 * ימות קוראת שורה-שורה, ולכן כדי לשרשר תשובה שנבנתה כבר, מפרקים אותה
 * חזרה לשורות ומשלבים אותן בתשובה החדשה.
 */
function splitResponse(response) {
  if (response instanceof Promise) {
    throw new Error('splitResponse קיבל הבטחה. יש להמתין לה לפני הקריאה.');
  }
  return String(response).split('\n').filter(Boolean);
}

async function loadProfileFor(call) {
  const key = await userKey(call.phone);
  return loadProfile(key);
}

async function persistProfile(call, profile) {
  const key = await userKey(call.phone);
  if (!key) return false;
  return saveProfile(key, profile);
}

async function recordHistory(call, profile, entry) {
  if (!profile.preferences.historyEnabled) return;
  const updated = addToHistory(profile, entry);
  await persistProfile(call, updated);
}

export default { handleCall };
