/**
 * Unified path inspection entrypoint.
 *
 * Files return compact metadata for read-planning. Directories return either
 * a tree view or pattern-based matches, reusing the existing deterministic
 * directory traversal rules.
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { normalizePath } from "./security.mjs";
import { directoryTree } from "./tree.mjs";
import { fileInfo } from "./info.mjs";

export function inspectPath(inputPath, opts = {}) {
    const abs = resolve(normalizePath(inputPath));
    const stat = statSync(abs);
    if (stat.isFile()) return fileInfo(abs);
    if (stat.isDirectory()) return directoryTree(abs, opts);
    throw new Error(`Unsupported path type: ${abs}`);
}
