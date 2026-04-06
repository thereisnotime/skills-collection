import { readFileSync } from "node:fs";

function classifyEol(counts) {
    const active = Object.entries(counts).filter(([, count]) => count > 0);
    if (active.length === 0) return "none";
    if (active.length === 1) return active[0][0];
    return "mixed";
}

function chooseDefaultEol(lineEndings, counts) {
    const active = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]);
    if (active.length === 0) return "\n";
    if (active.length === 1 || active[0][1] > active[1][1]) {
        return active[0][0] === "crlf" ? "\r\n" : active[0][0] === "cr" ? "\r" : "\n";
    }
    const firstSeen = lineEndings.find((ending) => ending);
    return firstSeen || "\n";
}

export function normalizeSourceText(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function parseUtf8TextWithMetadata(text) {
    const lines = [];
    const lineEndings = [];
    const eolCounts = { lf: 0, crlf: 0, cr: 0 };

    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === "\r") {
            const isCrlf = text[i + 1] === "\n";
            lines.push(text.slice(start, i));
            lineEndings.push(isCrlf ? "\r\n" : "\r");
            if (isCrlf) {
                eolCounts.crlf++;
                i++;
            } else {
                eolCounts.cr++;
            }
            start = i + 1;
            continue;
        }
        if (ch === "\n") {
            lines.push(text.slice(start, i));
            lineEndings.push("\n");
            eolCounts.lf++;
            start = i + 1;
        }
    }

    lines.push(text.slice(start));
    lineEndings.push("");

    const trailingNewline = text.endsWith("\n") || text.endsWith("\r");

    return {
        rawText: text,
        content: normalizeSourceText(text),
        lines,
        lineEndings,
        trailingNewline,
        eol: classifyEol(eolCounts),
        defaultEol: chooseDefaultEol(lineEndings, eolCounts),
    };
}

export function readUtf8Normalized(filePath) {
    return parseUtf8TextWithMetadata(readFileSync(filePath, "utf-8")).content;
}

export function readUtf8WithMetadata(filePath) {
    return parseUtf8TextWithMetadata(readFileSync(filePath, "utf-8"));
}
