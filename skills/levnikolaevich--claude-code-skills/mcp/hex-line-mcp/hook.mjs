#!/usr/bin/env node
/**
 * Unified hook for hex-line-mcp.
 *
 * Handles three events:
 *
 * PreToolUse:
 *   - Tool redirect: advises Read to use hex-line (never blocks),
 *     blocks Edit/Write/Grep for text files redirecting to hex-line.
 *   - Bash redirect: blocks simple cat/head/tail/ls/grep/sed/diff
 *     commands, redirecting to hex-line MCP equivalents.
 *   - Dangerous command blocker: blocks rm -rf /, force push,
 *     hard reset, DROP, chmod 777, mkfs, dd, etc.
 *
 * PostToolUse:
 *   - RTK output filter: compresses verbose Bash output
 *     (npm install, test, build, pip, git). Stderr shown to
 *     Claude as feedback.
 *
 * SessionStart:
 *   - Injects tool preference list into agent context.
 *
 * Exit 0 = approve / no feedback / systemMessage
 * Exit 2 = block (PreToolUse) or stderr feedback (PostToolUse)
 */

import { normalizeOutput } from "@levnikolaevich/hex-common/output/normalize";
import { readFileSync, statSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

// ---- Constants ----

const BINARY_EXT = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico",
    ".pdf", ".ipynb",
    ".zip", ".tar", ".gz", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".wasm",
    ".mp3", ".mp4", ".wav", ".avi", ".mkv",
    ".ttf", ".otf", ".woff", ".woff2",
]);

const OUTLINEABLE_EXT = new Set([
    ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
    ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".cs",
    ".rb", ".php", ".kt", ".swift", ".sh", ".bash",
]);

const REVERSE_TOOL_HINTS = {
    "mcp__hex-line__read_file":      "Read (file_path, offset, limit)",
    "mcp__hex-line__edit_file":      "Edit (old_string, new_string, replace_all)",
    "mcp__hex-line__write_file":     "Write (file_path, content)",
    "mcp__hex-line__grep_search":    "Grep (pattern, path)",
    "mcp__hex-line__directory_tree": "Glob (pattern) or Bash(ls)",
    "mcp__hex-line__get_file_info":  "Bash(stat/wc)",
    "mcp__hex-line__outline":        "Read with offset/limit",
    "mcp__hex-line__verify":         "Read (re-read file to check freshness)",
    "mcp__hex-line__changes":        "Bash(git diff)",
    "mcp__hex-line__bulk_replace":   "Edit (text rename/refactor across files)",
};

const TOOL_HINTS = {
    Read:  "mcp__hex-line__read_file (not Read). For writing: write_file (no prior Read needed)",
    Edit:  "mcp__hex-line__edit_file for revision-aware hash edits. Batch same-file hunks, carry base_revision, use replace_between for block rewrites",
    Write: "mcp__hex-line__write_file (not Write). No prior Read needed",
    Grep:  "mcp__hex-line__grep_search (not Grep). Params: output, literal, context_before, context_after, multiline",
    cat:   "mcp__hex-line__read_file (not cat/head/tail/less/more)",
    head:  "mcp__hex-line__read_file with limit param (not head)",
    tail:  "mcp__hex-line__read_file with offset param (not tail)",
    ls:    "mcp__hex-line__directory_tree with pattern param (not ls/find/tree). E.g. pattern='*-mcp' type='dir'",
    stat:  "mcp__hex-line__get_file_info (not stat/wc/file)",
    grep:  "mcp__hex-line__grep_search (not grep/rg). Params: output, literal, context_before, context_after, multiline",
    sed:   "mcp__hex-line__edit_file for hash edits, or mcp__hex-line__bulk_replace for text rename (not sed -i)",
    diff:  "mcp__hex-line__changes (not diff). Git diff with change symbols",
    outline: "mcp__hex-line__outline (before reading large code files)",
    verify:  "mcp__hex-line__verify (staleness / revision check without re-read)",
    changes: "mcp__hex-line__changes (git diff with change symbols)",
    bulk:    "mcp__hex-line__bulk_replace (multi-file search-replace)",
};

