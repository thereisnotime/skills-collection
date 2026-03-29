/**
 * Hash-verified file editing with diff output.
 *
 * Supports:
 * - set_line / replace_lines / insert_after / replace_between
 * - dry_run preview, noop detection, diff output
 * - optional revision-aware conservative auto-rebase
 */

import { statSync, writeFileSync } from "node:fs";
import { diffLines } from "diff";
import { fnv1a, lineTag, parseChecksum, parseRef } from "@levnikolaevich/hex-common/text-protocol/hash";
import { validatePath, normalizePath } from "./security.mjs";
import { getGraphDB, callImpact, getRelativePath } from "./graph-enrich.mjs";
import { MAX_DIFF_CHARS } from "./format.mjs";
import {
    assertNonOverlappingTargets,
    collectEditTargets,
    normalizeAnchoredEdits,
    sortEditsForApply,
    targetRangeForReplaceBetween,
    validateChecksumCoverage,
} from "./edit-resolution.mjs";
import { createSnapshotEntries, buildEditReadyBlock, serializeReadBlock } from "./block-protocol.mjs";
import {
    buildRangeChecksum,
    computeChangedRanges,
    describeChangedRanges,
    getSnapshotByRevision,
    overlapsChangedRanges,
    readSnapshot,
    rememberSnapshot,
} from "./snapshot.mjs";

/**
 * Restore indentation from original lines onto replacement lines.
 * Preserves relative indentation structure while matching the anchor's indent level.
 */
function restoreIndent(origLines, newLines) {
    if (!origLines.length || !newLines.length) return newLines;
    const origIndent = origLines[0].match(/^\s*/)[0];
    const newIndent = newLines[0].match(/^\s*/)[0];
    if (origIndent === newIndent) return newLines;
    return newLines.map(line => {
        if (!line.trim()) return line;
        if (line.startsWith(newIndent)) return origIndent + line.slice(newIndent.length);
        return line;
    });
}

/**
 * Build hash-annotated snippet around a position for error or conflict messages.
 */
function buildErrorSnippet(lines, centerIdx, radius = 5) {
    const start = Math.max(0, centerIdx - radius);
    const end = Math.min(lines.length, centerIdx + radius + 1);
    const text = lines.slice(start, end).map((line, i) => {
        const num = start + i + 1;
        const tag = lineTag(fnv1a(line));
        return `${tag}.${num}\t${line}`;
    }).join("\n");
    return { start: start + 1, end, text };
}

function stripAnchorOrDiffPrefix(line) {
    let next = line;
    next = next.replace(/^\s*(?:>>|  )?[a-z2-7]{2}\.\d+\t/, "");
    next = next.replace(/^.+:(?:>>|  )[a-z2-7]{2}\.\d+\t/, "");
    next = next.replace(/^[ +-]\d+\|\s?/, "");
    return next;
}

function sanitizeEditText(text) {
    const original = String(text ?? "");
    const hadTrailingNewline = original.endsWith("\n");
    let lines = original.split("\n");
    const nonEmpty = lines.filter((line) => line.length > 0);
    if (nonEmpty.length > 0 && nonEmpty.every((line) => /^\+(?!\+)/.test(line))) {
        lines = lines.map((line) => line.startsWith("+") && !line.startsWith("++") ? line.slice(1) : line);
    }
    lines = lines.map(stripAnchorOrDiffPrefix);
    let cleaned = lines.join("\n");
    if (hadTrailingNewline && !cleaned.endsWith("\n")) cleaned += "\n";
    return cleaned;
}

/**
 * Find line by tag.lineNum reference with fuzzy matching (+-5 lines).
 * Falls back to global hash relocation via hashIndex before throwing.
 */
