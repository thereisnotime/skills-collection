/**
 * File read over the canonical edit-ready block protocol.
 */

import { statSync } from "node:fs";
import { validatePath, normalizePath } from "./security.mjs";
import { getGraphDB, fileAnnotations, getRelativePath } from "./graph-enrich.mjs";
import { formatSize, relativeTime, listDirectory, MAX_OUTPUT_CHARS } from "./format.mjs";
import { readSnapshot } from "./snapshot.mjs";
import {
    buildDiagnosticBlock,
    buildEditReadyBlock,
    createSnapshotEntries,
    serializeDiagnosticBlock,
    serializeReadBlock,
    serializeReadEntry,
} from "./block-protocol.mjs";

const DEFAULT_LIMIT = 2000;

function parseRangeEntry(entry, total) {
    if (typeof entry === "string") {
        const match = entry.trim().match(/^(\d+)(?:-(\d*)?)?$/);
        if (!match) throw new Error(`Invalid range "${entry}". Use "10", "10-25", or "10-"`);
        const start = Number(match[1]);
        const end = match[2] === undefined || match[2] === "" ? total : Number(match[2]);
        return { start, end };
    }

    if (!entry || typeof entry !== "object") {
        throw new Error("ranges entries must be strings or {start,end} objects");
    }

    const start = Number(entry.start ?? 1);
    const end = entry.end === undefined || entry.end === null ? total : Number(entry.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new Error("ranges entries must contain numeric start/end values");
    }
    return { start, end };
}

function normalizeRange(entry, total) {
    const parsed = parseRangeEntry(entry, total);
    if (!Number.isInteger(parsed.start) || !Number.isInteger(parsed.end)) {
        throw new Error("ranges entries must resolve to integer start/end values");
    }
    if (parsed.start > parsed.end) {
        return buildDiagnosticBlock({
            kind: "invalid_range",
            message: `Requested range ${parsed.start}-${parsed.end} has start greater than end.`,
            requestedStartLine: parsed.start,
            requestedEndLine: parsed.end,
        });
    }
    if (parsed.end < 1 || parsed.start > total) {
        return buildDiagnosticBlock({
            kind: "invalid_range",
            message: `Requested range ${parsed.start}-${parsed.end} is outside file length ${total}.`,
            requestedStartLine: parsed.start,
            requestedEndLine: parsed.end,
        });
    }
    return {
        requestedStartLine: parsed.start,
        requestedEndLine: parsed.end,
        startLine: Math.max(1, parsed.start),
        endLine: Math.min(total, parsed.end),
    };
}

function buildReadBlock(snapshot, range, plain, remainingChars) {
    const entries = [];
    let nextBudget = remainingChars;
    let cappedAtLine = 0;
    for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber++) {
        const entry = createSnapshotEntries(snapshot, lineNumber, lineNumber)[0];
        const rendered = serializeReadEntry(entry, { plain });
        const nextCost = rendered.length + 1;
        if (entries.length > 0 && nextBudget - nextCost < 0) {
            cappedAtLine = lineNumber;
            break;
        }
        entries.push(entry);
        nextBudget -= nextCost;
    }
    if (entries.length === 0) {
        const entry = createSnapshotEntries(snapshot, range.startLine, range.startLine)[0];
        entries.push(entry);
        nextBudget -= serializeReadEntry(entry, { plain }).length + 1;
        if (range.endLine > range.startLine) cappedAtLine = range.startLine + 1;
    }
    return {
        block: buildEditReadyBlock({
            path: snapshot.path,
            kind: "read_range",
            entries,
            requestedStartLine: range.requestedStartLine,
            requestedEndLine: range.requestedEndLine,
        }),
        remainingChars: nextBudget,
        cappedAtLine,
    };
}

export function readFile(filePath, opts = {}) {
    filePath = normalizePath(filePath);
    const real = validatePath(filePath);
    const stat = statSync(real);

    // Directory listing fallback
    if (stat.isDirectory()) {
        const { text } = listDirectory(real, { metadata: true });
        return `Directory: ${filePath}\n\n\`\`\`\n${text}\n\`\`\``;
    }

    const snapshot = readSnapshot(real);
    const total = snapshot.lines.length;

    let requestedRanges;
    if (opts.ranges && opts.ranges.length > 0) {
        requestedRanges = opts.ranges;
    } else {
        const startLine = Math.max(1, opts.offset || 1);
        const maxLines = (opts.limit && opts.limit > 0) ? opts.limit : DEFAULT_LIMIT;
        requestedRanges = [{ start: startLine, end: Math.min(total, startLine - 1 + maxLines) }];
    }

    const blocks = [];
    const diagnostics = [];
    let remainingChars = MAX_OUTPUT_CHARS;
    let cappedAtLine = 0;
    for (const requested of requestedRanges) {
        const normalized = normalizeRange(requested, total);
        if (normalized.type === "diagnostic_block") {
            diagnostics.push(normalized);
            continue;
        }
        const built = buildReadBlock(snapshot, normalized, opts.plain, remainingChars);
        blocks.push(built.block);
        remainingChars = built.remainingChars;
        if (built.cappedAtLine) {
            cappedAtLine = built.cappedAtLine;
            diagnostics.push(buildDiagnosticBlock({
                kind: "output_capped",
                message: `OUTPUT_CAPPED at line ${built.cappedAtLine} (${MAX_OUTPUT_CHARS} char limit). Use offset=${built.cappedAtLine} to continue reading.`,
                requestedStartLine: built.cappedAtLine,
                requestedEndLine: built.cappedAtLine,
                startLine: built.block.startLine,
                endLine: built.block.endLine,
            }));
            break;
        }
    }

    const sizeText = formatSize(stat.size);
    const ago = relativeTime(stat.mtime);
    let meta = `${total} lines, ${sizeText}, ${ago}`;
    if (requestedRanges.length === 1 && blocks.length === 1) {
        const block = blocks[0];
        if (block.startLine > 1 || block.endLine < total) {
            meta += `, showing ${block.startLine}-${block.endLine}`;
        }
        if (block.endLine < total) {
            meta += `, ${total - block.endLine} more below`;
        }
    }

    const db = opts.includeGraph ? getGraphDB(real) : null;
    const relFile = db ? getRelativePath(real) : null;
    let graphLine = "";
    if (db && relFile) {
        const annos = fileAnnotations(db, relFile);
        if (annos.length > 0) {
            const items = annos.map(a => {
                const counts = (a.callees || a.callers) ? ` ${a.callees}\u2193 ${a.callers}\u2191` : "";
                return `${a.name} [${a.kind}${counts}]`;
            });
            graphLine = `\nGraph: ${items.join(" | ")}`;
        }
    }

    const serializedBlocks = [
        ...blocks.map(block => serializeReadBlock(block, { plain: opts.plain })),
        ...diagnostics.map(block => serializeDiagnosticBlock(block)),
    ];
    if (cappedAtLine && serializedBlocks.length === 0) {
        serializedBlocks.push(serializeDiagnosticBlock(buildDiagnosticBlock({
            kind: "output_capped",
            message: `OUTPUT_CAPPED at line ${cappedAtLine} (${MAX_OUTPUT_CHARS} char limit). Use offset=${cappedAtLine} to continue reading.`,
            requestedStartLine: cappedAtLine,
            requestedEndLine: cappedAtLine,
        })));
    }
    return `File: ${filePath}${graphLine}\nmeta: ${meta}\nrevision: ${snapshot.revision}\nfile: ${snapshot.fileChecksum}\n\n${serializedBlocks.join("\n\n")}`.trim();
}