const BASH_REDIRECTS = [
    { regex: /^cat\s+\S+/, key: "cat" },
    { regex: /^head\s+/, key: "head" },
    { regex: /^tail\s+(?!-[fF])/, key: "tail" },
    { regex: /^(less|more)\s+/, key: "cat" },
    { regex: /^ls\s+-\S*R(\s|$)/, key: "ls" },   // ls -R, ls -laR (recursive only)
    { regex: /^dir\s+\/[sS](\s|$)/, key: "ls" }, // dir /s, dir /S (recursive only)
    { regex: /^tree\s+/, key: "ls" },
    { regex: /^find\s+/, key: "ls" },
    { regex: /^(stat|wc)\s+/, key: "stat" },
    { regex: /^(grep|rg)\s+/, key: "grep" },
    { regex: /^sed\s+-i/, key: "sed" },
];

const TOOL_REDIRECT_MAP = {
    Read: "Read",
    Edit: "Edit",
    Write: "Write",
    Grep: "Grep",
};

const DANGEROUS_PATTERNS = [
    {
        regex: /rm\s+(-[rf]+\s+)*[/~]/,
        reason: "rm -rf on root/home directory",
    },
    {
        regex: /git\s+push\s+(-f|--force)/,
        reason: "force push can overwrite remote history",
    },
    {
        regex: /git\s+reset\s+--hard/,
        reason: "hard reset discards uncommitted changes",
    },
    {
        regex: /DROP\s+(TABLE|DATABASE)/i,
        reason: "DROP destroys data permanently",
    },
    {
        regex: /chmod\s+777/,
        reason: "chmod 777 removes all access restrictions",
    },
    {
        regex: /mkfs/,
        reason: "filesystem format destroys all data",
    },
    {
        regex: /dd\s+if=\/dev\/zero/,
        reason: "direct disk write destroys data",
    },
];

const COMPOUND_OPERATORS = /[|]|>>?|&&|\|\||;/;

const CMD_PATTERNS = [
    [/npm (install|ci|update|add)/i, "npm-install"],
    [/npm test|jest|vitest|mocha|pytest|cargo test/i, "test"],
    [/npm run build|tsc|webpack|vite build|cargo build/i, "build"],
    [/pip install/i, "pip-install"],
    [/git (log|diff|status)/i, "git"],
];

const LINE_THRESHOLD = 50;
const HEAD_LINES = 15;
const TAIL_LINES = 15;
const LARGE_FILE_BYTES = 5 * 1024;
const LARGE_EDIT_CHARS = 1200;

// ---- Helpers ----

function extOf(filePath) {
    const dot = filePath.lastIndexOf(".");
    return dot !== -1 ? filePath.slice(dot).toLowerCase() : "";
}

function getFilePath(toolInput) {
    return toolInput.file_path || toolInput.path || "";
}

function resolveToolPath(filePath) {
    if (!filePath) return "";
    if (filePath.startsWith("~/")) return resolve(homedir(), filePath.slice(2));
    return resolve(process.cwd(), filePath);
}

function getFileSize(filePath) {
    if (!filePath) return null;
    try {
        return statSync(resolveToolPath(filePath)).size;
    } catch {
        return null;
    }
}

function isPartialRead(toolInput) {
    return [toolInput.offset, toolInput.limit, toolInput.start_line, toolInput.end_line, toolInput.ranges]
        .some((value) => value !== undefined && value !== null && value !== "");
}

function detectCommandType(cmd) {
    for (const [re, type] of CMD_PATTERNS) {
        if (re.test(cmd)) return type;
    }
    return "generic";
}

function extractBashText(response) {
    if (typeof response === "string") return response;
    if (response && typeof response === "object") {
        // Combine stdout + stderr in stable order
        const parts = [];
        if (response.stdout) parts.push(response.stdout);
        if (response.stderr) parts.push(response.stderr);
        return parts.join("\n") || "";
    }
    return ""; // unknown shape \u2192 fail open
}

/** Cache: null = not computed yet */
let _hexLineDisabled = null;

/**
 * Check if hex-line MCP is disabled for the current project.
 * Reads ~/.claude.json → projects.{cwd}.disabledMcpServers.
 * Fail-open: returns false on any error.
 */
