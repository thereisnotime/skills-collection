---
name: project-health
description: "Quantify repository composition and documentation drag — comment vs code lines, test lines with test and assertion counts, spec and doc prose, and agent instruction surface. Load when reviewing a change that adds comments, docs, specs, or agent instruction; when asked about project health, bloat, doc-to-code ratio, or comment ratio; or before deciding whether process documentation is earning its keep. Ships a dependency-free script with threshold warnings and an opposing-direction ratchet."
license: MIT
metadata:
  author: shaunburdick
  version: "1.3.0"
---

# Project Health

Measures where a repository's lines actually go, so documentation and comment
bloat become **a number in a diff** rather than something discovered a year
later.

This measures composition, not quality. No number here is a grade.

## Run it

```bash
python3 scripts/project_health.py                  # the stat block
python3 scripts/project_health.py --json           # machine-readable
python3 scripts/project_health.py --explain        # metric definitions and limits
python3 scripts/project_health.py --check          # ratchet; exit 1 on violation
python3 scripts/project_health.py --update         # record this repo as the baseline
```

Standard library only. No install step.

`--update` writes `<repo>/.project-health/baseline.json` and `--check` reads it
from there. **Commit that file.** The ratchet works by making a baseline change
visible in a diff; an uncommitted baseline has no diff, so `--check` would
compare current against current and always pass.

The baseline is per-repository and the skill is installed globally, which is why
it lives in the repo rather than beside this file. An earlier version shipped one
baseline inside the skill; every `--update` in every repo overwrote it, and a
later `--check` compared against whichever repo ran last.

Exit codes: `0` no violations · `1` violation · `2` unbaselined, nothing compared.

## Tests

```bash
bash scripts/test-project-health.sh
```

Covers which files count as product, test, doc, or generated — the part with no
visible failure mode, since a misclassified file does not crash, it silently
skews every ratio built on it.

## The stat block

