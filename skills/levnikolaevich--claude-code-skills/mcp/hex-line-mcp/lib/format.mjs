/**
 * Shared format helpers for hex-line-mcp.
 * Single source of truth for formatSize, relativeTime, countFileLines, listDirectory, readText, MAX_OUTPUT_CHARS.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Format bytes as human-readable size string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${bytes}B`;
}

/**
 * Format a Date as relative time string.
 * @param {Date} date
 * @param {boolean} compact - true: "5m ago", false: "5 min ago"
 * @returns {string}
 */
export function relativeTime(date, compact = false) {
    const sec = Math.round((Date.now() - date.getTime()) / 1000);
    if (compact) {
        if (sec < 60) return "now";
        if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
        if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
        if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
        if (sec < 2592000) return `${Math.floor(sec / 604800)}w ago`;
        return `${Math.floor(sec / 2592000)}mo ago`;
    }
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * Count lines in a text file. Returns null for binary or oversized files.
 * Buffer-based single-pass with built-in binary detection.
 * @param {string} filePath
 * @param {number} size - file size in bytes
 * @param {number} maxSize - skip if larger (default 1MB)
 * @returns {number|null}
 */
export function countFileLines(filePath, size, maxSize = 1_000_000) {
    if (size === 0 || size > maxSize) return null;
    try {
        const buf = readFileSync(filePath);
        const checkLen = Math.min(buf.length, 8192);
        for (let i = 0; i < checkLen; i++) if (buf[i] === 0) return null; // binary
        let count = 1;
        for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0A) count++;
        return count;
    } catch { return null; }
}

/**
 * Flat single-level directory listing with optional metadata.
 * Sorted: directories first, then files, alphabetical.
 * @param {string} dirPath - absolute directory path
 * @param {object} opts
 * @param {number} opts.limit - max entries (0 = all, default 0)
 * @param {boolean} opts.metadata - show size/lines/time per entry (default false)
 * @param {boolean} opts.compact - compact time format (default false)
 * @param {string} opts.indent - prefix per line (default "  ")
 * @returns {{ text: string, total: number }}
 */
export function listDirectory(dirPath, opts = {}) {
    const { limit = 0, metadata = false, compact = false, indent = "  " } = opts;

    let entries;
    try {
        entries = readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return { text: "", total: 0 };
    }

    // Sort: directories first, then files, alphabetical
    entries.sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        if (aDir !== bDir) return aDir - bDir;
        return a.name.localeCompare(b.name);
    });

    const total = entries.length;
    const visible = limit > 0 ? entries.slice(0, limit) : entries;

    const lines = visible.map(entry => {
        const isDir = entry.isDirectory();
        if (!metadata) {
            return `${indent}${isDir ? "d" : "f"} ${entry.name}`;
        }
        if (isDir) {
            return `${indent}${entry.name}/`;
        }
        // File with metadata
        const full = join(dirPath, entry.name);
        const parts = [];
        try {
            const st = statSync(full);
            const lineCount = countFileLines(full, st.size);
            if (lineCount !== null) parts.push(`${lineCount}L`);
            parts.push(formatSize(st.size));
            if (st.mtime) parts.push(relativeTime(st.mtime, compact));
        } catch {
            parts.push("?");
        }
        return `${indent}${entry.name} (${parts.join(", ")})`;
    });

    return { text: lines.join("\n"), total };
}


/** Max output characters for read_file. */
export const MAX_OUTPUT_CHARS = 80000;

/** Max diff characters for edit_file display (fullDiff kept for analysis). */
export const MAX_DIFF_CHARS = 30000;

/** Max output characters for bulk_replace composed result. */
export const MAX_BULK_OUTPUT_CHARS = 30000;

/** Max diff lines per file in bulk_replace full mode. */
export const MAX_PER_FILE_DIFF_LINES = 50;

/**
 * Read a text file with CRLF normalization.
 * @param {string} filePath
 * @returns {string}
 */
export function readText(filePath) {
    return readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
}
