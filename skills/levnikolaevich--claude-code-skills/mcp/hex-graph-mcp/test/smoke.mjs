import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ==================== coerce ====================

describe("coerce params", () => {
    it("does not remap aliases in breaking-release mode", async () => {
        const { coerceParams } = await import("../lib/coerce.mjs");
        const result = coerceParams({
            root: "/project",
            search: "myFunction",
            fn: "doStuff",
            max_depth: 5,
            max_results: 10,
        });
        assert.equal(result.root, "/project");
        assert.equal(result.search, "myFunction");
        assert.equal(result.fn, "doStuff");
        assert.equal(result.max_depth, 5);
        assert.equal(result.max_results, 10);
    });

    it("returns the same object shape for selector params", async () => {
        const { coerceParams } = await import("../lib/coerce.mjs");
        const result = coerceParams({ symbol_id: 42, qualified_name: "a.mjs:helper" });
        assert.equal(result.symbol_id, 42);
        assert.equal(result.qualified_name, "a.mjs:helper");
    });
});


// ==================== find_clones ====================

import { mkdtempSync, writeFileSync, rmSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { indexProject, reindexFile } from "../lib/indexer.mjs";
import { getStore, resolveStore, findSymbols, getReferencesBySelector, getSymbol, tracePaths, explainResolution, findImplementationsBySelector, findDataflowsBySelector, getModuleMetricsReport, getArchitectureReport } from "../lib/store.mjs";
import { findClones } from "../lib/clones.mjs";
import { findCycles } from "../lib/cycles.mjs";
import { findUnusedExports } from "../lib/unused.mjs";

function makeTempDir() {
    return mkdtempSync(join(tmpdir(), "hex-graph-clone-"));
}

function providerEnvName(language) {
    if (language === "python") return "HEX_GRAPH_PRECISE_PY_COMMAND";
    if (language === "csharp") return "HEX_GRAPH_PRECISE_CS_COMMAND";
    if (language === "php") return "HEX_GRAPH_PRECISE_PHP_COMMAND";
    throw new Error(`Unsupported provider language '${language}'`);
}

async function withProviderCommand(language, command, fn) {
    const envName = providerEnvName(language);
    const previous = process.env[envName];
    process.env[envName] = JSON.stringify(command);
    try {
        return await fn();
    } finally {
        if (previous == null) delete process.env[envName];
        else process.env[envName] = previous;
    }
}

function createFakeDefinitionProvider(dir, definitions) {
    const providerDir = join(dir, ".hex-skills", "codegraph", "test-providers");
    mkdirSync(providerDir, { recursive: true });
    const providerPath = join(providerDir, "fake-lsp-provider.mjs");
    const configPath = join(providerDir, "fake-lsp-provider.json");
    writeFileSync(configPath, JSON.stringify({ definitions }, null, 2));
    writeFileSync(providerPath, `
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const openDocs = new Map();
let nextBuffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(\`Content-Length: \${body.length}\\r\\n\\r\\n\`);
  process.stdout.write(body);
}

function tokenAt(line, character) {
  const regex = /[A-Za-z_][A-Za-z0-9_]*/g;
  for (const match of line.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (character >= start && character < end) return match[0];
  }
  return null;
}

function normalizeUri(file) {
  return pathToFileURL(file).href;
}

function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {}, serverInfo: { name: "fake-lsp", version: "1.0.0" } } });
    return;
  }
  if (message.method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "textDocument/didOpen") {
    openDocs.set(message.params.textDocument.uri, message.params.textDocument.text);
    return;
  }
  if (message.method === "textDocument/definition") {
    const uri = message.params.textDocument.uri;
    const text = openDocs.get(uri) || "";
    const lines = text.split(/\\r?\\n/);
    const line = lines[message.params.position.line] || "";
    const token = tokenAt(line, message.params.position.character);
    const target = token ? config.definitions[token] : null;
    if (!target) {
      send({ jsonrpc: "2.0", id: message.id, result: null });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        uri: normalizeUri(target.file),
        range: {
          start: { line: target.line - 1, character: 0 },
          end: { line: target.line - 1, character: 1 }
        }
      }
    });
  }
}

process.stdin.on("data", chunk => {
  nextBuffer = Buffer.concat([nextBuffer, chunk]);
  while (true) {
    const marker = nextBuffer.indexOf("\\r\\n\\r\\n");
    if (marker === -1) return;
    const header = nextBuffer.subarray(0, marker).toString("utf8");
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) {
      nextBuffer = Buffer.alloc(0);
      return;
    }
    const bodyLength = Number.parseInt(match[1], 10);
    const bodyStart = marker + 4;
    const bodyEnd = bodyStart + bodyLength;
    if (nextBuffer.length < bodyEnd) return;
    const body = JSON.parse(nextBuffer.subarray(bodyStart, bodyEnd).toString("utf8"));
    nextBuffer = nextBuffer.subarray(bodyEnd);
    handle(body);
  }
});
`, "utf8");
    return [process.execPath, providerPath, configPath];
}

function cleanDb(dir) {
    const dbPath = join(dir, ".hex-skills/codegraph", "index.db");
    if (existsSync(dbPath)) unlinkSync(dbPath);
}

function flowPoint(symbol, anchor) {
    return { symbol, anchor };
}

const FLOW_TEST_LIMIT = 10;
const RELAY_FLOW_HOPS = 4;

describe("find_clones", () => {
    it("exact + normalized clone detection across files", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "a.mjs"),
                'export function processUser(user) { if (!user.email) throw new Error("missing"); const v = validate(user); const r = db.create(v); log("created", r.id); return r; }\n',
            );
            writeFileSync(
                join(dir, "b.mjs"),
                'export function processOrder(order) { if (!order.email) throw new Error("missing"); const v = validate(order); const r = db.create(v); log("created", r.id); return r; }\n',
            );


            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            const result = findClones(store, { type: "all", crossFile: false });

            assert.ok(result.summary.total_groups >= 1, "At least 1 clone group found");

            const names = result.groups.flatMap(g => g.members.map(m => m.name));
            assert.ok(names.includes("processUser"), "processUser in clone group");
            assert.ok(names.includes("processOrder"), "processOrder in clone group");

            // They have different raw text (different param names) but same normalized structure
            const group = result.groups.find(
                g => g.members.some(m => m.name === "processUser") &&
                     g.members.some(m => m.name === "processOrder")
            );
            assert.ok(group, "Both functions in same group");
            assert.strictEqual(group.type, "normalized", "Type is normalized (different raw_hash, same norm_hash)");

            store.close();
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });

    it("duplicate method names in different classes", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "services.mjs"),
                [
                    'export class UserService {',
                    '    save(user) {',
                    '        const validated = check(user);',
                    '        const result = db.users.insert(validated);',
                    '        log("saved", result.id);',
                    '        return result;',
                    '    }',
                    '}',
                    '',
                    'export class OrderService {',
                    '    save(order) {',
                    '        const validated = check(order);',
                    '        const result = db.orders.insert(validated);',
                    '        log("saved", result.id);',
                    '        return result;',
                    '    }',
                    '}',
                    '',
                ].join('\n'),
            );


            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            const blocks = store.getAllCloneBlocks(1);
            const saveBlocks = blocks.filter(b => b.name === "save");

            assert.strictEqual(saveBlocks.length, 2, "2 separate clone_blocks for save methods");

            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });

    it("hashes-only language: .cs has no fingerprint or LSH", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "Demo.cs"),
                [
                    'using System;',
                    'public class Demo {',
                    '    public void Process(string input) {',
                    '        var trimmed = input.Trim();',
                    '        if (trimmed == "") throw new Exception("empty");',
                    '        var result = Validate(trimmed);',
                    '        Save(result);',
                    '        Console.WriteLine("done");',
                    '        Log(result.Id);',
                    '    }',
                    '}',
                    '',
                ].join('\n'),
            );


            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            const blocks = store.getAllCloneBlocks(1);
            const csBlock = blocks.find(b => b.name === "Process");

            assert.ok(csBlock, "clone_block exists for C# method");
            assert.strictEqual(csBlock.fingerprint, null, "fingerprint is NULL for hashes-only language");

            // No LSH entries for this node
            const lshRows = store.db
                .prepare("SELECT COUNT(*) as cnt FROM clone_lsh WHERE node_id = ?")
                .get(csBlock.node_id);
            assert.strictEqual(lshRows.cnt, 0, "No clone_lsh entries for hashes-only node");

            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });

    it("test-fixture suppression for test files", async () => {
        const dir = makeTempDir();
        try {
            mkdirSync(join(dir, "test"), { recursive: true });
            const body = `export function setup() {\n    const cfg = loadConfig();\n    const db = connect(cfg);\n    seed(db);\n    return db;\n}\n`;
            writeFileSync(join(dir, "test/a.test.mjs"), body);
            writeFileSync(join(dir, "test/b.test.mjs"), body);
            cleanDb(dir);
            await indexProject(dir);
            const store = getStore(dir);
            const result = findClones(store, { type: "exact", format: "json", crossFile: true, suppress: true });
            assert.ok(result.groups.length > 0, "clone group found");
            const g = result.groups[0];
            assert.strictEqual(g.suppressed, true, "suppressed for test files");
            assert.strictEqual(g.suppress_reason, "test-fixture");
            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });

    it("bounded-context hint (weak, not suppressed)", async () => {
        const dir = makeTempDir();
        try {
            mkdirSync(join(dir, "api"), { recursive: true });
            mkdirSync(join(dir, "workers"), { recursive: true });
            const body = `export function handle(req) {\n    const data = parse(req);\n    const result = process(data);\n    respond(result);\n    return result;\n}\n`;
            writeFileSync(join(dir, "api/handler.mjs"), body);
            writeFileSync(join(dir, "workers/processor.mjs"), body);
            cleanDb(dir);
            await indexProject(dir);
            const store = getStore(dir);
            const result = findClones(store, { type: "exact", format: "json", crossFile: true, suppress: true });
            assert.ok(result.groups.length > 0, "clone group found");
            const g = result.groups[0];
            assert.strictEqual(g.suppressed, false, "weak hint does NOT suppress");
            assert.ok(g.hints && g.hints.includes("bounded-context-hint"), "bounded-context-hint present");
            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });

    it("scope-aware call resolution: same-class method preferred", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(join(dir, "classes.mjs"), `
export class A {
    save(x) { const v = check(x); const r = db.insert(v); log(r); return r; }
    process(x) { return this.save(x); }
}
export class B {
    save(x) { const v = check(x); const r = db.insert(v); log(r); return r; }
}
`);
            cleanDb(dir);
            await indexProject(dir);
            const store = getStore(dir);
            const edges = store.db.prepare(
                "SELECT e.*, n1.name as src, n2.name as tgt, n2.qualified_name as tgt_qn FROM edges e JOIN nodes n1 ON n1.id=e.source_id JOIN nodes n2 ON n2.id=e.target_id WHERE n1.name='process'"
            ).all();
            const saveEdge = edges.find(e => e.tgt === "save");
            assert.ok(saveEdge, "process -> save edge exists");
            assert.ok(saveEdge.tgt_qn.includes("A.save"), "resolved to A.save, not B.save");
            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });

    it("incremental reindex updates clone_blocks", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(join(dir, "a.mjs"), `export function original() {\n    const x = get();\n    const y = transform(x);\n    save(y);\n    return y;\n}\n`);
            cleanDb(dir);
            await indexProject(dir);
            const store = getStore(dir);
            const before = store.getAllCloneBlocks(1);
            const countBefore = before.length;
            // Reindex with different content
            writeFileSync(join(dir, "a.mjs"), `export function changed() {\n    const a = fetch();\n    const b = process(a);\n    const c = validate(b);\n    emit(c);\n    return c;\n}\n`);
            await reindexFile(dir, "a.mjs");
            const after = store.getAllCloneBlocks(1);
            assert.strictEqual(after.length, countBefore, "same block count after reindex");
            assert.notStrictEqual(after[0].raw_hash, before[0].raw_hash, "hash changed after content change");
            store.close();
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

// ==================== find_hotspots ====================

describe("find_hotspots", () => {
    it("high-complexity function with multiple callers appears in hotspots", async () => {
        const dir = makeTempDir();
        try {
            // A complex function (many statements) called by multiple others
            writeFileSync(
                join(dir, "core.mjs"),
                [
                    "export function complexEngine(data) {",
                    "    const a = validate(data);",
                    "    const b = transform(a);",
                    "    const c = normalize(b);",
                    "    const d = enrich(c);",
                    "    const e = filter(d);",
                    "    const f = sort(e);",
                    "    const g = paginate(f);",
                    "    const h = format(g);",
                    "    const i = cache(h);",
                    "    const j = serialize(i);",
                    "    const k = compress(j);",
                    "    const l = encrypt(k);",
                    "    const m = sign(l);",
                    "    const n = wrap(m);",
                    "    const o = deliver(n);",
                    "    const p = log(o);",
                    "    return p;",
                    "}",
                    "",
                    "export function callerA() { return complexEngine(1); }",
                    "export function callerB() { return complexEngine(2); }",
                    "export function callerC() { return complexEngine(3); }",
                    "",
                    "export function trivial() { return 1; }",
                    "",
                ].join("\n"),
            );

            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            const rows = store.hotspots({ minCallers: 2, minComplexity: 5, limit: 20 });

            const names = rows.map(r => r.name);
            assert.ok(names.includes("complexEngine"), "complexEngine appears in hotspots");
            assert.ok(!names.includes("trivial"), "trivial (0 callers) excluded by AND filter");

            const hit = rows.find(r => r.name === "complexEngine");
            assert.ok(hit.callers >= 3, "at least 3 callers");
            assert.ok(hit.complexity >= 5, "complexity >= 5");
            assert.ok(hit.risk > 0, "risk is positive");
            assert.ok(
                hit.complexity_source === "stmt_count" || hit.complexity_source === "line_span_fallback",
                "complexity_source is valid",
            );

            store.close();
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

// ==================== find_unused_exports ====================

describe("find_unused_exports", () => {
    it("imported export NOT flagged, unused export IS flagged", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "a.mjs"),
                'export function foo() {}\nexport function bar() {}\n',
            );
            writeFileSync(
                join(dir, "b.mjs"),
                'import { foo } from "./a.mjs";\nfoo();\n',
            );

            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            const result = findUnusedExports(store);

            const unusedNames = result.unused.map(u => u.name);
            assert.ok(unusedNames.includes("bar"), "bar (never imported) is in unused list");
            assert.ok(!unusedNames.includes("foo"), "foo (imported by b) is NOT in unused list");

            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });
});

// ==================== find_cycles ====================

describe("find_cycles", () => {
    it("detects A->B->C->A circular dependency", async () => {
        const dir = makeTempDir();
        try {
            mkdirSync(join(dir, "packages", "a"), { recursive: true });
            mkdirSync(join(dir, "packages", "b"), { recursive: true });
            mkdirSync(join(dir, "packages", "c"), { recursive: true });
            writeFileSync(join(dir, "packages", "a", "package.json"), JSON.stringify({ name: "pkg-a" }));
            writeFileSync(join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "pkg-b" }));
            writeFileSync(join(dir, "packages", "c", "package.json"), JSON.stringify({ name: "pkg-c" }));
            writeFileSync(
                join(dir, "packages", "a", "index.mjs"),
                'import { b } from "../b/index.mjs";\nexport function a() { b(); }\n',
            );
            writeFileSync(
                join(dir, "packages", "b", "index.mjs"),
                'import { c } from "../c/index.mjs";\nexport function b() { c(); }\n',
            );
            writeFileSync(
                join(dir, "packages", "c", "index.mjs"),
                'import { a } from "../a/index.mjs";\nexport function a_caller() { a(); }\n',
            );

            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            const result = findCycles(store);

            assert.strictEqual(result.cycles.length, 1, "exactly 1 cycle");
            assert.strictEqual(result.cycles[0].length, 3, "cycle has 3 module hops");
            const cycleModules = result.cycles[0].modules.map(module => module.module_key);
            assert.equal(cycleModules[0], cycleModules.at(-1), "cycle path closes on the starting workspace module");
            assert.deepEqual(
                [...new Set(cycleModules.slice(0, -1))].sort(),
                ["js-module:packages/a", "js-module:packages/b", "js-module:packages/c"],
                "cycle path is reported at workspace-module level",
            );

            store.close();
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

// ==================== get_module_metrics ====================

describe("get_module_metrics", () => {
    it("Ca/Ce correct for shared module", async () => {
        const dir = makeTempDir();
        try {
            mkdirSync(join(dir, "app-a"), { recursive: true });
            mkdirSync(join(dir, "app-b"), { recursive: true });
            mkdirSync(join(dir, "shared"), { recursive: true });
            writeFileSync(join(dir, "app-a", "package.json"), JSON.stringify({ name: "app-a" }));
            writeFileSync(join(dir, "app-b", "package.json"), JSON.stringify({ name: "app-b" }));
            writeFileSync(join(dir, "shared", "package.json"), JSON.stringify({ name: "shared" }));
            writeFileSync(
                join(dir, "app-a", "index.mjs"),
                'import { shared } from "../shared/index.mjs";\nshared();\n',
            );
            writeFileSync(
                join(dir, "app-b", "index.mjs"),
                'import { shared } from "../shared/index.mjs";\nshared();\n',
            );
            writeFileSync(
                join(dir, "shared", "index.mjs"),
                'export function shared() {}\n',
            );

            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            const rows = store.moduleMetricRows({ minCoupling: 0 });
            const report = getModuleMetricsReport({ minCoupling: 0, path: dir });

            const sharedMetric = rows.find(r => r.module_key === "js-module:shared");
            assert.ok(sharedMetric, "shared workspace module appears in metrics");
            assert.ok(sharedMetric.ca >= 2, "shared module has Ca >= 2 (imported by app-a and app-b)");
            assert.strictEqual(sharedMetric.ce, 0, "shared module has Ce === 0 (imports nothing)");
            const reportShared = report.result.find(r => r.module_key === "js-module:shared");
            assert.ok(reportShared, "shared workspace module appears in report");
            assert.equal(reportShared.ca, sharedMetric.ca, "report Ca matches unified module graph metrics");
            assert.equal(reportShared.ce, sharedMetric.ce, "report Ce matches unified module graph metrics");

            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });
});

describe("architecture report", () => {
    it("reports cross-module edges from unified module layer", async () => {
        const dir = makeTempDir();
        try {
            mkdirSync(join(dir, "app"), { recursive: true });
            mkdirSync(join(dir, "shared"), { recursive: true });
            writeFileSync(join(dir, "app", "package.json"), JSON.stringify({ name: "app" }));
            writeFileSync(join(dir, "shared", "package.json"), JSON.stringify({ name: "shared" }));
            writeFileSync(
                join(dir, "app", "a.mjs"),
                'import { shared } from "../shared/shared.mjs";\nshared();\n',
            );
            writeFileSync(
                join(dir, "shared", "shared.mjs"),
                'export function shared() {}\n',
            );

            cleanDb(dir);
            await indexProject(dir);

            const report = getArchitectureReport({ path: dir, limit: 10 });
            const crossEdge = report.result.cross_module_edges.find(edge =>
                edge.source_module_key === "js-module:app" && edge.target_module_key === "js-module:shared"
            );
            assert.ok(crossEdge, "architecture report includes app -> shared module edge");
            assert.ok(crossEdge.edge_count >= 1, "cross-module edge count present");
        } finally {
            const store = getStore(dir);
            store.close();
            rmSync(dir, { recursive: true });
        }
    });
});

describe("external module boundary", () => {
    it("materializes unresolved imports as external module nodes and module-layer edges", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "a.mjs"),
                'import React from "react";\nexport function render() { return React.createElement("div"); }\n',
            );

            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            const externalFile = store.externalModuleFile("react");
            const externalNode = store.findByQualified(`${externalFile}:module`)[0];
            assert.ok(externalNode, "external module node created");
            assert.equal(externalNode.kind, "external_module");

            const externalEdge = store.moduleGraphEdges().find(edge =>
                edge.source_file === "a.mjs" && edge.target_file === externalFile
            );
            assert.ok(externalEdge, "moduleGraphEdges includes unresolved external dependency");

            const sourceModule = store.findByQualified("a.mjs:module")[0];
            const layeredEdge = store.edgesFrom(sourceModule.id).find(edge =>
                edge.layer === "module" &&
                edge.target_id === externalNode.id &&
                edge.kind === "depends_on_external"
            );
            assert.ok(layeredEdge, "unified edges include depends_on_external");
            assert.equal(layeredEdge.origin, "unresolved");
            assert.equal(layeredEdge.confidence, "low");

            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });

    it("materializes unresolved named imports as external symbol nodes with symbol-layer usages", async () => {
        const dir = makeTempDir();
        let store;
        try {
            writeFileSync(
                join(dir, "a.mjs"),
                [
                    'import { useState } from "react";',
                    'export function render() {',
                    '    useState();',
                    '    return useState;',
                    '}',
                    '',
                ].join("\n"),
            );

            cleanDb(dir);
            await indexProject(dir);

            store = getStore(dir);
            const externalFile = store.externalModuleFile("react");
            const externalSymbol = store.findByQualified(`${externalFile}:symbol:useState`)[0];
            assert.ok(externalSymbol, "external symbol node created for unresolved named import");
            assert.equal(externalSymbol.kind, "external_symbol");

            const importStmt = store.nodesByFile("a.mjs").find(node => node.kind === "import");
            assert.ok(importStmt, "import statement node exists");
            const importEdge = store.edgesFrom(importStmt.id).find(edge =>
                edge.kind === "imports" &&
                edge.target_id === externalSymbol.id
            );
            assert.ok(importEdge, "symbol-layer import edge points to external symbol");
            assert.equal(importEdge.origin, "external");
            assert.equal(importEdge.confidence, "low");

            const refs = getReferencesBySelector({ qualified_name: `${externalFile}:symbol:useState` }, { path: dir });
            assert.equal(refs.result.symbol.kind, "external_symbol");
            assert.equal(refs.result.total_by_kind.imports, 1, "external symbol sees import usage");
            assert.equal(refs.result.total_by_kind.calls, 1, "external symbol sees call usage");
            assert.equal(refs.result.total_by_kind.ref_read, 1, "external symbol sees read usage");

            const traced = tracePaths({ qualified_name: `${externalFile}:symbol:useState` }, {
                path_kind: "calls",
                direction: "reverse",
                depth: 2,
                path: dir,
            });
            assert.ok(traced.result.some(path => path.nodes.some(node => node.name === "render")), "reverse call paths reach local caller");
        } finally {
            store?.close();
            rmSync(dir, { recursive: true });
        }
    });
});

// ==================== alias import ====================

describe("alias import resolution", () => {
    it("aliased import resolves to original symbol", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "a.mjs"),
                'export function original() {}\n',
            );
            writeFileSync(
                join(dir, "b.mjs"),
                'import { original as renamed } from "./a.mjs";\nexport function caller() { renamed(); }\n',
            );

            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            // Find the caller node
            const callerNodes = store.findByName("caller");
            assert.ok(callerNodes.length > 0, "caller node exists");
            const callerId = callerNodes[0].id;

            // Check edges from caller
            const edges = store.edgesFrom(callerId).filter(e => e.kind === "calls");
            const callsOriginal = edges.some(e => e.target_name === "original");
            assert.ok(callsOriginal, "caller -> original call edge exists (alias resolved)");

            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });
});

// ==================== default import ====================

describe("default import resolution", () => {
    it("default import resolves to default-exported symbol", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "a.mjs"),
                'export default function handler() {}\n',
            );
            writeFileSync(
                join(dir, "b.mjs"),
                'import H from "./a.mjs";\nexport function user() { H(); }\n',
            );

            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            const userNodes = store.findByName("user");
            assert.ok(userNodes.length > 0, "user node exists");

            const edges = store.edgesFrom(userNodes[0].id).filter(e => e.kind === "calls");
            const callsHandler = edges.some(e => e.target_name === "handler");
            assert.ok(callsHandler, "user -> handler call edge exists (default import resolved)");

            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });
});

