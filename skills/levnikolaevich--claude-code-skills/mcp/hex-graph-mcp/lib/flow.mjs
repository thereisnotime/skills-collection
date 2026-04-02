/**
 * Lightweight, deterministic flow extraction helpers.
 *
 * Stage 3 uses bounded anchors and simple statement forms only:
 * assignments, returns, and static call propagation.
 */

export const FLOW_ANCHOR_KINDS = ["param", "local", "return", "property"];
export const MAX_FLOW_ACCESS_PATH_SEGMENTS = 3;
export const DEFAULT_FLOW_MAX_HOPS = 4;
export const DEFAULT_FLOW_LIMIT = 50;

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PROPERTY_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const PHP_PROPERTY_RE = /^\$?[A-Za-z_][A-Za-z0-9_]*(?:->[_A-Za-z][_A-Za-z0-9]*)+$/;

export function extractParamNames(signature) {
    if (!signature) return [];
    const inner = signature
        .trim()
        .replace(/^[({\[]/, "")
        .replace(/[)}\]]$/, "");
    if (!inner) return [];
    return splitTopLevel(inner, ",")
        .map(part => normalizeParamName(part))
        .filter(Boolean);
}

function normalizeParamName(part) {
    return part
        .trim()
        .replace(/^[@*]+/, "")
        .replace(/\.\.\./g, "")
        .replace(/=[^,]+$/g, "")
        .replace(/:[^,]+$/g, "")
        .replace(/\?$/, "")
        .replace(/^(public|private|protected|readonly|async|ref|out|in|params)\s+/g, "")
        .replace(/^[A-Za-z_][A-Za-z0-9_<>,?[\]\s]*\s+(\$?[A-Za-z_][A-Za-z0-9_]*)$/, "$1")
        .replace(/^\$/, "")
        .trim();
}

export function normalizeAnchor(anchor) {
    if (!anchor || typeof anchor !== "object") return null;
    const kind = anchor.kind;
    if (!FLOW_ANCHOR_KINDS.includes(kind)) return null;
    if (kind === "return") return { kind, name: "return", access_path: null };
    const name = normalizeIdentifier(anchor.name);
    if (!name) return null;
    const accessPath = Array.isArray(anchor.access_path) && anchor.access_path.length > 0
        ? anchor.access_path.map(segment => String(segment).trim()).filter(Boolean)
        : null;
    if (accessPath && accessPath.length > MAX_FLOW_ACCESS_PATH_SEGMENTS) return null;
    if (kind === "property" && !accessPath) return null;
    if (kind !== "property" && accessPath) return null;
    return { kind, name, access_path: accessPath };
}

export function anchorKey(symbolId, anchor) {
    const normalized = normalizeAnchor(anchor);
    if (!normalized) return null;
    return [
        symbolId,
        normalized.kind,
        normalized.name || "",
        JSON.stringify(normalized.access_path || []),
    ].join("|");
}

export function anchorsEqual(left, right) {
    const a = normalizeAnchor(left);
    const b = normalizeAnchor(right);
    if (!a || !b) return false;
    return a.kind === b.kind
        && a.name === b.name
        && JSON.stringify(a.access_path || []) === JSON.stringify(b.access_path || []);
}

export function buildFlowIR(source, grammar, definitions, calls = []) {
    const lines = source.split("\n");
    const callSitesByLine = new Map();
    for (const call of calls) {
        const rows = callSitesByLine.get(call.line) || [];
        rows.push(call);
        callSitesByLine.set(call.line, rows);
    }
    const events = [];
    for (const def of definitions) {
        if (def.kind !== "function" && def.kind !== "method") continue;
        const params = new Set(extractParamNames(def.signature));
        const localTypes = inferLocalTypes(lines, def, grammar);
        const bodyLines = lines.slice(def.line_start - 1, def.line_end);
        for (let index = 0; index < bodyLines.length; index++) {
            const lineNo = def.line_start + index;
            const statement = stripLineComment(bodyLines[index] || "", grammar).trim();
            if (!statement) continue;

            const returnExpr = extractReturnExpression(statement, grammar);
            if (returnExpr != null) {
                const returnAnchor = { kind: "return" };
                pushFlowEvent(events, lineNo, def.key, parseValueEvent(returnExpr, grammar, params, returnAnchor, callSitesByLine.get(lineNo) || [], localTypes));
                continue;
            }

            const assignment = parseAssignment(statement, grammar);
            if (!assignment) continue;
            const targetAnchor = parseTargetAnchor(assignment.left, grammar, params);
            if (!targetAnchor) continue;
            pushFlowEvent(events, lineNo, def.key, parseValueEvent(assignment.right, grammar, params, targetAnchor, callSitesByLine.get(lineNo) || [], localTypes));
        }
    }
    return events;
}

