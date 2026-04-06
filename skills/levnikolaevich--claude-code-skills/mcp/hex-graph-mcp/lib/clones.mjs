/**
 * Clone detection engine used by audit_workspace.
 *
 * Detects exact, normalized, and near-miss code clones using hash grouping,
 * MinHash fingerprints, and LSH-based candidate generation with Union-Find
 * clustering.
 *
 * @module clones
 */

import { minhashJaccard, lshBands } from "./clone-hash.mjs";
import picomatch from "picomatch";

// --- Tier defaults ---

const TIER_MIN_STMTS = { exact: 3, normalized: 5, near_miss: 8 };

// --- Union-Find for connected component clustering ---

class UnionFind {
    constructor(n) {
        this.parent = Array.from({ length: n }, (_, i) => i);
        this.rank = new Array(n).fill(0);
    }

    find(x) {
        if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
        return this.parent[x];
    }

    union(a, b) {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra === rb) return;
        if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
        else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
        else { this.parent[rb] = ra; this.rank[ra]++; }
    }
}

// --- Effective min stmts ---

/**
 * @param {number|null} userMinStmts
 * @param {string} tier - "exact" | "normalized" | "near_miss"
 * @returns {number}
 */
function effectiveMin(userMinStmts, tier) {
    return Math.max(userMinStmts || 0, TIER_MIN_STMTS[tier]);
}

// --- Caller counting ---

/**
 * Count how many "calls" edges point to a node.
 * @param {object} store
 * @param {number} nodeId
 * @returns {number}
 */
function countCallers(store, nodeId) {
    const edges = store.edgesTo(nodeId);
    let count = 0;
    for (let i = 0; i < edges.length; i++) {
        if (edges[i].kind === "calls") count++;
    }
    return count;
}

// --- Step 1: Load and filter blocks ---

/**
 * @param {object} store
 * @param {object} opts
 * @returns {object[]}
 */
function loadBlocks(store, opts) {
    let blocks = store.getAllCloneBlocks(TIER_MIN_STMTS.exact); // lowest threshold = 3

    // Filter by kind
    if (opts.kind && opts.kind !== "all") {
        blocks = blocks.filter(b => b.kind === opts.kind);
    }

    // Filter by scope glob (compile matcher once, apply to all blocks)
    if (opts.scope) {
        const isMatch = picomatch(opts.scope, { dot: true });
        blocks = blocks.filter(b => isMatch(b.file.replace(/\\/g, "/")));
    }

    return blocks;
}

// --- Step 2: Exact groups ---

/**
 * @param {object[]} blocks
 * @param {number|null} userMinStmts
 * @param {boolean} crossFile
 * @returns {{ groups: object[], nodeIds: Set<number> }}
 */
function findExactGroups(blocks, userMinStmts, crossFile) {
    const minStmts = effectiveMin(userMinStmts, "exact");
    const filtered = blocks.filter(b => b.stmt_count >= minStmts);

    // Group by raw_hash
    const byHash = new Map();
    for (const b of filtered) {
        if (!byHash.has(b.raw_hash)) byHash.set(b.raw_hash, []);
        byHash.get(b.raw_hash).push(b);
    }

    const groups = [];
    const nodeIds = new Set();

    for (const [hash, members] of byHash) {
        if (members.length < 2) continue;
        if (crossFile) {
            const files = new Set(members.map(m => m.file));
            if (files.size < 2) continue;
        }
        groups.push({ type: "exact", hash, similarity: 1.0, members });
        for (const m of members) nodeIds.add(m.node_id);
    }

    return { groups, nodeIds };
}

// --- Step 3: Normalized groups ---

/**
 * @param {object[]} blocks
 * @param {number|null} userMinStmts
 * @param {boolean} crossFile
 * @param {Set<number>} exactNodeIds
 * @returns {{ groups: object[], nodeIds: Set<number> }}
 */
function findNormalizedGroups(blocks, userMinStmts, crossFile, exactNodeIds) {
    const minStmts = effectiveMin(userMinStmts, "normalized");
    const filtered = blocks.filter(
        b => b.stmt_count >= minStmts && !exactNodeIds.has(b.node_id)
    );

    // Group by norm_hash
    const byHash = new Map();
    for (const b of filtered) {
        if (!byHash.has(b.norm_hash)) byHash.set(b.norm_hash, []);
        byHash.get(b.norm_hash).push(b);
    }

    const groups = [];
    const nodeIds = new Set();

    for (const [hash, members] of byHash) {
        if (members.length < 2) continue;
        if (crossFile) {
            const files = new Set(members.map(m => m.file));
            if (files.size < 2) continue;
        }
        groups.push({ type: "normalized", hash, similarity: 1.0, members });
        for (const m of members) nodeIds.add(m.node_id);
    }

    return { groups, nodeIds };
}

