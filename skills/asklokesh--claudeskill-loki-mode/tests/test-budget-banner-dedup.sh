#!/usr/bin/env bash
# S-146 (BACKLOG 118): the dashboard shell had TWO elements with
# id="budget-banner" -- the R3 persistent top-of-page banner
# (dashboard-ui/scripts/build-standalone.js:~1200) and the Cost page's
# spend-cap banner (~1803). Since an id must be unique, every
# document.getElementById('budget-banner') call (including the Cost page's
# own window.loadBudget) always resolved to the FIRST element (the top
# banner), so the Cost page banner div was never the one actually written
# to and its own #cost-budget-banner div sat permanently orphaned/hidden.
#
# Fix: the Cost page banner now has its own id, cost-budget-banner, wired
# through window.loadBudget. The top banner keeps id="budget-banner".
#
# While in the same file, two other BACKLOG 118 items were also fixed:
# window.loadLearnings and window.loadReceipts each did
# `rows.slice().reverse().slice(0, N)`. Both source APIs (/api/learnings,
# /api/proofs) already return newest-first, so the extra .reverse() flipped
# the list back to oldest-first before truncating -- showing the OLDEST N
# records instead of the newest N. Fix: drop the .reverse().

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$REPO_ROOT/dashboard-ui/scripts/build-standalone.js"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }
echo "TEST: budget-banner id is unique and both banners still work"
[ -f "$SRC" ] || { echo "  FAIL: $SRC missing"; exit 1; }

# --- 1. THE WALL CHECK: exactly one element with id="budget-banner" --------
_count="$(grep -c 'id="budget-banner"' "$SRC")"
[ "$_count" -eq 1 ] \
  && ok "id=\"budget-banner\" appears exactly once (was 2)" \
  || bad "id=\"budget-banner\" appears $_count times, expected 1"

# --- 2. The Cost page banner kept its own distinct id -----------------------
grep -q 'id="cost-budget-banner"' "$SRC" \
  && ok "the Cost page spend-cap banner has its own id" \
  || bad "cost-budget-banner id is missing -- the Cost banner has nowhere to live"

command -v node >/dev/null 2>&1 || { echo "  SKIPPED: node not installed (rest not a pass)"; echo ""; echo "  Passed: $PASS   Failed: $FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }

# --- 3. DOM check: window.loadBudget (Cost page) writes cost-budget-banner,
#        never the top R3 banner ---------------------------------------------
_out="$(node -e "
const src=require('fs').readFileSync('$SRC','utf8');
const m=src.match(/window\.loadBudget = function \(\) \{[\s\S]*?\n    \};/);
if(!m){console.error('EXTRACT_FAILED');process.exit(2);}
const topBanner={id:'budget-banner',style:{},innerHTML:'',written:false};
const costBanner={id:'cost-budget-banner',style:{},innerHTML:'',written:false};
global.document={getElementById:(id)=>{
  if(id==='budget-banner') return topBanner;
  if(id==='cost-budget-banner') return costBanner;
  return null;
}};
global.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve({budget_limit:50,current_cost:12.5,remaining:37.5,exceeded:false})});
global.window=global; new Function('global', m[0]).call(global, global); global.loadBudget();
setTimeout(()=>{
  process.stdout.write((costBanner.innerHTML.length>0?'COST_WRITTEN':'COST_EMPTY')+'|'+(topBanner.innerHTML.length>0?'TOP_WRITTEN':'TOP_EMPTY'));
},50);
" 2>/dev/null)"
printf '%s' "$_out" | grep -q "COST_WRITTEN" \
  && ok "loadBudget writes the Cost page's own cost-budget-banner element" \
  || bad "loadBudget did not write cost-budget-banner: $_out"
printf '%s' "$_out" | grep -q "TOP_EMPTY" \
  && ok "loadBudget leaves the R3 top banner untouched (no cross-write)" \
  || bad "loadBudget wrote into the top banner element: $_out"

