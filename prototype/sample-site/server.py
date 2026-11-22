#!/usr/bin/env python3
"""Serves the sample site on http://localhost:8080 and accepts any form post.

Run:  python3 prototype/sample-site/server.py
Passwords are never stored or logged. The server only echoes the username on the welcome page.
"""
import html, os, urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        form = urllib.parse.parse_qs(self.rfile.read(length).decode())
        user = html.escape(form.get("username", ["someone"])[0])
        page = f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Welcome</title><link rel="stylesheet" href="/style.css"><h1>Welcome, {user}</h1>
<p>You are signed in. This is the page that follows a successful form submission.</p>
<nav><a href="/">Home</a><a href="/login.html">Sign in again</a></nav>""".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, fmt, *args):
        pass

if __name__ == "__main__":
    print("Sample site on http://localhost:8080")
    ThreadingHTTPServer(("127.0.0.1", 8080), Handler).serve_forever()
