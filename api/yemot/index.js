/**
 * נקודת הכניסה למודול ה-API של ימות המשיח
 * ==========================================
 * זו הכתובת שמוגדרת בשלוחה בהגדרה api_link.
 *
 * כללי ברזל של ימות:
 *  - התשובה חייבת להיות טקסט רגיל. JSON או HTML גורמים לשגיאה M1607.
 *  - תמיד להחזיר קוד 200. גם כשיש תקלה אצלנו, המתקשר צריך לשמוע הודעה
 *    ידידותית ולא ליפול מהשלוחה.
 */

import { parseCall } from '../../lib/yemot/params.js';
import { handleCall } from '../../lib/router.js';
import { logger } from '../../lib/logger.js';
import Y from '../../lib/yemot/response.js';
import { GENERIC_SPOKEN_ERROR } from '../../lib/errors.js';

/** גודל מרבי לגוף בקשה, כהגנה בסיסית מפני קלט מנופח */
const MAX_BODY_BYTES = 64 * 1024;

export default async function handler(req, res) {
  const startedAt = Date.now();

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  try {
    // ימות שולחת GET כברירת מחדל, ו-POST כשמוגדר api_url_post=yes
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(200).send(
        Y.buildResponse([
          Y.idListMessage([Y.text('שיטת פנייה לא נתמכת')]),
          Y.goToRoot(),
        ])
      );
      return;
    }

    if (typeof req.body === 'string' && req.body.length > MAX_BODY_BYTES) {
      logger.warn('גוף בקשה גדול מהמותר', { length: req.body.length });
      res.status(200).send(
        Y.buildResponse([
          Y.idListMessage([Y.text(GENERIC_SPOKEN_ERROR)]),
          Y.goToRoot(),
        ])
      );
      return;
    }

    const call = parseCall(req);

    logger.info('בקשה מימות', {
      callId: call.callId,
      phone: call.phone,
      extension: call.extension,
      hangup: call.isHangup,
      collectedKeys: Object.keys(call.collected).length,
    });

    const body = await handleCall(call);

    logger.info('תשובה נשלחה', {
      callId: call.callId,
      ms: Date.now() - startedAt,
      lines: body ? body.split('\n').length : 0,
    });

    res.status(200).send(body);
  } catch (error) {
    /**
     * שגיאה לא צפויה. הפרטים נשארים בלוג, והמתקשר שומע הודעה כללית
     * בלי שום פרט טכני.
     */
    logger.error('שגיאה לא צפויה בטיפול בבקשה', {
      message: error?.message,
      stack: error?.stack,
      ms: Date.now() - startedAt,
    });

    res.status(200).send(
      Y.buildResponse([
        Y.idListMessage([Y.text(GENERIC_SPOKEN_ERROR)]),
        Y.goToRoot(),
      ])
    );
  }
}