// --- Step 4: Near-miss groups (LSH + MinHash) ---

/**
 * @param {object} store
 * @param {object[]} blocks
 * @param {number|null} userMinStmts
 * @param {boolean} crossFile
 * @param {number} threshold
 * @param {Set<number>} alreadyReported
 * @returns {object[]}
 */
function findNearMissGroups(store, blocks, userMinStmts, crossFile, threshold, alreadyReported) {
    const minStmts = effectiveMin(userMinStmts, "near_miss");
    const candidates = blocks.filter(
        b => b.stmt_count >= minStmts
            && !alreadyReported.has(b.node_id)
            && b.fingerprint != null
    );

    if (candidates.length === 0) return [];

    // Build lookup by node_id for fast access
    const byNodeId = new Map();
    for (const b of candidates) byNodeId.set(b.node_id, b);

    // 4a: LSH candidate generation + 4b: pairwise verification
    const pairs = []; // [{a, b, jaccard}]
    const pairSeen = new Set();

    for (const block of candidates) {
        const sig = block.fingerprint;
        const bands = lshBands(sig);

        // Collect unique candidate node_ids from all bands
        const candidateIds = new Set();
        for (const { bandId, bucketHash } of bands) {
            const hits = store.getLshCandidates(bandId, bucketHash, block.node_id);
            for (const nid of hits) candidateIds.add(nid);
        }

        // Pre-filter and verify
        for (const cid of candidateIds) {
            if (alreadyReported.has(cid)) continue;

            const cBlock = byNodeId.get(cid) || store.getCloneBlockById(cid);
            if (!cBlock || !cBlock.fingerprint) continue;

            // Size ratio filter
            if (cBlock.stmt_count < block.stmt_count * 0.7) continue;
            if (cBlock.stmt_count > block.stmt_count * 1.3) continue;

            // Kind filter
            if (cBlock.kind !== block.kind) continue;

            // Dedup pair key
            const lo = Math.min(block.node_id, cid);
            const hi = Math.max(block.node_id, cid);
            const pairKey = `${lo}:${hi}`;
            if (pairSeen.has(pairKey)) continue;
            pairSeen.add(pairKey);

            // Jaccard verification
            const jaccard = minhashJaccard(sig, cBlock.fingerprint);
            if (jaccard >= threshold) {
                pairs.push({ a: block.node_id, b: cid, jaccard });
            }
        }
    }

    if (pairs.length === 0) return [];

    // 4c: Clustering via Union-Find
    // Collect all unique node_ids from pairs
    const nodeSet = new Set();
    for (const p of pairs) { nodeSet.add(p.a); nodeSet.add(p.b); }
    const nodeList = [...nodeSet];
    const nodeIndex = new Map();
    for (let i = 0; i < nodeList.length; i++) nodeIndex.set(nodeList[i], i);

    const uf = new UnionFind(nodeList.length);
    for (const p of pairs) {
        uf.union(nodeIndex.get(p.a), nodeIndex.get(p.b));
    }

    // Build similarity lookup for pairs
    const simMap = new Map();
    for (const p of pairs) {
        const lo = Math.min(p.a, p.b);
        const hi = Math.max(p.a, p.b);
        simMap.set(`${lo}:${hi}`, p.jaccard);
    }

    // Group by component
    const components = new Map();
    for (let i = 0; i < nodeList.length; i++) {
        const root = uf.find(i);
        if (!components.has(root)) components.set(root, []);
        components.get(root).push(nodeList[i]);
    }

    // Centroid verification for components > 2 members
    const groups = [];
    for (const [, memberIds] of components) {
        if (memberIds.length < 2) continue;

        let verifiedIds = memberIds;
        if (memberIds.length > 2) {
            verifiedIds = centroidVerify(memberIds, simMap, threshold, byNodeId, store);
        }

        if (verifiedIds.length < 2) continue;

        // Compute avg similarity
        let simSum = 0;
        let simCount = 0;
        for (let i = 0; i < verifiedIds.length; i++) {
            for (let j = i + 1; j < verifiedIds.length; j++) {
                const lo = Math.min(verifiedIds[i], verifiedIds[j]);
                const hi = Math.max(verifiedIds[i], verifiedIds[j]);
                const sim = simMap.get(`${lo}:${hi}`);
                if (sim !== undefined) { simSum += sim; simCount++; }
            }
        }
        const avgSim = simCount > 0 ? simSum / simCount : threshold;

        // Resolve blocks for members
        const members = [];
        for (const nid of verifiedIds) {
            const block = byNodeId.get(nid) || store.getCloneBlockById(nid);
            if (block) members.push(block);
        }

        if (crossFile) {
            const files = new Set(members.map(m => m.file));
            if (files.size < 2) continue;
        }

        groups.push({ type: "near_miss", hash: null, similarity: avgSim, members });
    }

    return groups;
}

