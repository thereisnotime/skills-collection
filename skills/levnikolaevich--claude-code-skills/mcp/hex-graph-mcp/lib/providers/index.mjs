import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function readText(path) {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return null;
    }
}

function envOverride(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

function useShell(command) {
    const extension = extname(command).toLowerCase();
    return process.platform === "win32" && (!extension || extension === ".cmd" || extension === ".bat");
}

function quoteForCmd(value) {
    const text = String(value ?? "");
    if (!/[ \t"&()^%!]/.test(text)) {
        return text;
    }
    return `"${text.replace(/"/g, "\"\"")}"`;
}

function runCommand(command, args, { cwd, allowFailure = false } = {}) {
    const shellRequired = useShell(command);
    const result = shellRequired
        ? spawnSync(process.env.ComSpec || "cmd.exe", [
            "/d",
            "/s",
            "/c",
            [quoteForCmd(command), ...(args || []).map(quoteForCmd)].join(" "),
        ], {
            cwd,
            encoding: "utf8",
            shell: false,
            windowsHide: true,
        })
        : spawnSync(command, args, {
            cwd,
            encoding: "utf8",
            shell: false,
            windowsHide: true,
        });
    if (!allowFailure && result.error) {
        throw result.error;
    }
    return result;
}

function commandSucceeded(command, args, cwd) {
    try {
        const result = runCommand(command, args, { cwd, allowFailure: true });
        return {
            ok: !result.error && result.status === 0,
            error: result.error || (result.status === 0 ? null : new Error([result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `${command} exited with status ${result.status}`)),
            stdout: result.stdout || "",
            stderr: result.stderr || "",
        };
    } catch (error) {
        return { ok: false, error, stdout: "", stderr: "" };
    }
}

function installCommand(command, args, cwd) {
    const result = runCommand(command, args, { cwd, allowFailure: true });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `${command} exited with status ${result.status}`);
    }
    return result;
}

function commandLabel(command, args) {
    return [command, ...(args || [])].join(" ");
}

function installLabels(install) {
    if (!install) return [];
    if (Array.isArray(install.steps)) {
        return install.steps.map(step => step.label);
    }
    return install.label ? [install.label] : [];
}

function runtimeChecks() {
    return {
        uv: commandSucceeded("uv", ["--version"]),
        python: commandSucceeded("python", ["--version"]),
        py: process.platform === "win32" ? commandSucceeded("py", ["-V"]) : { ok: false, error: null, stdout: "", stderr: "" },
        dotnet: commandSucceeded("dotnet", ["--version"]),
        composer: commandSucceeded("composer", ["--version"]),
        npm: commandSucceeded("npm", ["--version"]),
    };
}

function runtimeSnapshot(runtime) {
    return Object.fromEntries(Object.entries(runtime).map(([name, status]) => [
        name,
        {
            ok: !!status?.ok,
            detail: status?.ok
                ? (status.stdout || status.stderr || "").trim() || null
                : (status?.error ? String(status.error.message || status.error) : null),
        },
    ]));
}

function scanSourceExtensions(projectPath, bucket = new Set()) {
    const skipDirs = new Set([".git", ".hex-skills", ".venv", "node_modules", "vendor", "dist", "build", "out", "bin", "obj", "__pycache__"]);
    const stack = [projectPath];
    while (stack.length) {
        const current = stack.pop();
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name)) {
                    stack.push(join(current, entry.name));
                }
                continue;
            }
            switch (extname(entry.name).toLowerCase()) {
            case ".js":
            case ".mjs":
            case ".cjs":
            case ".jsx":
                bucket.add("javascript");
                break;
            case ".ts":
            case ".tsx":
                bucket.add("typescript");
                break;
            case ".py":
                bucket.add("python");
                break;
            case ".php":
                bucket.add("php");
                break;
            case ".cs":
                bucket.add("csharp");
                break;
            default:
                break;
            }
        }
    }
    return bucket;
}

