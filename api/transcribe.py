"""
שירות תמלול בעברית עבור מודול החיפוש הקולי במכלול.
מקבל WAV ומחזיר תמלול + קוד שגיאה מובחן.
"""
import io
import json
import logging
from http.server import BaseHTTPRequestHandler
import speech_recognition as sr
from pydub import AudioSegment

TRANSCRIBE_LANGUAGE = "he-IL"
SILENCE_PADDING_MS = 500
MAX_AUDIO_BYTES = 12 * 1024 * 1024
MIN_AUDIO_DURATION_MS = 500

logging.basicConfig(level=logging.INFO)

def log_event(event, **details):
    logging.info(json.dumps({"scope": "hamichlol-transcribe", "event": event, **details}, ensure_ascii=False))

class TranscriptionError(Exception):
    def __init__(self, code, message, status):
        super().__init__(message)
        self.code, self.status, self.public_message = code, status, message

def pad_with_silence(wav_bytes: bytes) -> bytes:
    audio = AudioSegment.from_wav(io.BytesIO(wav_bytes))
    silence = AudioSegment.silent(duration=SILENCE_PADDING_MS, frame_rate=audio.frame_rate)
    output = io.BytesIO()
    (silence + audio + silence).export(output, format="wav")
    return output.getvalue()

def transcribe_wav_bytes(wav_bytes: bytes):
    audio = AudioSegment.from_wav(io.BytesIO(wav_bytes))
    duration_ms = len(audio)
    log_event("audio_inspected", bytes=len(wav_bytes), durationMs=duration_ms,
              frameRate=audio.frame_rate, channels=audio.channels, sampleWidth=audio.sample_width)
    if duration_ms < MIN_AUDIO_DURATION_MS:
        raise TranscriptionError("SHORT_AUDIO", f"ההקלטה קצרה מדי ({duration_ms}ms)", 422)

    padded_bytes = pad_with_silence(wav_bytes)
    recognizer = sr.Recognizer()
    with sr.AudioFile(io.BytesIO(padded_bytes)) as source:
        audio_data = recognizer.record(source)
    try:
        text = recognizer.recognize_google(audio_data, language=TRANSCRIBE_LANGUAGE).strip()
        if not text:
            raise TranscriptionError("NO_SPEECH", "לא זוהה דיבור בהקלטה", 422)
        log_event("transcription_success", textLength=len(text))
        return text
    except sr.UnknownValueError as exc:
        raise TranscriptionError("NO_SPEECH", "לא הצלחתי לזהות דיבור בהקלטה", 422) from exc
    except sr.RequestError as exc:
        raise TranscriptionError("GOOGLE_UNAVAILABLE", "שירות התמלול של Google אינו זמין כרגע", 503) from exc

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                self._send_json(400, {"ok": False, "code": "NO_AUDIO", "error": "לא התקבל קובץ אודיו"})
                return
            if content_length > MAX_AUDIO_BYTES:
                self._send_json(413, {"ok": False, "code": "AUDIO_TOO_LARGE", "error": "קובץ ההקלטה גדול מדי"})
                return
            wav_bytes = self.rfile.read(content_length)
            if not wav_bytes:
                self._send_json(400, {"ok": False, "code": "NO_AUDIO", "error": "לא התקבל קובץ אודיו"})
                return
            try:
                text = transcribe_wav_bytes(wav_bytes)
                self._send_json(200, {"ok": True, "text": text})
            except TranscriptionError as exc:
                log_event("transcription_error", code=exc.code, message=exc.public_message, status=exc.status)
                self._send_json(exc.status, {"ok": False, "code": exc.code, "error": exc.public_message})
        except Exception as exc:
            log_event("internal_error", error=str(exc)[:500])
            self._send_json(500, {"ok": False, "code": "TRANSCRIBE_INTERNAL_ERROR", "error": "אירעה שגיאה פנימית בשירות התמלול"})

    def do_GET(self):
        self._send_json(405, {"ok": False, "code": "METHOD_NOT_ALLOWED", "error": "יש לשלוח בקשת POST עם קובץ WAV"})

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
