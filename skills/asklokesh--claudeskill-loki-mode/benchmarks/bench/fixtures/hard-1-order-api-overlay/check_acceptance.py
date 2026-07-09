#!/usr/bin/env python3
"""Held-out acceptance for hard-1-order-api. Zero-install (stdlib only).

Imports order_api.handle and asserts the full REST-semantics contract:
input validation (400s), correct total computation + discount, and 200 on
valid input. A naive implementation that skips validation or discount fails.
Exits 0 only if every assertion passes. The agent never sees this file.
"""
import os
import sys

if not os.path.isfile("order_api.py"):
    print("FAIL: order_api.py not found")
    sys.exit(1)

sys.path.insert(0, os.getcwd())
try:
    from order_api import handle
except Exception as exc:
    print("FAIL: cannot import order_api.handle: %s" % exc)
    sys.exit(1)

fails = []


def check(desc, request, want_status, want_body_pred=None):
    try:
        status, body = handle(request)
    except Exception as exc:
        fails.append("%s: handle raised %s" % (desc, exc))
        return
    if status != want_status:
        fails.append("%s: status %r, expected %r (body=%r)" % (desc, status, want_status, body))
        return
    if not isinstance(body, dict):
        fails.append("%s: body must be a dict, got %r" % (desc, type(body).__name__))
        return
    if want_status != 200 and "error" not in body:
        fails.append("%s: error response must carry an 'error' key (body=%r)" % (desc, body))
        return
    if want_body_pred is not None:
        ok, why = want_body_pred(body)
        if not ok:
            fails.append("%s: %s (body=%r)" % (desc, why, body))


# --- validation: bad requests must be 400 ---
check("not a dict", "nope", 400)
check("missing items", {"customer": "a"}, 400)
check("items not a list", {"items": "x"}, 400)
check("empty items", {"items": []}, 400)
check("item missing price", {"items": [{"qty": 1}]}, 400)
check("item missing qty", {"items": [{"price": 5.0}]}, 400)
check("negative price", {"items": [{"price": -1.0, "qty": 1}]}, 400)
check("zero qty", {"items": [{"price": 5.0, "qty": 0}]}, 400)
check("non-numeric price", {"items": [{"price": "free", "qty": 1}]}, 400)
check("non-integer qty", {"items": [{"price": 5.0, "qty": 1.5}]}, 400)

# --- happy path: 200 + correct total ---
# One item: 2 x 10.00 = 20.00, no discount (under 100).
check(
    "single item total",
    {"items": [{"price": 10.0, "qty": 2}]},
    200,
    lambda b: (abs(b.get("total", -1) - 20.0) < 1e-9, "total should be 20.00, got %r" % b.get("total")),
)

# Multi-item: 3x10 + 1x5 = 35.00, no discount.
check(
    "multi item total",
    {"items": [{"price": 10.0, "qty": 3}, {"price": 5.0, "qty": 1}]},
    200,
    lambda b: (abs(b.get("total", -1) - 35.0) < 1e-9, "total should be 35.00, got %r" % b.get("total")),
)

# Discount rule: subtotal >= 100 gets 10% off.
# 5 x 25.00 = 125.00 subtotal -> 10% off -> 112.50.
check(
    "discount applied over 100",
    {"items": [{"price": 25.0, "qty": 5}]},
    200,
    lambda b: (abs(b.get("total", -1) - 112.5) < 1e-9, "total should be 112.50 (10%% off 125), got %r" % b.get("total")),
)

# Boundary: subtotal exactly 100 gets the discount -> 90.00.
check(
    "discount at exactly 100",
    {"items": [{"price": 100.0, "qty": 1}]},
    200,
    lambda b: (abs(b.get("total", -1) - 90.0) < 1e-9, "total should be 90.00 (10%% off 100), got %r" % b.get("total")),
)

# Just under boundary: 99.99 gets no discount.
check(
    "no discount just under 100",
    {"items": [{"price": 99.99, "qty": 1}]},
    200,
    lambda b: (abs(b.get("total", -1) - 99.99) < 1e-9, "total should be 99.99 (no discount), got %r" % b.get("total")),
)

if fails:
    print("FAIL:\n  " + "\n  ".join(fails))
    sys.exit(1)

print("PASS: order_api.handle satisfies validation + total + discount contract")
sys.exit(0)
