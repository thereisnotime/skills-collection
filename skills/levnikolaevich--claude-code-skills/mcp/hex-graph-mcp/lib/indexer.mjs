/**
 * 4-pass indexing pipeline for code knowledge graph.
 *
 * Pass 0: PURGE — remove files no longer on disk (CASCADE cleanup)
 * Pass 1: SCAN — walk directory, skip unchanged files (mtime check)
 * Pass 2: PARSE — tree-sitter AST -> definitions + imports + calls
 * Pass 3: RESOLVE — link imports to target files, build call edges
 *
 * Idempotent: re-running skips unchanged files.
 * Incremental: can reindex a single file (for watcher).
 */

import { readFileSync, statSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, extname, relative, join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { getStore, CODEGRAPH_DIR } from "./store.mjs";
import { parseFile, languageFor, supportedExtensions } from "./parser.mjs";

const IGNORE_DIRS = new Set([
    "node_modules", ".git", "dist", "build", "out", ".next",
    "__pycache__", ".venv", "venv", "vendor", "target",
    CODEGRAPH_DIR, ".vs", "bin", "obj", "packages",
]);

const MAX_FILE_SIZE = 500_000; // 500KB

/**
 * Index a project.
 * @param {string} projectPath
 * @param {object} [options]
 * @param {string[]} [options.languages] - filter by language names
 * @returns {Promise<string>} summary message
 */
export async function indexProject(projectPath, { languages } = {}) {
    const absPath = resolve(projectPath);
    const t0 = Date.now();

    // Ensure .hex-skills/codegraph dir exists
    const dbDir = join(absPath, CODEGRAPH_DIR);
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

    const store = getStore(absPath);

    // Filter extensions by language if specified
    const allowedExts = languages
        ? supportedExtensions().filter(ext => languages.includes(languageFor(ext)))
        : supportedExtensions();
    const allowedSet = new Set(allowedExts);

    // Pass 0: PURGE deleted files
    const existingPaths = store.allFilePaths();
    let purged = 0;
    for (const p of existingPaths) {
        const fullPath = resolve(absPath, p);
        if (!existsSync(fullPath)) {
            store.deleteFile(p);
            purged++;
        }
    }
    if (purged > 0) store.cleanupOrphanModuleEdges();

    // Pass 1: SCAN
    const filesToIndex = [];
    walkDir(absPath, absPath, allowedSet, store, filesToIndex);

    // Pass 2: PARSE
    let parsed = 0;
    const fileNodeMap = new Map(); // relPath -> { definitions, imports, calls, language }

    for (const { relPath, fullPath, mtime } of filesToIndex) {
        let source;
        try {
            source = readFileSync(fullPath, "utf-8").replace(/\r\n/g, "\n");
        } catch {
            continue;
        }

        const hash = createHash("md5").update(source).digest("hex").slice(0, 12);
        const ext = extname(relPath).toLowerCase();
        const language = languageFor(ext);

        const result = await parseFile(fullPath, source, { cloneDetection: true });
        const { definitions, imports, calls, references } = result;

        // Bulk insert definitions + imports
        const nodeIds = store.bulkInsert(relPath, mtime, hash, language, definitions, imports);

        // Insert clone detection data
        persistCloneData(store, definitions, nodeIds);

        fileNodeMap.set(relPath, { source, definitions, imports, calls, references, exports: result.exports, defaultExport: result.defaultExport, reexports: result.reexports, language, nodeIds });
        parsed++;
    }

    // Pass 3: RESOLVE — build edges (import, call, reexport)
    let edgeCount = 0;
    for (const [filePath, data] of fileNodeMap) {
        const { source, definitions, imports, calls, references, exports: fileExports, defaultExport, reexports, language, nodeIds } = data;
        edgeCount += resolveFileEdges(store, filePath, { source, definitions, imports, calls, references, exports: fileExports, defaultExport, reexports, nodeIds, language });
    }
    store.rebuildAllModuleLayerEdges();

    const elapsed = Date.now() - t0;
    const stats = store.stats();

    return [
        `Indexed ${stats.files} files, ${stats.nodes} symbols, ${stats.edges} edges in ${elapsed}ms`,
        purged > 0 ? `Purged ${purged} deleted files` : null,
        `Parsed ${parsed} files (${filesToIndex.length - parsed} skipped, unchanged)`,
        `Built ${edgeCount} new call edges`,
    ].filter(Boolean).join("\n");
}

/**
 * Reindex a single file (for watcher).
 * @param {string} projectPath
 * @param {string} filePath - relative to project
 */
export async function reindexFile(projectPath, filePath) {
    const absPath = resolve(projectPath);
    const fullPath = resolve(absPath, filePath);

    if (!existsSync(fullPath)) {
        const store = getStore(absPath);
        store.deleteFile(filePath);
        return;
    }

    const source = readFileSync(fullPath, "utf-8").replace(/\r\n/g, "\n");
    const hash = createHash("md5").update(source).digest("hex").slice(0, 12);
    const stat = statSync(fullPath);
    const language = languageFor(extname(filePath).toLowerCase());
    if (!language) return;

    const store = getStore(absPath);
    const { definitions, imports, calls, references, exports: fileExports, defaultExport, reexports } = await parseFile(fullPath, source, { cloneDetection: true });
    const nodeIds = store.bulkInsert(filePath, stat.mtimeMs, hash, language, definitions, imports);

    persistCloneData(store, definitions, nodeIds);
    resolveFileEdges(store, filePath, { source, definitions, imports, calls, references, exports: fileExports, defaultExport, reexports, nodeIds, language });
    store.rebuildAllModuleLayerEdges();
}

// --- Helpers ---

/**
 * Shared edge resolution for a single file.
 * Creates synthetic reexport nodes, builds import/call/reexport edges,
 * marks exported symbols, and persists module_edges.
 * @returns {number} count of call edges created
 */
function resolveFileEdges(store, filePath, { source, definitions, imports, calls, references, exports: fileExports, defaultExport, reexports, nodeIds, language }) {
    let callEdgeCount = 0;

    // 1. Create synthetic reexport nodes
    if (reexports && reexports.length > 0) {
        for (const re of reexports) {
            for (const spec of re.specifiers) {
                if (spec.type === "namespace" && spec.local === "*") continue;

                const reexportNodeId = store.insertNode({
                    name: spec.local,
                    qualified_name: `${filePath}:reexport:${spec.local}`,
                    kind: "reexport",
                    language,
                    file: filePath,
                    line_start: re.line || 1,
                    line_end: re.line || 1,
                    parent_id: null,
                    signature: null,
                });
                store.markExported(reexportNodeId);
                nodeIds.set(`reexport:${spec.local}:${re.line}`, reexportNodeId);
            }
        }
    }

    // 1b. Create file-scope module node (fallback source for top-level calls/refs)
    const ext = extname(filePath);
    const moduleNodeId = store.insertNode({
        name: basename(filePath, ext),
        qualified_name: `${filePath}:module`,
        kind: "module",
        language,
        file: filePath,
        line_start: 1,
        line_end: 9999,
        parent_id: null,
        signature: null,
    });

    // 2. Build local symbol map (name -> nodeId, null = ambiguous)
    const localSymbols = new Map();
    const classMethods = new Map();

    for (const def of definitions) {
        if (!nodeIds.has(def.key)) continue;
        const nodeId = nodeIds.get(def.key);

        if (def.parent) {
            classMethods.set(`${def.parent}.${def.name}`, nodeId);
        }

        if (localSymbols.has(def.name)) {
            localSymbols.set(def.name, null);
        } else {
            localSymbols.set(def.name, nodeId);
        }
    }

    // 3. Build imported symbol map (specifier-aware resolution)
    const importedSymbols = new Map();
    for (const imp of imports) {
        const resolvedFile = resolveImportSource(imp.source, filePath, store);
        const targetNodes = resolvedFile ? store.nodesByFile(resolvedFile) : [];
        const externalModule = !resolvedFile ? store.ensureExternalModuleNode(imp.source, language) : null;

        if (imp.specifiers && imp.specifiers.length > 0) {
            for (const spec of imp.specifiers) {
                if (!resolvedFile) {
                    if (spec.type === "named") {
                        const target = store.ensureExternalSymbolNode(imp.source, spec.imported, language);
                        importedSymbols.set(spec.local, target.id);
                    } else if (spec.type === "default") {
                        const target = store.ensureExternalSymbolNode(imp.source, "default", language);
                        importedSymbols.set(spec.local, target.id);
                    } else if ((spec.type === "namespace" || spec.type === "module") && externalModule) {
                        importedSymbols.set(spec.local, externalModule.id);
                    }
                    continue;
                }

                if (spec.type === "named") {
                    const target = targetNodes.find(n => n.name === spec.imported && n.kind !== "import");
                    if (target) importedSymbols.set(spec.local, target.id);
                } else if (spec.type === "default") {
                    const target = targetNodes.find(n => n.is_default_export && n.kind !== "import");
                    if (target) importedSymbols.set(spec.local, target.id);
                }
            }
        } else if (resolvedFile) {
            // Fallback for non-structured imports (Python etc.)
            for (const name of imp.name.split(", ")) {
                const trimmed = name.trim();
                if (!trimmed || trimmed === "*") continue;
                const target = targetNodes.find(n => n.name === trimmed && n.kind !== "import");
                if (target) importedSymbols.set(trimmed, target.id);
            }
        }
    }

    // 4. Persist type-layer edges
    const resolvedTypeTargetsByOwner = new Map();
    for (const def of definitions) {
        if ((def.kind !== "class" && def.kind !== "interface") || !def.supertypes?.length) continue;
        const sourceId = nodeIds.get(def.key);
        if (!sourceId) continue;

        for (const supertype of def.supertypes) {
            const target = resolveTypeTarget(supertype.name, filePath, localSymbols, importedSymbols, store);
            if (!target) continue;

            store.insertEdge({
                source_id: sourceId,
                target_id: target.id,
                layer: "type",
                kind: supertype.relation,
                confidence: target.confidence,
                origin: "resolved",
                file: filePath,
                line: def.line_start,
            });

            const ownerTargets = resolvedTypeTargetsByOwner.get(def.name) || [];
            ownerTargets.push(target);
            resolvedTypeTargetsByOwner.set(def.name, ownerTargets);
        }
    }

    // 5. Persist override edges for methods in inherited types
    for (const def of definitions) {
        if (def.kind !== "method" || !def.parent) continue;
        const sourceId = nodeIds.get(def.key);
        if (!sourceId) continue;
        const superTargets = resolvedTypeTargetsByOwner.get(def.parent) || [];

        for (const targetType of superTargets) {
            const baseMethod = store.findByName(def.name).find(candidate =>
                candidate.kind === "method" &&
                candidate.qualified_name &&
                candidate.qualified_name.endsWith(`:${targetType.name}.${def.name}`)
            );
            if (!baseMethod) continue;

            store.insertEdge({
                source_id: sourceId,
                target_id: baseMethod.id,
                layer: "type",
                kind: "overrides",
                confidence: targetType.confidence,
                origin: "resolved",
                file: filePath,
                line: def.line_start,
            });
        }
    }

    // 6. Persist symbol-level import edges
    for (const imp of imports) {
        const resolvedFile = resolveImportSource(imp.source, filePath, store);
        if (!imp.specifiers || imp.specifiers.length === 0) continue;

        const sourceId = nodeIds.get(`import:${imp.source}:${imp.line}`);
        if (!sourceId) continue;

        const targetNodes = resolvedFile ? store.nodesByFile(resolvedFile) : [];

        for (const spec of imp.specifiers) {
            let target;
            const confidence = resolvedFile ? "exact" : "low";

            if (!resolvedFile) {
                if (spec.type === "default") {
                    target = store.ensureExternalSymbolNode(imp.source, "default", language);
                } else if (spec.type === "named") {
                    target = store.ensureExternalSymbolNode(imp.source, spec.imported, language);
                } else if (spec.type === "namespace" || spec.type === "module") {
                    target = store.ensureExternalModuleNode(imp.source, language);
                }
            } else if (spec.type === "default") {
                target = targetNodes.find(n => n.is_default_export && n.kind !== "import");
            } else if (spec.type === "namespace") {
                for (const tn of targetNodes) {
                    if (tn.kind !== "import" && tn.is_exported) {
                        store.insertEdge({
                            source_id: sourceId, target_id: tn.id,
                            layer: "symbol",
                            kind: "imports", confidence: "namespace",
                            origin: "resolved",
                            file: filePath, line: imp.line,
                        });
                    }
                }
                continue;
            } else {
                target = targetNodes.find(n => n.name === spec.imported && n.kind !== "import");
            }

            if (target) {
                store.insertEdge({
                    source_id: sourceId, target_id: target.id,
                    layer: "symbol",
                    kind: "imports", confidence,
                    origin: resolvedFile ? "resolved" : "unresolved",
                    file: filePath, line: imp.line,
                });
            }
        }
    }

    // 7. Persist module-level import edges (file-to-file)
    store.clearModuleEdges(filePath);
    for (const imp of imports) {
        const resolvedFile = resolveImportSource(imp.source, filePath, store);
        const targetFile = resolvedFile || store.externalModuleFile(imp.source);
        if (!resolvedFile) {
            store.ensureExternalModuleNode(imp.source, language);
        }
        const isSideEffect = !imp.name || imp.name === "*" || imp.name === "";
        store.insertModuleEdge({
            source_file: filePath,
            target_file: targetFile,
            line: imp.line,
            is_side_effect: isSideEffect ? 1 : 0,
            is_dynamic: 0,
            is_reexport: 0,
        });
    }

    // 8. Mark exported symbols
    if (fileExports && fileExports.size > 0) {
        for (const exportName of fileExports) {
            for (const def of definitions) {
                if (def.name === exportName && nodeIds.has(def.key)) {
                    if (exportName === defaultExport) {
                        store.markDefaultExport(nodeIds.get(def.key));
                    } else {
                        store.markExported(nodeIds.get(def.key));
                    }
                    break;
                }
            }
        }
    }
    if (defaultExport === "__default_export__") {
        for (const def of definitions) {
            if (def.name === "__default_export__" && nodeIds.has(def.key)) {
                store.markDefaultExport(nodeIds.get(def.key));
                break;
            }
        }
    }

    // 9. Wire reexport edges
    if (reexports && reexports.length > 0) {
        for (const re of reexports) {
            const resolvedTarget = resolveImportSource(re.source, filePath, store);
            const targetFile = resolvedTarget || store.externalModuleFile(re.source);
            if (!resolvedTarget) {
                store.ensureExternalModuleNode(re.source, language);
            }

            store.insertModuleEdge({
                source_file: filePath,
                target_file: targetFile,
                line: re.line || 0,
                is_side_effect: 0,
                is_dynamic: 0,
                is_reexport: 1,
            });

            if (!resolvedTarget) continue;

            const targetNodes = store.nodesByFile(resolvedTarget);

            for (const spec of re.specifiers) {
                if (spec.type === "namespace" && spec.local === "*") continue;

                let target;
                if (spec.type === "default" || spec.imported === "default") {
                    target = targetNodes.find(n => n.is_default_export && n.kind !== "import");
                } else {
                    target = targetNodes.find(n => n.name === spec.imported && n.kind !== "import");
                }
                if (!target) continue;

                const reexportNodeId = nodeIds.get(`reexport:${spec.local}:${re.line}`);
                if (!reexportNodeId) continue;

                store.insertEdge({
                    source_id: reexportNodeId,
                    target_id: target.id,
                    layer: "symbol",
                    kind: "reexports",
                    confidence: "exact",
                    origin: "resolved",
                    file: filePath,
                    line: re.line || 0,
                });
            }
        }
    }

    // 10. Resolve and persist call edges
    for (const call of calls) {
        const callerDef = findEnclosingDefinition(call.line, definitions);
        const callerId = callerDef ? nodeIds.get(callerDef.key) : moduleNodeId;

        let targetId = null;
        let confidence = "exact";

        // 1. Same-class sibling method
        if (callerDef?.parent && classMethods.has(`${callerDef.parent}.${call.name}`)) {
            targetId = classMethods.get(`${callerDef.parent}.${call.name}`);
        }
        // 2. Local symbol (skip null = ambiguous)
        else if (localSymbols.has(call.name) && localSymbols.get(call.name) != null) {
            targetId = localSymbols.get(call.name);
        }
        // 3. Imported symbol
        else if (importedSymbols.has(call.name)) {
            targetId = importedSymbols.get(call.name);
        }
        // 4. Module-connected or global unique
        else {
            const candidates = store.findByName(call.name);
            const nonImport = candidates.filter(c => c.kind !== "import");

            const moduleConnected = nonImport.filter(c => store.moduleEdgeExists(filePath, c.file));
            if (moduleConnected.length === 1) {
                targetId = moduleConnected[0].id;
                confidence = "inferred";
            } else if (nonImport.length === 1) {
                targetId = nonImport[0].id;
                confidence = "heuristic";
            }
        }

        if (targetId && targetId !== callerId) {
            store.insertEdge({
                source_id: callerId,
                target_id: targetId,
                layer: "symbol",
                kind: "calls",
                confidence,
                origin: "resolved",
                file: filePath,
                line: call.line,
            });
            callEdgeCount++;
        }
    }

    // 11. Resolve reference edges
    if (references && references.length > 0) {
        for (const ref of references) {
            const enclosingDef = findEnclosingDefinition(ref.line, definitions);

            let targetId = null;
            const confidence = "exact";

            // Same-class sibling
            if (enclosingDef?.parent && classMethods.has(`${enclosingDef.parent}.${ref.name}`)) {
                targetId = classMethods.get(`${enclosingDef.parent}.${ref.name}`);
            }
            // Local symbol
            else if (localSymbols.has(ref.name) && localSymbols.get(ref.name) != null) {
                targetId = localSymbols.get(ref.name);
            }
            // Imported symbol
            else if (importedSymbols.has(ref.name)) {
                targetId = importedSymbols.get(ref.name);
            }
            // Skip global resolution for refs (too noisy)

            if (!targetId) continue;

            // Skip self-references: if target is the enclosing definition
            const callerId = enclosingDef ? nodeIds.get(enclosingDef.key) : moduleNodeId;
            if (targetId === callerId) continue;

            const edgeKind = ref.refKind === "type_ref" ? "ref_type" : "ref_read";
            store.insertEdge({
                source_id: callerId,
                target_id: targetId,
                layer: "symbol",
                kind: edgeKind,
                confidence,
                origin: "resolved",
                file: filePath,
                line: ref.line,
            });
        }
    }

    materializeFlowSummaries(store, filePath, source, definitions, nodeIds);
    return callEdgeCount;
}

function materializeFlowSummaries(store, filePath, source, definitions, nodeIds) {
    if (!source) return;
    const lines = source.split("\n");

    for (const def of definitions) {
        if (def.kind !== "function" && def.kind !== "method") continue;
        const ownerId = nodeIds.get(def.key);
        if (!ownerId) continue;

        const params = extractParamNames(def.signature);
        if (params.length === 0) continue;

        const bodyLines = lines.slice(def.line_start - 1, def.line_end);
        const bodyByLine = new Map(bodyLines.map((line, index) => [def.line_start + index, line]));
        const callEdges = store.edgesFrom(ownerId).filter(edge => edge.kind === "calls");

        for (const [lineNo, text] of bodyByLine) {
            const normalizedText = text || "";
            const returnedIdentifier = extractReturnedIdentifier(normalizedText);
            if (returnedIdentifier && params.some(param => namesEqual(param, returnedIdentifier))) {
                store.insertFlowSummary({
                    owner_id: ownerId,
                    kind: "param_to_return",
                    source_name: returnedIdentifier,
                    target_name: "return",
                    file: filePath,
                    line: lineNo,
                    confidence: "exact",
                });
            }

            const lineCalls = callEdges.filter(edge => edge.line === lineNo);
            for (const edge of lineCalls) {
                for (const param of params) {
                    if (!containsIdentifier(normalizedText, param)) continue;
                    store.insertFlowSummary({
                        owner_id: ownerId,
                        kind: "param_to_call",
                        source_name: param,
                        target_name: edge.target_name,
                        related_symbol_id: edge.target_id,
                        file: filePath,
                        line: lineNo,
                        confidence: edge.confidence,
                    });
                }
                if (/\breturn\b/.test(normalizedText)) {
                    store.insertFlowSummary({
                        owner_id: ownerId,
                        kind: "call_to_return",
                        source_name: edge.target_name,
                        target_name: "return",
                        related_symbol_id: edge.target_id,
                        file: filePath,
                        line: lineNo,
                        confidence: edge.confidence,
                    });
                }
            }
        }
    }
}

function extractParamNames(signature) {
    if (!signature) return [];
    return signature
        .replace(/^[({\[]|[)}\]]$/g, "")
        .split(",")
        .map(part => part.trim())
        .map(part => part.replace(/=[^,]+$/g, "").trim())
        .map(part => part.replace(/^(public|private|protected|readonly|async|ref|out|in)\s+/g, ""))
        .map(part => part.replace(/:[^,]+$/g, "").trim())
        .map(part => part.replace(/\s+/g, " ").split(" ").pop())
        .map(part => part.replace(/^\*+/, "").replace(/^\$/,"").replace(/[?]$/g, ""))
        .filter(Boolean);
}

function extractReturnedIdentifier(lineText) {
    const match = lineText.match(/\breturn\s+\$?([A-Za-z_]\w*)\b/);
    return match ? match[1] : null;
}

function containsIdentifier(lineText, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\w$])\\$?${escaped}(?![\\w$])`).test(lineText);
}

function namesEqual(left, right) {
    return left.replace(/^\$/, "") === right.replace(/^\$/, "");
}

function resolveTypeTarget(name, filePath, localSymbols, importedSymbols, store) {
    if (localSymbols.has(name) && localSymbols.get(name) != null) {
        const node = store.getNodeById(localSymbols.get(name));
        if (node && (node.kind === "class" || node.kind === "interface")) {
            return { ...node, confidence: "exact" };
        }
    }
    if (importedSymbols.has(name)) {
        const node = store.getNodeById(importedSymbols.get(name));
        if (node && (node.kind === "class" || node.kind === "interface")) {
            return { ...node, confidence: "exact" };
        }
    }

    const candidates = store.findByName(name).filter(c => c.kind === "class" || c.kind === "interface");
    const moduleConnected = candidates.filter(c => store.moduleEdgeExists(filePath, c.file));
    if (moduleConnected.length === 1) return { ...moduleConnected[0], confidence: "inferred" };
    if (candidates.length === 1) return { ...candidates[0], confidence: "heuristic" };
    return null;
}

function persistCloneData(store, definitions, nodeIds) {
    for (const def of definitions) {
        if (!def.clone_data) continue;
        const nodeId = nodeIds.get(def.key);
        if (!nodeId) continue;

        store.insertCloneBlock({
            node_id: nodeId,
            raw_hash: def.clone_data.raw_hash,
            norm_hash: def.clone_data.norm_hash,
            fingerprint: def.clone_data.fingerprint,
            stmt_count: def.clone_data.stmt_count,
            token_count: def.clone_data.token_count,
        });

        for (const band of def.clone_data.bands) {
            store.insertLshBand({
                band_id: band.bandId,
                bucket_hash: band.bucketHash,
                node_id: nodeId,
            });
        }
    }
}

function walkDir(dir, root, allowedExts, store, results, depth = 0) {
    if (depth > 12) return;

    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);

        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
            walkDir(fullPath, root, allowedExts, store, results, depth + 1);
        } else if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase();
            if (!allowedExts.has(ext)) continue;

            let stat;
            try {
                stat = statSync(fullPath);
            } catch {
                continue;
            }

            if (stat.size > MAX_FILE_SIZE || stat.size === 0) continue;

            const relPath = relative(root, fullPath).replace(/\\/g, "/");

            // Check if file changed (mtime comparison)
            const existing = store.getFile(relPath);
            if (existing && Math.abs(existing.mtime - stat.mtimeMs) < 1) continue;

            results.push({ relPath, fullPath, mtime: stat.mtimeMs });
        }
    }
}

function findEnclosingDefinition(line, definitions) {
    // Find the definition that contains this line
    let best = null;
    for (const def of definitions) {
        if (def.line_start <= line && def.line_end >= line) {
            // Prefer the most specific (innermost) definition
            if (!best || def.line_start > best.line_start) {
                best = def;
            }
        }
    }
    return best;
}

function resolveImportSource(source, fromFile, store) {
    if (!source) return null;

    // Skip external packages (no relative path)
    if (!source.startsWith(".") && !source.startsWith("/")) return null;

    const fromDir = dirname(fromFile);
    const candidates = [
        join(fromDir, source).replace(/\\/g, "/"),
        join(fromDir, source + ".js").replace(/\\/g, "/"),
        join(fromDir, source + ".mjs").replace(/\\/g, "/"),
        join(fromDir, source + ".ts").replace(/\\/g, "/"),
        join(fromDir, source + ".tsx").replace(/\\/g, "/"),
        join(fromDir, source + ".py").replace(/\\/g, "/"),
        join(fromDir, source, "index.js").replace(/\\/g, "/"),
        join(fromDir, source, "index.ts").replace(/\\/g, "/"),
        join(fromDir, source, "index.mjs").replace(/\\/g, "/"),
    ];

    for (const candidate of candidates) {
        const normalized = candidate.replace(/^\.\//, "");
        if (store.getFile(normalized)) return normalized;
    }

    return null;
}
