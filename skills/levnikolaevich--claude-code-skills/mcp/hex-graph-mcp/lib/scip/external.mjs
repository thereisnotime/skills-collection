import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fromBinary } from "@bufbuild/protobuf";

import { IndexSchema } from "./vendor/scip_pb.js";
import { getPackageInfo } from "../package-info.mjs";
import { normalizePath } from "./project.mjs";
import { normalizeScipLanguage } from "./languages.mjs";

const packageJson = getPackageInfo();

function runCommand(command, args, { cwd, env } = {}) {
    const extension = extname(command).toLowerCase();
    const shellRequired = process.platform === "win32"
        && command !== process.execPath
        && (!extension || extension === ".cmd" || extension === ".bat");
    const result = shellRequired
        ? spawnSync(process.env.ComSpec || "cmd.exe", [
            "/d",
            "/s",
            "/c",
            [command, ...(args || [])].map(value => {
                const text = String(value ?? "");
                if (!/[ \t"&()^%!]/.test(text)) {
                    return text;
                }
                return `"${text.replace(/"/g, "\"\"")}"`;
            }).join(" "),
        ], {
            cwd,
            env: { ...process.env, ...env },
            encoding: "utf8",
            shell: false,
            windowsHide: true,
        })
        : spawnSync(command, args, {
            cwd,
            env: { ...process.env, ...env },
            encoding: "utf8",
            shell: false,
            windowsHide: true,
        });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        throw new Error(detail || `${command} exited with status ${result.status}`);
    }
    return result;
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

function commandNotFound(error) {
    return error?.code === "ENOENT" || /not recognized|not found|cannot find/i.test(error?.message || "");
}

function createIndexCommandError(binary, installHint, detail) {
    const suffix = detail ? ` ${detail}` : "";
    return new Error(`${binary} is required for this SCIP export lane but is not available.${suffix} Ask a human to install ${installHint} and rerun export_scip.`);
}

function pythonBinary() {
    return envOverride("HEX_GRAPH_SCIP_PYTHON_BINARY", "SCIP_PYTHON_BINARY") || "scip-python";
}

function pythonCommandSpec() {
    const binary = pythonBinary();
    const extension = extname(binary).toLowerCase();
    if (extension === ".js" || extension === ".cjs" || extension === ".mjs") {
        return {
            command: process.execPath,
            prefixArgs: [binary],
            displayBinary: binary,
        };
    }
    return {
        command: binary,
        prefixArgs: [],
        displayBinary: binary,
    };
}

function pythonInstallHint() {
    if (process.platform === "win32") {
        return "a working scip-python binary. Until sourcegraph/scip-python ships a Windows fix, prefer `npm install -g github:levnikolaevich/scip-python#fix/windows-path-sep-regex` or set HEX_GRAPH_SCIP_PYTHON_BINARY to a patched binary";
    }
    return "@sourcegraph/scip-python";
}

function isKnownWindowsScipPythonCrash(error) {
    const message = String(error?.message || "");
    return process.platform === "win32"
        && /Invalid regular expression/i.test(message)
        && /path\.sep|PythonEnvironment|\\\/g/.test(message);
}

function createWindowsScipPythonError(error) {
    const detail = String(error?.message || "").trim();
    return new Error(
        "The upstream scip-python package currently crashes on Windows before indexing starts. "
        + "Install the patched binary via `npm install -g github:levnikolaevich/scip-python#fix/windows-path-sep-regex` "
        + "or point HEX_GRAPH_SCIP_PYTHON_BINARY to a patched scip-python executable, then rerun export_scip."
        + (detail ? ` Original error: ${detail}` : ""),
    );
}

function parseTomlStringField(source, sectionNames, fieldName) {
    let inSection = false;
    for (const rawLine of source.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const sectionMatch = line.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            inSection = sectionNames.includes(sectionMatch[1].trim());
            continue;
        }
        if (!inSection) continue;
        const fieldMatch = line.match(new RegExp(`^${fieldName}\\s*=\\s*["']([^"']+)["']`));
        if (fieldMatch) {
            return fieldMatch[1];
        }
    }
    return null;
}

