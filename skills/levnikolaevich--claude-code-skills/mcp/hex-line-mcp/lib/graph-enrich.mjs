/**
 * Graph enrichment for hex-line tools.
 *
 * Reads .hex-skills/codegraph/index.db (created by hex-graph-mcp) in readonly mode
 * via an explainable, fact-oriented contract:
 * - hex_line_symbols
 * - hex_line_line_facts
 * - hex_line_edit_impacts
 * - hex_line_edit_impact_facts
 * - hex_line_clone_siblings
 *
 * Graceful fallback: if better-sqlite3, required views, or DB are missing,
 * enrichment is disabled silently for that project.
 */

import { existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { createRequire } from "node:module";

const REQUIRED_VIEWS = [
    "hex_line_symbols",
    "hex_line_line_facts",
    "hex_line_edit_impacts",
    "hex_line_edit_impact_facts",
    "hex_line_clone_siblings",
];

const FACT_PRIORITY = new Map([
    ["public_api", 0],
    ["framework_entrypoint", 1],
    ["definition", 2],
    ["through_flow", 3],
    ["outgoing_flow", 4],
    ["incoming_flow", 5],
    ["callee", 6],
    ["caller", 7],
    ["clone", 8],
    ["hotspot", 9],
]);

const _dbs = new Map();
let _driverUnavailable = false;
// Safety cap for parent-directory traversal while resolving the nearest project boundary.
const MAX_PROJECT_ROOT_ASCENT = 25;
const PROJECT_BOUNDARY_MARKERS = [
    "package.json",
    "pyproject.toml",
    "go.mod",
    "Cargo.toml",
    "composer.json",
    "Gemfile",
    "deno.json",
    "deno.jsonc",
    ".git",
];

export function getGraphDB(filePath) {
    if (_driverUnavailable) return null;

    try {
        const projectRoot = findProjectRoot(filePath);
        if (!projectRoot) return null;

        const dbPath = join(projectRoot, ".hex-skills/codegraph", "index.db");
        if (!existsSync(dbPath)) return null;
        if (_dbs.has(dbPath)) return _dbs.get(dbPath);

        const require = createRequire(import.meta.url);
        const Database = require("better-sqlite3");
        const db = new Database(dbPath, { readonly: true });
        if (!validateContract(db)) {
            db.close();
            return null;
        }
        _dbs.set(dbPath, db);
        return db;
    } catch {
        _driverUnavailable = true;
        return null;
    }
}

export function _resetGraphDBCache() {
    for (const db of _dbs.values()) {
        try { db.close(); } catch { /* ignore */ }
    }
    _dbs.clear();
    _driverUnavailable = false;
}

function validateContract(db) {
    try {
        for (const viewName of REQUIRED_VIEWS) {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'view' AND name = ? LIMIT 1"
            ).get(viewName);
            if (!row) return false;
        }
        db.prepare("SELECT node_id, file, line_start, line_end, display_name, kind, is_exported, framework_incoming_count FROM hex_line_symbols LIMIT 1").all();
        db.prepare("SELECT fact_kind, related_display_name, confidence, origin FROM hex_line_line_facts LIMIT 1").all();
        db.prepare("SELECT symbol_node_id, external_callers_count, downstream_return_flow_count, downstream_property_flow_count, sink_reach_count, clone_sibling_count, public_api_count, framework_entrypoint_count, same_name_symbol_count FROM hex_line_edit_impacts LIMIT 1").all();
        db.prepare("SELECT edited_symbol_id, fact_kind, target_display_name, path_kind, flow_hops FROM hex_line_edit_impact_facts LIMIT 1").all();
        return true;
    } catch {
        return false;
    }
}

function shortKind(kind) {
    return { function: "fn", class: "cls", method: "mtd", variable: "var" }[kind] || kind;
}

function compactSymbolCounts(node) {
    const parts = [];
    if (node.is_exported) parts.push(node.is_default_export ? "default api" : "api");
    if ((node.framework_incoming_count || 0) > 0) {
        parts.push(node.framework_incoming_count === 1 ? "entrypoint" : `entrypoint ${node.framework_incoming_count}`);
    }
    if ((node.callees_exact || 0) > 0 || (node.callers_exact || 0) > 0) {
        parts.push(`${node.callees_exact}\u2193 ${node.callers_exact}\u2191`);
    }
    const flowParts = [];
    if ((node.incoming_flow_count || 0) > 0) flowParts.push(`${node.incoming_flow_count}in`);
    if ((node.outgoing_flow_count || 0) > 0) flowParts.push(`${node.outgoing_flow_count}out`);
    if ((node.through_flow_count || 0) > 0) flowParts.push(`${node.through_flow_count}thru`);
    if (flowParts.length > 0) parts.push(`flow ${flowParts.join(" ")}`);
    if ((node.clone_sibling_count || 0) > 0) parts.push(`clone ${node.clone_sibling_count}`);
    return parts;
}

