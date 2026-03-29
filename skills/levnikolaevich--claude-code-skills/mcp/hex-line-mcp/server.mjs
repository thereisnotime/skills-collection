#!/usr/bin/env node
/**
 * hex-line-mcp — MCP server for hash-verified file operations.
 *
 * 10 tools: read_file, edit_file, write_file, grep_search, outline, verify, directory_tree, get_file_info, changes, bulk_replace
 * FNV-1a 2-char tags + range checksums
 * Security: root policy, path validation, binary/size rejection
 * Transport: stdio
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const version = typeof __HEX_VERSION__ !== "undefined" ? __HEX_VERSION__ // eslint-disable-line no-undef
  : (await import("node:module")).createRequire(import.meta.url)("./package.json").version;
import { z } from "zod";
import { createServerRuntime } from "@levnikolaevich/hex-common/runtime/mcp-bootstrap";
import { flexBool, flexNum } from "@levnikolaevich/hex-common/runtime/schema";
import { coerceParams } from "@levnikolaevich/hex-common/runtime/coerce";
import { checkForUpdates } from "@levnikolaevich/hex-common/runtime/update-check";
// LLM clients may send booleans as strings ("true"/"false").
// z.coerce.boolean() is unsafe: Boolean("false") === true.
// LLM clients may send numbers as strings ("5" instead of 5).
// z.coerce.number() generates {"type":"number"} → strict MCP clients reject strings.
// flexNum generates schema accepting both, coerces at runtime.
// Outer .optional() ensures JSON Schema marks field as not-required.

import { readFile } from "./lib/read.mjs";
import { editFile } from "./lib/edit.mjs";
import { grepSearch } from "./lib/search.mjs";
import { fileOutline } from "./lib/outline.mjs";
import { verifyChecksums } from "./lib/verify.mjs";
import { validateWritePath } from "./lib/security.mjs";
import { directoryTree } from "./lib/tree.mjs";
import { fileInfo } from "./lib/info.mjs";
import { autoSync } from "./lib/setup.mjs";
import { fileChanges } from "./lib/changes.mjs";
import { bulkReplace } from "./lib/bulk-replace.mjs";

const { server, StdioServerTransport } = await createServerRuntime({
    name: "hex-line-mcp",
    version,
});


// --- Shared schemas ---

const replacementPairsSchema = z.array(
    z.object({ old: z.string().min(1), new: z.string() })
).min(1);

const readRangeSchema = z.union([
    z.string(),
    z.object({
        start: flexNum().optional(),
        end: flexNum().optional(),
    }),
]);

function parseReadRanges(rawRanges) {
    if (!rawRanges) return undefined;
    const parsed = Array.isArray(rawRanges) ? rawRanges : JSON.parse(rawRanges);
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("ranges must be a non-empty array");
    }
    return parsed;
}

// ==================== read_file ====================

server.registerTool("read_file", {
    title: "Read File",
    description: "Read file with hash-annotated lines, checksums, and revision metadata. Default: edit-ready output. Use plain:true for non-edit workflows.",
    inputSchema: z.object({
        path: z.string().optional().describe("File or directory path"),
        paths: z.array(z.string()).optional().describe("Array of file paths to read (batch mode)"),
        offset: flexNum().describe("Start line (1-indexed, default: 1)"),
        limit: flexNum().describe("Max lines (default: 2000, 0 = all)"),
        ranges: z.union([z.string(), z.array(readRangeSchema)]).optional().describe('Line ranges, e.g. ["10-25", {"start":40,"end":55}]'),
        include_graph: flexBool().describe("Include graph annotations"),
        plain: flexBool().describe("Omit hashes (lineNum|content)"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path: p, paths: multi, offset, limit, ranges: rawRanges, include_graph, plain } = coerceParams(rawParams);
    try {
        const ranges = parseReadRanges(rawRanges);
        if (multi && multi.length > 0 && !p) {
            const results = [];
            for (const fp of multi) {
                try {
                    results.push(readFile(fp, { offset, limit, ranges, includeGraph: include_graph, plain }));
                } catch (e) {
                    results.push(`File: ${fp}\n\nERROR: ${e.message}`);
                }
            }
            return { content: [{ type: "text", text: results.join("\n\n---\n\n") }] };
        }
        if (!p) throw new Error("Either 'path' or 'paths' is required");
        return { content: [{ type: "text", text: readFile(p, { offset, limit, ranges, includeGraph: include_graph, plain }) }] };
    } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
    }
});


// ==================== edit_file ====================

server.registerTool("edit_file", {
    title: "Edit File",
    description: "Apply verified partial edits to one file.",
    inputSchema: z.object({
        path: z.string().describe("File to edit"),
        edits: z.union([z.string(), z.array(z.any())]).describe(
            'JSON array of canonical edits.\n' +
            '[{"set_line":{"anchor":"ab.12","new_text":"x"}}]\n' +
            '[{"replace_lines":{"start_anchor":"ab.10","end_anchor":"cd.15","new_text":"x","range_checksum":"10-15:a1b2"}}]\n' +
            '[{"insert_after":{"anchor":"ab.20","text":"x"}}]\n' +
            '[{"replace_between":{"start_anchor":"ab.10","end_anchor":"cd.40","new_text":"x","boundary_mode":"inclusive"}}]',
        ),
        dry_run: flexBool().describe("Preview changes without writing"),
        restore_indent: flexBool().describe("Auto-fix indentation to match anchor (default: false)"),
        base_revision: z.string().optional().describe("Prior revision from read_file/edit_file. Enables conservative auto-rebase for same-file follow-up edits."),
        conflict_policy: z.enum(["strict", "conservative"]).optional().describe('Conflict handling (default: "conservative"). "conservative" returns structured CONFLICT output for stale edits instead of forcing reread.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
}, async (rawParams) => {
    const { path: p, edits: json, dry_run, restore_indent, base_revision, conflict_policy } = coerceParams(rawParams);
    try {
        let parsed;
        try { parsed = typeof json === "string" ? JSON.parse(json) : json; }
        catch { throw new Error('edits: invalid JSON. Expected: [{"set_line":{"anchor":"xx.N","new_text":"..."}}]'); }
        if (!Array.isArray(parsed) || !parsed.length) throw new Error("Edits: non-empty JSON array required");
        return {
            content: [{
                type: "text",
                text: editFile(p, parsed, {
                    dryRun: dry_run,
                    restoreIndent: restore_indent,
                    baseRevision: base_revision,
                    conflictPolicy: conflict_policy,
                }),
            }],
        };
    } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
    }
});


// ==================== write_file ====================

server.registerTool("write_file", {
    title: "Write File",
    description:
        "Create a new file or overwrite existing. Creates parent dirs. " +
        "For existing files prefer edit_file (shows diff, verifies hashes).",
    inputSchema: z.object({
        path: z.string().describe("File path"),
        content: z.string().describe("File content"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path: p, content } = coerceParams(rawParams);
    try {
        const abs = validateWritePath(p);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, "utf-8");
        return { content: [{ type: "text", text: `Created ${p} (${content.split("\n").length} lines)` }] };
    } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
    }
});


// ==================== grep_search ====================

server.registerTool("grep_search", {
    title: "Search Files",
    description: "Search file contents with ripgrep. Default: edit-ready blocks with hashes and checksums. Use output:'files' or 'count' for non-edit workflows. With graph DB: results ranked by importance.",
    inputSchema: z.object({
        pattern: z.string().describe("Search pattern (regex by default, literal if literal:true)"),
        path: z.string().optional().describe("Search dir/file (default: cwd)"),
        glob: z.string().optional().describe('Glob filter (e.g. "*.ts")'),
        type: z.string().optional().describe('File type (e.g. "js", "py")'),
        output: z.enum(["content", "files", "count"]).optional().describe('Output format (default: content)'),
        case_insensitive: flexBool().describe("Ignore case (-i)"),
        smart_case: flexBool().describe("CI when pattern is all lowercase, CS if uppercase (-S)"),
        literal: flexBool().describe("Literal string search, no regex (-F)"),
        multiline: flexBool().describe("Pattern can span multiple lines (-U)"),
        context: flexNum().describe("Symmetric context lines around matches (-C)"),
        context_before: flexNum().describe("Context lines BEFORE match (-B)"),
        context_after: flexNum().describe("Context lines AFTER match (-A)"),
        limit: flexNum().describe("Max matches per file (default: 100)"),
        total_limit: flexNum().describe("Total match events across all files; multiline matches count as 1 (0 = unlimited)"),
        plain: flexBool().describe("Omit hash tags, return file:line:content"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { pattern, path: p, glob, type, output, case_insensitive, smart_case, literal, multiline,
            context, context_before, context_after, limit, total_limit, plain } = coerceParams(rawParams);
    try {
        const result = await grepSearch(pattern, {
            path: p, glob, type, output, caseInsensitive: case_insensitive, smartCase: smart_case,
            literal, multiline, context, contextBefore: context_before, contextAfter: context_after,
            limit, totalLimit: total_limit, plain,
        });
        return { content: [{ type: "text", text: result }] };
    } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
    }
});


// ==================== outline ====================

server.registerTool("outline", {
    title: "File Outline",
    description:
        "AST-based structural outline with hash anchors for direct edit_file usage. " +
        "Supports code files (JS/TS/Python/Go/Rust/Java/C/C++/C#/Ruby/PHP/Kotlin/Swift/Bash) and markdown headings (.md/.mdx, fence-aware).",
    inputSchema: z.object({
        path: z.string().describe("Source file path"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path: p } = coerceParams(rawParams);
    try {
        const result = await fileOutline(p);
        return { content: [{ type: "text", text: result }] };
    } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
    }
});


// ==================== verify ====================

server.registerTool("verify", {
    title: "Verify Checksums",
    description: "Verify held checksums without rereading the file.",
    inputSchema: z.object({
        path: z.string().describe("File path"),
        checksums: z.array(z.string()).describe('Checksum strings, e.g. ["1-50:f7e2a1b0", "51-100:abcd1234"]'),
        base_revision: z.string().optional().describe("Optional prior revision to compare against latest state."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path: p, checksums, base_revision } = coerceParams(rawParams);
    try {
        if (!Array.isArray(checksums) || checksums.length === 0) {
            throw new Error("checksums must be a non-empty array of strings");
        }
        return { content: [{ type: "text", text: verifyChecksums(p, checksums, { baseRevision: base_revision }) }] };
    } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
    }
});


// ==================== directory_tree ====================

server.registerTool("directory_tree", {
    title: "Directory Tree",
    description:
        "Directory tree with .gitignore support. Pattern glob to find files/dirs by name. " +
        "Skips node_modules, .git, dist.",
    inputSchema: z.object({
        path: z.string().describe("Directory path"),
        pattern: z.string().optional().describe('Glob filter on names (e.g. "*-mcp", "*.mjs"). Returns flat match list instead of tree'),
        type: z.enum(["file", "dir", "all"]).optional().describe('"file", "dir", or "all" (default). Like find -type f/d'),
        max_depth: flexNum().describe("Max recursion depth (default: 3, or 20 in pattern mode)"),
        gitignore: flexBool().describe("Respect root .gitignore patterns (default: true). Nested .gitignore not supported"),
        format: z.enum(["compact", "full"]).optional().describe('"compact" = names only, no sizes, depth 1. "full" = default with sizes'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path: p, max_depth, gitignore, format, pattern, type: entryType } = coerceParams(rawParams);
    try {
        return { content: [{ type: "text", text: directoryTree(p, { max_depth, gitignore, format, pattern, type: entryType }) }] };
    } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
    }
});


// ==================== get_file_info ====================

server.registerTool("get_file_info", {
    title: "File Info",
    description:
        "File metadata without reading content: size, line count, modification time, type, binary detection. " +
        "Use before reading large files to check size.",
    inputSchema: z.object({
        path: z.string().describe("File path"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path: p } = coerceParams(rawParams);
    try {
        return { content: [{ type: "text", text: fileInfo(p) }] };
    } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
    }
});


// ==================== changes ====================

server.registerTool("changes", {
    title: "Semantic Diff",
    description:
        "Compare file or directory against git ref (default: HEAD). Shows added/removed/modified symbols or file stats.",
    inputSchema: z.object({
        path: z.string().describe("File or directory path"),
        compare_against: z.string().optional().describe('Git ref to compare against (default: "HEAD")'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path: p, compare_against } = coerceParams(rawParams);
    try {
        return { content: [{ type: "text", text: await fileChanges(p, compare_against) }] };
    } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
    }
});


// ==================== bulk_replace ====================

server.registerTool("bulk_replace", {
    title: "Bulk Replace",
    description: "Search-and-replace across multiple files with compact or full diff output.",
    inputSchema: z.object({
        replacements: z.union([z.string(), replacementPairsSchema]).describe('JSON array of {old, new} pairs: [{"old":"foo","new":"bar"}]'),
        glob: z.string().optional().describe('File glob (default: "**/*.{md,mjs,json,yml,ts,js}")'),
        path: z.string().optional().describe("Root directory (default: cwd)"),
        dry_run: flexBool().describe("Preview without writing (default: false)"),
        max_files: flexNum().describe("Max files to process (default: 100)"),
        format: z.enum(["compact", "full"]).optional().describe('"compact" (default) = summary only, "full" = include capped diffs'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
}, async (rawParams) => {
    try {
        const params = coerceParams(rawParams);
        const raw = params.replacements;
        let replacementsInput;
        try { replacementsInput = typeof raw === "string" ? JSON.parse(raw) : raw; }
        catch { throw new Error('replacements: invalid JSON. Expected: [{"old":"text","new":"replacement"}]'); }
        const replacements = replacementPairsSchema.parse(replacementsInput);
        const result = bulkReplace(
            params.path || process.cwd(),
            params.glob || "**/*.{md,mjs,json,yml,ts,js}",
            replacements,
            { dryRun: params.dry_run || false, maxFiles: params.max_files || 100, format: params.format }
        );
        return { content: [{ type: "text", text: result }] };
    } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
    }
});


// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
void checkForUpdates("@levnikolaevich/hex-line-mcp", version);
try { autoSync(); } catch { /* startup sync is best-effort */ }
