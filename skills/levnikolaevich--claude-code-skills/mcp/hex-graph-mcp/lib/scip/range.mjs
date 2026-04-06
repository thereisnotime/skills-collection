import ts from "typescript";

export function positionFromOffset(sourceFile, offset) {
    const normalizedOffset = Math.max(0, Math.min(offset, sourceFile.text.length));
    return sourceFile.getLineAndCharacterOfPosition(normalizedOffset);
}

export function rangeFromOffsets(sourceFile, startOffset, endOffset) {
    const start = positionFromOffset(sourceFile, startOffset);
    const end = positionFromOffset(sourceFile, endOffset);
    if (start.line === end.line) {
        return [start.line, start.character, end.character];
    }
    return [start.line, start.character, end.line, end.character];
}

export function rangeFromNode(sourceFile, node, { includeTrivia = false } = {}) {
    const start = includeTrivia ? node.getFullStart() : node.getStart(sourceFile);
    const end = node.getEnd();
    return rangeFromOffsets(sourceFile, start, end);
}

export function enclosingRangeForDefinition(sourceFile, declaration) {
    return rangeFromNode(sourceFile, declaration, { includeTrivia: true });
}

export function enclosingRangeForReference(sourceFile, node) {
    let current = node?.parent || null;
    while (current) {
        if (
            ts.isPropertyAccessExpression(current)
            || ts.isElementAccessExpression(current)
            || ts.isCallExpression(current)
            || ts.isNewExpression(current)
            || ts.isBinaryExpression(current)
            || ts.isVariableDeclaration(current)
            || ts.isReturnStatement(current)
        ) {
            return rangeFromNode(sourceFile, current);
        }
        current = current.parent;
    }
    return rangeFromNode(sourceFile, node);
}
