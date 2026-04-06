import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import { indexProject } from "../lib/indexer.mjs";
import { exportScip } from "../lib/scip/export.mjs";
import { importScipOverlay } from "../lib/scip/import.mjs";
import { buildExternalExportPlan, exportExternalScip, exportToolInfo } from "../lib/scip/external.mjs";
import {
    DocumentSchema,
    IndexSchema,
    MetadataSchema,
    OccurrenceSchema,
    PositionEncoding,
    ProtocolVersion,
    SymbolInformation_Kind,
    SymbolInformationSchema,
    SymbolRole,
    ToolInfoSchema,
} from "../lib/scip/vendor/scip_pb.js";
import { getReferencesBySelector } from "../lib/store.mjs";

function makeTempProject(prefix = "hex-graph-scip-") {
    return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(dir) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore Windows cleanup races */ }
}

function writeTypeScriptFixture(dir) {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "hex-graph-scip-fixture",
        version: "1.0.0",
        packageManager: "npm@10.0.0",
    }, null, 2));
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
        },
        include: ["src/**/*.ts"],
    }, null, 2));
    writeFileSync(join(dir, "src", "util.ts"), [
        "export function helper(name: string) {",
        "  return name.trim();",
        "}",
        "",
        "export class Greeter {",
        "  greet() {",
        "    return helper(\"fixture\");",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeFileSync(join(dir, "src", "main.ts"), [
        "import { helper } from \"./util\";",
        "",
        "export function run() {",
        "  return helper(\"hello\");",
        "}",
        "",
    ].join("\n"));
}

function writePythonFixture(dir) {
    mkdirSync(join(dir, "pkg"), { recursive: true });
    writeFileSync(join(dir, "pyproject.toml"), [
        "[project]",
        "name = \"hex-graph-python-fixture\"",
        "version = \"0.1.0\"",
        "",
    ].join("\n"));
    writeFileSync(join(dir, "pkg", "helpers.py"), [
        "def helper(name):",
        "    return name.strip()",
        "",
    ].join("\n"));
    writeFileSync(join(dir, "pkg", "main.py"), [
        "from pkg.helpers import helper",
        "",
        "def run():",
        "    return helper(\"hello\")",
        "",
    ].join("\n"));
}

function writePhpFixture(dir) {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "vendor"), { recursive: true });
    writeFileSync(join(dir, "composer.json"), JSON.stringify({
        name: "acme/hex-graph-php-fixture",
        version: "1.0.0",
    }, null, 2));
    writeFileSync(join(dir, "composer.lock"), JSON.stringify({ packages: [] }, null, 2));
    writeFileSync(join(dir, "vendor", "autoload.php"), "<?php\n");
    mkdirSync(join(dir, "vendor", "bin"), { recursive: true });
    writeFileSync(join(dir, "vendor", "bin", "scip-php"), "");
    writeFileSync(join(dir, "src", "helpers.php"), [
        "<?php",
        "function helper(string $name): string {",
        "    return trim($name);",
        "}",
        "",
    ].join("\n"));
    writeFileSync(join(dir, "src", "main.php"), [
        "<?php",
        "require_once __DIR__ . '/helpers.php';",
        "",
        "function run(): string {",
        "    return helper('hello');",
        "}",
        "",
    ].join("\n"));
}

function writeCSharpFixture(dir) {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "fixture.sln"), "\n");
    writeFileSync(join(dir, "src", "Fixture.csproj"), [
        "<Project Sdk=\"Microsoft.NET.Sdk\">",
        "  <PropertyGroup>",
        "    <TargetFramework>net8.0</TargetFramework>",
        "  </PropertyGroup>",
        "</Project>",
        "",
    ].join("\n"));
    writeFileSync(join(dir, "src", "Util.cs"), [
        "namespace Fixture;",
        "",
        "public static class Util",
        "{",
        "    public static string Helper(string name)",
        "    {",
        "        return name.Trim();",
        "    }",
        "}",
        "",
    ].join("\n"));
    writeFileSync(join(dir, "src", "Program.cs"), [
        "namespace Fixture;",
        "",
        "public static class Runner",
        "{",
        "    public static string Run()",
        "    {",
        "        return Util.Helper(\"hello\");",
        "    }",
        "}",
        "",
    ].join("\n"));
}

function writeScipArtifact(path, { projectRoot, documents }) {
    const artifact = create(IndexSchema, {
        metadata: create(MetadataSchema, {
            version: ProtocolVersion.UnspecifiedProtocolVersion,
            toolInfo: create(ToolInfoSchema, {
                name: "fixture-indexer",
                version: "1.0.0",
                arguments: ["fixture"],
            }),
            projectRoot,
        }),
        documents,
        externalSymbols: [],
    });
    writeFileSync(path, toBinary(IndexSchema, artifact));
}