/**
 * Centroid verification: find member with highest avg similarity, then
 * re-verify all others against centroid.
 * @param {number[]} memberIds
 * @param {Map<string, number>} simMap
 * @param {number} threshold
 * @param {Map<number, object>} byNodeId
 * @param {object} store
 * @returns {number[]}
 */
function centroidVerify(memberIds, simMap, threshold, byNodeId, store) {
    // Find centroid: member with highest avg similarity to all others
    let bestAvg = -1;
    let centroidId = memberIds[0];

    for (const id of memberIds) {
        let sum = 0;
        let count = 0;
        for (const otherId of memberIds) {
            if (id === otherId) continue;
            const lo = Math.min(id, otherId);
            const hi = Math.max(id, otherId);
            const sim = simMap.get(`${lo}:${hi}`);
            if (sim !== undefined) { sum += sim; count++; }
        }
        const avg = count > 0 ? sum / count : 0;
        if (avg > bestAvg) { bestAvg = avg; centroidId = id; }
    }

    // Get centroid fingerprint
    const centroidBlock = byNodeId.get(centroidId) || store.getCloneBlockById(centroidId);
    if (!centroidBlock || !centroidBlock.fingerprint) return memberIds;

    // Re-verify each member against centroid
    const verified = [centroidId];
    for (const id of memberIds) {
        if (id === centroidId) continue;
        const block = byNodeId.get(id) || store.getCloneBlockById(id);
        if (!block || !block.fingerprint) continue;
        const jaccard = minhashJaccard(centroidBlock.fingerprint, block.fingerprint);
        if (jaccard >= threshold) verified.push(id);
    }

    return verified;
}

// --- Step 5: Enrich groups ---

/**
 * @param {object} store
 * @param {object[]} groups
 * @returns {object[]}
 */
function enrichGroups(store, groups) {
    for (const group of groups) {
        let impact = 0;
        for (const member of group.members) {
            member.callers = countCallers(store, member.node_id);
            impact += member.callers;
        }
        group.impact = impact;

        // Sort score: member_count * avg_stmt_count * impact
        const avgStmts = group.members.reduce((s, m) => s + m.stmt_count, 0) / group.members.length;
        group._sortScore = group.members.length * avgStmts * Math.max(impact, 1);
        group._avgStmts = avgStmts;
    }

    // Sort DESC by score
    groups.sort((a, b) => b._sortScore - a._sortScore);
    return groups;
}

// --- Step 6: Suppression heuristics ---

const TEST_FILE_RE = /\btest[s]?\b|\bspec\b|\.test\.|\.spec\./i;

/**
 * @param {object} store
 * @param {object[]} groups
 */
function applySuppression(store, groups) {
    for (const group of groups) {
        group.suppressed = false;
        group.suppress_reason = null;
        group.hints = [];

        const members = group.members;


        // Strong: test-fixture (all members in test files)
        if (members.every(m => TEST_FILE_RE.test(m.file))) {
            group.suppressed = true;
            group.suppress_reason = "test-fixture";
            continue;
        }

        // Weak hint: interface-impl-hint
        // All members have same signature AND different parent qualified_name prefixes
        if (members.length >= 2 && members.every(m => m.signature != null)) {
            const sigs = new Set(members.map(m => m.signature));
            if (sigs.size === 1) {
                const prefixes = new Set(members.map(m => {
                    const qn = m.qualified_name || "";
                    const lastDot = qn.lastIndexOf(".");
                    return lastDot > -1 ? qn.substring(0, lastDot) : qn;
                }));
                if (prefixes.size === members.length) {
                    group.hints.push("interface-impl-hint");
                }
            }
        }

        // Weak hint: bounded-context-hint
        // Members in different top-level dirs AND no shared callers
        const topLevelDirs = new Set(members.map(m => {
            const norm = (m.file || "").replace(/\\/g, "/");
            const first = norm.split("/")[0];
            return first || norm;
        }));
        if (topLevelDirs.size > 1) {
            let hasSharedCallers = false;
            // Check for shared callers between any pair
            outer:
            for (let i = 0; i < members.length && !hasSharedCallers; i++) {
                const callersA = new Set(
                    store.edgesTo(members[i].node_id)
                        .filter(e => e.kind === "calls")
                        .map(e => e.source_id)
                );
                for (let j = i + 1; j < members.length; j++) {
                    const callersB = store.edgesTo(members[j].node_id)
                        .filter(e => e.kind === "calls");
                    for (const cb of callersB) {
                        if (callersA.has(cb.source_id)) {
                            hasSharedCallers = true;
                            break outer;
                        }
                    }
                }
            }
            if (!hasSharedCallers) {
                group.hints.push("bounded-context-hint");
            }
        }
    }
}

// --- Step 7: Format output ---