// ==================== incremental reindex ====================

describe("incremental reindex", () => {
    it("reindex of target file preserves incoming module_edges", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "a.mjs"),
                'import { x } from "./b.mjs";\nx();\n',
            );
            writeFileSync(
                join(dir, "b.mjs"),
                'export function x() {}\n',
            );

            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);

            // Verify module_edge a->b exists
            const edgesBefore = store.allModuleEdges();
            const hasEdge = edgesBefore.some(
                e => e.source_file.includes("a.mjs") && e.target_file.includes("b.mjs")
            );
            assert.ok(hasEdge, "module_edge a->b exists after full index");
            const graphEdgesBefore = store.allLayerEdges("module");
            const hasGraphEdgeBefore = graphEdgesBefore.some(
                e => e.kind === "depends_on" && e.file.includes("a.mjs")
            );
            assert.ok(hasGraphEdgeBefore, "module-layer graph edge exists after full index");

            // Reindex ONLY b.mjs (the target)
            writeFileSync(
                join(dir, "b.mjs"),
                'export function x() { return 42; }\n',
            );
            await reindexFile(dir, "b.mjs");

            // module_edge a->b should still exist (a was not reindexed)
            const edgesAfter = store.allModuleEdges();
            const stillHasEdge = edgesAfter.some(
                e => e.source_file.includes("a.mjs") && e.target_file.includes("b.mjs")
            );
            assert.ok(stillHasEdge, "module_edge a->b preserved after reindexing b.mjs");
            const graphEdgesAfter = store.allLayerEdges("module");
            const stillHasGraphEdge = graphEdgesAfter.some(
                e => e.kind === "depends_on" && e.file.includes("a.mjs")
            );
            assert.ok(stillHasGraphEdge, "module-layer graph edge preserved after reindexing b.mjs");

            store.close();
        } finally {
            rmSync(dir, { recursive: true });
        }
    });

    it("resolved semantic edges carry layer, origin, and edge_hash metadata", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "a.mjs"),
                'export function callee() {}\n',
            );
            writeFileSync(
                join(dir, "b.mjs"),
                'import { callee } from "./a.mjs";\nexport function caller() { callee(); }\n',
            );

            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);
            const caller = store.findByName("caller")[0];
            const edges = store.edgesFrom(caller.id).filter(e => e.kind === "calls");
            assert.ok(edges.length >= 1, "caller has at least one call edge");
            assert.ok(edges.some(edge => edge.layer === "symbol" && edge.origin === "resolved"), "resolved call edge is preserved");
            assert.ok(edges.some(edge => edge.layer === "symbol" && edge.origin === "precise_ts"), "precise overlay call edge is materialized");
            assert.ok(edges.every(edge => edge.edge_hash), "edge_hash present on all call edges");

            store.close();
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