function detectFromTechStack(projectPath, bucket = new Set()) {
    const content = readText(join(projectPath, "docs", "project", "tech_stack.md"));
    if (!content) return bucket;
    const text = content.toLowerCase();
    if (/(typescript|next\.js|nestjs|react|angular)/.test(text)) bucket.add("typescript");
    if (/(javascript|express)/.test(text)) bucket.add("javascript");
    if (/(python|fastapi|django|flask)/.test(text)) bucket.add("python");
    if (/(php|laravel)/.test(text)) bucket.add("php");
    if (/(c#|csharp|asp\.net|dotnet|\.net)/.test(text)) bucket.add("csharp");
    return bucket;
}

function detectProjectLanguages(projectPath) {
    const absolute = resolve(projectPath);
    const detected = new Set();
    detectFromTechStack(absolute, detected);

    if (existsSync(join(absolute, "tsconfig.json")) || existsSync(join(absolute, "jsconfig.json"))) {
        detected.add("typescript");
    }
    if (existsSync(join(absolute, "package.json")) && !detected.has("typescript")) {
        detected.add("javascript");
    }
    if (["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile"].some(name => existsSync(join(absolute, name)))) {
        detected.add("python");
    }
    if (existsSync(join(absolute, "composer.json"))) {
        detected.add("php");
    }
    if (readdirSync(absolute, { withFileTypes: true }).some(entry => !entry.isDirectory() && (entry.name.endsWith(".csproj") || entry.name.endsWith(".sln")))) {
        detected.add("csharp");
    }

    scanSourceExtensions(absolute, detected);
    return [...detected].sort();
}

function pythonScipCommandSpec() {
    const binary = envOverride("HEX_GRAPH_SCIP_PYTHON_BINARY", "SCIP_PYTHON_BINARY") || "scip-python";
    const extension = extname(binary).toLowerCase();
    if (extension === ".js" || extension === ".cjs" || extension === ".mjs") {
        return {
            command: process.execPath,
            argsPrefix: [binary],
            effective: binary,
        };
    }
    return {
        command: binary,
        argsPrefix: [],
        effective: binary,
    };
}

function phpScipCommandSpec(projectPath) {
    const override = envOverride("HEX_GRAPH_SCIP_PHP_BINARY", "SCIP_PHP_BINARY");
    if (override) {
        const extension = extname(override).toLowerCase();
        const scriptSibling = extension === ".bat" || extension === ".cmd"
            ? override.replace(/\.(bat|cmd)$/i, "")
            : null;
        if (scriptSibling && existsSync(scriptSibling)) {
            return {
                command: "php",
                argsPrefix: [scriptSibling],
                effective: scriptSibling,
            };
        }
        if (extension === ".cmd" || extension === ".bat" || (!override.includes("/") && !override.includes("\\"))) {
            return {
                command: override,
                argsPrefix: [],
                effective: override,
            };
        }
        return {
            command: "php",
            argsPrefix: [override],
            effective: override,
        };
    }
    const localCandidates = [
        join(projectPath, "vendor", "bin", "scip-php"),
        join(projectPath, "vendor", "bin", "scip-php.bat"),
        join(projectPath, "vendor", "bin", "scip-php.cmd"),
    ];
    const binary = localCandidates.find(candidate => existsSync(candidate)) || "scip-php";
    const extension = extname(binary).toLowerCase();
    if (extension === ".cmd" || extension === ".bat" || (!binary.includes("/") && !binary.includes("\\"))) {
        return {
            command: binary,
            argsPrefix: [],
            effective: binary,
        };
    }
    return {
        command: "php",
        argsPrefix: [binary],
        effective: binary,
    };
}

function phpScipInstall(runtime) {
    if (!runtime.composer.ok) return null;
    return {
        steps: [
            {
                command: "composer",
                args: ["global", "config", "repositories.levnikolaevich-scip-php", "vcs", "https://github.com/levnikolaevich/scip-php"],
                label: "composer global config repositories.levnikolaevich-scip-php vcs https://github.com/levnikolaevich/scip-php",
            },
            {
                command: "composer",
                args: ["global", "require", "davidrjenni/scip-php:dev-fix/windows-runtime-fixes", "--prefer-source"],
                label: "composer global require davidrjenni/scip-php:dev-fix/windows-runtime-fixes --prefer-source",
            },
        ],
    };
}

function basedpyrightInstall(runtime) {
    if (runtime.uv.ok) {
        return {
            command: "uv",
            args: ["tool", "install", "basedpyright"],
            label: "uv tool install basedpyright",
        };
    }
    if (runtime.python.ok) {
        return {
            command: "python",
            args: ["-m", "pip", "install", "basedpyright"],
            label: "python -m pip install basedpyright",
        };
    }
    if (runtime.py.ok) {
        return {
            command: "py",
            args: ["-m", "pip", "install", "basedpyright"],
            label: "py -m pip install basedpyright",
        };
    }
    return null;
}

function providerCatalog(runtime, includeOptionalScip, projectPath) {
    const pythonScip = pythonScipCommandSpec();
    const phpScip = phpScipCommandSpec(projectPath);
    const items = [
        {
            id: "basedpyright",
            language: "python",
            capability: "precise_python",
            check: { command: "basedpyright-langserver", args: ["--version"], label: "basedpyright-langserver --version" },
            install: basedpyrightInstall(runtime),
            docs_url: "https://docs.basedpyright.com/dev/installation/command-line-and-language-server/",
            env_var: "HEX_GRAPH_PRECISE_PY_COMMAND",
            fix_hint: "Install basedpyright into the Python environment used by the project, then rerun index_project.",
        },
        {
            id: "csharp-ls",
            language: "csharp",
            capability: "precise_csharp",
            check: { command: "csharp-ls", args: ["--version"], label: "csharp-ls --version" },
            install: runtime.dotnet.ok ? {
                command: "dotnet",
                args: ["tool", "install", "-g", "csharp-ls"],
                label: "dotnet tool install -g csharp-ls",
            } : null,
            docs_url: "https://github.com/razzmatazz/csharp-language-server#readme",
            env_var: "HEX_GRAPH_PRECISE_CS_COMMAND",
            fix_hint: "Install csharp-ls into the .NET toolchain used by the project, then rerun index_project.",
        },
        {
            id: "phpactor",
            language: "php",
            capability: "precise_php",
            check: { command: "phpactor", args: ["--version"], label: "phpactor --version" },
            install: process.platform === "win32"
                ? null
                : runtime.composer.ok
                    ? {
                        command: "composer",
                        args: ["global", "require", "phpactor/phpactor"],
                        label: "composer global require phpactor/phpactor",
                    }
                    : null,
            docs_url: "https://github.com/phpactor/phpactor",
            env_var: "HEX_GRAPH_PRECISE_PHP_COMMAND",
            fix_hint: process.platform === "win32"
                ? "Phpactor officially targets Linux/macOS. Use WSL or provide a custom command via HEX_GRAPH_PRECISE_PHP_COMMAND."
                : "Install phpactor and ensure the Composer global bin directory is on PATH, then rerun index_project.",
        },
    ];

    if (includeOptionalScip) {
        items.push(
            {
                id: "scip-python",
                language: "python",
                capability: "scip_export_python",
                check: { command: pythonScip.command, args: [...pythonScip.argsPrefix, "index", "--help"], label: commandLabel(pythonScip.command, [...pythonScip.argsPrefix, "index", "--help"]) },
                install: runtime.npm.ok
                    ? {
                        command: "npm",
                        args: ["install", "-g", process.platform === "win32" ? "github:levnikolaevich/scip-python#fix/windows-path-sep-regex" : "@sourcegraph/scip-python"],
                        label: process.platform === "win32"
                            ? "npm install -g github:levnikolaevich/scip-python#fix/windows-path-sep-regex"
                            : "npm install -g @sourcegraph/scip-python",
                    }
                    : null,
                docs_url: "https://github.com/sourcegraph/scip-python",
                env_var: "HEX_GRAPH_SCIP_PYTHON_BINARY",
                fix_hint: process.platform === "win32"
                    ? "Use the patched Windows build until sourcegraph/scip-python ships a release with the upstream fix from issue #210 / PR #211."
                    : "Install scip-python globally and ensure it is on PATH before running export_scip.",
            },
            {
                id: "scip-dotnet",
                language: "csharp",
                capability: "scip_export_csharp",
                check: { command: "scip-dotnet", args: ["--help"], label: "scip-dotnet --help" },
                install: runtime.dotnet.ok
                    ? {
                        command: "dotnet",
                        args: ["tool", "install", "-g", "scip-dotnet"],
                        label: "dotnet tool install -g scip-dotnet",
                    }
                    : null,
                docs_url: "https://github.com/sourcegraph/scip-dotnet",
                env_var: null,
                fix_hint: "Install scip-dotnet and rerun export_scip for C# projects.",
            },
            {
                id: "scip-php",
                language: "php",
                capability: "scip_export_php",
                check: { command: phpScip.command, args: [...phpScip.argsPrefix, "--help"], label: commandLabel(phpScip.command, [...phpScip.argsPrefix, "--help"]) },
                install: phpScipInstall(runtime),
                docs_url: "https://github.com/levnikolaevich/scip-php",
                env_var: "HEX_GRAPH_SCIP_PHP_BINARY",
                fix_hint: "Install the patched scip-php fork globally, then rerun export_scip. Project-local `composer require --dev davidrjenni/scip-php` is still fine when it works, but real Laravel projects may need the isolated fork install path.",
            },
        );
    }

    return items;
}

function checkItem(item, cwd) {
    const probe = commandSucceeded(item.check.command, item.check.args, cwd);
    return {
        ...item,
        status: probe.ok ? "ok" : "missing",
        message: probe.ok
            ? `${item.id} is available for ${item.language}.`
            : `${item.id} is missing for ${item.language}. ${item.fix_hint}`,
        detail: probe.error ? String(probe.error.message || probe.error) : null,
    };
}

function fixInstruction(item) {
    if (item.status === "ok" || item.status === "installed") {
        return `${item.id}: OK`;
    }
    const installCommand = installLabels(item.install);
    const envNote = item.env_var ? ` If the binary lives outside PATH, set ${item.env_var}.` : "";
    return installCommand.length
        ? `${item.id}: run ${installCommand.map(label => `\`${label}\``).join(", then ")}. ${item.fix_hint}${envNote}`.trim()
        : `${item.id}: ${item.fix_hint}${envNote}`.trim();
}

export function planGraphProviders({
    path: projectPath,
    includeOptionalScip = true,
    detectedLanguages,
    runtime,
} = {}) {
    const absoluteProjectPath = resolve(projectPath);
    const detected_languages = detectedLanguages || detectProjectLanguages(absoluteProjectPath);
    const activeRuntime = runtime || runtimeChecks();
    const catalog = providerCatalog(activeRuntime, includeOptionalScip, absoluteProjectPath)
        .filter(item => detected_languages.includes(item.language));
    const items = catalog.map(item => checkItem(item, absoluteProjectPath));
    const notes = [];
    if (detected_languages.some(language => language === "javascript" || language === "typescript")) {
        notes.push("JavaScript/TypeScript detected: no extra graph providers are required for precise analysis or SCIP export.");
    }
    return {
        path: absoluteProjectPath,
        detected_languages,
        include_optional_scip: includeOptionalScip,
        runtime: runtimeSnapshot(activeRuntime),
        items,
        notes,
        problems: items.filter(item => item.status !== "ok" && item.status !== "installed"),
        instructions_for_agent: [
            ...notes,
            ...items.map(fixInstruction),
        ],
    };
}

export function installGraphProviders({
    path: projectPath,
    mode = "check",
    includeOptionalScip = true,
    detectedLanguages,
    runtime,
} = {}) {
    const plan = planGraphProviders({ path: projectPath, includeOptionalScip, detectedLanguages, runtime });
    if (mode !== "install") {
        return {
            ...plan,
            mode,
            summary: {
                all_ok: plan.problems.length === 0,
                missing_count: plan.problems.length,
                installed_count: 0,
            },
        };
    }

    const items = plan.items.map(item => ({ ...item }));
    let installedCount = 0;
    for (const item of items) {
        if (item.status === "ok") continue;
        if (!item.install) {
            item.status = "warn";
            item.message = `${item.id} is missing and cannot be auto-installed in this environment. ${item.fix_hint}`;
            continue;
        }
        try {
            const steps = Array.isArray(item.install.steps) ? item.install.steps : [item.install];
            for (const step of steps) {
                installCommand(step.command, step.args, plan.path);
            }
            const rechecked = checkItem(item, plan.path);
            if (rechecked.status === "ok") {
                item.status = "installed";
                item.message = `${item.id} was installed successfully.`;
                installedCount++;
            } else {
                item.status = "warn";
                item.message = `${item.id} install command ran but the tool is still not available. ${item.fix_hint}`;
            }
        } catch (error) {
            item.status = "warn";
            item.message = `${item.id} install failed. ${item.fix_hint}`;
            item.detail = String(error?.message || error);
        }
    }
    const problems = items.filter(item => item.status !== "ok" && item.status !== "installed");
    return {
        ...plan,
        mode,
        items,
        problems,
        instructions_for_agent: [
            ...plan.notes,
            ...items.map(fixInstruction),
        ],
        summary: {
            all_ok: problems.length === 0,
            missing_count: problems.length,
            installed_count: installedCount,
        },
    };
}
