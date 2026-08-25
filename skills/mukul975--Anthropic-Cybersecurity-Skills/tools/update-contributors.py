#!/usr/bin/env python3
"""Regenerate the contributor avatar wall in README.md from the GitHub API.

Writes between the markers:

    <!-- contributors:start -->
    ...generated...
    <!-- contributors:end -->

Avatars are served from github.com/<login>.png rather than a third-party
contributor-image service. That is deliberate: a README image is fetched on
every page view, so an external host would be an uncontrolled dependency in the
most-viewed file in the repository. GitHub's own avatar endpoint has neither
problem, and GitHub proxies it through camo like any other image.

Usage:
    python tools/update-contributors.py            # rewrite README.md
    python tools/update-contributors.py --check    # exit 1 if out of date
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

REPO = os.environ.get("GITHUB_REPOSITORY", "mukul975/Anthropic-Cybersecurity-Skills")
MAINTAINER = REPO.split("/")[0]
README = "README.md"

START = "<!-- contributors:start -->"
END = "<!-- contributors:end -->"

# Accounts that are bots or automation, excluded from the wall.
EXCLUDE_SUFFIXES = ("[bot]",)
EXCLUDE_LOGINS = {"github-actions", "dependabot", "pull"}

AVATAR_PX = 72


def _get(path: str):
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/{path}", headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "update-contributors",
    })
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def _keep(login: str) -> bool:
    return bool(login) and not login.endswith(EXCLUDE_SUFFIXES) and login not in EXCLUDE_LOGINS


def fetch_contributors() -> list[dict]:
    """Every non-bot contributor, most contributions first.

    Two endpoints, because one of them lies. /contributors carries the
    authoritative contribution counts but is heavily cached — a merge can take
    up to a day to show up there. /commits is live. So anyone whose commit is
    already linked to their account but has not yet surfaced in /contributors
    gets picked up from the commit list instead of waiting a day to be thanked.

    Commits authored with an unlinkable email (a machine hostname such as
    user@HOST.localdomain) have no `author` object and are skipped by both
    paths. They never appear in GitHub's own contributor graph either, so the
    wall matches what GitHub itself shows.
    """
    people: list[dict] = []
    page = 1
    while True:
        batch = _get(f"contributors?per_page=100&page={page}")
        if not batch:
            break
        people.extend(batch)
        if len(batch) < 100:
            break
        page += 1

    known = {p.get("login") for p in people}
    ranked = [p for p in people if p.get("type") != "Bot" and _keep(p.get("login", ""))]

    # Catch anyone the cached endpoint has not caught up with yet.
    recent: dict[str, int] = {}
    for page in (1, 2):
        for commit in _get(f"commits?per_page=100&page={page}") or []:
            author = commit.get("author")
            if not author or author.get("type") == "Bot":
                continue
            login = author.get("login", "")
            if login in known or not _keep(login):
                continue
            recent[login] = recent.get(login, 0) + 1

    for login, count in sorted(recent.items(), key=lambda kv: (-kv[1], kv[0])):
        ranked.append({"login": login, "contributions": count})

    return ranked


def render(people: list[dict]) -> str:
    lines = ['<p align="center">']
    for person in people:
        login = person["login"]
        count = person.get("contributions", 0)
        plural = "" if count == 1 else "s"
        title = f"{login} — maintainer" if login == MAINTAINER else f"{login} — {count} contribution{plural}"
        lines.append(
            f'<a href="https://github.com/{login}" title="{title}">'
            f'<img src="https://github.com/{login}.png?size=100" '
            f'width="{AVATAR_PX}" height="{AVATAR_PX}" alt="@{login}"></a>'
        )
    lines.append("</p>")
    lines.append("")
    lines.append(
        f'<p align="center"><sub>{len(people)} contributors, ordered by contribution count · '
        f'see the full <a href="https://github.com/{REPO}/graphs/contributors">contributor graph</a>'
        "</sub></p>"
    )
    return "\n".join(lines)


def splice(readme: str, block: str) -> str:
    if START not in readme or END not in readme:
        raise SystemExit(
            f"ERROR: {README} is missing the {START} / {END} markers. "
            "Add them around the contributor wall."
        )
    head, rest = readme.split(START, 1)
    _, tail = rest.split(END, 1)
    return f"{head}{START}\n{block}\n{END}{tail}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if README.md is out of date; do not write")
    args = parser.parse_args()

    if not os.path.isfile(README):
        print(f"ERROR: {README} not found. Run from the repository root.")
        return 1

    people = fetch_contributors()
    if not people:
        print("ERROR: the API returned no contributors; refusing to blank the section.")
        return 1

    current = open(README, encoding="utf-8").read()
    updated = splice(current, render(people))

    if updated == current:
        print(f"OK: contributor wall is current ({len(people)} contributors)")
        return 0

    if args.check:
        print(f"ERROR: contributor wall is out of date ({len(people)} contributors). "
              "Run: python tools/update-contributors.py")
        return 1

    with open(README, "w", encoding="utf-8", newline="") as handle:
        handle.write(updated)
    print(f"Updated contributor wall: {len(people)} contributors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
