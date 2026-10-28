/**
 * נתוני משתמש: היסטוריה, מועדפים והעדפות
 * =========================================
 * אלה הנתונים היחידים שנשמרים באחסון. הם משתנים לעיתים רחוקות, ולכן
 * מתאימים לאחסון מבוסס גיט. ראו lib/storage/huggingface.js.
 *
 * פרטיות: המפתח הוא גיבוב חד-כיווני של מספר הטלפון, ולא המספר עצמו.
 * אם המשתמש כיבה שמירת היסטוריה, לא נכתב כלום מלבד ההעדפה עצמה.
 */

import { config } from '../config.js';
import { getStorage, safeStorageCall } from '../storage/index.js';

/** המבנה שנשמר לכל משתמש */
export function emptyProfile() {
  return {
    version: 1,
    preferences: {
      resultCount: config.search.defaultResultCount,
      historyEnabled: config.privacy.historyEnabledByDefault,
      /** 'voice' או 'keypad' */
      searchMode: 'voice',
      /** האם לעבור אוטומטית למקטע הבא בסוף מקטע */
      autoAdvance: true,
    },
    history: [],
    favorites: [],
    updatedAt: null,
  };
}

/** טוען פרופיל משתמש. מחזיר פרופיל ריק אם אין אחסון או אין משתמש. */
export async function loadProfile(userId) {
  if (!userId) return emptyProfile();

  const stored = await safeStorageCall(() => getStorage().get(userId), null);
  if (!stored) return emptyProfile();

  // מיזוג עם ברירות המחדל, כדי ששדה חדש בגרסה חדשה לא ישבור פרופיל ישן
  const base = emptyProfile();
  return {
    ...base,
    ...stored,
    preferences: { ...base.preferences, ...(stored.preferences ?? {}) },
    history: Array.isArray(stored.history) ? stored.history : [],
    favorites: Array.isArray(stored.favorites) ? stored.favorites : [],
  };
}

/** שומר פרופיל. כשלון אינו מפיל את השיחה. */
export async function saveProfile(userId, profile) {
  if (!userId) return false;

  const payload = { ...profile, updatedAt: new Date().toISOString() };
  const result = await safeStorageCall(
    () => getStorage().set(userId, payload).then(() => true),
    false
  );
  return result === true;
}

/** מוסיף ערך להיסטוריה, בלי כפילויות, עם תקרה */
export function addToHistory(profile, entry) {
  if (!profile.preferences.historyEnabled) return profile;

  const filtered = profile.history.filter((item) => item.title !== entry.title);
  const history = [
    { title: entry.title, query: entry.query ?? '', at: Date.now() },
    ...filtered,
  ].slice(0, config.privacy.maxHistoryItems);

  return { ...profile, history };
}

/** מוסיף או מסיר מועדף, ומחזיר גם מה קרה בפועל */
export function toggleFavorite(profile, title) {
  const exists = profile.favorites.some((item) => item.title === title);

  if (exists) {
    return {
      profile: {
        ...profile,
        favorites: profile.favorites.filter((item) => item.title !== title),
      },
      added: false,
    };
  }

  if (profile.favorites.length >= config.privacy.maxFavorites) {
    return { profile, added: false, full: true };
  }

  return {
    profile: {
      ...profile,
      favorites: [{ title, at: Date.now() }, ...profile.favorites],
    },
    added: true,
  };
}

/** מוחק את כל ההיסטוריה */
export function clearHistory(profile) {
  return { ...profile, history: [] };
}

/** מוחק את כל הנתונים האישיים ומחזיר לברירת מחדל */
export function clearAll(profile) {
  const fresh = emptyProfile();
  // ההעדפה אם לשמור היסטוריה נשמרת, כי היא בחירת פרטיות מודעת של המשתמש
  fresh.preferences.historyEnabled = profile.preferences.historyEnabled;
  return fresh;
}

export default {
  emptyProfile,
  loadProfile,
  saveProfile,
  addToHistory,
  toggleFavorite,
  clearHistory,
  clearAll,
};
