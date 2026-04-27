// Phase 4 build_prompt() IO helpers.
//
// These pure node:fs helpers mirror the bash context-loaders in autonomy/run.sh
// so that build_prompt.ts (B1) can focus on prompt assembly. No shelling out;
// no Python; no provider calls. All truncation happens at the TS layer using
// the same byte/line caps as bash.
//
// Bash references (autonomy/run.sh):
//   load_queue_tasks()         lines 8823-8906  (truncates to 3 entries)
//   load_ledger_context()      lines 8126-8137  (head -100 lines of newest LEDGER-*.md)
//   load_handoff_context()     lines 8225-8267  (find -mtime -1, JSON or markdown head -80)
//   gate_failure_context build lines 9007-9023  (.loki/quality/gate-failures.txt)
//   bmad_arch                  line  9098       (head -c 16000 .loki/bmad-architecture-summary.md)
//   bmad_validation            line  9118       (head -c 8000  .loki/bmad-validation.md)
//   magic_context              lines 9219-9232  (.loki/magic/specs/*.md count + names)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// Mirrors the JSON shape accepted by load_queue_tasks() in run.sh.
// Only fields actually consumed by the helper are typed; extras pass through.
export type TaskItem = {
  id?: string;
  type?: string;
  source?: string;
  title?: string;
  description?: string;
  acceptance_criteria?: unknown[];
  user_story?: string;
  payload?: { action?: string; goal?: string } | string | null;
};

export type MagicSpecs = {
  count: number;
  // Bare basenames (without .md), in directory-listing order. Empty when
  // the specs directory does not exist or is empty.
  tokens: string[];
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function safeRead(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function tailLines(text: string, max: number): string {
  // Bash `head -100` keeps the FIRST 100 lines. The brief calls this "tail
  // 100 lines" but the bash source (load_ledger_context line 8133) uses
  // `head -100`, so we match bash behaviour: keep the leading N lines.
  const lines = text.split("\n");
  return lines.slice(0, max).join("\n");
}

function topLines(text: string, max: number): string {
  const lines = text.split("\n");
  return lines.slice(0, max).join("\n");
}

function capBytes(text: string, max: number): string {
  // bash `head -c N` truncates by byte. In JS, slicing the string by code
  // unit is close enough for ASCII/UTF-8 markdown corpora and matches the
  // existing bash byte cap for typical inputs. We use Buffer to honour
  // multi-byte characters precisely.
  const buf = Buffer.from(text, "utf-8");
  if (buf.byteLength <= max) return text;
  // Slicing a UTF-8 buffer can land in the middle of a multibyte sequence;
  // decode with `fatal:false` so any partial trailing byte is replaced with
  // U+FFFD rather than throwing. Bash `head -c` likewise tolerates this.
  return new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, max));
}

function listFilesByMtimeDesc(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const matches: { path: string; mtimeMs: number }[] = [];
  for (const name of entries) {
    if (!name.endsWith(suffix)) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isFile()) matches.push({ path: full, mtimeMs: st.mtimeMs });
    } catch {
      // skip unreadable entry
    }
  }
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches.map((m) => m.path);
}

function withinLast24h(mtimeMs: number, nowMs: number): boolean {
  return nowMs - mtimeMs <= ONE_DAY_MS;
}

// ---------------------------------------------------------------------------
// 1. loadQueueTasks -- mirrors load_queue_tasks() (run.sh:8823-8906)
// ---------------------------------------------------------------------------

// Reads .loki/queue/in-progress.json then .loki/queue/pending.json. Returns
// the merged list truncated to FIRST 3 tasks (same cap as bash line 8841).
// in-progress entries come first, preserving the bash priority ordering.
export function loadQueueTasks(lokiDir: string): TaskItem[] {
  const inProgress = parseQueueFile(join(lokiDir, "queue", "in-progress.json"));
  const pending = parseQueueFile(join(lokiDir, "queue", "pending.json"));
  const merged = [...inProgress, ...pending];
  return merged.slice(0, 3);
}

