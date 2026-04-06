/**
 * Tree-sitter WASM parser for code knowledge graph.
 *
 * Uses Query API (.scm files) for precise extraction of:
 * - definitions: functions, classes, methods, variables
 * - imports: import statements with source resolution
 * - calls: function/method call expressions
 *
 * Parser + Language instances cached (singleton pattern from hex-line).
 * tree.delete() called after extraction (WASM: no GC, explicit free).
 */

import { readFileSync } from "node:fs";
import { getParser, getLanguage } from "@levnikolaevich/hex-common/parser/tree-sitter";
import { grammarForExtension } from "@levnikolaevich/hex-common/parser/languages";
import {
    BODY_EXTRACTORS, walkLeaves, countStatements,
    normalizeTokens, computeRawHash, computeNormHash,
    ngrams, minhashSignature, lshBands,
} from "./clone-hash.mjs";
import { buildFlowIR } from "./flow.mjs";
import { extname, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// --- Language configs ---

const LANG_CONFIGS = {
    ".js":    { queryFile: "javascript.scm" },
    ".mjs":   { queryFile: "javascript.scm" },
    ".cjs":   { queryFile: "javascript.scm" },
    ".jsx":   { queryFile: "javascript.scm" },
    ".ts":    { queryFile: "typescript.scm" },
    ".tsx":   { queryFile: "typescript.scm" },
    ".py":    { queryFile: "python.scm" },
    ".cs":    { queryFile: "c_sharp.scm" },
    ".php":   { queryFile: "php.scm" },
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(LANG_CONFIGS));

const _queryCache = new Map();

async function getQuery(lang, grammar, queryFile) {
    const key = `${grammar}:${queryFile}`;
    if (_queryCache.has(key)) return _queryCache.get(key);
    const scmPath = join(dirname(fileURLToPath(import.meta.url)), "queries", queryFile);
    const scmSource = readFileSync(scmPath, "utf-8");
    const { Query } = await import("web-tree-sitter");
    const query = new Query(lang, scmSource);
    _queryCache.set(key, query);
    return query;
}

// --- Public API ---

/**
 * Check if file extension is supported.
 * @param {string} ext - e.g. ".js"
 */
export function isSupported(ext) {
    return SUPPORTED_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Get language name for extension.
 * @param {string} ext
 * @returns {string|null}
 */
export function languageFor(ext) {
    return grammarForExtension(ext);
}

/**
 * Get all supported extensions.
 */
export function supportedExtensions() {
    return [...SUPPORTED_EXTENSIONS];
}

/**
 * Compute identity key for a definition.
 * @param {object} def - { name, parent?, line_start }
 * @returns {string}
 */
function defKey(def) {
    return def.parent ? `${def.parent}.${def.name}:${def.line_start}` : `${def.name}:${def.line_start}`;
}

function classifyTypeKind(nodeType) {
    return nodeType.includes("interface") ? "interface" : "class";
}

/**
 * Parse a file and extract symbols and calls.
 *
 * @param {string} filePath - absolute file path
 * @param {string} source - file content
 * @param {{cloneDetection?: boolean}} opts - options (default: {})
 * @returns {Promise<{definitions: Array, imports: Array, calls: Array, references: Array, exports: Set<string>, defaultExport: string|null, reexports: Array, flow_ir: Array}>}
 *
 * definitions: { name, kind, line_start, line_end, parent?, signature?, key, clone_data? }
 * imports:     { name, source, line, kind: "import" }
 * calls:       { name, line, parent? }
 */
export async function parseFile(filePath, source, opts = {}) {
    const ext = extname(filePath).toLowerCase();
    const config = LANG_CONFIGS[ext];
    if (!config) {
        return { definitions: [], imports: [], calls: [], references: [], exports: new Set(), defaultExport: null, reexports: [], flow_ir: [] };
    }

    const grammar = grammarForExtension(ext);
    const lang = await getLanguage(grammar);
    const parser = await getParser();
    parser.setLanguage(lang);

    const tree = parser.parse(source);
    const query = await getQuery(lang, grammar, config.queryFile);
    const captures = query.captures(tree.rootNode);

    const definitions = [];
    const imports = [];
    const calls = [];
    const references = [];

    for (const { name: captureName, node } of captures) {
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const startColumn = node.startPosition.column;
        const endColumn = node.endPosition.column;

        if (captureName === "definition.function") {
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                const def = {
                    name: nameNode.text,
                    kind: "function",
                    line_start: startLine,
                    line_end: endLine,
                    column_start: startColumn,
                    column_end: endColumn,
                    signature: extractSignature(node),
                    _node: node,
                };
                def.key = defKey(def);
                definitions.push(def);
            }
        } else if (captureName === "definition.class") {
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                const def = {
                    name: nameNode.text,
                    kind: classifyTypeKind(node.type),
                    line_start: startLine,
                    line_end: endLine,
                    column_start: startColumn,
                    column_end: endColumn,
                };
                def.key = defKey(def);
                definitions.push(def);
            }
        } else if (captureName === "definition.method") {
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                // Find parent class
                let parentName = null;
                let p = node.parent;
                while (p) {
                    if (/(class|interface|trait|record|struct)/.test(p.type) || p.type === "impl_item") {
                        const pName = p.childForFieldName("name");
                        if (pName) {
                            parentName = pName.text;
                            break;
                        }
                        // class_body or similar wrapper — no name field, keep walking
                    }
                    p = p.parent;
                }
                const def = {
                    name: nameNode.text,
                    kind: "method",
                    line_start: startLine,
                    line_end: endLine,
                    column_start: startColumn,
                    column_end: endColumn,
                    parent: parentName,
                    signature: extractSignature(node),
                    _node: node,
                };
                def.key = defKey(def);
                definitions.push(def);
            }
        } else if (captureName === "definition.variable") {
            // Variable declarations — extract name from declarator
            const text = node.text;
            const nameMatch = text.match(/(?:const|let|var|export\s+(?:const|let|var))\s+(\w+)/);
            if (nameMatch) {
                const def = {
                    name: nameMatch[1],
                    kind: "variable",
                    line_start: startLine,
                    line_end: endLine,
                    column_start: startColumn,
                    column_end: endColumn,
                };
                def.key = defKey(def);
                definitions.push(def);
            }
        } else if (captureName === "import") {
            const imp = extractImport(node, grammar);
            if (imp) {
                imports.push({
                    ...imp,
                    line: startLine,
                    column_start: startColumn,
                    column_end: endColumn,
                });
            }
        } else if (captureName === "call") {
            const call = extractCallDetails(node);
            if (call?.name) {
                calls.push({
                    ...call,
                    line: startLine,
                    column_start: startColumn,
                    column_end: endColumn,
                });
            }
        } else if (captureName === "reference.identifier") {
            if (node.type === "identifier" || node.type === "name") {
                references.push({
                    name: node.text,
                    line: startLine,
                    column_start: startColumn,
                    column_end: endColumn,
                    refKind: "read",
                });
            }
        } else if (captureName === "reference.type") {
            if (node.type === "type_identifier" || node.type === "identifier") {
                references.push({
                    name: node.text,
                    line: startLine,
                    column_start: startColumn,
                    column_end: endColumn,
                    refKind: "type_ref",
                });
            }
        }
    }

    // --- Clone detection (opt-in) ---
    if (opts.cloneDetection) {
        const extractor = BODY_EXTRACTORS.get(grammar);

        for (const def of definitions) {
            if (def.kind !== "function" && def.kind !== "method") continue;
            if (!def._node) continue;

            if (extractor) {
                // Full extraction path (grammar in BODY_EXTRACTORS)
                if (extractor.skipNodes.has(def._node.type)) continue;

                const bodyNode = def._node.childForFieldName(extractor.bodyField);
                if (!bodyNode) continue;

                const stmtCount = countStatements(bodyNode, extractor.stmtTypes);
                if (stmtCount < 3) continue;

                const leaves = walkLeaves(bodyNode);
                const rawHash = computeRawHash(bodyNode.text);
                const normalizedTokens = normalizeTokens(leaves);
                const normHash = computeNormHash(normalizedTokens);
                const tokenStrings = ngrams(normalizedTokens, 5);
                const fingerprint = minhashSignature(tokenStrings, 64);
                const bands = lshBands(fingerprint, 16, 4);

                def.clone_data = {
                    raw_hash: rawHash,
                    norm_hash: normHash,
                    fingerprint,
                    stmt_count: stmtCount,
                    token_count: leaves.length,
                    bands,
                };
            } else {
                // Hashes-only fallback (grammar not in BODY_EXTRACTORS)
                const bodyText = source.split("\n").slice(def.line_start - 1, def.line_end).join("\n");
                const rawHash = computeRawHash(bodyText);

                const rawTokens = bodyText.replace(/\s+/g, " ").trim().split(/\s+/);
                const normalizedTokens = rawTokens.map(t => {
                    if (/^[a-zA-Z_]\w*$/.test(t)) return "$";
                    if (/^["']/.test(t)) return "$S";
                    if (/^\d/.test(t)) return "$N";
                    return t;
                });
                const normHash = computeNormHash(normalizedTokens);

                const stmtCount = (bodyText.match(/[;\n]/g) || []).length;
                if (stmtCount < 3) continue;

                def.clone_data = {
                    raw_hash: rawHash,
                    norm_hash: normHash,
                    fingerprint: null,
                    stmt_count: stmtCount,
                    token_count: normalizedTokens.length,
                    bands: [],
                };
            }
        }
    }

    // Extract ESM exports before tree.delete()
    const { exports: exportSet, defaultExport, reexports } = extractExports(tree, grammar);
    attachTypeMetadata(source, grammar, definitions);

    // Create synthetic node for anonymous default export
    if (defaultExport === "__default_export__") {
        const root = tree.rootNode;
        for (let i = 0; i < root.childCount; i++) {
            const child = root.child(i);
            if (child.type === "export_statement" && child.children.some(c => c.type === "default")) {
                const decl = child.childForFieldName("declaration");
                let kind = "function";
                if (decl) {
                    if (decl.type.includes("class")) kind = "class";
                    else if (decl.type.includes("function") || decl.type === "arrow_function") kind = "function";
                }
                const def = {
                    name: "__default_export__",
                    kind,
                    line_start: child.startPosition.row + 1,
                    line_end: child.endPosition.row + 1,
                    column_start: child.startPosition.column,
                    column_end: child.endPosition.column,
                };
                def.key = defKey(def);
                definitions.push(def);
                break;
            }
        }
    }

    // Clean up tree-sitter node references (can't survive tree.delete())
    for (const def of definitions) {
        delete def._node;
    }

    const flow_ir = buildFlowIR(source, grammar, definitions, calls);

    tree.delete();

    return { definitions, imports, calls, references, exports: exportSet, defaultExport, reexports, flow_ir };
}

// --- Helpers ---

function extractSignature(node) {
    const params = node.childForFieldName("parameters");
    if (params) return params.text;
    return null;
}

function extractCallDetails(node) {
    // call_expression -> function field is the callee
    const fn = node.childForFieldName("function");
    if (!fn) return null;
    const argsNode = node.childForFieldName("arguments");
    const args = argsNode ? extractArgumentTexts(argsNode.text) : [];

    // method call: obj.method(...)
    if (fn.type === "member_expression" || fn.type === "attribute") {
        const prop = fn.childForFieldName("property") || fn.childForFieldName("attribute");
        return {
            name: prop ? prop.text : fn.text,
            call_text: fn.text,
            args,
        };
    }
    // simple call: func(...)
    if (fn.type === "identifier" || fn.type === "name") {
        return {
            name: fn.text,
            call_text: fn.text,
            args,
        };
    }
    return {
        name: fn.text,
        call_text: fn.text,
        args,
    };
}

function extractArgumentTexts(argText) {
    const value = String(argText || "").trim();
    if (!value.startsWith("(") || !value.endsWith(")")) return [];
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    const parts = [];
    let current = "";
    let depthParen = 0;
    let depthBracket = 0;
    let depthBrace = 0;
    let quote = null;
    for (let index = 0; index < inner.length; index++) {
        const ch = inner[index];
        const prev = inner[index - 1];
        if (quote) {
            current += ch;
            if (ch === quote && prev !== "\\") quote = null;
            continue;
        }
        if (ch === "'" || ch === "\"" || ch === "`") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === "(") depthParen++;
        else if (ch === ")") depthParen--;
        else if (ch === "[") depthBracket++;
        else if (ch === "]") depthBracket--;
        else if (ch === "{") depthBrace++;
        else if (ch === "}") depthBrace--;
        if (ch === "," && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
            if (current.trim()) parts.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function attachTypeMetadata(source, grammar, definitions) {
    const lines = source.split("\n");
    for (const def of definitions) {
        if (def.kind !== "class" && def.kind !== "interface") continue;
        const header = collectTypeHeader(lines, def.line_start);
        const supertypes = parseSupertypes(header, grammar, def);
        if (supertypes.length > 0) def.supertypes = supertypes;
    }
}

function collectTypeHeader(lines, lineStart, maxLines = 4) {
    const chunks = [];
    for (let i = 0; i < maxLines; i++) {
        const line = lines[lineStart - 1 + i];
        if (line == null) break;
        chunks.push(line.trim());
        if (/[{:]/.test(line)) break;
    }
    return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function parseSupertypes(header, grammar, def) {
    if (!header) return [];
    const name = escapeRe(def.name);
    if (grammar === "javascript" || grammar === "typescript" || grammar === "tsx") {
        if (def.kind === "interface") {
            const match = header.match(new RegExp(`\\binterface\\s+${name}(?:<[^>]+>)?\\s+extends\\s+([^\\{]+)`));
            return match ? splitTargets(match[1], "extends") : [];
        }
        const match = header.match(new RegExp(`\\bclass\\s+${name}(?:<[^>]+>)?(?:\\s+extends\\s+([^\\{\\s]+))?(?:\\s+implements\\s+([^\\{]+))?`));
        const relations = [];
        if (match?.[1]) relations.push(...splitTargets(match[1], "extends"));
        if (match?.[2]) relations.push(...splitTargets(match[2], "implements"));
        return relations;
    }
    if (grammar === "python") {
        const match = header.match(new RegExp(`\\bclass\\s+${name}\\s*\\(([^)]*)\\)\\s*:`));
        return match ? splitTargets(match[1], "extends") : [];
    }
    if (grammar === "c_sharp") {
        const declKeyword = def.kind === "interface" ? "interface" : "(?:class|record|struct)";
        const match = header.match(new RegExp(`\\b${declKeyword}\\s+${name}(?:<[^>]+>)?\\s*:\\s*([^\\{]+)`));
        if (!match) return [];
        const targets = splitTargetNames(match[1]);
        if (def.kind === "interface") return targets.map(target => ({ name: target, relation: "extends" }));
        return targets.map((target, index) => ({ name: target, relation: index === 0 ? "extends" : "implements" }));
    }
    if (grammar === "php") {
        if (def.kind === "interface") {
            const match = header.match(new RegExp(`\\binterface\\s+${name}\\s+extends\\s+([^\\{]+)`));
            return match ? splitTargets(match[1], "extends") : [];
        }
        const extendsMatch = header.match(new RegExp(`\\bclass\\s+${name}(?:\\s+extends\\s+([^\\{\\s]+))?`));
        const implementsMatch = header.match(/\bimplements\s+([^{]+)/);
        const relations = [];
        if (extendsMatch?.[1]) relations.push(...splitTargets(extendsMatch[1], "extends"));
        if (implementsMatch?.[1]) relations.push(...splitTargets(implementsMatch[1], "implements"));
        return relations;
    }
    return [];
}

function splitTargets(text, relation) {
    return splitTargetNames(text).map(name => ({ name, relation }));
}

function splitTargetNames(text) {
    return text
        .split(",")
        .map(part => part.trim().replace(/<.*?>/g, "").replace(/\s+/g, " "))
        .map(part => part.split(".").pop())
        .filter(Boolean);
}

function escapeRe(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractImport(node, grammar) {
    if (grammar === "javascript" || grammar === "typescript" || grammar === "tsx") {
        const source = node.childForFieldName("source");
        if (source) {
            const structuredSpecs = [];
            const localNames = [];

            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child.type === "import_clause") {
                    for (let j = 0; j < child.childCount; j++) {
                        const sub = child.child(j);
                        if (sub.type === "identifier") {
                            // Default import: import Foo from "./a"
                            structuredSpecs.push({ imported: "default", local: sub.text, type: "default" });
                            localNames.push(sub.text);
                        } else if (sub.type === "namespace_import") {
                            // Namespace: import * as ns from "./a"
                            const alias = sub.children?.find(c => c.type === "identifier");
                            const localName = alias ? alias.text : "*";
                            structuredSpecs.push({ imported: "*", local: localName, type: "namespace" });
                            localNames.push(localName);
                        } else if (sub.type === "named_imports") {
                            for (let k = 0; k < sub.childCount; k++) {
                                const spec = sub.child(k);
                                if (spec.type === "import_specifier") {
                                    const nameNode = spec.childForFieldName("name");
                                    const aliasNode = spec.childForFieldName("alias");
                                    if (nameNode) {
                                        const imported = nameNode.text;
                                        const local = aliasNode ? aliasNode.text : imported;
                                        structuredSpecs.push({ imported, local, type: "named" });
                                        localNames.push(local);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return {
                name: localNames.join(", ") || "*",
                source: source.text.replace(/['\"]/g, ""),
                kind: "import",
                specifiers: structuredSpecs,
            };
        }
    } else if (grammar === "python") {
        // P1b: Python structured import specifiers
        if (node.type === "import_from_statement") {
            const module = node.childForFieldName("module_name");
            const relativeLevel = (node.text.match(/^from\s+(\.+)/)?.[1]?.length) || 0;
            const structuredSpecs = [];
            const localNames = [];
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child.type === "dotted_name" && child !== module) {
                    structuredSpecs.push({ imported: child.text, local: child.text, type: "named" });
                    localNames.push(child.text);
                } else if (child.type === "aliased_import") {
                    const name = child.childForFieldName("name");
                    const alias = child.childForFieldName("alias");
                    if (name) {
                        const local = alias ? alias.text : name.text;
                        structuredSpecs.push({ imported: name.text, local, type: "named" });
                        localNames.push(local);
                    }
                } else if (child.type === "wildcard_import") {
                    structuredSpecs.push({ imported: "*", local: "*", type: "namespace" });
                    localNames.push("*");
                }
            }
            return {
                name: localNames.join(", ") || "*",
                source: module ? module.text : "",
                kind: "import",
                specifiers: structuredSpecs,
                relative_level: relativeLevel,
            };
        }
        if (node.type === "import_statement") {
            const specs = [];
            const names = [];
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child.type === "dotted_name") {
                    specs.push({ imported: child.text, local: child.text, type: "module" });
                    names.push(child.text);
                } else if (child.type === "aliased_import") {
                    const name = child.childForFieldName("name");
                    const alias = child.childForFieldName("alias");
                    if (name) {
                        const local = alias ? alias.text : name.text;
                        specs.push({ imported: name.text, local, type: "module" });
                        names.push(local);
                    }
                }
            }
            return { name: names.join(", "), source: names[0] || "", kind: "import", specifiers: specs };
        }
    } else if (grammar === "c_sharp") {
        // P1d: C# using -> type: "module"
        if (node.type === "using_directive") {
            const ns = node.children?.find(c => c.type === "qualified_name" || c.type === "identifier");
            const name = ns ? ns.text : node.text.replace(/using\s+/, "").replace(/;/, "").trim();
            return { name, source: name, kind: "import", specifiers: [{ imported: name, local: name, type: "module" }] };
        }
    } else if (grammar === "php") {
        // P1d: PHP use -> type: "module"
        if (node.type === "namespace_use_declaration") {
            const specs = [];
            const names = [];
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child.type === "namespace_use_clause") {
                    const qname = child.children?.find(c => c.type === "qualified_name" || c.type === "name");
                    const alias = child.childForFieldName("alias");
                    if (qname) {
                        const imported = qname.text;
                        const parts = imported.split("\\\\");
                        const local = alias ? alias.text : parts[parts.length - 1];
                        specs.push({ imported, local, type: "module" });
                        names.push(local);
                    }
                }
            }
            if (specs.length > 0) {
                return { name: names.join(", "), source: specs[0].imported, kind: "import", specifiers: specs };
            }
        }
    }

    // Fallback: extract text
    return { name: node.text.slice(0, 100), source: "", kind: "import" };
}

/**
 * Extract exported symbol names from ESM syntax.
 * Scans top-level export statements for function/class/variable/re-export names.
 * @param {object} tree - tree-sitter tree
 * @param {string} grammar - language grammar name
 * @returns {{ exports: Set<string>, defaultExport: string|null, reexports: Array }}
 */
function extractExports(tree, grammar) {
    // P1a: Python export extraction
    if (grammar === "python") {
        const exports = new Set();
        const root = tree.rootNode;

        // Check for __all__ = ["foo", "bar"] (literal only, strict policy)
        for (let i = 0; i < root.childCount; i++) {
            const child = root.child(i);
            if (child.type === "expression_statement") {
                const assign = child.child(0);
                if (assign?.type === "assignment") {
                    const left = assign.childForFieldName("left");
                    if (left?.text === "__all__") {
                        const right = assign.childForFieldName("right");
                        if (right && (right.type === "list" || right.type === "tuple")) {
                            for (let j = 0; j < right.childCount; j++) {
                                const elem = right.child(j);
                                if (elem.type === "string") {
                                    const val = elem.text.replace(/['\"`]/g, "");
                                    if (val) exports.add(val);
                                }
                            }
                            return { exports, defaultExport: null, reexports: [] };
                        }
                    }
                }
            }
        }

        // No __all__: convention — top-level def/class without _ prefix
        for (let i = 0; i < root.childCount; i++) {
            const child = root.child(i);
            if (child.type === "function_definition" || child.type === "class_definition") {
                const name = child.childForFieldName("name");
                if (name && !name.text.startsWith("_")) {
                    exports.add(name.text);
                }
            } else if (child.type === "decorated_definition") {
                const inner = child.children?.find(c => c.type === "function_definition" || c.type === "class_definition");
                if (inner) {
                    const name = inner.childForFieldName("name");
                    if (name && !name.text.startsWith("_")) {
                        exports.add(name.text);
                    }
                }
            }
        }
        return { exports, defaultExport: null, reexports: [] };
    }

    // P1c: C# export extraction (public modifier)
    if (grammar === "c_sharp") {
        const exports = new Set();
        function walkCSharp(node) {
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                const type = child.type;
                if (type === "class_declaration" || type === "struct_declaration" ||
                    type === "interface_declaration" || type === "enum_declaration" ||
                    type === "record_declaration") {
                    const hasPublic = child.children?.some(c => (c.type === "modifier" || c.type === "access_modifier") && c.text === "public");
                    if (hasPublic) {
                        const name = child.childForFieldName("name");
                        if (name) exports.add(name.text);
                    }
                }
                if (type === "method_declaration" || type === "property_declaration") {
                    const hasPublic = child.children?.some(c => (c.type === "modifier" || c.type === "access_modifier") && c.text === "public");
                    if (hasPublic) {
                        const name = child.childForFieldName("name");
                        if (name) exports.add(name.text);
                    }
                }
                if (type === "namespace_declaration" || type === "file_scoped_namespace_declaration" ||
                    type === "class_declaration" || type === "struct_declaration" ||
                    type === "interface_declaration" || type === "record_declaration" ||
                    type === "declaration_list") {
                    walkCSharp(child);
                }
            }
        }
        walkCSharp(tree.rootNode);
        return { exports, defaultExport: null, reexports: [] };
    }

    // P1e: PHP export extraction
    if (grammar === "php") {
        const exports = new Set();
        function walkPHP(node) {
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                const type = child.type;
                if (type === "function_definition") {
                    const name = child.childForFieldName("name");
                    if (name) exports.add(name.text);
                }
                if (type === "class_declaration" || type === "interface_declaration" ||
                    type === "trait_declaration" || type === "enum_declaration") {
                    const name = child.childForFieldName("name");
                    if (name) exports.add(name.text);
                    const body = child.childForFieldName("body");
                    if (body) {
                        for (let j = 0; j < body.childCount; j++) {
                            const member = body.child(j);
                            if (member.type === "method_declaration") {
                                const isPrivate = member.children?.some(c =>
                                    c.type === "visibility_modifier" && (c.text === "private" || c.text === "protected")
                                );
                                if (!isPrivate) {
                                    const mName = member.childForFieldName("name");
                                    if (mName) exports.add(mName.text);
                                }
                            }
                        }
                    }
                }
                if (type === "namespace_definition") {
                    walkPHP(child);
                }
            }
        }
        walkPHP(tree.rootNode);
        return { exports, defaultExport: null, reexports: [] };
    }

    // Unsupported grammar
    if (grammar !== "javascript" && grammar !== "typescript" && grammar !== "tsx") {
        return { exports: new Set(), defaultExport: null, reexports: [] };
    }

    const exports = new Set();
    let defaultExport = null;
    const reexports = [];
    const root = tree.rootNode;

    for (let i = 0; i < root.childCount; i++) {
        const child = root.child(i);

        if (child.type !== "export_statement") continue;

        // Check if this is a re-export (has source/from clause)
        const source = child.childForFieldName("source");
        if (source) {
            const sourceText = source.text.replace(/['"]/g, "");
            const reexportSpecs = [];

            // export { x, y } from "./a"
            const exportClause = child.children.find(c => c.type === "export_clause");
            if (exportClause) {
                for (let j = 0; j < exportClause.childCount; j++) {
                    const spec = exportClause.child(j);
                    if (spec.type === "export_specifier") {
                        const name = spec.childForFieldName("name");
                        const alias = spec.childForFieldName("alias");
                        if (name) {
                            const imported = name.text;
                            const local = alias ? alias.text : imported;
                            const type = imported === "default" ? "default" : "named";
                            reexportSpecs.push({ imported, local, type });
                        }
                    }
                }
            }

            // export * from "./b" or export * as ns from "./c"
            const hasStar = child.children.some(c => c.type === "*" || c.text === "*");
            if (hasStar && reexportSpecs.length === 0) {
                const nsAlias = child.children.find(c => c.type === "namespace_export");
                if (nsAlias) {
                    const nsName = nsAlias.childForFieldName("name");
                    reexportSpecs.push({ imported: "*", local: nsName ? nsName.text : "*", type: "namespace" });
                } else {
                    reexportSpecs.push({ imported: "*", local: "*", type: "namespace" });
                }
            }

            if (reexportSpecs.length > 0) {
                reexports.push({ source: sourceText, specifiers: reexportSpecs, line: child.startPosition.row + 1 });
            }

            continue; // Don't process as regular export
        }

        // export function foo() {} / export class Foo {}
        // export const x = ... / export let x = ...
        const decl = child.childForFieldName("declaration");
        if (decl) {
            const nameNode = decl.childForFieldName("name");
            if (nameNode) {
                exports.add(nameNode.text);
            } else if (decl.type === "lexical_declaration" || decl.type === "variable_declaration") {
                for (let j = 0; j < decl.childCount; j++) {
                    const declarator = decl.child(j);
                    if (declarator.type === "variable_declarator") {
                        const n = declarator.childForFieldName("name");
                        if (n) exports.add(n.text);
                    }
                }
            }
        }

        // export { x, y } (local re-grouping, no source)
        if (!decl) {
            const exportClause = child.children.find(c => c.type === "export_clause");
            if (exportClause) {
                for (let j = 0; j < exportClause.childCount; j++) {
                    const spec = exportClause.child(j);
                    if (spec.type === "export_specifier") {
                        const name = spec.childForFieldName("name") || spec.childForFieldName("alias");
                        if (name) exports.add(name.text);
                    }
                }
            }
        }

        // export default ...
        if (child.children.some(c => c.type === "default")) {
            if (decl) {
                const nameNode = decl.childForFieldName("name");
                if (nameNode) {
                    // Named default: export default function foo() {}
                    exports.add(nameNode.text);
                    defaultExport = nameNode.text;
                } else {
                    // Anonymous default: export default function() {} or expression
                    defaultExport = "__default_export__";
                }
            } else {
                // No declaration (e.g. export default expr)
                defaultExport = "__default_export__";
            }
        }
    }

    return { exports, defaultExport, reexports };
}