function findLine(lines, lineNum, expectedTag, hashIndex) {
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) {
        const center = idx >= lines.length ? lines.length - 1 : 0;
        const snip = buildErrorSnippet(lines, center);
        throw new Error(
            `Line ${lineNum} out of range (1-${lines.length}).\n\n` +
            `Current content (lines ${snip.start}-${snip.end}):\n${snip.text}\n\n` +
            `Tip: Use updated hashes above for retry.`
        );
    }

    const actual = lineTag(fnv1a(lines[idx]));
    if (actual === expectedTag) return idx;

    for (let d = 1; d <= 5; d++) {
        for (const off of [d, -d]) {
            const c = idx + off;
            if (c >= 0 && c < lines.length && lineTag(fnv1a(lines[c])) === expectedTag) return c;
        }
    }

    const stripped = lines[idx].replace(/\s+/g, "");
    if (stripped.length > 0) {
        for (let j = Math.max(0, idx - 5); j <= Math.min(lines.length - 1, idx + 5); j++) {
            if (lines[j].replace(/\s+/g, "") === stripped && lineTag(fnv1a(lines[j])) === expectedTag) return j;
        }
    }

    const CONFUSABLE_RE = /[\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]/g;
    const norm = t => t.replace(CONFUSABLE_RE, "-");
    const normalizedExpected = norm(expectedTag);
    for (let i = Math.max(0, idx - 10); i <= Math.min(lines.length - 1, idx + 10); i++) {
        const normalizedActual = norm(lineTag(fnv1a(norm(lines[i]))));
        if (normalizedActual === normalizedExpected) return i;
    }

    if (hashIndex) {
        const relocated = hashIndex.get(expectedTag);
        if (relocated !== undefined) return relocated;
    }

    const snip = buildErrorSnippet(lines, idx);
    throw new Error(
        `HASH_MISMATCH: line ${lineNum} expected ${expectedTag}, got ${actual}.\n\n` +
        `Current content (lines ${snip.start}-${snip.end}):\n${snip.text}\n\n` +
        `Tip: Use updated hashes above for retry.`
    );
}

/**
 * Context diff via `diff` package (Myers O(ND) algorithm).
 * Returns compact hunks with ±ctx context lines, or null if no changes.
 */
export function simpleDiff(oldLines, newLines, ctx = 3) {
    const oldText = oldLines.join("\n") + "\n";
    const newText = newLines.join("\n") + "\n";
    const parts = diffLines(oldText, newText);

    const out = [];
    let oldNum = 1, newNum = 1;
    let lastChange = false;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const lines = part.value.replace(/\n$/, "").split("\n");

        if (part.added || part.removed) {
            for (const line of lines) {
                if (part.removed) { out.push(`-${oldNum}| ${line}`); oldNum++; }
                else { out.push(`+${newNum}| ${line}`); newNum++; }
            }
            lastChange = true;
        } else {
            const next = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
            if (lastChange || next) {
                let start = 0, end = lines.length;
                if (!lastChange) start = Math.max(0, end - ctx);
                if (!next && end - start > ctx) end = start + ctx;
                if (start > 0) { out.push("..."); oldNum += start; newNum += start; }
                for (let k = start; k < end; k++) {
                    out.push(` ${oldNum}| ${lines[k]}`);
                    oldNum++; newNum++;
                }
                if (end < lines.length) {
                    out.push("...");
                    oldNum += lines.length - end;
                    newNum += lines.length - end;
                }
            } else {
                oldNum += lines.length;
                newNum += lines.length;
            }
            lastChange = false;
        }
    }
    return out.length ? out.join("\n") : null;
}

function verifyChecksumAgainstSnapshot(snapshot, rc) {
    const { start, end, hex } = parseChecksum(rc);
    const actual = buildRangeChecksum(snapshot, start, end);
    if (!actual) return { ok: false, actual: null, start, end };
    return { ok: actual.split(":")[1] === hex, actual, start, end };
}

function buildConflictMessage({
    filePath,
    reason,
    revision,
    fileChecksum,
    lines,
    centerIdx,
    changedRanges,
    retryChecksum,
    remaps,
    details,
}) {
    const safeCenter = Math.max(0, Math.min(lines.length - 1, centerIdx));
    const snip = buildErrorSnippet(lines, safeCenter);
    let msg =
        `status: CONFLICT\n` +
        `reason: ${reason}\n` +
        `revision: ${revision}\n` +
        `file: ${fileChecksum}`;
    if (changedRanges) msg += `\nchanged_ranges: ${describeChangedRanges(changedRanges)}`;
    if (retryChecksum) msg += `\nretry_checksum: ${retryChecksum}`;
    if (remaps?.length) msg += `\nremapped_refs:\n${remaps.map(({ from, to }) => `${from} -> ${to}`).join("\n")}`;
    msg += `\n\n${details}\n\nCurrent content (lines ${snip.start}-${snip.end}):\n${snip.text}`;
    msg += `\n\nTip: Retry from the fresh local snippet above.`;
    if (filePath) msg += `\npath: ${filePath}`;
    return msg;
}

