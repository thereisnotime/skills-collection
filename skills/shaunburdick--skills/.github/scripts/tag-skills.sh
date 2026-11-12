#!/usr/bin/env bash
set -euo pipefail

event=${EVENT_NAME:?EVENT_NAME is required}
after=${AFTER_SHA:?AFTER_SHA is required}
before=${BEFORE_SHA:-}
default_branch=${DEFAULT_BRANCH:?DEFAULT_BRANCH is required}

# Only the metadata block's version line, not the description or body.
parse_version() {
  awk '
    /^metadata:[[:space:]]*$/ { meta = 1; next }
    meta && /^[^[:space:]]/ { meta = 0 }
    meta && /^[[:space:]]+version:[[:space:]]*/ {
      sub(/^[[:space:]]+version:[[:space:]]*/, "")
      gsub(/"/, "")
      print
      exit
    }
  '
}

version_at() {
  git show "$1:skills/$2/SKILL.md" | parse_version
}

touched=()

if [[ $event == push && -n $before && $before != 0000000000000000000000000000000000000000 ]]; then
  while IFS= read -r skill; do
    [[ -n $skill ]] && touched+=("$skill")
  done < <(git diff --name-only "$before" "$after" -- skills | sed -n 's|^skills/\([^/]*\)/.*|\1|p' | sort -u)

  bad=()
  for skill in "${touched[@]}"; do
    [[ -d "skills/$skill" ]] || continue
    git cat-file -e "$before:skills/$skill/SKILL.md" 2>/dev/null || continue

    old=$(version_at "$before" "$skill")
    new=$(parse_version < "skills/$skill/SKILL.md")
    if [[ $old == "$new" ]]; then
      bad+=("$skill: metadata.version is still $new")
      continue
    fi

    existing=$(git rev-parse -q --verify "refs/tags/$skill/v$new^{commit}" || true)
    if [[ -n $existing && $existing != "$after" ]]; then
      bad+=("$skill: version $new is already tagged at $existing")
    fi
  done

  if (( ${#bad[@]} )); then
    echo "Refusing to tag an unbumped or reused version:" >&2
    printf '  %s\n' "${bad[@]}" >&2
    exit 1
  fi
fi

if [[ $event == push ]]; then
  candidates=("${touched[@]}")
  target=$after
else
  target=$(git rev-parse "origin/$default_branch")
  if [[ $(git rev-parse HEAD) != "$target" ]]; then
    echo "Run this workflow from the default branch ($default_branch)." >&2
    exit 1
  fi

  candidates=()
  for file in skills/*/SKILL.md; do
    [[ -e $file ]] || continue
    skill=${file#skills/}
    candidates+=("${skill%/SKILL.md}")
  done
fi

for skill in "${candidates[@]}"; do
  [[ -f "skills/$skill/SKILL.md" ]] || continue

  version=$(parse_version < "skills/$skill/SKILL.md")
  if [[ -z $version ]]; then
    echo "skills/$skill/SKILL.md has no metadata.version" >&2
    exit 1
  fi

  tag="$skill/v$version"
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    continue
  fi

  git tag "$tag" "$target"
  git push origin "refs/tags/$tag"
done
