const EXTENSION_GRAMMARS = {
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cs": "c_sharp",
    ".rb": "ruby",
    ".php": "php",
    ".kt": "kotlin",
    ".swift": "swift",
    ".sh": "bash",
    ".bash": "bash"
};

export function grammarForExtension(ext) {
    return EXTENSION_GRAMMARS[ext.toLowerCase()] || null;
}

export function supportedExtensions() {
    return Object.keys(EXTENSION_GRAMMARS);
}

export function isSupportedExtension(ext) {
    return Object.hasOwn(EXTENSION_GRAMMARS, ext.toLowerCase());
}
