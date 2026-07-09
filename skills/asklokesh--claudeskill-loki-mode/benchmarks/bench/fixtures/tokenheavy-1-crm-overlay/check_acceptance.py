#!/usr/bin/env python3
"""Held-out acceptance for tokenheavy-1-crm. Zero-install (stdlib only).

Two-part check:
  1. STRUCTURE: every required file in the multi-file `contacts` package exists.
  2. SMOKE: import the package and run an end-to-end workflow across its
     modules (validation -> model -> repository -> service -> serializer),
     asserting real behavior. All-files-present-but-broken-smoke still fails.
Exits 0 only if structure AND smoke pass. The agent never sees this file.
"""
import os
import sys

required = [
    "contacts/__init__.py",
    "contacts/models.py",
    "contacts/validators.py",
    "contacts/repository.py",
    "contacts/service.py",
    "contacts/serializers.py",
]

missing = [p for p in required if not os.path.isfile(p)]
if missing:
    print("FAIL structure: missing files: " + ", ".join(missing))
    sys.exit(1)

sys.path.insert(0, os.getcwd())
fails = []

# --- validators ---
try:
    from contacts.validators import is_valid_email
    if not is_valid_email("a@b.com"):
        fails.append("is_valid_email('a@b.com') should be True")
    if is_valid_email("not-an-email"):
        fails.append("is_valid_email('not-an-email') should be False")
    if is_valid_email(""):
        fails.append("is_valid_email('') should be False")
except Exception as exc:
    fails.append("validators: %s" % exc)

# --- model ---
try:
    from contacts.models import Contact
    c = Contact(name="Ada", email="ada@x.com")
    if c.name != "Ada" or c.email != "ada@x.com":
        fails.append("Contact should hold name/email attributes")
except Exception as exc:
    fails.append("models: %s" % exc)

# --- repository + service end-to-end ---
try:
    from contacts.repository import ContactRepository
    from contacts.service import ContactService

    svc = ContactService(ContactRepository())

    created = svc.add_contact("Grace Hopper", "grace@navy.mil")
    cid = created.id if hasattr(created, "id") else created["id"]
    if cid is None:
        fails.append("add_contact should assign an id")

    fetched = svc.get_contact(cid)
    got_name = fetched.name if hasattr(fetched, "name") else fetched["name"]
    if got_name != "Grace Hopper":
        fails.append("get_contact returned wrong name: %r" % got_name)

    all_contacts = svc.list_contacts()
    if len(all_contacts) != 1:
        fails.append("list_contacts should have 1 entry, got %d" % len(all_contacts))

    # invalid email must be rejected by the service (validation wired through)
    rejected = False
    try:
        svc.add_contact("Bad", "nope")
    except Exception:
        rejected = True
    if not rejected:
        fails.append("add_contact should reject an invalid email")
except Exception as exc:
    fails.append("repository/service: %s" % exc)

# --- serializer ---
try:
    from contacts.serializers import contact_to_dict
    d = contact_to_dict(Contact(name="Ada", email="ada@x.com"))
    if not isinstance(d, dict) or d.get("name") != "Ada" or d.get("email") != "ada@x.com":
        fails.append("contact_to_dict should return {name, email, ...}: got %r" % (d,))
except Exception as exc:
    fails.append("serializers: %s" % exc)

if fails:
    print("FAIL smoke:")
    for f in fails:
        print("  - " + f)
    sys.exit(1)

print("PASS: structure + smoke workflow across the contacts package")
sys.exit(0)