/**
 * Build JSON output structure.
 * @param {object[]} groups
 * @returns {object}
 */
function buildJsonOutput(groups) {
    let totalBlocks = 0;
    let suppressed = 0;
    const byType = { exact: 0, normalized: 0, near_miss: 0 };

    const formattedGroups = [];
    for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        byType[g.type]++;
        totalBlocks += g.members.length;
        if (g.suppressed) suppressed++;

        formattedGroups.push({
            id: `g${i + 1}`,
            type: g.type,
            hash: g.hash || null,
            similarity: Math.round(g.similarity * 1000) / 1000,
            members: g.members.map(m => ({
                file: m.file,
                name: m.name,
                kind: m.kind,
                lines: [m.line_start, m.line_end],
                stmt_count: m.stmt_count,
                callers: m.callers,
            })),
            impact: g.impact,
            suppressed: g.suppressed,
            suppress_reason: g.suppress_reason,
            hints: g.hints,
        });
    }

    return {
        summary: {
            total_groups: groups.length,
            total_blocks: totalBlocks,
            by_type: byType,
            suppressed,
        },
        groups: formattedGroups,
    };
}

/**
 * Convert JSON output to text format.
 * @param {object} json
 * @returns {string}
 */
function buildTextOutput(json) {
    const s = json.summary;
    const lines = [
        `${s.total_groups} clone groups (${s.total_blocks} blocks), ${s.suppressed} suppressed\n`,
    ];

    for (const g of json.groups) {
        const hashOrSim = g.hash ? g.hash.slice(0, 8) : `sim:${g.similarity.toFixed(2)}`;
        const avgStmts = g.members.length > 0
            ? Math.round(g.members.reduce((sum, m) => sum + m.stmt_count, 0) / g.members.length)
            : 0;
        const suppLabel = g.suppressed ? `  [suppressed: ${g.suppress_reason}]` : "";
        const hintLabels = (g.hints || []).map(h => `  [hint: ${h}]`).join("");

        lines.push(
            `${g.id}  ${g.type}  ${hashOrSim}  ${g.members.length} clones  ~${avgStmts} stmts  impact:${g.impact}${suppLabel}${hintLabels}`
        );

        for (const m of g.members) {
            lines.push(`    ${m.file}:${m.lines[0]}  ${m.name}()  callers:${m.callers}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

// --- Main export ---

/**
 * Detect code clones across indexed codebase.
 *
 * @param {object} store - Instantiated Store from store.mjs
 * @param {object} [opts={}]
 * @param {string} [opts.type="all"] - "exact" / "normalized" / "near_miss" / "all"
 * @param {number} [opts.threshold=0.80] - Jaccard threshold for near_miss
 * @param {number|null} [opts.minStmts=null] - Override tier defaults
 * @param {string} [opts.kind="all"] - "function" / "method" / "all"
 * @param {string|null} [opts.scope=null] - File glob filter
 * @param {boolean} [opts.crossFile=true] - Only cross-file clones
 * @param {string} [opts.format="json"] - "json" / "text"
 * @param {boolean} [opts.suppress=true] - Apply suppression heuristics
 * @returns {object|string}
 */
export function findClones(store, opts = {}) {
    const {
        type = "all",
        threshold = 0.80,
        minStmts = null,
        kind = "all",
        scope = null,
        crossFile = true,
        format = "json",
        suppress = true,
    } = opts;

    // Step 1: Load
    const blocks = loadBlocks(store, { kind, scope });

    const allGroups = [];
    let exactNodeIds = new Set();
    let normNodeIds = new Set();

    // Step 2: Exact
    if (type === "exact" || type === "all") {
        const result = findExactGroups(blocks, minStmts, crossFile);
        allGroups.push(...result.groups);
        exactNodeIds = result.nodeIds;
    }

    // Step 3: Normalized
    if (type === "normalized" || type === "all") {
        const result = findNormalizedGroups(blocks, minStmts, crossFile, exactNodeIds);
        allGroups.push(...result.groups);
        normNodeIds = result.nodeIds;
    }

    // Step 4: Near-miss
    if (type === "near_miss" || type === "all") {
        const alreadyReported = new Set([...exactNodeIds, ...normNodeIds]);
        const nmGroups = findNearMissGroups(
            store, blocks, minStmts, crossFile, threshold, alreadyReported
        );
        allGroups.push(...nmGroups);
    }

    // Step 5: Enrich
    enrichGroups(store, allGroups);

    // Step 6: Suppress
    if (suppress) {
        applySuppression(store, allGroups);
    } else {
        for (const g of allGroups) {
            g.suppressed = false;
            g.suppress_reason = null;
            g.hints = [];
        }
    }

    // Step 7: Format
    const json = buildJsonOutput(allGroups);
    if (format === "text") return buildTextOutput(json);
    return json;
}