function applySetLineEdit(edit, ctx) {
    const { lines, opts, locateOrConflict, ensureRevisionContext } = ctx;
    const { tag, line } = parseRef(edit.set_line.anchor);
    const idx = locateOrConflict({ tag, line });
    if (typeof idx === "string") return idx;
    const conflict = ensureRevisionContext(idx + 1, idx + 1, idx);
    if (conflict) return conflict;

    const txt = edit.set_line.new_text;
    if (!txt && txt !== 0) {
        lines.splice(idx, 1);
        return null;
    }
    const origLine = [lines[idx]];
    const raw = sanitizeEditText(txt).split("\n");
    const newLines = opts.restoreIndent ? restoreIndent(origLine, raw) : raw;
    lines.splice(idx, 1, ...newLines);
    return null;
}

function applyInsertAfterEdit(edit, ctx) {
    const { lines, opts, locateOrConflict, ensureRevisionContext } = ctx;
    const { tag, line } = parseRef(edit.insert_after.anchor);
    const idx = locateOrConflict({ tag, line });
    if (typeof idx === "string") return idx;
    const conflict = ensureRevisionContext(idx + 1, idx + 1, idx);
    if (conflict) return conflict;

    let insertLines = sanitizeEditText(edit.insert_after.text).split("\n");
    if (opts.restoreIndent) insertLines = restoreIndent([lines[idx]], insertLines);
    lines.splice(idx + 1, 0, ...insertLines);
    return null;
}

function applyReplaceLinesEdit(edit, ctx) {
    const {
        baseSnapshot,
        buildStrictChecksumMismatchError,
        conflictIfNeeded,
        currentSnapshot,
        ensureRevisionContext,
        hasBaseSnapshot,
        lines,
        locateOrConflict,
        opts,
        origLines,
        staleRevision,
    } = ctx;
    const startRef = parseRef(edit.replace_lines.start_anchor);
    const endRef = parseRef(edit.replace_lines.end_anchor);
    const startIdx = locateOrConflict(startRef);
    if (typeof startIdx === "string") return startIdx;
    const endIdx = locateOrConflict(endRef);
    if (typeof endIdx === "string") return endIdx;
    const actualStart = startIdx + 1;
    const actualEnd = endIdx + 1;
    const rangeChecksum = edit.replace_lines.range_checksum;
    if (!rangeChecksum) {
        throw new Error("range_checksum required for replace_lines. Read the range first via read_file, then pass its checksum. The checksum range must cover start-to-end anchors (inclusive).");
    }

    if (staleRevision && opts.conflictPolicy === "conservative") {
        const conflict = ensureRevisionContext(actualStart, actualEnd, startIdx);
        if (conflict) return conflict;
        const baseCheck = hasBaseSnapshot ? verifyChecksumAgainstSnapshot(baseSnapshot, rangeChecksum) : null;
        if (!baseCheck?.ok) {
            return conflictIfNeeded(
                "stale_checksum",
                startIdx,
                baseCheck?.actual || null,
                baseCheck?.actual
                    ? `Provided checksum ${rangeChecksum} does not match base revision ${opts.baseRevision}.`
                    : `Checksum range from ${rangeChecksum} is outside the available base revision.`,
            );
        }
    } else {
        const coverage = validateChecksumCoverage(rangeChecksum, actualStart, actualEnd);
        const { start: csStart, end: csEnd, hex: csHex } = parseChecksum(rangeChecksum);
        if (!coverage.ok) {
            const snip = buildErrorSnippet(origLines, actualStart - 1);
            throw new Error(
                `${coverage.reason}\n\n` +
                `Current content (lines ${snip.start}-${snip.end}):\n${snip.text}\n\n` +
                "Tip: Use updated hashes above for retry.",
            );
        }
        const actual = buildRangeChecksum(currentSnapshot, csStart, csEnd);
        const actualHex = actual?.split(":")[1];
        if (!actual || csHex !== actualHex) {
            const details = `CHECKSUM_MISMATCH: expected ${rangeChecksum}, got ${actual}. Content at lines ${csStart}-${csEnd} differs from when you read it.\nRecovery: read_file path ranges=["${csStart}-${csEnd}"], then retry edit with fresh checksum.`;
            if (opts.conflictPolicy === "conservative") {
                return conflictIfNeeded("stale_checksum", csStart - 1, actual, details);
            }
            throw buildStrictChecksumMismatchError(details, csStart, actual);
        }
    }

    const txt = edit.replace_lines.new_text;
    if (!txt && txt !== 0) {
        lines.splice(startIdx, endIdx - startIdx + 1);
        return null;
    }
    const origRange = lines.slice(startIdx, endIdx + 1);
    let newLines = sanitizeEditText(txt).split("\n");
    if (opts.restoreIndent) newLines = restoreIndent(origRange, newLines);
    lines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
    return null;
}

