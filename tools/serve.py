"""Static dev server.

Plain http.server lets the browser hold on to ES modules across edits, which
means you end up debugging code that is no longer on disk. Everything is served
no-store here, and the few types that matter get explicit content types.
"""

import base64
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
SHOT_DIR = os.environ.get("SHOT_DIR", "shots")

TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".jpg": "image/jpeg",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        """POST /__shot writes a base64 PNG to disk.

        The preview pane will not screenshot an emulated viewport at 1:1, so the
        page hands us its own framebuffer instead and we look at that.
        """
        if not self.path.startswith("/__shot"):
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n).decode("utf-8", "replace")
        name = self.path.split("=")[-1] if "=" in self.path else "shot"
        name = "".join(c for c in name if c.isalnum() or c in "-_.") or "shot"
        head, _, b64 = raw.partition(",")
        out = os.path.join(SHOT_DIR, name + ".png")
        os.makedirs(SHOT_DIR, exist_ok=True)
        with open(out, "wb") as f:
            f.write(base64.b64decode(b64 or head))
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(out.encode())

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def guess_type(self, path):
        for ext, mime in TYPES.items():
            if str(path).lower().endswith(ext):
                return mime
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        msg = fmt % args
        if " 200 " not in msg and " 206 " not in msg:
            sys.stderr.write("%s\n" % msg)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print("serving on http://127.0.0.1:%d" % PORT, flush=True)
        httpd.serve_forever()
