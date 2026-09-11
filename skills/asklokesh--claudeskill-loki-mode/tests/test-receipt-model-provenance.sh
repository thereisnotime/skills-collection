#!/usr/bin/env bash
# Model provenance on the receipt, from .loki/decisions/decisions.jsonl.
#
# The run-level "Model" row cannot answer the question a regulated buyer asks:
# did the deciding component change while the run was in flight? The trail that
# decision_record.py writes once per dispatch answers it, and the receipt read
# that file ZERO times before this.
#
# THREE STATES, NEVER COLLAPSED. A section that renders nothing when the trail
# is absent reads as "no swap happened" -- the false green the receipt exists to
# prevent. Absence of evidence must be reported as absence of evidence.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-receipt-model-provenance"

mk() {  # mk <dir> <jsonl lines...>
    local d="$WORK/$1"; shift
    mkdir -p "$d/.loki/decisions"
    if [ "$#" -gt 0 ]; then printf '%s\n' "$@" > "$d/.loki/decisions/decisions.jsonl"; fi
    echo "$d/.loki"
}

TWO="$(mk two '{"model_id":"claude-opus-5","stage":"agent"}' '{"model_id":"claude-sonnet-5","stage":"agent"}')"
ONE="$(mk one '{"model_id":"claude-opus-5","stage":"agent"}')"
BAD="$(mk bad '{"model_id":"claude-opus-5"}' 'NOT JSON' '{"model_id":"claude-opus-5"}')"
mkdir -p "$WORK/none/.loki"; NONE="$WORK/none/.loki"

collect() {
    python3 - "$1" <<'PY'
import importlib.util, sys, json
spec = importlib.util.spec_from_file_location("pg", "autonomy/lib/proof-generator.py")
pg = importlib.util.module_from_spec(spec); sys.modules["pg"] = pg
spec.loader.exec_module(pg)
print(json.dumps(pg._collect_decisions(sys.argv[1])))
PY
}

# 1. Two distinct models in one run MUST report model_changed. This is the
#    headline audit fact; without it the trail is just a log.
if [ "$(collect "$TWO" | python3 -c 'import json,sys;print(json.load(sys.stdin)["model_changed"])')" = "True" ]; then
    pass "two models -> model_changed true"
else
    fail "two models did not set model_changed"
fi

# 2. One model must NOT report a change (guards against a constant-true bug).
if [ "$(collect "$ONE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["model_changed"])')" = "False" ]; then
    pass "one model -> model_changed false"
else
    fail "one model falsely reported a change"
fi

# 3. An absent trail is its OWN state, never silence and never a false "clean".
if [ "$(collect "$NONE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])')" = "no_records" ]; then
    pass "absent trail -> status no_records (not silence, not clean)"
else
    fail "absent trail did not report no_records"
fi

# 4. A corrupt line is counted, not dropped. An audit trail that quietly
#    discards what it cannot parse is worse than one admitting the gap.
if [ "$(collect "$BAD" | python3 -c 'import json,sys;print(json.load(sys.stdin)["unparseable_lines"])')" = "1" ]; then
    pass "corrupt line counted in unparseable_lines"
else
    fail "corrupt line was silently dropped"
fi

# 5. Provenance must NEVER move the verdict.
allfalse=1
for d in "$TWO" "$ONE" "$NONE" "$BAD"; do
    [ "$(collect "$d" | python3 -c 'import json,sys;print(json.load(sys.stdin)["affects_verdict"])')" = "False" ] || allfalse=0
done
if [ "$allfalse" -eq 1 ]; then
    pass "affects_verdict is False in every state"
else
    fail "provenance leaked into the verdict"
fi

# 6. BOTH renderers must carry it. The fallback's own comment says it "must not
#    be quieter about provenance than the page it stands in for".
render_fb() {
    python3 - "$1" <<'PY'
import importlib.util, sys, json, re
spec = importlib.util.spec_from_file_location("pg", "autonomy/lib/proof-generator.py")
pg = importlib.util.module_from_spec(spec); sys.modules["pg"] = pg
spec.loader.exec_module(pg)
dec = json.loads(sys.argv[1]) if sys.argv[1] else None
p = {"verification": {}, "cost": {}, "files_changed": {}, "spec": {},
     "provider": {}, "deployment": {}, "council": {}, "iterations": {}}
if dec is not None:
    p["decisions"] = dec
html = pg._render_fallback_html(p)
hits = [re.sub("<[^>]+>", "", x) for x in re.findall(r"<p>(.*?)</p>", html, re.S)
        if "Models dispatched" in x]
print(hits[0] if hits else "")
PY
}
if render_fb '{"status":"measured","models":{"a":1,"b":1},"model_changed":true,"unparseable_lines":0}' | grep -q "CHANGED"; then
    pass "fallback renderer discloses a mid-flight model change"
