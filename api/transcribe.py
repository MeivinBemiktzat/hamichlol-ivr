"""
תמלול חיצוני - חלופה, לא הזרימה הראשית
========================================

חשוב לדעת לפני שמשתמשים בקובץ הזה
-----------------------------------
למערכת ימות המשיח יש **זיהוי דיבור מובנה**. מגדירים בשלוחה שדה מסוג voice
עם שפה he-IL, וימות מחזירה למודול טקסט מתומלל מוכן. זו הזרימה הראשית של
הפרויקט, והיא עדיפה משלוש סיבות:

  1. אין צורך להוריד קובץ שמע מימות, לשלוח אותו לשרת ולהמתין לתשובה בזמן
     שהמתקשר על הקו.
  2. אין תלות בשירות חיצוני נוסף שעלול ליפול.
  3. השיטה שבקובץ הזה נשענת על מפתח פנימי לא רשמי של גוגל, כפי שמתועד
     להלן, ואין עליו שום התחייבות של זמינות.

הקובץ נשמר בכל זאת, כי יש מקרים שבהם הוא נחוץ: שפה שימות אינה תומכת בה,
צורך בשליטה מלאה על התמלול, או כשל בזיהוי הדיבור של ימות.

כדי להפעיל אותו: TRANSCRIPTION_MODE=external וגם TRANSCRIBE_URL שמצביע
לנקודת הקצה הזו.

שיטת התמלול
-----------
ספריית SpeechRecognition עם recognize_google(), שמשתמשת במפתח ברירת מחדל
המוטמע בספרייה. אין צורך בחשבון Google Cloud, אבל זהו שימוש לא רשמי ולכן
אין ערבות לזמינות ארוכת טווח.

ריפוד שקט
---------
לפני התמלול מוסיפים חצי שנייה של שקט בתחילת ההקלטה ובסופה, כדי שהמנוע לא
"יבלע" חצאי מילים בקצוות. זה נעשה כאן על בייטי ה-wav, ולא בצד ימות, כי
בהקלטה של ימות אין אפשרות להוסיף שקט לתוך הקובץ עצמו.

תלויות
------
נדרש requirements.txt עם SpeechRecognition ו-pydub.
שימו לb: pydub דורש ffmpeg לפורמטים מסוימים. עבור wav רגיל הוא מסתדר
בלעדיו, ולכן הקוד כאן עובד עם wav בלבד.
"""

import io
import json
import os

# שפת התמלול. ניתן לשנות דרך משתנה סביבה בלי לגעת בקוד.
TRANSCRIBE_LANGUAGE = os.environ.get('TRANSCRIBE_LANGUAGE', 'he-IL')

# משך ריפוד השקט לפני ואחרי ההקלטה, במילישניות
SILENCE_PADDING_MS = int(os.environ.get('SILENCE_PADDING_MS', '500'))

# תקרת גודל לקובץ אודיו נכנס. הגנה בסיסית מפני קלט מנופח.
MAX_AUDIO_BYTES = int(os.environ.get('MAX_AUDIO_BYTES', str(4 * 1024 * 1024)))


def pad_with_silence(wav_bytes: bytes) -> bytes:
    """מוסיף שקט לפני ואחרי קובץ wav, ומחזיר בייטים של wav חדש."""
    from pydub import AudioSegment

    audio = AudioSegment.from_wav(io.BytesIO(wav_bytes))
    silence = AudioSegment.silent(
        duration=SILENCE_PADDING_MS, frame_rate=audio.frame_rate
    )
    padded = silence + audio + silence

    out = io.BytesIO()
    padded.export(out, format='wav')
    return out.getvalue()


def transcribe_wav_bytes(wav_bytes: bytes) -> str:
    """
    מתמלל בייטי wav לטקסט.
    מחזיר מחרוזת ריקה אם לא זוהה דיבור, וזו אינה שגיאה אלא תוצאה לגיטימית
    שהמודול הראשי יודע לטפל בה.
    """
    import speech_recognition as sr

    padded_bytes = pad_with_silence(wav_bytes)

    recognizer = sr.Recognizer()
    with sr.AudioFile(io.BytesIO(padded_bytes)) as source:
        audio_data = recognizer.record(source)

    try:
        return recognizer.recognize_google(audio_data, language=TRANSCRIBE_LANGUAGE)
    except sr.UnknownValueError:
        # לא זוהה דיבור בהקלטה
        return ''
    except sr.RequestError as exc:
        raise RuntimeError(f'שירות התמלול אינו זמין כרגע: {exc}') from exc


# --- נקודת קצה של Vercel Python ---
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))

            if content_length <= 0:
                self._send_json(400, {'error': 'לא התקבל קובץ אודיו'})
                return

            if content_length > MAX_AUDIO_BYTES:
                self._send_json(413, {'error': 'קובץ האודיו גדול מהמותר'})
                return

            wav_bytes = self.rfile.read(content_length)

            if not wav_bytes:
                self._send_json(400, {'error': 'לא התקבל קובץ אודיו'})
                return

            text = transcribe_wav_bytes(wav_bytes)
            self._send_json(200, {'text': text})

        except Exception as exc:  # noqa: BLE001
            # הודעת השגיאה חוזרת למודול ב-Node, שאחראי להמיר אותה להודעה
            # ידידותית למתקשר. היא לעולם אינה מושמעת כמו שהיא.
            self._send_json(500, {'error': str(exc)})

    def do_GET(self):
        """בדיקת תקינות פשוטה, כדי לוודא שהפונקציה נפרסה"""
        self._send_json(
            200,
            {
                'service': 'transcribe',
                'language': TRANSCRIBE_LANGUAGE,
                'note': 'ברירת המחדל של הפרויקט היא זיהוי הדיבור המובנה של ימות',
            },
        )

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