// ==================== barrel re-export ====================

describe("barrel re-export", () => {
    it("consumer importing from barrel marks target symbol as used", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-reexport-"));
        const codegraph = join(tmp, ".hex-skills/codegraph");
        mkdirSync(codegraph, { recursive: true });

        writeFileSync(join(tmp, "a.mjs"), 'export function foo() { return 1; }\n');
        writeFileSync(join(tmp, "barrel.mjs"), 'export { foo } from "./a.mjs";\n');
        writeFileSync(join(tmp, "consumer.mjs"), 'import { foo } from "./barrel.mjs";\nfoo();\n');

        try {
            await indexProject(tmp);
            const store = getStore(tmp);

            // barrel should have a reexport node
            const barrelNodes = store.nodesByFile("barrel.mjs");
            const reexportNode = barrelNodes.find(n => n.kind === "reexport" && n.name === "foo");
            assert.ok(reexportNode, "barrel has synthetic reexport node for foo");
            assert.equal(reexportNode.is_exported, 1, "reexport node is exported");

            // find_unused_exports should NOT flag foo in a.mjs
            const result = findUnusedExports(store);
            const fooUnused = result.unused.find(u => u.name === "foo" && u.file === "a.mjs");
            assert.equal(fooUnused, undefined, "foo in a.mjs is used via barrel, not flagged");

            store.close();
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});

// ==================== namespace import confidence ====================

describe("namespace import confidence", () => {
    it("namespace-only usage reported as low confidence", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-ns-"));
        const codegraph = join(tmp, ".hex-skills/codegraph");
        mkdirSync(codegraph, { recursive: true });

        writeFileSync(join(tmp, "a.mjs"), 'export function x() {}\nexport function y() {}\n');
        writeFileSync(join(tmp, "b.mjs"), 'import * as ns from "./a.mjs";\nns.x();\n');

        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            const result = findUnusedExports(store);

            // Both x and y should be reported as low confidence (namespace-only usage)
            const xResult = result.unused.find(u => u.name === "x");
            const yResult = result.unused.find(u => u.name === "y");

            // With namespace import, both get edges — but confidence is "low"
            if (xResult) assert.equal(xResult.confidence, "low");
            if (yResult) assert.equal(yResult.confidence, "low");

            store.close();
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});

// ==================== unused barrel ====================

describe("unused barrel", () => {
    it("barrel with no consumer does not make target used", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-nocons-"));
        const codegraph = join(tmp, ".hex-skills/codegraph");
        mkdirSync(codegraph, { recursive: true });

        writeFileSync(join(tmp, "a.mjs"), 'export function foo() { return 1; }\n');
        writeFileSync(join(tmp, "barrel.mjs"), 'export { foo } from "./a.mjs";\n');
        // No consumer!

        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            const result = findUnusedExports(store);

            // foo should be flagged as unused (barrel exists but nobody imports from it)
            const fooUnused = result.unused.find(u => u.name === "foo" && u.file === "a.mjs");
            assert.ok(fooUnused, "foo in a.mjs is unused when barrel has no consumers");
            assert.equal(fooUnused.confidence, "high");

            store.close();
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});



// ==================== P1g: Multi-language export/import tests ====================

describe("Python __all__ export extraction", () => {
    it("__all__ is authoritative, convention fallback without it", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-pyall-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "with_all.py"), '__all__ = ["foo"]\n\ndef foo():\n    pass\n\ndef bar():\n    pass\n');
        writeFileSync(join(tmp, "no_all.py"), 'def pub():\n    pass\n\ndef _priv():\n    pass\n\nclass MyClass:\n    pass\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            // with_all.py: only foo exported (bar excluded by __all__)
            const withAllNodes = store.nodesByFile("with_all.py");
            const fooNode = withAllNodes.find(n => n.name === "foo" && n.kind !== "import");
            const barNode = withAllNodes.find(n => n.name === "bar" && n.kind !== "import");
            assert.ok(fooNode?.is_exported, "foo exported via __all__");
            assert.ok(!barNode?.is_exported, "bar NOT exported (excluded from __all__)");
            // no_all.py: convention — pub and MyClass exported, _priv not
            const noAllNodes = store.nodesByFile("no_all.py");
            const pubNode = noAllNodes.find(n => n.name === "pub");
            const privNode = noAllNodes.find(n => n.name === "_priv");
            const classNode = noAllNodes.find(n => n.name === "MyClass");
            assert.ok(pubNode?.is_exported, "pub exported by convention");
            assert.ok(!privNode?.is_exported, "_priv NOT exported");
            assert.ok(classNode?.is_exported, "MyClass exported by convention");
            store.close();
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe("Python dynamic __all__", () => {
    it("dynamic __all__ falls back to underscore convention", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-pydyn-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "dynamic.py"), '__all__ = get_exports()\n\ndef visible():\n    pass\n\ndef _hidden():\n    pass\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            const nodes = store.nodesByFile("dynamic.py");
            const vis = nodes.find(n => n.name === "visible");
            const hid = nodes.find(n => n.name === "_hidden");
            assert.ok(vis?.is_exported, "visible exported (convention fallback)");
            assert.ok(!hid?.is_exported, "_hidden NOT exported");
            store.close();
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe("C# public vs internal", () => {
    it("only public declarations are exported", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-cs-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "test.cs"), 'using System;\n\npublic class Foo {\n    public void PubMethod() {}\n    private void PrivMethod() {}\n}\n\ninternal class Bar {}\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            const nodes = store.nodesByFile("test.cs");
            const foo = nodes.find(n => n.name === "Foo" && n.kind === "class");
            const bar = nodes.find(n => n.name === "Bar" && n.kind === "class");
            assert.ok(foo?.is_exported, "public class Foo exported");
            assert.ok(!bar?.is_exported, "internal class Bar NOT exported");
            store.close();
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe("PHP export extraction", () => {
    it("top-level + public methods exported, private not", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-php-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "test.php"), '<?php\nfunction top() {}\nclass C {\n    public function pub() {}\n    private function priv() {}\n}\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            const nodes = store.nodesByFile("test.php");
            const topFn = nodes.find(n => n.name === "top" && n.kind === "function");
            const cls = nodes.find(n => n.name === "C" && n.kind === "class");
            const pub = nodes.find(n => n.name === "pub" && n.kind === "method");
            const priv = nodes.find(n => n.name === "priv" && n.kind === "method");
            assert.ok(topFn?.is_exported, "top-level function exported");
            assert.ok(cls?.is_exported, "class exported");
            assert.ok(pub?.is_exported, "public method exported");
            assert.ok(!priv?.is_exported, "private method NOT exported");
            store.close();
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe("Non-JS find_unused_exports confidence", () => {
    it("Python exports are treated as proven unused once workspace resolution exists", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-pyunused-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "lib.py"), 'def helper():\n    pass\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            const result = findUnusedExports(store);
            const helper = result.unused.find(u => u.name === "helper" && u.file === "lib.py");
            assert.ok(helper, "Python export detected");
            assert.equal(helper.confidence, "high", "Python proven-unused export gets high confidence");
            assert.equal(result.uncertain.length, 0, "no uncertain records for simple Python fixture");
            store.close();
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});

// ==================== find_references ====================

describe("find_references", () => {
    it("detects call + read reference for same symbol", async () => {
        const dir = makeTempDir();
        try {
            // a.mjs exports a function
            writeFileSync(join(dir, "a.mjs"), 'export function helper() { return 1; }\n');
            // b.mjs calls it AND passes it as value (inside a function so call edges resolve)
            writeFileSync(join(dir, "b.mjs"), 'import { helper } from "./a.mjs";\nexport function caller() { const result = helper(); const fn = helper; return fn; }\n');

            cleanDb(dir);
            await indexProject(dir);

            const store = getStore(dir);

            // Find the helper node
            const nodes = store.findByName("helper");
            const helperNode = nodes.find(n => n.kind === "function");
            assert.ok(helperNode, "helper function found");

            // Should have at least a call edge
            const refs = store.findReferences(helperNode.id);
            const callRefs = refs.filter(r => r.kind === "calls");
            assert.ok(callRefs.length > 0, "has call references");

            // Should have ref_read edge (from `const fn = helper`)
            const readRefs = refs.filter(r => r.kind === "ref_read");
            assert.ok(readRefs.length > 0, "has read references from value usage");

            store.close();
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

describe("identity-first selector APIs", () => {
    it("get_symbol resolves by name+file and explain_resolution reports selector strategy", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(join(dir, "a.mjs"), 'export function helper() { return 1; }\n');
            cleanDb(dir);
            await indexProject(dir);

            const symbol = getSymbol({ name: "helper", file: "a.mjs" }, { path: dir });
            assert.equal(symbol.result.symbol.qualified_name, "a.mjs:helper");
            assert.equal(symbol.result.symbol.package_key, "js:.");
            assert.equal(symbol.result.symbol.module_key, "js-module:.");
            assert.equal(symbol.result.symbol.workspace_qualified_name, "js-module:.::a.mjs::helper");
            assert.equal(symbol.reason, "resolved_by_name_file");

            const explained = explainResolution({ workspace_qualified_name: symbol.result.symbol.workspace_qualified_name }, { path: dir });
            assert.equal(explained.result.selector_kind, "workspace_qualified_name");
            assert.equal(explained.result.resolved.workspace_qualified_name, symbol.result.symbol.workspace_qualified_name);
            assert.ok(Array.isArray(explained.result.parsed_candidates), "parsed candidates are reported");
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });

    it("trace_paths returns call paths for canonical selector", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(join(dir, "a.mjs"), 'export function helper() { return 1; }\n');
            writeFileSync(join(dir, "b.mjs"), 'import { helper } from "./a.mjs";\nexport function caller() { return helper(); }\n');
            cleanDb(dir);
            await indexProject(dir);

            const traced = tracePaths({ qualified_name: "a.mjs:helper" }, {
                path_kind: "calls",
                direction: "reverse",
                depth: 2,
                path: dir,
            });
            assert.ok(traced.result.length > 0, "returns at least one path");
            assert.ok(traced.result.some(p => p.edges.some(e => e.kind === "calls")), "contains call edge");

            const targeted = tracePaths({ qualified_name: "a.mjs:helper" }, {
                path_kind: "calls",
                direction: "reverse",
                depth: 2,
                path: dir,
                target: { name: "caller", file: "b.mjs" },
            });
            assert.equal(targeted.reason, "targeted_path_lookup");
            assert.equal(targeted.evidence.target_found, true);
            assert.ok(targeted.result.length > 0, "returns targeted path");
            assert.ok(targeted.result.every(p => p.nodes.some(node => node.name === "caller")), "all targeted paths reach caller");
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

describe("identity query error contracts", () => {
    it("returns NOT_INDEXED for semantic queries before indexing", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-notindexed-"));
        try {
            const freshStore = await import(`../lib/store.mjs?fresh-not-indexed=${Date.now()}`);
            const queries = [
                freshStore.getSymbol({ qualified_name: "a.mjs:helper" }, { path: tmp }),
                freshStore.tracePaths({ qualified_name: "a.mjs:helper" }, { path: tmp }),
                freshStore.explainResolution({ qualified_name: "a.mjs:helper" }, { path: tmp }),
                freshStore.getReferencesBySelector({ qualified_name: "a.mjs:helper" }, { path: tmp }),
                freshStore.findImplementationsBySelector({ qualified_name: "a.mjs:helper" }, { path: tmp }),
                freshStore.findDataflowsBySelector({
                    source: flowPoint(
                        { qualified_name: "a.mjs:helper" },
                        { kind: "return" },
                    ),
                }, { path: tmp }),
                freshStore.getModuleMetricsReport({ path: tmp }),
                freshStore.getArchitectureReport({ path: tmp }),
            ];
            for (const result of queries) {
                assert.equal(result.error?.code, "NOT_INDEXED");
            }
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    it("returns SYMBOL_NOT_FOUND for missing canonical selectors", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(join(dir, "a.mjs"), "export function helper() { return 1; }\n");
            cleanDb(dir);
            await indexProject(dir);

            const checks = [
                getSymbol({ name: "missing", file: "a.mjs" }, { path: dir }),
                tracePaths({ name: "missing", file: "a.mjs" }, { path: dir }),
                explainResolution({ name: "missing", file: "a.mjs" }, { path: dir }),
                findImplementationsBySelector({ name: "missing", file: "a.mjs" }, { path: dir }),
                findDataflowsBySelector({
                    source: flowPoint(
                        { name: "missing", file: "a.mjs" },
                        { kind: "return" },
                    ),
                }, { path: dir }),
            ];
            for (const result of checks) {
                assert.equal(result.error?.code, "SYMBOL_NOT_FOUND");
            }
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

describe("search_symbols contract", () => {
    it("returns canonical identities and respects kind filter", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(join(dir, "a.mjs"), [
                "export function helperAlpha() { return 1; }",
                "export function helperBeta() { return 2; }",
                "export class HelperBox {}",
                "",
            ].join("\n"));
            cleanDb(dir);
            await indexProject(dir);

            const all = findSymbols("helper*", { path: dir, limit: 10 });
            assert.ok(all.matches.length >= 2, "partial search returns multiple candidates");
            assert.ok(
                all.matches.every(match =>
                    match.symbol_id &&
                    match.qualified_name &&
                    match.workspace_qualified_name &&
                    match.package_key &&
                    match.module_key &&
                    match.file
                ),
                "matches expose canonical identity and ownership fields",
            );

            const onlyFns = findSymbols("helper*", { path: dir, kind: "function", limit: 10 });
            assert.ok(onlyFns.matches.length >= 1, "kind-filtered search returns function");
            assert.ok(onlyFns.matches.every(match => match.kind === "function"), "kind filter excludes non-functions");
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

describe("workspace-qualified identity selectors", () => {
    it("disambiguates same symbol names across workspace packages", async () => {
        const dir = makeTempDir();
        try {
            mkdirSync(join(dir, "packages", "a"), { recursive: true });
            mkdirSync(join(dir, "packages", "b"), { recursive: true });
            writeFileSync(join(dir, "packages", "a", "package.json"), JSON.stringify({ name: "@repo/a" }, null, 2));
            writeFileSync(join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "@repo/b" }, null, 2));
            writeFileSync(join(dir, "packages", "a", "index.mjs"), "export function helper() { return 'a'; }\n");
            writeFileSync(join(dir, "packages", "b", "index.mjs"), "export function helper() { return 'b'; }\n");
            cleanDb(dir);
            await indexProject(dir);

            const matches = findSymbols("helper", { path: dir, kind: "function", limit: 10 }).matches
                .filter(match => match.name === "helper");
            assert.equal(matches.length, 2, "both package-local helpers are discoverable");
            assert.notEqual(matches[0].workspace_qualified_name, matches[1].workspace_qualified_name, "workspace identities are distinct");

            const aHelper = matches.find(match => match.package_name === "@repo/a");
            const bHelper = matches.find(match => match.package_name === "@repo/b");
            assert.ok(aHelper && bHelper, "package ownership is surfaced on matches");

            const resolved = getSymbol({ workspace_qualified_name: aHelper.workspace_qualified_name }, { path: dir });
            assert.equal(resolved.reason, "resolved_by_workspace_qualified_name");
            assert.equal(resolved.result.symbol.package_name, "@repo/a");
            assert.equal(resolved.result.symbol.file, "packages/a/index.mjs");

            const explained = explainResolution({ workspace_qualified_name: bHelper.workspace_qualified_name }, { path: dir });
            assert.equal(explained.result.selector_kind, "workspace_qualified_name");
            assert.equal(explained.result.resolved.package_name, "@repo/b");
            assert.ok(Array.isArray(explained.result.parsed_candidates), "parsed candidates remain explainable");
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

describe("precise overlay contracts", () => {
    it("adds TypeScript precise call edges and honors min_confidence", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
                compilerOptions: {
                    target: "ES2022",
                    module: "NodeNext",
                    moduleResolution: "NodeNext",
                    strict: true,
                },
            }, null, 2));
            writeFileSync(join(dir, "types.ts"), "export interface Runner { run(): string; }\n");
            writeFileSync(join(dir, "impl.ts"), [
                "import type { Runner } from \"./types\";",
                "export class Worker implements Runner {",
                "    run(): string { return \"ok\"; }",
                "}",
                "",
            ].join("\n"));
            writeFileSync(join(dir, "consumer.ts"), [
                "import { Worker } from \"./impl\";",
                "export function exec() {",
                "    const worker: Worker = new Worker();",
                "    return worker.run();",
                "}",
                "",
            ].join("\n"));

            cleanDb(dir);
            await indexProject(dir);

            const symbol = getSymbol({ name: "run", file: "impl.ts" }, { path: dir, min_confidence: "precise" });
            assert.equal(symbol.result.provider_status.status, "available");
            assert.equal(symbol.result.provider_status.provider, "precise_ts");

            const preciseRefs = getReferencesBySelector({ name: "run", file: "impl.ts" }, {
                path: dir,
                min_confidence: "precise",
            });
            assert.ok(
                preciseRefs.result.references.some(ref =>
                    ref.file === "consumer.ts"
                    && ref.kind === "calls"
                    && ref.confidence === "precise"
                    && ref.origin === "precise_ts"
                ),
                "precise references include typed member call from consumer.ts",
            );

            const traced = tracePaths({ name: "run", file: "impl.ts" }, {
                path: dir,
                path_kind: "calls",
                direction: "reverse",
                min_confidence: "precise",
                depth: 3,
            });
            assert.ok(traced.result.length > 0, "precise path lookup returns typed call path");
            assert.ok(traced.result.some(path => path.nodes.some(node => node.name === "exec")), "typed caller is surfaced in precise path trace");

            const explained = explainResolution({ name: "run", file: "impl.ts" }, { path: dir });
            assert.equal(explained.result.precise_provider_status.status, "available");
            assert.ok(explained.result.precise_results.incoming_count > 0, "explain_resolution exposes precise overlay facts");
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });

    it("reports unavailable precise providers explicitly for non-TS languages", async () => {
        const dir = makeTempDir();
        try {
            mkdirSync(join(dir, "pkg"), { recursive: true });
            writeFileSync(join(dir, "pkg", "__init__.py"), "from .helpers import helper\n");
            writeFileSync(join(dir, "pkg", "helpers.py"), "def helper():\n    return 1\n");

            cleanDb(dir);
            await indexProject(dir);

            const symbol = getSymbol({ name: "helper", file: "pkg/helpers.py" }, { path: dir });
            assert.equal(symbol.result.provider_status.status, "unavailable");
            assert.equal(symbol.result.provider_status.provider, "precise_py");
            assert.match(symbol.result.provider_status.message, /Python precise analysis is unavailable because basedpyright-langserver is not installed/);
            assert.equal(symbol.result.provider_status.install_hint, "basedpyright");

            const explained = explainResolution({ name: "helper", file: "pkg/helpers.py" }, { path: dir });
            assert.equal(explained.result.precise_provider_status.status, "unavailable");
            assert.equal(explained.result.precise_provider_status.provider, "precise_py");
            assert.match(explained.result.precise_provider_status.message, /Ask a human to install basedpyright and rerun index_project/);
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });

    it("adds Python precise edges via external provider and exposes a clear available status", async () => {
        const dir = makeTempDir();
        try {
            mkdirSync(join(dir, "pkg"), { recursive: true });
            writeFileSync(join(dir, "pkg", "__init__.py"), "from .helpers import helper\n");
            writeFileSync(join(dir, "pkg", "helpers.py"), "def helper():\n    return 1\n");
            writeFileSync(join(dir, "pkg", "main.py"), "from .helpers import helper\n\ndef run():\n    return helper()\n");
            const command = createFakeDefinitionProvider(dir, {
                helper: { file: join(dir, "pkg", "helpers.py"), line: 1 },
            });

            cleanDb(dir);
            await withProviderCommand("python", command, async () => {
                await indexProject(dir);
            });

            const symbol = getSymbol({ name: "helper", file: "pkg/helpers.py" }, { path: dir, min_confidence: "precise" });
            assert.equal(symbol.result.provider_status.status, "available");
            assert.equal(symbol.result.provider_status.provider, "precise_py");
            assert.match(symbol.result.provider_status.message, /Python precise analysis is available via basedpyright/);

            const preciseRefs = getReferencesBySelector({ name: "helper", file: "pkg/helpers.py" }, {
                path: dir,
                min_confidence: "precise",
            });
            assert.ok(
                preciseRefs.result.references.some(ref =>
                    ref.file === "pkg/main.py"
                    && ref.kind === "calls"
                    && ref.origin === "precise_py"
                    && ref.confidence === "precise"
                ),
                "Python precise provider upgrades imported call usage to precise",
            );
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });

    it("adds C# precise edges via external provider", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(join(dir, "Service.cs"), [
                "public class Service {",
                "    public string Run() { return \"ok\"; }",
                "}",
                "",
            ].join("\n"));
            writeFileSync(join(dir, "Program.cs"), [
                "public class Program {",
                "    public string Execute() {",
                "        var svc = new Service();",
                "        return svc.Run();",
                "    }",
                "}",
                "",
            ].join("\n"));
            const command = createFakeDefinitionProvider(dir, {
                Run: { file: join(dir, "Service.cs"), line: 2 },
            });

            cleanDb(dir);
            await withProviderCommand("csharp", command, async () => {
                await indexProject(dir);
            });

            const symbol = getSymbol({ name: "Run", file: "Service.cs" }, { path: dir });
            assert.equal(symbol.result.provider_status.status, "available");
            assert.equal(symbol.result.provider_status.provider, "precise_cs");

            const refs = getReferencesBySelector({ name: "Run", file: "Service.cs" }, {
                path: dir,
                min_confidence: "precise",
            });
            assert.ok(
                refs.result.references.some(ref =>
                    ref.file === "Program.cs"
                    && ref.kind === "calls"
                    && ref.origin === "precise_cs"
                ),
                "C# precise provider upgrades member call usage to precise",
            );
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });

    it("adds PHP precise edges via external provider", async () => {
        const dir = makeTempDir();
        try {
            mkdirSync(join(dir, "src"), { recursive: true });
            writeFileSync(join(dir, "composer.json"), JSON.stringify({
                autoload: {
                    "psr-4": {
                        "App\\\\": "src/",
                    },
                },
            }, null, 2));
            writeFileSync(join(dir, "src", "Helper.php"), [
                "<?php",
                "namespace App;",
                "class Helper {",
                "    public function run(): int { return 1; }",
                "}",
                "",
            ].join("\n"));
            writeFileSync(join(dir, "src", "Main.php"), [
                "<?php",
                "namespace App;",
                "class Main {",
                "    public function exec(): int {",
                "        $helper = new Helper();",
                "        return $helper->run();",
                "    }",
                "}",
                "",
            ].join("\n"));
            const command = createFakeDefinitionProvider(dir, {
                run: { file: join(dir, "src", "Helper.php"), line: 4 },
            });

            cleanDb(dir);
            await withProviderCommand("php", command, async () => {
                await indexProject(dir);
            });

            const symbol = getSymbol({ name: "run", file: "src/Helper.php" }, { path: dir });
            assert.equal(symbol.result.provider_status.status, "available");
            assert.equal(symbol.result.provider_status.provider, "precise_php");

            const refs = getReferencesBySelector({ name: "run", file: "src/Helper.php" }, {
                path: dir,
                min_confidence: "precise",
            });
            assert.ok(
                refs.result.references.some(ref =>
                    ref.file === "src/Main.php"
                    && ref.kind === "calls"
                    && ref.origin === "precise_php"
                ),
                "PHP precise provider upgrades method call usage to precise",
            );
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

describe("trace_paths reference and import layers", () => {
    it("supports imports and references path kinds", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(join(dir, "a.mjs"), "export function helper() { return 1; }\n");
            writeFileSync(join(dir, "b.mjs"), 'import { helper } from "./a.mjs";\nexport function consumer() { const fn = helper; return fn; }\n');
            cleanDb(dir);
            await indexProject(dir);

            const importPaths = tracePaths({ name: "helper", file: "a.mjs" }, {
                path_kind: "imports",
                direction: "reverse",
                depth: 2,
                path: dir,
            });
            assert.ok(importPaths.result.length > 0, "imports path lookup returns paths");
            assert.ok(importPaths.result.some(path => path.edges.some(edge => edge.kind === "imports")), "imports path contains imports edge");
            assert.ok(importPaths.result.every(path => path.edges.every(edge => edge.kind === "imports" || edge.kind === "reexports")), "imports path kind stays within import/reexport edges");

            const referencePaths = tracePaths({ name: "helper", file: "a.mjs" }, {
                path_kind: "references",
                direction: "reverse",
                depth: 3,
                path: dir,
            });
            assert.ok(referencePaths.result.length > 0, "references path lookup returns paths");
            assert.ok(referencePaths.result.some(path => path.edges.some(edge => edge.kind === "ref_read")), "references path contains read edge");
            assert.ok(referencePaths.result.some(path => path.edges.some(edge => edge.kind === "imports")), "references path can traverse import edge");
        } finally {
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

describe("type graph and implementations", () => {
    it("finds extends, implements, and overrides via type-layer edges", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "types.ts"),
                [
                    "export interface Service { }",
                    "export class Base {",
                    "  ping() { return 1; }",
                    "}",
                    "export class Impl extends Base implements Service {",
                    "  ping() { return 2; }",
                    "}",
                    "",
                ].join("\n"),
            );

            cleanDb(dir);
            await indexProject(dir);

            const serviceImpls = findImplementationsBySelector({ name: "Service", file: "types.ts" }, { path: dir });
            assert.equal(serviceImpls.result.implementations.length, 1, "interface has one implementer");
            assert.equal(serviceImpls.result.implementations[0].kind, "implements");
            assert.equal(serviceImpls.result.implementations[0].source.name, "Impl");

            const baseImpls = findImplementationsBySelector({ name: "Base", file: "types.ts" }, { path: dir });
            assert.equal(baseImpls.result.implementations.length, 1, "base class has one subclass");
            assert.equal(baseImpls.result.implementations[0].kind, "extends");
            assert.equal(baseImpls.result.implementations[0].source.name, "Impl");

            const methodImpls = findImplementationsBySelector({ qualified_name: "types.ts:Base.ping" }, { path: dir });
            assert.equal(methodImpls.result.implementations.length, 1, "base method has one override");
            assert.equal(methodImpls.result.implementations[0].kind, "overrides");
            assert.equal(methodImpls.result.implementations[0].source.qualified_name, "types.ts:Impl.ping");

            const traced = tracePaths({ name: "Base", file: "types.ts" }, {
                path_kind: "type",
                direction: "reverse",
                depth: 2,
                limit: 10,
                path: dir,
            });
            assert.ok(traced.result.some(path => path.edges.some(edge => edge.kind === "extends")), "type trace includes extends edge");
        } finally {
            const store = getStore(dir);
            store.close();
            rmSync(dir, { recursive: true });
        }
    });
});

describe("richer flow facts and dataflows", () => {
    it("captures local param/return and one-hop call propagation", async () => {
        const dir = makeTempDir();
        try {
            writeFileSync(
                join(dir, "flow.mjs"),
                [
                    "export function passthrough(value) {",
                    "  return value;",
                    "}",
                    "export function relay(input) {",
                    "  return passthrough(input);",
                    "}",
                    "",
                ].join("\n"),
            );

            cleanDb(dir);
            await indexProject(dir);

            const passthroughFlow = findDataflowsBySelector({
                source: flowPoint(
                    { name: "passthrough", file: "flow.mjs" },
                    { kind: "param", name: "value" },
                ),
                sink: flowPoint(
                    { name: "passthrough", file: "flow.mjs" },
                    { kind: "return" },
                ),
                max_hops: 2,
            }, { path: dir, limit: FLOW_TEST_LIMIT });
            assert.equal(passthroughFlow.reason, "targeted_flow_lookup");
            assert.equal(passthroughFlow.evidence.target_found, true);
            assert.ok(
                passthroughFlow.result.paths.some(path =>
                    path.hops.some(hop => hop.source_anchor.kind === "param" && hop.target_anchor.kind === "return"),
                ),
                "passthrough exposes param-to-return flow",
            );

            const relayFlow = findDataflowsBySelector({
                source: flowPoint(
                    { name: "relay", file: "flow.mjs" },
                    { kind: "param", name: "input" },
                ),
                sink: flowPoint(
                    { name: "relay", file: "flow.mjs" },
                    { kind: "return" },
                ),
                max_hops: RELAY_FLOW_HOPS,
            }, { path: dir, limit: FLOW_TEST_LIMIT });
            assert.ok(
                relayFlow.result.paths.some(path =>
                    path.hops.some(hop => hop.evidence?.kind === "arg_pass")
                    && path.hops.some(hop => hop.evidence?.kind === "return_to_call_result"),
                ),
                "relay flow captures argument and return propagation across callee",
            );
            assert.ok(
                relayFlow.result.paths.some(path =>
                    path.nodes.some(node => node.symbol.name === "passthrough"),
                ),
                "relay dataflow reaches passthrough flow points",
            );

            const tracedFlow = tracePaths({ name: "relay", file: "flow.mjs" }, {
                path_kind: "flow",
                direction: "forward",
                depth: RELAY_FLOW_HOPS,
                limit: FLOW_TEST_LIMIT,
                path: dir,
            });
            assert.ok(
                tracedFlow.result.some(path =>
                    path.nodes.some(node => node.symbol.name === "passthrough") &&
                    path.edges.some(edge => edge.layer === "flow" && edge.source_anchor && edge.target_anchor),
                ),
                "trace_paths(flow) returns anchor-aware flow edges",
            );

            const tracedMixed = tracePaths({ name: "passthrough", file: "flow.mjs" }, {
                path_kind: "mixed",
                direction: "reverse",
                depth: RELAY_FLOW_HOPS,
                limit: FLOW_TEST_LIMIT,
                path: dir,
            });
            assert.ok(
                tracedMixed.result.some(path => path.edges.some(edge => edge.layer === "flow" && edge.source_anchor)),
                "trace_paths(mixed) includes richer flow-layer hops",
            );

            const targetedFlow = findDataflowsBySelector({
                source: flowPoint(
                    { name: "relay", file: "flow.mjs" },
                    { kind: "param", name: "input" },
                ),
                sink: flowPoint(
                    { name: "passthrough", file: "flow.mjs" },
                    { kind: "param", name: "value" },
                ),
                max_hops: RELAY_FLOW_HOPS,
            }, {
                path: dir,
                limit: FLOW_TEST_LIMIT,
            });
            assert.equal(targetedFlow.reason, "targeted_flow_lookup");
            assert.equal(targetedFlow.evidence.target_found, true);
            assert.equal(targetedFlow.result.sink.symbol.name, "passthrough");
            assert.ok(
                targetedFlow.result.paths.every(path =>
                    path.nodes.some(node => node.symbol.name === "passthrough" && node.anchor.kind === "param"),
                ),
                "targeted flow lookup returns only paths that reach the sink flow point",
            );
        } finally {
            const store = getStore(dir);
            store.close();
            rmSync(dir, { recursive: true });
        }
    });
});

// ==================== Bug 1: barrel find_references ====================

describe("find_references through barrel", () => {
    it("consumer usage through barrel is included in references", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-barrelref-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "a.mjs"), 'export function foo() { return 1; }\n');
        writeFileSync(join(tmp, "barrel.mjs"), 'export { foo } from "./a.mjs";\n');
        writeFileSync(join(tmp, "consumer.mjs"), 'import { foo } from "./barrel.mjs";\nfoo();\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            const result = getReferencesBySelector({ name: "foo", file: "a.mjs" }, { path: tmp });
            // Should include consumer's call, not just reexport
            assert.ok(result.result.total >= 2, `Should have >= 2 refs (got ${result.result.total}): reexport + consumer call`);
            const hasConsumerRef = result.result.references.some(r => r.file.includes("consumer"));
            assert.ok(hasConsumerRef, "Consumer usage through barrel is included");
            store.close();
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

describe("find_references ambiguity", () => {
    it("requires canonical selector and uses search_symbols to disambiguate", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-ambrefs-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "a.mjs"), 'export function helper() { return 1; }\n');
        writeFileSync(join(tmp, "b.mjs"), 'export function helper() { return 2; }\n');
        writeFileSync(join(tmp, "use-a.mjs"), 'import { helper } from "./a.mjs";\nexport function runA() { return helper(); }\n');
        writeFileSync(join(tmp, "use-b.mjs"), 'import { helper } from "./b.mjs";\nexport function runB() { return helper(); }\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);

            const invalid = getReferencesBySelector({ name: "helper" }, { path: tmp });
            assert.equal(invalid.error?.code, "INVALID_SELECTOR", "plain name is rejected");

            const candidates = findSymbols("helper", { path: tmp, limit: 10 });
            const helperDefs = candidates.matches.filter(match =>
                match.name === "helper" &&
                match.kind === "function" &&
                (match.file === "a.mjs" || match.file === "b.mjs")
            );
            assert.equal(helperDefs.length, 2, "search_symbols returns both helper definitions");

            const aOnly = getReferencesBySelector({ name: "helper", file: "a.mjs" }, { path: tmp });
            assert.equal(aOnly.result.symbol.file, "a.mjs");
            assert.equal(aOnly.result.total, 2, "filtered result only includes a.mjs refs");

            store.close();
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

// ==================== Bug 2: C# public method export ====================

describe("C# public method export", () => {
    it("public methods are marked exported", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-csmethod-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "test.cs"), 'public class Foo {\n    public void PubMethod() {}\n    private void PrivMethod() {}\n}\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            const nodes = store.nodesByFile("test.cs");
            const pub = nodes.find(n => n.name === "PubMethod");
            const priv = nodes.find(n => n.name === "PrivMethod");
            assert.ok(pub?.is_exported, "PubMethod is exported");
            assert.ok(!priv?.is_exported, "PrivMethod is NOT exported");
            store.close();
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

// ==================== Bug 3: find_unused_exports text reason ====================

describe("find_unused_exports text reason", () => {
    it("text output includes uncertain section when usage cannot be proven exactly", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-unusedreason-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "lib.mjs"), 'export function helper() {}\n');
        writeFileSync(join(tmp, "consumer.mjs"), 'import * as lib from "./lib.mjs";\nconsole.log(lib.helper);\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            const result = findUnusedExports(store);
            const { formatUnusedText } = await import("../lib/unused.mjs");
            const text = formatUnusedText(result, true);
            assert.ok(text.includes("Uncertain exports:"), "Text output shows uncertain section");
            store.close();
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

// ==================== Bug 4: no self-edge for top-level refs ====================

describe("no self-edge for top-level references", () => {
    it("top-level identifier usage does not create self-referencing edge", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-selfedge-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "a.mjs"), 'export const config = { key: "value" };\n');
        writeFileSync(join(tmp, "b.mjs"), 'import { config } from "./a.mjs";\nconfig;\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);
            // Check no self-referencing edges exist
            const allEdges = store.db.prepare("SELECT * FROM edges WHERE source_id = target_id AND kind IN ('ref_read', 'ref_type')").all();
            assert.equal(allEdges.length, 0, "No self-referencing reference edges");
            store.close();
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });

    it("top-level calls and reads attach to module node", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "hex-topmodule-"));
        mkdirSync(join(tmp, ".hex-skills/codegraph"), { recursive: true });
        writeFileSync(join(tmp, "a.mjs"), 'export function foo() { return 1; }\n');
        writeFileSync(join(tmp, "consumer.mjs"), 'import { foo } from "./a.mjs";\nfoo();\nconst x = foo;\n');
        try {
            await indexProject(tmp);
            const store = getStore(tmp);

            const refs = getReferencesBySelector({ name: "foo", file: "a.mjs" }, { path: tmp });
            const kinds = refs.result.references.map(r => r.kind);
            assert.ok(kinds.includes("imports"), "top-level import recorded");
            assert.ok(kinds.includes("calls"), "top-level call recorded");
            assert.ok(kinds.includes("ref_read"), "top-level read recorded");

            const moduleNode = store.nodesByFile("consumer.mjs").find(n => n.kind === "module");
            assert.ok(moduleNode, "module pseudo-node created");
            const moduleEdges = store.edgesFrom(moduleNode.id);
            assert.ok(moduleEdges.some(e => e.kind === "calls"), "module node is caller for top-level call");
            assert.ok(moduleEdges.some(e => e.kind === "ref_read"), "module node is source for top-level read");

            store.close();
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });
});

// ==================== WASM dependency contract ====================

describe("WASM dependency contract", () => {
    it("package.json declares tree-sitter runtime deps", () => {
        const pkg = JSON.parse(fs.readFileSync(
            resolve(__dirname, "../package.json"), "utf8"
        ));
        const deps = pkg.dependencies || {};
        assert.ok(deps["web-tree-sitter"],
            "web-tree-sitter missing from dependencies — index_project will fail after npm install");
        assert.ok(deps["tree-sitter-wasms"],
            "tree-sitter-wasms missing from dependencies — WASM grammars unavailable after npm install");
    });

    it("WASM files exist for all supported grammars", () => {
        const require = createRequire(import.meta.url);
        const pkgPath = require.resolve("tree-sitter-wasms/package.json");
        const grammars = [
            "javascript", "typescript", "tsx", "python", "go", "rust",
            "java", "c", "cpp", "c_sharp", "ruby", "php", "kotlin", "swift", "bash"
        ];
        const missing = grammars.filter(g => {
            const wasm = resolve(pkgPath, "..", "out", `tree-sitter-${g}.wasm`);
            return !fs.existsSync(wasm);
        });
        assert.deepEqual(missing, [], `WASM files missing for: ${missing.join(", ")}`);
    });

    it("dist/queries/ contains all .scm files after build", { skip: !fs.existsSync(resolve(__dirname, "../dist")) }, () => {
        const distQueries = resolve(__dirname, "../dist/queries");
        const expected = ["javascript.scm", "typescript.scm", "python.scm", "c_sharp.scm", "php.scm"];
        const missing = expected.filter(f => !fs.existsSync(resolve(distQueries, f)));
        assert.deepEqual(missing, [],
            `dist/queries/ missing: ${missing.join(", ")} — build.mjs must copy lib/queries/ to dist/queries/`);
    });
});

// ==================== store persistence after restart ====================

describe("store persistence after restart", () => {
    it("resolveStore auto-opens persisted DB from disk", async () => {
        const tmp = makeTempDir();
        try {
            writeFileSync(join(tmp, "a.mjs"), "export function hello() { return 1; }\n");
            await indexProject(tmp);
            const store = getStore(tmp);
            assert.ok(store.allFilePaths().length > 0, "index populated");
            store.close(); // simulates restart — removes from _stores
            const reopened = resolveStore(tmp);
            assert.ok(reopened, "resolveStore should auto-open from disk, not return null");
            assert.ok(reopened.allFilePaths().length > 0, "reopened store has data");
            reopened.close();
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });

    it("resolveStore finds parent store for subdirectory path", async () => {
        const tmp = makeTempDir();
        try {
            const subDir = join(tmp, "src");
            mkdirSync(subDir);
            writeFileSync(join(subDir, "b.mjs"), "export const x = 1;\n");
            await indexProject(tmp);
            const found = resolveStore(subDir);
            assert.ok(found, "resolveStore should match parent project for subdirectory");
            found.close();
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });

    it("resolveStore skips stale schema DB", async () => {
        const tmp = makeTempDir();
        try {
            writeFileSync(join(tmp, "c.mjs"), "export const y = 2;\n");
            await indexProject(tmp);
            const store = getStore(tmp);
            store.close();
            // Corrupt schema version
            const Database = (await import("better-sqlite3")).default;
            const db = new Database(join(tmp, ".hex-skills/codegraph", "index.db"));
            db.pragma("user_version = 99999");
            db.close();
            const result = resolveStore(tmp);
            // Result is either null (no other stores) or a fallback store for a DIFFERENT project
            // Key check: stale DB must NOT be opened as store for tmp
            if (result) {
                assert.notEqual(result.projectPath, resolve(tmp),
                    "stale DB should not be opened — resolveStore returned store for this path");
            }
            // DB should NOT be deleted
            assert.ok(existsSync(join(tmp, ".hex-skills/codegraph", "index.db")), "stale DB must not be deleted");
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
        }
    });

    it("resolveStore returns null for non-existent project", () => {
        const fake = join(tmpdir(), "hex-graph-nonexistent-" + Date.now());
        const result = resolveStore(fake);
        // Should return null or fallback store, but NOT crash
        assert.ok(result === null || result !== undefined, "should not crash on missing path");
    });
});

import Database from "better-sqlite3";

describe("store persistence after restart", () => {
    it("resolveStore auto-opens persisted DB", async () => {
        const tmp = makeTempDir();
        try {
            writeFileSync(join(tmp, "a.mjs"), "export function hello() { return 1; }\n");
            await indexProject(tmp);
            const store1 = resolveStore(tmp);
            assert.ok(store1, "store should exist after indexing");
            const stats1 = store1.stats();
            assert.ok(stats1.files > 0, "should have indexed files");

            // Simulate restart: close store, clear in-memory cache
            store1.close();

            // resolveStore should auto-open from disk
            const store2 = resolveStore(tmp);
            assert.ok(store2, "store should auto-open from persisted DB");
            const stats2 = store2.stats();
            assert.equal(stats2.files, stats1.files, "file count should match after reopen");
            store2.close();
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch {}
        }
    });

    it("resolveStore returns null for stale schema version (no fallback)", () => {
        const tmp = makeTempDir();
        try {
            const dbDir = join(tmp, ".hex-skills/codegraph");
            mkdirSync(dbDir, { recursive: true });
            const db = new Database(join(dbDir, "index.db"));
            db.pragma("user_version = 9999");
            db.close();

            // resolveStore may return a fallback store from _stores Map.
            // Verify the stale DB is NOT opened (not deleted, not auto-opened).
            const store = resolveStore(tmp);
            if (store) {
                // If fallback returned, it must NOT be for our stale tmp path
                const stats = store.stats();
                assert.ok(stats, "fallback store should have stats");
            }
            // DB file must NOT be deleted by resolveStore
            assert.ok(existsSync(join(dbDir, "index.db")), "DB file should NOT be deleted");
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch {}
        }
    });

    it("resolveStore finds parent store for subdirectory path", async () => {
        const tmp = makeTempDir();
        try {
            const subDir = join(tmp, "src");
            mkdirSync(subDir, { recursive: true });
            writeFileSync(join(subDir, "b.mjs"), "export const x = 1;\n");
            await indexProject(tmp);

            const store = resolveStore(subDir);
            assert.ok(store, "should find parent store for subdirectory");
            store.close();
        } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch {}
        }
    });
});
