"""在 iPad 本机打开离线网页。不会监听无线网地址，也不会共享目录。"""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

FILE = Path(__file__).with_name("index.html")

class Local(BaseHTTPRequestHandler):
    def respond(self, body):
        if urlsplit(self.path).path not in ("/", "/index.html"):
            self.send_error(404)
            return
        try:
            with FILE.open("rb") as f:
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(FILE.stat().st_size))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                if body:
                    while chunk := f.read(65536):
                        self.wfile.write(chunk)
        except FileNotFoundError:
            self.send_error(404, "Place index.html beside ipad-local.py")

    def do_GET(self):
        self.respond(True)

    def do_HEAD(self):
        self.respond(False)

if __name__ == "__main__":
    print("在 Safari 打开 http://127.0.0.1:8787/ （无需网络）。", flush=True)
    with HTTPServer(("127.0.0.1",8787), Local) as server:
        server.serve_forever()
