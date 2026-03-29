/**
 * Hashing and fingerprinting primitives for code clone detection.
 *
 * Pure functions, zero external dependencies (Node.js Buffer + BigInt only).
 * Used by parser.mjs (extraction), clones.mjs (similarity).
 */

// --- FNV-1a-64 constants ---

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xFFFFFFFFFFFFFFFFn;

/**
 * FNV-1a 64-bit hash over UTF-8 bytes of a string.
 * @param {string} str
 * @returns {string} 16-char lowercase hex
 */
export function fnv1a64(str) {
    let hash = FNV_OFFSET_64;
    const buf = Buffer.from(str, "utf8");
    for (let i = 0; i < buf.length; i++) {
        hash ^= BigInt(buf[i]);
        hash = (hash * FNV_PRIME_64) & MASK_64;
    }
    return hash.toString(16).padStart(16, "0");
}

// --- Body extractors per language ---

/**
 * Language-specific extraction contracts for clone detection.
 * Languages not listed here fall back to "hashes only" mode in the caller.
 * @type {Map<string, {grammar: string, bodyField: string, stmtTypes: Set<string>, skipNodes: Set<string>}>}
 */
export const BODY_EXTRACTORS = new Map([
    ["javascript", {
        grammar: "javascript",
        bodyField: "body",
        stmtTypes: new Set([
            "expression_statement", "if_statement", "for_statement",
            "while_statement", "return_statement", "throw_statement",
            "try_statement", "switch_statement", "variable_declaration",
            "lexical_declaration", "do_statement", "for_in_statement",
        ]),
        skipNodes: new Set(),
    }],
    ["typescript", {
        grammar: "typescript",
        bodyField: "body",
        stmtTypes: new Set([
            "expression_statement", "if_statement", "for_statement",
            "while_statement", "return_statement", "throw_statement",
            "try_statement", "switch_statement", "variable_declaration",
            "lexical_declaration", "do_statement", "for_in_statement",
        ]),
        skipNodes: new Set([
            "interface_declaration", "type_alias_declaration", "enum_declaration",
        ]),
    }],
    ["python", {
        grammar: "python",
        bodyField: "body",
        stmtTypes: new Set([
            "expression_statement", "if_statement", "for_statement",
            "while_statement", "return_statement", "raise_statement",
            "try_statement", "with_statement", "assert_statement",
        ]),
        skipNodes: new Set(),
    }],
]);

// --- Token normalization ---

const IDENT_TYPES = new Set(["identifier", "property_identifier", "shorthand_property_identifier"]);
const STRING_TYPES = new Set(["string", "string_fragment", "template_string"]);
const NUMBER_TYPES = new Set(["number", "integer", "float"]);
const BOOL_TYPES = new Set(["true", "false"]);

/**
 * Normalize tree-sitter leaf nodes into language-agnostic tokens.
 * Identifiers -> "$", strings -> "$S", numbers -> "$N", booleans -> "$B",
 * everything else -> node type (not text).
 * @param {Array<{type: string, text: string}>} leafNodes
 * @returns {string[]}
 */
export function normalizeTokens(leafNodes) {
    const result = [];
    for (let i = 0; i < leafNodes.length; i++) {
        const { type } = leafNodes[i];
        if (IDENT_TYPES.has(type))       result.push("$");
        else if (STRING_TYPES.has(type)) result.push("$S");
        else if (NUMBER_TYPES.has(type)) result.push("$N");
        else if (BOOL_TYPES.has(type))   result.push("$B");
        else                             result.push(type);
    }
    return result;
}

// --- N-gram generation ---

/**
 * Sliding window of size n over token array.
 * Each n-gram is tokens joined by space.
 * @param {string[]} tokens
 * @param {number} n
 * @returns {string[]}
 */
export function ngrams(tokens, n = 5) {
    if (tokens.length <= n) {
        return [tokens.join(" ")];
    }
    const result = [];
    const end = tokens.length - n + 1;
    for (let i = 0; i < end; i++) {
        result.push(tokens.slice(i, i + n).join(" "));
    }
    return result;
}

// --- MinHash signature ---

/**
 * Compute MinHash signature over n-gram list.
 * Uses k independent hash functions (FNV-1a with seed prefixes).
 * @param {string[]} ngramList
 * @param {number} k - number of hash functions (default 64)
 * @returns {Buffer} k * 8 bytes (BigInt64 little-endian)
 */