function isHexLineDisabled(configPath) {
    if (_hexLineDisabled !== null) return _hexLineDisabled;
    _hexLineDisabled = false;
    try {
        const p = configPath || resolve(homedir(), ".claude.json");
        const claudeJson = JSON.parse(readFileSync(p, "utf-8"));
        const projects = claudeJson.projects;
        if (!projects || typeof projects !== "object") return _hexLineDisabled;
        const cwd = process.cwd().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
        for (const [path, config] of Object.entries(projects)) {
            if (path.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase() === cwd) {
                const disabled = config.disabledMcpServers;
                if (Array.isArray(disabled) && disabled.includes("hex-line")) {
                    _hexLineDisabled = true;
                }
                break;
            }
        }
    } catch { /* fail open */ }
    return _hexLineDisabled;
}

/** Reset cache (for testing). */
function _resetHexLineDisabledCache() { _hexLineDisabled = null; }

/** Cache: undefined = not computed yet */
let _hookMode;

/**
 * Get hook enforcement mode for the current project.
 * Reads .hex-skills/environment_state.json -> hooks.mode.
 * Fail-closed: returns "blocking" on any error.
 */
function getHookMode() {
    if (_hookMode !== undefined) return _hookMode;
    _hookMode = "blocking";
    try {
        const stateFile = resolve(process.cwd(), ".hex-skills/environment_state.json");
        const data = JSON.parse(readFileSync(stateFile, "utf-8"));
        if (data.hooks?.mode === "advisory") _hookMode = "advisory";
    } catch { /* file missing or malformed -> default blocking */ }
    return _hookMode;
}

// ---- Safe exit: writeSync guarantees flush before process.exit ----

function safeExit(fd, data, code) {
    writeSync(fd, data);
    process.exit(code);
}

function debugLog(action, reason) {
    writeSync(2, `[hex-hook] ${action}: ${reason}\n`);
}

function block(reason, context) {
    const msg = context ? `${reason}\n${context}` : reason;
    const output = {
        hookSpecificOutput: {
            permissionDecision: "deny",
        },
        systemMessage: msg,
    };
    debugLog("BLOCK", reason);
    safeExit(1, JSON.stringify(output), 2);
}

function advise(reason, context) {
    const output = {
        hookSpecificOutput: {
            permissionDecision: "allow",
        },
        systemMessage: context ? `${reason}\n${context}` : reason,
    };
    safeExit(1, JSON.stringify(output), 0);
}

/** Route to block or advise based on hook mode. Dangerous commands always block. */
function redirect(reason, context) {
    if (getHookMode() === "advisory") {
        advise(reason, context);
    } else {
        block(reason, context);
    }
}

// ---- PreToolUse handler ----