function symbolInfo(symbol, displayName, kind) {
    return create(SymbolInformationSchema, {
        symbol,
        displayName,
        kind,
    });
}

function definitionOccurrence(symbol, range) {
    return create(OccurrenceSchema, {
        range,
        symbol,
        symbolRoles: SymbolRole.Definition,
    });
}

function referenceOccurrence(symbol, range, enclosingRange, roles = SymbolRole.ReadAccess) {
    return create(OccurrenceSchema, {
        range,
        symbol,
        symbolRoles: roles,
        enclosingRange,
    });
}

function pythonArtifactDocuments() {
    const helperSymbol = "scip-python pip hex-graph-python-fixture 0.1.0 pkg/helpers/helper.";
    return [
        create(DocumentSchema, {
            language: "Python",
            relativePath: "pkg/helpers.py",
            positionEncoding: PositionEncoding.UTF32CodeUnitOffsetFromLineStart,
            occurrences: [
                definitionOccurrence(helperSymbol, [0, 4, 10]),
            ],
            symbols: [
                symbolInfo(helperSymbol, "helper", SymbolInformation_Kind.Function),
            ],
        }),
        create(DocumentSchema, {
            language: "Python",
            relativePath: "pkg/main.py",
            positionEncoding: PositionEncoding.UTF32CodeUnitOffsetFromLineStart,
            occurrences: [
                referenceOccurrence(helperSymbol, [0, 24, 30], [0, 0, 0, 30], SymbolRole.Import),
                referenceOccurrence(helperSymbol, [3, 11, 17], [2, 0, 3, 26]),
            ],
            symbols: [],
        }),
    ];
}

function phpArtifactDocuments() {
    const helperSymbol = "scip-php composer acme/hex-graph-php-fixture 1.0.0 src/helpers/helper.";
    return [
        create(DocumentSchema, {
            language: "PHP",
            relativePath: "src/helpers.php",
            positionEncoding: PositionEncoding.UTF8CodeUnitOffsetFromLineStart,
            occurrences: [
                definitionOccurrence(helperSymbol, [1, 9, 15]),
            ],
            symbols: [
                symbolInfo(helperSymbol, "helper", SymbolInformation_Kind.Function),
            ],
        }),
        create(DocumentSchema, {
            language: "PHP",
            relativePath: "src/main.php",
            positionEncoding: PositionEncoding.UTF8CodeUnitOffsetFromLineStart,
            occurrences: [
                referenceOccurrence(helperSymbol, [3, 11, 17], [3, 0, 4, 1]),
            ],
            symbols: [],
        }),
    ];
}

function csharpArtifactDocuments() {
    const helperSymbol = "scip-dotnet nuget Fixture 1.0.0 src/Util/Util#Helper().";
    return [
        create(DocumentSchema, {
            language: "C#",
            relativePath: "src/Util.cs",
            positionEncoding: PositionEncoding.UTF16CodeUnitOffsetFromLineStart,
            occurrences: [
                definitionOccurrence(helperSymbol, [4, 25, 31]),
            ],
            symbols: [
                symbolInfo(helperSymbol, "Helper", SymbolInformation_Kind.Method),
            ],
        }),
        create(DocumentSchema, {
            language: "C#",
            relativePath: "src/Program.cs",
            positionEncoding: PositionEncoding.UTF16CodeUnitOffsetFromLineStart,
            occurrences: [
                referenceOccurrence(helperSymbol, [6, 20, 26], [4, 4, 6, 33]),
            ],
            symbols: [],
        }),
        create(DocumentSchema, {
            language: "VisualBasic",
            relativePath: "src/Legacy.vb",
            positionEncoding: PositionEncoding.UTF16CodeUnitOffsetFromLineStart,
            occurrences: [],
            symbols: [],
        }),
    ];
}

