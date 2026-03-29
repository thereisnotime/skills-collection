import { createRequire } from "node:module";
import { resolve } from "node:path";

let parserInstance = null;
const languageCache = new Map();

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
    const require = createRequire(import.meta.url);
    const wasmPath = resolve(
        require.resolve("tree-sitter-wasms/package.json"),
        "..",
        "out",
        `tree-sitter-${grammar}.wasm`
    );
    const lang = await Language.load(wasmPath);
    languageCache.set(grammar, lang);
    return lang;
}
