#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
    ensureDir,
    getCorpusCheckoutDir,
    getDefaultCorpusCacheDir,
    isCorpusMaterialized,
    paths,
    readJson,
} from "./quality-support.mjs";

function runGit(args, cwd) {
    const result = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
    }
    return result.stdout.trim();
}

export function materializeExternalCorpora({ onlyId = null, checkOnly = false, cacheRoot = getDefaultCorpusCacheDir() } = {}) {
    const manifest = readJson(paths.corporaManifest);
    const corpora = (manifest.external || []).filter(item => !onlyId || item.id === onlyId);
    ensureDir(cacheRoot);
    const results = [];

    for (const corpus of corpora) {
        const targetDir = getCorpusCheckoutDir(corpus, cacheRoot);
        const wasMaterialized = isCorpusMaterialized(corpus, cacheRoot);

        if (checkOnly) {
            results.push({
                id: corpus.id,
                cache_dir: targetDir,
                status: wasMaterialized ? "materialized" : "missing",
            });
            continue;
        }

        if (!existsSync(targetDir)) {
            runGit(["clone", "--filter=blob:none", "--no-checkout", corpus.repo, targetDir], cacheRoot);
        }
        runGit(["fetch", "--depth", "1", "origin", corpus.ref], targetDir);
        runGit(["checkout", "--force", corpus.ref], targetDir);
        const head = runGit(["rev-parse", "HEAD"], targetDir);
        if (head !== corpus.ref) {
            throw new Error(`Corpus ${corpus.id} expected ${corpus.ref} but checked out ${head}`);
        }
        results.push({
            id: corpus.id,
            cache_dir: targetDir,
            status: "materialized",
        });
    }

    return results;
}

const onlyIdIndex = process.argv.indexOf("--id");
const onlyId = onlyIdIndex !== -1 ? process.argv[onlyIdIndex + 1] : null;
const checkOnly = process.argv.includes("--check");
const results = materializeExternalCorpora({ onlyId, checkOnly });
console.log(JSON.stringify({ cache_dir: getDefaultCorpusCacheDir(), corpora: results }, null, 2));
if (checkOnly && results.some(item => item.status !== "materialized")) {
    process.exitCode = 1;
}
