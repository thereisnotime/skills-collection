#!/usr/bin/env python3
"""Strip every YAML front-matter field except `name`/`description` in place.

Used by `just sync-provider-formats` to clean the root-level agents/ and
skills/ bundle: Claude Code-specific front-matter fields (`model`, `color`,
`allowed-tools`, ...) are meaningless to Gemini CLI / Antigravity CLI and
would otherwise leak provider-specific metadata into their bundle.

With `--add-tools` the Antigravity tool grant is appended to the kept
fields. Antigravity defaults an agent's `tools` to `[]` (no tools at all),
so its copies of the agents need the grant spelled out, while the root
bundle must NOT carry it: Gemini CLI validates every `tools` entry against
its own tool registry with a strict schema and drops any agent listing a
name it doesn't know. So the flag is passed for antigravity/agents/ only.

Kept intentionally dependency-free (stdlib only, no PyYAML) so it runs on
any Python 3 install, including CI runners that don't have YAML libraries
pre-installed.
"""
import sys

FRONT_MATTER_DELIMITER = "---"
KEPT_FIELDS = {"name", "description"}
ADD_TOOLS_FLAG = "--add-tools"
ANTIGRAVITY_TOOLS_FIELD = "tools:\n    - view_file\n    - replace_file_content\n    - run_command\n"


def filter_front_matter(text: str, added_fields: str = "") -> str:
    """Return `text` with only `name`/`description` left in its front matter.

    `added_fields` is raw front-matter text appended after the kept fields.
    A field of the same key already present in the source is dropped by the
    filter first, so neither a Claude Code `tools:` line nor a re-run of this
    script can leave a duplicate key behind.

    Front-matter fields are grouped by their key line rather than parsed as
    YAML: a field starts at a line whose first character is not whitespace
    (a top-level "key: value" line). Every subsequent line that IS indented
    belongs to that field's value, which is exactly how YAML distinguishes a
    block-scalar or wrapped multi-line value from the next key — so this
    grouping preserves multi-line descriptions, and any colons or quotes
    inside them, without needing a YAML parser at all.
    """
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].rstrip("\n") != FRONT_MATTER_DELIMITER:
        return text  # no front matter: nothing to filter

    closing_line_index = next(
        (i for i in range(1, len(lines)) if lines[i].rstrip("\n") == FRONT_MATTER_DELIMITER),
        None,
    )
    if closing_line_index is None:
        return text  # unterminated front matter: leave the file untouched

    body = "".join(lines[closing_line_index + 1:])
    fields = _group_into_fields(lines[1:closing_line_index])

    kept_text = "".join(field_text for key, field_text in fields if key in KEPT_FIELDS)
    return f"{FRONT_MATTER_DELIMITER}\n{kept_text}{added_fields}{FRONT_MATTER_DELIMITER}\n{body}"


def _group_into_fields(front_matter_lines: list[str]) -> list[list[str]]:
    """Group front-matter lines into `[key, raw_text]` pairs, one per field."""
    fields: list[list[str]] = []
    for line in front_matter_lines:
        is_new_field = line[:1] not in ("", " ", "\t", "\n")
        if is_new_field:
            key = line.split(":", 1)[0].strip()
            fields.append([key, line])
        elif fields:
            fields[-1][1] += line
    return fields


def main() -> None:
    args = sys.argv[1:]
    added_fields = ANTIGRAVITY_TOOLS_FIELD if ADD_TOOLS_FLAG in args else ""
    for path in (arg for arg in args if arg != ADD_TOOLS_FLAG):
        with open(path, encoding="utf-8") as f:
            original = f.read()

        filtered = filter_front_matter(original, added_fields)
        if filtered != original:
            with open(path, "w", encoding="utf-8") as f:
                f.write(filtered)


if __name__ == "__main__":
    main()
