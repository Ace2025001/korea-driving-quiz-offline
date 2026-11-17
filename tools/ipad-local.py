"""在 iPad 本机打开离线网页及其内嵌视频，只绑定回环地址。"""
import base64
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from mmap import mmap, ACCESS_READ
from pathlib import Path
import re
from urllib.parse import urlsplit

FILE = Path(__file__).with_name("index.html")
ASSETS = b',"assets":['
MP4 = b'data:video/mp4;base64,'

@lru_cache(maxsize=1)
def video_index(signature):
    # 只找内嵌资源的字节范围，不把整份 HTML 临时复制进内存。
    with FILE.open("rb") as f, mmap(f.fileno(),0,access=ACCESS_READ) as raw:
        begin=raw.find(ASSETS)
        pos=begin+len(ASSETS)
        offsets={}
        i=0
        while begin!=-1 and raw[pos:pos+1]==b'"':
            start=pos+1
            end=raw.find(b'"',start)
            if end<0:
                break
            if raw[start:start+len(MP4)]==MP4:
                start+=len(MP4)
                padding=2 if raw[end-2:end]==b'==' else int(raw[end-1:end]==b'=')
                offsets[i]=(start,end,(end-start)//4*3-padding)
            pos=end+2
            i+=1
        return offsets

def byte_range(value,length):
    if value is None:
        return 0,length-1
    m=re.fullmatch(r"bytes=(\d{0,14})-(\d{0,14})",value)
    if not m or not any(m.groups()):
        return None
    if not m[1]:
        first=max(0,length-int(m[2]))
        last=length-1
    else:
        first=int(m[1])
        last=min(length-1,int(m[2])) if m[2] else length-1
    return (first,last) if first<=last and first<length else None

class Local(BaseHTTPRequestHandler):
    def asset(self, number, body):
        stat=FILE.stat()
        row=video_index((stat.st_mtime_ns,stat.st_size)).get(number)
        if not row:
            self.send_error(404)
            return
        offset,end,length=row
        requested=self.headers.get("Range")
        part=byte_range(requested,length)
        if part is None:
            self.send_response(416)
            self.send_header("Content-Range",f"bytes */{length}")
            self.send_header("Content-Length","0")
            self.end_headers()
            return
        first,last=part
        count=last-first+1
        self.send_response(206 if requested else 200)
        self.send_header("Content-Type","video/mp4")
        self.send_header("Accept-Ranges","bytes")
        self.send_header("Content-Length",str(count))
        if requested:
            self.send_header("Content-Range",f"bytes {first}-{last}/{length}")
        self.end_headers()
        if body:
            a=offset+(first//3)*4
            b=min(end,offset+(last//3+1)*4)
            with FILE.open("rb") as f:
                f.seek(a)
                data=base64.b64decode(f.read(b-a),validate=True)
            self.wfile.write(data[first%3:first%3+count])

    def respond(self, body):
        path=urlsplit(self.path).path
        movie=re.fullmatch(r"/media/(\d{1,6})\.mp4",path)
        try:
            if movie:
                self.asset(int(movie[1]),body)
                return
            if path not in ("/", "/index.html"):
                self.send_error(404)
                return
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
        except (BrokenPipeError,ConnectionResetError):
            pass

    def do_GET(self):
        self.respond(True)

    def do_HEAD(self):
        self.respond(False)

if __name__ == "__main__":
    print("在 Safari 打开 http://127.0.0.1:8787/ （无需网络）。", flush=True)
    with ThreadingHTTPServer(("127.0.0.1",8787),Local) as server:
        server.serve_forever()