describe("SCIP interop", () => {
    it("reports MCP package metadata from the package root", () => {
        const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        assert.deepEqual(exportToolInfo(), {
            name: "hex-graph-mcp",
            version: packageJson.version,
        });
    });

    it("exports a valid binary SCIP artifact for indexed TypeScript projects", async () => {
        const dir = makeTempProject();
        try {
            writeTypeScriptFixture(dir);
            await indexProject(dir);

            const summary = await exportScip({
                path: dir,
                outputPath: "artifacts/fixture.scip",
                includeExternalSymbols: false,
            });

            const artifact = fromBinary(IndexSchema, readFileSync(summary.artifact_path));
            assert.equal(summary.document_count, 2);
            assert.ok(summary.occurrence_count >= 4, "export emits occurrences");
            assert.ok(summary.symbol_count >= 3, "export emits symbol definitions");
            assert.equal(summary.package.name, "hex-graph-scip-fixture");
            assert.deepEqual(summary.artifact_languages.sort(), ["typescript"]);
            assert.equal(artifact.documents.length, 2);
            assert.ok(artifact.documents.some(document => document.relativePath === "src/main.ts"));
            assert.ok(artifact.documents.some(document => document.symbols.some(info => info.displayName === "helper")));
        } finally {
            cleanup(dir);
        }
    });

    it("imports TypeScript SCIP as provenance-tagged overlay edges without replacing native references", async () => {
        const dir = makeTempProject();
        try {
            writeTypeScriptFixture(dir);
            await indexProject(dir);
            const exportResult = await exportScip({
                path: dir,
                outputPath: "artifacts/fixture.scip",
                includeExternalSymbols: false,
            });

            const before = getReferencesBySelector({ name: "helper", file: "src/util.ts" }, { path: dir, limit: 50 });
            assert.ok(before.result.references.some(reference => reference.origin !== "scip_import"), "native references exist before import");

            const firstImport = await importScipOverlay({
                path: dir,
                artifactPath: exportResult.artifact_path,
                replaceExisting: true,
            });
            assert.ok(firstImport.imported_reference_edges >= 1, "import inserts overlay references");

            const afterFirstImport = getReferencesBySelector({ name: "helper", file: "src/util.ts" }, { path: dir, limit: 50 });
            const firstImportedCount = afterFirstImport.result.references.filter(reference => reference.origin === "scip_import").length;
            assert.ok(firstImportedCount >= 1, "references expose imported provenance");
            assert.ok(afterFirstImport.result.references.some(reference => reference.origin !== "scip_import"), "native references remain visible");

            await importScipOverlay({
                path: dir,
                artifactPath: exportResult.artifact_path,
                replaceExisting: true,
            });
            const afterSecondImport = getReferencesBySelector({ name: "helper", file: "src/util.ts" }, { path: dir, limit: 50 });
            const secondImportedCount = afterSecondImport.result.references.filter(reference => reference.origin === "scip_import").length;
            assert.equal(secondImportedCount, firstImportedCount, "replace_existing avoids duplicate imported edges");
        } finally {
            cleanup(dir);
        }
    });

    it("builds a Python external export plan from project metadata", () => {
        const dir = makeTempProject("hex-graph-scip-py-plan-");
        try {
            writePythonFixture(dir);
            const plan = buildExternalExportPlan({
                language: "python",
                path: dir,
                outputPath: "artifacts/python.scip",
                options: {
                    projectNamespace: "pkg",
                    targetOnly: "pkg",
                    environmentPath: "env.json",
                },
            });
            assert.equal(plan.backend, "scip-python");
            assert.equal(plan.binary, "scip-python");
            assert.equal(plan.projectName, "hex-graph-python-fixture");
            assert.ok(plan.args.includes("--project-namespace=pkg"));
            assert.ok(plan.args.includes("--target-only=pkg"));
            assert.ok(plan.args.includes("--environment=env.json"));
        } finally {
            cleanup(dir);
        }
    });

    it("honors HEX_GRAPH_SCIP_PYTHON_BINARY when building the Python export plan", () => {
        const dir = makeTempProject("hex-graph-scip-py-binary-");
        const previous = process.env.HEX_GRAPH_SCIP_PYTHON_BINARY;
        try {
            writePythonFixture(dir);
            process.env.HEX_GRAPH_SCIP_PYTHON_BINARY = "patched-scip-python";
            const plan = buildExternalExportPlan({
                language: "python",
                path: dir,
                outputPath: "artifacts/python.scip",
            });
            assert.equal(plan.binary, "patched-scip-python");
        } finally {
            if (previous === undefined) {
                delete process.env.HEX_GRAPH_SCIP_PYTHON_BINARY;
            } else {
                process.env.HEX_GRAPH_SCIP_PYTHON_BINARY = previous;
            }
            cleanup(dir);
        }
    });

    it("builds PHP and C# external export plans with upstream binaries", () => {
        const phpDir = makeTempProject("hex-graph-scip-php-plan-");
        const csDir = makeTempProject("hex-graph-scip-cs-plan-");
        try {
            writePhpFixture(phpDir);
            writeCSharpFixture(csDir);
            const phpPlan = buildExternalExportPlan({
                language: "php",
                path: phpDir,
                outputPath: "artifacts/php.scip",
            });
            const csharpPlan = buildExternalExportPlan({
                language: "csharp",
                path: csDir,
                outputPath: "artifacts/csharp.scip",
                options: { workingDirectory: "src" },
            });
            assert.equal(phpPlan.backend, "scip-php");
            assert.equal(phpPlan.command, "php");
            assert.match(
                phpPlan.binary.replaceAll("\\", "/"),
                /vendor\/bin\/scip-php(?:\.(?:bat|cmd))?$/,
            );
            assert.equal(phpPlan.args.length, 1);
            assert.match(
                phpPlan.args[0].replaceAll("\\", "/"),
                /vendor\/bin\/scip-php(?:\.(?:bat|cmd))?$/,
            );
            assert.equal(csharpPlan.backend, "scip-dotnet");
            assert.deepEqual(csharpPlan.args, ["index", "--working-directory", "src"]);
        } finally {
            cleanup(phpDir);
            cleanup(csDir);
        }
    });

    it("fails fast on invalid external export project roots before spawning indexers", async () => {
        const pythonDir = makeTempProject("hex-graph-scip-py-invalid-");
        const phpDir = makeTempProject("hex-graph-scip-php-invalid-");
        const csDir = makeTempProject("hex-graph-scip-cs-invalid-");
        try {
            await assert.rejects(
                exportExternalScip({ language: "python", path: pythonDir, outputPath: "artifact.scip" }),
                /No Python source files found/,
            );
            writeFileSync(join(phpDir, "composer.json"), "{}");
            await assert.rejects(
                exportExternalScip({ language: "php", path: phpDir, outputPath: "artifact.scip" }),
                /composer\.json and composer\.lock/,
            );
            await assert.rejects(
                exportExternalScip({ language: "csharp", path: csDir, outputPath: "artifact.scip" }),
                /\.sln or \.csproj/,
            );
        } finally {
            cleanup(pythonDir);
            cleanup(phpDir);
            cleanup(csDir);
        }
    });

    it("imports Python SCIP artifacts using UTF32 documents", async () => {
        const dir = makeTempProject("hex-graph-scip-py-");
        try {
            writePythonFixture(dir);
            await indexProject(dir);
            const artifactPath = join(dir, "artifacts", "python.scip");
            mkdirSync(join(dir, "artifacts"), { recursive: true });
            writeScipArtifact(artifactPath, {
                projectRoot: dir,
                documents: pythonArtifactDocuments(),
            });

            const result = await importScipOverlay({
                path: dir,
                artifactPath,
                replaceExisting: true,
            });
            assert.deepEqual(result.artifact_languages, ["python"]);
            assert.ok(result.imported_reference_edges >= 2, "python import includes import and call references");

            const references = getReferencesBySelector({ name: "helper", file: "pkg/helpers.py" }, { path: dir, limit: 50 });
            assert.ok(references.result.references.some(reference => reference.origin === "scip_import"), "python references surface imported provenance");
        } finally {
            cleanup(dir);
        }
    });

    it("imports PHP SCIP artifacts using composer-root metadata", async () => {
        const dir = makeTempProject("hex-graph-scip-php-");
        try {
            writePhpFixture(dir);
            await indexProject(dir);
            const artifactPath = join(dir, "artifacts", "php.scip");
            mkdirSync(join(dir, "artifacts"), { recursive: true });
            writeScipArtifact(artifactPath, {
                projectRoot: dir,
                documents: phpArtifactDocuments(),
            });

            const result = await importScipOverlay({
                path: dir,
                artifactPath,
                replaceExisting: true,
            });
            assert.deepEqual(result.artifact_languages, ["php"]);
            assert.ok(result.imported_reference_edges >= 1, "php import includes reference edges");

            const references = getReferencesBySelector({ name: "helper", file: "src/helpers.php" }, { path: dir, limit: 50 });
            assert.ok(references.result.references.some(reference => reference.origin === "scip_import"), "php references surface imported provenance");
        } finally {
            cleanup(dir);
        }
    });

    it("imports C# SCIP artifacts and skips unsupported Visual Basic documents", async () => {
        const dir = makeTempProject("hex-graph-scip-cs-");
        try {
            writeCSharpFixture(dir);
            await indexProject(dir);
            const artifactPath = join(dir, "artifacts", "csharp.scip");
            mkdirSync(join(dir, "artifacts"), { recursive: true });
            writeScipArtifact(artifactPath, {
                projectRoot: dir,
                documents: csharpArtifactDocuments(),
            });

            const result = await importScipOverlay({
                path: dir,
                artifactPath,
                replaceExisting: true,
            });
            assert.deepEqual(result.artifact_languages, ["csharp"]);
            assert.equal(result.skipped_documents, 1, "unsupported Visual Basic docs are skipped");
            assert.ok(result.imported_reference_edges >= 1, "csharp import includes reference edges");

            const references = getReferencesBySelector({ name: "Helper", file: "src/Util.cs" }, { path: dir, limit: 50 });
            assert.ok(references.result.references.some(reference => reference.origin === "scip_import"), "csharp references surface imported provenance");
        } finally {
            cleanup(dir);
        }
    });
});
