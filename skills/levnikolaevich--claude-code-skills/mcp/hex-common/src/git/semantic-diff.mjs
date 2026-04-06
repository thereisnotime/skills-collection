import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { isSupportedExtension, languageForExtension } from "../parser/languages.mjs";
import { outlineFromContent } from "../parser/outline.mjs";

function normalizePath(value) {
    return value.replace(/\\/g, "/");
}

function repoCwd(targetPath) {
    if (!existsSync(targetPath)) {
        throw new Error(`Path does not exist: ${targetPath}`);
    }
    return statSync(targetPath).isDirectory() ? targetPath : dirname(targetPath);
}

function runGit(args, cwd, allowFailure = false) {
    try {
        return execFileSync("git", args, {
            cwd,
            encoding: "utf8",
            timeout: 10000,
        }).replace(/\r\n/g, "\n");
    } catch (error) {
        if (allowFailure) {
            return null;
        }
        const stderr = error.stderr?.toString?.().trim();
        const stdout = error.stdout?.toString?.().trim();
        throw new Error(stderr || stdout || error.message);
    }
}

function gitRoot(targetPath) {
    return normalizePath(runGit(["rev-parse", "--show-toplevel"], repoCwd(targetPath)).trim());
}

function scopePathspec(absPath, repoRoot) {
    const normalized = normalizePath(absPath);
    if (normalized === repoRoot) return null;
    const rel = normalizePath(relative(repoRoot, normalized));
    return rel && rel !== "." ? rel : null;
}

function compareRefs(baseRef, headRef, cwd) {
    if (!headRef) {
        return {
            baselineRef: baseRef,
            headRef: null,
            diffArgs: ["diff", "--name-status", "-M", baseRef],
        };
    }
    const baselineRef = runGit(["merge-base", baseRef, headRef], cwd).trim();
    return {
        baselineRef,
        headRef,
        diffArgs: ["diff", "--name-status", "-M", baselineRef, headRef],
    };
}

function parseNameStatus(stdout) {
    return stdout.trim().split("\n").filter(Boolean).map((line) => {
        const parts = line.split("\t");
        const statusCode = parts[0];
        if (statusCode.startsWith("R")) {
            return {
                status: "renamed",
                status_code: statusCode,
                old_path: normalizePath(parts[1]),
                path: normalizePath(parts[2]),
            };
        }
        const path = normalizePath(parts[1]);
        return {
            status: statusCode === "A" ? "added" : statusCode === "D" ? "deleted" : statusCode === "M" ? "modified" : "changed",
            status_code: statusCode,
            old_path: statusCode === "D" ? path : null,
            path,
        };
    });
}

function listUntrackedFiles(repoRoot, pathspec = null) {
    const args = ["ls-files", "--others", "--exclude-standard"];
    if (pathspec) args.push("--", pathspec);
    return runGit(args, repoRoot, true)
        ?.trim()
        .split("\n")
        .filter(Boolean)
        .map(path => ({
            status: "added",
            status_code: "??",
            old_path: null,
            path: normalizePath(path),
        })) || [];
}

function mergeWorkingTreeChanges(repoRoot, changed, refs, pathspec) {
    if (refs.headRef) {
        return changed;
    }
    const merged = [...changed];
    const seenPaths = new Set(changed.flatMap(file => [file.path, file.old_path]).filter(Boolean));
    for (const file of listUntrackedFiles(repoRoot, pathspec)) {
        if (!seenPaths.has(file.path)) {
            merged.push(file);
        }
    }
    return collapseRenameCandidates(repoRoot, merged, refs);
}

function collapseRenameCandidates(repoRoot, files, refs) {
    const remaining = [...files];
    const collapsed = [];
    while (remaining.length) {
        const current = remaining.shift();
        if (current.status !== "deleted") {
            collapsed.push(current);
            continue;
        }
        const oldContent = readGitFile(repoRoot, refs.baselineRef, current.old_path || current.path);
        if (!oldContent) {
            collapsed.push(current);
            continue;
        }
        const renameIdx = remaining.findIndex(candidate => {
            if (candidate.status !== "added") return false;
            const currentExt = extname(current.path || current.old_path || "").toLowerCase();
            const candidateExt = extname(candidate.path || "").toLowerCase();
            if (currentExt !== candidateExt) return false;
            const candidateContent = readWorkingTreeFile(repoRoot, candidate.path);
            return Boolean(candidateContent) && candidateContent === oldContent;
        });
        if (renameIdx === -1) {
            collapsed.push(current);
            continue;
        }
        const renamed = remaining.splice(renameIdx, 1)[0];
        collapsed.push({
            status: "renamed",
            status_code: "R?",
            old_path: current.old_path || current.path,
            path: renamed.path,
        });
    }
    return collapsed;
}