function handlePreToolUse(data) {
    const toolName = data.tool_name || "";
    const toolInput = data.tool_input || {};

    // Already using hex-line - approve silently
    if (toolName.startsWith("mcp__hex-line__")) {
        process.exit(0);
    }

    // Tool redirect: Read / Edit / Write / Grep
    const hintKey = TOOL_REDIRECT_MAP[toolName];
    if (hintKey) {
        const filePath = getFilePath(toolInput);
        const fileSize = getFileSize(filePath);

        // Skip binary extensions
        if (BINARY_EXT.has(extOf(filePath))) {
            process.exit(0);
        }

        // Only redirect files within project directory (skip .claude/ subfolder)
        const normalPath = filePath.replace(/\\/g, "/");
        const cwdNorm = process.cwd().replace(/\\/g, "/");
        const isInProject = process.platform === "win32"
            ? normalPath.toLowerCase().startsWith(cwdNorm.toLowerCase())
            : normalPath.startsWith(cwdNorm);
        if (!isInProject || normalPath.includes("/.claude/")) {
            process.exit(0);
        }

        if (toolName === "Read") {
            if (isPartialRead(toolInput)) {
                process.exit(0);
            }
            if (fileSize !== null && fileSize <= LARGE_FILE_BYTES) {
                const ext = filePath ? extOf(filePath) : "";
                const hint = (filePath && OUTLINEABLE_EXT.has(ext))
                    ? `mcp__hex-line__outline(path="${filePath}") gives a compact structural map. For edits, use mcp__hex-line__read_file(path="${filePath}") with ranges.`
                    : filePath
                        ? `NEXT READ: use mcp__hex-line__read_file(path="${filePath}"). Built-in Read allowed this time but wastes edit context.`
                        : "NEXT READ: use mcp__hex-line__read_file. Built-in Read allowed this time but wastes edit context.";
                advise(hint);
            }
            const ext = filePath ? extOf(filePath) : "";
            const outlineHint = (filePath && OUTLINEABLE_EXT.has(ext))
                ? `Use mcp__hex-line__outline(path="${filePath}") for structure, then mcp__hex-line__read_file(path="${filePath}") with ranges to read only what you need.`
                : filePath
                    ? `Use mcp__hex-line__read_file(path="${filePath}") with ranges or offset/limit`
                    : "Use mcp__hex-line__directory_tree or mcp__hex-line__read_file";
            redirect(outlineHint, "Do not use built-in Read for full reads of large files.");
        }

        if (toolName === "Edit") {
            const oldText = String(toolInput.old_string || "");
            const isLargeEdit = Boolean(toolInput.replace_all) || oldText.length > LARGE_EDIT_CHARS || (fileSize !== null && fileSize > LARGE_FILE_BYTES);
            if (!isLargeEdit) {
                process.exit(0);
            }
            const target = filePath
                ? `Use mcp__hex-line__grep_search or mcp__hex-line__read_file, then mcp__hex-line__edit_file with path="${filePath}"`
                : "Use mcp__hex-line__grep_search or mcp__hex-line__read_file, then mcp__hex-line__edit_file";
            redirect(target, "For large or repeated edits: locate anchors/checksums first, then call edit_file once with batched edits.");
        }

        if (toolName === "Write") {
            const pathNote = filePath ? ` with path="${filePath}"` : "";
            redirect(`Use mcp__hex-line__write_file${pathNote}`, TOOL_HINTS.Write);
        }

        if (toolName === "Grep") {
            const pathNote = filePath ? ` with path="${filePath}"` : "";
            redirect(`Use mcp__hex-line__grep_search${pathNote}`, TOOL_HINTS.Grep);
        }
    }

    // Bash tool checks
    if (toolName === "Bash") {
        const command = (toolInput.command || "").trim();

        // User-confirmed bypass
        if (command.includes("# hex-confirmed")) {
            process.exit(0);
        }

        // Strip heredoc bodies to avoid false positives on data content
        // e.g. gh api -f body="$(cat <<'EOF'\n...rm -rf...\nEOF)"
        const cmdCheck = command.replace(/<<['"]?(\w+)['"]?\s*\n[\s\S]*?\n\1/g, "");

        // Dangerous command blocker
        for (const { regex, reason } of DANGEROUS_PATTERNS) {
            if (regex.test(cmdCheck)) {
                block(
                    `DANGEROUS: ${reason}. Ask user to confirm, then retry with: # hex-confirmed`,
                    `Original command: ${command.slice(0, 100)}`
                );
            }
        }

        // Compound commands: check first command in pipe before skipping
        if (COMPOUND_OPERATORS.test(command)) {
            const firstCmd = command.split(/\s*[|;&>]\s*/)[0].trim();
            for (const { regex, key } of BASH_REDIRECTS) {
                if (regex.test(firstCmd)) {
                    const hint = TOOL_HINTS[key];
                    const toolName2 = hint.split(" (")[0];
                    redirect(`Use ${toolName2} instead of piped command`, hint);
                }
            }
            process.exit(0);
        }

        // Simple command redirect — extract args for instant retry
        for (const { regex, key } of BASH_REDIRECTS) {
            if (regex.test(command)) {
                const hint = TOOL_HINTS[key];
                const toolName2 = hint.split(" (")[0];
                const args = command.split(/\s+/).slice(1).join(" ");
                const argsNote = args ? ` — args: "${args}"` : "";
                redirect(`Use ${toolName2}${argsNote}`, hint);
            }
        }
    }

    // Everything else - approve
    process.exit(0);
}

// ---- PreToolUse REVERSE handler (hex-line disabled) ----

function handlePreToolUseReverse(data) {
    const toolName = data.tool_name || "";

    // Agent tries hex-line tool that's disabled → redirect to built-in
    if (toolName.startsWith("mcp__hex-line__")) {
        const builtIn = REVERSE_TOOL_HINTS[toolName];
        if (builtIn) {
            const target = builtIn.split(" ")[0];
            block(
                `hex-line is disabled in this project. Use ${target}`,
                `hex-line disabled. Use built-in: ${builtIn}`
            );
        }
        block("hex-line is disabled in this project", "Disabled via project settings");
    }

    // All built-in tools — approve silently
    process.exit(0);
}

// ---- PostToolUse handler ----

function handlePostToolUse(data) {
    const toolName = data.tool_name || "";

    // Only filter Bash output
    if (toolName !== "Bash") {
        process.exit(0);
    }

    const toolInput = data.tool_input || {};
    const rawText = extractBashText(data.tool_response);
    const command = toolInput.command || "";

    // Nothing to filter
    if (!rawText) {
        process.exit(0);
    }

    const lines = rawText.split("\n");
    const originalCount = lines.length;

    // Short output - no filtering
    if (originalCount < LINE_THRESHOLD) {
        process.exit(0);
    }

    const type = detectCommandType(command);

    // Pipeline: normalize -> deduplicate -> smart truncate
    const filtered = normalizeOutput(lines.join("\n"), { headLines: HEAD_LINES, tailLines: TAIL_LINES });
    const filteredCount = filtered.split("\n").length;

    const header = `RTK FILTERED: ${type} (${originalCount} lines -> ${filteredCount} lines)`;

    const output = [
        "=".repeat(50),
        header,
        "=".repeat(50),
        "",
        filtered,
        "",
        "-".repeat(50),
        `Original: ${originalCount} lines | Filtered: ${filteredCount} lines`,
        "=".repeat(50),
    ].join("\n");

    safeExit(2, output, 2);
}

// ---- SessionStart: inject tool preferences ----

function handleSessionStart() {
    // Check if hex-line output style is active (skip full hints if so)
    const settingsFiles = [
        resolve(process.cwd(), ".claude/settings.local.json"),
        resolve(process.cwd(), ".claude/settings.json"),
        resolve(homedir(), ".claude/settings.json"),
    ];
    let styleActive = false;
    for (const f of settingsFiles) {
        try {
            const config = JSON.parse(readFileSync(f, "utf-8"));
            if (config.outputStyle === "hex-line") { styleActive = true; break; }
            if (config.outputStyle) break; // another style overrides
        } catch { /* file missing or invalid */ }
    }

    const prefix = styleActive ? "Hex-line MCP available. Output style active.\n" : "Hex-line MCP available.\n";
    const msg = prefix +
        "Call hex-line tools directly. Do not use ToolSearch for hex-line tools.\n" +
        "Workflow:\n" +
        "- Discovery: outline for code and markdown files, read_file for targeted reads, grep_search for symbol/text lookup\n" +
        "- Read cheaply: prefer offset/limit or ranges; avoid full-file Read on large files\n" +
        "- Edit safely: read/grep first, then one batched edit_file call per file with base_revision when available\n" +
        "- Verify before reread: use verify to check checksums or revision freshness\n" +
        "- Multi-file rename/refactor: use bulk_replace\n" +
        "- New files: use write_file\n" +
        "Exceptions: images, PDFs, notebooks, .claude/settings.json, .claude/settings.local.json use built-in Read. Glob is always OK.";
    safeExit(1, JSON.stringify({ systemMessage: msg }), 0);
}

// ---- Main: read stdin, route by hook_event_name ----
// Guard: only run when executed directly, not when imported for testing

import { fileURLToPath } from "node:url";

const _norm = (p) => p.replace(/\\/g, "/");
if (_norm(process.argv[1]) === _norm(fileURLToPath(import.meta.url))) {
    let input = "";
    process.stdin.on("data", (chunk) => {
        input += chunk;
    });
    process.stdin.on("end", () => {
        try {
            const data = JSON.parse(input);
            const event = data.hook_event_name || "";

            if (isHexLineDisabled()) {
                // REVERSE MODE: block hex-line calls, approve everything else
                if (event === "PreToolUse") handlePreToolUseReverse(data);
                process.exit(0); // SessionStart, PostToolUse — silent exit
            }

            // NORMAL MODE
            if (event === "SessionStart") handleSessionStart();
            else if (event === "PreToolUse") handlePreToolUse(data);
            else if (event === "PostToolUse") handlePostToolUse(data);
            else process.exit(0);
        } catch {
            process.exit(0);
        }
    });
}

// ---- Exports for testing ----
export { isHexLineDisabled, _resetHexLineDisabledCache };