else
    fail "fallback renderer omits the model change"
fi
if render_fb '{"status":"no_records","reason":"no_records"}' | grep -q "no decision trail"; then
    pass "fallback renderer states an absent trail explicitly"
else
    fail "fallback renderer is silent on an absent trail"
fi

# 7. An OLD receipt (no decisions key) must stay silent rather than be
#    described: a run that never recorded the trail cannot report on it.
if [ -z "$(render_fb '')" ]; then
    pass "old receipt without the field renders no provenance claim"
else
    fail "old receipt fabricated a provenance claim"
fi

# 8. The HTML template must carry the same three states. Asserted against the
#    shipped template source, not a copy.
T="autonomy/lib/proof-template.html"
# EXECUTE the shipped branch rather than grepping for its strings. A grep passes
# on `} else if (false) {` -- the text is still there while the branch is dead --
# which is exactly the mutation that survived a string-only assertion.
if command -v node >/dev/null 2>&1; then
    tpl_out="$(node - "$T" <<'NODEEOF'
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
function g(o, p, d) { var c = o; var ps = p.split("."); for (var i = 0; i < ps.length; i++) { if (c === null || c === undefined) return d; c = c[ps[i]]; } return (c === null || c === undefined) ? d : c; }
function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function esc(s) { s = (s === null || s === undefined) ? "" : String(s); return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
const m = src.match(/var dec = g\(p, "decisions", null\);[\s\S]*?\n    }\n    card\.innerHTML/);
if (!m) { console.log("EXTRACT_FAILED"); process.exit(0); }
const body = m[0].replace(/\n    card\.innerHTML$/, "");
const fn = new Function("p", "g", "num", "esc", body + "; return decNote;");
const strip = (h) => String(h || "").replace(/<[^>]+>/g, "");
const out = {
  changed: strip(fn({decisions:{status:"measured",models:{a:1,b:1},model_changed:true,unparseable_lines:0}}, g, num, esc)),
  same:    strip(fn({decisions:{status:"measured",models:{a:2},model_changed:false,unparseable_lines:0}}, g, num, esc)),
  none:    strip(fn({decisions:{status:"no_records",reason:"no_records"}}, g, num, esc)),
  unread:  strip(fn({decisions:{status:"unreadable",reason:"permission denied"}}, g, num, esc)),
  old:     strip(fn({}, g, num, esc)),
};
const ok =
  /CHANGED/.test(out.changed) &&
  !/CHANGED/.test(out.same) && /no mid-flight change/.test(out.same) &&
  /No decision trail was recorded/.test(out.none) &&
  /could not be read/.test(out.unread) &&
  out.old === "";
console.log(ok ? "TPL_OK" : "TPL_BAD:" + JSON.stringify(out).slice(0, 300));
NODEEOF
)"
    if [ "$tpl_out" = "TPL_OK" ]; then
        pass "HTML template renders all three states (executed, not grepped)"
    else
        fail "HTML template state branches wrong: $tpl_out"
    fi
else
    echo "  SKIP: template branch execution (node not installed)"
fi

# 9. The template's JavaScript must still parse. A syntax error here silently
#    breaks the entire receipt page, not just this section.
if command -v node >/dev/null 2>&1; then
    python3 - "$WORK" <<'PY'
import re, sys, os
s = open("autonomy/lib/proof-template.html").read()
blocks = re.findall(r"<script[^>]*>(.*?)</script>", s, re.S)
# The real program is the largest block; the smaller matches are prose that
# mentions the tag. Checking the largest is what guards the shipped page.
big = max(blocks, key=len)
open(os.path.join(sys.argv[1], "tpl.js"), "w").write(big)
PY
    if node --check "$WORK/tpl.js" >/dev/null 2>&1; then
        pass "template JavaScript parses"
    else
        fail "template JavaScript has a syntax error"
    fi
else
    echo "  SKIP: template JS parse (node not installed)"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
