import ts from "typescript";
import { dirname, extname, relative, resolve } from "node:path";

export const TS_EXTENSIONS = new Set([".ts", ".tsx", ".cts", ".mts", ".js", ".jsx", ".cjs", ".mjs"]);

export function normalizePath(filePath) {
    return filePath.replace(/\\/g, "/");
}

export function relativeProjectPath(projectPath, filePath) {
    return normalizePath(relative(projectPath, filePath));
}

export function isTypeScriptFile(filePath) {
    return TS_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export function isTypePosition(node) {
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

export function isDeclarationName(node) {
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

export function isCallLikeIdentifier(node) {
    const parent = node?.parent;
    if (!parent) return false;
    if (ts.isCallExpression(parent) && parent.expression === node) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
        return true;
    }
    return false;
}

export function resolveSymbol(checker, node) {
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

export function pickDeclaration(symbol) {
    if (!symbol?.declarations?.length) return null;
    return symbol.declarations.find(decl => decl.getSourceFile() && !decl.getSourceFile().isDeclarationFile) || symbol.declarations[0];
}

export function parentTypeName(node) {
    let current = node?.parent;
    while (current) {
        if (ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current)) {
            return current.name?.text || null;
        }
        current = current.parent;
    }
    return null;
}

export function buildNodeLookup(store, relFile) {
    const nodes = store.nodesByFile(relFile)
        .filter(node => node.kind !== "import" && node.kind !== "module" && node.kind !== "reexport");
    const moduleNode = store.nodesByFile(relFile).find(node => node.kind === "module") || null;
    return {
        moduleNode,
        nodes,
        byLine: new Map(nodes.map(node => [`${node.line_start}:${node.name}:${node.kind}`, node])),
        byLocation: new Map(nodes.map(node => [`${node.line_start}:${node.column_start ?? -1}:${node.name}:${node.kind}`, node])),
    };
}

export function mapDeclarationToNode(store, projectPath, lookupCache, declaration) {
    const sourceFile = declaration?.getSourceFile();
    if (!sourceFile || sourceFile.isDeclarationFile) return null;
    const relFile = relativeProjectPath(projectPath, sourceFile.fileName);
    if (relFile.startsWith("..")) return null;
    const cacheKey = relFile;
    const lookup = lookupCache.get(cacheKey) || buildNodeLookup(store, relFile);
    lookupCache.set(cacheKey, lookup);
    const position = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile));
    const start = position.line + 1;
    const column = position.character;
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
    const parentName = kind === "method" ? parentTypeName(declaration) : null;
    const exact = lookup.byLocation.get(`${start}:${column}:${name}:${kind}`);
    if (exact) return exact;
    const sameLine = lookup.byLine.get(`${start}:${name}:${kind}`);
    if (sameLine) return sameLine;
    return lookup.nodes.find(node =>
        node.name === name
        && node.kind === kind
        && node.line_start === start
        && node.column_start === column
        && (!parentName || node.qualified_name?.includes(`:${parentName}.${name}`))
    ) || lookup.nodes.find(node =>
        node.name === name
        && node.kind === kind
        && node.line_start === start
        && (!parentName || node.qualified_name?.includes(`:${parentName}.${name}`))
    ) || null;
}

export function findOwnerNode(store, relFile, line, column, lookupCache) {
    const lookup = lookupCache.get(relFile) || buildNodeLookup(store, relFile);
    lookupCache.set(relFile, lookup);
    const owner = lookup.nodes
        .filter(node =>
            (node.kind === "function" || node.kind === "method" || node.kind === "class")
            && node.line_start <= line
            && node.line_end >= line
            && (
                node.line_start !== line
                || node.column_start == null
                || node.column_start <= column
            )
            && (
                node.line_end !== line
                || node.column_end == null
                || node.column_end >= column
            )
        )
        .sort((left, right) => (left.line_end - left.line_start) - (right.line_end - right.line_start))[0];
    return owner || lookup.moduleNode || null;
}

export function defaultCompilerOptions() {
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

export function loadProgram(projectPath, sourceFiles) {
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

export function sourceFileInsideProject(sourceFile, projectPath) {
    return normalizePath(sourceFile.fileName).startsWith(normalizePath(projectPath));
}
