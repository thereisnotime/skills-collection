import { join, resolve } from "node:path";

function safeSegment(value) {
    return String(value || "default")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "default";
}

export function runtimeArtifactDir(projectRoot, runId, summaryKind) {
    return join(
        resolve(projectRoot || process.cwd()),
        ".hex-skills",
        "runtime-artifacts",
        "runs",
        safeSegment(runId),
        safeSegment(summaryKind),
    );
}

export function runtimeArtifactPath(projectRoot, runId, summaryKind, identifier) {
    return join(runtimeArtifactDir(projectRoot, runId, summaryKind), `${safeSegment(identifier)}.json`);
}
