/**
 * Workspace-module cycle detection via Tarjan's SCC.
 * Uses package_edges as the canonical dependency graph.
 */

function normalizeScopePath(scopePath) {
    if (!scopePath) return null;
    return scopePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function moduleMatchesScope(moduleRootPath, scopePath) {
    if (!scopePath) return true;
    const root = (moduleRootPath || ".").replace(/\\/g, "/").replace(/^\.\//, "");
    if (root === "." || root === "") return true;
    return root === scopePath
        || root.startsWith(`${scopePath}/`)
        || scopePath.startsWith(`${root}/`);
}

function tarjanSCC(adjacency) {
    let index = 0;
    const stack = [];
    const onStack = new Set();
    const indices = new Map();
    const lowlinks = new Map();
    const sccs = [];

    function strongconnect(node) {
        indices.set(node, index);
        lowlinks.set(node, index);
        index++;
        stack.push(node);
        onStack.add(node);

        for (const neighbor of (adjacency.get(node) || [])) {
            if (!indices.has(neighbor)) {
                strongconnect(neighbor);
                lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(neighbor)));
            } else if (onStack.has(neighbor)) {
                lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(neighbor)));
            }
        }

        if (lowlinks.get(node) === indices.get(node)) {
            const scc = [];
            let current;
            do {
                current = stack.pop();
                onStack.delete(current);
                scc.push(current);
            } while (current !== node);
            sccs.push(scc);
        }
    }

    for (const node of adjacency.keys()) {
        if (!indices.has(node)) strongconnect(node);
    }

    return sccs.filter(scc => scc.length >= 2);
}

function representativeCycleInSCC(scc, adjacency) {
    const sccSet = new Set(scc);
    const start = scc[0];
    const queue = [[start, [start]]];
    const visited = new Set([start]);

    while (queue.length > 0) {
        const [node, path] = queue.shift();
        for (const neighbor of (adjacency.get(node) || [])) {
            if (!sccSet.has(neighbor)) continue;
            if (neighbor === start && path.length >= 2) {
                return [...path, start];
            }
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            queue.push([neighbor, [...path, neighbor]]);
        }
    }

    return [...scc, scc[0]];
}

export function findCycles(store, { scopePath } = {}) {
    const normalizedScope = normalizeScopePath(scopePath);
    const modules = store.workspaceModuleRows();
    const moduleByKey = new Map(modules.map(row => [row.module_key, row]));
    const scopedModules = new Set(
        modules
            .filter(row => moduleMatchesScope(row.root_path, normalizedScope))
            .map(row => row.module_key),
    );

    const adjacency = new Map();
    let totalEdges = 0;
    for (const edge of store.packageEdgeRows()) {
        if (!edge.target_module_key) continue;
        if (edge.source_module_key === edge.target_module_key) continue;
        if (normalizedScope && !scopedModules.has(edge.source_module_key) && !scopedModules.has(edge.target_module_key)) {
            continue;
        }

        if (!adjacency.has(edge.source_module_key)) adjacency.set(edge.source_module_key, new Set());
        if (!adjacency.has(edge.target_module_key)) adjacency.set(edge.target_module_key, new Set());
        adjacency.get(edge.source_module_key).add(edge.target_module_key);
        totalEdges++;
    }

    const sccs = tarjanSCC(adjacency);
    const cycles = sccs
        .map(scc => representativeCycleInSCC(scc, adjacency))
        .map(path => ({
            modules: path.map(moduleKey => {
                const mod = moduleByKey.get(moduleKey);
                return {
                    module_key: moduleKey,
                    module_name: mod?.name || moduleKey,
                    module_root_path: mod?.root_path || null,
                    package_key: mod?.package_key || null,
                    package_name: mod?.package_name || null,
                };
            }),
            length: path.length - 1,
        }))
        .sort((a, b) => a.length - b.length);

    return {
        cycles,
        total_modules: adjacency.size,
        total_edges: totalEdges,
    };
}