function symbolName(text) {
    const clean = text.replace(/\s*\{?\s*$/, "").trim();
    const noParams = clean.replace(/\(.*$/, "").trim();
    const parts = noParams.split(/\s+/);
    const eqIdx = parts.indexOf("=");
    if (eqIdx > 0) return parts[eqIdx - 1];
    return parts[parts.length - 1] || text;
}

function toSymbolMap(entries = []) {
    const map = new Map();
    for (const entry of entries) {
        const name = entry.name || symbolName(entry.text);
        map.set(name, {
            name,
            text: entry.text,
            start: entry.start,
            end: entry.end,
            lines: entry.end - entry.start + 1,
            fingerprint: entry.fingerprint || null,
        });
    }
    return map;
}

function compareSymbols(beforeEntries = [], afterEntries = []) {
    const beforeMap = toSymbolMap(beforeEntries);
    const afterMap = toSymbolMap(afterEntries);
    const added = [];
    const removed = [];
    const modified = [];

    for (const [name, symbol] of afterMap) {
        if (!beforeMap.has(name)) {
            added.push(symbol);
            continue;
        }
        const oldSymbol = beforeMap.get(name);
        if (
            oldSymbol.lines !== symbol.lines ||
            oldSymbol.text !== symbol.text ||
            oldSymbol.start !== symbol.start ||
            oldSymbol.end !== symbol.end ||
            oldSymbol.fingerprint !== symbol.fingerprint
        ) {
            modified.push({ ...symbol, previous: oldSymbol });
        }
    }

    for (const [name, symbol] of beforeMap) {
        if (!afterMap.has(name)) {
            removed.push(symbol);
        }
    }

    return { added, removed, modified };
}

function readWorkingTreeFile(repoRoot, relPath) {
    const absPath = resolve(repoRoot, relPath);
    if (!existsSync(absPath)) return null;
    return readFileSync(absPath, "utf8").replace(/\r\n/g, "\n");
}

function readGitFile(repoRoot, ref, relPath) {
    if (!ref) return null;
    return runGit(["show", `${ref}:${relPath}`], repoRoot, true);
}

async function buildFileDiff(repoRoot, file, refs) {
    const ext = extname(file.path || file.old_path || "").toLowerCase();
    const semanticSupported = isSupportedExtension(ext);
    const language = languageForExtension(ext);
    if (!semanticSupported) {
        return {
            ...file,
            extension: ext,
            language,
            semantic_supported: false,
            added_symbols: [],
            removed_symbols: [],
            modified_symbols: [],
        };
    }

    const oldContent = file.status === "added"
        ? null
        : readGitFile(repoRoot, refs.baselineRef, file.old_path || file.path);
    const newContent = file.status === "deleted"
        ? null
        : (refs.headRef ? readGitFile(repoRoot, refs.headRef, file.path) : readWorkingTreeFile(repoRoot, file.path));

    const beforeOutline = oldContent ? await outlineFromContent(oldContent, ext) : { entries: [] };
    const afterOutline = newContent ? await outlineFromContent(newContent, ext) : { entries: [] };
    const symbols = compareSymbols(beforeOutline?.entries || [], afterOutline?.entries || []);

    return {
        ...file,
        extension: ext,
        language,
        semantic_supported: true,
        added_symbols: symbols.added,
        removed_symbols: symbols.removed,
        modified_symbols: symbols.modified,
    };
}

export async function semanticGitDiff(targetPath, { baseRef = "HEAD", headRef = null } = {}) {
    const absPath = resolve(targetPath);
    const repoRoot = gitRoot(absPath);
    const cwd = repoCwd(absPath);
    const pathspec = scopePathspec(absPath, repoRoot);
    const refs = compareRefs(baseRef, headRef, cwd);
    const diffArgs = [...refs.diffArgs];
    if (pathspec) diffArgs.push("--", pathspec);
    const changed = mergeWorkingTreeChanges(repoRoot, parseNameStatus(runGit(diffArgs, repoRoot)), refs, pathspec);
    const files = [];
    for (const file of changed) {
        files.push(await buildFileDiff(repoRoot, file, refs));
    }

    const summary = files.reduce((acc, file) => {
        acc.changed_file_count += 1;
        if (file.semantic_supported) acc.semantic_file_count += 1;
        else acc.unsupported_file_count += 1;
        acc.added_symbol_count += file.added_symbols.length;
        acc.removed_symbol_count += file.removed_symbols.length;
        acc.modified_symbol_count += file.modified_symbols.length;
        return acc;
    }, {
        changed_file_count: 0,
        semantic_file_count: 0,
        unsupported_file_count: 0,
        added_symbol_count: 0,
        removed_symbol_count: 0,
        modified_symbol_count: 0,
    });

    return {
        repo_root: repoRoot,
        scope_path: pathspec || ".",
        base_ref: baseRef,
        head_ref: headRef,
        baseline_ref: refs.baselineRef,
        changed_files: files,
        summary,
    };
}
