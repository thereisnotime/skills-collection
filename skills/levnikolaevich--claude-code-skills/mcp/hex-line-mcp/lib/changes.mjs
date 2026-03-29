/**
 * Semantic diff: compare file against git ref using AST outlines.
 *
 * Shows added/removed/modified symbols — no line-level noise.
 * Uses outlineFromContent() to parse both current and git versions
 * without temp files.
 */

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { extname } from "node:path";
import { validatePath, normalizePath } from "./security.mjs";
import { readText } from "./format.mjs";
import { outlineFromContent } from "./outline.mjs";

/**
 * Extract symbol name from outline text.
 * Strips parameters, braces, generics — keeps the identifier.
 *
 * "export async function fileOutline(filePath)" → "fileOutline"
 * "const LANG_CONFIGS = {"                      → "LANG_CONFIGS"
 * "class MyClass extends Base {"                 → "MyClass"
 */
function symbolName(text) {
    // Remove trailing { and whitespace
    const clean = text.replace(/\s*\{?\s*$/, "").trim();
    // Remove everything from first ( onward (params)
    const noParams = clean.replace(/\(.*$/, "").trim();
    // Take last word — that's the identifier
    const parts = noParams.split(/\s+/);
    // Skip assignment: "const X = ..." → take word before "="
    const eqIdx = parts.indexOf("=");
    if (eqIdx > 0) return parts[eqIdx - 1];
    return parts[parts.length - 1] || text;
}

/**
 * Parse outline entries into comparable symbol list.
 */
function toSymbolMap(entries) {
    const map = new Map();
    for (const e of entries) {
        const name = symbolName(e.text);
        const lines = e.end - e.start + 1;
        map.set(name, { name, text: e.text, lines, start: e.start, end: e.end });
    }
    return map;
}

/**
 * Get relative path from git root for `git show`.
 */
function gitRelativePath(absPath) {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: absPath.replace(/[/\\][^/\\]+$/, ""),
        encoding: "utf-8",
        timeout: 5000,
    }).trim().replace(/\\/g, "/");

    const normalized = absPath.replace(/\\/g, "/");
    // Ensure root and path are comparable (case-insensitive on Windows)
    const rootLower = root.toLowerCase();
    const pathLower = normalized.toLowerCase();
    if (!pathLower.startsWith(rootLower)) {
        throw new Error(`File ${absPath} is not inside git repo ${root}`);
    }
    return normalized.slice(root.length + 1);
}

/**
 * Compare file against git ref, returning semantic symbol diff.
 *
 * @param {string} filePath        File path (absolute or relative)
 * @param {string} compareAgainst  Git ref (default: "HEAD")
 * @returns {Promise<string>}      Formatted diff
 */
export async function fileChanges(filePath, compareAgainst = "HEAD") {
    filePath = normalizePath(filePath);
    const real = validatePath(filePath);

    // Directory: return git diff --stat (compact file list, no content reads)
    if (statSync(real).isDirectory()) {
        try {
            const stat = execFileSync("git", ["diff", "--stat", compareAgainst, "--", "."], {
                cwd: real,
                encoding: "utf-8",
                timeout: 10000,
            }).trim();
            if (!stat) return `No changes in ${filePath} vs ${compareAgainst}`;
            return `Changed files in ${filePath} vs ${compareAgainst}:\n\n${stat}\n\nUse changes on a specific file for symbol-level diff.`;
        } catch {
            return `No git history for ${filePath} or not a git repository.`;
        }
    }

    const ext = extname(real).toLowerCase();

    // Check if outline supports this extension
    const currentContent = readText(real);
    const currentResult = await outlineFromContent(currentContent, ext);
    if (!currentResult) {
        return `Cannot outline ${ext} files. Supported: .js .mjs .ts .py .go .rs .java .c .cpp .cs .rb .php .kt .swift .sh .bash`;
    }

    // Get git version
    const relPath = gitRelativePath(real);
    let gitContent;
    try {
        gitContent = execFileSync("git", ["show", `${compareAgainst}:${relPath}`], {
            cwd: real.replace(/[/\\][^/\\]+$/, ""),
            encoding: "utf-8",
            timeout: 5000,
        }).replace(/\r\n/g, "\n");
    } catch {
        return `NEW FILE: ${filePath} (not in ${compareAgainst})`;
    }

    // Outline the git version from content — no temp files
    const gitResult = await outlineFromContent(gitContent, ext);
    if (!gitResult) {
        return `Cannot outline git version of ${filePath}`;
    }

    // Compare symbol maps
    const currentMap = toSymbolMap(currentResult.entries);
    const gitMap = toSymbolMap(gitResult.entries);

    const added = [];
    const removed = [];
    const modified = [];

    for (const [name, sym] of currentMap) {
        if (!gitMap.has(name)) {
            added.push(sym);
        } else {
            const gitSym = gitMap.get(name);
            if (gitSym.lines !== sym.lines) {
                modified.push({ current: sym, git: gitSym });
            }
        }
    }
    for (const [name, sym] of gitMap) {
        if (!currentMap.has(name)) {
            removed.push(sym);
        }
    }

    // Format
    const parts = [`Changes in ${filePath} vs ${compareAgainst}:`];

    if (added.length) {
        parts.push("\nAdded:");
        for (const s of added) parts.push(`  + ${s.start}-${s.end}: ${s.text}`);
    }
    if (removed.length) {
        parts.push("\nRemoved:");
        for (const s of removed) parts.push(`  - ${s.start}-${s.end}: ${s.text}`);
    }
    if (modified.length) {
        parts.push("\nModified:");
        for (const m of modified) {
            const delta = m.current.lines - m.git.lines;
            const sign = delta > 0 ? "+" : "";
            parts.push(`  ~ ${m.current.start}-${m.current.end}: ${m.current.text}  (${sign}${delta} lines)`);
        }
    }

    if (!added.length && !removed.length && !modified.length) {
        parts.push("\nNo symbol changes detected.");
    }

    const summary = `${added.length} added, ${removed.length} removed, ${modified.length} modified`;
    parts.push(`\nSummary: ${summary}`);

    return parts.join("\n");
}
