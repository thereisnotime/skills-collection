import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

const report = {
    capabilities: readJson(join(root, "artifacts", "capabilities.json")),
    quality_targets: readJson(join(root, "artifacts", "quality-targets.json")),
    quality_report: readJson(join(root, "artifacts", "quality-report.json")),
    corpora: readJson(join(root, "..", "corpora", "manifest.json")),
};

console.log(JSON.stringify(report, null, 2));
