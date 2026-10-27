"""
שירות תמלול בעברית עבור מודול החיפוש הקולי במכלול.
נפרס באותו פרויקט Vercel תחת /api/transcribe.py.
מקבל בייטים של WAV בבקשת POST ומחזיר {"text": "..."}.
"""

import io
import json
from http.server import BaseHTTPRequestHandler

import speech_recognition as sr
from pydub import AudioSegment

TRANSCRIBE_LANGUAGE = "he-IL"
SILENCE_PADDING_MS = 500
MAX_AUDIO_BYTES = 12 * 1024 * 1024


def pad_with_silence(wav_bytes: bytes) -> bytes:
    """מוסיף חצי שנייה של שקט לפני ואחרי קובץ WAV."""
    audio = AudioSegment.from_wav(io.BytesIO(wav_bytes))
    silence = AudioSegment.silent(
        duration=SILENCE_PADDING_MS,
        frame_rate=audio.frame_rate,
    )
    output = io.BytesIO()
    (silence + audio + silence).export(output, format="wav")
    return output.getvalue()


def transcribe_wav_bytes(wav_bytes: bytes) -> str:
    padded_bytes = pad_with_silence(wav_bytes)
    recognizer = sr.Recognizer()

    with sr.AudioFile(io.BytesIO(padded_bytes)) as source:
        audio_data = recognizer.record(source)

    try:
        return recognizer.recognize_google(
            audio_data,
            language=TRANSCRIBE_LANGUAGE,
        )
    except sr.UnknownValueError:
        return ""
    except sr.RequestError as exc:
        raise RuntimeError("שירות התמלול של Google אינו זמין כרגע") from exc


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                self._send_json(400, {"error": "לא התקבל קובץ אודיו"})
                return
            if content_length > MAX_AUDIO_BYTES:
                self._send_json(413, {"error": "קובץ ההקלטה גדול מדי"})
                return

            wav_bytes = self.rfile.read(content_length)
            if not wav_bytes:
                self._send_json(400, {"error": "לא התקבל קובץ אודיו"})
                return

            text = transcribe_wav_bytes(wav_bytes)
            self._send_json(200, {"text": text})
        except Exception:
            # לא מחזירים פרטי חריגה פנימיים או מידע רגיש ללקוח.
            self._send_json(500, {"error": "התמלול נכשל. יש לנסות שוב."})

    def do_GET(self):
        self._send_json(405, {"error": "יש לשלוח בקשת POST עם קובץ WAV"})

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
