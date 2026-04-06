import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const artifactDir = resolve(packageRoot, "artifacts", "tree-sitter");
const TREE_SITTER_CLI_VERSION = "0.26.8";

const GRAMMARS = [
    { grammar: "javascript", packageName: "tree-sitter-javascript", packageVersion: "0.25.0", outputFile: "tree-sitter-javascript.wasm" },
    { grammar: "typescript", packageName: "tree-sitter-typescript", packageVersion: "0.23.2", sourceSubdir: "typescript", outputFile: "tree-sitter-typescript.wasm" },
    { grammar: "tsx", packageName: "tree-sitter-typescript", packageVersion: "0.23.2", sourceSubdir: "tsx", outputFile: "tree-sitter-tsx.wasm" },
    { grammar: "python", packageName: "tree-sitter-python", packageVersion: "0.25.0", outputFile: "tree-sitter-python.wasm" },
    { grammar: "c_sharp", packageName: "tree-sitter-c-sharp", packageVersion: "0.23.1", outputFile: "tree-sitter-c_sharp.wasm" },
    { grammar: "php", packageName: "tree-sitter-php", packageVersion: "0.24.2", sourceSubdir: "php", outputFile: "tree-sitter-php.wasm" },
];

function npmRunner() {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) {
        throw new Error("npm_execpath is not available. Run this builder via npm so installs remain cross-platform and deterministic.");
    }
    return { command: process.execPath, args: [npmCli] };
}

function treeSitterCliEntrypoint(tempRoot) {
    return resolve(tempRoot, "node_modules", "tree-sitter-cli", "cli.js");
}

function sha256(filePath) {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function installBuilderWorkspace(entry) {
    const tempRoot = mkdtempSync(join(tmpdir(), "hex-tree-sitter-build-"));
    writeFileSync(resolve(tempRoot, "package.json"), JSON.stringify({
        name: "hex-tree-sitter-build",
        private: true,
        type: "module",
    }, null, 2));
    const npm = npmRunner();
    const install = spawnSync(npm.command, [
        ...npm.args,
        "install",
        "--no-save",
        `tree-sitter-cli@${TREE_SITTER_CLI_VERSION}`,
        `${entry.packageName}@${entry.packageVersion}`,
    ], {
        cwd: tempRoot,
        stdio: "pipe",
        encoding: "utf8",
    });
    if (install.status !== 0) {
        throw new Error(
            `npm install failed for ${entry.packageName}@${entry.packageVersion}\n` +
            `error:\n${install.error?.message || ""}\n` +
            `stdout:\n${install.stdout || ""}\n` +
            `stderr:\n${install.stderr || ""}`
        );
    }
    return tempRoot;
}

function resolveGrammarPackage(tempRoot, entry) {
    const packageRootDir = resolve(tempRoot, "node_modules", entry.packageName);
    const packageJson = JSON.parse(readFileSync(resolve(packageRootDir, "package.json"), "utf8"));
    return {
        version: packageJson.version,
        sourceDir: entry.sourceSubdir ? resolve(packageRootDir, entry.sourceSubdir) : packageRootDir,
    };
}

function runTreeSitterBuild(tempRoot, sourceDir, outputPath) {
    const cli = treeSitterCliEntrypoint(tempRoot);
    const result = spawnSync(process.execPath, [cli, "build", "--wasm", "-o", outputPath, sourceDir], {
        cwd: tempRoot,
        stdio: "pipe",
        encoding: "utf8",
    });
    if (result.status !== 0) {
        throw new Error(
            `tree-sitter build failed for ${sourceDir}\n` +
            `error:\n${result.error?.message || ""}\n` +
            `stdout:\n${result.stdout || ""}\n` +
            `stderr:\n${result.stderr || ""}`
        );
    }
}

mkdirSync(artifactDir, { recursive: true });
for (const file of readdirSync(artifactDir)) {
    if (extname(file) === ".wasm") {
        rmSync(join(artifactDir, file), { force: true });
    }
}

const manifest = {
    generated_from: {
        source: "tree-sitter-cli-build",
        tree_sitter_cli_version: TREE_SITTER_CLI_VERSION,
        note: "Repo-owned grammar WASM artifacts built from pinned npm grammar packages with the current tree-sitter CLI.",
    },
    grammars: [],
};

for (const entry of GRAMMARS) {
    const tempRoot = installBuilderWorkspace(entry);
    try {
        const resolvedGrammar = resolveGrammarPackage(tempRoot, entry);
        const outputPath = resolve(artifactDir, entry.outputFile);
        runTreeSitterBuild(tempRoot, resolvedGrammar.sourceDir, outputPath);
        manifest.grammars.push({
            grammar: entry.grammar,
            file: entry.outputFile,
            package: entry.packageName,
            version: resolvedGrammar.version,
            source_subdir: entry.sourceSubdir || null,
            sha256: sha256(outputPath),
        });
        console.log(`Built ${entry.grammar} -> ${entry.outputFile}`);
    } finally {
        rmSync(tempRoot, { recursive: true, force: true });
    }
}

writeFileSync(resolve(artifactDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Wrote ${manifest.grammars.length} tree-sitter grammar artifacts to ${artifactDir}`);
