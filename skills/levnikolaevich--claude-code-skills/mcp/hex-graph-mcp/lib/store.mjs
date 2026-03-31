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
import { confidenceAtLeast, dedupeStrongest } from "./confidence.mjs";
import { normalizeProviderRun } from "./precise/provider-status.mjs";

const SCHEMA_VERSION = 5;
export const CODEGRAPH_DIR = ".hex-skills/codegraph";
const EXTERNAL_FILE_PREFIX = "[[external]]/";
const NODE_SELECT_COLUMNS = `
    id,
    name,
    qualified_name,
    workspace_qualified_name,
    kind,
    language,
    file,
    line_start,
    line_end,
    signature,
    is_exported,
    is_default_export,
    package_id,
    workspace_module_id
`;

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
            CREATE TABLE IF NOT EXISTS packages (
                id INTEGER PRIMARY KEY,
                package_key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                language TEXT NOT NULL,
                root_path TEXT NOT NULL,
                is_external INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS workspace_modules (
                id INTEGER PRIMARY KEY,
                module_key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                package_id INTEGER REFERENCES packages(id) ON DELETE CASCADE,
                language TEXT NOT NULL,
                root_path TEXT NOT NULL,
                is_external INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                mtime REAL NOT NULL,
                hash TEXT NOT NULL,
                node_count INTEGER DEFAULT 0,
                package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
                workspace_module_id INTEGER REFERENCES workspace_modules(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                qualified_name TEXT,
                workspace_qualified_name TEXT,
                kind TEXT NOT NULL,
                language TEXT NOT NULL,
                file TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
                package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
                workspace_module_id INTEGER REFERENCES workspace_modules(id) ON DELETE SET NULL,
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
                evidence_json TEXT,
                file TEXT NOT NULL,
                line INTEGER,
                edge_hash TEXT
            );

            CREATE TABLE IF NOT EXISTS provider_runs (
                id INTEGER PRIMARY KEY,
                provider TEXT NOT NULL,
                language TEXT NOT NULL,
                status TEXT NOT NULL,
                version TEXT,
                detail TEXT,
                indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(provider, language)
            );

            CREATE INDEX IF NOT EXISTS idx_packages_key ON packages(package_key);
            CREATE INDEX IF NOT EXISTS idx_workspace_modules_key ON workspace_modules(module_key);
            CREATE INDEX IF NOT EXISTS idx_files_package_id ON files(package_id);
            CREATE INDEX IF NOT EXISTS idx_files_workspace_module_id ON files(workspace_module_id);
            CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
            CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
            CREATE INDEX IF NOT EXISTS idx_nodes_qualified ON nodes(qualified_name);
            CREATE INDEX IF NOT EXISTS idx_nodes_workspace_qualified ON nodes(workspace_qualified_name);
            CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
            CREATE INDEX IF NOT EXISTS idx_nodes_package_id ON nodes(package_id);
            CREATE INDEX IF NOT EXISTS idx_nodes_workspace_module_id ON nodes(workspace_module_id);
            CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
            CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind, source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_kind_target ON edges(kind, target_id);
            CREATE INDEX IF NOT EXISTS idx_edges_layer_kind_source ON edges(layer, kind, source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_layer_kind_target ON edges(layer, kind, target_id);
            CREATE INDEX IF NOT EXISTS idx_provider_runs_language ON provider_runs(language);
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
            SELECT 2 AS contract_version;

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
                    SELECT COUNT(DISTINCT e.target_id)
                    FROM edges e
                    WHERE e.source_id = n.id AND e.kind = 'calls'
                ) AS callees,
                (
                    SELECT COUNT(DISTINCT e.source_id)
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

        // hex-line clone siblings view (contract v2)
        this.db.exec(`
            CREATE VIEW IF NOT EXISTS hex_line_clone_siblings AS
            SELECT
                cb.node_id AS node_id,
                cb.norm_hash AS norm_hash,
                n.file AS file,
                n.line_start AS line_start,
                CASE
                    WHEN n.name = '__default_export__' THEN 'default export'
                    ELSE n.name
                END AS display_name
            FROM clone_blocks cb
            JOIN nodes n ON n.id = cb.node_id;
        `);

        // Module-level import edges (file-to-file raw evidence)
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

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS package_edges (
                id INTEGER PRIMARY KEY,
                source_module_id INTEGER NOT NULL REFERENCES workspace_modules(id) ON DELETE CASCADE,
                target_module_id INTEGER REFERENCES workspace_modules(id) ON DELETE SET NULL,
                source_package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
                target_package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
                source_file TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
                target_file TEXT,
                import_source TEXT NOT NULL,
                resolution TEXT NOT NULL,
                is_reexport INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_package_edges_source_module ON package_edges(source_module_id);
            CREATE INDEX IF NOT EXISTS idx_package_edges_target_module ON package_edges(target_module_id);
            CREATE INDEX IF NOT EXISTS idx_package_edges_source_package ON package_edges(source_package_id);
            CREATE INDEX IF NOT EXISTS idx_package_edges_target_package ON package_edges(target_package_id);
            CREATE INDEX IF NOT EXISTS idx_package_edges_source_file ON package_edges(source_file);
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
            "INSERT OR REPLACE INTO files (path, mtime, hash, node_count, package_id, workspace_module_id) VALUES (?, ?, ?, ?, ?, ?)"
        );
        this._getFile = this.db.prepare("SELECT * FROM files WHERE path = ?");
        this._deleteFile = this.db.prepare("DELETE FROM files WHERE path = ?");
        this._allFiles = this.db.prepare("SELECT path FROM files");
        this._insertPackage = this.db.prepare(
            "INSERT INTO packages (package_key, name, language, root_path, is_external) VALUES (@package_key, @name, @language, @root_path, @is_external)"
        );
        this._getPackageByKey = this.db.prepare("SELECT * FROM packages WHERE package_key = ?");
        this._insertWorkspaceModule = this.db.prepare(
            "INSERT INTO workspace_modules (module_key, name, package_id, language, root_path, is_external) VALUES (@module_key, @name, @package_id, @language, @root_path, @is_external)"
        );
        this._getWorkspaceModuleByKey = this.db.prepare("SELECT * FROM workspace_modules WHERE module_key = ?");
        this._clearPackageEdgesForFile = this.db.prepare("DELETE FROM package_edges WHERE source_file = ?");
        this._insertPackageEdge = this.db.prepare(
            `INSERT INTO package_edges (
                source_module_id, target_module_id, source_package_id, target_package_id,
                source_file, target_file, import_source, resolution, is_reexport
            ) VALUES (
                @source_module_id, @target_module_id, @source_package_id, @target_package_id,
                @source_file, @target_file, @import_source, @resolution, @is_reexport
            )`
        );
        this._workspaceModuleRows = this.db.prepare(`
            SELECT
                wm.id,
                wm.module_key,
                wm.name,
                wm.language,
                wm.root_path,
                wm.is_external,
                p.package_key,
                p.name AS package_name,
                COUNT(DISTINCT f.path) AS file_count,
                COUNT(n.id) AS symbol_count
            FROM workspace_modules wm
            JOIN packages p ON p.id = wm.package_id
            LEFT JOIN files f ON f.workspace_module_id = wm.id
            LEFT JOIN nodes n ON n.file = f.path
            GROUP BY wm.id
        `);
        this._packageEdges = this.db.prepare(`
            SELECT
                pe.source_file,
                pe.target_file,
                pe.import_source,
                pe.resolution,
                pe.is_reexport,
                sm.module_key AS source_module_key,
                sm.name AS source_module_name,
                sp.package_key AS source_package_key,
                sp.name AS source_package_name,
                tm.module_key AS target_module_key,
                tm.name AS target_module_name,
                tp.package_key AS target_package_key,
                tp.name AS target_package_name
            FROM package_edges pe
            JOIN workspace_modules sm ON sm.id = pe.source_module_id
            JOIN packages sp ON sp.id = pe.source_package_id
            LEFT JOIN workspace_modules tm ON tm.id = pe.target_module_id
            LEFT JOIN packages tp ON tp.id = pe.target_package_id
            ORDER BY pe.source_file, pe.import_source
        `);

        this._insertNode = this.db.prepare(`
            INSERT INTO nodes (
                name, qualified_name, workspace_qualified_name, kind, language, file,
                package_id, workspace_module_id, line_start, line_end, parent_id, signature
            )
            VALUES (
                @name, @qualified_name, @workspace_qualified_name, @kind, @language, @file,
                @package_id, @workspace_module_id, @line_start, @line_end, @parent_id, @signature
            )
        `);

        this._insertEdge = this.db.prepare(`
            INSERT INTO edges (source_id, target_id, layer, kind, confidence, origin, evidence_json, file, line, edge_hash)
            VALUES (@source_id, @target_id, @layer, @kind, @confidence, @origin, @evidence_json, @file, @line, @edge_hash)
        `);
        this._clearEdgesByOrigin = this.db.prepare("DELETE FROM edges WHERE origin = ?");
        this._upsertProviderRun = this.db.prepare(`
            INSERT INTO provider_runs (provider, language, status, version, detail, indexed_at)
            VALUES (@provider, @language, @status, @version, @detail, CURRENT_TIMESTAMP)
            ON CONFLICT(provider, language) DO UPDATE SET
                status = excluded.status,
                version = excluded.version,
                detail = excluded.detail,
                indexed_at = CURRENT_TIMESTAMP
        `);
        this._providerRunByLanguage = this.db.prepare(
            "SELECT provider, language, status, version, detail, indexed_at FROM provider_runs WHERE language = ? ORDER BY indexed_at DESC LIMIT 1"
        );
        this._preciseCandidateEdgesByLanguage = this.db.prepare(`
            SELECT
                e.id,
                e.source_id,
                e.target_id,
                e.layer,
                e.kind,
                e.confidence,
                e.origin,
                e.evidence_json,
                e.file,
                e.line,
                source.language AS source_language,
                source.name AS source_name,
                source.file AS source_file,
                source.line_start AS source_line_start,
                source.kind AS source_kind,
                source.workspace_qualified_name AS source_workspace_qualified_name,
                target.language AS target_language,
                target.name AS target_name,
                target.file AS target_file,
                target.line_start AS target_line_start,
                target.kind AS target_kind,
                target.workspace_qualified_name AS target_workspace_qualified_name
            FROM edges e
            JOIN nodes source ON source.id = e.source_id
            JOIN nodes target ON target.id = e.target_id
            WHERE source.language = ?
              AND e.layer = 'symbol'
              AND e.kind IN ('imports', 'calls', 'ref_read', 'ref_type')
              AND e.origin NOT LIKE 'precise_%'
            ORDER BY e.file, e.line, e.id
        `);

        this._searchFts = this.db.prepare(`
            SELECT
                n.id,
                n.name,
                n.qualified_name,
                n.workspace_qualified_name,
                n.kind,
                n.language,
                n.file,
                n.line_start,
                n.line_end,
                n.signature,
                n.is_exported,
                n.is_default_export,
                n.package_id,
                n.workspace_module_id
            FROM nodes_fts fts
            JOIN nodes n ON n.id = fts.rowid
            WHERE nodes_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `);

        this._findByName = this.db.prepare(
            `SELECT ${NODE_SELECT_COLUMNS} FROM nodes WHERE name = ?`
        );

        this._findByQualified = this.db.prepare(
            `SELECT ${NODE_SELECT_COLUMNS} FROM nodes WHERE qualified_name = ?`
        );

        this._findByWorkspaceQualified = this.db.prepare(
            `SELECT ${NODE_SELECT_COLUMNS} FROM nodes WHERE workspace_qualified_name = ?`
        );

        this._getNodeById = this.db.prepare(
            `SELECT ${NODE_SELECT_COLUMNS} FROM nodes WHERE id = ?`
        );

        this._nodesByFile = this.db.prepare(
            `SELECT ${NODE_SELECT_COLUMNS} FROM nodes WHERE file = ? ORDER BY line_start`
        );

        this._fileOwnership = this.db.prepare(`
            SELECT
                f.package_id,
                f.workspace_module_id,
                p.package_key,
                p.name AS package_name,
                p.root_path AS package_root_path,
                wm.module_key,
                wm.name AS module_name,
                wm.root_path AS module_root_path
            FROM files f
            LEFT JOIN packages p ON p.id = f.package_id
            LEFT JOIN workspace_modules wm ON wm.id = f.workspace_module_id
            WHERE f.path = ?
        `);

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
            SELECT e.kind, e.line, e.file, e.confidence, e.origin, e.evidence_json,
                   n.id as source_id, n.name, n.kind as node_kind, n.file as node_file, n.line_start, n.qualified_name as source_qualified_name
            FROM edges e
            JOIN nodes n ON n.id = e.source_id
            WHERE e.target_id = ?
            ORDER BY e.kind, e.file, e.line
        `);
    }

    // --- File operations ---

    upsertFile(path, mtime, hash, nodeCount, ownership = {}) {
        this._insertFile.run(
            path,
            mtime,
            hash,
            nodeCount,
            ownership.package_id ?? null,
            ownership.workspace_module_id ?? null,
        );
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

    ensurePackage(pkg) {
        const existing = this._getPackageByKey.get(pkg.package_key);
        if (existing) return existing;
        const normalized = { is_external: 0, ...pkg };
        this._insertPackage.run(normalized);
        return this._getPackageByKey.get(normalized.package_key);
    }

    ensureWorkspaceModule(mod) {
        const existing = this._getWorkspaceModuleByKey.get(mod.module_key);
        if (existing) return existing;
        const normalized = { is_external: 0, ...mod };
        this._insertWorkspaceModule.run(normalized);
        return this._getWorkspaceModuleByKey.get(normalized.module_key);
    }

    externalModuleFile(source) {
        return `${EXTERNAL_FILE_PREFIX}${source}`;
    }

    // --- Node operations ---

    insertNode(node) {
        const ownership = node.file ? this.describeFileOwnership(node.file) : null;
        const normalized = {
            ...node,
            workspace_qualified_name: node.workspace_qualified_name
                ?? buildWorkspaceQualifiedName(node, ownership),
            package_id: node.package_id ?? ownership?.package_id ?? null,
            workspace_module_id: node.workspace_module_id ?? ownership?.workspace_module_id ?? null,
        };
        const result = this._insertNode.run(normalized);
        return result.lastInsertRowid;
    }

    ensureExternalModuleNode(source, language = "external") {
        const filePath = this.externalModuleFile(source);
        if (!this.getFile(filePath)) {
            this._insertFile.run(filePath, 0, `external:${source}`, 1, null, null);
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

    findByWorkspaceQualified(workspaceQualifiedName) {
        return this._findByWorkspaceQualified.all(workspaceQualifiedName);
    }

    getNodeById(id) {
        return this._getNodeById.get(id);
    }

    describeFileOwnership(filePath) {
        return this._fileOwnership.get(filePath) || null;
    }

    // --- Edge operations ---

    insertEdge(edge) {
        const normalized = {
            layer: "syntax",
            confidence: "exact",
            origin: "parsed",
            evidence_json: null,
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

    clearEdgesByOrigin(origin) {
        this._clearEdgesByOrigin.run(origin);
    }

    upsertProviderRun(run) {
        this._upsertProviderRun.run({
            provider: run.provider,
            language: run.language,
            status: run.status,
            version: run.version ?? null,
            detail: run.detail ?? null,
        });
    }

    providerStatusForLanguage(language) {
        return normalizeProviderRun(this._providerRunByLanguage.get(language) || null, language);
    }

    preciseCandidateEdges(language) {
        return this._preciseCandidateEdgesByLanguage.all(language);
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

    clearPackageEdgesForFile(filePath) {
        this._clearPackageEdgesForFile.run(filePath);
    }

    insertPackageEdge(params) {
        this._insertPackageEdge.run(params);
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

    workspaceModuleRows() {
        return this._workspaceModuleRows.all();
    }

    packageEdgeRows() {
        return this._packageEdges.all();
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

    bulkInsert(filePath, mtime, hash, language, definitions, imports, ownership = null) {
        const tx = this.db.transaction(() => {
            // Clear old data for this file
            this._deleteFile.run(filePath);

            const allNodes = [...definitions, ...imports];
            this._insertFile.run(
                filePath,
                mtime,
                hash,
                allNodes.length,
                ownership?.package_id ?? null,
                ownership?.workspace_module_id ?? null,
            );

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
        // workspace-first architecture view
        const normalizedScope = normalizeScopePath(scopePath);
        const allNodes = scopePath
            ? this.db.prepare("SELECT * FROM nodes WHERE file LIKE ? || '%' ESCAPE '\\'")
                .all(scopePath.replace(/[%_\\]/g, m => "\\" + m))
            : this.db.prepare("SELECT * FROM nodes").all();

        void allNodes;
        const kindRows = this.db.prepare(`
            SELECT
                wm.module_key,
                n.kind,
                COUNT(*) AS count
            FROM workspace_modules wm
            LEFT JOIN files f ON f.workspace_module_id = wm.id
            LEFT JOIN nodes n ON n.file = f.path
            GROUP BY wm.module_key, n.kind
        `).all();
        const kindSummaryByModule = new Map();
        for (const row of kindRows) {
            if (!row.kind) continue;
            const summary = kindSummaryByModule.get(row.module_key) || {};
            summary[row.kind] = row.count;
            kindSummaryByModule.set(row.module_key, summary);
        }

        const modules = this.workspaceModuleRows()
            .filter(row => moduleMatchesScope(row.root_path, normalizedScope))
            .map(row => ({
                module_key: row.module_key,
                module_name: row.name,
                module_root_path: row.root_path,
                language: row.language,
                package_key: row.package_key,
                package_name: row.package_name,
                file_count: row.file_count,
                symbol_count: row.symbol_count,
                is_external: Boolean(row.is_external),
                kinds: kindSummaryByModule.get(row.module_key) || {},
            }));

        const allowedModules = new Set(modules.map(row => row.module_key));
        const hotspots = this.db.prepare(`
            SELECT
                n.file,
                n.name,
                n.kind,
                n.line_start,
                COALESCE(cb.stmt_count, MAX(n.line_end - n.line_start + 1, 1)) AS complexity,
                COUNT(DISTINCT e.source_id) AS callers,
                wm.module_key,
                wm.name AS module_name,
                wm.root_path AS module_root_path,
                p.package_key,
                p.name AS package_name
            FROM nodes n
            LEFT JOIN clone_blocks cb ON cb.node_id = n.id
            LEFT JOIN edges e ON e.target_id = n.id AND e.kind = 'calls'
            LEFT JOIN files f ON f.path = n.file
            LEFT JOIN workspace_modules wm ON wm.id = f.workspace_module_id
            LEFT JOIN packages p ON p.id = f.package_id
            WHERE n.kind IN ('function', 'method')
            GROUP BY n.id
            HAVING callers > 0
            ORDER BY complexity * callers DESC
            LIMIT 50
        `).all().filter(row => !normalizedScope || moduleMatchesScope(row.module_root_path, normalizedScope));

        const grouped = new Map();
        for (const edge of this.packageEdgeRows()) {
            const touchesScopedModule = !normalizedScope
                || allowedModules.has(edge.source_module_key)
                || (edge.target_module_key && allowedModules.has(edge.target_module_key));
            if (!touchesScopedModule) continue;
            if (edge.source_module_key === edge.target_module_key) continue;

            const targetKey = edge.target_module_key || `unresolved:${edge.import_source}`;
            const key = `${edge.source_module_key}->${targetKey}`;
            const existing = grouped.get(key) || {
                source_module_key: edge.source_module_key,
                source_module_name: edge.source_module_name,
                source_package_key: edge.source_package_key,
                source_package_name: edge.source_package_name,
                target_module_key: edge.target_module_key,
                target_module_name: edge.target_module_name || edge.import_source,
                target_package_key: edge.target_package_key,
                target_package_name: edge.target_package_name || null,
                edge_count: 0,
                reexport_count: 0,
                resolutions: {},
            };
            existing.edge_count++;
            if (edge.is_reexport) existing.reexport_count++;
            existing.resolutions[edge.resolution] = (existing.resolutions[edge.resolution] || 0) + 1;
            grouped.set(key, existing);
        }

        const crossEdges = [...grouped.values()]
            .sort((a, b) => b.edge_count - a.edge_count || a.source_module_key.localeCompare(b.source_module_key));

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
        const normalizedScope = normalizeScopePath(scopePath);
        const modules = this.workspaceModuleRows()
            .filter(row => moduleMatchesScope(row.root_path, normalizedScope));
        const allowedModules = new Set(modules.map(row => row.module_key));
        const metrics = new Map();
        const incoming = new Map();
        const outgoing = new Map();
        const unresolvedOutgoing = new Map();

        for (const edge of this.packageEdgeRows()) {
            const touchesScopedModule = !normalizedScope
                || allowedModules.has(edge.source_module_key)
                || (edge.target_module_key && allowedModules.has(edge.target_module_key));
            if (!touchesScopedModule) continue;

            if (!edge.target_module_key) {
                unresolvedOutgoing.set(
                    edge.source_module_key,
                    (unresolvedOutgoing.get(edge.source_module_key) || 0) + 1,
                );
                continue;
            }
            if (edge.source_module_key === edge.target_module_key) continue;
            if (!outgoing.has(edge.source_module_key)) outgoing.set(edge.source_module_key, new Set());
            if (!incoming.has(edge.target_module_key)) incoming.set(edge.target_module_key, new Set());
            outgoing.get(edge.source_module_key).add(edge.target_module_key);
            incoming.get(edge.target_module_key).add(edge.source_module_key);
        }

        for (const mod of modules) {
            metrics.set(mod.module_key, {
                module_key: mod.module_key,
                module_name: mod.name,
                module_root_path: mod.root_path,
                package_key: mod.package_key,
                package_name: mod.package_name,
                language: mod.language,
                is_external: Boolean(mod.is_external),
                ca: incoming.get(mod.module_key)?.size || 0,
                ce: outgoing.get(mod.module_key)?.size || 0,
                unresolved_outgoing: unresolvedOutgoing.get(mod.module_key) || 0,
            });
        }

        const result = [...metrics.values()]
            .map(m => ({
                ...m,
                instability: m.ca + m.ce > 0 ? m.ce / (m.ca + m.ce) : 0,
                total_coupling: m.ca + m.ce + m.unresolved_outgoing,
            }))
            .filter(m => m.total_coupling >= minCoupling);

        const sortFns = {
            instability: (a, b) => b.instability - a.instability || b.total_coupling - a.total_coupling,
            ca: (a, b) => b.ca - a.ca || b.total_coupling - a.total_coupling,
            ce: (a, b) => b.ce - a.ce || b.total_coupling - a.total_coupling,
            unresolved: (a, b) => b.unresolved_outgoing - a.unresolved_outgoing || b.total_coupling - a.total_coupling,
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

function moduleRelativeFilePath(filePath, moduleRootPath) {
    const normalizedFile = normalizeScopePath(filePath || "");
    const normalizedRoot = normalizeScopePath(moduleRootPath || ".");
    if (!normalizedRoot || normalizedRoot === ".") return normalizedFile;
    return normalizedFile.startsWith(`${normalizedRoot}/`)
        ? normalizedFile.slice(normalizedRoot.length + 1)
        : normalizedFile;
}

function buildWorkspaceQualifiedName(node, ownership) {
    if (!node) return null;
    if (node.workspace_qualified_name) return node.workspace_qualified_name;
    if (!ownership?.module_key) return node.qualified_name || null;
    const relFile = moduleRelativeFilePath(node.file, ownership.module_root_path);
    const localIdentity = node.qualified_name?.startsWith(`${node.file}:`)
        ? node.qualified_name.slice(node.file.length + 1)
        : (node.qualified_name || node.name);
    return `${ownership.module_key}::${relFile}::${localIdentity}`;
}

function serializeNode(store, node) {
    if (!node) return null;
    const ownership = node.file ? store.describeFileOwnership(node.file) : null;
    return {
        symbol_id: node.id,
        qualified_name: node.qualified_name || null,
        workspace_qualified_name: buildWorkspaceQualifiedName(node, ownership),
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
        package_id: node.package_id ?? ownership?.package_id ?? null,
        package_key: ownership?.package_key || null,
        package_name: ownership?.package_name || null,
        package_root_path: ownership?.package_root_path || null,
        workspace_module_id: node.workspace_module_id ?? ownership?.workspace_module_id ?? null,
        module_key: ownership?.module_key || null,
        module_name: ownership?.module_name || null,
        module_root_path: ownership?.module_root_path || null,
    };
}

function parseEvidence(evidenceJson) {
    if (!evidenceJson) return null;
    try {
        return JSON.parse(evidenceJson);
    } catch {
        return { raw: evidenceJson };
    }
}

function filterEdgesByConfidence(rows, minConfidence) {
    if (!minConfidence) return rows;
    return rows.filter(row => confidenceAtLeast(row.confidence, minConfidence));
}

function dedupeEdges(rows, directionKey) {
    return dedupeStrongest(rows, row => [
        directionKey === "incoming" ? row.source_id : row.target_id,
        directionKey === "incoming" ? row.target_id : row.source_id,
        row.kind,
        row.file,
        row.line ?? "",
    ].join("|"));
}

function dedupeReferenceRows(rows) {
    return dedupeStrongest(rows, row => [
        row.source_id,
        row.kind,
        row.file,
        row.line ?? "",
    ].join("|"));
}

function selectorError(code, message, recovery) {
    return { error: { code, message, recovery } };
}

function normalizeSelector(selector = {}) {
    const { symbol_id, workspace_qualified_name, qualified_name, name, file } = selector;
    const hasId = symbol_id !== undefined && symbol_id !== null;
    const hasWorkspaceQualified = typeof workspace_qualified_name === "string" && workspace_qualified_name.length > 0;
    const hasQualified = typeof qualified_name === "string" && qualified_name.length > 0;
    const hasNameFile = typeof name === "string" && name.length > 0 && typeof file === "string" && file.length > 0;
    const forms = [hasId, hasWorkspaceQualified, hasQualified, hasNameFile].filter(Boolean).length;
    if (forms !== 1) {
        return selectorError(
            "INVALID_SELECTOR",
            "Selector must provide exactly one of: symbol_id, workspace_qualified_name, qualified_name, or name+file",
            "Use search_symbols first to discover valid identifiers"
        );
    }
    if (hasId) return { kind: "symbol_id", value: Number(symbol_id), query: { symbol_id: Number(symbol_id) } };
    if (hasWorkspaceQualified) return { kind: "workspace_qualified_name", value: workspace_qualified_name, query: { workspace_qualified_name } };
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
                    candidates: matches.map(node => serializeNode(store, node)),
                },
            };
        }
        return { query: normalized.query, node: matches[0], reason: "resolved_by_qualified_name", confidence: "exact" };
    }

    if (normalized.kind === "workspace_qualified_name") {
        const matches = store.findByWorkspaceQualified(normalized.value);
        if (matches.length === 0) {
            return selectorError("SYMBOL_NOT_FOUND", `No symbol with workspace_qualified_name '${normalized.value}'`, "Run search_symbols to inspect available workspace-qualified names");
        }
        if (matches.length > 1) {
            return {
                error: {
                    code: "AMBIGUOUS_SYMBOL",
                    message: `Multiple symbols matched workspace_qualified_name '${normalized.value}'`,
                    recovery: "Use symbol_id instead of workspace_qualified_name",
                    candidates: matches.map(node => serializeNode(store, node)),
                },
            };
        }
        return { query: normalized.query, node: matches[0], reason: "resolved_by_workspace_qualified_name", confidence: "exact" };
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
                candidates: semantic.map(node => serializeNode(store, node)),
            },
        };
    }
    const node = semantic[0] || matches[0];
    return { query: normalized.query, node, reason: "resolved_by_name_file", confidence: "exact" };
}

function resolveOptionalSelector(store, selector = null) {
    if (!selector) return null;
    const values = [selector.symbol_id, selector.workspace_qualified_name, selector.qualified_name, selector.name, selector.file];
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

function serializeFlowSummary(store, row) {
    return {
        kind: row.kind,
        source_name: row.source_name,
        target_name: row.target_name,
        confidence: row.confidence,
        file: row.file,
        line: row.line,
        related_symbol: row.related_symbol_id
            ? serializeNode(store, {
                id: row.related_symbol_id,
                qualified_name: row.related_qualified_name || null,
                name: row.related_name,
                kind: row.related_kind,
                language: row.related_language || null,
                file: row.related_file,
                line_start: row.related_line,
                line_end: row.related_line,
                signature: null,
                is_exported: 0,
                is_default_export: 0,
            })
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

function normalizeScopePath(scopePath) {
    if (!scopePath) return null;
    return scopePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function moduleMatchesScope(moduleRootPath, scopePath) {
    if (!scopePath) return true;
    const normalizedRoot = normalizeScopePath(moduleRootPath || ".");
    if (normalizedRoot === ".") return true;
    return normalizedRoot === scopePath
        || normalizedRoot.startsWith(`${scopePath}/`)
        || scopePath.startsWith(`${normalizedRoot}/`);
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
        matches: results.map(node => serializeNode(store, node)),
        confidence: "exact",
        reason: "fts_lookup",
        evidence: { total_matches: results.length },
        limits_applied: { limit },
    };
}

export function getSymbol(selector, { min_confidence = null, path } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    const resolved = resolveSelector(store, selector);
    if (resolved.error) return resolved;

    const node = resolved.node;
    const provider_status = store.providerStatusForLanguage(node.language);
    const incoming = dedupeEdges(filterEdgesByConfidence(store.edgesTo(node.id), min_confidence), "incoming").map(e => ({
        kind: e.kind,
        confidence: e.confidence,
        origin: e.origin,
        file: e.file,
        line: e.line,
        evidence: parseEvidence(e.evidence_json),
        from: serializeNode(store, {
            id: e.source_id,
            qualified_name: e.source_qualified_name || null,
            name: e.source_name,
            kind: e.source_kind,
            language: e.source_language || null,
            file: e.source_file,
            line_start: e.source_line,
            line_end: e.source_line,
            signature: null,
            is_exported: 0,
            is_default_export: 0,
        }),
    }));
    const outgoing = dedupeEdges(filterEdgesByConfidence(store.edgesFrom(node.id), min_confidence), "outgoing").map(e => ({
        kind: e.kind,
        confidence: e.confidence,
        origin: e.origin,
        file: e.file,
        line: e.line,
        evidence: parseEvidence(e.evidence_json),
        to: serializeNode(store, {
            id: e.target_id,
            qualified_name: e.target_qualified_name || null,
            name: e.target_name,
            kind: e.target_kind,
            language: e.target_language || null,
            file: e.target_file,
            line_start: e.target_line,
            line_end: e.target_line,
            signature: null,
            is_exported: 0,
            is_default_export: 0,
        }),
    }));
    const moduleNode = store.nodesByFile(node.file).find(n => n.kind === "module");

    return {
        query: { ...resolved.query, min_confidence },
        result: {
            symbol: serializeNode(store, node),
            module: serializeNode(store, moduleNode),
            provider_status,
            incoming,
            outgoing,
            siblings: store.nodesByFile(node.file)
                .filter(n => n.id !== node.id)
                .map(sibling => serializeNode(store, sibling)),
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
    min_confidence = null,
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
            for (const e of filterEdgesByConfidence(store.edgesFrom(nodeId), min_confidence)) {
                if (!edgeKinds.has(e.kind)) continue;
                rows.push({
                    nextId: e.target_id,
                    edge: {
                        kind: e.kind,
                        confidence: e.confidence,
                        origin: e.origin,
                        file: e.file,
                        line: e.line,
                        evidence: parseEvidence(e.evidence_json),
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
            for (const e of filterEdgesByConfidence(store.edgesTo(nodeId), min_confidence)) {
                if (!edgeKinds.has(e.kind)) continue;
                rows.push({
                    nextId: e.source_id,
                    edge: {
                        kind: e.kind,
                        confidence: e.confidence,
                        origin: e.origin,
                        file: e.file,
                        line: e.line,
                        evidence: parseEvidence(e.evidence_json),
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
        return dedupeStrongest(rows, row => [row.nextId, row.edge.kind, row.edge.direction, row.edge.file, row.edge.line ?? ""].join("|"));
    };

    const queue = [{
        id: resolved.node.id,
        depth: 0,
        nodes: [serializeNode(store, resolved.node)],
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
                nodes: [...current.nodes, serializeNode(store, nextNode)],
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
            min_confidence,
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
        candidates = store.findByQualified(normalized.value).map(node => serializeNode(store, node));
    } else if (normalized.kind === "workspace_qualified_name") {
        candidates = store.findByWorkspaceQualified(normalized.value).map(node => serializeNode(store, node));
    } else if (normalized.kind === "name_file") {
        candidates = store.findByName(normalized.value.name)
            .filter(n => n.file === normalized.value.file || n.file.endsWith(normalized.value.file) || n.file.endsWith(`/${normalized.value.file}`))
            .map(node => serializeNode(store, node));
    } else {
        candidates = [serializeNode(store, store.getNodeById(normalized.value))];
    }

    return {
        query: normalized.query,
        result: {
            resolved: serializeNode(store, resolved.node),
            selector_kind: normalized.kind,
            parsed_candidates: candidates,
            precise_provider_status: store.providerStatusForLanguage(resolved.node.language),
            precise_results: {
                incoming_count: store.edgesTo(resolved.node.id).filter(edge => edge.origin?.startsWith("precise_")).length,
                outgoing_count: store.edgesFrom(resolved.node.id).filter(edge => edge.origin?.startsWith("precise_")).length,
            },
            final_selection: {
                reason: resolved.reason,
                confidence: resolved.confidence,
            },
        },
        confidence: resolved.confidence,
        reason: resolved.reason,
        evidence: { candidate_count: candidates.length },
        limits_applied: {},
    };
}

export function getReferencesBySelector(selector, { kind, limit = 50, min_confidence = null, path } = {}) {
    const store = resolveStore(path);
    if (!store) return selectorError("NOT_INDEXED", "No project indexed", "Run index_project first");
    const resolved = resolveSelector(store, selector);
    if (resolved.error) return resolved;

    const refs = dedupeReferenceRows(filterEdgesByConfidence(collectReferenceRows(store, resolved.node, kind), min_confidence)).slice(0, limit);
    const byKind = {};
    for (const row of refs) byKind[row.kind] = (byKind[row.kind] || 0) + 1;

    return {
        query: { ...resolved.query, kind: kind || "all", limit, min_confidence },
        result: {
            symbol: serializeNode(store, resolved.node),
            provider_status: store.providerStatusForLanguage(resolved.node.language),
            references: refs.map(r => ({
                file: r.file,
                line: r.line,
                kind: r.kind,
                confidence: r.confidence,
                origin: r.origin,
                evidence: parseEvidence(r.evidence_json),
            })),
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
            source: serializeNode(store, {
                id: edge.source_id,
                qualified_name: edge.source_qualified_name || null,
                name: edge.source_name,
                kind: edge.source_kind,
                language: edge.source_language || null,
                file: edge.source_file,
                line_start: edge.source_line,
                line_end: edge.source_line,
                signature: null,
                is_exported: 0,
                is_default_export: 0,
            }),
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
            symbol: serializeNode(store, resolved.node),
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
    const summaries = rootSummaries.slice(0, limit).map(summary => serializeFlowSummary(store, summary));
    const paths = [];
    const queue = [{
        owner: rootNode,
        depth: 0,
        symbols: [serializeNode(store, rootNode)],
        summaries: [],
        seen: new Set([rootNode.id]),
    }];

    while (queue.length > 0 && paths.length < limit) {
        const current = queue.shift();
        if (current.depth >= depth) continue;
        const flowRows = store.flowSummariesByOwner(current.owner.id);
        for (const row of flowRows) {
            const summary = serializeFlowSummary(store, row);
            if (row.related_symbol_id) {
                const nextNode = store.getNodeById(row.related_symbol_id);
                if (nextNode && !current.seen.has(nextNode.id)) {
                    const nextSeen = new Set(current.seen);
                    nextSeen.add(nextNode.id);
                    const nextPath = {
                        owner: nextNode,
                        depth: current.depth + 1,
                        symbols: [...current.symbols, serializeNode(store, nextNode)],
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
            symbol: serializeNode(store, rootNode),
            summaries,
            paths,
            target: targetNode ? serializeNode(store, targetNode) : null,
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
    const stats = store.stats();
    return {
        query: { scopePath: scopePath || null, limit },
        result: {
            modules,
            hotspots: hotspots.slice(0, limit).map(h => ({
                name: displayName(h),
                kind: h.kind,
                file: h.file,
                module_key: h.module_key,
                module_name: h.module_name,
                package_key: h.package_key,
                package_name: h.package_name,
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