function applyReplaceBetweenEdit(edit, ctx) {
    const { lines, opts, locateOrConflict, ensureRevisionContext } = ctx;
    const boundaryMode = edit.replace_between.boundary_mode || "inclusive";
    if (boundaryMode !== "inclusive" && boundaryMode !== "exclusive") {
        throw new Error(`BAD_INPUT: replace_between boundary_mode must be inclusive or exclusive, got ${boundaryMode}`);
    }
    const startRef = parseRef(edit.replace_between.start_anchor);
    const endRef = parseRef(edit.replace_between.end_anchor);
    const startIdx = locateOrConflict(startRef);
    if (typeof startIdx === "string") return startIdx;
    const endIdx = locateOrConflict(endRef);
    if (typeof endIdx === "string") return endIdx;
    if (startIdx > endIdx) {
        throw new Error(`BAD_INPUT: replace_between start anchor resolves after end anchor (${startIdx + 1} > ${endIdx + 1})`);
    }

    const targetRange = targetRangeForReplaceBetween(startIdx, endIdx, boundaryMode);
    const conflict = ensureRevisionContext(targetRange.start, targetRange.end, startIdx);
    if (conflict) return conflict;

    const txt = edit.replace_between.new_text;
    let newLines = sanitizeEditText(txt ?? "").split("\n");
    const sliceStart = boundaryMode === "exclusive" ? startIdx + 1 : startIdx;
    const removeCount = boundaryMode === "exclusive" ? Math.max(0, endIdx - startIdx - 1) : (endIdx - startIdx + 1);
    const origRange = lines.slice(sliceStart, sliceStart + removeCount);
    if (opts.restoreIndent && origRange.length > 0) newLines = restoreIndent(origRange, newLines);
    if (txt === "" || txt === null) newLines = [];
    lines.splice(sliceStart, removeCount, ...newLines);
    return null;
}

/**
 * Apply edits to a file.
 *
 * @param {string} filePath
 * @param {Array} edits - parsed edit objects
 * @param {object} opts - { dryRun, restoreIndent, baseRevision, conflictPolicy }
 * @returns {string} result message with diff
 */
