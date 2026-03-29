/**
 * Graph enrichment for hex-line tools.
 *
 * Reads .hex-skills/codegraph/index.db (created by hex-graph-mcp) in readonly mode via a
 * small explicit compatibility contract:
 * - hex_line_contract
 * - hex_line_symbol_annotations
 * - hex_line_call_edges
 *
 * Graceful fallback: if better-sqlite3, contract views, or DB are missing,
 * enrichment is disabled silently for that project.
 */

import { existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { createRequire } from "node:module";

const HEX_LINE_CONTRACT_VERSION = 1;
const _dbs = new Map();
let _driverUnavailable = false;

/**
 * Get readonly graph DB for a project root.
 * Returns null if DB missing or contract unavailable.
 * @param {string} filePath - any file path inside the project
 * @returns {object|null} better-sqlite3 Database instance or null
 */
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
        if (!validateHexLineContract(db)) {
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

/**
 * Test helper: close cached DB handles so each test can start clean.
 */
export function _resetGraphDBCache() {
    for (const db of _dbs.values()) {
        try { db.close(); } catch { /* ignore */ }
    }
    _dbs.clear();
    _driverUnavailable = false;
}

function validateHexLineContract(db) {
    try {
        const contract = db.prepare("SELECT contract_version FROM hex_line_contract LIMIT 1").get();
        if (!contract || contract.contract_version !== HEX_LINE_CONTRACT_VERSION) return false;
        db.prepare("SELECT node_id, file, line_start, line_end, display_name, kind, callees, callers FROM hex_line_symbol_annotations LIMIT 1").all();
        db.prepare("SELECT source_id, target_id, source_file, source_line, source_display_name, target_file, target_line, target_display_name FROM hex_line_call_edges LIMIT 1").all();
        return true;
    } catch {
        return false;
    }
}

/**
 * Get [N↓ M↑] annotation for a symbol.
 * @param {object} db - better-sqlite3 instance
 * @param {string} file - relative file path
 * @param {string} name - symbol name
 * @returns {string|null} e.g. "[5↓ 3↑]" or null
 */
export function symbolAnnotation(db, file, name) {
    try {
        const node = db.prepare(
            "SELECT callees, callers FROM hex_line_symbol_annotations WHERE file = ? AND name = ? LIMIT 1"
        ).get(file, name);
        if (!node) return null;

        if (node.callees === 0 && node.callers === 0) return null;
        return `[${node.callees}\u2193 ${node.callers}\u2191]`;
    } catch {
        return null;
    }
}

/**
 * Get all symbol annotations for a file (for read_file Graph: header).
 * @param {object} db
 * @param {string} file - relative file path
 * @returns {Array<{name, kind, callees, callers}>}
 */
export function fileAnnotations(db, file) {
    try {
        const nodes = db.prepare(
            `SELECT display_name, kind, callees, callers
             FROM hex_line_symbol_annotations
             WHERE file = ?
             ORDER BY line_start`
        ).all(file);

        return nodes.map((node) => ({
            name: node.display_name,
            kind: node.kind,
            callees: node.callees,
            callers: node.callers,
        }));
    } catch {
        return [];
    }
}

/**
 * Call impact: callers affected by changes in given line range.
 * @param {object} db
 * @param {string} file - relative file path
 * @param {number} startLine
 * @param {number} endLine
 * @returns {Array<{name, file, line}>} affected symbols (max 10)
 */
export function callImpact(db, file, startLine, endLine) {
    try {
        const modified = db.prepare(
            `SELECT node_id
             FROM hex_line_symbol_annotations
             WHERE file = ?
               AND line_start <= ?
               AND line_end >= ?`
        ).all(file, endLine, startLine);

        if (modified.length === 0) return [];

        const affected = [];
        const seen = new Set();

        for (const node of modified) {
            const dependents = db.prepare(
                `SELECT source_display_name AS name, source_file AS file, source_line AS line
                 FROM hex_line_call_edges
                 WHERE target_id = ?`
            ).all(node.node_id);

            for (const dep of dependents) {
                const key = `${dep.file}:${dep.name}`;
                if (!seen.has(key) && dep.file !== file) {
                    seen.add(key);
                    affected.push({ name: dep.name, file: dep.file, line: dep.line });
                }
            }
        }

        return affected.slice(0, 10);
    } catch {
        return [];
    }
}

/**
 * Get symbol kind + annotation for a grep match.
 * @param {object} db
 * @param {string} file - relative file path
 * @param {number} line - line number
 * @returns {string|null} e.g. "[fn 5↓ 3↑]" or null
 */
export function matchAnnotation(db, file, line) {
    try {
        const node = db.prepare(
            `SELECT display_name, kind, callees, callers
             FROM hex_line_symbol_annotations
             WHERE file = ? AND line_start <= ? AND line_end >= ?
             ORDER BY line_start DESC
             LIMIT 1`
        ).get(file, line, line);
        if (!node) return null;

        const kindShort = { function: "fn", class: "cls", method: "mtd", variable: "var" }[node.kind] || node.kind;
        if (node.callees === 0 && node.callers === 0) return `[${kindShort}]`;
        return `[${kindShort} ${node.callees}\u2193 ${node.callers}\u2191]`;
    } catch {
        return null;
    }
}

/**
 * Get relative path from project root (matching DB paths).
 * @param {string} filePath - absolute file path
 * @returns {string|null} relative path with forward slashes, or null
 */
export function getRelativePath(filePath) {
    const root = findProjectRoot(filePath);
    if (!root) return null;
    return relative(root, filePath).replace(/\\/g, "/");
}

// --- Helpers ---

function findProjectRoot(filePath) {
    // First pass: look for .hex-skills/codegraph/index.db (strongest signal)
    let dir = dirname(filePath);
    for (let i = 0; i < 10; i++) {
        if (existsSync(join(dir, ".hex-skills/codegraph", "index.db"))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    // Second pass: fallback to .git
    dir = dirname(filePath);
    for (let i = 0; i < 10; i++) {
        if (existsSync(join(dir, ".git"))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}
