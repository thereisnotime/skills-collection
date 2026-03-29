import { randomUUID } from "crypto";
import type { BugCandidate, SourceType, ReporterCategory } from "./types";
import type { XPost } from "../mcp/triage-server/types";
import { classify } from "./classifier";
import { redactPii } from "./redactor";
import { scoreReporter } from "./reporter-scorer";
import type { ApprovedAccountsConfig } from "./config";

export function determineSourceType(post: XPost): SourceType {
  if (post.referenced_tweets?.some((r) => r.type === "replied_to")) return "reply";
  if (post.referenced_tweets?.some((r) => r.type === "quoted")) return "quote_post";
  // Default for posts found via mentions endpoint or search
  return "mention";
}

export function extractSymptoms(text: string): string[] {
  const symptoms: string[] = [];
  const patterns = [
    /(?:keeps?\s+)?(?:crash(?:ing|es)?|freezing|hanging|stuck)/gi,
    /(?:not\s+)?(?:loading|working|responding|connecting|saving)/gi,
    /disappear(?:ing|ed|s)?|missing|lost|gone/gi,
    /(?:can'?t|cannot|unable\s+to)\s+\w+/gi,
    /blank\s+(?:screen|page)|white\s+screen/gi,
    /slow|lag(?:gy|ging)?|unresponsive/gi,
    /broke(?:n|s)?|busted|borked/gi,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) symptoms.push(...matches.map((m) => m.toLowerCase().trim()));
  }
  return [...new Set(symptoms)];
}

export function extractErrorStrings(text: string): string[] {
  const errors: string[] = [];
  const patterns = [
    /error\s*(?:code\s*)?:?\s*\d+/gi,
    /\b(?:4\d{2}|5\d{2})\b(?:\s+error)?/gi,
    /(?:error|exception|failure|fault):\s*[^\n.]+/gi,
    /"\w+Error"/gi,
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/gi,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) errors.push(...matches.map((m) => m.trim()));
  }
  return [...new Set(errors)];
}

export function extractReproHints(text: string): string[] {
  const hints: string[] = [];
  const patterns = [
    /(?:when\s+I|if\s+you|try\s+to|after\s+I)\s+[^.!?]+/gi,
    /(?:step\s*\d|first|then|next|finally)\s*[:\-]?\s*[^.!?]+/gi,
    /(?:every\s+time|always|consistently)\s+[^.!?]+/gi,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) hints.push(...matches.map((m) => m.trim()));
  }
  return [...new Set(hints)];
}

export function extractUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s)]+/gi;
  const matches = text.match(urlPattern);
  return matches ? [...new Set(matches)] : [];
}

export function detectProductSurface(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(?:ios|iphone|ipad)\b/.test(lower)) return "mobile_ios";
  if (/\b(?:android)\b/.test(lower)) return "mobile_android";
  if (/\b(?:desktop|mac\s*app|windows\s*app|electron)\b/.test(lower)) return "desktop";
  if (/\b(?:api|endpoint|sdk|curl)\b/.test(lower)) return "api";
  if (/\b(?:web|browser|chrome|firefox|safari|website)\b/.test(lower)) return "web_app";
  return null;
}

export function detectFeatureArea(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(?:chat|message|conversation|thread)\b/.test(lower)) return "chat";
  if (/\b(?:login|auth|sign\s*in|password|sso|oauth)\b/.test(lower)) return "auth";
  if (/\b(?:upload|attach|file|image|media)\b/.test(lower)) return "upload";
  if (/\b(?:search|find|filter|query)\b/.test(lower)) return "search";
  if (/\b(?:notification|alert|push|email)\b/.test(lower)) return "notifications";
  if (/\b(?:billing|payment|subscription|plan|invoice)\b/.test(lower)) return "billing";
  if (/\b(?:profile|account|settings|preferences)\b/.test(lower)) return "account";
  if (/\b(?:render|display|layout|css|style)\b/.test(lower)) return "rendering";
  return null;
}

export function determineReporterCategory(
  authorId: string,
  authorHandle: string,
  accountsConfig: ApprovedAccountsConfig,
): ReporterCategory {
  if (accountsConfig.known_internal_accounts.includes(authorHandle) ||
      accountsConfig.known_internal_accounts.includes(authorId)) return "internal";
  if (accountsConfig.known_partner_accounts.includes(authorHandle) ||
      accountsConfig.known_partner_accounts.includes(authorId)) return "partner";
  if (accountsConfig.known_tester_accounts.includes(authorHandle) ||
      accountsConfig.known_tester_accounts.includes(authorId)) return "tester";
  return "public";
}

export function parseCandidate(
  post: XPost,
  triageRunId: string,
  accountsConfig: ApprovedAccountsConfig,
  sourceTypeOverride?: SourceType,
): BugCandidate {
  const text = post.text || "";
  const sourceType = sourceTypeOverride ?? determineSourceType(post);
  const symptoms = extractSymptoms(text);
  const errorStrings = extractErrorStrings(text);
  const reproHints = extractReproHints(text);
  const urls = extractUrls(text);
  const productSurface = detectProductSurface(text);
  const featureArea = detectFeatureArea(text);

  // Classify
  const { classification, confidence, rationale } = classify(text, symptoms, errorStrings);

  // Redact PII
  const { redactedText, piiFlags } = redactPii(text);

  // Score reporter
  const scores = scoreReporter(text, symptoms, errorStrings, reproHints, post);

  // Reporter category
  const authorHandle = post.entities?.mentions?.[0]?.username || "";
  const category = determineReporterCategory(post.author_id, authorHandle, accountsConfig);

  return {
    post_id: post.id,
    author_handle: authorHandle || post.author_id,
    author_id: post.author_id,
    timestamp: post.created_at,
    source_type: sourceType,
    product_surface: productSurface,
    feature_area: featureArea,
    symptoms,
    error_strings: errorStrings,
    repro_hints: reproHints,
    urls,
    has_media: !!(post.attachments?.media_keys?.length),
    media_keys: post.attachments?.media_keys || [],
    language: post.lang || null,
    conversation_id: post.conversation_id || null,
    thread_root_id: post.conversation_id || null,
    reply_to_id: post.in_reply_to_user_id || null,
    referenced_post_ids: post.referenced_tweets || [],
    public_metrics: post.public_metrics || null,
    classification,
    classification_confidence: confidence,
    classification_rationale: rationale,
    report_quality_score: scores.quality,
    independence_score: scores.independence,
    account_authenticity_score: scores.authenticity,
    historical_accuracy_score: scores.historicalAccuracy,
    reporter_reliability_score: scores.composite,
    reporter_category: category,
    pii_flags: piiFlags,
    raw_text_redacted: redactedText,
    raw_text_storage_policy: "store_redacted",
    triage_run_id: triageRunId,
  };
}
