import { readFileSync } from "node:fs";

export function normalizeSourceText(text) {
    return text.replace(/\r\n/g, "\n");
}

export function readUtf8Normalized(filePath) {
    return normalizeSourceText(readFileSync(filePath, "utf-8"));
}
