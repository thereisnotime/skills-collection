#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const requiredFiles = [
    "docs/best-practice/MCP_OUTPUT_CONTRACT_GUIDE.md",
    ".claude/commands/publish-mcp.md",
    "mcp/hex-line-mcp/README.md",
    "mcp/hex-line-mcp/output-style.md",
    "mcp/hex-line-mcp/server.mjs",
    "mcp/hex-graph-mcp/README.md",
    "mcp/hex-graph-mcp/server.mjs",
    "site/mcp/hex-line.html",
];

const checks = [
    {
        file: ".claude/commands/publish-mcp.md",
        includes: ["MCP_OUTPUT_CONTRACT_GUIDE.md", "retry_plan", "status/reason/next_action vocabulary"],
    },
    {
        file: "mcp/hex-line-mcp/server.mjs",
        includes: ["retry_plan", "suggested_read_call", "canonical status, next_action"],
    },
    {
        file: "mcp/hex-line-mcp/README.md",
        includes: ["next_action:", "retry_plan:"],
        excludes: ["Run hex-line setup_hooks"],
    },
    {
        file: "mcp/hex-line-mcp/output-style.md",
        includes: ["retry_plan", "next_action"],
    },
    {
        file: "site/mcp/hex-line.html",
        excludes: ["Run hex-line setup_hooks", "Read is blocked", "first 12 + last 12 lines"],
    },
    {
        file: "mcp/hex-graph-mcp/README.md",
        includes: ["next_action", "status"],
    },
    {
        file: "mcp/hex-graph-mcp/server.mjs",
        includes: ["status: STATUS.OK", "GRAPH_DB_BUSY"],
    },
];

const failures = [];

for (const relPath of requiredFiles) {
    if (!existsSync(resolve(ROOT, relPath))) failures.push(`missing file: ${relPath}`);
}

for (const rule of checks) {
    const absPath = resolve(ROOT, rule.file);
    if (!existsSync(absPath)) continue;
    const text = readFileSync(absPath, "utf8");
    for (const token of rule.includes || []) {
        if (!text.includes(token)) failures.push(`${rule.file} missing token: ${token}`);
    }
    for (const token of rule.excludes || []) {
        if (text.includes(token)) failures.push(`${rule.file} still contains stale token: ${token}`);
    }
}

if (failures.length) {
    console.error("MCP output contract drift detected:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log("MCP output contract checks passed.");