export function editFile(filePath, edits, opts = {}) {
    filePath = normalizePath(filePath);
    const real = validatePath(filePath);
    const currentSnapshot = readSnapshot(real);
    const baseSnapshot = opts.baseRevision ? getSnapshotByRevision(opts.baseRevision) : null;
    const hasBaseSnapshot = !!(baseSnapshot && baseSnapshot.path === real);
    const staleRevision = !!opts.baseRevision && opts.baseRevision !== currentSnapshot.revision;
    const changedRanges = staleRevision && hasBaseSnapshot
        ? computeChangedRanges(baseSnapshot.lines, currentSnapshot.lines)
        : [];
    const conflictPolicy = opts.conflictPolicy || "conservative";

    const original = currentSnapshot.content;
    const lines = [...currentSnapshot.lines];
    const origLines = [...currentSnapshot.lines];
    const hadTrailingNewline = original.endsWith("\n");
    const hashIndex = currentSnapshot.uniqueTagIndex;
    let autoRebased = false;
    const remaps = [];
    const remapKeys = new Set();

    const anchored = normalizeAnchoredEdits(edits);
    assertNonOverlappingTargets(collectEditTargets(anchored));
    const sorted = sortEditsForApply(anchored);

    const conflictIfNeeded = (reason, centerIdx, retryChecksum, details) => {
        if (conflictPolicy !== "conservative") {
            throw new Error(details);
        }
        return buildConflictMessage({
            filePath,
            reason,
            revision: currentSnapshot.revision,
            fileChecksum: currentSnapshot.fileChecksum,
            lines,
            centerIdx,
            changedRanges: staleRevision && hasBaseSnapshot ? changedRanges : null,
            retryChecksum,
            remaps,
            details,
        });
    };

    const trackRemap = (ref, idx) => {
        const actualRef = `${lineTag(fnv1a(lines[idx]))}.${idx + 1}`;
        const expectedRef = `${ref.tag}.${ref.line}`;
        if (actualRef === expectedRef) return;
        const key = `${expectedRef}->${actualRef}`;
        if (remapKeys.has(key)) return;
        remapKeys.add(key);
        remaps.push({ from: expectedRef, to: actualRef });
    };

    const locateOrConflict = (ref, reason = "stale_anchor") => {
        try {
            const idx = findLine(lines, ref.line, ref.tag, hashIndex);
            trackRemap(ref, idx);
            return idx;
        } catch (e) {
            if (conflictPolicy !== "conservative" || !staleRevision) throw e;
            const centerIdx = Math.max(0, Math.min(lines.length - 1, ref.line - 1));
            return conflictIfNeeded(reason, centerIdx, null, e.message);
        }
    };

    const ensureRevisionContext = (actualStart, actualEnd, centerIdx) => {
        if (!staleRevision || conflictPolicy !== "conservative") return null;
        if (!hasBaseSnapshot) {
            return conflictIfNeeded(
                "base_revision_evicted",
                centerIdx,
                null,
                `Base revision ${opts.baseRevision} is not available in the local revision cache. Recovery: re-read the file with read_file to get a fresh revision, then retry.`
            );
        }
        if (overlapsChangedRanges(changedRanges, actualStart, actualEnd)) {
            return conflictIfNeeded(
                "overlap",
                centerIdx,
                null,
                `Changes since ${opts.baseRevision} overlap edit range ${actualStart}-${actualEnd}. Recovery: re-read lines ${actualStart}-${actualEnd} with read_file, then retry with fresh anchors and checksum.`
            );
        }
        autoRebased = true;
        return null;
    };

    const buildStrictChecksumMismatchError = (details, checksumStart, actual) => {
        const snip = buildErrorSnippet(origLines, checksumStart - 1);
        return new Error(
            `${details}\n\n` +
            `Current content (lines ${snip.start}-${snip.end}):\n${snip.text}\n\n` +
            `Retry with fresh checksum ${actual}, or use set_line with hashes above.`,
        );
    };

    const editContext = {
        baseSnapshot,
        buildStrictChecksumMismatchError,
        conflictIfNeeded,
        currentSnapshot,
        ensureRevisionContext,
        hasBaseSnapshot,
        lines,
        locateOrConflict,
        opts,
        origLines,
        staleRevision,
    };

    for (let _ei = 0; _ei < sorted.length; _ei++) {
        const e = sorted[_ei];
        try {
            let conflictResult = null;
            if (e.set_line) conflictResult = applySetLineEdit(e, editContext);
            else if (e.insert_after) conflictResult = applyInsertAfterEdit(e, editContext);
            else if (e.replace_lines) conflictResult = applyReplaceLinesEdit(e, editContext);
            else if (e.replace_between) conflictResult = applyReplaceBetweenEdit(e, editContext);
            if (typeof conflictResult === "string") return conflictResult;
        } catch (editErr) {
            if (sorted.length > 1) editErr.message = `Edit ${_ei + 1}/${sorted.length}: ${editErr.message}`;
            throw editErr;
        }
    }

    let content = lines.join("\n");
    if (hadTrailingNewline && !content.endsWith("\n")) content += "\n";
    if (!hadTrailingNewline && content.endsWith("\n")) content = content.slice(0, -1);

    if (original === content) {
        throw new Error("NOOP_EDIT: File already contains the desired content. No changes needed.");
    }


    const fullDiff = simpleDiff(origLines, content.split("\n"));
    let displayDiff = fullDiff;
    if (displayDiff && displayDiff.length > MAX_DIFF_CHARS) {
        displayDiff = displayDiff.slice(0, MAX_DIFF_CHARS) + `\n... (diff truncated, ${displayDiff.length} chars total)`;
    }

    // Compute changed line range from fullDiff (used by post-edit + call impact)
    const newLinesAll = content.split("\n");
    let minLine = Infinity, maxLine = 0;
    if (fullDiff) {
        for (const dl of fullDiff.split("\n")) {
            const m = dl.match(/^[+-](\d+)\|/);
            if (m) {
                const n = +m[1];
                if (n < minLine) minLine = n;
                if (n > maxLine) maxLine = n;
            }
        }
    }

    if (opts.dryRun) {
        let msg = `status: ${autoRebased ? "AUTO_REBASED" : "OK"}\nrevision: ${currentSnapshot.revision}\nfile: ${currentSnapshot.fileChecksum}\nDry run: ${filePath} would change (${content.split("\n").length} lines)`;
        if (staleRevision && hasBaseSnapshot) msg += `\nchanged_ranges: ${describeChangedRanges(changedRanges)}`;
        if (displayDiff) msg += `\n\nDiff:\n\`\`\`diff\n${displayDiff}\n\`\`\``;
        return msg;
    }

    writeFileSync(real, content, "utf-8");
    const nextStat = statSync(real);
    const nextSnapshot = rememberSnapshot(real, content, { mtimeMs: nextStat.mtimeMs, size: nextStat.size });
    let msg =
        `status: ${autoRebased ? "AUTO_REBASED" : "OK"}\n` +
        `revision: ${nextSnapshot.revision}\n` +
        `file: ${nextSnapshot.fileChecksum}`;
    if (autoRebased && staleRevision && hasBaseSnapshot) {
        msg += `\nchanged_ranges: ${describeChangedRanges(changedRanges)}`;
    }
    if (remaps.length > 0) {
        msg += `\nremapped_refs:\n${remaps.map(({ from, to }) => `${from} -> ${to}`).join("\n")}`;
    }
    msg += `\nUpdated ${filePath} (${content.split("\n").length} lines)`;

    // Post-edit context (before diff — always visible even if output truncated)
    if (fullDiff && minLine <= maxLine) {
        const ctxStart = Math.max(0, minLine - 6) + 1; // 1-indexed for snapshot
        const ctxEnd = Math.min(newLinesAll.length, maxLine + 5);
        const entries = createSnapshotEntries(nextSnapshot, ctxStart, ctxEnd);
        if (entries.length > 0) {
            const block = buildEditReadyBlock({ path: real, kind: "post_edit", entries });
            msg += `\n\n${serializeReadBlock(block)}`;
        }
    }

    // Call impact (before diff — usually visible)
    try {
        const db = getGraphDB(real);
        const relFile = db ? getRelativePath(real) : null;
        if (db && relFile && fullDiff && minLine <= maxLine) {
            const affected = callImpact(db, relFile, minLine, maxLine);
            if (affected.length > 0) {
                const list = affected.map(a => `${a.name} (${a.file}:${a.line})`).join(", ");
                msg += `\n\n\u26a0 Call impact: ${affected.length} callers in other files\n  ${list}`;
            }
        }
    } catch { /* silent */ }

    // Diff (last — safe to truncate by Claude Code)
    if (displayDiff) msg += `\n\nDiff:\n\`\`\`diff\n${displayDiff}\n\`\`\``;

    return msg;
}
