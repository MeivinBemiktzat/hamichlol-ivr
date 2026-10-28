/**
 * שכבת האחסון
 * ============
 * ממשק אחיד לכל שאר המערכת: get, set, delete, has.
 * מאחוריו אפשר להחליף שירות אחסון בלי לגעת בשום קוד עסקי.
 *
 * כלל חשוב: המערכת חייבת לפעול גם כשאין אחסון כלל. בלי אחסון פשוט אין
 * היסטוריה, מועדפים והעדפות קבועות, אבל החיפוש וההאזנה עובדים במלואם.
 * לכן כשלון אחסון לעולם אינו מפיל שיחה.
 */

import { config } from '../config.js';
import { logger } from '../logger.js';
import { MemoryStorage } from './memory.js';
import { HuggingFaceStorage } from './huggingface.js';

/** אחסון מדומה שלא שומר כלום. מאפשר למערכת לרוץ בלי שום הגדרה. */
export class NullStorage {
  get name() {
    return 'none';
  }
  async get() {
    return null;
  }
  async set() {}
  async delete() {
    return false;
  }
  async has() {
    return false;
  }
}

let instance = null;

/** בונה את מופע האחסון לפי ההגדרות */
export function createStorage(overrides = {}) {
  const driver = overrides.driver ?? config.storage.driver;

  switch (driver) {
    case 'huggingface': {
      const repo = overrides.repo ?? config.storage.hfRepo;
      const token = overrides.token ?? config.storage.hfToken;

      if (!repo || !token) {
        logger.warn(
          'אחסון Hugging Face נבחר אך חסרים HF_DATASET_REPO או HF_TOKEN. המערכת תרוץ בלי אחסון.'
        );
        return new NullStorage();
      }

      return new HuggingFaceStorage({
        repo,
        token,
        endpoint: overrides.endpoint ?? config.storage.hfEndpoint,
      });
    }

    case 'memory':
      return new MemoryStorage();

    case 'none':
    default:
      return new NullStorage();
  }
}

/** מופע משותף */
export function getStorage() {
  if (!instance) instance = createStorage();
  return instance;
}

/** לשימוש בבדיקות */
export function setStorage(storage) {
  instance = storage;
}

/**
 * עוטף פעולת אחסון כך שכשלון לא יפיל את השיחה.
 * מחזיר את ערך ברירת המחדל ורושם אזהרה.
 */
export async function safeStorageCall(operation, fallback = null) {
  try {
    return await operation();
  } catch (error) {
    logger.warn('פעולת אחסון נכשלה', {
      code: error?.code,
      details: error?.details,
    });
    return fallback;
  }
}

export default { createStorage, getStorage, setStorage, safeStorageCall, NullStorage };
