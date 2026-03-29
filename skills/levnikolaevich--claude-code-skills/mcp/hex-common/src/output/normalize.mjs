const NORM_RULES = [
    [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>"],
    [/\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/g, "<TS>"],
    [/\d{2}-\d{2}-\d{4}\s\d{2}:\d{2}:\d{2}/g, "<TS>"],
    [/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/g, "<IP>"],
    [/\/[0-9a-f]{8,}/gi, "/<ID>"],
    [/\b\d{3,}(?=\b|[a-zA-Z])/g, "<N>"],
    [/trace_id=[0-9a-fA-F]{1,8}/g, "trace_id=<TRACE>"],
];

function normalizeLine(line) {
    let result = line;
    for (const [rx, repl] of NORM_RULES) {
        result = result.replace(rx, repl);
    }
    return result;
}

export function deduplicateLines(lines) {
    const groups = new Map();
    const order = [];
    for (const line of lines) {
        const norm = normalizeLine(line);
        if (groups.has(norm)) groups.get(norm).count++;
        else {
            groups.set(norm, { representative: line, count: 1 });
            order.push(norm);
        }
    }
    order.sort((a, b) => groups.get(b).count - groups.get(a).count);
    return order.map(norm => {
        const { representative, count } = groups.get(norm);
        return count > 1 ? `${representative}  (x${count})` : representative;
    });
}

export function smartTruncate(text, headLines = 40, tailLines = 20) {
    const lines = text.split("\n");
    const total = lines.length;
    const maxLines = headLines + tailLines;
    if (total <= maxLines) return text;
    const head = lines.slice(0, headLines);
    const tail = lines.slice(total - tailLines);
    const skipped = total - maxLines;
    return [...head, `\n--- ${skipped} lines omitted ---\n`, ...tail].join("\n");
}

export function normalizeOutput(text, opts = {}) {
    const { deduplicate = true, headLines = 40, tailLines = 20 } = opts;
    const lines = text.split("\n");
    const processed = deduplicate ? deduplicateLines(lines) : lines;
    return smartTruncate(processed.join("\n"), headLines, tailLines);
}