function pushFlowEvent(events, lineNo, ownerKey, parsed) {
    if (!parsed) return;
    if (parsed.kind === "direct") {
        events.push({ owner_key: ownerKey, line: lineNo, ...parsed });
        return;
    }
    if (parsed.kind === "call" && (parsed.args.length > 0 || parsed.result_target)) {
        events.push({ owner_key: ownerKey, line: lineNo, ...parsed });
    }
}

function parseValueEvent(expression, grammar, params, resultTarget, callSites, localTypes) {
    const call = parseCallExpression(expression, grammar, callSites, params);
    if (call) {
        return {
            kind: "call",
            callee_name: call.callee_name,
            receiver: call.receiver,
            receiver_type: call.receiver ? (localTypes.get(call.receiver) || null) : null,
            args: call.args,
            result_target: normalizeAnchor(resultTarget),
            call_text: call.call_text,
        };
    }
    const sourceAnchor = parseValueAnchor(expression, grammar, params);
    if (!sourceAnchor) return null;
    return {
        kind: "direct",
        source: sourceAnchor,
        target: normalizeAnchor(resultTarget),
    };
}

function stripLineComment(text, grammar) {
    let line = text;
    if (grammar === "python") {
        const hashIndex = line.indexOf("#");
        if (hashIndex >= 0) line = line.slice(0, hashIndex);
        return line;
    }
    const slashIndex = line.indexOf("//");
    if (slashIndex >= 0) line = line.slice(0, slashIndex);
    if (grammar === "php") {
        const hashIndex = line.indexOf("#");
        if (hashIndex >= 0) line = line.slice(0, hashIndex);
    }
    return line;
}

function extractReturnExpression(statement, grammar) {
    if (grammar === "python") {
        const match = statement.match(/^return(?:\s+(.*))?$/);
        return match ? (match[1] || "").trim() : null;
    }
    const match = statement.match(/^return(?:\s+(.*?))?;?$/);
    return match ? (match[1] || "").trim() : null;
}

function parseAssignment(statement, grammar) {
    const eqIndex = findAssignmentIndex(statement);
    if (eqIndex < 0) return null;
    const left = statement.slice(0, eqIndex).trim();
    const right = statement.slice(eqIndex + 1).trim().replace(/;$/, "").trim();
    if (!left || !right) return null;
    if (grammar === "javascript" || grammar === "typescript" || grammar === "tsx") {
        return { left: left.replace(/^(?:export\s+)?(?:const|let|var)\s+/, ""), right };
    }
    if (grammar === "c_sharp") {
        return { left: left.replace(/^(?:var|[A-Za-z_][A-Za-z0-9_<>,?\[\]\s]*)\s+(\w+(?:\.[A-Za-z_][A-Za-z0-9_]*)?)$/, "$1"), right };
    }
    return { left, right };
}

function findAssignmentIndex(statement) {
    let depth = 0;
    for (let i = 0; i < statement.length; i++) {
        const ch = statement[i];
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
        else if (ch === "=" && depth === 0) {
            const prev = statement[i - 1] || "";
            const next = statement[i + 1] || "";
            if (prev === "=" || next === "=" || prev === "!" || prev === "<" || prev === ">" || next === ">") continue;
            return i;
        }
    }
    return -1;
}

function parseTargetAnchor(targetExpr, grammar, params) {
    return parseValueAnchor(targetExpr, grammar, params, { forceLocal: true });
}

function parseValueAnchor(expr, grammar, params, { forceLocal = false } = {}) {
    const cleaned = cleanExpression(expr, grammar);
    if (!cleaned || isLiteralLike(cleaned)) return null;

    if (grammar === "php" && PHP_PROPERTY_RE.test(cleaned)) {
        const parts = cleaned.split("->");
        const base = normalizeIdentifier(parts.shift());
        if (parts.length > MAX_FLOW_ACCESS_PATH_SEGMENTS) return null;
        return { kind: "property", name: base, access_path: parts, base_kind: classifyName(base, params, forceLocal) };
    }

    if (PROPERTY_RE.test(cleaned)) {
        const parts = cleaned.split(".");
        const base = normalizeIdentifier(parts.shift());
        if (parts.length > MAX_FLOW_ACCESS_PATH_SEGMENTS) return null;
        return { kind: "property", name: base, access_path: parts, base_kind: classifyName(base, params, forceLocal) };
    }

    if (IDENT_RE.test(cleaned) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) {
        const name = normalizeIdentifier(cleaned);
        return { kind: classifyName(name, params, forceLocal), name, access_path: null };
    }

    return null;
}

