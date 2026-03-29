import type { Classification } from "./types";

export interface ClassificationResult {
  classification: Classification;
  confidence: number;
  rationale: string;
}

const SARCASM_INDICATORS = [
  /(?:love|great|amazing|wonderful|fantastic|perfect)\s+(?:how|when|that)/i,
  /(?:thanks?\s+(?:for|a\s+lot))/i,
  /(?:totally|definitely|absolutely)\s+(?:not|working|broken)/i,
  /\/s\b/i,
  /(?:slow\s*clap|chef'?s?\s*kiss|🙄|😒|💀)/i,
  /(?:who\s+needs|nothing\s+like|gotta\s+love)/i,
];

const PRAISE_INDICATORS = [
  /(?:love|great|amazing|awesome|fantastic|excellent|wonderful)\s+(?:product|feature|update|work|job|tool)/i,
  /(?:thank(?:s|\s+you)|kudos|shout\s*out|props)\b/i,
  /(?:works?\s+(?:perfectly|great|well|beautifully))/i,
];

const FEATURE_REQUEST_INDICATORS = [
  /(?:would\s+be\s+(?:nice|great|awesome)|wish|please\s+add|should\s+have|need\s+(?:a|the))/i,
  /(?:feature\s+request|can\s+(?:you|we)\s+(?:add|get|have))/i,
  /(?:it\s+would\s+help|suggestion|idea)/i,
];

const BILLING_INDICATORS = [
  /(?:charged|billing|payment|subscription|refund|invoice|plan|pricing|upgrade|downgrade)/i,
];

const AUTH_INDICATORS = [
  /(?:login|log\s+in|sign\s+in|password|locked\s+out|access\s+denied|unauthorized|permission|sso|oauth|2fa|mfa)/i,
];

const POLICY_INDICATORS = [
  /(?:why\s+(?:did|does|can't|won't)|supposed\s+to|used\s+to|by\s+design|intended|not\s+a\s+bug)/i,
  /(?:censored|blocked|restricted|filtered|removed\s+my)/i,
];

const UX_INDICATORS = [
  /(?:confusing|unintuitive|hard\s+to\s+find|bad\s+ux|ui\s+is|interface|usability|cluttered)/i,
  /(?:where\s+(?:is|did)|how\s+do\s+(?:I|you)|can't\s+figure\s+out)/i,
];

const MODEL_QUALITY_INDICATORS = [
  /(?:hallucin|wrong\s+answer|incorrect\s+response|made\s+up|fabricat|refused\s+to|won't\s+answer)/i,
  /(?:model\s+(?:quality|output|response)|ai\s+(?:quality|response))/i,
];

const NOISE_INDICATORS = [
  /(?:follow\s+(?:me|back)|check\s+(?:out|my)|dm\s+(?:me|for)|giveaway|airdrop|crypto)/i,
];

function hasIndicators(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const p of patterns) {
    if (p.test(text)) count++;
  }
  return count;
}

function hasBugSignals(text: string, symptoms: string[], errorStrings: string[]): boolean {
  return symptoms.length > 0 || errorStrings.length > 0 ||
    /(?:bug|broken|crash|error|fail|issue|problem|not\s+working|doesn't\s+work)/i.test(text);
}

function isSarcastic(text: string): boolean {
  return hasIndicators(text, SARCASM_INDICATORS) >= 1;
}

export function classify(
  text: string,
  symptoms: string[],
  errorStrings: string[],
): ClassificationResult {
  const lower = text.toLowerCase();

  // Check noise first
  if (hasIndicators(text, NOISE_INDICATORS) >= 1 && !hasBugSignals(text, symptoms, errorStrings)) {
    return { classification: "noise", confidence: 0.8, rationale: "Spam or off-topic content detected" };
  }

  // Check praise
  if (hasIndicators(text, PRAISE_INDICATORS) >= 1 && !hasBugSignals(text, symptoms, errorStrings)) {
    return { classification: "praise", confidence: 0.75, rationale: "Positive feedback without bug signals" };
  }

  // Check feature request
  if (hasIndicators(text, FEATURE_REQUEST_INDICATORS) >= 1 && !hasBugSignals(text, symptoms, errorStrings)) {
    return { classification: "feature_request", confidence: 0.7, rationale: "Feature request language detected" };
  }

  // Check billing
  if (hasIndicators(text, BILLING_INDICATORS) >= 1) {
    return { classification: "billing_problem", confidence: 0.75, rationale: "Billing/payment language detected" };
  }

  // Check auth
  if (hasIndicators(text, AUTH_INDICATORS) >= 1 && hasBugSignals(text, symptoms, errorStrings)) {
    return { classification: "account_problem", confidence: 0.75, rationale: "Authentication/access issue detected" };
  }

  // Check model quality
  if (hasIndicators(text, MODEL_QUALITY_INDICATORS) >= 1) {
    return { classification: "model_quality_issue", confidence: 0.7, rationale: "Model/AI quality complaint detected" };
  }

  // Check policy mismatch
  if (hasIndicators(text, POLICY_INDICATORS) >= 1 && !hasBugSignals(text, symptoms, errorStrings)) {
    return { classification: "policy_or_expectation_mismatch", confidence: 0.6, rationale: "Policy disagreement or expectation mismatch" };
  }

  // Check UX friction
  if (hasIndicators(text, UX_INDICATORS) >= 1 && !hasBugSignals(text, symptoms, errorStrings)) {
    return { classification: "ux_friction", confidence: 0.65, rationale: "Usability complaint without clear defect" };
  }

  // Sarcastic bug report
  if (isSarcastic(text) && hasBugSignals(text, symptoms, errorStrings)) {
    return { classification: "sarcastic_bug_report", confidence: 0.7, rationale: "Bug report wrapped in sarcasm/irony" };
  }

  // Clear bug report
  if (hasBugSignals(text, symptoms, errorStrings)) {
    const confidence = Math.min(0.95, 0.5 + symptoms.length * 0.1 + errorStrings.length * 0.15);
    return { classification: "bug_report", confidence, rationale: `Bug signals: ${symptoms.length} symptoms, ${errorStrings.length} error strings` };
  }

  // User error / confusion (low-signal complaints)
  if (/(?:how\s+do\s+I|where\s+is|can't\s+find|doesn't\s+seem)/i.test(text)) {
    return { classification: "user_error_or_confusion", confidence: 0.5, rationale: "Possible user confusion or misunderstanding" };
  }

  // Fallback
  return { classification: "needs_review", confidence: 0.3, rationale: "Insufficient signal for classification" };
}
