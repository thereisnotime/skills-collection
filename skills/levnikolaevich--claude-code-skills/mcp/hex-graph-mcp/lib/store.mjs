/**
 * SQLite graph store for code knowledge graph.
 *
 * Schema: files -> nodes -> edges, with FTS5 search and CTE traversal.
 * ON DELETE CASCADE: removing a file auto-cleans nodes + edges.
 * WAL mode: concurrent reads during watcher writes.
 * Singleton per DB path.
 */

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";

const SCHEMA_VERSION = 1;
export const CODEGRAPH_DIR = ".hex-skills/codegraph";
const EXTERNAL_FILE_PREFIX = "[[external]]/";

/**
 * User-facing display name for a node. Hides internal synthetic names.
 */
function displayName(node) {
    if (node.name === "__default_export__") return "default export";
    if (node.kind === "reexport") return `${node.name} (re-export)`;
    if (node.kind === "module") return `<${node.name}>`;
    if (node.kind === "external_module") return `${node.name} (external module)`;
    if (node.kind === "external_symbol") {
        const source = node.file?.startsWith(EXTERNAL_FILE_PREFIX) ? node.file.slice(EXTERNAL_FILE_PREFIX.length) : null;
        if (node.name === "default") return source ? `default from ${source}` : "default external symbol";
        return source ? `${node.name} (external symbol from ${source})` : `${node.name} (external symbol)`;
    }
    return node.name;
}

// --- Singleton ---

const _stores = new Map();

/**
 * Get or create store for a project.
 * @param {string} projectPath - project root directory
 * @returns {Store}
 */
export function getStore(projectPath) {
    if (_stores.has(projectPath)) return _stores.get(projectPath);

    const dbDir = join(projectPath, CODEGRAPH_DIR);
    const dbPath = join(dbDir, "index.db");

    // Check schema version BEFORE creating store
    if (existsSync(dbPath)) {
        let needsReset = false;
        try {
            const probe = new Database(dbPath, { readonly: true });
            const ver = probe.pragma("user_version", { simple: true });
            probe.close();
            needsReset = ver !== SCHEMA_VERSION;
        } catch { needsReset = true; }
        if (needsReset) {
            unlinkSync(dbPath);  // delete stale cache
        }
    }

    const store = new Store(projectPath);
    _stores.set(projectPath, store);
    return store;
}

// --- Store class ---

class Store {
    constructor(projectPath) {
        this.projectPath = projectPath;
        const dbDir = join(projectPath, CODEGRAPH_DIR);
        if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
        const dbPath = join(dbDir, "index.db");
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
        this._initSchema();
        this._prepareStatements();
    }

