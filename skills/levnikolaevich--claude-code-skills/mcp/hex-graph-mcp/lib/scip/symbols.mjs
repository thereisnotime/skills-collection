import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { Descriptor_Suffix, SymbolInformation_Kind } from "./vendor/scip_pb.js";
import { normalizePath } from "./project.mjs";
import { scipLanguageForFile } from "./languages.mjs";

function escapeSpaceComponent(value) {
    const normalized = String(value || ".").replace(/ /g, "  ");
    return normalized.length > 0 ? normalized : ".";
}

function isSimpleIdentifier(value) {
    return /^[A-Za-z0-9_+$-]+$/.test(value);
}

function escapeIdentifier(value) {
    const normalized = String(value || "_");
    if (isSimpleIdentifier(normalized)) return normalized;
    return `\`${normalized.replace(/`/g, "``")}\``;
}

function descriptorToString(descriptor) {
    const name = escapeIdentifier(descriptor.name);
    switch (descriptor.suffix) {
    case Descriptor_Suffix.Namespace:
        return `${name}/`;
    case Descriptor_Suffix.Type:
        return `${name}#`;
    case Descriptor_Suffix.Term:
        return `${name}.`;
    case Descriptor_Suffix.Method:
        return `${name}(${descriptor.disambiguator || ""}).`;
    case Descriptor_Suffix.TypeParameter:
        return `[${name}]`;
    case Descriptor_Suffix.Parameter:
        return `(${name})`;
    case Descriptor_Suffix.Meta:
        return `${name}:`;
    case Descriptor_Suffix.Macro:
        return `${name}!`;
    default:
        return `${name}.`;
    }
}

export function buildScipSymbolString({ scheme = "scip-typescript", packageIdentity, descriptors }) {
    const packageString = [
        escapeSpaceComponent(packageIdentity?.manager || "."),
        escapeSpaceComponent(packageIdentity?.name || "."),
        escapeSpaceComponent(packageIdentity?.version || "."),
    ].join(" ");
    return `${escapeSpaceComponent(scheme)} ${packageString} ${descriptors.map(descriptorToString).join("")}`;
}

function detectPackageManager(rootDir, packageJson = null) {
    const packageManager = typeof packageJson?.packageManager === "string"
        ? packageJson.packageManager.split("@")[0]
        : null;
    if (packageManager) return packageManager;
    if (existsSync(join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(rootDir, "yarn.lock"))) return "yarn";
    if (existsSync(join(rootDir, "bun.lock")) || existsSync(join(rootDir, "bun.lockb"))) return "bun";
    if (existsSync(join(rootDir, "package-lock.json"))) return "npm";
    return "npm";
}

function readPackageJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return null;
    }
}

export function inferPackageIdentity(projectPath, filePath, cache = new Map()) {
    const absoluteFile = resolve(projectPath, filePath);
    let current = dirname(absoluteFile);
    while (current.startsWith(projectPath)) {
        const cached = cache.get(current);
        if (cached) return cached;
        const packageJsonPath = join(current, "package.json");
        if (existsSync(packageJsonPath)) {
            const packageJson = readPackageJson(packageJsonPath);
            const identity = {
                manager: detectPackageManager(current, packageJson),
                name: typeof packageJson?.name === "string" && packageJson.name.length > 0 ? packageJson.name : ".",
                version: typeof packageJson?.version === "string" && packageJson.version.length > 0 ? packageJson.version : "HEAD",
                rootDir: current,
            };
            cache.set(current, identity);
            return identity;
        }
        if (current === projectPath) break;
        current = dirname(current);
    }
    const fallback = {
        manager: detectPackageManager(projectPath),
        name: ".",
        version: "HEAD",
        rootDir: projectPath,
    };
    cache.set(projectPath, fallback);
    return fallback;
}

function fileNamespaceDescriptors(projectPath, node, packageRootDir) {
    const absoluteFile = resolve(projectPath, node.file);
    const relativeToPackage = normalizePath(relative(packageRootDir, absoluteFile));
    const directory = dirname(relativeToPackage);
    const descriptors = [];
    if (directory && directory !== ".") {
        for (const segment of directory.split("/").filter(Boolean)) {
            descriptors.push({ name: segment, suffix: Descriptor_Suffix.Namespace, disambiguator: "" });
        }
    }
    descriptors.push({
        name: basename(relativeToPackage, extname(relativeToPackage)),
        suffix: Descriptor_Suffix.Namespace,
        disambiguator: "",
    });
    return descriptors;
}

function ancestryDescriptors(store, node) {
    const ancestors = [];
    let current = node.parent_id ? store.getNodeById(node.parent_id) : null;
    while (current) {
        ancestors.unshift(current);
        current = current.parent_id ? store.getNodeById(current.parent_id) : null;
    }
    return ancestors.map((ancestor) => {
        if (ancestor.kind === "class" || ancestor.kind === "interface") {
            return { name: ancestor.name, suffix: Descriptor_Suffix.Type, disambiguator: "" };
        }
        if (ancestor.kind === "function" || ancestor.kind === "method") {
            return { name: ancestor.name, suffix: Descriptor_Suffix.Meta, disambiguator: "" };
        }
        return { name: ancestor.name, suffix: Descriptor_Suffix.Namespace, disambiguator: "" };
    });
}

function terminalDescriptor(node) {
    if (node.kind === "class" || node.kind === "interface") {
        return { name: node.name, suffix: Descriptor_Suffix.Type, disambiguator: "" };
    }
    if (node.kind === "method") {
        return { name: node.name, suffix: Descriptor_Suffix.Method, disambiguator: "" };
    }
    return { name: node.name, suffix: Descriptor_Suffix.Term, disambiguator: "" };
}

export function buildScipSymbolForNode(store, node, { projectPath, packageCache = new Map(), scheme = "scip-typescript" } = {}) {
    const packageIdentity = inferPackageIdentity(projectPath, node.file, packageCache);
    const descriptors = [
        ...fileNamespaceDescriptors(projectPath, node, packageIdentity.rootDir),
        ...ancestryDescriptors(store, node),
        terminalDescriptor(node),
    ];
    return {
        symbol: buildScipSymbolString({ scheme, packageIdentity, descriptors }),
        package: packageIdentity,
        descriptors,
    };
}

export function symbolKindForNode(node) {
    switch (node.kind) {
    case "class":
        return SymbolInformation_Kind.Class;
    case "interface":
        return SymbolInformation_Kind.Interface;
    case "method":
        return SymbolInformation_Kind.Method;
    case "variable":
        return SymbolInformation_Kind.Variable;
    case "function":
    default:
        return SymbolInformation_Kind.Function;
    }
}

export function languageIdForFile(filePath) {
    return scipLanguageForFile(filePath);
}
