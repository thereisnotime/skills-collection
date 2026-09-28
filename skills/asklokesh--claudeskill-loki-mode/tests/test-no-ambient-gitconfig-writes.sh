#!/usr/bin/env bash
# Test: no test suite may run `git config --global` or touch the ambient
# ~/.gitconfig unless it sources tests/lib/isolated-git-home.sh first.
#
# THE RISK: a test that runs `git config --global` against the real user
# HOME corrupts the developer's or CI runner's actual git identity/config.
#
# DESIGN: three earlier versions tried to prove isolation from arbitrary
# shell (scope, quotes, heredocs, case arms) and each lost to a new shape.
# This one does not parse shell. A file with ANY offending line must open
# with a prelude of only comments, blank lines and plain `set ...` lines,
# followed by exactly:
#
#   . "$(dirname "${BASH_SOURCE[0]}")/lib/isolated-git-home.sh" || exit 1
#
# (`../lib/` from tests/moat). Nothing that can open a block, a quote, a
# heredoc or a function may precede it, so it always runs, first, at top
# level; `|| exit 1` stops the test if the helper is missing. Nothing before
# it can save the real HOME.
#
# Offending line (checked both per physical line and per backslash-joined
# logical line; on a `#` line only the text from the first `$(`, backtick
# or double quote on is checked, since such a line inside a string or an
# unquoted heredoc still runs a command substitution):
#   - `git ... config ... --gl[obal]` (git accepts any unambiguous prefix);
#   - `.gitconfig` as a relative path, or `/.gitconfig` on a line that also
#     mentions `~` or HOME (covers >, >>, --file, -f, tee, cp).
#
# ponytail: known ceiling, by design; the lint does not try to prove any of
# these. After the helper, code that rebuilds the real home (a literal
# /Users/x path, ~user, a passwd lookup, $PWD or $OLDPWD walked upward) and
# then unsets or retargets HOME/GIT_CONFIG_GLOBAL escapes it. Not detected
# at all: a home copied into another variable first (H=$HOME; >"$H/.gitconfig"),
# an obfuscated call (`git config --glo""bal`, eval of a built string), and a
# `#` line that closes a single-quoted string.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/lib/isolated-git-home.sh"

