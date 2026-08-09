# Documentation Refresh Anti-Patterns

Concrete mistakes to avoid, drawn from running full documentation refreshes
on live production repos. Each entry lists the mistake, why it's a problem,
and how to avoid it.

## 1. Trusting a doc's claim without checking the filesystem

**Mistake:** Assuming a path mentioned in a README or `AGENTS.md`
(`docs/runbook.md`, `scripts/verify_thing.py`, `_bmad/`, etc.) still exists
because the doc says so.

**Why it's a problem:** Docs rot faster than code. Referenced files are
often deleted in a prior cleanup pass without anyone updating the docs that
pointed at them.

**Avoid it:** For every file/path referenced in a doc, verify it exists on
disk (`ls`, `find_file_by_name`, or a quick `test -e`) before treating the
reference as current. Delete or fix references to anything that's gone.

## 2. Stripping every mention of a removed feature or vendor name

**Mistake:** Grepping for a removed integration's name (e.g. a discontinued
notification channel or payment processor) and deleting every occurrence
without reading the surrounding code.

**Why it's a problem:** A vendor/feature name can be "dead" as an active
integration target while still being **live** as a data reference — e.g.
the app no longer sends data *to* a service, but still reads an ID field
that *originated from* that service in upstream data. Deleting those
references breaks the model's accuracy and can confuse future maintainers
about what the field actually is.

**Avoid it:** For each match, read the surrounding code/comment and
classify it as (a) dead — the integration itself, safe to remove, or
(b) live — a data shape or field that happens to reference the old vendor
name for a legitimate reason. Document the distinction in the roadmap file
so future sessions don't redo the analysis.

## 3. Assuming a dependency is used because it's declared

**Mistake:** Leaving a package in `pyproject.toml`/`package.json` (and its
lockfile) alone because "it's probably used somewhere."

**Why it's a problem:** Dead dependencies accumulate, especially after a
feature (like a notification integration) is removed but its SDK dependency
is forgotten. This misleads onboarding docs and inflates the dependency
surface.

**Avoid it:** Grep the actual import statements for the package name before
keeping or removing it. If nothing imports it, remove the dependency and
regenerate the lockfile.

## 4. Writing one monolithic doc

**Mistake:** Cramming architecture, setup, operations, and deployment into
a single giant README or wiki page "to keep it simple."

**Why it's a problem:** Different audiences (new developers, on-call
operators, deployers) need different subsets of information, and a single
huge doc is hard to keep accurate and hard to navigate.

**Avoid it:** Split into focused guides (architecture, data flow,
onboarding, operations, deployment) with a short index page linking them.
Keep the top-level README as a landing page, not a full manual.

## 5. Leaving stale docs "just in case"

**Mistake:** Keeping an outdated doc around instead of deleting it, out of
fear of losing information.

**Why it's a problem:** Stale docs actively mislead readers (human or AI
agent) more than no docs at all. They also make it unclear which doc is
authoritative.

**Avoid it:** Delete stale docs outright once their content has been
superseded. Git history preserves them if anyone needs to recover context
later.

## 6. Updating Markdown but not the code comments/docstrings next to it

**Mistake:** Rewriting the README and architecture docs while leaving
misleading docstrings or comments in the code untouched (e.g. a retry
decorator's docstring still claims it alerts a channel that was removed
months ago).

**Why it's a problem:** Code-level docs are what a developer sees first
when actually working in a file, and they're what AI coding agents rely on
most heavily. A refreshed Markdown doc doesn't help if the code itself still
lies.

**Avoid it:** Treat inline comments and docstrings as part of the same
refresh pass, not a separate afterthought. Prioritize entry points, core
business logic, and integration clients.

## 7. Declaring a phase done without running the repo's own checks

**Mistake:** Editing docs and code comments, then moving on without running
lint/tests, assuming "it's just documentation."

**Why it's a problem:** Docstring edits can accidentally break code (typos
in code fences that get executed, doctest-style examples, or edits made
directly in a source file that touch real code by mistake). Config file
edits (e.g. removing an unused dependency) can also break the build if done
carelessly.

**Avoid it:** Always run the project's lint/test/build command after each
phase, even a doc-only one. Discover the actual command from `AGENTS.md`,
`README.md`, `justfile`/`Makefile`, or CI config rather than guessing.

## 8. Doing a large, multi-phase refresh in a single unbroken session

**Mistake:** Trying to audit, delete, rewrite, and verify docs for a large
repo all in one continuous pass with no checkpoints.

**Why it's a problem:** Context windows fill up, review becomes harder for
the user, and a mistake early in the session compounds through later
phases.

**Avoid it:** Break the work into phases (see `CHECKLIST.md`), commit at
phase boundaries, and write a `HANDOFF.md` describing exactly what the next
session should do. Update a running "Lessons Learned" section in the
roadmap file as you go so later phases (and later repos) benefit.

## 9. Hard-coding one repo's structure into a "reusable" skill

**Mistake:** Writing a doc-refresh playbook that references a specific
repo's file names (`data/conversion_v2.csv`, a specific cron schedule,
etc.) as if they were general steps.

**Why it's a problem:** The playbook becomes unusable on the next repo,
defeating the point of extracting it.

**Avoid it:** Keep the checklist and anti-patterns generic; use concrete
examples only to illustrate a category of mistake, and make clear they are
examples, not requirements.
