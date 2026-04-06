import { extname } from "node:path";

import { PositionEncoding } from "./vendor/scip_pb.js";

export const SCIP_EXPORT_LANGUAGES = ["typescript", "python", "php", "csharp"];
export const SCIP_IMPORT_LANGUAGES = new Set(["javascript", "typescript", "python", "php", "csharp"]);

const LANGUAGE_ALIASES = new Map([
    ["javascript", "javascript"],
    ["javascriptreact", "javascript"],
    ["js", "javascript"],
    ["jsreact", "javascript"],
    ["typescript", "typescript"],
    ["typescriptreact", "typescript"],
    ["ts", "typescript"],
    ["tsreact", "typescript"],
    ["python", "python"],
    ["py", "python"],
    ["php", "php"],
    ["csharp", "csharp"],
    ["c#", "csharp"],
    ["cs", "csharp"],
    ["visualbasic", "visualbasic"],
    ["visualbasic.net", "visualbasic"],
    ["vb", "visualbasic"],
]);

const POSITION_ENCODING_NAMES = new Map(Object.entries(PositionEncoding)
    .filter(([, value]) => Number.isInteger(value))
    .map(([name, value]) => [value, name]));

export function normalizeScipLanguage(value) {
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s._-]+/g, "");
    return LANGUAGE_ALIASES.get(normalized) || normalized || null;
}

export function isSupportedImportLanguage(value) {
    const normalized = normalizeScipLanguage(value);
    return normalized ? SCIP_IMPORT_LANGUAGES.has(normalized) : false;
}

export function supportedImportLanguageForDocument(document) {
    const normalized = normalizeScipLanguage(document?.language);
    if (normalized && SCIP_IMPORT_LANGUAGES.has(normalized)) {
        return normalized;
    }
    const fromPath = normalizeScipLanguage(scipLanguageForFile(document?.relativePath || ""));
    return fromPath && SCIP_IMPORT_LANGUAGES.has(fromPath) ? fromPath : null;
}

export function positionEncodingName(value) {
    return POSITION_ENCODING_NAMES.get(value) || `UNKNOWN_${value}`;
}

export function defaultPositionEncodingForLanguage(language) {
    switch (normalizeScipLanguage(language)) {
    case "python":
        return PositionEncoding.UTF32CodeUnitOffsetFromLineStart;
    case "php":
        return PositionEncoding.UTF8CodeUnitOffsetFromLineStart;
    case "csharp":
    case "javascript":
    case "typescript":
    default:
        return PositionEncoding.UTF16CodeUnitOffsetFromLineStart;
    }
}

export function scipLanguageForFile(filePath) {
    switch (extname(filePath).toLowerCase()) {
    case ".tsx":
        return "TypeScriptReact";
    case ".ts":
    case ".cts":
    case ".mts":
        return "TypeScript";
    case ".jsx":
        return "JavaScriptReact";
    case ".js":
    case ".cjs":
    case ".mjs":
        return "JavaScript";
    case ".py":
        return "Python";
    case ".php":
        return "PHP";
    case ".cs":
        return "C#";
    case ".vb":
        return "VisualBasic";
    default:
        return "Unknown";
    }
}
