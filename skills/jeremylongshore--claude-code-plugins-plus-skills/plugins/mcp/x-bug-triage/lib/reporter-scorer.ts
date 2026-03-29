import type { XPost } from "../mcp/triage-server/types";

export interface ReporterScores {
  quality: number;
  independence: number;
  authenticity: number;
  historicalAccuracy: number;
  composite: number;
}

/**
 * Report quality (0-1): symptom specificity, error strings, version/platform detail,
 * repro steps, media presence.
 */
function scoreQuality(
  text: string,
  symptoms: string[],
  errorStrings: string[],
  reproHints: string[],
  post: XPost,
): number {
  let score = 0.2; // baseline
  if (symptoms.length > 0) score += 0.15;
  if (symptoms.length > 2) score += 0.1;
  if (errorStrings.length > 0) score += 0.2;
  if (reproHints.length > 0) score += 0.15;
  if (post.attachments?.media_keys?.length) score += 0.1;
  if (/(?:version|v\d|build|update)/i.test(text)) score += 0.05;
  if (/(?:ios|android|chrome|firefox|safari|windows|mac)/i.test(text)) score += 0.05;
  return Math.min(1, score);
}

/**
 * Independence (0-1): not brigading, not copied phrase, not "same here" without substance.
 */
function scoreIndependence(text: string, post: XPost): number {
  let score = 0.8; // assume independent by default
  const lower = text.toLowerCase().trim();

  // "same here" / "me too" with no additional info
  if (/^(?:same\s+here|me\s+too|this|same|yep|yup|\+1|facts)\b/.test(lower) && lower.length < 50) {
    score -= 0.5;
  }

  // Very short replies with no substance
  if (lower.length < 20 && post.referenced_tweets?.length) {
    score -= 0.3;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Account authenticity (0-1): human-like behavior signals.
 */
function scoreAuthenticity(post: XPost): number {
  let score = 0.7; // baseline
  const metrics = post.public_metrics;

  if (metrics) {
    // Accounts with some engagement look more real
    if (metrics.like_count > 0 || metrics.reply_count > 0) score += 0.1;
    if (metrics.retweet_count > 0) score += 0.05;
  }

  // Has a meaningful-length post
  if (post.text && post.text.length > 50) score += 0.1;

  return Math.min(1, score);
}

/**
 * Historical accuracy (0-1): prior reports matched confirmed issues.
 * For MVP, starts at 0.5 (neutral) since we have no history.
 */
function scoreHistoricalAccuracy(): number {
  return 0.5; // neutral baseline for MVP
}

export function scoreReporter(
  text: string,
  symptoms: string[],
  errorStrings: string[],
  reproHints: string[],
  post: XPost,
): ReporterScores {
  const quality = scoreQuality(text, symptoms, errorStrings, reproHints, post);
  const independence = scoreIndependence(text, post);
  const authenticity = scoreAuthenticity(post);
  const historicalAccuracy = scoreHistoricalAccuracy();

  // Weighted composite
  const composite = quality * 0.35 + independence * 0.25 + authenticity * 0.2 + historicalAccuracy * 0.2;

  return {
    quality: Math.round(quality * 100) / 100,
    independence: Math.round(independence * 100) / 100,
    authenticity: Math.round(authenticity * 100) / 100,
    historicalAccuracy: Math.round(historicalAccuracy * 100) / 100,
    composite: Math.round(composite * 100) / 100,
  };
}
