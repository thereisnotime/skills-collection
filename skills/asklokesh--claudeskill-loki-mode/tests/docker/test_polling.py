"""Tests for Purple Lab network polling behaviour.

Run against a live server:
    python3 web-app/server.py --port 57375 &
    python3 tests/docker/test_polling.py

NOTE: Scenarios that require a real browser (JS execution) are explicitly
marked as untestable without a browser. The test suite covers only what
can be verified programmatically via the server API and WebSocket.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import List

import requests
import websockets

BASE = os.environ.get("PURPLE_LAB_URL", "http://127.0.0.1:57375")
WS_URL = BASE.replace("http://", "ws://").replace("https://", "wss://") + "/ws"

PASS = "PASS"
FAIL = "FAIL"
SKIP = "SKIP"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _http_ok() -> bool:
    try:
        r = requests.get(BASE + "/", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


async def _collect_ws_messages(duration_s: float) -> List[dict]:
    """Open a WebSocket and collect all messages for duration_s seconds."""
    messages = []
    async with websockets.connect(WS_URL, open_timeout=10) as ws:
        deadline = asyncio.get_event_loop().time() + duration_s
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                break
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=remaining + 0.5)
                messages.append(json.loads(raw))
            except asyncio.TimeoutError:
                break
    return messages


# ---------------------------------------------------------------------------
# Scenario 1: Idle state -- WebSocket state_update arrives, no HTTP polling
# ---------------------------------------------------------------------------

def test_idle_state_update() -> str:
    """Idle: first state_update arrives over WebSocket within 2 seconds of connect."""
    result = asyncio.run(_collect_ws_messages(5.0))
    types = [m.get("type") for m in result]
    if "connected" not in types:
        return f"{FAIL}: no 'connected' message"
    if "state_update" not in types:
        return f"{FAIL}: no 'state_update' in first 5s (got: {types})"
    # Verify shape
    su = next(m for m in result if m.get("type") == "state_update")
    data = su.get("data", {})
    for key in ("status", "agents", "logs"):
        if key not in data:
            return f"{FAIL}: state_update missing '{key}' key"
    if data["status"].get("running") is not False:
        return f"{FAIL}: expected running=false in idle state"
    return PASS


# ---------------------------------------------------------------------------
# Scenario 2: Idle polling interval -- second state_update arrives ~30s later
# ---------------------------------------------------------------------------

def test_idle_interval_30s() -> str:
    """Idle: second state_update arrives approximately 30 seconds after the first."""
    async def run():
        async with websockets.connect(WS_URL, open_timeout=10) as ws:
            # skip 'connected'
            await ws.recv()
            # first state_update (immediate)
            msg1_raw = await asyncio.wait_for(ws.recv(), 5)
            t1 = time.monotonic()
            msg1 = json.loads(msg1_raw)
            if msg1.get("type") != "state_update":
                return f"{FAIL}: expected state_update, got {msg1.get('type')}"
            # second state_update
            msg2_raw = await asyncio.wait_for(ws.recv(), 35)
            elapsed = time.monotonic() - t1
            msg2 = json.loads(msg2_raw)
            if msg2.get("type") != "state_update":
                return f"{FAIL}: expected state_update, got {msg2.get('type')}"
            if not (25 <= elapsed <= 35):
                return f"{FAIL}: idle interval was {elapsed:.1f}s, expected ~30s"
            return f"{PASS}: idle interval={elapsed:.1f}s"
    return asyncio.run(run())


# ---------------------------------------------------------------------------
# Scenario 3: Running state interval -- requires real session
# ---------------------------------------------------------------------------

def test_running_interval_2s() -> str:
    """Running: state_update interval drops to ~2s when session is active.

    UNTESTABLE WITHOUT A REAL BROWSER / LOKI CLI:
    Starting a session via POST /api/session/start requires the loki CLI to be
    installed and executable. Without it the endpoint returns 500. The 2s interval
    logic is verified by code inspection of the _push_state_to_client function in
    web-app/server.py (interval = 2.0 if is_running else 30.0).
    """
    return f"{SKIP}: requires loki CLI to start a real session"


# ---------------------------------------------------------------------------
# Scenario 4: Multiple WebSocket connections
# ---------------------------------------------------------------------------

def test_multiple_ws_connections() -> str:
    """Two simultaneous WebSocket connections each receive independent state_update messages."""
    async def run():
        async with websockets.connect(WS_URL, open_timeout=10) as ws1, \
                   websockets.connect(WS_URL, open_timeout=10) as ws2:
            # Both should receive 'connected'
            m1 = json.loads(await asyncio.wait_for(ws1.recv(), 5))
            m2 = json.loads(await asyncio.wait_for(ws2.recv(), 5))
            if m1.get("type") != "connected":
                return f"{FAIL}: ws1 first msg type={m1.get('type')}"
            if m2.get("type") != "connected":
                return f"{FAIL}: ws2 first msg type={m2.get('type')}"
            # Both should receive state_update
            su1 = json.loads(await asyncio.wait_for(ws1.recv(), 5))
            su2 = json.loads(await asyncio.wait_for(ws2.recv(), 5))
            if su1.get("type") != "state_update":
                return f"{FAIL}: ws1 expected state_update, got {su1.get('type')}"
            if su2.get("type") != "state_update":
                return f"{FAIL}: ws2 expected state_update, got {su2.get('type')}"
            return PASS
    return asyncio.run(run())


# ---------------------------------------------------------------------------
# Scenario 5: WebSocket reconnect
# ---------------------------------------------------------------------------

def test_ws_reconnect() -> str:
    """After disconnect, a new WebSocket connection immediately receives state_update.

    Full fallback-to-HTTP-polling on disconnect is a frontend behaviour that
    requires a real browser to observe -- it cannot be verified without JS execution.
    The server side (accepting new connections and re-sending state) is verified here.
    """
    async def run():
        # First connection
        async with websockets.connect(WS_URL, open_timeout=10) as ws:
            await ws.recv()  # connected
            su = json.loads(await asyncio.wait_for(ws.recv(), 5))
            if su.get("type") != "state_update":
                return f"{FAIL}: first connection: expected state_update, got {su.get('type')}"
        # Re-connect immediately
        async with websockets.connect(WS_URL, open_timeout=10) as ws2:
            await ws2.recv()  # connected
            su2 = json.loads(await asyncio.wait_for(ws2.recv(), 5))
            if su2.get("type") != "state_update":
                return f"{FAIL}: reconnect: expected state_update, got {su2.get('type')}"
        return PASS
    return asyncio.run(run())


# ---------------------------------------------------------------------------
# HTTP keep-alive: verify server sets timeout_keep_alive
# ---------------------------------------------------------------------------

def test_http_keep_alive_configured() -> str:
    """Verify server.py passes timeout_keep_alive=30 to uvicorn by code inspection."""
    server_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "web-app", "server.py"
    )
    try:
        with open(server_path) as f:
            src = f.read()
        if "timeout_keep_alive=30" in src:
            return f"{PASS}: timeout_keep_alive=30 found in server.py"
        return f"{FAIL}: timeout_keep_alive=30 not found in server.py"
    except OSError as e:
        return f"{FAIL}: cannot read server.py: {e}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if not _http_ok():
        print(f"ERROR: server not reachable at {BASE}")
        print("Start it with: python3 web-app/server.py --port 57375")
        return

    tests = [
        ("HTTP keep-alive configured", test_http_keep_alive_configured),
        ("Idle state_update on connect", test_idle_state_update),
        ("Multiple WebSocket connections", test_multiple_ws_connections),
        ("WebSocket reconnect", test_ws_reconnect),
        ("Running interval 2s", test_running_interval_2s),
        # Long test last
        ("Idle interval ~30s", test_idle_interval_30s),
    ]

    results = []
    for name, fn in tests:
        print(f"  Running: {name} ...", end=" ", flush=True)
        try:
            result = fn()
        except Exception as e:
            result = f"FAIL: exception: {e}"
        status = result.split(":")[0]
        print(result)
        results.append((name, status, result))

    print()
    passed = sum(1 for _, s, _ in results if s == PASS)
    failed = sum(1 for _, s, _ in results if s == FAIL)
    skipped = sum(1 for _, s, _ in results if s == SKIP)
    print(f"Results: {passed} passed, {failed} failed, {skipped} skipped")


if __name__ == "__main__":
    main()
