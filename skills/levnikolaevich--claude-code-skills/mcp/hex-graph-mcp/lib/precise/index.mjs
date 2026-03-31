import { providerForLanguage } from "./provider-status.mjs";
import { runCSharpPreciseOverlay } from "./csharp.mjs";
import { runPhpPreciseOverlay } from "./php.mjs";
import { runPythonPreciseOverlay } from "./python.mjs";
import { runTypeScriptPreciseOverlay } from "./typescript.mjs";

function upsertUnavailableProviders(store, languages) {
    for (const language of languages) {
        const descriptor = providerForLanguage(language);
        if (!descriptor || descriptor.provider === "precise_ts") continue;
        store.upsertProviderRun({
            provider: descriptor.provider,
            language,
            status: "unavailable",
            version: null,
            detail: JSON.stringify({
                provider: descriptor.tool_display_name,
                engine: descriptor.engine,
                checked_commands: descriptor.checked_commands || [],
                install_hint: descriptor.install_hint || null,
                required_runtime: descriptor.required_runtime || null,
                docs_url: descriptor.docs_url || null,
                reason: "missing_command",
                command: descriptor.default_command?.[0] || descriptor.tool_display_name,
            }),
        });
    }
}

async function runExternalProvider(store, language, runner, context) {
    const descriptor = providerForLanguage(language);
    store.clearEdgesByOrigin(descriptor.provider);
    const result = await runner(context);
    store.upsertProviderRun({
        provider: descriptor.provider,
        language,
        status: result.status,
        version: result.version || null,
        detail: JSON.stringify(result.detail || result),
    });
    return {
        language,
        provider: descriptor.provider,
        status: result.status,
        edge_count: result.edge_count || 0,
        message: store.providerStatusForLanguage(language)?.message || null,
    };
}

export async function runPreciseOverlay({ projectPath, store, languages, sourceFiles }) {
    const languageList = [...new Set((languages || []).filter(Boolean))];
    const providers = [];
    let precise_edges = 0;
    const tsDescriptor = providerForLanguage("typescript");
    if (languageList.includes("javascript") || languageList.includes("typescript")) {
        store.clearEdgesByOrigin(tsDescriptor.provider);
        try {
            const result = runTypeScriptPreciseOverlay({ projectPath, store, sourceFiles });
            store.upsertProviderRun({
                provider: tsDescriptor.provider,
                language: "typescript",
                status: result.status === "available" ? "available" : "unavailable",
                version: result.version || null,
                detail: JSON.stringify(result),
            });
            store.upsertProviderRun({
                provider: tsDescriptor.provider,
                language: "javascript",
                status: result.status === "available" ? "available" : "unavailable",
                version: result.version || null,
                detail: JSON.stringify(result),
            });
            precise_edges += result.edge_count || 0;
            providers.push({
                language: "javascript/typescript",
                provider: tsDescriptor.provider,
                status: result.status,
                edge_count: result.edge_count || 0,
                message: store.providerStatusForLanguage("typescript")?.message || null,
            });
        } catch (error) {
            const detail = JSON.stringify({
                reason: "provider_failed",
                message: error.message,
            });
            store.upsertProviderRun({
                provider: tsDescriptor.provider,
                language: "typescript",
                status: "failed",
                version: null,
                detail,
            });
            store.upsertProviderRun({
                provider: tsDescriptor.provider,
                language: "javascript",
                status: "failed",
                version: null,
                detail,
            });
            providers.push({
                language: "javascript/typescript",
                provider: tsDescriptor.provider,
                status: "failed",
                edge_count: 0,
                message: store.providerStatusForLanguage("typescript")?.message || null,
            });
        }
    }

    const externalProviders = [
        ["python", runPythonPreciseOverlay],
        ["c_sharp", runCSharpPreciseOverlay],
        ["php", runPhpPreciseOverlay],
    ];
    for (const [language, runner] of externalProviders) {
        if (!languageList.includes(language)) continue;
        const result = await runExternalProvider(store, language, runner, {
            projectPath,
            store,
            sourceFiles,
        });
        precise_edges += result.edge_count;
        providers.push(result);
    }

    if (providers.length === 0) upsertUnavailableProviders(store, languageList);
    return { precise_edges, providers };
}
