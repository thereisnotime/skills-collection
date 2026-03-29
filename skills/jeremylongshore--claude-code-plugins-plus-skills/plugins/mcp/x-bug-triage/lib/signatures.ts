import type { BugCandidate } from "./types";

export interface BugSignature {
  surface: string;
  featureArea: string;
  normalizedErrors: string[];
  normalizedSymptoms: string[];
  raw: string;
}

/**
 * Generate a stable bug signature from a candidate's key fields.
 */
export function generateSignature(candidate: BugCandidate): BugSignature {
  const surface = candidate.product_surface || "unknown";
  const featureArea = candidate.feature_area || "unknown";
  const normalizedErrors = candidate.error_strings
    .map((e) => e.toLowerCase().replace(/\s+/g, " ").trim())
    .sort()
    .slice(0, 5);
  const normalizedSymptoms = candidate.symptoms
    .map((s) => s.toLowerCase().replace(/\s+/g, " ").trim())
    .sort()
    .slice(0, 5);

  const raw = [surface, featureArea, ...normalizedErrors, ...normalizedSymptoms].join("|");
  return { surface, featureArea, normalizedErrors, normalizedSymptoms, raw };
}

/**
 * Generate a signature string from cluster fields (for existing clusters).
 */
export function signatureFromString(signatureStr: string): BugSignature {
  const parts = signatureStr.split("|");
  return {
    surface: parts[0] || "unknown",
    featureArea: parts[1] || "unknown",
    normalizedErrors: parts.slice(2).filter((p) => /error|500|4\d{2}|crash/i.test(p)),
    normalizedSymptoms: parts.slice(2).filter((p) => !/error|500|4\d{2}|crash/i.test(p)),
    raw: signatureStr,
  };
}

/**
 * Calculate overlap between two signatures (0-1).
 * Components: surface match + feature match + error overlap + symptom overlap.
 */
export function calculateSignatureOverlap(a: BugSignature, b: BugSignature): number {
  let score = 0;
  let weights = 0;

  // Surface match (weight: 0.25)
  if (a.surface === b.surface) score += 0.25;
  weights += 0.25;

  // Feature area match (weight: 0.25)
  if (a.featureArea === b.featureArea) score += 0.25;
  weights += 0.25;

  // Error string overlap (weight: 0.30)
  if (a.normalizedErrors.length > 0 || b.normalizedErrors.length > 0) {
    const errorOverlap = setOverlap(a.normalizedErrors, b.normalizedErrors);
    score += errorOverlap * 0.30;
  } else {
    score += 0.15; // No errors in either = neutral
  }
  weights += 0.30;

  // Symptom overlap (weight: 0.20)
  if (a.normalizedSymptoms.length > 0 || b.normalizedSymptoms.length > 0) {
    const symptomOverlap = setOverlap(a.normalizedSymptoms, b.normalizedSymptoms);
    score += symptomOverlap * 0.20;
  } else {
    score += 0.10;
  }
  weights += 0.20;

  return score / weights * (weights); // normalize back to 0-1
}

function setOverlap(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}
