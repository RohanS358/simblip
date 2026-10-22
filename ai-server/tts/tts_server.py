"""Neural text-to-speech sidecar (Kokoro-82M, ONNX, CPU). Linux browsers ship no speech voices, so the
AI server speaks for them.

    .cache/tts-venv/bin/python ai-server/tts/tts_server.py            # 127.0.0.1:8788

POST /speak {"text": str, "voice": "af_heart", "speed": 1.0} -> audio/wav
GET  /voices                                               -> {"voices": [...]}
Results are cached on disk by hash: a line is synthesised once, ever.
"""
import hashlib, io, json, os, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.environ.get('TTS_MODELS', os.path.join(os.path.dirname(__file__), '..', '..', '.cache', 'tts'))
CACHE = os.environ.get('TTS_CACHE', os.path.join(ROOT, 'cache'))
os.makedirs(CACHE, exist_ok=True)
kokoro = Kokoro(os.path.join(ROOT, 'kokoro-v1.0.onnx'), os.path.join(ROOT, 'voices-v1.0.bin'))
VOICES = set(kokoro.get_voices())
lock = threading.Lock()  # one synthesis at a time; the model is not re-entrant


def lang_of(voice: str) -> str:
    return {'a': 'en-us', 'b': 'en-gb', 'h': 'hi', 'e': 'es', 'f': 'fr-fr', 'i': 'it', 'j': 'ja', 'z': 'cmn'}.get(voice[0], 'en-us')


def synth(text: str, voice: str, speed: float) -> bytes:
    key = hashlib.sha1(f'{voice}|{speed:.2f}|{text}'.encode()).hexdigest()
    path = os.path.join(CACHE, key + '.wav')
    if os.path.exists(path):
        return open(path, 'rb').read()
    with lock:
        samples, rate = kokoro.create(text, voice=voice, speed=speed, lang=lang_of(voice))
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format='WAV', subtype='PCM_16')
    data = buf.getvalue()
    with open(path + '.tmp', 'wb') as f:
        f.write(data)
    os.replace(path + '.tmp', path)
    return data


class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/voices':
            return self._send(200, json.dumps({'voices': sorted(VOICES)}).encode())
        self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        if self.path != '/speak':
            return self._send(404, b'{"error":"not found"}')
        try:
            n = int(self.headers.get('Content-Length', '0'))
            if n > 20_000:
                return self._send(413, b'{"error":"too large"}')
            body = json.loads(self.rfile.read(n) or b'{}')
            text = str(body.get('text', '')).strip()[:800]
            voice = body.get('voice', 'af_heart')
            speed = min(1.6, max(0.6, float(body.get('speed', 1.0))))
            if not text or voice not in VOICES:
                return self._send(400, b'{"error":"bad text or voice"}')
            self._send(200, synth(text, voice, speed), 'audio/wav')
        except Exception as e:  # never take the server down for one bad request
            self._send(500, json.dumps({'error': str(e)[:200]}).encode())

    def log_message(self, *a):  # request logs would contain the text being spoken
        pass


if __name__ == '__main__':
    port = int(os.environ.get('TTS_PORT', '8788'))
    print(f'TTS on 127.0.0.1:{port} ({len(VOICES)} voices)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
