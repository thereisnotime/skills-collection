/**
 * Deterministic edit-resolution helpers for edit_file.
 *
 * These helpers keep planning and overlap validation separate from the
 * line-location/apply phase so the edit pipeline stays explicit:
 * parse -> plan -> validate -> order -> apply.
 */

import { parseChecksum, parseRef } from "@levnikolaevich/hex-common/text-protocol/hash";

export function normalizeAnchoredEdits(edits) {
    const anchored = [];
    for (const edit of edits) {
        if (edit.set_line || edit.replace_lines || edit.insert_after || edit.replace_between) {
            anchored.push(edit);
            continue;
        }
        if (edit.replace) {
            throw new Error("REPLACE_REMOVED: replace is no longer supported in edit_file. Use set_line/replace_lines for single edits, bulk_replace tool for rename/refactor.");
        }
        throw new Error(`BAD_INPUT: unknown edit type: ${JSON.stringify(edit)}`);
    }
    return anchored;
}

export function getEditStartLine(edit) {
    if (edit.set_line) return parseRef(edit.set_line.anchor).line;
    if (edit.replace_lines) return parseRef(edit.replace_lines.start_anchor).line;
    if (edit.insert_after) return parseRef(edit.insert_after.anchor).line;
    if (edit.replace_between) return parseRef(edit.replace_between.start_anchor).line;
    throw new Error(`BAD_INPUT: unsupported edit shape: ${JSON.stringify(edit)}`);
}

export function collectEditTargets(edits) {
    return edits.map((edit) => {
        if (edit.set_line) {
            const line = parseRef(edit.set_line.anchor).line;
            return { start: line, end: line, insert: false, kind: "set_line" };
        }
        if (edit.replace_lines) {
            const start = parseRef(edit.replace_lines.start_anchor).line;
            const end = parseRef(edit.replace_lines.end_anchor).line;
            return { start, end, insert: false, kind: "replace_lines" };
        }
        if (edit.insert_after) {
            const line = parseRef(edit.insert_after.anchor).line;
            return { start: line, end: line, insert: true, kind: "insert_after" };
        }
        if (edit.replace_between) {
            const start = parseRef(edit.replace_between.start_anchor).line;
            const end = parseRef(edit.replace_between.end_anchor).line;
            return { start, end, insert: false, kind: "replace_between" };
        }
        throw new Error(`BAD_INPUT: unsupported edit shape: ${JSON.stringify(edit)}`);
    });
}

export function assertNonOverlappingTargets(targets) {
    for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
            const a = targets[i];
            const b = targets[j];
            if (a.insert || b.insert) continue;
            if (a.start <= b.end && b.start <= a.end) {
                throw new Error(
                    `OVERLAPPING_EDITS: lines ${a.start}-${a.end} and ${b.start}-${b.end} overlap. Split into separate edit_file calls.`,
                );
            }
        }
    }
}

export function sortEditsForApply(edits) {
    return edits
        .map(edit => ({ ...edit, _k: getEditStartLine(edit) }))
        .sort((a, b) => b._k - a._k);
}

export function targetRangeForReplaceBetween(startIdx, endIdx, boundaryMode) {
    if (boundaryMode === "exclusive") {
        return { start: startIdx + 2, end: Math.max(startIdx + 1, endIdx) };
    }
    return { start: startIdx + 1, end: endIdx + 1 };
}

export function validateChecksumCoverage(rangeChecksum, actualStart, actualEnd) {
    const { start, end } = parseChecksum(rangeChecksum);
    if (start > actualStart || end < actualEnd) {
        return {
            ok: false,
            start,
            end,
            reason: `CHECKSUM_RANGE_GAP: checksum covers lines ${start}-${end} but edit spans ${actualStart}-${actualEnd} (inclusive). Checksum range must fully contain the anchor range.`,
        };
    }
    return { ok: true, start, end, reason: null };
}
