/**
 * שגיאות המערכת
 * ==============
 * לכל שגיאה יש שני פנים: הודעה ידידותית שתוקרא למתקשר, ופרטים טכניים
 * שנשארים בלוג. המתקשר לעולם לא שומע שם שרת, קוד HTTP או עקבת שגיאה.
 */

export class AppError extends Error {
  /**
   * @param {string} code מזהה קצר לצורכי לוג ובדיקות
   * @param {string} spoken מה שיוקרא למתקשר
   * @param {object} [details] פרטים טכניים ללוג בלבד
   */
  constructor(code, spoken, details = {}) {
    super(`${code}: ${spoken}`);
    this.name = 'AppError';
    this.code = code;
    this.spoken = spoken;
    this.details = details;
  }
}

export class SourceUnavailableError extends AppError {
  constructor(details) {
    super(
      'SOURCE_UNAVAILABLE',
      'מאגר המידע אינו זמין כרגע. אנא נסו שוב בעוד מספר דקות',
      details
    );
    this.name = 'SourceUnavailableError';
  }
}

export class SourceBlockedError extends AppError {
  constructor(details) {
    super(
      'SOURCE_BLOCKED',
      'מאגר המידע חוסם כרגע את הגישה מהשרת. אנא פנו למנהל המערכת',
      details
    );
    this.name = 'SourceBlockedError';
  }
}

export class NotFoundError extends AppError {
  constructor(details) {
    super('NOT_FOUND', 'הערך המבוקש לא נמצא', details);
    this.name = 'NotFoundError';
  }
}

export class EmptyContentError extends AppError {
  constructor(details) {
    super('EMPTY_CONTENT', 'לערך זה אין תוכן להקראה', details);
    this.name = 'EmptyContentError';
  }
}

export class TimeoutError extends AppError {
  constructor(details) {
    super('TIMEOUT', 'מאגר המידע לא הגיב בזמן. אנא נסו שוב', details);
    this.name = 'TimeoutError';
  }
}

export class StorageError extends AppError {
  constructor(details) {
    super(
      'STORAGE_ERROR',
      'לא ניתן לשמור את הנתונים כרגע. שאר המערכת פועלת כרגיל',
      details
    );
    this.name = 'StorageError';
  }
}

export class TranscriptionError extends AppError {
  constructor(details) {
    super('TRANSCRIPTION_ERROR', 'לא הצלחתי להבין את ההקלטה', details);
    this.name = 'TranscriptionError';
  }
}

/** הודעה כללית לשגיאה לא צפויה */
export const GENERIC_SPOKEN_ERROR = 'אירעה תקלה זמנית. אנא נסו שוב';

/** מחלץ טקסט להקראה מכל שגיאה, גם כזו שלא מוכרת לנו */
export function spokenFor(error) {
  if (error instanceof AppError) return error.spoken;
  return GENERIC_SPOKEN_ERROR;
}

export default {
  AppError,
  SourceUnavailableError,
  SourceBlockedError,
  NotFoundError,
  EmptyContentError,
  TimeoutError,
  StorageError,
  TranscriptionError,
  spokenFor,
  GENERIC_SPOKEN_ERROR,
};