export function minhashSignature(ngramList, k = 64) {
    const mins = new Array(k);
    for (let i = 0; i < k; i++) {
        mins[i] = MASK_64; // max uint64 as initial min
    }

    for (let g = 0; g < ngramList.length; g++) {
        const gram = ngramList[g];
        for (let i = 0; i < k; i++) {
            const seeded = `seed_${i}:${gram}`;
            const h = fnv1a64BigInt(seeded);
            if (h < mins[i]) {
                mins[i] = h;
            }
        }
    }

    const buf = Buffer.alloc(k * 8);
    for (let i = 0; i < k; i++) {
        buf.writeBigUInt64LE(mins[i], i * 8);
    }
    return buf;
}

/**
 * Internal: FNV-1a-64 returning BigInt (avoids hex round-trip in hot path).
 * @param {string} str
 * @returns {bigint}
 */
function fnv1a64BigInt(str) {
    let hash = FNV_OFFSET_64;
    const buf = Buffer.from(str, "utf8");
    for (let i = 0; i < buf.length; i++) {
        hash ^= BigInt(buf[i]);
        hash = (hash * FNV_PRIME_64) & MASK_64;
    }
    return hash;
}

// --- MinHash Jaccard estimation ---

/**
 * Estimate Jaccard similarity from two MinHash signatures.
 * @param {Buffer} sigA
 * @param {Buffer} sigB
 * @returns {number} 0.0 to 1.0
 */
export function minhashJaccard(sigA, sigB) {
    const k = sigA.length / 8;
    let matches = 0;
    for (let i = 0; i < k; i++) {
        const off = i * 8;
        if (sigA.readBigUInt64LE(off) === sigB.readBigUInt64LE(off)) {
            matches++;
        }
    }
    return matches / k;
}

// --- LSH band computation ---

/**
 * Split MinHash signature into bands for locality-sensitive hashing.
 * @param {Buffer} signature - k * 8 bytes
 * @param {number} b - number of bands (default 16)
 * @param {number} r - rows per band (default 4)
 * @returns {Array<{bandId: number, bucketHash: string}>}
 */
export function lshBands(signature, b = 16, r = 4) {
    const result = [];
    for (let band = 0; band < b; band++) {
        let concat = "";
        for (let row = 0; row < r; row++) {
            const off = (band * r + row) * 8;
            concat += signature.readBigUInt64LE(off).toString(16).padStart(16, "0");
        }
        result.push({ bandId: band, bucketHash: fnv1a64(concat) });
    }
    return result;
}

// --- Statement counting ---

/**
 * Count direct children of bodyNode whose type is in stmtTypes.
 * @param {{childCount: number, child: function}} bodyNode - tree-sitter node
 * @param {Set<string>} stmtTypes
 * @returns {number}
 */
export function countStatements(bodyNode, stmtTypes) {
    let count = 0;
    for (let i = 0; i < bodyNode.childCount; i++) {
        const child = bodyNode.child(i);
        if (stmtTypes.has(child.type)) {
            count++;
        }
    }
    return count;
}

// --- Leaf node walk ---

/**
 * Depth-first walk of all leaf nodes within a tree-sitter node.
 * Uses cursor API for efficiency (no array allocation per level).
 * @param {{walk: function}} node - tree-sitter node
 * @returns {Array<{type: string, text: string}>}
 */
export function walkLeaves(node) {
    const leaves = [];
    const cursor = node.walk();
    let reachedEnd = false;

    while (!reachedEnd) {
        if (cursor.nodeType !== undefined && cursor.currentNode.childCount === 0) {
            leaves.push({ type: cursor.nodeType, text: cursor.nodeText });
        }

        // Try to go deeper
        if (cursor.gotoFirstChild()) {
            continue;
        }
        // Try next sibling
        if (cursor.gotoNextSibling()) {
            continue;
        }
        // Backtrack until we find a sibling or exhaust the tree
        while (!cursor.gotoNextSibling()) {
            if (!cursor.gotoParent()) {
                reachedEnd = true;
                break;
            }
        }
    }

    return leaves;
}

// --- Raw hash (whitespace-collapsed) ---

/**
 * Hash function body text with whitespace collapsed.
 * @param {string} bodyText
 * @returns {string} 16-char hex
 */
export function computeRawHash(bodyText) {
    const collapsed = bodyText.replace(/\s+/g, " ").trim();
    return fnv1a64(collapsed);
}

// --- Normalized hash (token-based) ---

/**
 * Hash normalized token sequence.
 * @param {string[]} normalizedTokens
 * @returns {string} 16-char hex
 */
export function computeNormHash(normalizedTokens) {
    const joined = normalizedTokens.join(" ");
    return fnv1a64(joined);
}