    _initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                mtime REAL NOT NULL,
                hash TEXT NOT NULL,
                node_count INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                qualified_name TEXT,
                kind TEXT NOT NULL,
                language TEXT NOT NULL,
                file TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
                line_start INTEGER,
                line_end INTEGER,
                parent_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
                signature TEXT,
                is_exported INTEGER NOT NULL DEFAULT 0,
                is_default_export INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS edges (
                id INTEGER PRIMARY KEY,
                source_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                target_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                layer TEXT NOT NULL DEFAULT 'syntax',
                kind TEXT NOT NULL,
                confidence TEXT DEFAULT 'exact',
                origin TEXT NOT NULL DEFAULT 'parsed',
                file TEXT NOT NULL,
                line INTEGER,
                edge_hash TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
            CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
            CREATE INDEX IF NOT EXISTS idx_nodes_qualified ON nodes(qualified_name);
            CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
            CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
            CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind, source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_kind_target ON edges(kind, target_id);
            CREATE INDEX IF NOT EXISTS idx_edges_layer_kind_source ON edges(layer, kind, source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_layer_kind_target ON edges(layer, kind, target_id);
            CREATE INDEX IF NOT EXISTS idx_nodes_exported ON nodes(is_exported) WHERE is_exported = 1;
        `);

        // Clone detection tables (non-destructive migration)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS clone_blocks (
                node_id INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
                raw_hash TEXT NOT NULL,
                norm_hash TEXT NOT NULL,
                fingerprint BLOB,
                stmt_count INTEGER NOT NULL,
                token_count INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_clone_raw ON clone_blocks(raw_hash);
            CREATE INDEX IF NOT EXISTS idx_clone_norm ON clone_blocks(norm_hash);
            CREATE INDEX IF NOT EXISTS idx_clone_stmts ON clone_blocks(stmt_count);

            CREATE TABLE IF NOT EXISTS clone_lsh (
                band_id INTEGER NOT NULL,
                bucket_hash TEXT NOT NULL,
                node_id INTEGER NOT NULL REFERENCES clone_blocks(node_id) ON DELETE CASCADE,
                PRIMARY KEY (band_id, bucket_hash, node_id)
            );

            CREATE INDEX IF NOT EXISTS idx_lsh_lookup ON clone_lsh(band_id, bucket_hash);
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS flow_summaries (
                id INTEGER PRIMARY KEY,
                owner_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                source_name TEXT NOT NULL,
                target_name TEXT NOT NULL,
                related_symbol_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
                file TEXT NOT NULL,
                line INTEGER,
                confidence TEXT NOT NULL DEFAULT 'exact',
                summary_hash TEXT NOT NULL UNIQUE
            );

            CREATE INDEX IF NOT EXISTS idx_flow_owner ON flow_summaries(owner_id);
            CREATE INDEX IF NOT EXISTS idx_flow_related ON flow_summaries(related_symbol_id);
        `);

        this.db.exec(`
            CREATE VIEW IF NOT EXISTS hex_line_contract AS
            SELECT 1 AS contract_version;

            CREATE VIEW IF NOT EXISTS hex_line_symbol_annotations AS
            SELECT
                n.id AS node_id,
                n.file AS file,
                n.line_start AS line_start,
                n.line_end AS line_end,
                n.kind AS kind,
                n.name AS name,
                CASE
                    WHEN n.name = '__default_export__' THEN 'default export'
                    ELSE n.name
                END AS display_name,
                (
                    SELECT COUNT(*)
                    FROM edges e
                    WHERE e.source_id = n.id AND e.kind = 'calls'
                ) AS callees,
                (
                    SELECT COUNT(*)
                    FROM edges e
                    WHERE e.target_id = n.id AND e.kind = 'calls'
                ) AS callers
            FROM nodes n
            WHERE n.kind NOT IN ('import', 'import_stmt', 'module', 'namespace_binding', 'reexport', 'external_module', 'external_symbol');

            CREATE VIEW IF NOT EXISTS hex_line_call_edges AS
            SELECT
                e.id AS edge_id,
                e.source_id AS source_id,
                e.target_id AS target_id,
                e.file AS edge_file,
                e.line AS edge_line,
                e.confidence AS confidence,
                e.origin AS origin,
                src.file AS source_file,
                src.line_start AS source_line,
                CASE
                    WHEN src.name = '__default_export__' THEN 'default export'
                    ELSE src.name
                END AS source_display_name,
                tgt.file AS target_file,
                tgt.line_start AS target_line,
                CASE
                    WHEN tgt.name = '__default_export__' THEN 'default export'
                    ELSE tgt.name
                END AS target_display_name
            FROM edges e
            JOIN nodes src ON src.id = e.source_id
            JOIN nodes tgt ON tgt.id = e.target_id
            WHERE e.kind = 'calls'
              AND src.kind NOT IN ('import', 'import_stmt', 'module', 'namespace_binding', 'reexport', 'external_module', 'external_symbol')
              AND tgt.kind NOT IN ('import', 'import_stmt', 'module', 'namespace_binding', 'reexport', 'external_module', 'external_symbol');
        `);

        // Module-level import edges (file-to-file)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS module_edges (
                id INTEGER PRIMARY KEY,
                source_file TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
                target_file TEXT NOT NULL,
                line INTEGER,
                is_side_effect INTEGER NOT NULL DEFAULT 0,
                is_dynamic INTEGER NOT NULL DEFAULT 0,
                is_reexport INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_module_edges_source ON module_edges(source_file);
            CREATE INDEX IF NOT EXISTS idx_module_edges_target ON module_edges(target_file);
        `);

        this.db.pragma(`user_version = ${SCHEMA_VERSION}`);

        // FTS5 external content table
        const hasFts = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_fts'"
        ).get();

        if (!hasFts) {
            this.db.exec(`
                CREATE VIRTUAL TABLE nodes_fts USING fts5(
                    name, kind, file,
                    content=nodes, content_rowid=id
                );

                CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
                    INSERT INTO nodes_fts(rowid, name, kind, file)
                    VALUES (new.id, new.name, new.kind, new.file);
                END;

                CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN
                    INSERT INTO nodes_fts(nodes_fts, rowid, name, kind, file)
                    VALUES ('delete', old.id, old.name, old.kind, old.file);
                END;

                CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN
                    INSERT INTO nodes_fts(nodes_fts, rowid, name, kind, file)
                    VALUES ('delete', old.id, old.name, old.kind, old.file);
                    INSERT INTO nodes_fts(rowid, name, kind, file)
                    VALUES (new.id, new.name, new.kind, new.file);
                END;
            `);
        }
    }

    _prepareStatements() {
        this._insertFile = this.db.prepare(
            "INSERT OR REPLACE INTO files (path, mtime, hash, node_count) VALUES (?, ?, ?, ?)"
        );
        this._getFile = this.db.prepare("SELECT * FROM files WHERE path = ?");
        this._deleteFile = this.db.prepare("DELETE FROM files WHERE path = ?");
        this._allFiles = this.db.prepare("SELECT path FROM files");

        this._insertNode = this.db.prepare(`
            INSERT INTO nodes (name, qualified_name, kind, language, file, line_start, line_end, parent_id, signature)
            VALUES (@name, @qualified_name, @kind, @language, @file, @line_start, @line_end, @parent_id, @signature)
        `);

        this._insertEdge = this.db.prepare(`
            INSERT INTO edges (source_id, target_id, layer, kind, confidence, origin, file, line, edge_hash)
            VALUES (@source_id, @target_id, @layer, @kind, @confidence, @origin, @file, @line, @edge_hash)
        `);

        this._searchFts = this.db.prepare(`
            SELECT n.id, n.name, n.kind, n.language, n.file, n.line_start, n.line_end, n.qualified_name, n.signature, n.is_exported, n.is_default_export
            FROM nodes_fts fts
            JOIN nodes n ON n.id = fts.rowid
            WHERE nodes_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `);

        this._findByName = this.db.prepare(
            "SELECT id, name, kind, language, file, line_start, line_end, qualified_name, signature, is_exported, is_default_export FROM nodes WHERE name = ?"
        );

        this._findByQualified = this.db.prepare(
            "SELECT id, name, kind, language, file, line_start, line_end, qualified_name, signature, is_exported, is_default_export FROM nodes WHERE qualified_name = ?"
        );

        this._getNodeById = this.db.prepare(
            "SELECT id, name, kind, language, file, line_start, line_end, qualified_name, signature, is_exported, is_default_export FROM nodes WHERE id = ?"
        );

        this._nodesByFile = this.db.prepare(
            "SELECT id, name, kind, language, line_start, line_end, qualified_name, signature, is_exported, is_default_export FROM nodes WHERE file = ? ORDER BY line_start"
        );

        this._edgesFrom = this.db.prepare(
            "SELECT e.*, n.name as target_name, n.kind as target_kind, n.file as target_file, n.line_start as target_line, n.qualified_name as target_qualified_name, n.language as target_language FROM edges e JOIN nodes n ON n.id = e.target_id WHERE e.source_id = ?"
        );

        this._edgesTo = this.db.prepare(
            "SELECT e.*, n.name as source_name, n.kind as source_kind, n.file as source_file, n.line_start as source_line, n.qualified_name as source_qualified_name, n.language as source_language FROM edges e JOIN nodes n ON n.id = e.source_id WHERE e.target_id = ?"
        );

        // --- Clone detection statements ---

        this._insertCloneBlock = this.db.prepare(
            "INSERT OR REPLACE INTO clone_blocks (node_id, raw_hash, norm_hash, fingerprint, stmt_count, token_count) VALUES (@node_id, @raw_hash, @norm_hash, @fingerprint, @stmt_count, @token_count)"
        );

        this._insertLshBand = this.db.prepare(
            "INSERT OR REPLACE INTO clone_lsh (band_id, bucket_hash, node_id) VALUES (@band_id, @bucket_hash, @node_id)"
        );

        this._lshCandidates = this.db.prepare(
            "SELECT DISTINCT cl.node_id FROM clone_lsh cl WHERE cl.band_id = ? AND cl.bucket_hash = ? AND cl.node_id != ?"
        );

        this._cloneBlockById = this.db.prepare(`
            SELECT cb.node_id, cb.raw_hash, cb.norm_hash, cb.fingerprint, cb.stmt_count, cb.token_count,
                   n.name, n.kind, n.file, n.line_start, n.line_end, n.qualified_name, n.signature
            FROM clone_blocks cb
            JOIN nodes n ON n.id = cb.node_id
            WHERE cb.node_id = ?
        `);

        this._allCloneBlocks = this.db.prepare(`
            SELECT cb.node_id, cb.raw_hash, cb.norm_hash, cb.fingerprint, cb.stmt_count, cb.token_count,
                   n.name, n.kind, n.file, n.line_start, n.line_end, n.qualified_name, n.signature
            FROM clone_blocks cb
            JOIN nodes n ON n.id = cb.node_id
            WHERE cb.stmt_count >= ?
        `);

        // --- Module edge statements ---

        this._insertModuleEdge = this.db.prepare(
            "INSERT INTO module_edges (source_file, target_file, line, is_side_effect, is_dynamic, is_reexport) VALUES (@source_file, @target_file, @line, @is_side_effect, @is_dynamic, @is_reexport)"
        );

        this._clearModuleEdges = this.db.prepare("DELETE FROM module_edges WHERE source_file = ?");

        this._markExported = this.db.prepare("UPDATE nodes SET is_exported = 1 WHERE id = ?");
        this._markDefaultExport = this.db.prepare("UPDATE nodes SET is_exported = 1, is_default_export = 1 WHERE id = ?");

        this._moduleEdgesBySource = this.db.prepare("SELECT * FROM module_edges WHERE source_file = ?");
        this._moduleEdgesByTarget = this.db.prepare("SELECT * FROM module_edges WHERE target_file = ?");
        this._allModuleEdges = this.db.prepare("SELECT DISTINCT source_file, target_file FROM module_edges");
        this._clearModuleLayerEdges = this.db.prepare("DELETE FROM edges WHERE layer = 'module'");

        this._insertFlowSummary = this.db.prepare(
            "INSERT OR REPLACE INTO flow_summaries (owner_id, kind, source_name, target_name, related_symbol_id, file, line, confidence, summary_hash) VALUES (@owner_id, @kind, @source_name, @target_name, @related_symbol_id, @file, @line, @confidence, @summary_hash)"
        );
        this._flowSummariesByOwner = this.db.prepare(
            `SELECT fs.*, n.name AS related_name, n.kind AS related_kind, n.file AS related_file, n.line_start AS related_line, n.qualified_name AS related_qualified_name, n.language AS related_language
             FROM flow_summaries fs
             LEFT JOIN nodes n ON n.id = fs.related_symbol_id
             WHERE fs.owner_id = ?
             ORDER BY fs.line, fs.id`
        );
        this._flowSummariesByRelated = this.db.prepare(
            `SELECT fs.*, owner.name AS owner_name, owner.kind AS owner_kind, owner.file AS owner_file, owner.line_start AS owner_line, owner.qualified_name AS owner_qualified_name, owner.language AS owner_language
             FROM flow_summaries fs
             JOIN nodes owner ON owner.id = fs.owner_id
             WHERE fs.related_symbol_id = ?
             ORDER BY fs.line, fs.id`
        );

        // --- Unused export detection statements ---

        this._exportedNodes = this.db.prepare(
            "SELECT id, name, kind, file, line_start FROM nodes WHERE is_exported = 1"
        );

        this._importEdgesTo = this.db.prepare(
            "SELECT COUNT(*) as c FROM edges WHERE target_id = ? AND kind = 'imports'"
        );

        this._importEdgeSources = this.db.prepare(
            "SELECT DISTINCT n.file FROM edges e JOIN nodes n ON n.id = e.source_id WHERE e.target_id = ? AND e.kind = 'imports'"
        );

        this._exactImportEdgesTo = this.db.prepare(
            "SELECT COUNT(*) as c FROM edges WHERE target_id = ? AND kind = 'imports' AND confidence = 'exact'"
        );
        this._namespaceImportEdgesTo = this.db.prepare(
            "SELECT COUNT(*) as c FROM edges WHERE target_id = ? AND kind = 'imports' AND confidence = 'namespace'"
        );
        this._reexportSourcesTo = this.db.prepare(
            "SELECT source_id FROM edges WHERE target_id = ? AND kind = 'reexports'"
        );
        this._moduleEdgeExists = this.db.prepare(
            "SELECT 1 FROM module_edges WHERE source_file = ? AND target_file = ? LIMIT 1"
        );

        this._findReferences = this.db.prepare(`
            SELECT e.kind, e.line, e.file, e.confidence,
                   n.name, n.kind as node_kind, n.file as node_file, n.line_start
            FROM edges e
            JOIN nodes n ON n.id = e.source_id
            WHERE e.target_id = ?
            ORDER BY e.kind, e.file, e.line
        `);
    }

    // --- File operations ---

    upsertFile(path, mtime, hash, nodeCount) {
        this._insertFile.run(path, mtime, hash, nodeCount);
    }

    getFile(path) {
        return this._getFile.get(path);
    }

    deleteFile(path) {
        this._deleteFile.run(path);
    }

    allFilePaths() {
        return this._allFiles.all().map(r => r.path);
    }

    externalModuleFile(source) {
        return `${EXTERNAL_FILE_PREFIX}${source}`;
    }

    // --- Node operations ---

    insertNode(node) {
        const result = this._insertNode.run(node);
        return result.lastInsertRowid;
    }

    ensureExternalModuleNode(source, language = "external") {
        const filePath = this.externalModuleFile(source);
        if (!this.getFile(filePath)) {
            this._insertFile.run(filePath, 0, `external:${source}`, 1);
        }
        const qualifiedName = `${filePath}:module`;
        const existing = this._findByQualified.get(qualifiedName);
        if (existing) return existing;
        const id = this.insertNode({
            name: source,
            qualified_name: qualifiedName,
            kind: "external_module",
            language,
            file: filePath,
            line_start: 1,
            line_end: 1,
            parent_id: null,
            signature: null,
        });
        return this.getNodeById(id);
    }

    ensureExternalSymbolNode(source, symbolName, language = "external") {
        const filePath = this.externalModuleFile(source);
        const moduleNode = this.ensureExternalModuleNode(source, language);
        const safeName = symbolName || "unknown";
        const qualifiedName = `${filePath}:symbol:${safeName}`;
        const existing = this._findByQualified.get(qualifiedName);
        if (existing) return existing;
        const id = this.insertNode({
            name: safeName,
            qualified_name: qualifiedName,
            kind: "external_symbol",
            language,
            file: filePath,
            line_start: 1,
            line_end: 1,
            parent_id: moduleNode.id,
            signature: null,
        });
        return this.getNodeById(id);
    }

    nodesByFile(filePath) {
        return this._nodesByFile.all(filePath);
    }

    findByName(name) {
        return this._findByName.all(name);
    }

    findByQualified(qualifiedName) {
        return this._findByQualified.all(qualifiedName);
    }

    getNodeById(id) {
        return this._getNodeById.get(id);
    }

    // --- Edge operations ---

    insertEdge(edge) {
        const normalized = {
            layer: "syntax",
            confidence: "exact",
            origin: "parsed",
            line: null,
            ...edge,
        };
        normalized.edge_hash = createHash("md5")
            .update([
                normalized.source_id,
                normalized.target_id,
                normalized.layer,
                normalized.kind,
                normalized.confidence,
                normalized.origin,
                normalized.file,
                normalized.line ?? "",
            ].join("|"))
            .digest("hex")
            .slice(0, 16);
        this._insertEdge.run(normalized);
    }

    edgesFrom(nodeId) {
        return this._edgesFrom.all(nodeId);
    }

    edgesTo(nodeId) {
        return this._edgesTo.all(nodeId);
    }

    // --- Clone detection operations ---

    insertCloneBlock({node_id, raw_hash, norm_hash, fingerprint, stmt_count, token_count}) {
        this._insertCloneBlock.run({node_id, raw_hash, norm_hash, fingerprint, stmt_count, token_count});
    }

    insertLshBand({band_id, bucket_hash, node_id}) {
        this._insertLshBand.run({band_id, bucket_hash, node_id});
    }

    getLshCandidates(bandId, bucketHash, excludeNodeId) {
        return this._lshCandidates.all(bandId, bucketHash, excludeNodeId).map(r => r.node_id);
    }

    getCloneBlockById(nodeId) {
        return this._cloneBlockById.get(nodeId);
    }

    getAllCloneBlocks(minStmts) {
        return this._allCloneBlocks.all(minStmts);
    }

    insertFlowSummary(summary) {
        const normalized = {
            related_symbol_id: null,
            line: null,
            confidence: "exact",
            ...summary,
        };
        normalized.summary_hash = createHash("md5")
            .update([
                normalized.owner_id,
                normalized.kind,
                normalized.source_name,
                normalized.target_name,
                normalized.related_symbol_id ?? "",
                normalized.file,
                normalized.line ?? "",
                normalized.confidence,
            ].join("|"))
            .digest("hex")
            .slice(0, 16);
        this._insertFlowSummary.run(normalized);
    }

    flowSummariesByOwner(ownerId) {
        return this._flowSummariesByOwner.all(ownerId);
    }

    flowSummariesByRelatedSymbol(nodeId) {
        return this._flowSummariesByRelated.all(nodeId);
    }

    // --- Module edge operations ---

    insertModuleEdge(params) {
        this._insertModuleEdge.run(params);
    }

    clearModuleEdges(filePath) {
        this._clearModuleEdges.run(filePath);
    }

    markExported(nodeId) {
        this._markExported.run(nodeId);
    }

    markDefaultExport(nodeId) {
        this._markDefaultExport.run(nodeId);
    }

    cleanupOrphanModuleEdges() {
        this.db.exec("DELETE FROM module_edges WHERE target_file NOT IN (SELECT path FROM files)");
    }

    moduleEdgesBySource(file) {
        return this._moduleEdgesBySource.all(file);
    }

    moduleEdgesByTarget(file) {
        return this._moduleEdgesByTarget.all(file);
    }

    allModuleEdges() {
        return this._allModuleEdges.all();
    }

    rebuildAllModuleLayerEdges() {
        this._clearModuleLayerEdges.run();
        const rows = this.db.prepare(`
            SELECT me.source_file, me.target_file, me.line, me.is_reexport
            FROM module_edges me
            ORDER BY me.source_file, me.target_file, me.line
        `).all();

        for (const row of rows) {
            const sourceNode = this._findByQualified.get(`${row.source_file}:module`);
            const targetNode = this._findByQualified.get(`${row.target_file}:module`);
            if (!sourceNode || !targetNode) continue;
            const isExternal = row.target_file.startsWith(EXTERNAL_FILE_PREFIX);

            this.insertEdge({
                source_id: sourceNode.id,
                target_id: targetNode.id,
                layer: "module",
                kind: row.is_reexport
                    ? (isExternal ? "reexports_external_module" : "reexports_module")
                    : (isExternal ? "depends_on_external" : "depends_on"),
                confidence: isExternal ? "low" : "exact",
                origin: isExternal ? "unresolved" : "resolved",
                file: row.source_file,
                line: row.line ?? 0,
            });
        }
    }

    allLayerEdges(layer, kind = null) {
        if (kind) {
            return this.db.prepare(`
                SELECT e.*
                FROM edges e
                WHERE e.layer = ? AND e.kind = ?
                ORDER BY e.file, e.line, e.id
            `).all(layer, kind);
        }
        return this.db.prepare(`
            SELECT e.*
            FROM edges e
            WHERE e.layer = ?
            ORDER BY e.file, e.line, e.id
        `).all(layer);
    }

    // --- Unused export detection operations ---

    exportedNodes() {
        return this._exportedNodes.all();
    }

    importEdgeCount(nodeId) {
        return this._importEdgesTo.get(nodeId).c;
    }

    importEdgeSources(nodeId) {
        return this._importEdgeSources.all(nodeId);
    }

    exactImportEdgeCount(nodeId) {
        return this._exactImportEdgesTo.get(nodeId).c;
    }

    namespaceImportEdgeCount(nodeId) {
        return this._namespaceImportEdgesTo.get(nodeId).c;
    }

    reexportSourcesTo(nodeId) {
        return this._reexportSourcesTo.all(nodeId);
    }

    moduleEdgeExists(sourceFile, targetFile) {
        return !!this._moduleEdgeExists.get(sourceFile, targetFile);
    }

    findReferences(nodeId) {
        return this._findReferences.all(nodeId);
    }

    // --- Bulk operations (transaction) ---

    clearFile(filePath) {
        // CASCADE: deleting file removes all nodes + edges
        this._deleteFile.run(filePath);
    }

    bulkInsert(filePath, mtime, hash, language, definitions, imports) {
        const tx = this.db.transaction(() => {
            // Clear old data for this file
            this._deleteFile.run(filePath);

            const allNodes = [...definitions, ...imports];
            this._insertFile.run(filePath, mtime, hash, allNodes.length);

            const nodeIds = new Map();
            const classIndex = new Map(); // className -> nodeId

            for (const def of definitions) {
                const id = this.insertNode({
                    name: def.name,
                    qualified_name: def.parent
                        ? `${filePath}:${def.parent}.${def.name}`
                        : `${filePath}:${def.name}`,
                    kind: def.kind,
                    language,
                    file: filePath,
                    line_start: def.line_start,
                    line_end: def.line_end,
                    parent_id: def.parent ? (classIndex.get(def.parent) || null) : null,
                    signature: def.signature || null,
                });
                nodeIds.set(def.key, id);

                // Index class definitions for fast parent lookup
                // Null on collision (same-name classes in one file = ambiguous parent)
                if (def.kind === "class") {
                    if (classIndex.has(def.name)) {
                        classIndex.set(def.name, null);
                    } else {
                        classIndex.set(def.name, id);
                    }
                }
            }

            for (const imp of imports) {
                const id = this.insertNode({
                    name: imp.name,
                    qualified_name: `${filePath}:import:${imp.source}:${imp.line}`,
                    kind: "import",
                    language,
                    file: filePath,
                    line_start: imp.line,
                    line_end: imp.line,
                    parent_id: null,
                    signature: null,
                });
                nodeIds.set(`import:${imp.source}:${imp.line}`, id);
            }

            return nodeIds;
        });

        return tx();
    }

    // --- Query: Search symbols (FTS5) ---

    search(query, { kind, limit = 20 } = {}) {
        let ftsQuery = query;
        if (kind) ftsQuery = `${query} AND kind:${kind}`;

        try {
            return this._searchFts.all(ftsQuery, limit);
        } catch {
            // Fallback to LIKE if FTS query syntax fails
            const likeQuery = `%${query}%`;
            const stmt = kind
                ? this.db.prepare("SELECT * FROM nodes WHERE name LIKE ? AND kind = ? LIMIT ?")
                : this.db.prepare("SELECT * FROM nodes WHERE name LIKE ? LIMIT ?");
            return kind ? stmt.all(likeQuery, kind, limit) : stmt.all(likeQuery, limit);
        }
    }

    // --- Query: Architecture report data ---

    architectureReportData(scopePath) {
        // Group nodes by directory (module proxy)
        const allNodes = scopePath
            ? this.db.prepare("SELECT * FROM nodes WHERE file LIKE ? || '%' ESCAPE '\\'")
                .all(scopePath.replace(/[%_\\]/g, m => "\\" + m))
            : this.db.prepare("SELECT * FROM nodes").all();

        const modules = new Map();
        for (const node of allNodes) {
            const parts = node.file.replace(/\\/g, "/").split("/");
            const moduleKey = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
            if (!modules.has(moduleKey)) {
                modules.set(moduleKey, { files: new Set(), symbols: 0, kinds: {} });
            }
            const mod = modules.get(moduleKey);
            mod.files.add(node.file);
            mod.symbols++;
            mod.kinds[node.kind] = (mod.kinds[node.kind] || 0) + 1;
        }

        // Hotspots: complex functions with many callers
        const hotspots = this.db.prepare(`
            SELECT n.file, n.name, n.kind, n.line_start,
                   COALESCE(cb.stmt_count, n.line_end - n.line_start + 1) AS complexity,
                   (cb.stmt_count IS NOT NULL) AS has_stmts,
                   COUNT(DISTINCT e.source_id) AS callers
            FROM nodes n
            LEFT JOIN clone_blocks cb ON cb.node_id = n.id
            LEFT JOIN edges e ON e.target_id = n.id AND e.kind = 'calls'
            WHERE n.kind IN ('function', 'method')
            GROUP BY n.id
            HAVING callers > 0
            ORDER BY complexity * callers DESC
            LIMIT ?
        `).all(15);

        // Cross-module edges come from the unified module layer only.
        const grouped = new Map();
        for (const edge of this.moduleGraphEdges()) {
            const srcDir = moduleDir(edge.source_file);
            const tgtDir = moduleDir(edge.target_file);
            if (srcDir === tgtDir) continue;
            const key = `${srcDir}->${tgtDir}`;
            grouped.set(key, {
                src_dir: srcDir,
                tgt_dir: tgtDir,
                count: (grouped.get(key)?.count || 0) + 1,
            });
        }
        const crossEdges = [...grouped.values()]
            .sort((a, b) => b.count - a.count || a.src_dir.localeCompare(b.src_dir))
            .slice(0, 20);

        return { modules, hotspots, crossEdges };
    }

    // --- Query: Hotspots (complexity × callers) ---

    hotspots({ minCallers = 2, minComplexity = 15, limit = 20, scopePath } = {}) {
        const scopeFilter = scopePath
            ? "AND n.file LIKE ? || '%' ESCAPE '\\'"
            : "";
        const sql = `
            SELECT n.file, n.name, n.kind, n.line_start, n.line_end,
                   COALESCE(cb.stmt_count, MAX(n.line_end - n.line_start + 1, 1)) AS complexity,
                   COUNT(DISTINCT e.source_id) AS callers,
                   COALESCE(cb.stmt_count, MAX(n.line_end - n.line_start + 1, 1)) * COUNT(DISTINCT e.source_id) AS risk,
                   cb.stmt_count AS raw_stmt_count
            FROM nodes n
            LEFT JOIN clone_blocks cb ON cb.node_id = n.id
            LEFT JOIN edges e ON e.target_id = n.id AND e.kind = 'calls'
            WHERE n.kind IN ('function', 'method')
            ${scopeFilter}
            GROUP BY n.id
            HAVING callers >= ? AND complexity >= ?
            ORDER BY risk DESC
            LIMIT ?
        `;
        const params = scopePath
            ? [scopePath.replace(/[%_\\]/g, m => "\\" + m), minCallers, minComplexity, limit]
            : [minCallers, minComplexity, limit];
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(r => ({
            file: r.file,
            name: r.name,
            kind: r.kind,
            line_start: r.line_start,
            line_end: r.line_end,
            complexity: r.complexity,
            callers: r.callers,
            risk: r.risk,
            complexity_source: r.raw_stmt_count != null ? "stmt_count" : "line_span_fallback",
        }));
    }

    moduleMetricRows({ scopePath, sort = "instability", minCoupling = 2 } = {}) {
        const metrics = new Map();
        const incoming = new Map();
        const outgoing = new Map();

        for (const edge of this.moduleGraphEdges()) {
            if (!outgoing.has(edge.source_file)) outgoing.set(edge.source_file, new Set());
            if (!incoming.has(edge.target_file)) incoming.set(edge.target_file, new Set());
            outgoing.get(edge.source_file).add(edge.target_file);
            incoming.get(edge.target_file).add(edge.source_file);
        }

        const files = new Set([...incoming.keys(), ...outgoing.keys()]);
        for (const file of files) {
            const m = metrics.get(file) || { file, ca: 0, ce: 0 };
            m.ca = incoming.get(file)?.size || 0;
            m.ce = outgoing.get(file)?.size || 0;
            metrics.set(file, m);
        }

        let result = [...metrics.values()]
            .map(m => ({
                file: m.file,
                ca: m.ca,
                ce: m.ce,
                instability: m.ca + m.ce > 0 ? m.ce / (m.ca + m.ce) : 0,
                total_coupling: m.ca + m.ce,
            }))
            .filter(m => m.total_coupling >= minCoupling);

        if (scopePath) {
            result = result.filter(m => m.file.startsWith(scopePath));
        }

        const sortFns = {
            instability: (a, b) => b.instability - a.instability || b.total_coupling - a.total_coupling,
            ca: (a, b) => b.ca - a.ca || b.total_coupling - a.total_coupling,
            ce: (a, b) => b.ce - a.ce || b.total_coupling - a.total_coupling,
            coupling: (a, b) => b.total_coupling - a.total_coupling,
        };
        result.sort(sortFns[sort] || sortFns.instability);

        return result;
    }

    moduleGraphEdges() {
        return this.db.prepare(`
            SELECT
                e.kind,
                e.confidence,
                e.file,
                e.line,
                src.file AS source_file,
                tgt.file AS target_file
            FROM edges e
            JOIN nodes src ON src.id = e.source_id
            JOIN nodes tgt ON tgt.id = e.target_id
            WHERE e.layer = 'module'
              AND src.kind IN ('module', 'external_module')
              AND tgt.kind IN ('module', 'external_module')
            ORDER BY src.file, tgt.file, e.line, e.id
        `).all();
    }

    // --- Stats ---

    stats() {
        const files = this.db.prepare("SELECT COUNT(*) as count FROM files").get().count;
        const nodes = this.db.prepare("SELECT COUNT(*) as count FROM nodes").get().count;
        const edges = this.db.prepare("SELECT COUNT(*) as count FROM edges").get().count;
        return { files, nodes, edges };
    }

    close() {
        this.db.close();
        _stores.delete(this.projectPath);
    }
}

export function resolveStore(path) {
    if (path) {
        const abs = resolve(path);
        // 1. Exact match in memory
        const store = _stores.get(abs);
        if (store) return store;
        // 2. Prefix match: abs is subdirectory of indexed project
        for (const [key, s] of _stores) {
            if (abs.startsWith(key + "/") || abs.startsWith(key + "\\")) return s;
        }
        // 3. Auto-open persisted DB from disk (readonly probe first)
        const dbPath = join(abs, CODEGRAPH_DIR, "index.db");
        if (existsSync(dbPath)) {
            try {
                const probe = new Database(dbPath, { readonly: true });
                const ver = probe.pragma("user_version", { simple: true });
                probe.close();
                if (ver === SCHEMA_VERSION) {
                    return getStore(abs);
                }
            } catch { /* corrupt DB — return null, don't delete */ }
        }
    }
    // 4. Fallback: first available store (for tools that omit path)
    return _stores.values().next().value ?? null;
}

function serializeNode(node) {
    if (!node) return null;
    return {
        symbol_id: node.id,
        qualified_name: node.qualified_name || null,
        display_name: displayName(node),
        name: node.name,
        kind: node.kind,
        language: node.language || null,
        file: node.file,
        line_start: node.line_start,
        line_end: node.line_end,
        signature: node.signature || null,
        is_exported: !!node.is_exported,
        is_default_export: !!node.is_default_export,
    };
}

function selectorError(code, message, recovery) {
    return { error: { code, message, recovery } };
}

function normalizeSelector(selector = {}) {
    const { symbol_id, qualified_name, name, file } = selector;
    const hasId = symbol_id !== undefined && symbol_id !== null;
    const hasQualified = typeof qualified_name === "string" && qualified_name.length > 0;
    const hasNameFile = typeof name === "string" && name.length > 0 && typeof file === "string" && file.length > 0;
    const forms = [hasId, hasQualified, hasNameFile].filter(Boolean).length;
    if (forms !== 1) {
        return selectorError(
            "INVALID_SELECTOR",
            "Selector must provide exactly one of: symbol_id, qualified_name, or name+file",
            "Use search_symbols first to discover valid identifiers"
        );
    }
    if (hasId) return { kind: "symbol_id", value: Number(symbol_id), query: { symbol_id: Number(symbol_id) } };
    if (hasQualified) return { kind: "qualified_name", value: qualified_name, query: { qualified_name } };
    return { kind: "name_file", value: { name, file }, query: { name, file } };
}

function resolveSelector(store, selector = {}) {
    const normalized = normalizeSelector(selector);
    if (normalized.error) return normalized;

    if (normalized.kind === "symbol_id") {
        const node = store.getNodeById(normalized.value);
        if (!node) {
            return selectorError("SYMBOL_NOT_FOUND", `No symbol with id ${normalized.value}`, "Run search_symbols to find a valid symbol_id");
        }
        return { query: normalized.query, node, reason: "resolved_by_symbol_id", confidence: "exact" };
    }

    if (normalized.kind === "qualified_name") {
        const matches = store.findByQualified(normalized.value);
        if (matches.length === 0) {
            return selectorError("SYMBOL_NOT_FOUND", `No symbol with qualified_name '${normalized.value}'`, "Run search_symbols to inspect available qualified names");
        }
        if (matches.length > 1) {
            return {
                error: {
                    code: "AMBIGUOUS_SYMBOL",
                    message: `Multiple symbols matched qualified_name '${normalized.value}'`,
                    recovery: "Use symbol_id instead of qualified_name",
                    candidates: matches.map(serializeNode),
                },
            };
        }
        return { query: normalized.query, node: matches[0], reason: "resolved_by_qualified_name", confidence: "exact" };
    }

    const { name, file } = normalized.value;
    const matches = store.findByName(name).filter(n =>
        n.file === file || n.file.endsWith(file) || n.file.endsWith(`/${file}`)
    );
    if (matches.length === 0) {
        return selectorError("SYMBOL_NOT_FOUND", `No symbol '${name}' found in '${file}'`, "Run search_symbols to inspect file paths and symbol names");
    }
    const semantic = matches.filter(n => n.kind !== "import");
    if (semantic.length > 1) {
        return {
            error: {
                code: "AMBIGUOUS_SYMBOL",
                message: `Multiple symbols named '${name}' matched file '${file}'`,
                recovery: "Use symbol_id or qualified_name",
                candidates: semantic.map(serializeNode),
            },
        };
    }
    const node = semantic[0] || matches[0];
    return { query: normalized.query, node, reason: "resolved_by_name_file", confidence: "exact" };
}

function resolveOptionalSelector(store, selector = null) {
    if (!selector) return null;
    const values = [selector.symbol_id, selector.qualified_name, selector.name, selector.file];
    if (values.every(value => value === undefined || value === null || value === "")) return null;
    return resolveSelector(store, selector);
}

function collectReferenceRows(store, node, kind) {
    let refs = store.findReferences(node.id);
    const reexportProxies = store.reexportSourcesTo(node.id);
    for (const { source_id } of reexportProxies) {
        refs.push(...store.findReferences(source_id));
    }
    if (kind && kind !== "all") refs = refs.filter(r => r.kind === kind);
    return refs;
}

function serializeFlowSummary(row) {
    return {
        kind: row.kind,
        source_name: row.source_name,
        target_name: row.target_name,
        confidence: row.confidence,
        file: row.file,
        line: row.line,
        related_symbol: row.related_symbol_id
            ? {
                symbol_id: row.related_symbol_id,
                qualified_name: row.related_qualified_name || null,
                display_name: displayName({ name: row.related_name, kind: row.related_kind }),
                name: row.related_name,
                kind: row.related_kind,
                language: row.related_language || null,
                file: row.related_file,
                line_start: row.related_line,
            }
            : null,
    };
}

function serializeFlowEdge(row, direction) {
    return {
        layer: "flow",
        kind: row.kind,
        confidence: row.confidence,
        file: row.file,
        line: row.line,
        direction,
        source_name: row.source_name,
        target_name: row.target_name,
    };
}

function moduleDir(filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    return idx === -1 ? "." : normalized.slice(0, idx);
}


// --- Exported query functions (for server.mjs tool handlers) ---
export function findSymbols(query, { kind, limit = 20, path } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");

    let results = store.search(query, { kind, limit });
    if (kind !== "all") {
        results = results.filter(r => r.name !== "__default_export__" && r.kind !== "reexport");
    }
    return {
        query: { query, kind: kind || null, limit },
        matches: results.map(serializeNode),
        confidence: "exact",
        reason: "fts_lookup",
        evidence: { total_matches: results.length },
        limits_applied: { limit },
    };
}

export function getSymbol(selector, { path } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    const resolved = resolveSelector(store, selector);
    if (resolved.error) return resolved;

    const node = resolved.node;
    const incoming = store.edgesTo(node.id).map(e => ({
        kind: e.kind,
        confidence: e.confidence,
        file: e.file,
        line: e.line,
        from: {
            name: e.source_name,
            file: e.source_file,
            line: e.source_line,
        },
    }));
    const outgoing = store.edgesFrom(node.id).map(e => ({
        kind: e.kind,
        confidence: e.confidence,
        file: e.file,
        line: e.line,
        to: {
            name: e.target_name,
            file: e.target_file,
            line: e.target_line,
        },
    }));
    const moduleNode = store.nodesByFile(node.file).find(n => n.kind === "module");

    return {
        query: resolved.query,
        result: {
            symbol: serializeNode(node),
            module: serializeNode(moduleNode),
            incoming,
            outgoing,
            siblings: store.nodesByFile(node.file)
                .filter(n => n.id !== node.id)
                .map(serializeNode),
        },
        confidence: resolved.confidence,
        reason: resolved.reason,
        evidence: {
            incoming_count: incoming.length,
            outgoing_count: outgoing.length,
        },
        limits_applied: {},
    };
}

export function tracePaths(selector, {
    path_kind = "calls",
    direction = "reverse",
    depth = 3,
    limit = 50,
    path,
    target = null,
} = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    const resolved = resolveSelector(store, selector);
    if (resolved.error) return resolved;
    const resolvedTarget = resolveOptionalSelector(store, target);
    if (resolvedTarget?.error) return resolvedTarget;
    const targetNode = resolvedTarget?.node || null;

    const includeFlow = path_kind === "flow" || path_kind === "mixed";
    const edgeKinds = path_kind === "calls"
        ? new Set(["calls"])
        : path_kind === "references"
            ? new Set(["ref_read", "ref_type", "imports", "reexports"])
            : path_kind === "imports"
                ? new Set(["imports", "reexports"])
                : path_kind === "type"
                    ? new Set(["extends", "implements", "overrides"])
                    : path_kind === "flow"
                        ? new Set()
                        : new Set(["calls", "ref_read", "ref_type", "imports", "reexports", "extends", "implements", "overrides"]);

    const getNeighbors = (nodeId) => {
        const rows = [];
        if (direction === "forward" || direction === "both") {
            for (const e of store.edgesFrom(nodeId)) {
                if (!edgeKinds.has(e.kind)) continue;
                rows.push({
                    nextId: e.target_id,
                    edge: {
                        kind: e.kind,
                        confidence: e.confidence,
                        file: e.file,
                        line: e.line,
                        direction: "forward",
                    },
                });
            }
            if (includeFlow) {
                for (const row of store.flowSummariesByOwner(nodeId)) {
                    if (!row.related_symbol_id) continue;
                    rows.push({
                        nextId: row.related_symbol_id,
                        edge: serializeFlowEdge(row, "forward"),
                    });
                }
            }
        }
        if (direction === "reverse" || direction === "both") {
            for (const e of store.edgesTo(nodeId)) {
                if (!edgeKinds.has(e.kind)) continue;
                rows.push({
                    nextId: e.source_id,
                    edge: {
                        kind: e.kind,
                        confidence: e.confidence,
                        file: e.file,
                        line: e.line,
                        direction: "reverse",
                    },
                });
            }
            if (includeFlow) {
                for (const row of store.flowSummariesByRelatedSymbol(nodeId)) {
                    rows.push({
                        nextId: row.owner_id,
                        edge: serializeFlowEdge(row, "reverse"),
                    });
                }
            }
        }
        return rows;
    };

    const queue = [{
        id: resolved.node.id,
        depth: 0,
        nodes: [serializeNode(resolved.node)],
        edges: [],
        seen: new Set([resolved.node.id]),
    }];
    const paths = [];

    while (queue.length > 0 && paths.length < limit) {
        const current = queue.shift();
        if (current.depth >= depth) continue;
        const neighbors = getNeighbors(current.id);
        for (const neighbor of neighbors) {
            if (current.seen.has(neighbor.nextId)) continue;
            const nextNode = store.getNodeById(neighbor.nextId);
            if (!nextNode) continue;
            const nextSeen = new Set(current.seen);
            nextSeen.add(neighbor.nextId);
            const nextPath = {
                id: neighbor.nextId,
                depth: current.depth + 1,
                nodes: [...current.nodes, serializeNode(nextNode)],
                edges: [...current.edges, neighbor.edge],
                seen: nextSeen,
            };
            const matchesTarget = !targetNode || neighbor.nextId === targetNode.id;
            if (matchesTarget) {
                paths.push({
                    depth: nextPath.depth,
                    nodes: nextPath.nodes,
                    edges: nextPath.edges,
                });
            }
            queue.push(nextPath);
            if (paths.length >= limit) break;
        }
    }

    return {
        query: {
            ...resolved.query,
            path_kind,
            direction,
            depth,
            limit,
            target: resolvedTarget ? resolvedTarget.query : null,
        },
        result: paths,
        confidence: resolved.confidence,
        reason: targetNode ? "targeted_path_lookup" : resolved.reason,
        evidence: {
            traversed_path_count: paths.length,
            target_found: targetNode ? paths.length > 0 : null,
        },
        limits_applied: { depth, limit },
    };
}

export function explainResolution(selector, { path } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    const normalized = normalizeSelector(selector);
    if (normalized.error) return normalized;
    const resolved = resolveSelector(store, selector);
    if (resolved.error) return resolved;

    let candidates = [];
    if (normalized.kind === "qualified_name") {
        candidates = store.findByQualified(normalized.value).map(serializeNode);
    } else if (normalized.kind === "name_file") {
        candidates = store.findByName(normalized.value.name)
            .filter(n => n.file === normalized.value.file || n.file.endsWith(normalized.value.file) || n.file.endsWith(`/${normalized.value.file}`))
            .map(serializeNode);
    } else {
        candidates = [serializeNode(store.getNodeById(normalized.value))];
    }

    return {
        query: normalized.query,
        result: {
            resolved: serializeNode(resolved.node),
            selector_kind: normalized.kind,
            candidates,
        },
        confidence: resolved.confidence,
        reason: resolved.reason,
        evidence: { candidate_count: candidates.length },
        limits_applied: {},
    };
}

export function getReferencesBySelector(selector, { kind, limit = 50, path } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    const resolved = resolveSelector(store, selector);
    if (resolved.error) return resolved;

    const refs = collectReferenceRows(store, resolved.node, kind).slice(0, limit);
    const byKind = {};
    for (const row of refs) byKind[row.kind] = (byKind[row.kind] || 0) + 1;

    return {
        query: { ...resolved.query, kind: kind || "all", limit },
        result: {
            symbol: serializeNode(resolved.node),
            references: refs.map(r => ({ file: r.file, line: r.line, kind: r.kind })),
            total_by_kind: byKind,
            total: refs.length,
        },
        confidence: resolved.confidence,
        reason: resolved.reason,
        evidence: { total_found: refs.length },
        limits_applied: { limit },
    };
}

export function findImplementationsBySelector(selector, { limit = 50, path } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    const resolved = resolveSelector(store, selector);
    if (resolved.error) return resolved;

    const allowedKinds = resolved.node.kind === "method"
        ? new Set(["overrides"])
        : new Set(["implements", "extends", "overrides"]);
    const matches = store.edgesTo(resolved.node.id)
        .filter(edge => edge.layer === "type" && allowedKinds.has(edge.kind))
        .slice(0, limit)
        .map(edge => ({
            kind: edge.kind,
            confidence: edge.confidence,
            source: {
                id: edge.source_id,
                name: edge.source_name,
                display_name: displayName({ name: edge.source_name, kind: edge.source_kind }),
                kind: edge.source_kind,
                language: edge.source_language,
                file: edge.source_file,
                line_start: edge.source_line,
                qualified_name: edge.source_qualified_name || null,
            },
            evidence: {
                layer: edge.layer,
                origin: edge.origin,
                file: edge.file,
                line: edge.line,
            },
        }));

    return {
        query: resolved.query,
        result: {
            symbol: serializeNode(resolved.node),
            implementations: matches,
        },
        confidence: matches.some(match => match.confidence === "heuristic") ? "heuristic" : resolved.confidence,
        reason: "type_graph_lookup",
        evidence: { match_count: matches.length },
        limits_applied: { limit },
    };
}

export function findDataflowsBySelector(selector, { depth = 2, limit = 50, path, target = null } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    const resolved = resolveSelector(store, selector);
    if (resolved.error) return resolved;
    const resolvedTarget = resolveOptionalSelector(store, target);
    if (resolvedTarget?.error) return resolvedTarget;
    const targetNode = resolvedTarget?.node || null;

    const rootNode = resolved.node;
    const rootSummaries = store.flowSummariesByOwner(rootNode.id);
    const summaries = rootSummaries.slice(0, limit).map(serializeFlowSummary);
    const paths = [];
    const queue = [{
        owner: rootNode,
        depth: 0,
        symbols: [serializeNode(rootNode)],
        summaries: [],
        seen: new Set([rootNode.id]),
    }];

    while (queue.length > 0 && paths.length < limit) {
        const current = queue.shift();
        if (current.depth >= depth) continue;
        const flowRows = store.flowSummariesByOwner(current.owner.id);
        for (const row of flowRows) {
            const summary = serializeFlowSummary(row);
            if (row.related_symbol_id) {
                const nextNode = store.getNodeById(row.related_symbol_id);
                if (nextNode && !current.seen.has(nextNode.id)) {
                    const nextSeen = new Set(current.seen);
                    nextSeen.add(nextNode.id);
                    const nextPath = {
                        owner: nextNode,
                        depth: current.depth + 1,
                        symbols: [...current.symbols, serializeNode(nextNode)],
                        summaries: [...current.summaries, summary],
                        seen: nextSeen,
                    };
                    const matchesTarget = !targetNode || nextNode.id === targetNode.id;
                    if (matchesTarget) {
                        paths.push({
                            depth: nextPath.depth,
                            symbols: nextPath.symbols,
                            summaries: nextPath.summaries,
                        });
                    }
                    queue.push(nextPath);
                    if (paths.length >= limit) break;
                }
            } else if (!targetNode && current.summaries.length === 0) {
                paths.push({
                    depth: current.depth,
                    symbols: current.symbols,
                    summaries: [summary],
                });
                if (paths.length >= limit) break;
            }
        }
    }

    const confidence = [...rootSummaries, ...paths.flatMap(path => path.summaries)].some(summary => summary.confidence === "heuristic")
        ? "heuristic"
        : [...rootSummaries, ...paths.flatMap(path => path.summaries)].some(summary => summary.confidence === "inferred")
            ? "inferred"
            : resolved.confidence;

    return {
        query: { ...resolved.query, depth, limit, target: resolvedTarget ? resolvedTarget.query : null },
        result: {
            symbol: serializeNode(rootNode),
            summaries,
            paths,
            target: targetNode ? serializeNode(targetNode) : null,
        },
        confidence,
        reason: targetNode ? "targeted_flow_lookup" : "flow_summary_lookup",
        evidence: {
            summary_count: summaries.length,
            path_count: paths.length,
            target_found: targetNode ? paths.length > 0 : null,
        },
        limits_applied: { depth, limit },
    };
}

export function getModuleMetricsReport({ scopePath, sort, minCoupling, path } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    return {
        query: { scopePath: scopePath || null, sort: sort || "instability", minCoupling: minCoupling || 2 },
        result: store.moduleMetricRows({ scopePath, sort, minCoupling }),
        confidence: "exact",
        reason: "module_graph_metrics",
        evidence: {},
        limits_applied: {},
    };
}

export function getArchitectureReport({ scopePath, limit = 15, path } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    const { modules, hotspots, crossEdges } = store.architectureReportData(scopePath);
    const moduleRows = [...modules.entries()].map(([name, mod]) => ({
        module: name,
        file_count: mod.files.size,
        symbol_count: mod.symbols,
        kinds: mod.kinds,
    }));
    const stats = store.stats();
    return {
        query: { scopePath: scopePath || null, limit },
        result: {
            modules: moduleRows,
            hotspots: hotspots.slice(0, limit).map(h => ({
                name: displayName(h),
                kind: h.kind,
                file: h.file,
                complexity: h.complexity,
                callers: h.callers,
            })),
            cross_module_edges: crossEdges,
            stats,
        },
        confidence: "exact",
        reason: "architecture_summary",
        evidence: {},
        limits_applied: { limit },
    };
}

export function getHotspots({ minCallers = 2, minComplexity = 15, limit = 20, scopePath, path } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    return store.hotspots({ minCallers, minComplexity, limit, scopePath });
}
