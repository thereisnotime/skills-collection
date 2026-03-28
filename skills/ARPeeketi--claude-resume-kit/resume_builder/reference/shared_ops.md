# Shared Operations — All Skills

> Referenced by `/make-resume`, `/make-cl`, `/critique`, and `/edit-resume`.
> Read this file at skill startup. Skills reference specific sections by name.

---

## Three-Session Workflow

Standard JD pipeline uses 3 sessions for token efficiency + quality:

Session 1: `/make-resume JDs/JD_xyz.txt`
  → Phase 0 (research) → STOP → Phase 1 (bullets) → STOP → Phase 2 (resume) → STOP
  → "Resume done. Copy after /clear: /make-cl output/<Folder>/session_<name>.md"

Session 2: `/make-cl output/<Folder>/session_<name>.md`
  → Load context → generate CL → compile → STOP
  → "CL done. Copy after /clear: /critique output/<Folder>/session_<name>.md"

Session 3: `/critique output/<Folder>/session_<name>.md`
  → Full package critique → STOP
  → If approved: finalization check → "Package complete in output/<Folder>/"

If edits needed after critique:
  /clear → /edit-resume output/<Folder>/e2e_<name>_cv.tex output/<Folder>/critique_<name>.md
  /clear → /critique output/<Folder>/session_<name>.md (re-critique)

---

## Fresh Session Startup

CLAUDE.md is auto-loaded. These files are NOT — read them at skill start:
1. `CLAUDE.md` — check Active Sessions and KB Corrections Log
2. If resuming work on an existing JD: read its session file and pick up at Status → Next
3. If starting a new JD: proceed to Phase 0

---

## Session File System

Every JD gets a persistent session file: `output/<FolderName>/session_<name>.md` — the single source of truth for all context.

**Naming:** Derive `<name>` from company/role — lowercase, underscores (e.g., `acme_engineer`, `natlab_postdoc`).

**All output files use the same key:**
- `output/<FolderName>/session_<name>.md` — context file
- `output/<FolderName>/e2e_<name>_resume.tex` or `_cv.tex` — generated document
- `output/<FolderName>/e2e_<name>_cover_letter.tex` — cover letter
- `output/<FolderName>/critique_<name>.md` — critique

**Re-read the session file at the start of EVERY phase** to restore context after compaction.

---

## Session File Derivation (for /make-cl, /critique, and /edit-resume)

From .tex path: strip `e2e_` prefix (if present) + `_resume.tex`/`_cv.tex`/`_cover_letter.tex` suffix → `<name>`.

Example: `output/Acme/e2e_acme_engineer_resume.tex` → `acme_engineer` → look for `session_acme_engineer.md`

**Search order:**
1. Direct path from $ARGUMENTS
2. Folder path: `output/<FolderName>/session_<name>.md` (derive FolderName from JD filename or session name)
3. Flat `output/` (legacy): `output/session_<name>.md`
4. `CLAUDE.md` Active Sessions pointer
5. Glob: `output/**/session_*<company>*.md`

**If still not found:**
- `/edit-resume`: Tell user — "No session file exists. Run `/make-resume` first, or I can create a minimal one (JD Info + Framing Strategy inferred from .tex content)."
- `/critique`: Do 1-2 web searches to build minimal context. Note in critique: "No session file — framing context is approximate."
- `/make-cl`: Tell user — "No session file exists. Run `/make-resume` first."

---

## Progress Commentary

Provide brief status updates at each major step. Minimum: what you're doing + what you found.

If a step takes more than ~30 seconds of silent processing, output a progress line. The user should never wonder if things are stuck.

Per-phase examples are in each SKILL.md.

---

## Char Count Enforcement

Run `python3 resume_builder/helpers/char_count.py` after each section or position you write/edit.

The tool is authoritative — never trust mental math for char counts. If the tool fails, fall back to manual count and flag: "char_count.py unavailable — manual count, verify after compile."

---

## Folder Creation (Phase 0 of /make-resume)

**Trigger:** Start of Phase 0 in `/make-resume`.

**Steps:**
1. Derive folder name from JD filename: `JDs/JD_Acme.txt` → `output/Acme/`
2. `mkdir -p output/<FolderName>/`
3. Copy JD file into output folder: `cp JDs/<filename> output/<FolderName>/`
4. Write session file to `output/<FolderName>/session_<name>.md`
5. All subsequent output files (from ALL skills) go in this folder

## Finalization (after /critique approval)

**Trigger:** User approves final output at `/critique` STOP.

**Steps:**
1. Verify all expected files exist in `output/<FolderName>/`:
   - `session_<name>.md`
   - `e2e_<name>_[resume|cv].tex` + `.pdf` + compile artifacts
   - `e2e_<name>_cover_letter.tex` + `.pdf` + compile artifacts
   - `critique_<name>.md`
2. Rename final PDFs for submission (derive name from `config.md` Personal Info):
   - `cp e2e_<name>_[resume|cv].pdf <Firstname>_<Lastname>_[Resume|CV].pdf`
   - `cp e2e_<name>_cover_letter.pdf <Firstname>_<Lastname>_Cover_Letter.pdf`
   - Keep originals alongside
3. Confirm to user: "Package complete in output/<FolderName>/ — [N] files"

---

## Session End Protocol

Before the session ends or user does `/clear`:

1. **Update session file Status** — reflects actual state (which phase completed, what's next)
2. **Update memory pointer** in `CLAUDE.md` Active Sessions
3. **If mid-phase:** Write a `## Resume Point` section to the session file noting exactly where you stopped and what remains
