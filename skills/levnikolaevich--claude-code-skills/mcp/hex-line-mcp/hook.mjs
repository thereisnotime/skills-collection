#!/usr/bin/env node
/**
 * Unified hook for hex-line-mcp.
 *
 * Handles three events:
 *
 * PreToolUse:
 *   - Tool redirect: redirects Read/Edit/Write/Grep for text files
 *     to hex-line, with narrow exceptions for binary/media and
 *     allowed .claude/settings*.json paths.
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
import { readFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
    BASH_REDIRECTS,
    BINARY_EXT,
    CMD_PATTERNS,
    COMPOUND_OPERATORS,
    DANGEROUS_PATTERNS,
    DEFERRED_HINT,
    HOOK_OUTPUT_POLICY,
    OUTLINEABLE_EXT,
    REVERSE_TOOL_HINTS,
    TOOL_HINTS,
    TOOL_REDIRECT_MAP,
    buildAllowedClaudeSettingsPaths,
} from "./lib/hook-policy.mjs";

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

        // Skip binary extensions
        if (BINARY_EXT.has(extOf(filePath))) {
            process.exit(0);
        }

        // .claude/ config: allow only settings files at project root or home
        const resolvedNorm = resolveToolPath(filePath).replace(/\\/g, "/");
        const claudeAllow = buildAllowedClaudeSettingsPaths(process.cwd(), homedir());
        if (claudeAllow.includes(resolvedNorm.toLowerCase())) {
            process.exit(0);
        }
        if (resolvedNorm.includes("/.claude/")) {
            redirect("Protected .claude/ path. Use built-in tools for .claude/ config files.");
        }

        if (toolName === "Read") {
            const ext = filePath ? extOf(filePath) : "";
            const rangeHint = isPartialRead(toolInput)
                ? " Preserve the same offset/limit or ranges in read_file."
                : "";
            const outlineHint = (filePath && OUTLINEABLE_EXT.has(ext))
                ? `Use mcp__hex-line__outline(path="${filePath}") for structure, then mcp__hex-line__read_file(path="${filePath}") with ranges to read only what you need.${rangeHint}`
                : filePath
                    ? `Use mcp__hex-line__read_file(path="${filePath}") with ranges or offset/limit.${rangeHint}`
                    : "Use mcp__hex-line__inspect_path or mcp__hex-line__read_file";
            redirect(outlineHint, "Use hex-line for text-file reads to keep hashes, revision metadata, and graph hints in one flow.\n" + DEFERRED_HINT);
        }

        if (toolName === "Edit") {
            const target = filePath
                ? `Use mcp__hex-line__grep_search or mcp__hex-line__read_file, then mcp__hex-line__edit_file with path="${filePath}"`
                : "Use mcp__hex-line__grep_search or mcp__hex-line__read_file, then mcp__hex-line__edit_file";
            redirect(target, "Use hash-verified edits for text files. Locate anchors/checksums first, then call edit_file once with batched edits.\n" + DEFERRED_HINT);
        }

        if (toolName === "Write") {
            const pathNote = filePath ? ` with path="${filePath}"` : "";
            redirect(`Use mcp__hex-line__write_file${pathNote}`, TOOL_HINTS.Write + "\n" + DEFERRED_HINT);
        }

        if (toolName === "Grep") {
            const pathNote = filePath ? ` with path="${filePath}"` : "";
            redirect(`Use mcp__hex-line__grep_search${pathNote}`, TOOL_HINTS.Grep + "\n" + DEFERRED_HINT);
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
    if (originalCount < HOOK_OUTPUT_POLICY.lineThreshold) {
        process.exit(0);
    }

    const type = detectCommandType(command);

    // Pipeline: normalize -> deduplicate -> smart truncate
    const filtered = normalizeOutput(lines.join("\n"), {
        headLines: HOOK_OUTPUT_POLICY.headLines,
        tailLines: HOOK_OUTPUT_POLICY.tailLines,
    });
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

    const msg = styleActive
        ? "Hex-line MCP available. Output style active.\n" +
            "<hex-line_instructions>\n" +
            "  <deferred_loading>If hex-line schemas not loaded, run: ToolSearch('+hex-line read edit')</deferred_loading>\n" +
            "  <note>Follow the active hex-line output style for primary tool choices.</note>\n" +
            "  <exceptions>Built-in tools stay OK for images, PDFs, notebooks, Glob, .claude/settings.json, and .claude/settings.local.json.</exceptions>\n" +
            "</hex-line_instructions>"
        : "Hex-line MCP available.\n" +
            "<hex-line_instructions>\n" +
            "  <deferred_loading>If hex-line schemas not loaded, run: ToolSearch('+hex-line read edit')</deferred_loading>\n" +
            "  <exploration>\n" +
            "    <rule>Use outline for structure (code + markdown), not Read. ~10-20 lines vs hundreds.</rule>\n" +
            "    <rule>Use read_file with offset/limit or ranges for targeted reads.</rule>\n" +
            "    <rule>Use grep_search before editing to get hash anchors.</rule>\n" +
            "  </exploration>\n" +
            "  <editing>\n" +
            "    <path name='surgical'>grep_search \u2192 edit_file (fastest: hash-verified, no full read needed)</path>\n" +
            "    <path name='exploratory'>outline \u2192 read_file (ranges) \u2192 edit_file with base_revision</path>\n" +
            "    <path name='multi-file'>bulk_replace(path=&quot;&lt;project root&gt;&quot;) for text rename/refactor across files</path>\n" +
            "  </editing>\n" +
            "  <tips>\n" +
            "    <tip>Auto-fill path from the active file or project root. Read-only tools may inspect explicit temp-file paths outside the repo. Mutating tools stay project-scoped unless you intentionally pass allow_external=true.</tip>\n" +
            "    <tip>Never invent range_checksum. Copy it from fresh read_file or grep_search blocks.</tip>\n" +
            "    <tip>Prefer set_line or insert_after for small local changes and replace_between for larger bounded rewrites.</tip>\n" +
            "    <tip>Carry revision from read_file into base_revision on edit_file.</tip>\n" +
            "    <tip>If edit returns CONFLICT, call verify \u2014 only reread when STALE.</tip>\n" +
            "    <tip>Avoid large first-pass edit batches. Start with 1-2 hunks, then continue from the returned revision.</tip>\n" +
            "    <tip>Use write_file for new files (no prior Read needed).</tip>\n" +
            "  </tips>\n" +
            "  <exceptions>Built-in tools stay OK for images, PDFs, notebooks, Glob, .claude/settings.json, and .claude/settings.local.json.</exceptions>\n" +
            "</hex-line_instructions>";
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
