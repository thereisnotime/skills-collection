/**
 * TEST 16-18: Graph enrichment benchmarks (--with-graph only).
 *
 * Both sides use hex-line; difference is whether .hex-skills/codegraph/index.db exists.
 * Requires hex-graph index_project to have been run first.
 */

import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "../lib/read.mjs";
import { editFile } from "../lib/edit.mjs";
import { grepSearch } from "../lib/search.mjs";
import { fnv1a, lineTag } from "@levnikolaevich/hex-common/text-protocol/hash";
import { getFileLines, fmt, pctSavings } from "../lib/scenario-helpers.mjs";

/**
 * Run TEST 16-18 graph enrichment benchmarks.
 *
 * @param {object} config
 * @param {string[]} config.allFiles - All discovered code files
 * @param {string[]} config.largeFiles - Top 3 largest code files
 * @param {string} config.repoRoot - Repository root path
 * @returns {Promise<string[]>} Array of pre-formatted table row strings
 */
export async function runGraph(config) {
    const { allFiles, largeFiles, repoRoot } = config;
    const graphOut = [];

    const { getGraphDB } = await import("../lib/graph-enrich.mjs");
    const db = getGraphDB(resolve(repoRoot, "server.mjs"));
    if (!db) {
        console.error("--with-graph: .hex-skills/codegraph/index.db not found. Run hex-graph index_project first.");
        return graphOut;
    }

    const graphFile = largeFiles[0] || allFiles[0];
    const graphLines = getFileLines(graphFile);

    if (!graphLines) return graphOut;

    // TEST 16: Read with/without Graph header
    {
        const withGraphResult = readFile(graphFile);
        const noGraphResult = withGraphResult.replace(/\nGraph:.*\n/, "\n");
        const savings = pctSavings(noGraphResult.length, withGraphResult.length);
        graphOut.push(`| 16 | Graph: Read (${graphLines.length}L) | ${fmt(noGraphResult.length)} chars | ${fmt(withGraphResult.length)} chars | ${savings} | 2\u21921 | 2\u21921 |`);
    }

    // TEST 17: Edit with/without semantic impact
    {
        const editTmpPath = resolve(tmpdir(), `hex-bench-edit-${Date.now()}.js`);
        writeFileSync(editTmpPath, graphLines.join("\n"), "utf-8");
        try {
            const tag = lineTag(fnv1a(graphLines[5]));
            const editResult = editFile(editTmpPath, [{ set_line: { anchor: `${tag}.6`, new_text: graphLines[5] + " // modified" } }]);
            const noBlastOut = editResult.replace(/\n.*Semantic impact:.*$/s, "");
            const savings = pctSavings(noBlastOut.length, editResult.length);
            graphOut.push(`| 17 | Graph: Edit + semantic impact | ${fmt(noBlastOut.length)} chars | ${fmt(editResult.length)} chars | ${savings} | 2\u21921 | 2\u21921 |`);
        } catch {
            graphOut.push(`| 17 | Graph: Edit + semantic impact | \u2014 | \u2014 | \u2014 | | |`);
        }
        try { unlinkSync(editTmpPath); } catch {}
    }

    // TEST 18: Grep with/without annotations
    {
        try {
            const grepResult = await grepSearch("function", { path: resolve(repoRoot), glob: "*.mjs", limit: 10 });
            const noAnnoResult = grepResult.replace(/  \[[^\]]+\]/g, "");
            const savings = pctSavings(noAnnoResult.length, grepResult.length);
            const annoCount = (grepResult.match(/\[[^\]]+\]/g) || []).length;
            graphOut.push(`| 18 | Graph: Grep + ${annoCount} annotations | ${fmt(noAnnoResult.length)} chars | ${fmt(grepResult.length)} chars | ${savings} | 6\u21921 | 6\u21921 |`);
        } catch {
            graphOut.push(`| 18 | Graph: Grep + context | \u2014 | \u2014 | \u2014 | | |`);
        }
    }

    return graphOut;
}
