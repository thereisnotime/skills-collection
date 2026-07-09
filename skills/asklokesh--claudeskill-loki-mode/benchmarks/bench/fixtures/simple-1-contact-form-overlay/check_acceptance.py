#!/usr/bin/env python3
"""Held-out acceptance for simple-1-contact-form. Zero-install (stdlib only).

Reads index.html from the workdir and asserts the required structural elements
of a contact form exist. Exits 0 only if every required element is present.
The agent never sees this file (copied in by the grader after the build).
"""
import os
import re
import sys

path = "index.html"
if not os.path.isfile(path):
    print("FAIL: index.html not found")
    sys.exit(1)

with open(path, "r", encoding="utf-8", errors="replace") as fh:
    html = fh.read()

low = html.lower()
problems = []

# A <form> element must exist.
if "<form" not in low:
    problems.append("no <form> element")

# An email input typed as email (quote/whitespace tolerant).
if not re.search(r"""type\s*=\s*['"]?email['"]?""", low):
    problems.append("no <input type=email>")

# A name text field: an input named 'name' OR a text input present.
if not (re.search(r"""name\s*=\s*['"]?name['"]?""", low)
        or re.search(r"""type\s*=\s*['"]?text['"]?""", low)):
    problems.append("no name/text field")

# A message field: a <textarea> OR an input named 'message'.
if not ("<textarea" in low or re.search(r"""name\s*=\s*['"]?message['"]?""", low)):
    problems.append("no message field (textarea or name=message)")

# A submit control.
if not (re.search(r"""type\s*=\s*['"]?submit['"]?""", low) or "<button" in low):
    problems.append("no submit button")

# Email validation: the browser 'required' + type=email is the native check,
# OR an explicit pattern attribute. Accept either as 'validates email'.
has_required = bool(re.search(r"\brequired\b", low))
has_pattern = bool(re.search(r"""pattern\s*=\s*['"]""", low))
if not (has_required or has_pattern):
    problems.append("email not validated (no required and no pattern attribute)")

if problems:
    print("FAIL: " + "; ".join(problems))
    sys.exit(1)

print("PASS: contact form has all required elements")
sys.exit(0)
