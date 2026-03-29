/**
 * Dead export detection.
 * Finds exported symbols with zero incoming import edges.
 * Full liveness for JS/TS/TSX. Export detection only for Python/C#/PHP (no resolver).
 */

import { extname } from "node:path";
import { languageFor } from "./parser.mjs";

const RESOLVER_CAPABLE = new Set(["javascript", "typescript", "tsx"]);

const ENTRY_POINT_RE = /(?:^|[\\/])(?:index|main|server|app)\.[^.]+$/;

const FRAMEWORK_HOOK_NAMES = new Set([
    "setup", "teardown", "middleware", "configure",
    "register", "init", "bootstrap",
]);

const TEST_FILE_RE = /(?:[\\/]test[\\/]|[\\/]__tests__[\\/]|\.test\.|\.spec\.)/;

/**
 * Classify suppression reason for an exported node.
 * @returns {{ suppressed: boolean, reason: string|null }}
 */
function classifySuppression(file, name) {
    if (ENTRY_POINT_RE.test(file)) {
        return { suppressed: true, reason: "entry-point" };
    }
    if (FRAMEWORK_HOOK_NAMES.has(name)) {
        return { suppressed: true, reason: "framework-hook" };
    }
    if (TEST_FILE_RE.test(file)) {
        return { suppressed: true, reason: "test-utility" };
    }
    return { suppressed: false, reason: null };
}

/**
 * Find exported symbols that no other module imports.
 *
 * @param {Store} store - resolved graph store
 * @param {object} [opts]
 * @param {string} [opts.scopePath] - file prefix filter
 * @param {string} [opts.kind] - node kind filter (function/class/variable)
 * @returns {{ unused: object[], total_exported: number, total_unused: number, suppressed_count: number }}
 */
export function findUnusedExports(store, { scopePath, kind } = {}) {
    let exported = store.exportedNodes();

    if (scopePath) {
        exported = exported.filter(n => n.file.startsWith(scopePath));
    }
    if (kind && kind !== "all") {
        exported = exported.filter(n => n.kind === kind);
    }

    const totalExported = exported.length;
    const unused = [];
    let suppressedCount = 0;

    for (const node of exported) {
        const nodeData = {
            file: node.file,
            name: node.name,
            kind: node.kind,
            line: node.line_start,
        };

        // P1f: Language-aware confidence — non-JS langs have no cross-file resolver
        const lang = languageFor(extname(node.file));
        if (!RESOLVER_CAPABLE.has(lang)) {
            unused.push({ ...nodeData, confidence: "export_only", reason: "no_cross_file_resolver", suppressed: false, suppress_reason: null });
            continue;
        }

        const exactImports = store.exactImportEdgeCount(node.id);
        if (exactImports > 0) continue; // definitely used

        // Check reexport chain — used if a reexport proxy is imported
        const reexportSources = store.reexportSourcesTo(node.id);
        let usedViaReexport = false;
        for (const { source_id } of reexportSources) {
            if (store.exactImportEdgeCount(source_id) > 0) {
                usedViaReexport = true;
                break;
            }
        }
        if (usedViaReexport) continue; // used via barrel

        const nsImports = store.namespaceImportEdgeCount(node.id);
        if (nsImports > 0) {
            unused.push({ ...nodeData, confidence: "low", reason: "used_via_namespace_only", suppressed: false, suppress_reason: null });
            continue;
        }

        // Fallback import count used for test-only usage classification
        const totalImports = store.importEdgeCount(node.id);
        if (totalImports > 0) {
            // Has import edges — check if they are only from test files
            const sources = store.importEdgeSources(node.id);
            const allFromTests = sources.every(s => TEST_FILE_RE.test(s.file));
            if (allFromTests) {
                unused.push({ ...nodeData, confidence: "low", suppressed: false, suppress_reason: null });
            }
            continue;
        }

        // Truly unused — apply suppression heuristics
        const { suppressed, reason } = classifySuppression(node.file, node.name);
        if (suppressed) {
            suppressedCount++;
            unused.push({ ...nodeData, confidence: "medium", suppressed: true, suppress_reason: reason });
        } else {
            unused.push({ ...nodeData, confidence: "high", suppressed: false, suppress_reason: null });
        }
    }

    return {
        unused,
        total_exported: totalExported,
        total_unused: unused.length,
        suppressed_count: suppressedCount,
    };
}

/**
 * Format unused exports as human-readable text.
 * @param {object} result - output from findUnusedExports()
 * @param {boolean} showSuppressed - include suppressed items
 * @returns {string}
 */
export function formatUnusedText(result, showSuppressed = false) {
    const { unused, total_exported, suppressed_count } = result;

    const visible = showSuppressed
        ? unused
        : unused.filter(u => !u.suppressed);

    const lines = [];
    lines.push(
        `${visible.length} unused exports found (${total_exported} total exported, ${suppressed_count} suppressed)`
    );
    lines.push("");

    if (visible.length > 0) {
        lines.push("  Confidence  Kind      File                    Symbol");
        for (const u of visible) {
            const conf = u.confidence.padEnd(8);
            const kindStr = u.kind.padEnd(10);
            const loc = `${u.file}:${u.line}`;
            const reasonText = u.reason || u.suppress_reason;
            const suffix = reasonText ? `  [${reasonText}]` : "";
            lines.push(`  ${conf}  ${kindStr}${loc.padEnd(24)}${u.name}${suffix}`);
        }
    }

    if (!showSuppressed && suppressed_count > 0) {
        lines.push("");

        // Group suppressed reasons
        const suppressed = unused.filter(u => u.suppressed);
        const reasons = {};
        for (const s of suppressed) {
            reasons[s.suppress_reason] = (reasons[s.suppress_reason] || 0) + 1;
        }
        const breakdown = Object.entries(reasons)
            .map(([reason, count]) => `${count} ${reason}`)
            .join(", ");

        lines.push(`Suppressed (use show_suppressed=true to include):`);
        lines.push(`  ${suppressed_count} items (${breakdown})`);
    }

    return lines.join("\n");
}
