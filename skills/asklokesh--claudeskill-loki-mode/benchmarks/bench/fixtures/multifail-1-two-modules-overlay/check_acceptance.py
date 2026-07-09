#!/usr/bin/env python3
"""Held-out acceptance for multifail-1-two-modules. Zero-install (stdlib only).

Two INDEPENDENT modules, each its own failing cluster:
  cluster A: temperature.c_to_f / f_to_c conversions.
  cluster B: roman.to_roman integer -> Roman numeral.
Exits 0 only if BOTH clusters pass. Fixing one cluster alone still exits 1,
which is what lets the bench discriminate a parallel multi-cluster fix loop.
The agent never sees this file.
"""
import os
import sys

sys.path.insert(0, os.getcwd())
cluster_fails = {"A_temperature": [], "B_roman": []}

# ---- cluster A: temperature ----
if not os.path.isfile("temperature.py"):
    cluster_fails["A_temperature"].append("temperature.py not found")
else:
    try:
        from temperature import c_to_f, f_to_c
        a_cases = [
            ("c_to_f(0)", c_to_f(0), 32.0),
            ("c_to_f(100)", c_to_f(100), 212.0),
            ("c_to_f(-40)", c_to_f(-40), -40.0),
            ("c_to_f(37)", c_to_f(37), 98.6),
            ("f_to_c(32)", f_to_c(32), 0.0),
            ("f_to_c(212)", f_to_c(212), 100.0),
            ("f_to_c(-40)", f_to_c(-40), -40.0),
        ]
        for desc, got, want in a_cases:
            if abs(got - want) > 1e-6:
                cluster_fails["A_temperature"].append("%s == %r, expected %r" % (desc, got, want))
    except Exception as exc:
        cluster_fails["A_temperature"].append("import/call error: %s" % exc)

# ---- cluster B: roman numerals ----
if not os.path.isfile("roman.py"):
    cluster_fails["B_roman"].append("roman.py not found")
else:
    try:
        from roman import to_roman
        b_cases = [
            (1, "I"), (4, "IV"), (9, "IX"), (14, "XIV"), (40, "XL"),
            (90, "XC"), (400, "CD"), (900, "CM"), (2024, "MMXXIV"),
            (3888, "MMMDCCCLXXXVIII"), (49, "XLIX"), (58, "LVIII"),
        ]
        for n, want in b_cases:
            got = to_roman(n)
            if got != want:
                cluster_fails["B_roman"].append("to_roman(%d) == %r, expected %r" % (n, got, want))
    except Exception as exc:
        cluster_fails["B_roman"].append("import/call error: %s" % exc)

failed_clusters = {k: v for k, v in cluster_fails.items() if v}
if failed_clusters:
    for cluster, msgs in failed_clusters.items():
        print("FAIL cluster %s:" % cluster)
        for m in msgs:
            print("  - " + m)
    sys.exit(1)

print("PASS: both clusters (temperature, roman) pass")
sys.exit(0)
