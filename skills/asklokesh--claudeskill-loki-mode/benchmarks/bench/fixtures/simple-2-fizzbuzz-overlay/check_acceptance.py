#!/usr/bin/env python3
"""Held-out acceptance for simple-2-fizzbuzz. Zero-install (stdlib only).

Imports classify.classify and asserts the fizzbuzz-style contract across a
range of cases. Exits 0 only if every case matches. The agent never sees this.
"""
import os
import sys

if not os.path.isfile("classify.py"):
    print("FAIL: classify.py not found")
    sys.exit(1)

sys.path.insert(0, os.getcwd())
try:
    from classify import classify
except Exception as exc:
    print("FAIL: cannot import classify.classify: %s" % exc)
    sys.exit(1)

cases = {
    1: "1",
    2: "2",
    3: "fizz",
    5: "buzz",
    6: "fizz",
    9: "fizz",
    10: "buzz",
    15: "fizzbuzz",
    30: "fizzbuzz",
    45: "fizzbuzz",
    7: "7",
    20: "buzz",
    99: "fizz",
    100: "buzz",
}

fails = []
for n, expected in sorted(cases.items()):
    try:
        got = classify(n)
    except Exception as exc:
        fails.append("classify(%d) raised %s" % (n, exc))
        continue
    if got != expected:
        fails.append("classify(%d) == %r, expected %r" % (n, got, expected))

if fails:
    print("FAIL: " + "; ".join(fails))
    sys.exit(1)

print("PASS: classify() satisfies the fizzbuzz contract on %d cases" % len(cases))
sys.exit(0)
