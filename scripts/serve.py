#!/usr/bin/env python3
"""Static dev server for site/ that sends Cache-Control: no-cache (stdlib only).

Usage: python3 scripts/serve.py [--port 8000] [--dir site] [--bind 127.0.0.1]
"""
import argparse
import functools
import http.server


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--dir", default="site")
    ap.add_argument("--bind", default="127.0.0.1")
    a = ap.parse_args()
    handler = functools.partial(NoCacheHandler, directory=a.dir)
    with http.server.ThreadingHTTPServer((a.bind, a.port), handler) as httpd:
        print(f"Serving {a.dir}/ at http://{a.bind}:{a.port}/ (Cache-Control: no-cache)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