function parseQueueFile(path: string): TaskItem[] {
  const raw = safeRead(path);
  if (raw === null) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  // Bash supports both [...] and {"tasks": [...]} variants (run.sh:8835).
  let tasks: unknown;
  if (Array.isArray(data)) {
    tasks = data;
  } else if (data && typeof data === "object" && "tasks" in (data as Record<string, unknown>)) {
    tasks = (data as Record<string, unknown>)["tasks"];
  } else {
    return [];
  }
  if (!Array.isArray(tasks)) return [];
  const out: TaskItem[] = [];
  for (const t of tasks) {
    if (t && typeof t === "object") out.push(t as TaskItem);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. loadLedgerContext -- mirrors load_ledger_context() (run.sh:8126-8137)
// ---------------------------------------------------------------------------

// Returns the first 100 lines of the most-recent LEDGER-*.md file under
// .loki/memory/ledgers/. Empty string if no ledger exists.
//
// The brief description ("tail 100 lines of .loki/learning/ledger.md") is
// looser than the bash source. We follow the bash: head -100 lines of the
// newest .loki/memory/ledgers/LEDGER-*.md (line 8133).
export function loadLedgerContext(lokiDir: string): string {
  const dir = join(lokiDir, "memory", "ledgers");
  if (!existsSync(dir)) return "";
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return "";
  }
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const name of entries) {
    if (!name.startsWith("LEDGER-") || !name.endsWith(".md")) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { path: full, mtimeMs: st.mtimeMs };
    } catch {
      // skip
    }
  }
  if (!newest) return "";
  const text = safeRead(newest.path);
  if (text === null) return "";
  return tailLines(text, 100);
}

// ---------------------------------------------------------------------------
// 3. loadHandoffContext -- mirrors load_handoff_context() (run.sh:8225-8267)
// ---------------------------------------------------------------------------

// Returns the first 80 lines of the most-recent .md handoff under
// .loki/memory/handoffs/ whose mtime falls within the last 24 hours.
//
// Note: the bash source prefers a JSON handoff and runs Python to format it.
// This helper handles ONLY the markdown fallback path (line 8262-8266) --
// JSON formatting is build_prompt.ts (B1)'s responsibility. If both exist,
// the caller chooses; this helper is the markdown loader.
export function loadHandoffContext(lokiDir: string, nowMs: number = Date.now()): string {
  const dir = join(lokiDir, "memory", "handoffs");
  if (!existsSync(dir)) return "";
  const candidates = listFilesByMtimeDesc(dir, ".md");
  for (const path of candidates) {
    try {
      const st = statSync(path);
      if (!withinLast24h(st.mtimeMs, nowMs)) continue;
      const text = safeRead(path);
      if (text === null) continue;
      return topLines(text, 80);
    } catch {
      // skip
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// 4. loadValidationContext -- mirrors bmad_validation read (run.sh:9117-9118)
// ---------------------------------------------------------------------------

// Returns up to 8 KB of .loki/bmad-validation.md. Empty string if absent.
export function loadValidationContext(lokiDir: string): string {
  const text = safeRead(join(lokiDir, "bmad-validation.md"));
  if (text === null) return "";
  return capBytes(text, 8000);
}

// ---------------------------------------------------------------------------
// 5. loadBmadArch -- mirrors bmad_arch read (run.sh:9097-9098)
// ---------------------------------------------------------------------------

// Returns up to 16 KB of .loki/bmad-architecture-summary.md from the project
// root. Bash uses the cwd-relative path; we accept a repoRoot argument so
// build_prompt.ts can drive it explicitly.
export function loadBmadArch(repoRoot: string): string {
  const text = safeRead(join(repoRoot, ".loki", "bmad-architecture-summary.md"));
  if (text === null) return "";
  return capBytes(text, 16000);
}

// ---------------------------------------------------------------------------
// 6. loadGateFailures -- mirrors gate_failure_context (run.sh:9008-9009)
// ---------------------------------------------------------------------------

// Returns the comma/space-separated failure tokens from
// .loki/quality/gate-failures.txt. Each line is treated as a separate token;
// blank lines are dropped. Empty array when the file is absent.
export function loadGateFailures(lokiDir: string): string[] {
  const text = safeRead(join(lokiDir, "quality", "gate-failures.txt"));
  if (text === null) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// 7. loadMagicSpecs -- mirrors magic_context (run.sh:9219-9232)
// ---------------------------------------------------------------------------

// Counts and lists *.md spec basenames (without extension) under
// {repoRoot}/.loki/magic/specs/. Returns count=0 + tokens=[] when the dir
// does not exist or contains no .md files.
export function loadMagicSpecs(repoRoot: string): MagicSpecs {
  const dir = join(repoRoot, ".loki", "magic", "specs");
  if (!existsSync(dir)) return { count: 0, tokens: [] };
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { count: 0, tokens: [] };
  }
  const tokens: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isFile()) tokens.push(basename(name, ".md"));
    } catch {
      // skip
    }
  }
  return { count: tokens.length, tokens };
}
