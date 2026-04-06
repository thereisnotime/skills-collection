import ts from "typescript";
import {
    findOwnerNode,
    isCallLikeIdentifier,
    isDeclarationName,
    isTypePosition,
    isTypeScriptFile,
    loadProgram,
    mapDeclarationToNode,
    normalizePath,
    pickDeclaration,
    relativeProjectPath,
    resolveSymbol,
} from "../scip/project.mjs";

function makeEvidence(projectPath, node, targetNode, sourceFile) {
    const syntaxName = ts.SyntaxKind[node.kind] || "Unknown";
    return JSON.stringify({
        provider: "typescript",
        syntax_kind: syntaxName,
        source_file: relativeProjectPath(projectPath, sourceFile.fileName),
        target: targetNode.workspace_qualified_name || targetNode.qualified_name || targetNode.name,
    });
}

export function runTypeScriptPreciseOverlay({ projectPath, store, sourceFiles }) {
    const jsTsFiles = (sourceFiles || []).filter(isTypeScriptFile);
    if (jsTsFiles.length === 0) {
        return { status: "skipped", edge_count: 0, detail: "no_js_ts_files" };
    }

    const program = loadProgram(projectPath, jsTsFiles);
    const checker = program.getTypeChecker();
    const lookupCache = new Map();
    const seen = new Set();
    let edgeCount = 0;

    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile || !normalizePath(sourceFile.fileName).startsWith(normalizePath(projectPath))) continue;
        if (!isTypeScriptFile(sourceFile.fileName)) continue;
        const relFile = relativeProjectPath(projectPath, sourceFile.fileName);
        if (relFile.startsWith("..")) continue;

        const visit = (node) => {
            if (ts.isIdentifier(node) || (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name))) {
                const symbolNode = ts.isPropertyAccessExpression(node) ? node.name : node;
                if (!symbolNode || isDeclarationName(symbolNode)) {
                    ts.forEachChild(node, visit);
                    return;
                }
                const targetSymbol = resolveSymbol(checker, symbolNode);
                const targetDeclaration = pickDeclaration(targetSymbol);
                const targetNode = mapDeclarationToNode(store, projectPath, lookupCache, targetDeclaration);
                if (!targetNode) {
                    ts.forEachChild(node, visit);
                    return;
                }

                const position = sourceFile.getLineAndCharacterOfPosition(symbolNode.getStart(sourceFile));
                const line = position.line + 1;
                const column = position.character;
                const ownerNode = findOwnerNode(store, relFile, line, column, lookupCache);
                if (!ownerNode || ownerNode.id === targetNode.id) {
                    ts.forEachChild(node, visit);
                    return;
                }

                const kind = isCallLikeIdentifier(symbolNode)
                    ? "calls"
                    : isTypePosition(symbolNode)
                        ? "ref_type"
                        : "ref_read";
                const edgeKey = [ownerNode.id, targetNode.id, kind, relFile, line].join("|");
                if (!seen.has(edgeKey)) {
                    seen.add(edgeKey);
                    store.insertEdge({
                        source_id: ownerNode.id,
                        target_id: targetNode.id,
                        layer: kind === "calls" ? "symbol" : "symbol",
                        kind,
                        confidence: "precise",
                        origin: "precise_ts",
                        file: relFile,
                        line,
                        evidence_json: makeEvidence(projectPath, symbolNode, targetNode, sourceFile),
                    });
                    edgeCount++;
                }
            }
            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
    }

    return {
        status: "available",
        edge_count: edgeCount,
        version: ts.version,
    };
}