function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return null;
    }
}

function readText(path) {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return null;
    }
}

function hasProjectFile(projectPath, matcher) {
    const stack = [projectPath];
    while (stack.length) {
        const current = stack.pop();
        const entries = readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "vendor" || entry.name === ".hex-skills") {
                continue;
            }
            const fullPath = join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (matcher(entry.name, fullPath)) return true;
        }
    }
    return false;
}

function inferPythonProjectName(projectPath) {
    const pyprojectPath = join(projectPath, "pyproject.toml");
    const pyproject = readText(pyprojectPath);
    if (pyproject) {
        const projectName = parseTomlStringField(pyproject, ["project"], "name")
            || parseTomlStringField(pyproject, ["tool.poetry"], "name");
        if (projectName) return projectName;
    }
    const setupCfg = readText(join(projectPath, "setup.cfg"));
    if (setupCfg) {
        const setupCfgName = parseTomlStringField(setupCfg, ["metadata"], "name");
        if (setupCfgName) return setupCfgName;
    }
    const packageJsonValue = readJson(join(projectPath, "package.json"));
    if (typeof packageJsonValue?.name === "string" && packageJsonValue.name.trim()) {
        return packageJsonValue.name.trim();
    }
    return basename(projectPath);
}

function inferPythonVersion(projectPath) {
    const pyprojectPath = join(projectPath, "pyproject.toml");
    const pyproject = readText(pyprojectPath);
    if (pyproject) {
        const projectVersion = parseTomlStringField(pyproject, ["project"], "version")
            || parseTomlStringField(pyproject, ["tool.poetry"], "version");
        if (projectVersion) return projectVersion;
    }
    return "HEAD";
}

function inferPhpPackage(projectPath) {
    const composer = readJson(join(projectPath, "composer.json"));
    if (!composer) return null;
    return {
        manager: "composer",
        name: typeof composer.name === "string" && composer.name.trim() ? composer.name.trim() : ".",
        version: typeof composer.version === "string" && composer.version.trim() ? composer.version.trim() : "HEAD",
    };
}

function phpBinaryOverride() {
    return envOverride("HEX_GRAPH_SCIP_PHP_BINARY", "SCIP_PHP_BINARY");
}

function phpCommandSpec(projectPath) {
    const binary = resolvePhpBinary(projectPath);
    if (!binary) return null;
    const extension = extname(binary).toLowerCase();
    const scriptSibling = extension === ".bat" || extension === ".cmd"
        ? binary.replace(/\.(bat|cmd)$/i, "")
        : null;
    if (scriptSibling && existsSync(scriptSibling)) {
        return {
            command: "php",
            prefixArgs: [scriptSibling],
            displayBinary: scriptSibling,
        };
    }
    if (extension === ".cmd" || extension === ".bat" || (!binary.includes("/") && !binary.includes("\\"))) {
        return {
            command: binary,
            prefixArgs: [],
            displayBinary: binary,
        };
    }
    return {
        command: "php",
        prefixArgs: [binary],
        displayBinary: binary,
    };
}

function buildExportSummary(absoluteArtifactPath, packageInfo, backend) {
    const artifact = fromBinary(IndexSchema, readFileSync(absoluteArtifactPath));
    const languages = [...new Set((artifact.documents || [])
        .map(document => normalizeScipLanguage(document.language))
        .filter(Boolean))];
    return {
        artifact_path: absoluteArtifactPath,
        backend,
        document_count: (artifact.documents || []).length,
        occurrence_count: (artifact.documents || []).reduce((total, document) => total + (document.occurrences || []).length, 0),
        symbol_count: (artifact.documents || []).reduce((total, document) => total + (document.symbols || []).length, 0),
        external_symbol_count: (artifact.externalSymbols || []).length,
        package: packageInfo,
        artifact_languages: languages,
    };
}

