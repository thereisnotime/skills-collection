"""slugify -- turn a human title into a URL-safe slug.

Known issue (see spec): slugify() raises on an empty / whitespace-only title
instead of returning a safe fallback, which crashes callers that pass an
untitled draft. Fix that without regressing the existing behavior.
"""

import re

_NON_WORD = re.compile(r"[^a-z0-9]+")


def slugify(title):
    """Return a lowercase, hyphen-separated slug for `title`.

    Examples:
        slugify("Hello World")   -> "hello-world"
        slugify("  A/B  Test ")  -> "a-b-test"
    """
    lowered = title.lower()
    collapsed = _NON_WORD.sub("-", lowered)
    return collapsed.strip("-")
