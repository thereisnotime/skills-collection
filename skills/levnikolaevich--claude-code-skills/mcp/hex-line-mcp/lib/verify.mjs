/**
 * Canonical checksum verification against the snapshot kernel.
 * Reports valid/stale/invalid checksum state deterministically.
 */

import { parseChecksum } from "@levnikolaevich/hex-common/text-protocol/hash";
import { validatePath, normalizePath } from "./security.mjs";
import {
    buildRangeChecksum,
    computeChangedRanges,
    describeChangedRanges,
    getSnapshotByRevision,
    readSnapshot,
} from "./snapshot.mjs";

function parseChecksumEntry(raw) {
    try {
        return { ok: true, raw, parsed: parseChecksum(raw) };
    } catch (error) {
        return {
            ok: false,
            raw,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function classifyChecksum(currentSnapshot, entry) {
    if (!entry.ok) {
        return {
            status: "INVALID",
            checksum: entry.raw,
            span: null,
            currentChecksum: null,
            reason: `invalid checksum format: ${entry.error}`,
        };
    }
    const { start, end } = entry.parsed;
    if (start < 1 || end < start) {
        return {
            status: "INVALID",
            checksum: entry.raw,
            span: `${start}-${end}`,
            currentChecksum: null,
            reason: `invalid range ${start}-${end}`,
        };
    }
    if (end > currentSnapshot.lines.length) {
        return {
            status: "INVALID",
            checksum: entry.raw,
            span: `${start}-${end}`,
            currentChecksum: null,
            reason: `range ${start}-${end} exceeds file length ${currentSnapshot.lines.length}`,
        };
    }
    const currentChecksum = buildRangeChecksum(currentSnapshot, start, end);
    if (currentChecksum === entry.raw) {
        return {
            status: "VALID",
            checksum: entry.raw,
            span: `${start}-${end}`,
            currentChecksum,
            reason: null,
        };
    }
    return {
        status: "STALE",
        checksum: entry.raw,
        span: `${start}-${end}`,
        currentChecksum,
        reason: `content changed since the checksum was captured. Recovery: read_file ranges=["${start}-${end}"] to get fresh content.`,
    };
}

function summarizeStatuses(entries) {
    return entries.reduce((acc, entry) => {
        const key = entry.status.toLowerCase();
        acc[key] += 1;
        return acc;
    }, { valid: 0, stale: 0, invalid: 0 });
}

function renderEntry(entry) {
    const base = `checksum: ${entry.checksum}`;
    if (entry.status === "VALID") {
        return `${entry.status} ${entry.span} ${base}`;
    }
    if (entry.status === "STALE") {
        return `${entry.status} ${entry.span} ${base} current=${entry.currentChecksum} | re-read to refresh`;
    }
    return `${entry.status}${entry.span ? ` ${entry.span}` : ""} ${base} reason=${entry.reason}`;
}

export function verifyChecksums(filePath, checksums, opts = {}) {
    filePath = normalizePath(filePath);
    const real = validatePath(filePath);
    const currentSnapshot = readSnapshot(real);
    const baseSnapshot = opts.baseRevision ? getSnapshotByRevision(opts.baseRevision) : null;
    const hasBaseSnapshot = !!(baseSnapshot && baseSnapshot.path === real);
    const parsedEntries = (checksums || []).map(parseChecksumEntry);
    const results = parsedEntries.map(entry => classifyChecksum(currentSnapshot, entry));
    const summary = summarizeStatuses(results);
    const status = summary.invalid > 0 ? "INVALID"
        : summary.stale > 0 ? "STALE"
            : "OK";
    const lines = [
        `status: ${status}`,
        `revision: ${currentSnapshot.revision}`,
        `file: ${currentSnapshot.fileChecksum}`,
        `summary: valid=${summary.valid} stale=${summary.stale} invalid=${summary.invalid}`,
    ];

    if (opts.baseRevision) {
        lines.push(`base_revision: ${opts.baseRevision}`);
        if (hasBaseSnapshot) {
            lines.push(`changed_ranges: ${describeChangedRanges(computeChangedRanges(baseSnapshot.lines, currentSnapshot.lines))}`);
        } else {
            lines.push("base_revision_status: evicted");
        }
    }

    if (results.length > 0) {
        lines.push("", ...results.map(renderEntry));
    }

    return lines.join("\n");
}