function finalizeArtifact(projectPath, outputPath, packageInfo, backend) {
    const absoluteProjectPath = resolve(projectPath);
    const absoluteOutputPath = resolve(absoluteProjectPath, outputPath);
    const defaultArtifactPath = join(absoluteProjectPath, "index.scip");
    if (!existsSync(defaultArtifactPath)) {
        throw new Error(`Expected external indexer to write index.scip at ${defaultArtifactPath}, but no artifact was produced.`);
    }
    mkdirSync(dirname(absoluteOutputPath), { recursive: true });
    copyFileSync(defaultArtifactPath, absoluteOutputPath);
    if (normalizePath(defaultArtifactPath) !== normalizePath(absoluteOutputPath)) {
        rmSync(defaultArtifactPath, { force: true });
    }
    return buildExportSummary(absoluteOutputPath, packageInfo, backend);
}

function resolvePhpBinary(projectPath) {
    const override = phpBinaryOverride();
    if (override) return override;
    const candidates = [
        join(projectPath, "vendor", "bin", "scip-php"),
        join(projectPath, "vendor", "bin", "scip-php.bat"),
        join(projectPath, "vendor", "bin", "scip-php.cmd"),
    ];
    return candidates.find(candidate => existsSync(candidate)) || "scip-php";
}

function exportPythonScip(projectPath, outputPath, options = {}) {
    if (!hasProjectFile(projectPath, name => name.endsWith(".py"))) {
        throw new Error("No Python source files found under the requested project root.");
    }
    const projectName = options.projectName || inferPythonProjectName(projectPath);
    if (!projectName) {
        throw new Error("Python SCIP export requires project_name. Provide it explicitly or add it to pyproject.toml / setup.cfg.");
    }
    const args = ["index", ".", `--project-name=${projectName}`];
    if (options.projectNamespace) args.push(`--project-namespace=${options.projectNamespace}`);
    if (options.targetOnly) args.push(`--target-only=${options.targetOnly}`);
    if (options.environmentPath) args.push(`--environment=${options.environmentPath}`);
    const commandSpec = pythonCommandSpec();
    try {
        runCommand(commandSpec.command, [...commandSpec.prefixArgs, ...args], { cwd: projectPath });
    } catch (error) {
        if (isKnownWindowsScipPythonCrash(error)) {
            throw createWindowsScipPythonError(error);
        }
        if (commandNotFound(error)) {
            throw createIndexCommandError(commandSpec.displayBinary, pythonInstallHint());
        }
        throw error;
    }
    return finalizeArtifact(projectPath, outputPath, {
        manager: "pip",
        name: projectName,
        version: inferPythonVersion(projectPath),
    }, "scip-python");
}

function exportCSharpScip(projectPath, outputPath, options = {}) {
    if (!hasProjectFile(projectPath, name => name.endsWith(".sln") || name.endsWith(".csproj"))) {
        throw new Error("C# SCIP export requires a .sln or .csproj under the requested project root.");
    }
    const args = ["index"];
    if (options.workingDirectory) {
        args.push("--working-directory", options.workingDirectory);
    }
    try {
        runCommand("scip-dotnet", args, { cwd: projectPath });
    } catch (error) {
        if (commandNotFound(error)) {
            throw createIndexCommandError("scip-dotnet", "scip-dotnet");
        }
        throw error;
    }
    return finalizeArtifact(projectPath, outputPath, null, "scip-dotnet");
}

