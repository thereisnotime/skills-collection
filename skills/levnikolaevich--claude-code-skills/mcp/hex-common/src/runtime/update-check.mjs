import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CACHE_FILE = join(tmpdir(), "hex-common-update.json");
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const TIMEOUT = 3000;
const SEMVER_PART_COUNT = 3;

async function readCache() {
    try {
        return JSON.parse(await readFile(CACHE_FILE, "utf-8"));
    } catch {
        return {};
    }
}

async function writeCache(entry) {
    await writeFile(CACHE_FILE, JSON.stringify(entry)).catch(() => {});
}

async function fetchLatest(packageName) {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
        const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const data = await res.json();
        return data.version ?? null;
    } catch {
        return null;
    }
}

function compareVersions(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < SEMVER_PART_COUNT; i++) {
        if ((pa[i] || 0) < (pb[i] || 0)) return -1;
        if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    }
    return 0;
}

export async function checkForUpdates(packageName, currentVersion) {
    const cache = await readCache();
    const cached = cache[packageName];
    if (cached && Date.now() - cached.timestamp < CHECK_INTERVAL) {
        if (cached.latest && compareVersions(currentVersion, cached.latest) < 0) {
            process.stderr.write(`${packageName} update: ${currentVersion} -> ${cached.latest}. Run: npm install -g ${packageName}\n`);
        }
        return;
    }

    const latest = await fetchLatest(packageName);
    if (!latest) return;

    cache[packageName] = { timestamp: Date.now(), latest };
    await writeCache(cache);
    if (compareVersions(currentVersion, latest) < 0) {
        process.stderr.write(`${packageName} update: ${currentVersion} -> ${latest}. Run: npm install -g ${packageName}\n`);
    }
}