export function symbolAnnotation(db, file, name) {
    try {
        const node = db.prepare(
            `SELECT display_name, kind, callers_exact, callees_exact, incoming_flow_count, outgoing_flow_count, through_flow_count, clone_sibling_count
                    , is_exported, is_default_export, framework_incoming_count
             FROM hex_line_symbols
             WHERE file = ? AND name = ?
             LIMIT 1`
        ).get(file, name);
        if (!node) return null;
        const parts = compactSymbolCounts(node);
        const prefix = shortKind(node.kind);
        return parts.length > 0 ? `[${prefix} ${parts.join(" | ")}]` : `[${prefix}]`;
    } catch {
        return null;
    }
}

export function fileAnnotations(db, file, { startLine = null, endLine = null, limit = 8 } = {}) {
    try {
        const hasRange = Number.isInteger(startLine) && Number.isInteger(endLine);
        const nodes = hasRange
            ? db.prepare(
                `SELECT display_name, kind, callers_exact, callees_exact, incoming_flow_count, outgoing_flow_count, through_flow_count, clone_sibling_count,
                        is_exported, is_default_export, framework_incoming_count, line_start
                 FROM hex_line_symbols
                 WHERE file = ?
                   AND line_start <= ?
                   AND line_end >= ?
                 ORDER BY line_start
                 LIMIT ?`
            ).all(file, endLine, startLine, limit)
            : db.prepare(
                `SELECT display_name, kind, callers_exact, callees_exact, incoming_flow_count, outgoing_flow_count, through_flow_count, clone_sibling_count,
                        is_exported, is_default_export, framework_incoming_count, line_start
                 FROM hex_line_symbols
                 WHERE file = ?
                 ORDER BY line_start
                 LIMIT ?`
            ).all(file, limit);

        return nodes.map(node => ({
            name: node.display_name,
            kind: node.kind,
            callers_exact: node.callers_exact,
            callees_exact: node.callees_exact,
            incoming_flow_count: node.incoming_flow_count,
            outgoing_flow_count: node.outgoing_flow_count,
            through_flow_count: node.through_flow_count,
            clone_sibling_count: node.clone_sibling_count,
            is_exported: !!node.is_exported,
            is_default_export: !!node.is_default_export,
            framework_incoming_count: node.framework_incoming_count,
            line_start: node.line_start,
        }));
    } catch {
        return [];
    }
}

function formatLineFact(fact) {
    const countParts = compactSymbolCounts(fact);
    const suffix = countParts.length > 0 ? ` | ${countParts.join(" | ")}` : "";
    switch (fact.fact_kind) {
    case "public_api":
        return `[api${suffix}]`;
    case "framework_entrypoint":
        return fact.related_display_name ? `[entry:${fact.related_display_name}${suffix}]` : `[entry${suffix}]`;
    case "definition":
        return `[${shortKind(fact.kind)}${suffix}]`;
    case "callee":
        return fact.related_display_name ? `[callee:${fact.related_display_name}${suffix}]` : `[callee${suffix}]`;
    case "caller":
        return fact.related_display_name ? `[caller:${fact.related_display_name}${suffix}]` : `[caller${suffix}]`;
    case "outgoing_flow":
        return `[flow-out:${fact.target_anchor_kind || "?"}${suffix}]`;
    case "incoming_flow":
        return `[flow-in:${fact.target_anchor_kind || "?"}${suffix}]`;
    case "through_flow":
        return `[flow-through${suffix}]`;
    case "clone":
        return `[clone${suffix}]`;
    case "hotspot":
        return `[hotspot${suffix}]`;
    default:
        return `[${fact.fact_kind}${suffix}]`;
    }
}

function priorityForFact(factKind) {
    return FACT_PRIORITY.get(factKind) ?? 99;
}

export function matchAnnotation(db, file, line) {
    try {
        const facts = db.prepare(
            `SELECT
                lf.display_name,
                lf.kind,
                lf.fact_kind,
                lf.related_display_name,
                lf.source_anchor_kind,
                lf.target_anchor_kind,
                hs.callers_exact,
                hs.callees_exact,
                hs.incoming_flow_count,
                hs.outgoing_flow_count,
                hs.through_flow_count,
                hs.clone_sibling_count
             FROM hex_line_line_facts lf
             LEFT JOIN hex_line_symbols hs ON hs.node_id = lf.symbol_node_id
             WHERE lf.file = ? AND lf.line_start <= ? AND lf.line_end >= ?
             ORDER BY lf.line_start DESC`
        ).all(file, line, line);
        if (facts.length === 0) return null;
        facts.sort((left, right) => priorityForFact(left.fact_kind) - priorityForFact(right.fact_kind));
        const labels = [];
        const seenKinds = new Set();
        for (const fact of facts) {
            if (seenKinds.has(fact.fact_kind)) continue;
            seenKinds.add(fact.fact_kind);
            labels.push(formatLineFact(fact));
            if (labels.length >= 3) break;
        }
        return labels.join(" ");
    } catch {
        return null;
    }
}

