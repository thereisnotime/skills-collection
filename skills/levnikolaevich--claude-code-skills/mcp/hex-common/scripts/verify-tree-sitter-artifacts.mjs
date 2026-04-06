import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = resolve(rootDir, "artifacts", "tree-sitter");
const manifestPath = resolve(artifactDir, "manifest.json");

if (!existsSync(manifestPath)) {
    throw new Error(`Missing tree-sitter artifact manifest at ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const entry of manifest.grammars || []) {
    const filePath = resolve(artifactDir, entry.file);
    if (!existsSync(filePath)) {
        throw new Error(`Missing tree-sitter artifact ${entry.file}`);
    }
    const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
    if (digest !== entry.sha256) {
        throw new Error(`Hash mismatch for ${entry.file}: expected ${entry.sha256}, got ${digest}`);
    }
}

console.log(`Verified ${(manifest.grammars || []).length} tree-sitter grammar artifacts.`);