One metric per line, grouped. A denser two-column table was tried first and
rejected: these get read one value at a time in review ("did `commentRatio`
move?"), and tracking a row across a column gap is work the reader should not
have to do.

```
composition
  product code lines                                   31,254
  comment lines on product code                        27,094
  comment share of product source                      0.4644
  product source files                                    351
  generated files excluded                                  1
  generated lines excluded                                 11

tests
  test lines                                           79,704
  test cases                                            3,250
  assertions                                            8,034
  test lines per case                                   19.30
  assertions per case                                   1.9000
  test lines per product line                            2.5500

documentation
  prose in docs/ and specs/                            17,603
  prose in every doc file                              19,754
  all doc prose per code line                           0.6300
  prose outside docs/ and specs/                        0.1089

agent context
  repo-local instruction lines                          4,302
  repo-local instruction files                             15
  global skills and harness agent defs                  8,620
```

(Measured on a pnpm/TypeScript monorepo: 351 product files, 4,123 vitest cases.)

`commentRatio` is the comment's **share of product source** —
`productCommentLines / (productCommentLines + productCodeLines)` — so `0.4644`
means comments are nearly half the source. `--explain` gives the rest.

**Two doc numbers on purpose.** `prose in docs/ and specs/` counts only
gathered documentation; `prose in every doc file` counts all of it. The gap is
diagnostic — `prose outside docs/ and specs/` at `0.1089` means about a tenth of
the prose sits next to the code it describes rather than in one place, which is
harder to maintain and easier to miss.

**Agent context is split on purpose.** `repo-local instruction lines` is this
repo's own text — `AGENTS.md`, repo-local skills, repo-local agent definitions —
and is the only part the repo can act on or ratchet. `global skills and harness
agent defs` is reported for context and **never gated**, because a repository
cannot take responsibility for text installed in a user's home directory. Folding
them together made one metric read roughly 3× larger than the thing anyone is
accountable for.

**Generated output is excluded, and counted.** `generated files excluded` and
`generated lines excluded` report what was removed and why it matters: a
committed bundle carries almost no comments, so counting it as hand-written
source inflates the denominator of `commentRatio` and *understates* real bloat.
On a repository with two committed bundles, that was 10,096 phantom lines
inflating the denominator by 35% and reading `0.4080` against a true `0.4950`.

Excluded by extension (`.d.ts`, `.min.js`, `.js.map`), by structure (a `.js`
with a same-stem `.ts`/`.tsx` sibling), and by marker (`@generated` in the head,
`sourceMappingURL=` in the tail). Marker scanning is confined to the head and
tail because phrases like "generated by" also appear in prose inside hand-written
files, and a false positive here silently deletes a real file from the
measurement.

## Reading the numbers

The pattern this exists to catch is **a small code change dragging a large
documentation change behind it.** A 5-line fix that requires 15+ lines of spec
and comment updates is not a documentation problem — it is a tax on small
changes, which discourages small changes and quietly batches them into riskier
ones. Watch for:

- `commentRatio` climbing over time, especially alongside stable `productCodeLines`
- `prose in every doc file` growing faster than `product code lines`
- `all doc prose per code line` above 1.0 — a doc line per code line
- `repo-local instruction lines` climbing; every line is loaded every session
- `test lines per product line` above ~1.0 — a suite as large as the code it protects. A ratio climbing while `productCodeLines` falls means tests are being added to tests, not to behaviour
- `assertions per case` falling while `test cases` holds steady — tests asserting less

Trajectory matters more than any single reading. One snapshot cannot tell you
whether a ratio is healthy for your project; a series can.

## Repo-authored ignores

For files that are neither generated output nor recognisable source — scraped
data fixtures, vendored snapshots, archived material:

```json
// <repo>/.project-health/config.json
{
  "ignorePaths": ["europa-source/**", "**/*.generated.ts", "fixtures"]
}
```

Committed, so ignores are reviewable in a diff like any other decision.

Not `.gitignore`: that expresses "untracked", whereas the problem is generated
files that are committed and therefore tracked, so `.gitignore` structurally
cannot express it.

Two rules, chosen so the surprising case is the explicit one:

- A pattern containing a slash is **anchored to the repo root**. `src/*` means
  src's direct children, not its subtree.
- A pattern with no slash matches at **any depth**, gitignore-style. `*.snap`
  matches at the root and nested.
- A pattern with **no metacharacter** also matches everything under it, so naming
  a directory is enough: `fixtures` covers `fixtures/a.json`. A pattern that does
  contain a metacharacter matches only what it spells out — `**/snapshots`
  matches the directory entry, and you want `**/snapshots/**` for its contents.
  Silently descending for globs would make `src/*` swallow whole subtrees.

**Ignores are counted, not hidden.** `files ignored by repo config` and
`lines ignored by repo config` appear in the composition block, and the applied
patterns are printed by name.

That reporting exists because **ignoring is how a repository improves its own
numbers without fixing anything.** Ignoring the docs directory drops
`docProseToCode` and looks like progress. Most such moves trip the ratchet anyway —
removing prose fails the `allDocProseLines` band, removing tests fails
`testCases` — but **if a ratio improved unexpectedly, check this block first.** An
`ignoredLines` that grew by more than the ratchet tolerance is the explanation.

A malformed `config.json` applies **nothing** and says so, rather than falling
back to an empty pattern list and producing a flattering clean run.

## Ratchet semantics

`--check` compares against `baseline.json`. Three directions, and the first is
the one that matters:

- **band** — must not move more than its tolerance in **either** direction.
  `commentRatio` (±0.05 absolute), `productCommentLines`, `allDocProseLines`,
  `agentContextLines`, `testLines` (±10% relative).
- **up_good** — must not shrink. `testCases`, `testAsserts`.
- **up_bad** — must not grow. `docProseToCode`.

The gate is a **conjunction**: every clause must hold.

### Why band, and not "must not grow"

A one-directional "comments must not increase" rule is satisfied by **deleting
every comment** — which also improves the comment ratio it was supposedly
policing. That is not a hypothetical; it is the first version of this script, and
the ratchet passed the deletion with exit 0 while the ratio read a perfect
`0.0000`.

A band closes it. Movement in either direction has to be a conscious baseline
change, so *reducing* the documentation burden becomes something you do on
purpose and show in a diff, rather than something you achieve by deletion. If
your project genuinely has too many comments, raise the baseline and say why —
the diff is the argument.

Raising a baseline is allowed generally; it appears as a visible diff line in the
commit. **That visibility is the mechanism.** Run `--update` in its own commit.

**A baseline recorded as zero is adoption, not a limit.** Growing from nothing is
neither bloat nor regression, so a metric that was absent at baseline and now
exists reports `new` rather than `FAIL`. Otherwise a repo whose first baseline
predates its test suite fails every check, because `testLines` would have a band
of exactly `(0, 0)` around zero. Run `--update` to make it a real limit.

`--baseline PATH` overrides the location for repos that keep their ratchet state
somewhere other than `.project-health/`. `--config PATH` does the same for
`ignorePaths`.

## Thresholds

`thresholds.json` ships advisory limits. Each rule carries a `why` stating what the
number means and what crossing it signals — deliberately **not** the project it
was seeded from, which ages badly and lives in git history instead.

Seeded values are starting points, not laws. **Calibrate against your own history
before trusting them** — run for a few weeks, read the direction of travel, then
set the limits where your project actually sits. Delete any rule to silence it.
Every edit is a diff, which is the same mechanism as the ratchet.

## Accuracy limits

Read these before quoting a number as fact:

- **Comment detection is a state machine** over line and block tokens. A comment
  token at the start of a heredoc or string continuation counts as a comment.
- **Trailing comments are counted as code.** `foo(); // note` is a code line. The
  comment figures therefore **undercount**, which is the safe direction — the
  tool does not cry wolf.
- **Test discovery is by path and name convention.** Unconventional naming
  under-reports test metrics rather than misclassifying product code as tests.
- **Test-case and assertion counts are regex-based** and will differ from a real
  test runner. They are a guard against silent deletion, not a coverage report.
- **`spec`/`specs` are not treated as test directories**, because spec-kit owns
  `specs/` for feature documents. RSpec is matched by filename instead. Treating
  `specs/` as tests silently swallowed every spec in an early version.
- **Extensionless source is matched by name** (`.zshrc`, `Makefile`, `Dockerfile`,
  …). Without that, a dotfiles or infrastructure repo reports almost no product
  code, because those files have no suffix. `.gitignore` and friends are
  excluded as repository metadata.
- **Data files are neither product nor generated.** A scraped fixture with no
  recognised extension counts toward nothing by default, which is the safe
  default: inflating a denominator is worse than being invisible. Repos that
  carry large data fixtures should declare them in `ignorePaths` so the exclusion
  is reported rather than implicit.
- **`describe(` is a suite, not a case.** Counting it inflated one monorepo's
  test-case count by 21%. Cases require a quoted first argument, which also keeps
  ordinary calls named `test` or `it` from matching.

## Deliberately not measured

Comment *quality*, documentation *accuracy*, coverage adequacy, or any ratio
presented as a score. A metric that reads like a grade gets optimised instead of
understood. If a number here starts moving because someone is chasing it, the
metric has stopped working — delete the threshold rather than satisfy it.