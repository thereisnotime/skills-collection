import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let parserInstance = null;
const languageCache = new Map();
const moduleDir = dirname(fileURLToPath(import.meta.url));
const artifactDirCandidates = [
    resolve(moduleDir, "../../artifacts/tree-sitter"),
    resolve(moduleDir, "../artifacts/tree-sitter"),
    resolve(moduleDir, "./artifacts/tree-sitter"),
];
let artifactDir = null;
let artifactManifest = null;

function resolveArtifactDir() {
    if (artifactDir) return artifactDir;
    artifactDir = artifactDirCandidates.find(candidate => existsSync(resolve(candidate, "manifest.json"))) || null;
    return artifactDir;
}

function loadArtifactManifest() {
    if (artifactManifest) return artifactManifest;
    const resolvedArtifactDir = resolveArtifactDir();
    const manifestPath = resolvedArtifactDir ? resolve(resolvedArtifactDir, "manifest.json") : null;
    if (!manifestPath || !existsSync(manifestPath)) {
        throw new Error(
            `Tree-sitter artifact manifest is missing. Checked: ${artifactDirCandidates.join(", ")}. ` +
            "This package now ships first-party grammar WASM artifacts; restore artifacts/tree-sitter or rerun the artifact materialization step."
        );
    }
    artifactManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return artifactManifest;
}

export function treeSitterArtifactManifest() {
    return loadArtifactManifest();
}

export function treeSitterArtifactPath(grammar) {
    const manifest = loadArtifactManifest();
    const resolvedArtifactDir = resolveArtifactDir();
    const entry = manifest.grammars?.find(item => item.grammar === grammar);
    if (!entry) {
        throw new Error(`Unsupported tree-sitter grammar "${grammar}". No first-party artifact is registered for it.`);
    }
    const wasmPath = resolve(resolvedArtifactDir, entry.file);
    if (!existsSync(wasmPath)) {
        throw new Error(
            `Tree-sitter artifact "${entry.file}" is missing at ${wasmPath}. ` +
            "The runtime no longer loads grammars from tree-sitter-wasms; restore the repo-owned artifact bundle."
        );
    }
    return wasmPath;
}

export async function getParser() {
    if (parserInstance) return parserInstance;
    const { Parser } = await import("web-tree-sitter");
    await Parser.init();
    parserInstance = new Parser();
    return parserInstance;
}

export async function getLanguage(grammar) {
    if (languageCache.has(grammar)) return languageCache.get(grammar);
    await getParser();
    const { Language } = await import("web-tree-sitter");
    const wasmPath = treeSitterArtifactPath(grammar);
    const lang = await Language.load(wasmPath);
    languageCache.set(grammar, lang);
    return lang;
}