PASS=0
FAIL=0
ok()  { printf '  PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }

echo "=== no ambient ~/.gitconfig writes without the isolated-git-home helper ==="

scan() {
    python3 - "$@" <<'PYEOF'
import os, re, sys

SELF = "test-no-ambient-gitconfig-writes.sh"
COMMENT = re.compile(r'^\s*#')
CODE_IN_COMMENT = re.compile(r'\$\(|`|"')
GIT_GLOBAL = re.compile(r'git.*\bconfig\b.*--gl(?:o(?:b(?:al?)?)?)?\b', re.I)
REL_GITCONFIG = re.compile(r'(?<![\w./-])\.gitconfig\b')
ABS_GITCONFIG = re.compile(r'/["\']?\.gitconfig\b')
PRELUDE_OK = re.compile(r'^(?:#.*|\s*|set(?: [-+][A-Za-z]+(?: [a-z]+)?)+)$')
HELPER_LINE = re.compile(
    r'^(?:\.|source) "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)/(?:\.\./)?'
    r'lib/isolated-git-home\.sh" \|\| exit 1$')


def offends(line):
    if COMMENT.match(line):
        m = CODE_IN_COMMENT.search(line)
        if not m:
            return False
        line = line[m.start():]
    return bool(GIT_GLOBAL.search(line) or REL_GITCONFIG.search(line) or
                (ABS_GITCONFIG.search(line) and ('~' in line or 'HOME' in line)))


def logical(raw):
    out, i = [], 0
    while i < len(raw):
        buf, start = raw[i], i + 1
        while buf.endswith('\\') and i + 1 < len(raw):
            i += 1
            buf = buf[:-1] + ' ' + raw[i]
        out.append((start, buf))
        i += 1
    return out


def has_prelude_helper(raw):
    for line in raw:
        if HELPER_LINE.match(line):
            return True
        if not PRELUDE_OK.match(line):
            return False
    return False


def scan_file(path):
    try:
        raw = open(path, encoding="utf-8", errors="replace").read().split("\n")
    except OSError:
        return []
    hits = {}
    for no, line in list(enumerate(raw, 1)) + logical(raw):
        if offends(line):
            hits.setdefault(no, line.strip())
    if not hits or has_prelude_helper(raw):
        return []
    return ["%s:%d:%s" % (path, no, hits[no]) for no in sorted(hits)]


for directory in sys.argv[1:]:
    if not os.path.isdir(directory):
        continue
    for name in sorted(os.listdir(directory)):
        if name.endswith(".sh") and name != SELF:
            for h in scan_file(os.path.join(directory, name)):
                print(h)
PYEOF
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/loki-gitconfig-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# ---- the helper really isolates ----------------------------------------
mkdir -p "$TMP/realhome"
iso_out="$(env -u GIT_CONFIG_GLOBAL HOME="$TMP/realhome" bash -c '
    . "$1" || exit 1
    git config --global s138.probe yes || exit 1
    printf "%s\n" "$ISOLATED_GIT_HOME" "$HOME" "$GIT_CONFIG_GLOBAL"
    git config --file "$GIT_CONFIG_GLOBAL" s138.probe
' _ "$HELPER" 2>&1)"
iso_dir="$(printf '%s\n' "$iso_out" | sed -n 1p)"
if [ -n "$iso_dir" ] && [ "$(printf '%s\n' "$iso_out" | sed -n 2p)" = "$iso_dir" ] \
    && [ "$(printf '%s\n' "$iso_out" | sed -n 3p)" = "$iso_dir/.gitconfig" ] \
    && [ "$(printf '%s\n' "$iso_out" | sed -n 4p)" = "yes" ] \
    && [ ! -e "$TMP/realhome/.gitconfig" ]; then
    ok "helper points HOME and GIT_CONFIG_GLOBAL at a scratch dir; the write lands there"
else
    bad "helper did not isolate: $iso_out"
fi
case "$iso_dir" in
    */loki-git-home.*) rm -rf "$iso_dir" ;;
esac

# ---- REAL: this repo's suites -----------------------------------------
real_offenders="$(scan "$SCRIPT_DIR" "$SCRIPT_DIR/moat")"
if [ -z "$real_offenders" ]; then
    ok "every test touching the global gitconfig sources the helper first"
else
    bad "ambient gitconfig writes without the helper prelude:"
    printf '%s\n' "$real_offenders" | sed 's/^/        /' | head -20
fi

# expect_flag NAME  -- fixture body on stdin must be flagged
# expect_clean NAME -- fixture body on stdin must NOT be flagged
expect_flag() {
    local name="$1" out
    rm -f "$TMP"/*.sh
    cat > "$TMP/$name.sh"
    out="$(scan "$TMP")"
    if printf '%s' "$out" | grep -q "$name.sh"; then
        ok "flagged: $name"
    else
        bad "NOT flagged (bypass): $name"
    fi
}
expect_clean() {
    local name="$1" out
    rm -f "$TMP"/*.sh
    cat > "$TMP/$name.sh"
    out="$(scan "$TMP")"
    if [ -z "$out" ]; then
        ok "clean: $name"
    else
        bad "false flag: $name -> $out"
    fi
}

# ---- controls ---------------------------------------------------------
expect_flag no-isolation <<'EOF'
git config --global user.name "unsafe"
EOF

expect_clean helper-prelude <<'EOF'
#!/usr/bin/env bash
# header comment

set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/isolated-git-home.sh" || exit 1
if true; then
    git config --global user.name "safe"
fi
echo x > ~/.gitconfig
EOF

expect_clean moat-helper-prelude <<'EOF'
#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib/isolated-git-home.sh" || exit 1
git config --global user.name "safe"
EOF

expect_clean no-offender-no-helper <<'EOF'
printf '[user]\n' > "$L/home/.gitconfig"
git config user.name local-only
EOF

# ---- earlier-round bypasses: an inline `export HOME=` is not the helper ---
expect_flag isolated-by-hand <<'EOF'
export HOME="$(mktemp -d)"
git config --global user.name "unsafe"
EOF

expect_flag noop-self-reassign <<'EOF'
export HOME="$HOME"
git config --global user.name "unsafe"
EOF

expect_flag continuation-split <<'EOF'
git config \
    --global user.name "unsafe"
EOF

expect_flag subshell-only <<'EOF'
( export HOME=$(mktemp -d); true )
git config --global user.name "unsafe"
EOF

expect_flag review5-case-in-if <<'EOF'
if false; then
case y in
y) : ;;
esac
export HOME="$(mktemp -d)"
fi
git config --global user.name unsafe
EOF

expect_flag review5-case-in-while <<'EOF'
while read -r x; do
case y in
y) : ;;
esac
export HOME="$(mktemp -d)"
done < /dev/null
git config --global user.name unsafe
EOF

expect_flag redirect-needs-home <<'EOF'
export GIT_CONFIG_GLOBAL="$(mktemp)"
printf '[user]\n' >> "$HOME/.gitconfig"
EOF

expect_flag inside-if-block <<'EOF'
if false; then
export HOME="$(mktemp -d)"
fi
git config --global user.name "unsafe"
EOF

expect_flag inside-heredoc <<'EOF'
cat > /dev/null <<XEOF
export HOME="$(mktemp -d)"
XEOF
git config --global user.name "unsafe"
EOF

expect_flag inside-quoted-heredoc <<'EOF'
cat > /dev/null <<'XEOF'
export HOME="$(mktemp -d)"
XEOF
git config --global user.name "unsafe"
EOF

expect_flag inside-dquoted-heredoc <<'EOF'
cat > /dev/null <<"XEOF"
export HOME="$(mktemp -d)"
XEOF
git config --global user.name "unsafe"
EOF

expect_flag closer-word-argument <<'EOF'
if true; then
echo done
export HOME="$(mktemp -d)"
fi
git config --global user.name "unsafe"
EOF

expect_flag case-arm-nested-if <<'EOF'
case x in
x) if true; then
export HOME="$(mktemp -d)"
fi ;;
esac
git config --global user.name "unsafe"
EOF

expect_flag unindented-function <<'EOF'
iso() {
export HOME="$(mktemp -d)"
}
git config --global user.name "unsafe"
EOF

expect_flag multiline-string <<'EOF'
echo "text
export HOME=\"$(mktemp -d)\"
"
git config --global user.name "unsafe"
EOF

expect_flag multiline-subshell <<'EOF'
(
export HOME="$(mktemp -d)"
)
git config --global user.name "unsafe"
EOF

expect_flag restored-after-isolation <<'EOF'
ORIG_HOME="$HOME"
export HOME="$(mktemp -d)"
export HOME="$ORIG_HOME"
git config --global user.name "unsafe"
EOF

expect_flag provenance-from-home <<'EOF'
W="$HOME"
export HOME="$W"
git config --global user.name "unsafe"
EOF

expect_flag case-pattern-poisons <<'EOF'
case "$1" in
a) true ;;
esac
export HOME="$(mktemp -d)"
git config --global user.name "unsafe"
EOF

# ---- the helper line anywhere but the prelude ----------------------------
H='. "$(dirname "${BASH_SOURCE[0]}")/lib/isolated-git-home.sh" || exit 1'

expect_flag helper-inside-if <<EOF
if false; then
$H
fi
git config --global user.name "unsafe"
EOF

expect_flag helper-inside-heredoc <<EOF
cat > /dev/null <<'XEOF'
$H
XEOF
git config --global user.name "unsafe"
EOF

expect_flag helper-inside-unquoted-heredoc <<EOF
cat > /dev/null <<XEOF
$H
XEOF
git config --global user.name "unsafe"
EOF

expect_flag helper-inside-dquoted-heredoc <<EOF
cat > /dev/null <<"XEOF"
$H
XEOF
git config --global user.name "unsafe"
EOF

expect_flag helper-after-closer-word <<EOF
if true; then
echo done
$H
fi
git config --global user.name "unsafe"
EOF

expect_flag helper-case-arm-nested-if <<EOF
case x in
x) if true; then
$H
fi ;;
esac
git config --global user.name "unsafe"
EOF

expect_flag helper-after-top-level-case <<EOF
case "\$1" in
a) true ;;
esac
$H
git config --global user.name "unsafe"
EOF

expect_flag helper-inside-function <<EOF
iso() {
$H
}
git config --global user.name "unsafe"
EOF

expect_flag helper-case-in-if <<EOF
if false; then
case y in
y) : ;;
esac
$H
fi
git config --global user.name "unsafe"
EOF

expect_flag helper-in-while <<EOF
while read -r x; do
case y in
y) : ;;
esac
$H
done < /dev/null
git config --global user.name "unsafe"
EOF

expect_flag helper-in-multiline-string <<EOF
echo "text
$H
"
git config --global user.name "unsafe"
EOF

expect_flag helper-in-subshell <<EOF
(
$H
)
git config --global user.name "unsafe"
EOF

expect_flag helper-after-offender <<EOF
git config --global user.name "unsafe"
$H
EOF

expect_flag helper-after-open-quote <<EOF
set -u "
$H
"
git config --global user.name "unsafe"
EOF

expect_flag helper-after-set-continuation <<EOF
set -u \\
$H
git config --global user.name "unsafe"
EOF

expect_flag helper-after-saved-home <<EOF
ORIG_HOME="\$HOME"
$H
export HOME="\$ORIG_HOME"
git config --global user.name "unsafe"
EOF

expect_flag helper-without-exit <<'EOF'
. "$(dirname "${BASH_SOURCE[0]}")/lib/isolated-git-home.sh"
git config --global user.name "unsafe"
EOF

expect_flag helper-wrong-name <<'EOF'
. "$(dirname "${BASH_SOURCE[0]}")/lib/isolated-git-home.sh.bak" || exit 1
git config --global user.name "unsafe"
EOF

# ---- offender shapes ------------------------------------------------------
expect_flag abbreviated-glob <<'EOF'
git config --glob user.name "unsafe"
EOF

expect_flag abbreviated-gl <<'EOF'
git config --gl user.name "unsafe"
EOF

expect_flag hash-in-arg <<'EOF'
git config url."a#b".insteadOf x --global
EOF

expect_flag comment-continuation <<'EOF'
# a comment line ending in a backslash does not continue \
git config --global user.name "unsafe"
EOF

expect_flag comment-in-dq-string <<'EOF'
echo "
#$(git config --global user.name x)
"
EOF

expect_flag comment-in-unquoted-heredoc <<'EOF'
cat >/dev/null <<XEOF
# $(git config --global user.name x)
XEOF
EOF

expect_flag comment-backtick-in-heredoc <<'EOF'
cat >/dev/null <<XEOF
# `printf x >> ~/.gitconfig`
XEOF
EOF

expect_flag comment-closes-dq-string <<'EOF'
echo "
#"; git config --global user.name x; echo "
"
EOF

expect_clean plain-comment-mentions <<'EOF'
# never run git config --global here; it would touch ~/.gitconfig
git config user.name local-only
EOF

expect_flag file-flag-tilde <<'EOF'
git config --file ~/.gitconfig user.name "unsafe"
EOF

expect_flag tee-home <<'EOF'
printf '[user]\n' | tee "${HOME:-x}/.gitconfig"
EOF

expect_flag cp-tilde <<'EOF'
cp x ~/.gitconfig
EOF

expect_flag relative-after-cd <<'EOF'
cd ~ && printf '[user]\n' >> .gitconfig
EOF

echo ""
echo "  Passed: $PASS   Failed: $FAIL"
[ "$FAIL" -eq 0 ]
