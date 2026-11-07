"""Loopback photo inference service. Put behind an authenticated app proxy, not the public internet."""
import hmac
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LIMIT = 12 * 1024 * 1024
busy = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, {'status': 'ok'})
        return self.reply(404, {'error': 'Not found'})

    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != '/analyze':
            return self.reply(404, {'error': 'Not found'})
        token = os.environ.get('PHOTO_SERVICE_TOKEN')
        if token and not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
            return self.reply(401, {'error': 'Unauthorized'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            size = 0
        if size <= 0 or size > LIMIT:
            return self.reply(413, {'error': 'Photo must be at most 12 MB'})
        if not busy.acquire(blocking=False):
            return self.reply(429, {'error': 'Photo analysis is busy. Try again shortly.'})
        try:
            self.connection.settimeout(30)
            data = self.rfile.read(size)
            if len(data) != size:
                return self.reply(400, {'error': 'Incomplete photo'})
            with tempfile.TemporaryDirectory(prefix='photo-analysis-') as folder:
                root = Path(folder)
                photo = root / 'photo.jpg'
                photo.write_bytes(data)
                subprocess.run([sys.executable, str(Path(__file__).with_name('analyze_photos.py')),
                                str(photo), '--out', str(root / 'results'), '--model', 'fast'],
                               check=True, capture_output=True, timeout=90)
                report = json.loads(next((root / 'results').glob('*.json')).read_text())
                return self.reply(200, report)
        except subprocess.TimeoutExpired:
            return self.reply(504, {'error': 'Analysis timed out. Try a smaller photo.'})
        except Exception:
            return self.reply(422, {'error': 'Could not analyze this image. Use JPEG, PNG or WebP.'})
        finally:
            busy.release()

if __name__ == '__main__':
    host = os.environ.get('PHOTO_SERVICE_HOST', '127.0.0.1')
    if host not in ('127.0.0.1', 'localhost') and not os.environ.get('PHOTO_SERVICE_TOKEN'):
        raise SystemExit('A service token is required for a non-loopback host')
    server = ThreadingHTTPServer((host, int(os.environ.get('PHOTO_SERVICE_PORT', '3140'))), Handler)
    print('Photo inference service ready', flush=True)
    server.serve_forever()
