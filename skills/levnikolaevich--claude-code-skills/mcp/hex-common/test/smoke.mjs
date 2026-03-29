import test from "node:test";
import assert from "node:assert/strict";

import { fnv1a, lineTag, rangeChecksum, parseChecksum, parseRef } from "../src/text-protocol/hash.mjs";
import { deduplicateLines, smartTruncate } from "../src/output/normalize.mjs";
import { coerceParams } from "../src/runtime/coerce.mjs";
import { grammarForExtension, isSupportedExtension } from "../src/parser/languages.mjs";
import { getParser, getLanguage } from "../src/parser/tree-sitter.mjs";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

test("hash protocol stays stable", () => {
    const hash = fnv1a("const x = 1;");
    assert.equal(lineTag(hash).length, 2);
    assert.equal(parseChecksum(rangeChecksum([hash], 1, 1)).start, 1);
    assert.deepEqual(parseRef("ab.12"), { tag: "ab", line: 12 });
});

test("normalize helpers deduplicate and truncate", () => {
    assert.deepEqual(deduplicateLines(["error 123", "error 456"]), ["error 123  (x2)"]);
    assert.match(smartTruncate(Array.from({ length: 80 }, (_, i) => `l${i}`).join("\n")), /omitted/);
});

test("runtime and parser helpers are stable", () => {
    assert.equal(coerceParams({ path: "a" }).path, "a");
    assert.equal(grammarForExtension(".ts"), "typescript");
    assert.equal(isSupportedExtension(".tsx"), true);
});

test("tree-sitter-wasms: WASM files exist for all supported grammars", () => {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("tree-sitter-wasms/package.json");
    const grammars = [
        "javascript", "typescript", "tsx", "python", "go", "rust",
        "java", "c", "cpp", "c_sharp", "ruby", "php", "kotlin", "swift", "bash"
    ];
    const missing = grammars.filter(g => {
        const wasm = resolve(pkgPath, "..", "out", `tree-sitter-${g}.wasm`);
        return !existsSync(wasm);
    });
    assert.deepEqual(missing, [], `WASM files missing for: ${missing.join(", ")}`);
});

test("tree-sitter: parser loads and parses JS source", async () => {
    const parser = await getParser();
    assert.ok(parser, "getParser() returned null");
    const lang = await getLanguage("javascript");
    assert.ok(lang, "getLanguage('javascript') returned null");
    parser.setLanguage(lang);
    const tree = parser.parse("const x = 1;");
    assert.ok(tree.rootNode, "parse returned no rootNode");
    assert.equal(tree.rootNode.type, "program");
});

test("SDK subpath imports resolve", async () => {
    const mcp = await import("@modelcontextprotocol/sdk/server/mcp.js");
    assert.ok(mcp.McpServer, "McpServer not exported from SDK");
    const stdio = await import("@modelcontextprotocol/sdk/server/stdio.js");
    assert.ok(stdio.StdioServerTransport, "StdioServerTransport not exported from SDK");
});
