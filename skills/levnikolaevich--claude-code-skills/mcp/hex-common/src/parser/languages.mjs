const EXTENSION_GRAMMARS = {
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".py": "python",
    ".cs": "c_sharp",
    ".php": "php",
};

export function grammarForExtension(ext) {
    return EXTENSION_GRAMMARS[ext.toLowerCase()] || null;
}

export function languageForExtension(ext) {
    const grammar = grammarForExtension(ext);
    if (!grammar) return null;
    if (grammar === "tsx" || grammar === "typescript") return "typescript";
    if (grammar === "javascript") return "javascript";
    if (grammar === "c_sharp") return "csharp";
    return grammar;
}

export function supportedExtensions() {
    return Object.keys(EXTENSION_GRAMMARS);
}

export function isSupportedExtension(ext) {
    return Object.hasOwn(EXTENSION_GRAMMARS, ext.toLowerCase());
}
