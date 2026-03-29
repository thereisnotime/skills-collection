/**
 * Circular module dependency detection via Tarjan's SCC.
 * Uses module_edges table (file-level import graph).
 */

/**
 * Find all strongly connected components using Tarjan's algorithm.
 * @param {Map<string, Set<string>>} adjacency - directed graph
 * @returns {string[][]} SCCs with size >= 2
 */
function tarjanSCC(adjacency) {
    let index = 0;
    const stack = [];
    const onStack = new Set();
    const indices = new Map();
    const lowlinks = new Map();
    const sccs = [];

    function strongconnect(v) {
        indices.set(v, index);
        lowlinks.set(v, index);
        index++;
        stack.push(v);
        onStack.add(v);

        for (const w of (adjacency.get(v) || [])) {
            if (!indices.has(w)) {
                strongconnect(w);
                lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
            } else if (onStack.has(w)) {
                lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
            }
        }

        if (lowlinks.get(v) === indices.get(v)) {
            const scc = [];
            let w;
            do {
                w = stack.pop();
                onStack.delete(w);
                scc.push(w);
            } while (w !== v);
            sccs.push(scc);
        }
    }

    for (const v of adjacency.keys()) {
        if (!indices.has(v)) strongconnect(v);
    }

    return sccs.filter(scc => scc.length >= 2);
}

/**
 * Extract representative cycle within an SCC via BFS from the first node.
 * @param {string[]} scc - nodes in the SCC
 * @param {Map<string, Set<string>>} adjacency - full graph adjacency
 * @returns {string[]} cycle path ending with start node (e.g. [a, b, c, a])
 */
function representativeCycleInSCC(scc, adjacency) {
    const sccSet = new Set(scc);
    const start = scc[0];

    // BFS from start, only visiting nodes within this SCC
    const queue = [[start, [start]]];
    const visited = new Set();

    while (queue.length > 0) {
        const [node, path] = queue.shift();

        for (const neighbor of (adjacency.get(node) || [])) {
            if (!sccSet.has(neighbor)) continue;

            if (neighbor === start && path.length >= 2) {
                return [...path, start];
            }

            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push([neighbor, [...path, neighbor]]);
            }
        }
    }

    // Fallback: return full SCC as cycle (should not happen for valid SCC)
    return [...scc, scc[0]];
}

/**
 * Detect circular module dependencies.
 * @param {object} store - Store instance with allModuleEdges()
 * @param {{ scopePath?: string }} options
 * @returns {{ cycles: Array<{files: string[], length: number}>, total_modules: number, total_edges: number }}
 */
export function findCycles(store, { scopePath } = {}) {
    const rawEdges = store.allModuleEdges();

    // Build adjacency list, optionally filtering by scope
    const adjacency = new Map();
    let totalEdges = 0;
    const allNodes = new Set();

    for (const { source_file, target_file } of rawEdges) {
        if (scopePath) {
            if (!source_file.startsWith(scopePath) && !target_file.startsWith(scopePath)) {
                continue;
            }
        }

        allNodes.add(source_file);
        allNodes.add(target_file);
        totalEdges++;

        if (!adjacency.has(source_file)) adjacency.set(source_file, new Set());
        adjacency.get(source_file).add(target_file);

        // Ensure target exists in adjacency for Tarjan traversal
        if (!adjacency.has(target_file)) adjacency.set(target_file, new Set());
    }

    const sccs = tarjanSCC(adjacency);

    // Extract representative cycle from each SCC, sort by length
    const cycles = sccs
        .map(scc => {
            const path = representativeCycleInSCC(scc, adjacency);
            return { files: path, length: path.length - 1 };
        })
        .sort((a, b) => a.length - b.length);

    return {
        cycles,
        total_modules: allNodes.size,
        total_edges: totalEdges,
    };
}