function classifyName(name, params, forceLocal) {
    if (!forceLocal && params.has(name)) return "param";
    return "local";
}

function cleanExpression(expr, grammar) {
    let value = (expr || "").trim().replace(/;$/, "").trim();
    if (!value) return "";
    while (value.startsWith("(") && value.endsWith(")") && balanced(value.slice(1, -1))) {
        value = value.slice(1, -1).trim();
    }
    if (grammar === "python") value = value.replace(/^self\./, "self.");
    if (grammar === "php") value = value.replace(/^\$this->/, "this->");
    return value;
}

function balanced(text) {
    let depth = 0;
    for (const ch of text) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (depth < 0) return false;
    }
    return depth === 0;
}

function isLiteralLike(expr) {
    return /^["'`]/.test(expr)
        || /^\d/.test(expr)
        || /^(true|false|null|None)$/.test(expr)
        || /^new\s+/.test(expr);
}

function parseCallExpression(expr, grammar, callSites, params) {
    const cleaned = cleanExpression(expr, grammar);
    if (!cleaned || /^new\s+/.test(cleaned)) return null;
    const match = cleaned.match(/^(.*?)\((.*)\)$/);
    if (!match) return null;
    const callText = match[1].trim();
    if (!callText) return null;
    const callName = inferCallName(callText);
    const matchedSite = callSites.find(site => site.name === callName) || callSites[0] || null;
    const argsText = matchedSite?.args?.length ? matchedSite.args : splitTopLevel(match[2], ",");
    return {
        callee_name: callName,
        call_text: callText,
        receiver: inferReceiver(callText, grammar),
        args: argsText.map(arg => parseValueAnchor(arg, grammar, params)).filter(Boolean),
    };
}

function inferCallName(callText) {
    if (callText.includes("->")) return callText.split("->").pop().trim();
    if (callText.includes(".")) return callText.split(".").pop().trim();
    return callText.trim();
}

function inferReceiver(callText, grammar) {
    if (grammar === "php" && callText.includes("->")) {
        const base = callText.split("->")[0].trim();
        return normalizeIdentifier(base);
    }
    if (callText.includes(".")) {
        const base = callText.split(".")[0].trim();
        return IDENT_RE.test(base) ? base : null;
    }
    return null;
}

function inferLocalTypes(lines, def, grammar) {
    const localTypes = new Map();
    const bodyLines = lines.slice(def.line_start - 1, def.line_end);
    for (const raw of bodyLines) {
        const line = stripLineComment(raw || "", grammar).trim();
        if (!line) continue;
        const match = matchInstantiation(line, grammar);
        if (match) localTypes.set(match.name, match.type);
    }
    return localTypes;
}

function matchInstantiation(line, grammar) {
    if (grammar === "javascript" || grammar === "typescript" || grammar === "tsx") {
        const match = line.match(/^(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        return match ? { name: match[1], type: match[2] } : null;
    }
    if (grammar === "python") {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        return match ? { name: match[1], type: match[2] } : null;
    }
    if (grammar === "c_sharp") {
        const match = line.match(/^(?:var|[A-Za-z_][A-Za-z0-9_<>,?\[\]\s]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        return match ? { name: match[1], type: match[2] } : null;
    }
    if (grammar === "php") {
        const match = line.match(/^\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        return match ? { name: match[1], type: match[2] } : null;
    }
    return null;
}

function normalizeIdentifier(value) {
    return String(value || "").trim().replace(/^\$/, "");
}

function splitTopLevel(text, separator) {
    const parts = [];
    let depthParen = 0;
    let depthBracket = 0;
    let depthBrace = 0;
    let quote = null;
    let current = "";
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const prev = text[i - 1];
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

        if (
            ch === separator
            && depthParen === 0
            && depthBracket === 0
            && depthBrace === 0
        ) {
            parts.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}
