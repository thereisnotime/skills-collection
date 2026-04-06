import { extname } from "node:path";
import capabilities from "../evals/artifacts/capabilities.json" with { type: "json" };
import qualityTargets from "../evals/artifacts/quality-targets.json" with { type: "json" };
import qualityReport from "../evals/artifacts/quality-report.json" with { type: "json" };
import corporaManifest from "../corpora/manifest.json" with { type: "json" };

const TIER_RANK = new Map(Object.entries(capabilities.tiers).map(([tier, meta]) => [tier, meta.rank]));

const EXTENSION_LANGUAGE = new Map([
    [".js", "javascript"],
    [".mjs", "javascript"],
    [".cjs", "javascript"],
    [".jsx", "javascript"],
    [".ts", "typescript"],
    [".tsx", "typescript"],
    [".py", "python"],
    [".php", "php"],
    [".cs", "csharp"],
]);

function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
}

function minTier(current, next) {
    if (!current) return next;
    const currentRank = TIER_RANK.get(current) ?? -1;
    const nextRank = TIER_RANK.get(next) ?? -1;
    return nextRank < currentRank ? next : current;
}

function frameworkCapability(queryFamily, framework) {
    return capabilities.query_families?.[queryFamily]?.frameworks?.[framework] || null;
}

function languageCapability(queryFamily, language) {
    return capabilities.query_families?.[queryFamily]?.languages?.[language]
        || capabilities.query_families?.[queryFamily]?.default
        || null;
}

function summarizeCapabilities(entries, fallback) {
    if (!entries.length) {
        return {
            support_tier: fallback?.tier || "experimental",
            quality_basis: fallback?.quality_basis || ["heuristic_only"],
            known_limitations: fallback?.known_limitations || ["No explicit capability entry matched this query scope yet."],
        };
    }

    let tier = null;
    const qualityBasis = [];
    const knownLimitations = [];
    for (const entry of entries) {
        tier = minTier(tier, entry.tier);
        qualityBasis.push(...(entry.quality_basis || []));
        knownLimitations.push(...(entry.known_limitations || []));
    }

    return {
        support_tier: tier || fallback?.tier || "experimental",
        quality_basis: unique(qualityBasis.length ? qualityBasis : fallback?.quality_basis || ["heuristic_only"]),
        known_limitations: unique(knownLimitations.length ? knownLimitations : fallback?.known_limitations || []),
    };
}

export function getCapabilitiesArtifact() {
    return capabilities;
}

export function getQualityTargetsArtifact() {
    return qualityTargets;
}

export function getQualityReportArtifact() {
    return qualityReport;
}

export function getCorporaManifest() {
    return corporaManifest;
}

export function listQualityCorpora(kind = "all") {
    if (kind === "curated") return corporaManifest.curated;
    if (kind === "external") return corporaManifest.external;
    if (kind === "excluded") return corporaManifest.excluded;
    return {
        curated: corporaManifest.curated,
        external: corporaManifest.external,
        excluded: corporaManifest.excluded,
    };
}

export function inferLanguageFromFile(file) {
    if (!file) return null;
    return EXTENSION_LANGUAGE.get(extname(file).toLowerCase()) || null;
}

export function inferLanguagesFromFiles(files) {
    return unique((files || []).map(file => inferLanguageFromFile(file)));
}

export function collectFrameworksFromOrigins(origins) {
    return unique((origins || []).map((origin) => {
        if (!origin || !origin.startsWith("framework:")) return null;
        const [, framework] = origin.split(":");
        return framework || null;
    }));
}

export function buildInlineQuality({ queryFamily, languages = [], frameworks = [] } = {}) {
    const family = capabilities.query_families?.[queryFamily];
    const fallback = family?.default || null;
    const entries = [];

    for (const language of unique(languages)) {
        const entry = languageCapability(queryFamily, language);
        if (entry) entries.push(entry);
    }
    for (const framework of unique(frameworks)) {
        const entry = frameworkCapability(queryFamily, framework);
        if (entry) entries.push(entry);
    }
    if (!entries.length && fallback) entries.push(fallback);

    return {
        query_family: queryFamily,
        languages: unique(languages),
        frameworks: unique(frameworks),
        ...summarizeCapabilities(entries, fallback),
    };
}
