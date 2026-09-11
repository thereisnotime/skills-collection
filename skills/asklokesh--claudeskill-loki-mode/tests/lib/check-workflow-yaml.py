#!/usr/bin/env python3
"""Report whether every .github/workflows/*.yml parses.

Three states, never collapsed:
  OK         every file parsed
  NO_PARSER  pyyaml is unavailable, so validity was NOT measured
  INVALID    at least one file failed to parse (named, with the reason)

The NO_PARSER state is why this is a separate file. pyyaml is installed on a
developer laptop and NOT on the GitHub runner. A first version of this check
collapsed ImportError into "invalid YAML" and failed CI on perfectly good
files, which is the unmeasured-versus-failed confusion this repo keeps fixing
elsewhere. An absent parser is an absent measurement, not a verdict.

Exit 0 for OK and NO_PARSER (the caller distinguishes them by the printed
state); exit 1 for INVALID.
"""
import glob
import sys


def main():
    try:
        import yaml
    except ImportError:
        print("NO_PARSER")
        return 0

    bad = []
    for path in sorted(glob.glob(".github/workflows/*.yml")):
        try:
            with open(path, encoding="utf-8") as fh:
                yaml.safe_load(fh)
        except Exception as exc:  # noqa: BLE001 - any parse failure is a finding
            first = str(exc).split("\n")[0][:80]
            bad.append("%s: %s" % (path.split("/")[-1], first))

    if bad:
        print("INVALID " + "; ".join(bad))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
