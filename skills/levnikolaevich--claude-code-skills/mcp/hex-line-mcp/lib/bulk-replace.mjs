import { writeFileSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { simpleDiff } from "./edit.mjs";
import { normalizePath } from "./security.mjs";
import { readText, MAX_BULK_OUTPUT_CHARS, MAX_PER_FILE_DIFF_LINES } from "./format.mjs";

let ignoreMod;
try { ignoreMod = await import("ignore"); } catch { /* unavailable */ }

/** Walk directory, respecting .gitignore via `ignore` package. */
function walkFiles(dir, rootDir, ig) {
    const results = [];
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
    for (const e of entries) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        const full = join(dir, e.name);
        const rel = relative(rootDir, full).replace(/\\/g, "/");
        if (ig && ig.ignores(rel)) continue;
        if (e.isDirectory()) {
            results.push(...walkFiles(full, rootDir, ig));
        } else {
            results.push(full);
        }
    }
    return results;
}

/** Simple glob match (supports *, **, ?, {a,b}). */
function globMatch(filename, pattern) {
    const re = pattern
        .replace(/\./g, "\\.")
        .replace(/\{([^}]+)\}/g, (_, alts) => "(" + alts.split(",").join("|") + ")")
        .replace(/\*\*/g, "\0")
        .replace(/\*/g, "[^/]*")
        .replace(/\0/g, ".*")
        .replace(/\?/g, ".");
    return new RegExp("^" + re + "$").test(filename);
}

function loadGitignore(rootDir) {
    if (!ignoreMod) return null;
    const ig = (ignoreMod.default || ignoreMod)();
    try {
        const content = readText(join(rootDir, ".gitignore"));
        ig.add(content);
    } catch { /* no .gitignore */ }
    return ig;
}

export function bulkReplace(rootDir, globPattern, replacements, opts = {}) {
    const { dryRun = false, maxFiles = 100, format = "compact" } = opts;
    const abs = resolve(normalizePath(rootDir));

    const ig = loadGitignore(abs);
    const allFiles = walkFiles(abs, abs, ig);
    const files = allFiles.filter(f => {
        const rel = relative(abs, f).replace(/\\/g, "/");
        return globMatch(rel, globPattern);
    });

    if (files.length === 0) return "No files matched the glob pattern.";

    if (files.length > maxFiles) {
        return `TOO_MANY_FILES: Found ${files.length} files, max_files is ${maxFiles}. Use more specific glob or increase max_files.`;
    }

    const results = [];
    let changed = 0, skipped = 0, errors = 0, totalReplacements = 0;

    for (const file of files) {
        try {
            const original = readText(file);
            let content = original;

            let replacementCount = 0;
            for (const { old: oldText, new: newText } of replacements) {
                if (oldText === newText) continue;
                const parts = content.split(oldText);
                replacementCount += parts.length - 1;
                content = parts.join(newText);
            }

            if (content === original) { skipped++; continue; }

            if (!dryRun) {
                const tempPath = `${file}.hexline-tmp-${process.pid}`;
                try {
                    writeFileSync(tempPath, content, "utf-8");
                    renameSync(tempPath, file);
                } catch (error) {
                    try {
                        unlinkSync(tempPath);
                    } catch {
                        // Best-effort temp cleanup.
                    }
                    throw error;
                }
            }

            const relPath = relative(abs, file).replace(/\\/g, "/");
            totalReplacements += replacementCount;
            changed++;

            if (format === "full") {
                const diff = simpleDiff(original.split("\n"), content.split("\n"));
                let diffText = diff || "(no visible diff)";
                const diffLines = diffText.split("\n");
                if (diffLines.length > MAX_PER_FILE_DIFF_LINES) {
                    const omitted = diffLines.length - MAX_PER_FILE_DIFF_LINES;
                    diffText = diffLines.slice(0, MAX_PER_FILE_DIFF_LINES).join("\n")
                        + `\n--- ${omitted} lines omitted ---`;
                }
                results.push(`--- ${relPath}: ${replacementCount} replacements\n${diffText}`);
            } else {
                results.push(`--- ${relPath}: ${replacementCount} replacements`);
            }
        } catch (e) {
            results.push(`ERROR: ${file}: ${e.message}`);
            errors++;
        }
    }

    const header = `Bulk replace: ${changed} files changed (${totalReplacements} replacements), ${skipped} skipped, ${errors} errors (dry_run: ${dryRun})`;
    let output = results.length ? `${header}\n\n${results.join("\n\n")}` : header;
    if (output.length > MAX_BULK_OUTPUT_CHARS) {
        output = output.slice(0, MAX_BULK_OUTPUT_CHARS)
            + `\nOUTPUT_CAPPED: Output exceeded ${MAX_BULK_OUTPUT_CHARS} chars.`;
    }
    return output;
}
