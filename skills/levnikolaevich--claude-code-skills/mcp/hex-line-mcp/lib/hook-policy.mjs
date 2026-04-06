import { resolve } from "node:path";

export const BINARY_EXT = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico",
    ".pdf", ".ipynb",
    ".zip", ".tar", ".gz", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".wasm",
    ".mp3", ".mp4", ".wav", ".avi", ".mkv",
    ".ttf", ".otf", ".woff", ".woff2",
]);

export const OUTLINEABLE_EXT = new Set([
    ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
    ".py", ".cs", ".php",
    ".md", ".mdx",
]);

export const REVERSE_TOOL_HINTS = {
    "mcp__hex-line__read_file": "Read (file_path, offset, limit)",
    "mcp__hex-line__edit_file": "Edit (old_string, new_string, replace_all)",
    "mcp__hex-line__write_file": "Write (file_path, content)",
    "mcp__hex-line__grep_search": "Grep (pattern, path)",
    "mcp__hex-line__inspect_path": "Path info / tree / Bash(ls,stat)",
    "mcp__hex-line__outline": "Read with offset/limit",
    "mcp__hex-line__verify": "Read (check checksum/revision freshness before follow-up edits)",
    "mcp__hex-line__changes": "Bash(git diff)",
    "mcp__hex-line__bulk_replace": "Edit (text rename/refactor across files inside an explicit root path)",
};

export const TOOL_HINTS = {
    Read: "mcp__hex-line__read_file (not Read). For writing: write_file (no prior Read needed)",
    Edit: "mcp__hex-line__edit_file for revision-aware hash edits. Batch same-file hunks, carry base_revision, use replace_between for block rewrites",
    Write: "mcp__hex-line__write_file (not Write). No prior Read needed",
    Grep: "mcp__hex-line__grep_search (not Grep). Params: output, literal, context_before, context_after, multiline",
    cat: "mcp__hex-line__read_file (not cat/head/tail/less/more)",
    head: "mcp__hex-line__read_file with limit param (not head)",
    tail: "mcp__hex-line__read_file with offset param (not tail)",
    ls: "mcp__hex-line__inspect_path for tree or pattern search (not ls/find/tree). E.g. pattern='*-mcp' type='dir'",
    stat: "mcp__hex-line__inspect_path for compact file metadata (not stat/wc/file)",
    grep: "mcp__hex-line__grep_search (not grep/rg). Params: output, literal, context_before, context_after, multiline",
    sed: "mcp__hex-line__edit_file for hash edits, or mcp__hex-line__bulk_replace with path=<project root> for text rename (not sed -i)",
    diff: "mcp__hex-line__changes (not diff). Git diff with change symbols",
    outline: "mcp__hex-line__outline (before reading large code files)",
    verify: "mcp__hex-line__verify (staleness / revision check without re-read; use before delayed same-file follow-ups)",
    changes: "mcp__hex-line__changes (git diff with change symbols)",
    bulk: "mcp__hex-line__bulk_replace with path=<project root> (multi-file search-replace)",
};

export const DEFERRED_HINT = "If schemas not loaded: ToolSearch('+hex-line read edit')";

export const BASH_REDIRECTS = [
    { regex: /^cat\s+\S+/, key: "cat" },
    { regex: /^head\s+/, key: "head" },
    { regex: /^tail\s+(?!-[fF])/, key: "tail" },
    { regex: /^(less|more)\s+/, key: "cat" },
    { regex: /^ls\s+-\S*R(\s|$)/, key: "ls" },
    { regex: /^dir\s+\/[sS](\s|$)/, key: "ls" },
    { regex: /^tree\s+/, key: "ls" },
    { regex: /^find\s+/, key: "ls" },
    { regex: /^(stat|wc)\s+/, key: "stat" },
    { regex: /^(grep|rg)\s+/, key: "grep" },
    { regex: /^sed\s+-i/, key: "sed" },
];

export const TOOL_REDIRECT_MAP = {
    Read: "Read",
    Edit: "Edit",
    Write: "Write",
    Grep: "Grep",
};

export const DANGEROUS_PATTERNS = [
    { regex: /rm\s+(-[rf]+\s+)*[/~]/, reason: "rm -rf on root/home directory" },
    { regex: /git\s+push\s+(-f|--force)/, reason: "force push can overwrite remote history" },
    { regex: /git\s+reset\s+--hard/, reason: "hard reset discards uncommitted changes" },
    { regex: /DROP\s+(TABLE|DATABASE)/i, reason: "DROP destroys data permanently" },
    { regex: /chmod\s+777/, reason: "chmod 777 removes all access restrictions" },
    { regex: /mkfs/, reason: "filesystem format destroys all data" },
    { regex: /dd\s+if=\/dev\/zero/, reason: "direct disk write destroys data" },
];

export const COMPOUND_OPERATORS = /[|]|>>?|&&|\|\||;/;

export const CMD_PATTERNS = [
    [/npm (install|ci|update|add)/i, "npm-install"],
    [/npm test|jest|vitest|mocha|pytest|cargo test/i, "test"],
    [/npm run build|tsc|webpack|vite build|cargo build/i, "build"],
    [/pip install/i, "pip-install"],
    [/git (log|diff|status)/i, "git"],
];

export const HOOK_OUTPUT_POLICY = {
    lineThreshold: 50,
    headLines: 15,
    tailLines: 15,
};

export function buildAllowedClaudeSettingsPaths(cwd, home) {
    const cwdNorm = cwd.replace(/\\/g, "/");
    const homeNorm = home.replace(/\\/g, "/");
    return [
        resolve(cwdNorm, ".claude/settings.json"),
        resolve(cwdNorm, ".claude/settings.local.json"),
        resolve(homeNorm, ".claude/settings.json"),
        resolve(homeNorm, ".claude/settings.local.json"),
    ].map((entry) => entry.replace(/\\/g, "/").toLowerCase());
}
