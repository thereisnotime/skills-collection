#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsRepoRoot = resolve(__dirname, "../../../..");
const parentRepoRoot = resolve(skillsRepoRoot, "..");

const selfPath = normalizePath(fileURLToPath(import.meta.url));

const allowedLegacyPhaseDocs = new Set([
    selfPath,
    normalizePath(join(skillsRepoRoot, "shared/references/runtime_status_catalog.md")),
    normalizePath(join(skillsRepoRoot, "shared/references/review_runtime_contract.md")),
]);

const checks = [
    {
        name: "legacy review phase alias in code or active skill docs",
        test(filePath, content) {
            if (!/\bPHASE_6_REFINE\b/.test(content)) {
                return null;
            }
            if (allowedLegacyPhaseDocs.has(normalizePath(filePath))) {
                return null;
            }
            return "Use PHASE_6_REFINEMENT only; PHASE_6_REFINE must not appear outside explicit invalid-usage docs.";
        },
        include: filePath => isDocumentationLike(filePath) || isJavaScript(filePath),
    },
    {
        name: "stale agent review output status field",
        regex: /status:\s*"success \| failed \| timeout"/,
        message: "Use runtime_status + execution_outcome; do not overload status with transport outcomes.",
        include: filePath => isDocumentationLike(filePath),
    },
    {
        name: "ambiguous audit failure wording",
        regex: /or equivalent per workflow/,
        message: "Use explicit canonical statuses instead of ambiguous equivalents.",
        include: filePath => isDocumentationLike(filePath),
    },
    {
        name: "plan mode stale pending progression",
        regex: /pending → completed/,
        message: "TodoWrite guidance must use explicit tool-local status progression, not stale pending→completed wording.",
        include: filePath => isDocumentationLike(filePath),
    },
    {
        name: "task board shorthand statuses in docs",
        regex: /Done\/To Rework|In Progress\/To Review\/Done|In Progress\/Review\/Done|Backlog\/Todo\/In Progress\/To Review\/Done/,
        message: "Use canonical task-board status names with explicit separators, e.g. `Done | To Rework` or `In Progress | To Review | Done`.",
        include: filePath => isDocumentationLike(filePath),
    },
    {
        name: "legacy dated output directory wording",
        regex: /Delete the dated output directory/,
        message: "Use run-scoped runtime artifact wording instead of dated output directory language.",
        include: filePath => isDocumentationLike(filePath),
    },
    {
        name: "mojibake artifacts in docs or script text",
        regex: /[âÃÂ�]/,
        message: "Remove mojibake artifacts and normalize text to ASCII-safe wording.",
        include: filePath => (isDocumentationLike(filePath) || isJavaScript(filePath)) && normalizePath(filePath) !== selfPath,
    },
    {
        name: "uncentralized story gate shortcut status in code",
        regex: /"skipped_by_verdict"/,
        message: "Use STORY_GATE_FINALIZATION_STATUSES.SKIPPED_BY_VERDICT instead of string literals.",
        include: filePath => isJavaScript(filePath) && !filePath.endsWith("runtime-constants.mjs") && normalizePath(filePath) !== selfPath,
    },
    {
        name: "pipeline phase field drift in docs",
        regex: /state\.stage/,
        message: "Use canonical runtime field `state.phase`, not `state.stage`.",
        include: filePath => isDocumentationLike(filePath),
    },
];

const rootsToScan = [
    skillsRepoRoot,
    join(parentRepoRoot, "docs"),
    join(parentRepoRoot, "site"),
    join(parentRepoRoot, "AGENTS.md"),
    join(parentRepoRoot, "README.md"),
];

const findings = [];

for (const root of rootsToScan) {
    for (const filePath of walk(root)) {
        if (!isDocumentationLike(filePath) && !isJavaScript(filePath)) {
            continue;
        }
        const content = readFileSync(filePath, "utf8");
        const normalizedPath = normalizePath(filePath);
        for (const check of checks) {
            if (!check.include(filePath)) {
                continue;
            }
            if (check.test) {
                const failure = check.test(filePath, content);
                if (failure) {
                    findings.push(`${normalizedPath}: ${failure}`);
                }
                continue;
            }
            if (check.regex?.test(content)) {
                findings.push(`${normalizedPath}: ${check.message}`);
            }
        }
    }
}

if (findings.length > 0) {
    process.stderr.write(`Consistency scan failed (${findings.length} issue(s))\n`);
    for (const finding of findings) {
        process.stderr.write(`- ${finding}\n`);
    }
    process.exit(1);
}

process.stdout.write("consistency scan passed\n");

function walk(targetPath) {
    try {
        const stats = statSync(targetPath);
        if (stats.isFile()) {
            return [targetPath];
        }
        if (!stats.isDirectory()) {
            return [];
        }
    } catch {
        return [];
    }

    const entries = readdirSync(targetPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const nextPath = join(targetPath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === ".git") {
                continue;
            }
            files.push(...walk(nextPath));
            continue;
        }
        if (entry.isFile()) {
            files.push(nextPath);
        }
    }
    return files;
}

function isMarkdown(filePath) {
    const ext = extname(filePath).toLowerCase();
    return ext === ".md" || ext === ".mdx";
}

function isHtml(filePath) {
    return extname(filePath).toLowerCase() === ".html";
}

function isDocumentationLike(filePath) {
    return isMarkdown(filePath) || isHtml(filePath);
}

function isJavaScript(filePath) {
    const ext = extname(filePath).toLowerCase();
    return ext === ".mjs" || ext === ".js";
}

function normalizePath(filePath) {
    return filePath.replace(/\\/g, "/");
}
