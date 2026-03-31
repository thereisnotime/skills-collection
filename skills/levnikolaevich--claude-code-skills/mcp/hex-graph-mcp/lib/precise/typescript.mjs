import ts from "typescript";
import { dirname, extname, relative, resolve } from "node:path";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".cts", ".mts", ".js", ".jsx", ".cjs", ".mjs"]);

function normalizePath(filePath) {
    return filePath.replace(/\\/g, "/");
}

function relativeProjectPath(projectPath, filePath) {
    return normalizePath(relative(projectPath, filePath));
}

function isTypeScriptFile(filePath) {
    return TS_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isTypePosition(node) {
    let current = node;
    while (current?.parent) {
        const parent = current.parent;
        switch (parent.kind) {
        case ts.SyntaxKind.TypeReference:
        case ts.SyntaxKind.ExpressionWithTypeArguments:
        case ts.SyntaxKind.HeritageClause:
        case ts.SyntaxKind.TypeAliasDeclaration:
        case ts.SyntaxKind.InterfaceDeclaration:
        case ts.SyntaxKind.TypeLiteral:
        case ts.SyntaxKind.ImportType:
            return true;
        case ts.SyntaxKind.CallExpression:
        case ts.SyntaxKind.PropertyAccessExpression:
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.VariableDeclaration:
            return false;
        default:
            current = parent;
        }
    }
    return false;
}

function isDeclarationName(node) {
    const parent = node?.parent;
    if (!parent) return false;
    return (
        parent.name === node
        && (
            ts.isFunctionDeclaration(parent)
            || ts.isMethodDeclaration(parent)
            || ts.isClassDeclaration(parent)
            || ts.isInterfaceDeclaration(parent)
            || ts.isVariableDeclaration(parent)
            || ts.isParameter(parent)
            || ts.isPropertyDeclaration(parent)
            || ts.isImportSpecifier(parent)
            || ts.isImportClause(parent)
        )
    );
}

function isCallLikeIdentifier(node) {
    const parent = node?.parent;
    if (!parent) return false;
    if (ts.isCallExpression(parent) && parent.expression === node) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
        return true;
    }
    return false;
}

function resolveSymbol(checker, node) {
    let symbol = checker.getSymbolAtLocation(node);
    if (!symbol) return null;
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
        try {
            symbol = checker.getAliasedSymbol(symbol) || symbol;
        } catch {
            return symbol;
        }
    }
    return symbol;
}

function pickDeclaration(symbol) {
    if (!symbol?.declarations?.length) return null;
    return symbol.declarations.find(decl => decl.getSourceFile() && !decl.getSourceFile().isDeclarationFile) || symbol.declarations[0];
}

function parentTypeName(node) {
    let current = node?.parent;
    while (current) {
        if (ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current)) {
            return current.name?.text || null;
        }
        current = current.parent;
    }
    return null;
}

function buildNodeLookup(store, relFile) {
    const nodes = store.nodesByFile(relFile)
        .filter(node => node.kind !== "import" && node.kind !== "module" && node.kind !== "reexport");
    const moduleNode = store.nodesByFile(relFile).find(node => node.kind === "module") || null;
    return {
        moduleNode,
        nodes,
        byLine: new Map(nodes.map(node => [`${node.line_start}:${node.name}:${node.kind}`, node])),
    };
}

function mapDeclarationToNode(store, projectPath, lookupCache, declaration) {
    const sourceFile = declaration?.getSourceFile();
    if (!sourceFile || sourceFile.isDeclarationFile) return null;
    const relFile = relativeProjectPath(projectPath, sourceFile.fileName);
    if (relFile.startsWith("..")) return null;
    const cacheKey = relFile;
    const lookup = lookupCache.get(cacheKey) || buildNodeLookup(store, relFile);
    lookupCache.set(cacheKey, lookup);
    const start = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile)).line + 1;
    const name = declaration.name?.text || declaration.symbol?.name || null;
    if (!name) return null;
    const kind = ts.isMethodDeclaration(declaration)
        ? "method"
        : ts.isFunctionDeclaration(declaration)
            ? "function"
            : ts.isClassDeclaration(declaration)
                ? "class"
                : ts.isInterfaceDeclaration(declaration)
                    ? "interface"
                    : ts.isVariableDeclaration(declaration)
                        ? "variable"
                        : null;
    if (!kind) return null;
    const exact = lookup.byLine.get(`${start}:${name}:${kind}`);
    if (exact) return exact;
    const parentName = kind === "method" ? parentTypeName(declaration) : null;
    return lookup.nodes.find(node =>
        node.name === name
        && node.kind === kind
        && node.line_start === start
        && (!parentName || node.qualified_name?.includes(`:${parentName}.${name}`))
    ) || null;
}

function findOwnerNode(store, relFile, line, lookupCache) {
    const lookup = lookupCache.get(relFile) || buildNodeLookup(store, relFile);
    lookupCache.set(relFile, lookup);
    const owner = lookup.nodes
        .filter(node =>
            (node.kind === "function" || node.kind === "method" || node.kind === "class")
            && node.line_start <= line
            && node.line_end >= line
        )
        .sort((left, right) => (left.line_end - left.line_start) - (right.line_end - right.line_start))[0];
    return owner || lookup.moduleNode || null;
}

function defaultCompilerOptions() {
    return {
        allowJs: true,
        checkJs: true,
        noEmit: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
    };
}

function loadProgram(projectPath, sourceFiles) {
    const configPath = ts.findConfigFile(projectPath, ts.sys.fileExists);
    if (configPath) {
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
        if (configFile.error) {
            throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
        }
        const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(configPath));
        return ts.createProgram({
            rootNames: parsed.fileNames,
            options: { ...defaultCompilerOptions(), ...parsed.options },
        });
    }
    return ts.createProgram({
        rootNames: sourceFiles.map(file => resolve(projectPath, file)),
        options: defaultCompilerOptions(),
    });
}

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

                const line = sourceFile.getLineAndCharacterOfPosition(symbolNode.getStart(sourceFile)).line + 1;
                const ownerNode = findOwnerNode(store, relFile, line, lookupCache);
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