function exportPhpScip(projectPath, outputPath) {
    const composerJsonPath = join(projectPath, "composer.json");
    const composerLockPath = join(projectPath, "composer.lock");
    const autoloadPath = join(projectPath, "vendor", "autoload.php");
    if (!existsSync(composerJsonPath) || !existsSync(composerLockPath)) {
        throw new Error("PHP SCIP export requires composer.json and composer.lock in the selected project root.");
    }
    if (!existsSync(autoloadPath)) {
        throw new Error("PHP SCIP export requires an installed Composer autoloader at vendor/autoload.php.");
    }
    const commandSpec = phpCommandSpec(projectPath);
    if (!commandSpec) {
        throw new Error("PHP SCIP export requires scip-php. Prefer the isolated fork install path via `composer global config repositories.levnikolaevich-scip-php vcs https://github.com/levnikolaevich/scip-php` followed by `composer global require davidrjenni/scip-php:dev-fix/windows-runtime-fixes --prefer-source`, or set HEX_GRAPH_SCIP_PHP_BINARY.");
    }
    try {
        runCommand(commandSpec.command, commandSpec.prefixArgs, { cwd: projectPath });
    } catch (error) {
        if (commandNotFound(error)) {
            throw createIndexCommandError(commandSpec.displayBinary, "`composer global config repositories.levnikolaevich-scip-php vcs https://github.com/levnikolaevich/scip-php` plus `composer global require davidrjenni/scip-php:dev-fix/windows-runtime-fixes --prefer-source` or HEX_GRAPH_SCIP_PHP_BINARY");
        }
        throw error;
    }
    const summary = finalizeArtifact(projectPath, outputPath, inferPhpPackage(projectPath), "scip-php");
    if (summary.document_count === 0) {
        throw new Error("scip-php completed but produced an empty SCIP artifact. Use the patched fork from https://github.com/levnikolaevich/scip-php or set HEX_GRAPH_SCIP_PHP_BINARY to that binary.");
    }
    return summary;
}

export function buildExternalExportPlan({ language, path: projectPath, outputPath, options = {} }) {
    const absoluteProjectPath = resolve(projectPath);
    const normalizedLanguage = normalizeScipLanguage(language);
    if (normalizedLanguage === "python") {
        return {
            backend: "scip-python",
            binary: pythonBinary(),
            cwd: absoluteProjectPath,
            outputPath: resolve(absoluteProjectPath, outputPath),
            projectName: options.projectName || inferPythonProjectName(absoluteProjectPath),
            args: [
                "index",
                ".",
                `--project-name=${options.projectName || inferPythonProjectName(absoluteProjectPath)}`,
                ...(options.projectNamespace ? [`--project-namespace=${options.projectNamespace}`] : []),
                ...(options.targetOnly ? [`--target-only=${options.targetOnly}`] : []),
                ...(options.environmentPath ? [`--environment=${options.environmentPath}`] : []),
            ],
        };
    }
    if (normalizedLanguage === "csharp") {
        return {
            backend: "scip-dotnet",
            cwd: absoluteProjectPath,
            outputPath: resolve(absoluteProjectPath, outputPath),
            args: [
                "index",
                ...(options.workingDirectory ? ["--working-directory", options.workingDirectory] : []),
            ],
        };
    }
    if (normalizedLanguage === "php") {
        const commandSpec = phpCommandSpec(absoluteProjectPath);
        return {
            backend: "scip-php",
            cwd: absoluteProjectPath,
            outputPath: resolve(absoluteProjectPath, outputPath),
            binary: commandSpec?.displayBinary || null,
            command: commandSpec?.command || null,
            args: commandSpec?.prefixArgs || [],
        };
    }
    throw new Error(`Unsupported external SCIP export language: ${language}`);
}

export async function exportExternalScip({ language, path: projectPath, outputPath, options = {} }) {
    const normalizedLanguage = normalizeScipLanguage(language);
    if (normalizedLanguage === "python") {
        return exportPythonScip(resolve(projectPath), outputPath, options);
    }
    if (normalizedLanguage === "csharp") {
        return exportCSharpScip(resolve(projectPath), outputPath, options);
    }
    if (normalizedLanguage === "php") {
        return exportPhpScip(resolve(projectPath), outputPath, options);
    }
    throw new Error(`Unsupported external SCIP export language: ${language}`);
}

export function exportToolInfo() {
    return {
        name: "hex-graph-mcp",
        version: packageJson.version,
    };
}
