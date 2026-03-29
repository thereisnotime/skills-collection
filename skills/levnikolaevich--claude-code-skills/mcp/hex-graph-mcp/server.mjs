#!/usr/bin/env node
/**
 * hex-graph-mcp — identity-first graph kernel MCP server.
 * Transport: stdio
 */

import { z } from "zod";
const version = typeof __HEX_VERSION__ !== "undefined" ? __HEX_VERSION__ // eslint-disable-line no-undef
  : (await import("node:module")).createRequire(import.meta.url)("./package.json").version;
import { createServerRuntime } from "@levnikolaevich/hex-common/runtime/mcp-bootstrap";
import { flexBool, flexNum } from "@levnikolaevich/hex-common/runtime/schema";
import { checkForUpdates } from "@levnikolaevich/hex-common/runtime/update-check";
import { coerceParams } from "@levnikolaevich/hex-common/runtime/coerce";
import { findClones } from "./lib/clones.mjs";
import { findCycles } from "./lib/cycles.mjs";
import { resolveStore, findSymbols, getSymbol, tracePaths, getReferencesBySelector, findImplementationsBySelector, findDataflowsBySelector, getArchitectureReport, getHotspots, getModuleMetricsReport, explainResolution } from "./lib/store.mjs";
import { findUnusedExports, formatUnusedText } from "./lib/unused.mjs";

const { server, StdioServerTransport } = await createServerRuntime({
    name: "hex-graph-mcp",
    version,
});

function graphError(codeOrError, message, recovery) {
    const error = typeof codeOrError === "object" && codeOrError
        ? {
            ...codeOrError,
            recovery: codeOrError.recovery || recovery || "Adjust selector or run search_symbols first",
        }
        : {
            code: codeOrError,
            message,
            recovery: recovery || "Adjust selector or run search_symbols first",
        };
    return {
        content: [{ type: "text", text: JSON.stringify({ error }, null, 2) }],
        isError: true,
    };
}

function selectorSchema() {
    return {
        symbol_id: flexNum().describe("Canonical symbol id"),
        qualified_name: z.string().optional().describe("Canonical qualified symbol name"),
        name: z.string().optional().describe("Symbol name (must be paired with file)"),
        file: z.string().optional().describe("File path used with name to disambiguate symbol"),
    };
}

function targetSelectorSchema() {
    return {
        to_symbol_id: flexNum().describe("Optional target symbol id"),
        to_qualified_name: z.string().optional().describe("Optional target qualified symbol name"),
        to_name: z.string().optional().describe("Optional target symbol name (must be paired with to_file)"),
        to_file: z.string().optional().describe("Optional target file used with to_name"),
    };
}

function buildTargetSelector(params) {
    const { to_symbol_id, to_qualified_name, to_name, to_file } = params;
    if (
        to_symbol_id === undefined &&
        to_qualified_name === undefined &&
        to_name === undefined &&
        to_file === undefined
    ) {
        return null;
    }
    return {
        symbol_id: to_symbol_id,
        qualified_name: to_qualified_name,
        name: to_name,
        file: to_file,
    };
}

function wrapResult(result, format = "json") {
    if (result?.error) {
        return graphError(result.error);
    }
    const text = format === "json" ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2);
    return { content: [{ type: "text", text }] };
}

