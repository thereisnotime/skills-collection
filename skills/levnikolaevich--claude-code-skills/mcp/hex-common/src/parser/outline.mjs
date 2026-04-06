import { getParser, getLanguage } from "./tree-sitter.mjs";
import { grammarForExtension } from "./languages.mjs";

const OUTLINE_CONFIGS = {
    ".js": { outline: ["function_declaration", "class_declaration", "variable_declaration", "export_statement", "lexical_declaration"], skip: ["import_statement"], recurse: ["class_body"] },
    ".mjs": { outline: ["function_declaration", "class_declaration", "variable_declaration", "export_statement", "lexical_declaration"], skip: ["import_statement"], recurse: ["class_body"] },
    ".cjs": { outline: ["function_declaration", "class_declaration", "variable_declaration", "export_statement", "lexical_declaration"], skip: ["import_statement"], recurse: ["class_body"] },
    ".jsx": { outline: ["function_declaration", "class_declaration", "variable_declaration", "export_statement", "lexical_declaration"], skip: ["import_statement"], recurse: ["class_body"] },
    ".ts": { outline: ["function_declaration", "class_declaration", "interface_declaration", "type_alias_declaration", "enum_declaration", "variable_declaration", "export_statement", "lexical_declaration"], skip: ["import_statement"], recurse: ["class_body"] },
    ".tsx": { outline: ["function_declaration", "class_declaration", "interface_declaration", "type_alias_declaration", "enum_declaration", "variable_declaration", "export_statement", "lexical_declaration"], skip: ["import_statement"], recurse: ["class_body"] },
    ".py": { outline: ["function_definition", "class_definition", "decorated_definition"], skip: ["import_statement", "import_from_statement"], recurse: ["class_body", "block"] },
    ".cs": { outline: ["class_declaration", "interface_declaration", "method_declaration", "namespace_declaration"], skip: ["using_directive"], recurse: ["class_body"] },
    ".php": { outline: ["function_definition", "class_declaration", "method_declaration"], skip: ["namespace_use_declaration"], recurse: ["class_body"] },
};

function extractOutline(rootNode, config, sourceLines) {
    const entries = [];
    const skipTypes = new Set(config.skip);
    const outlineTypes = new Set(config.outline);
    const recurseTypes = new Set(config.recurse);

    function walk(node, depth) {
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            const type = child.type;
            const startLine = child.startPosition.row + 1;
            const endLine = child.endPosition.row + 1;

            if (skipTypes.has(type)) continue;

            if (outlineTypes.has(type)) {
                const firstLine = sourceLines[startLine - 1] || "";
                const nameMatch = firstLine.match(/(?:function|class|interface|type|enum|struct|def|fn|pub\s+fn)\s+(\w+)|(?:const|let|var|export\s+(?:const|let|var|function|class))\s+(\w+)/);
                const name = nameMatch ? (nameMatch[1] || nameMatch[2]) : null;

                entries.push({
                    start: startLine,
                    end: endLine,
                    depth,
                    text: firstLine.trim().slice(0, 120),
                    name,
                    fingerprint: sourceLines.slice(startLine - 1, endLine).join("\n"),
                });

                for (let j = 0; j < child.childCount; j++) {
                    const sub = child.child(j);
                    if (recurseTypes.has(sub.type)) walk(sub, depth + 1);
                }
            }
        }
    }

    const skippedRanges = [];
    for (let i = 0; i < rootNode.childCount; i++) {
        const child = rootNode.child(i);
        if (skipTypes.has(child.type)) {
            skippedRanges.push({
                start: child.startPosition.row + 1,
                end: child.endPosition.row + 1,
            });
        }
    }

    walk(rootNode, 0);
    return { entries, skippedRanges };
}

export function outlineConfigForExtension(ext) {
    return OUTLINE_CONFIGS[ext.toLowerCase()] || null;
}

export async function outlineFromContent(content, ext) {
    const config = outlineConfigForExtension(ext);
    const grammar = grammarForExtension(ext);
    if (!config || !grammar) return null;

    const sourceLines = content.split("\n");
    const lang = await getLanguage(grammar);
    const parser = await getParser();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    return extractOutline(tree.rootNode, config, sourceLines);
}
