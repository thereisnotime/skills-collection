import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unavailableCommandDetail, providerCommandLabel, resolveProviderCommand } from "./command.mjs";
import { providerDetail } from "./provider-status.mjs";
import { withLspSession } from "./lsp.mjs";

function normalizePath(filePath) {
    return filePath.replace(/\\/g, "/");
}

function parseEvidence(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function unique(items) {
    return [...new Set(items.filter(Boolean))];
}

function moduleLanguage(store, relFile) {
    return store.nodesByFile(relFile).find(node => node.kind === "module")?.language || null;
}

function candidateToken(candidate) {
    const evidence = parseEvidence(candidate.evidence_json);
    return evidence?.local || evidence?.token || evidence?.imported || candidate.target_name || candidate.source_name || null;
}

function lineTextCache(projectPath, cache, relFile) {
    if (!cache.has(relFile)) {
        const text = readFileSync(resolve(projectPath, relFile), "utf8").replace(/\r\n/g, "\n");
        cache.set(relFile, text.split("\n"));
    }
    return cache.get(relFile);
}

function locateTokenCharacter(projectPath, lineCache, candidate) {
    const token = candidateToken(candidate);
    if (!token || !candidate.file || !candidate.line) return null;
    const lines = lineTextCache(projectPath, lineCache, candidate.file);
    const text = lines[candidate.line - 1] || "";
    const wordPattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    const match = wordPattern.exec(text);
    if (match) return match.index;
    const looseIndex = text.indexOf(token);
    return looseIndex === -1 ? null : looseIndex;
}

function normalizeLocations(result) {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    return [result];
}

function locationStart(location) {
    if (location?.targetUri && location?.targetSelectionRange) {
        return {
            uri: location.targetUri,
            line: location.targetSelectionRange.start.line + 1,
        };
    }
    if (location?.uri && location?.range) {
        return {
            uri: location.uri,
            line: location.range.start.line + 1,
        };
    }
    return null;
}

function candidateNodesAtLine(store, relFile, line, preferredName) {
    return store.nodesByFile(relFile)
        .filter(node =>
            node.kind !== "import"
            && node.kind !== "module"
            && node.kind !== "reexport"
            && node.line_start <= line
            && node.line_end >= line
            && (!preferredName || node.name === preferredName))
        .sort((left, right) => (left.line_end - left.line_start) - (right.line_end - right.line_start));
}

function matchLocationToNode({ store, projectPath, candidate, locations }) {
    for (const location of normalizeLocations(locations)) {
        const start = locationStart(location);
        if (!start?.uri) continue;
        const absoluteFile = fileURLToPath(start.uri);
        const relFile = normalizePath(relative(projectPath, absoluteFile));
        if (relFile.startsWith("..")) continue;
        const preferredName = candidate.target_name || null;
        const nodes = candidateNodesAtLine(store, relFile, start.line, preferredName);
        if (nodes.length === 0) continue;
        const exact = nodes.find(node => node.id === candidate.target_id);
        if (exact) return exact;
        return nodes[0];
    }
    return null;
}

function preciseEvidence(descriptor, command, candidate, targetNode) {
    return JSON.stringify({
        provider: descriptor.tool_display_name,
        command: providerCommandLabel(command),
        request_kind: "textDocument/definition",
        token: candidateToken(candidate),
        source_file: candidate.file,
        source_line: candidate.line,
        target: targetNode.workspace_qualified_name || targetNode.qualified_name || targetNode.name,
    });
}

function dedupeCandidates(candidates) {
    const seen = new Set();
    return candidates.filter(candidate => {
        const key = [
            candidate.source_id,
            candidate.target_id,
            candidate.kind,
            candidate.file,
            candidate.line ?? "",
            candidateToken(candidate) || "",
        ].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function ownerNodeAtLine(store, relFile, line) {
    const nodes = store.nodesByFile(relFile)
        .filter(node =>
            (node.kind === "function" || node.kind === "method" || node.kind === "class")
            && node.line_start <= line
            && node.line_end >= line)
        .sort((left, right) => (left.line_end - left.line_start) - (right.line_end - right.line_start));
    return nodes[0] || store.nodesByFile(relFile).find(node => node.kind === "module") || null;
}

function inferredKind(lineText, token) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:->|\\.)?${escaped}\\s*\\(`).test(lineText)) return "calls";
    if (new RegExp(`\\bnew\\s+${escaped}\\b|:\\s*${escaped}\\b`).test(lineText)) return "ref_type";
    return "ref_read";
}

function buildTextFallbackCandidates({ language, projectPath, store, sourceFiles }) {
    const targetNodes = unique(
        (sourceFiles || [])
            .filter(relFile => moduleLanguage(store, relFile) === language)
            .flatMap(relFile => store.nodesByFile(relFile))
            .filter(node => node.kind !== "import" && node.kind !== "module" && node.kind !== "reexport")
            .map(node => node.id),
    ).map(id => store.getNodeById(id)).filter(Boolean);
    const candidates = [];
    const lineCache = new Map();
    for (const relFile of (sourceFiles || []).filter(file => moduleLanguage(store, file) === language)) {
        const lines = lineTextCache(projectPath, lineCache, relFile);
        for (const targetNode of targetNodes) {
            const token = targetNode.name;
            if (!token) continue;
            const matcher = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
            for (let index = 0; index < lines.length; index++) {
                const lineNo = index + 1;
                const lineText = lines[index] || "";
                if (!matcher.test(lineText)) continue;
                if (relFile === targetNode.file && lineNo === targetNode.line_start) continue;
                const owner = ownerNodeAtLine(store, relFile, lineNo);
                if (!owner || owner.id === targetNode.id) continue;
                candidates.push({
                    source_id: owner.id,
                    target_id: targetNode.id,
                    layer: "symbol",
                    kind: inferredKind(lineText, token),
                    file: relFile,
                    line: lineNo,
                    target_name: targetNode.name,
                    evidence_json: JSON.stringify({ token }),
                });
            }
        }
    }
    return dedupeCandidates(candidates);
}

export async function runExternalPreciseOverlay({ descriptor, language, projectPath, store, sourceFiles }) {
    const command = resolveProviderCommand(descriptor);
    const candidates = (() => {
        const direct = dedupeCandidates(store.preciseCandidateEdges(language));
        if (direct.length > 0 || (language !== "php" && language !== "c_sharp")) return direct;
        return buildTextFallbackCandidates({ language, projectPath, store, sourceFiles });
    })();
    const rootUsed = projectPath;
    const checkedCommands = [providerCommandLabel(command), ...(descriptor.checked_commands || [])];

    try {
        return await withLspSession({
            command,
            descriptor,
            projectPath,
            files: unique(candidates.map(candidate => candidate.file)),
        }, async ({ serverInfo, definition }) => {
            const responseCache = new Map();
            const lineCache = new Map();
            let edgeCount = 0;
            for (const candidate of candidates) {
                const character = locateTokenCharacter(projectPath, lineCache, candidate);
                if (character == null || !candidate.line) continue;
                const cacheKey = `${candidate.file}:${candidate.line}:${character}`;
                if (!responseCache.has(cacheKey)) {
                    responseCache.set(cacheKey, await definition(candidate.file, candidate.line - 1, character));
                }
                const targetNode = matchLocationToNode({
                    store,
                    projectPath,
                    candidate,
                    locations: responseCache.get(cacheKey),
                });
                if (!targetNode || targetNode.id === candidate.source_id) continue;
                store.insertEdge({
                    source_id: candidate.source_id,
                    target_id: targetNode.id,
                    layer: candidate.layer,
                    kind: candidate.kind,
                    confidence: "precise",
                    origin: descriptor.provider,
                    file: candidate.file,
                    line: candidate.line,
                    evidence_json: preciseEvidence(descriptor, command, candidate, targetNode),
                });
                edgeCount++;
            }
            return {
                status: "available",
                version: serverInfo?.version || null,
                edge_count: edgeCount,
                detail: providerDetail(descriptor, {
                    checked_commands: checkedCommands,
                    root_used: rootUsed,
                    config_used: [],
                    command: providerCommandLabel(command),
                    extra: { candidate_count: candidates.length },
                }),
            };
        });
    } catch (error) {
        if (error?.code === "ENOENT") {
            return {
                status: "unavailable",
                version: null,
                edge_count: 0,
                detail: unavailableCommandDetail(descriptor, command, {
                    checked_commands: checkedCommands,
                    root_used: rootUsed,
                    extra: { candidate_count: candidates.length },
                }),
            };
        }
        return {
            status: "failed",
            version: null,
            edge_count: 0,
            detail: providerDetail(descriptor, {
                reason: "provider_failed",
                message: error?.message || "provider failed",
                checked_commands: checkedCommands,
                root_used: rootUsed,
                command: providerCommandLabel(command),
                extra: { candidate_count: candidates.length },
            }),
        };
    }
}