export function cloneWarning(db, file, startLine, endLine) {
    try {
        const modified = db.prepare(
            `SELECT node_id
             FROM hex_line_symbols
             WHERE file = ?
               AND line_start <= ?
               AND line_end >= ?`
        ).all(file, endLine, startLine);

        if (modified.length === 0) return [];

        const clones = [];
        const seen = new Set();
        for (const node of modified) {
            const siblings = db.prepare(
                `SELECT clone_peer_name, clone_peer_file, clone_peer_line, clone_type
                 FROM hex_line_clone_siblings
                 WHERE node_id = ?`
            ).all(node.node_id);
            for (const sibling of siblings) {
                const key = `${sibling.clone_peer_file}:${sibling.clone_peer_name}:${sibling.clone_peer_line}`;
                if (seen.has(key)) continue;
                seen.add(key);
                clones.push({
                    name: sibling.clone_peer_name,
                    file: sibling.clone_peer_file,
                    line: sibling.clone_peer_line,
                    cloneType: sibling.clone_type,
                });
            }
        }
        return clones.slice(0, 10);
    } catch {
        return [];
    }
}

export function semanticImpact(db, file, startLine, endLine) {
    try {
        const modified = db.prepare(
            `SELECT symbol_node_id, display_name, external_callers_count, downstream_return_flow_count, downstream_property_flow_count, sink_reach_count,
                    clone_sibling_count, public_api_count, framework_entrypoint_count, same_name_symbol_count
             FROM hex_line_edit_impacts
             WHERE file = ?
               AND line_start <= ?
               AND line_end >= ?`
        ).all(file, endLine, startLine);

        if (modified.length === 0) return [];

        return modified.map(item => {
            const facts = db.prepare(
                `SELECT fact_kind, target_display_name, target_file, target_line, intermediate_display_name, path_kind, flow_hops, source_anchor_kind, target_anchor_kind, access_path_json
                 FROM hex_line_edit_impact_facts
                 WHERE edited_symbol_id = ?
                 ORDER BY
                    CASE fact_kind
                        WHEN 'external_caller' THEN 0
                        WHEN 'return_flow_to_symbol' THEN 1
                        WHEN 'property_flow_to_symbol' THEN 2
                        WHEN 'flow_reaches_terminal_anchor' THEN 3
                        WHEN 'clone_sibling' THEN 4
                        ELSE 9
                    END,
                    target_file,
                    target_line`
            ).all(item.symbol_node_id);
            const seen = new Set();
            const dedupedFacts = facts.filter(fact => {
                const key = [
                    fact.fact_kind,
                    fact.target_display_name || "",
                    fact.target_file || "",
                    fact.target_line || "",
                    fact.path_kind || "",
                    fact.flow_hops || "",
                    fact.source_anchor_kind || "",
                    fact.target_anchor_kind || "",
                    fact.access_path_json || "",
                ].join("|");
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            return {
                symbol: item.display_name,
                counts: {
                    externalCallers: item.external_callers_count,
                    downstreamReturnFlow: item.downstream_return_flow_count,
                    downstreamPropertyFlow: item.downstream_property_flow_count,
                    sinkReach: item.sink_reach_count,
                    cloneSiblings: item.clone_sibling_count,
                    publicApi: item.public_api_count,
                    frameworkEntrypoints: item.framework_entrypoint_count,
                    sameNameSymbols: item.same_name_symbol_count,
                },
                facts: dedupedFacts,
            };
        });
    } catch {
        return [];
    }
}

export function getRelativePath(filePath) {
    const root = findProjectRoot(filePath);
    if (!root) return null;
    return relative(root, filePath).replace(/\\/g, "/");
}

function findProjectRoot(filePath) {
    let dir = dirname(filePath);
    for (let i = 0; i < MAX_PROJECT_ROOT_ASCENT; i++) {
        if (existsSync(join(dir, ".hex-skills/codegraph", "index.db"))) return dir;
        if (PROJECT_BOUNDARY_MARKERS.some((marker) => existsSync(join(dir, marker)))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}
