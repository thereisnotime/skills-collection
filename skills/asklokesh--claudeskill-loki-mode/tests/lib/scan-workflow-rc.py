#!/usr/bin/env python3
"""Report workflow steps whose `RC=$?` handler can never run.

GitHub runs steps with `bash -e {0}`, so -e is ON regardless of a step's own
`set -uo pipefail`. A bare command that exits non-zero aborts the step BEFORE
`RC=$?` is read, so the handler below it never runs and the job dies with no
diagnostic. The fix is `cmd || RC=$?`.

Prints one offender per line, nothing when clean. Prints UNREADABLE if the
workflows could not be read, so the caller can report an absent measurement
rather than a pass.
"""
import glob
import io
import re
import sys

# A command line immediately followed by `RC=$?`.
PATTERN = re.compile(r"\n(\s+)([^\n|]*\S)\n\s*RC=\$\?")


def main():
    offenders = []
    for path in sorted(glob.glob(".github/workflows/*.yml")):
        try:
            text = io.open(path, encoding="utf-8").read()
        except OSError as exc:
            print("UNREADABLE %s: %s" % (path, exc))
            return 0
        for match in PATTERN.finditer(text):
            cmd = match.group(2).strip()
            # A comment, or a command that already captures with || RC=$?.
            if cmd.startswith("#") or "||" in cmd:
                continue
            offenders.append("%s: %s" % (path.split("/")[-1], cmd[:70]))

    for off in offenders:
        print(off)
    return 0


if __name__ == "__main__":
    sys.exit(main())
