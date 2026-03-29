/**
 * Freshness assessment for X API intake results.
 * Computes what fraction of ingested posts actually fall within the requested
 * time window, and produces a confidence band + optional warning.
 */

const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.3;

export type DateConfidence = "high" | "medium" | "low";

export interface FreshnessReport {
  total_posts: number;
  in_window_posts: number;
  freshness_ratio: number;
  date_confidence: DateConfidence;
  warning: string | null;
}

/**
 * Assess freshness of ingested posts relative to the requested window.
 *
 * @param posts - Array of objects with created_at ISO timestamps
 * @param windowStartIso - ISO 8601 start of the requested window
 * @param windowEndIso - ISO 8601 end of the requested window (defaults to now)
 * @returns FreshnessReport with ratio, confidence band, and optional warning
 */
export function assessFreshness(
  posts: Array<{ created_at: string }>,
  windowStartIso: string,
  windowEndIso?: string,
): FreshnessReport {
  if (posts.length === 0) {
    return {
      total_posts: 0,
      in_window_posts: 0,
      freshness_ratio: 0,
      date_confidence: "low",
      warning: "No posts ingested. The X API returned no results for this window.",
    };
  }

  const windowStart = new Date(windowStartIso).getTime();
  const windowEnd = windowEndIso ? new Date(windowEndIso).getTime() : Date.now();

  let inWindow = 0;
  for (const post of posts) {
    const postTime = new Date(post.created_at).getTime();
    if (postTime >= windowStart && postTime <= windowEnd) {
      inWindow++;
    }
  }

  const ratio = inWindow / posts.length;
  const confidence = classifyConfidence(ratio);
  const warning = generateWarning(ratio, inWindow, posts.length);

  return {
    total_posts: posts.length,
    in_window_posts: inWindow,
    freshness_ratio: Math.round(ratio * 100) / 100,
    date_confidence: confidence,
    warning,
  };
}

function classifyConfidence(ratio: number): DateConfidence {
  if (ratio >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (ratio >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium";
  return "low";
}

function generateWarning(ratio: number, inWindow: number, total: number): string | null {
  if (ratio >= HIGH_CONFIDENCE_THRESHOLD) return null;
  if (ratio >= MEDIUM_CONFIDENCE_THRESHOLD) {
    return `Moderate freshness: ${inWindow}/${total} posts (${Math.round(ratio * 100)}%) fall within the requested window. Some results may be stale.`;
  }
  return `Low freshness: only ${inWindow}/${total} posts (${Math.round(ratio * 100)}%) fall within the requested window. Most results are outside the requested timeframe.`;
}
