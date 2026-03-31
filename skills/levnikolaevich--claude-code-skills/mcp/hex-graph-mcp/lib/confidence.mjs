const CONFIDENCE_ORDER = new Map([
    ["low", 0],
    ["heuristic", 0],
    ["namespace", 1],
    ["inferred", 1],
    ["exact", 2],
    ["precise", 3],
]);

const ORIGIN_ORDER = new Map([
    ["unresolved", 0],
    ["external", 1],
    ["parsed", 2],
    ["resolved", 3],
    ["workspace_resolved", 3],
    ["precise_php", 4],
    ["precise_py", 4],
    ["precise_cs", 4],
    ["precise_ts", 4],
]);

export const CONFIDENCE_VALUES = ["low", "inferred", "exact", "precise"];

export function normalizeConfidence(value) {
    if (typeof value !== "string" || value.length === 0) return "low";
    return CONFIDENCE_ORDER.has(value) ? value : "low";
}

export function confidenceRank(value) {
    return CONFIDENCE_ORDER.get(normalizeConfidence(value)) ?? 0;
}

export function originRank(value) {
    if (typeof value !== "string" || value.length === 0) return 0;
    return ORIGIN_ORDER.get(value) ?? 0;
}

export function compareConfidence(left, right) {
    return confidenceRank(left) - confidenceRank(right);
}

export function confidenceAtLeast(value, minConfidence) {
    if (!minConfidence) return true;
    return confidenceRank(value) >= confidenceRank(minConfidence);
}

export function compareEvidenceStrength(left, right) {
    const confidenceDelta = compareConfidence(left?.confidence, right?.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;
    return originRank(left?.origin) - originRank(right?.origin);
}

export function dedupeStrongest(rows, keyFn) {
    const bestByKey = new Map();
    for (const row of rows) {
        const key = keyFn(row);
        const current = bestByKey.get(key);
        if (!current || compareEvidenceStrength(current, row) < 0) {
            bestByKey.set(key, row);
        }
    }
    return [...bestByKey.values()];
}