# --- 4. DOM check: initBudgetBanner (R3 top banner) still finds and updates
#        its own budget-banner element, unaffected by the rename. The mocked
#        /api/cost/timeline returns a warn payload, so the banner must end up
#        with the show+warn classes and non-empty text; a failed lookup
#        (early return) leaves both untouched and goes red. -------------------
_out="$(node -e "
const src=require('fs').readFileSync('$SRC','utf8');
const m=src.match(/\(function initBudgetBanner\(\) \{[\s\S]*?\n  \}\)\(\);/);
if(!m){console.error('EXTRACT_FAILED');process.exit(2);}
const cls=new Set();
const topBanner={classList:{add:(...a)=>a.forEach(c=>cls.add(c)),remove:(...a)=>a.forEach(c=>cls.delete(c))}};
const textEl={textContent:''};
global.document={getElementById:(id)=>{
  if(id==='budget-banner') return topBanner;
  if(id==='budget-banner-text') return textEl;
  return null;
}};
global.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve({budget:{status:'warn',percent_used:82}})});
global.setInterval=()=>{};
global.location={origin:'http://127.0.0.1'};
global.LokiDashboard={getApiClient:()=>({addEventListener(){},connect:()=>Promise.reject(new Error('no ws'))})};
global.window=global;
new Function('global', 'LokiDashboard', 'setInterval', m[0]).call(global, global, global.LokiDashboard, global.setInterval);
setTimeout(()=>process.stdout.write((cls.has('show')&&cls.has('warn')&&textEl.textContent.indexOf('82%')>=0)?'BANNER_UPDATED':'BANNER_UNTOUCHED cls='+[...cls].join(',')+' text='+textEl.textContent),50);
" 2>/dev/null)"
printf '%s' "$_out" | grep -q "BANNER_UPDATED" \
  && ok "initBudgetBanner finds id=\"budget-banner\" and renders the warn state into it" \
  || bad "initBudgetBanner did not update its banner element: $_out"

# --- 5. THE OTHER TWO 118 ITEMS: newest-first ordering, not re-reversed ----
_out="$(node -e "
const src=require('fs').readFileSync('$SRC','utf8');
const m=src.match(/window\.loadLearnings = function \(\) \{[\s\S]*?\n    \};/);
if(!m){console.error('EXTRACT_FAILED');process.exit(2);}
const list={innerHTML:''};
global.document={getElementById:(id)=>{ if(id==='learnings-list') return list; return {style:{}}; },
  createElement:()=>{ var e={_t:'', set textContent(v){this._t=String(v);}, get innerHTML(){return this._t;} }; return e; }};
global.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve({learnings:[
  {rootCause:'NEWEST', timestamp:'2026-09-27T00:00:00'},
  {rootCause:'OLDEST', timestamp:'2026-01-01T00:00:00'}
]})});
global.window=global; new Function('global', m[0]).call(global, global); global.loadLearnings();
setTimeout(()=>process.stdout.write(list.innerHTML.indexOf('NEWEST') < list.innerHTML.indexOf('OLDEST') ? 'NEWEST_FIRST' : 'OLDEST_FIRST'),50);
" 2>/dev/null)"
printf '%s' "$_out" | grep -q "NEWEST_FIRST" \
  && ok "loadLearnings renders the API's newest-first order unchanged (no re-reverse)" \
  || bad "loadLearnings re-reversed an already newest-first list: $_out"

_out="$(node -e "
const src=require('fs').readFileSync('$SRC','utf8');
const m=src.match(/window\.loadReceipts = function \(\) \{[\s\S]*?\n    \};/);
if(!m){console.error('EXTRACT_FAILED');process.exit(2);}
const list={innerHTML:''};
global.document={getElementById:(id)=>{ if(id==='receipts-list') return list; return {style:{}}; },
  createElement:()=>{ var e={_t:'', set textContent(v){this._t=String(v);}, get innerHTML(){return this._t;} }; return e; }};
global.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve([
  {run_id:'a', generated_at:'2026-09-27T00:00:00', headline:'NEWEST'},
  {run_id:'b', generated_at:'2026-01-01T00:00:00', headline:'OLDEST'}
])});
global.window=global; new Function('global', m[0]).call(global, global); global.loadReceipts();
setTimeout(()=>process.stdout.write(list.innerHTML.indexOf('NEWEST') < list.innerHTML.indexOf('OLDEST') ? 'NEWEST_FIRST' : 'OLDEST_FIRST'),50);
" 2>/dev/null)"
printf '%s' "$_out" | grep -q "NEWEST_FIRST" \
  && ok "loadReceipts renders the API's newest-first order unchanged (no re-reverse)" \
  || bad "loadReceipts re-reversed an already newest-first list: $_out"

node --check "$SRC" 2>/dev/null && ok "build-standalone.js parses" || bad "syntax error"
echo ""
echo "  Passed: $PASS   Failed: $FAIL"
[ "$FAIL" -eq 0 ]
