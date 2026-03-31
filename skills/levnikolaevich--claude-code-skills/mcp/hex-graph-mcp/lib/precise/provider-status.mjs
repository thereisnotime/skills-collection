const LANGUAGE_PROVIDERS = new Map([
    ["javascript", {
        provider: "precise_ts",
        engine: "typescript",
        display_language: "JavaScript/TypeScript",
        tool_display_name: "TypeScript compiler API",
        kind: "embedded",
    }],
    ["typescript", {
        provider: "precise_ts",
        engine: "typescript",
        display_language: "JavaScript/TypeScript",
        tool_display_name: "TypeScript compiler API",
        kind: "embedded",
    }],
    ["python", {
        provider: "precise_py",
        engine: "basedpyright",
        display_language: "Python",
        tool_display_name: "basedpyright",
        kind: "external",
        language_id: "python",
        command_env: "HEX_GRAPH_PRECISE_PY_COMMAND",
        default_command: ["basedpyright-langserver", "--stdio"],
        checked_commands: ["basedpyright-langserver --stdio"],
        install_hint: "basedpyright",
        required_runtime: "Python environment with basedpyright",
        docs_url: "https://docs.basedpyright.com/latest/",
    }],
    ["csharp", {
        provider: "precise_cs",
        engine: "csharp-ls",
        display_language: "C#",
        tool_display_name: "csharp-ls",
        kind: "external",
        language_id: "csharp",
        command_env: "HEX_GRAPH_PRECISE_CS_COMMAND",
        default_command: ["csharp-ls"],
        checked_commands: ["csharp-ls"],
        install_hint: "csharp-ls",
        required_runtime: ".NET SDK/runtime with csharp-ls",
        docs_url: "https://github.com/razzmatazz/csharp-language-server#readme",
    }],
    ["c_sharp", {
        provider: "precise_cs",
        engine: "csharp-ls",
        display_language: "C#",
        tool_display_name: "csharp-ls",
        kind: "external",
        language_id: "csharp",
        command_env: "HEX_GRAPH_PRECISE_CS_COMMAND",
        default_command: ["csharp-ls"],
        checked_commands: ["csharp-ls"],
        install_hint: "csharp-ls",
        required_runtime: ".NET SDK/runtime with csharp-ls",
        docs_url: "https://github.com/razzmatazz/csharp-language-server#readme",
    }],
    ["php", {
        provider: "precise_php",
        engine: "phpactor",
        display_language: "PHP",
        tool_display_name: "phpactor",
        kind: "external",
        language_id: "php",
        command_env: "HEX_GRAPH_PRECISE_PHP_COMMAND",
        default_command: ["phpactor", "language-server"],
        checked_commands: ["phpactor language-server"],
        install_hint: "phpactor",
        required_runtime: "PHP with phpactor",
        docs_url: "https://phpactor.readthedocs.io/en/master/usage/language-server.html",
    }],
]);

function parseDetail(detail) {
    if (!detail) return null;
    if (typeof detail === "object") return detail;
    try {
        return JSON.parse(detail);
    } catch {
        return { raw: detail };
    }
}

function formatProviderMessage(descriptor, status, detail) {
    if (!descriptor) return null;
    if (status === "available") {
        return `${descriptor.display_language} precise analysis is available via ${descriptor.tool_display_name}.`;
    }
    if (status === "unavailable") {
        const missingCommand = (detail?.command || descriptor.default_command?.[0] || descriptor.tool_display_name).split(" ")[0];
        return `${descriptor.display_language} precise analysis is unavailable because ${missingCommand} is not installed. Ask a human to install ${descriptor.install_hint || descriptor.tool_display_name} and rerun index_project.`;
    }
    if (status === "failed") {
        const reason = detail?.message || detail?.reason || "the provider could not analyze this project";
        return `${descriptor.display_language} precise analysis failed because ${reason}. Ask a human to fix the provider setup and rerun index_project.`;
    }
    if (status === "skipped") {
        return `${descriptor.display_language} precise analysis was skipped for this index run.`;
    }
    return `${descriptor.display_language} precise analysis status is ${status}.`;
}

export function providerDetail(descriptor, overrides = {}) {
    return {
        provider: descriptor.provider,
        engine: descriptor.engine,
        checked_commands: overrides.checked_commands || descriptor.checked_commands || [],
        required_runtime: overrides.required_runtime || descriptor.required_runtime || null,
        install_hint: overrides.install_hint || descriptor.install_hint || null,
        docs_url: overrides.docs_url || descriptor.docs_url || null,
        root_used: overrides.root_used || null,
        config_used: overrides.config_used || [],
        command: overrides.command || null,
        reason: overrides.reason || null,
        message: overrides.message || null,
        ...overrides.extra,
    };
}

export function normalizeProviderRun(run, language) {
    if (!run) return null;
    const descriptor = providerForLanguage(language || run.language);
    const detail = parseDetail(run.detail);
    return {
        provider: run.provider,
        language: run.language,
        status: run.status,
        version: run.version || null,
        indexed_at: run.indexed_at || null,
        engine: descriptor?.engine || null,
        display_language: descriptor?.display_language || run.language,
        tool_display_name: descriptor?.tool_display_name || detail?.provider || run.provider,
        checked_commands: detail?.checked_commands || descriptor?.checked_commands || [],
        required_runtime: detail?.required_runtime || descriptor?.required_runtime || null,
        install_hint: detail?.install_hint || descriptor?.install_hint || null,
        docs_url: detail?.docs_url || descriptor?.docs_url || null,
        root_used: detail?.root_used || null,
        config_used: detail?.config_used || [],
        command: detail?.command || null,
        detail,
        message: formatProviderMessage(descriptor, run.status, detail),
    };
}

export function providerForLanguage(language) {
    return LANGUAGE_PROVIDERS.get(language) || null;
}

export function listProviderLanguages(languages) {
    return [...new Set((languages || []).filter(Boolean))];
}
