"""tests/test_functional_verify.py -- FV-1 harness (autonomy/lib/functional-verify.py).

Proves the harness distinguishes a WORKING backend (functional_status=verified)
from a STATIC shell that reads verified today but does nothing (failed) -- the
founder's exact bug -- WITHOUT fabricating: a strict app that rejects the probe
payload is inconclusive (schema mismatch), never a fake-RED failed.

The HTTP layer is exercised against a real in-process http.server so the probe
path is genuinely tested, not mocked.
"""
from __future__ import annotations

import importlib.util
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


def _load():
    here = Path(__file__).resolve().parent.parent
    path = here / "autonomy" / "lib" / "functional-verify.py"
    spec = importlib.util.spec_from_file_location("functional_verify", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


FV = _load()

SPEC = "Task board REST API. Endpoints: GET /api/tasks, POST /api/tasks, DELETE /api/tasks/:id."


class _App:
    """A tiny configurable app: 'working' (real CRUD), 'static' (404/501 on API),
    or 'strict' (POST 400 -- endpoint exists, rejects the probe payload)."""

    def __init__(self, mode):
        self.mode = mode
        self.tasks = []
        self._next = 1

    def handler(self):
        app = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, body=None):
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                if body is not None:
                    self.wfile.write(json.dumps(body).encode())

            def do_GET(self):
                if self.path == "/api/tasks":
                    if app.mode == "static":
                        return self._send(404)
                    return self._send(200, app.tasks)
                return self._send(404)

            def do_POST(self):
                if self.path != "/api/tasks":
                    return self._send(404)
                if app.mode == "static":
                    return self._send(501)
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length) if length else b"{}"
                data = json.loads(raw or b"{}")
                if app.mode == "strict" and "email" not in data:
                    return self._send(400, {"error": "email required"})
                item = {"id": str(app._next), **data}
                app._next += 1
                app.tasks.append(item)
                return self._send(201, item)

            def do_DELETE(self):
                if not self.path.startswith("/api/tasks/"):
                    return self._send(404)
                tid = self.path.rsplit("/", 1)[-1]
                before = len(app.tasks)
                app.tasks = [t for t in app.tasks if t.get("id") != tid]
                return self._send(204 if len(app.tasks) < before else 404)

        return H


class FunctionalVerifyLive(unittest.TestCase):
    def _serve(self, mode):
        app = _App(mode)
        srv = HTTPServer(("127.0.0.1", 0), app.handler())
        port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        self.addCleanup(srv.shutdown)
        return f"http://127.0.0.1:{port}"

    def test_working_backend_is_verified(self):
        # The founder's task board: GET responds, POST persists, DELETE removes.
        base = self._serve("working")
        out = FV.run(SPEC, base)
        self.assertEqual(out["functional_status"], "verified", out)
        statuses = {b["behavior"].split()[0]: b["status"] for b in out["spec_behaviors"]}
        self.assertEqual(statuses.get("GET"), "passed")
        self.assertEqual(statuses.get("POST"), "passed")
        self.assertEqual(statuses.get("DELETE"), "passed")

    def test_static_shell_is_failed(self):
        # A static page for the same spec: no working API. Must be DETECTED as
        # failed -- this is the whole point (a "Verified" card on a dead backend).
        base = self._serve("static")
        out = FV.run(SPEC, base)
        self.assertEqual(out["functional_status"], "failed", out)

    def test_strict_app_is_inconclusive_not_fake_red(self):
        # A WORKING app that requires a field our probe didn't send (email) rejects
        # with 400. That is NOT proof of no-persistence -- marking it failed would
        # be a fake-RED. Must be inconclusive.
        base = self._serve("strict")
        out = FV.run(SPEC, base)
        post = next(b for b in out["spec_behaviors"] if b["behavior"].startswith("POST"))
        self.assertEqual(post["status"], "inconclusive", out)
        self.assertNotEqual(out["functional_status"], "failed",
                            "a strict-but-working app must never read failed")


class SpecParsing(unittest.TestCase):
    def test_trailing_punctuation_stripped(self):
        # "DELETE /api/tasks/:id." must parse the path without the trailing period,
        # else the probe hits a wrong URL and fabricates a DELETE failure.
        a = FV.derive_endpoint_assertions("DELETE /api/tasks/:id.")
        self.assertEqual(a[0]["path"], "/api/tasks/:id")
        self.assertTrue(a[0]["is_resource"])

    def test_no_endpoints_is_inconclusive(self):
        out = FV.run("A static marketing page with a hero.", "http://127.0.0.1:1")
        self.assertEqual(out["summary"]["functional_status"], "inconclusive")


if __name__ == "__main__":
    unittest.main()
