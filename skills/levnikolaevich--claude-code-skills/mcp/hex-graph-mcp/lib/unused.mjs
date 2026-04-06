/**
 * Dead export detection.
 * Returns only proven-unused exports, with uncertain cases split out explicitly.
 */

const ENTRY_POINT_RE = /(?:^|[\\\/])(?:index|main|server|app)\.[^.]+$/;
const TEST_FILE_RE = /(?:[\\/]test[\\/]|[\\/]__tests__[\\/]|\.test\\.|\.spec\\.)/;

function classifySuppression(store, node) {
    if (ENTRY_POINT_RE.test(node.file)) {
        return { suppressed: true, reason: "entry-point", evidence: null };
    }
    const frameworkEdges = store.frameworkIncomingEdges(node.id);
    if (frameworkEdges.length > 0) {
        return {
            suppressed: true,
            reason: "framework-wired",
            evidence: frameworkEdges.map(edge => ({
                kind: edge.kind,
                origin: edge.origin,
                file: edge.file,
                line: edge.line,
            })),
        };
    }
    if (TEST_FILE_RE.test(node.file)) {
        return { suppressed: true, reason: "test-utility", evidence: null };
    }
    return { suppressed: false, reason: null, evidence: null };
}

export function findUnusedExports(store, { scopePath, kind } = {}) {
    let exported = store.exportedNodes();

    if (scopePath) {
        exported = exported.filter(node => node.file.startsWith(scopePath));
    }
    if (kind && kind !== "all") {
        exported = exported.filter(node => node.kind === kind);
    }

    const totalExported = exported.length;
    const unused = [];
    const uncertain = [];
    let suppressedCount = 0;

    for (const node of exported) {
        const nodeData = {
            file: node.file,
            name: node.name,
            kind: node.kind,
            line: node.line_start,
        };

        if (store.exactImportEdgeCount(node.id) > 0) continue;

        const reexportSources = store.reexportSourcesTo(node.id);
        const usedViaReexport = reexportSources.some(({ source_id }) => store.exactImportEdgeCount(source_id) > 0);
        if (usedViaReexport) continue;

        const namespaceImports = store.namespaceImportEdgeCount(node.id);
        if (namespaceImports > 0) {
            uncertain.push({
                ...nodeData,
                reason: "namespace_import_only",
                confidence: "low",
            });
            continue;
        }

        const totalImports = store.importEdgeCount(node.id);
        if (totalImports > 0) {
            const sources = store.importEdgeSources(node.id);
            const allFromTests = sources.length > 0 && sources.every(source => TEST_FILE_RE.test(source.file));
            uncertain.push({
                ...nodeData,
                reason: allFromTests ? "used_only_from_tests" : "non_exact_imports",
                confidence: "low",
            });
            continue;
        }

        const { suppressed, reason, evidence } = classifySuppression(store, node);
        if (suppressed) {
            suppressedCount++;
        }

        unused.push({
            ...nodeData,
            confidence: suppressed ? "medium" : "high",
            suppressed,
            suppress_reason: reason,
            suppress_evidence: evidence,
        });
    }

    return {
        unused,
        uncertain,
        total_exported: totalExported,
        total_unused: unused.length,
        suppressed_count: suppressedCount,
    };
}

export function formatUnusedText(result, showSuppressed = false) {
    const visibleUnused = showSuppressed
        ? result.unused
        : result.unused.filter(item => !item.suppressed);

    const lines = [];
    lines.push(
        `${visibleUnused.length} proven unused exports (${result.total_exported} total exported, ${result.suppressed_count} suppressed, ${result.uncertain.length} uncertain)`
    );
    lines.push("");

    if (visibleUnused.length > 0) {
        lines.push("  Confidence  Kind      File                    Symbol");
        for (const item of visibleUnused) {
            const conf = item.confidence.padEnd(8);
            const kind = item.kind.padEnd(10);
            const loc = `${item.file}:${item.line}`;
            const reason = item.suppress_reason ? `  [${item.suppress_reason}]` : "";
            lines.push(`  ${conf}  ${kind}${loc.padEnd(24)}${item.name}${reason}`);
        }
    }

    if (result.uncertain.length > 0) {
        lines.push("");
        lines.push("Uncertain exports:");
        for (const item of result.uncertain) {
            lines.push(`  ${item.file}:${item.line} ${item.name} (${item.reason})`);
        }
    }

    return lines.join("\n");
}
