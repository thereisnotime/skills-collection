import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fromBinary } from "@bufbuild/protobuf";

import { getStore, hasOpenStore } from "../store.mjs";
import { buildNodeLookup, findOwnerNode, normalizePath } from "./project.mjs";
import { IndexSchema, SymbolRole, SymbolInformation_Kind } from "./vendor/scip_pb.js";
import { normalizeScipLanguage, positionEncodingName, supportedImportLanguageForDocument } from "./languages.mjs";

function symbolInfoByDocument(document) {
    return new Map((document.symbols || []).map(info => [info.symbol, info]));
}

function graphKindForSymbolInfo(symbolInfo) {
    switch (symbolInfo?.kind) {
    case SymbolInformation_Kind.Class:
        return "class";
    case SymbolInformation_Kind.Interface:
        return "interface";
    case SymbolInformation_Kind.Method:
        return "method";
    case SymbolInformation_Kind.Variable:
        return "variable";
    case SymbolInformation_Kind.Function:
    default:
        return "function";
    }
}

function inferredSymbolName(symbol, symbolInfo) {
    if (symbolInfo?.displayName) return symbolInfo.displayName;
    const text = String(symbol || "");
    const hashIndex = text.lastIndexOf("#");
    const methodMatch = text.match(/#([^#./(]+)\(\)\./);
    if (methodMatch) return methodMatch[1];
    const memberMatch = text.match(/#([^#./(]+)\.$/);
    if (memberMatch) return memberMatch[1];
    if (hashIndex !== -1) {
        const classMatch = text.slice(0, hashIndex).match(/([^/]+)$/);
        if (classMatch) return classMatch[1];
    }
    return null;
}

function lineDistance(left, right) {
    return Math.abs((left ?? 0) - (right ?? 0));
}

function findDefinitionNode(store, relFile, line, column, symbol, symbolInfo, lookupCache) {
    const lookup = lookupCache.get(relFile) || buildNodeLookup(store, relFile);
    lookupCache.set(relFile, lookup);
    const targetName = inferredSymbolName(symbol, symbolInfo);
    const targetKind = graphKindForSymbolInfo(symbolInfo);
    const exact = lookup.nodes.find(node =>
        node.line_start === line
        && (node.column_start == null || node.column_start === column)
        && (!targetName || node.name === targetName)
        && node.kind === targetKind
    );
    if (exact) return exact;
    const exactKindOnly = lookup.nodes.find(node =>
        node.line_start === line
        && node.column_start === column
        && node.kind === targetKind
    );
    if (exactKindOnly) return exactKindOnly;
    const sameLineName = lookup.nodes.find(node =>
        node.line_start === line
        && (!targetName || node.name === targetName)
    );
    if (sameLineName) return sameLineName;
    const nearby = lookup.nodes
        .filter(node =>
            node.kind === targetKind
            && (!targetName || node.name === targetName)
            && lineDistance(node.line_start, line) <= 3
        )
        .sort((left, right) =>
            lineDistance(left.line_start, line) - lineDistance(right.line_start, line)
            || lineDistance(left.column_start, column) - lineDistance(right.column_start, column)
        )[0];
    if (nearby) return nearby;
    return targetName
        ? lookup.nodes.find(node => node.kind === targetKind && node.name === targetName) || null
        : null;
}

function occurrenceLine(occurrence, field = "range") {
    return ((occurrence?.[field]?.[0] ?? occurrence?.range?.[0] ?? 0) + 1);
}

function occurrenceColumn(occurrence, field = "range") {
    return occurrence?.[field]?.[1] ?? occurrence?.range?.[1] ?? 0;
}

function importedEdgeKind(occurrence) {
    if ((occurrence.symbolRoles & SymbolRole.Import) !== 0) return "imports";
    return "ref_read";
}

function importedEdgeEvidence({ artifactPath, occurrence, symbol, relationshipKind = null, document }) {
    return JSON.stringify({
        provider: "scip",
        artifact_path: artifactPath,
        symbol,
        symbol_roles: occurrence?.symbolRoles ?? 0,
        relationship_kind: relationshipKind,
        document_language: document?.language || null,
        position_encoding: positionEncodingName(document?.positionEncoding),
        range: occurrence?.range || null,
        enclosing_range: occurrence?.enclosingRange || null,
    });
}

function supportedDocuments(artifact) {
    return (artifact.documents || []).map(document => ({
        document,
        normalizedLanguage: supportedImportLanguageForDocument(document),
    }));
}

export async function importScipOverlay({ path: projectPath, artifactPath, replaceExisting = true }) {
    const absoluteProjectPath = resolve(projectPath);
    let store;
    const shouldCloseStore = !hasOpenStore(absoluteProjectPath, { mode: "write" });
    try {
        store = getStore(absoluteProjectPath);
        if (replaceExisting) {
            store.clearEdgesByOrigin("scip_import");
        }

        const absoluteArtifactPath = resolve(absoluteProjectPath, artifactPath);
        const artifact = fromBinary(IndexSchema, readFileSync(absoluteArtifactPath));
        const documents = supportedDocuments(artifact);
        const supported = documents.filter(entry => entry.normalizedLanguage);
        if (!supported.length) {
            const rawLanguages = [...new Set((artifact.documents || []).map(document => normalizeScipLanguage(document.language)).filter(Boolean))];
            throw new Error(`SCIP artifact does not contain supported document languages. Found: ${rawLanguages.join(", ") || "none"}.`);
        }
        const lookupCache = new Map();
        const symbolToNode = new Map();

        for (const { document } of supported) {
            const relFile = normalizePath(document.relativePath);
            const fileNodes = store.nodesByFile(relFile);
            if (!fileNodes.length) continue;
            const infos = symbolInfoByDocument(document);
            for (const occurrence of document.occurrences || []) {
                if ((occurrence.symbolRoles & SymbolRole.Definition) === 0) continue;
                const startLine = occurrenceLine(occurrence);
                const startColumn = occurrenceColumn(occurrence);
                const nativeNode = findDefinitionNode(store, relFile, startLine, startColumn, occurrence.symbol, infos.get(occurrence.symbol), lookupCache);
                if (nativeNode) {
                    symbolToNode.set(occurrence.symbol, nativeNode);
                }
            }
        }

        const seenEdges = new Set();
        let importedReferenceEdges = 0;
        let importedRelationshipEdges = 0;
        let skippedDocuments = 0;

        for (const { document, normalizedLanguage } of documents) {
            if (!normalizedLanguage) {
                skippedDocuments++;
                continue;
            }
            const relFile = normalizePath(document.relativePath);
            const fileNodes = store.nodesByFile(relFile);
            if (!fileNodes.length) continue;

            for (const occurrence of document.occurrences || []) {
                if ((occurrence.symbolRoles & SymbolRole.Definition) !== 0) continue;
                const targetNode = symbolToNode.get(occurrence.symbol);
                if (!targetNode) continue;
                const line = occurrence.enclosingRange?.length ? occurrenceLine(occurrence, "enclosingRange") : occurrenceLine(occurrence);
                const column = occurrence.enclosingRange?.length
                    ? occurrenceColumn({ range: occurrence.enclosingRange })
                    : occurrenceColumn(occurrence);
                const ownerNode = findOwnerNode(store, relFile, line, column, lookupCache);
                if (!ownerNode || ownerNode.id === targetNode.id) continue;
                const kind = importedEdgeKind(occurrence);
                const edgeKey = [ownerNode.id, targetNode.id, kind, relFile, line, column, occurrenceColumn(occurrence)].join("|");
                if (seenEdges.has(edgeKey)) continue;
                seenEdges.add(edgeKey);
                store.insertEdge({
                    source_id: ownerNode.id,
                    target_id: targetNode.id,
                    layer: kind === "imports" ? "module" : "symbol",
                    kind,
                    confidence: "precise",
                    origin: "scip_import",
                    file: relFile,
                    line,
                    evidence_json: importedEdgeEvidence({
                        artifactPath: absoluteArtifactPath,
                        occurrence,
                        symbol: occurrence.symbol,
                        document,
                    }),
                });
                importedReferenceEdges++;
            }

            for (const info of document.symbols || []) {
                const sourceNode = symbolToNode.get(info.symbol);
                if (!sourceNode) continue;
                for (const relationship of info.relationships || []) {
                    const targetNode = symbolToNode.get(relationship.symbol);
                    if (!targetNode || targetNode.id === sourceNode.id) continue;
                    const kind = relationship.isImplementation
                        ? (sourceNode.kind === "method" || targetNode.kind === "method" ? "overrides" : "implements")
                        : null;
                    if (!kind) continue;
                    const edgeKey = [sourceNode.id, targetNode.id, kind, relFile, sourceNode.line_start].join("|");
                    if (seenEdges.has(edgeKey)) continue;
                    seenEdges.add(edgeKey);
                    store.insertEdge({
                        source_id: sourceNode.id,
                        target_id: targetNode.id,
                        layer: "type",
                        kind,
                        confidence: "precise",
                        origin: "scip_import",
                        file: relFile,
                        line: sourceNode.line_start,
                        evidence_json: importedEdgeEvidence({
                            artifactPath: absoluteArtifactPath,
                            occurrence: null,
                            symbol: info.symbol,
                            relationshipKind: kind,
                            document,
                        }),
                    });
                    importedRelationshipEdges++;
                }
            }
        }

        return {
            artifact_path: absoluteArtifactPath,
            artifact_languages: [...new Set(supported.map(entry => entry.normalizedLanguage))],
            mapped_symbol_count: symbolToNode.size,
            imported_reference_edges: importedReferenceEdges,
            imported_relationship_edges: importedRelationshipEdges,
            skipped_documents: skippedDocuments,
            replace_existing: replaceExisting,
        };
    } finally {
        if (store && shouldCloseStore) {
            try { store.checkpoint(); } catch { /* best-effort WAL flush */ }
            store.close();
        }
    }
}