server.registerTool("index_project", {
    title: "Index Project",
    description: "Scan and index a project into the graph kernel.",
    inputSchema: z.object({
        path: z.string().describe("Project root directory"),
        languages: z.array(z.string()).optional().describe("Filter indexed languages"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path: projectPath, languages } = coerceParams(rawParams);
    try {
        const { indexProject } = await import("./lib/indexer.mjs");
        const result = await indexProject(projectPath, { languages });
        return wrapResult({
            query: { path: projectPath, languages: languages || null },
            result: { status: result },
            confidence: "exact",
            reason: "index_project_completed",
            evidence: {},
            limits_applied: {},
        });
    } catch (e) {
        return graphError("PATH_NOT_FOUND", e.message, "Check path exists and is accessible");
    }
});

server.registerTool("watch_project", {
    title: "Watch Project",
    description: "Watch a project and keep the graph index updated incrementally.",
    inputSchema: z.object({
        path: z.string().describe("Project root directory"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path: projectPath } = coerceParams(rawParams);
    try {
        const { watchProject } = await import("./lib/watcher.mjs");
        return wrapResult({
            query: { path: projectPath },
            result: { status: watchProject(projectPath) },
            confidence: "exact",
            reason: "watch_project_started",
            evidence: {},
            limits_applied: {},
        });
    } catch (e) {
        return graphError("PATH_NOT_FOUND", e.message, "Check path exists");
    }
});

server.registerTool("search_symbols", {
    title: "Search Symbols",
    description: "Search graph symbols and return canonical identities.",
    inputSchema: z.object({
        query: z.string().describe("Symbol name or partial name"),
        kind: z.string().optional().describe("Optional kind filter"),
        limit: flexNum().describe("Max results (default: 20)"),
        path: z.string().optional().describe("Indexed project root"),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { query, kind, limit, path, format } = coerceParams(rawParams);
    return wrapResult(findSymbols(query, { kind, limit: limit ?? 20, path }), format);
});

server.registerTool("get_symbol", {
    title: "Get Symbol",
    description: "Return full graph context for one canonical symbol identity.",
    inputSchema: z.object({
        ...selectorSchema(),
        path: z.string().optional().describe("Indexed project root"),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, format, ...selector } = coerceParams(rawParams);
    return wrapResult(getSymbol(selector, { path }), format);
});

server.registerTool("trace_paths", {
    title: "Trace Paths",
    description: "Trace graph paths from a canonical symbol through calls, references, imports, type, flow, or mixed edges.",
    inputSchema: z.object({
        ...selectorSchema(),
        ...targetSelectorSchema(),
        path_kind: z.enum(["calls", "references", "imports", "type", "flow", "mixed"]).default("calls"),
        direction: z.enum(["forward", "reverse", "both"]).default("reverse"),
        depth: flexNum().describe("Max traversal depth (default: 3)"),
        limit: flexNum().describe("Max paths (default: 50)"),
        path: z.string().optional().describe("Indexed project root"),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, format, path_kind, direction, depth, limit, ...selector } = coerceParams(rawParams);
    const target = buildTargetSelector(selector);
    delete selector.to_symbol_id;
    delete selector.to_qualified_name;
    delete selector.to_name;
    delete selector.to_file;
    return wrapResult(tracePaths(selector, {
        path_kind: path_kind ?? "calls",
        direction: direction ?? "reverse",
        depth: depth ?? 3,
        limit: limit ?? 50,
        path,
        target,
    }), format);
});

server.registerTool("find_references", {
    title: "Find References",
    description: "Find semantic usages of a canonical symbol identity.",
    inputSchema: z.object({
        ...selectorSchema(),
        kind: z.enum(["ref_read", "ref_type", "calls", "reexports", "imports", "all"]).default("all"),
        limit: flexNum().describe("Max references (default: 50)"),
        path: z.string().optional().describe("Indexed project root"),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, format, kind, limit, ...selector } = coerceParams(rawParams);
    return wrapResult(getReferencesBySelector(selector, {
        kind: kind ?? "all",
        limit: limit ?? 50,
        path,
    }), format);
});

server.registerTool("find_implementations", {
    title: "Find Implementations",
    description: "Find implementations and overrides for a canonical symbol identity.",
    inputSchema: z.object({
        ...selectorSchema(),
        path: z.string().optional().describe("Indexed project root"),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, format, ...selector } = coerceParams(rawParams);
    return wrapResult(findImplementationsBySelector(selector, { path }), format);
});

server.registerTool("find_dataflows", {
    title: "Find Dataflows",
    description: "Find deterministic dataflow paths for a canonical symbol identity.",
    inputSchema: z.object({
        ...selectorSchema(),
        ...targetSelectorSchema(),
        depth: flexNum().describe("Max summary-propagation depth (default: 2)"),
        limit: flexNum().describe("Max flow summaries/paths (default: 50)"),
        path: z.string().optional().describe("Indexed project root"),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, format, depth, limit, ...selector } = coerceParams(rawParams);
    const target = buildTargetSelector(selector);
    delete selector.to_symbol_id;
    delete selector.to_qualified_name;
    delete selector.to_name;
    delete selector.to_file;
    return wrapResult(findDataflowsBySelector(selector, {
        depth: depth ?? 2,
        limit: limit ?? 50,
        path,
        target,
    }), format);
});

server.registerTool("explain_resolution", {
    title: "Explain Resolution",
    description: "Explain how a selector resolved to a canonical symbol identity.",
    inputSchema: z.object({
        ...selectorSchema(),
        path: z.string().optional().describe("Indexed project root"),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, format, ...selector } = coerceParams(rawParams);
    return wrapResult(explainResolution(selector, { path }), format);
});

server.registerTool("find_clones", {
    title: "Find Clones",
    description: "Detect exact, normalized, and near-miss code clones.",
    inputSchema: z.object({
        path: z.string().describe("Indexed project root"),
        type: z.enum(["exact", "normalized", "near_miss", "all"]).default("all"),
        threshold: z.preprocess(v => typeof v === "string" ? Number(v) : v, z.number().min(0).max(1).default(0.80)),
        min_stmts: z.preprocess(v => typeof v === "string" ? Number(v) : v, z.number().int().min(1).optional()),
        kind: z.enum(["function", "method", "all"]).default("all"),
        scope: z.string().optional(),
        cross_file: flexBool(),
        format: z.enum(["json", "text"]).default("json"),
        suppress: flexBool(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, type, threshold, min_stmts, kind, scope, cross_file, format, suppress } = coerceParams(rawParams);
    try {
        const store = resolveStore(path);
        if (!store) return graphError("NOT_INDEXED", "No project indexed", "Run index_project first");
        const result = findClones(store, {
            type,
            threshold: threshold ?? 0.80,
            minStmts: min_stmts ?? null,
            kind,
            scope,
            crossFile: cross_file ?? true,
            format,
            suppress: suppress ?? true,
        });
        return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
    } catch (e) {
        return graphError("DB_ERROR", e.message, "Re-run index_project to rebuild");
    }
});

server.registerTool("find_hotspots", {
    title: "Find Hotspots",
    description: "Rank high-risk symbols by complexity and dependency concentration.",
    inputSchema: z.object({
        path: z.string().describe("Indexed project root"),
        min_callers: flexNum(),
        min_complexity: flexNum(),
        limit: flexNum(),
        scope: z.string().optional(),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, min_callers, min_complexity, limit, scope, format } = coerceParams(rawParams);
    const result = getHotspots({
        minCallers: min_callers ?? 2,
        minComplexity: min_complexity ?? 15,
        limit: limit ?? 20,
        scopePath: scope,
        path,
    });
    return wrapResult({
        query: { min_callers: min_callers ?? 2, min_complexity: min_complexity ?? 15, limit: limit ?? 20, scope: scope || null },
        result,
        confidence: "exact",
        reason: "hotspot_query",
        evidence: { total_found: result.length },
        limits_applied: { limit: limit ?? 20 },
    }, format);
});

server.registerTool("find_unused_exports", {
    title: "Find Unused Exports",
    description: "Find exported symbols with zero proven imports.",
    inputSchema: z.object({
        path: z.string().describe("Indexed project root"),
        scope: z.string().optional(),
        kind: z.enum(["function", "class", "variable", "all"]).default("all"),
        show_suppressed: flexBool(),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, scope, kind, show_suppressed, format } = coerceParams(rawParams);
    const store = resolveStore(path);
    if (!store) return graphError("NOT_INDEXED", "No project indexed", "Run index_project first");
    const result = findUnusedExports(store, { scopePath: scope, kind: kind || "all" });
    if (format === "text") {
        return { content: [{ type: "text", text: formatUnusedText(result, show_suppressed ?? false) }] };
    }
    const output = show_suppressed ? result : { ...result, unused: result.unused.filter(u => !u.suppressed) };
    return wrapResult({
        query: { scope: scope || null, kind: kind || "all", show_suppressed: !!show_suppressed },
        result: output,
        confidence: "heuristic",
        reason: "static_export_liveness",
        evidence: { total_exported: result.total_exported },
        limits_applied: {},
    }, format);
});

server.registerTool("find_cycles", {
    title: "Find Cycles",
    description: "Detect circular module dependencies.",
    inputSchema: z.object({
        path: z.string().describe("Indexed project root"),
        scope: z.string().optional(),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, scope, format } = coerceParams(rawParams);
    const store = resolveStore(path);
    if (!store) return graphError("NOT_INDEXED", "No project indexed", "Run index_project first");
    return wrapResult({
        query: { scope: scope || null },
        result: findCycles(store, { scopePath: scope }),
        confidence: "exact",
        reason: "module_cycle_detection",
        evidence: {},
        limits_applied: {},
    }, format);
});

server.registerTool("get_module_metrics", {
    title: "Get Module Metrics",
    description: "Calculate module coupling metrics from the graph.",
    inputSchema: z.object({
        path: z.string().describe("Indexed project root"),
        scope: z.string().optional(),
        sort: z.enum(["instability", "ca", "ce", "file"]).default("instability"),
        min_coupling: flexNum(),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, scope, sort, min_coupling, format } = coerceParams(rawParams);
    return wrapResult(getModuleMetricsReport({
        scopePath: scope,
        sort: sort ?? "instability",
        minCoupling: min_coupling ?? 2,
        path,
    }), format);
});

server.registerTool("get_architecture", {
    title: "Get Architecture",
    description: "Summarize module structure, hotspots, and cross-module graph edges.",
    inputSchema: z.object({
        path: z.string().optional().describe("Indexed project root"),
        scope: z.string().optional().describe("Optional file path prefix filter"),
        limit: flexNum(),
        format: z.enum(["json", "text"]).default("json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async (rawParams) => {
    const { path, scope, limit, format } = coerceParams(rawParams);
    return wrapResult(getArchitectureReport({ scopePath: scope, limit: limit ?? 15, path }), format);
});

const transport = new StdioServerTransport();
await server.connect(transport);
void checkForUpdates("@levnikolaevich/hex-graph-mcp", version);
