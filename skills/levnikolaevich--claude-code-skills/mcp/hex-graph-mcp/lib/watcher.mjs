/**
 * Chokidar file watcher for incremental graph reindex.
 *
 * Singleton per project path. 500ms debounce.
 * On change: reparse single file via reindexFile.
 * On unlink: CASCADE cleanup via store.deleteFile.
 */

import { watch } from "chokidar";
import { resolve, relative, extname } from "node:path";
import { CODEGRAPH_DIR, getStore } from "./store.mjs";
import { isSupported } from "./parser.mjs";
import { reindexFile } from "./indexer.mjs";

const _watchers = new Map();

/**
 * Start or get existing watcher for a project.
 * @param {string} projectPath
 * @returns {string} status message
 */
export function watchProject(projectPath) {
    const absPath = resolve(projectPath);

    if (_watchers.has(absPath)) {
        return `Watcher already active for ${absPath}`;
    }

    const watcher = watch(absPath, {
        ignored: [
            "**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**",
            "**/__pycache__/**", "**/.venv/**", "**/vendor/**", "**/target/**",
            `**/${CODEGRAPH_DIR}/**`, "**/.vs/**", "**/bin/**", "**/obj/**",
        ],
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    const pending = new Map();
    const DEBOUNCE = 500;

    function scheduleReindex(filePath) {
        const ext = extname(filePath).toLowerCase();
        if (!isSupported(ext)) return;

        const relPath = relative(absPath, filePath).replace(/\\/g, "/");

        if (pending.has(relPath)) clearTimeout(pending.get(relPath));

        pending.set(relPath, setTimeout(async () => {
            pending.delete(relPath);
            try {
                await reindexFile(absPath, relPath);
            } catch (e) {
                process.stderr.write(`codegraph watcher: reindex error ${relPath}: ${e.message}\n`);
            }
        }, DEBOUNCE));
    }

    function handleDelete(filePath) {
        const ext = extname(filePath).toLowerCase();
        if (!isSupported(ext)) return;

        const relPath = relative(absPath, filePath).replace(/\\/g, "/");
        try {
            const store = getStore(absPath);
            store.deleteFile(relPath);
            store.cleanupOrphanModuleEdges();
        } catch (e) {
            process.stderr.write(`codegraph watcher: delete error ${relPath}: ${e.message}\n`);
        }
    }

    watcher
        .on("change", scheduleReindex)
        .on("add", scheduleReindex)
        .on("unlink", handleDelete);

    _watchers.set(absPath, watcher);

    return `Watcher started for ${absPath}`;
}
