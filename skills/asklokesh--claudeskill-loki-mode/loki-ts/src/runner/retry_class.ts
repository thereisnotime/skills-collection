// loki-ts/src/runner/retry_class.ts -- v8 harness intelligence (3d).
//
// SMART RETRY: distinguish a TRANSIENT failure (worth retrying) from a
// NON-RETRYABLE one (retrying only burns tokens and wall-clock).
//
// The loop previously treated every non-zero exit identically: back off, retry,
// repeat until maxRetries. That is correct for a rate limit or a network blip
// and actively wasteful for an auth failure or an unknown-model error, where
// every retry is a guaranteed-identical failure. jcode's discipline is to stop
// early on a non-retryable error and SAVE the budget for real work.
//
// FAIL-SAFE DIRECTION, and this is the property that matters most here: an
// UNRECOGNIZED failure classifies as TRANSIENT, i.e. it keeps retrying, which
// is exactly today's behavior. Only a positively-identified permanent error
// stops early. So a bad guess costs a retry (cheap, the status quo); it can
// never abandon a build that would have succeeded. Never invert this default.

export type RetryClass = "transient" | "non_retryable";

// Positively-identified PERMANENT failures. Every pattern here must describe a
// condition that CANNOT change by retrying the identical request:
//   - credentials absent/invalid  -> same result every time
//   - a model/endpoint that does not exist -> same result every time
//   - a malformed request the engine itself built -> same result every time
//   - hard quota exhaustion (distinct from a rate limit, which IS transient)
//
// Deliberately conservative. Anything ambiguous is left out so it falls through
// to transient. A false "non_retryable" is the expensive mistake (it abandons
// recoverable work); a false "transient" merely costs one more retry.
const NON_RETRYABLE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["auth", /\b(?:invalid[_ -]?api[_ -]?key|unauthorized|authentication[_ -]?(?:failed|error)|401\b|invalid[_ -]?x-api-key|permission[_ -]?denied|403\b)/i],
  ["unknown_model", /\b(?:model[_ -]?not[_ -]?found|unknown[_ -]?model|invalid[_ -]?model|does not exist.{0,20}model)/i],
  ["bad_request", /\b(?:invalid[_ -]?request[_ -]?error|malformed[_ -]?request|400\b.{0,40}invalid)/i],
  // "quota"/"billing" = the account is out of funds; unlike a rate limit this
  // does not clear on its own within a run.
  ["quota_exhausted", /\b(?:insufficient[_ -]?(?:quota|credit|funds)|billing[_ -]?(?:hard[_ -]?limit|issue)|credit[_ -]?balance[_ -]?(?:is[_ -]?)?too[_ -]?low|payment[_ -]?required|402\b)/i],
];

// Explicitly TRANSIENT markers that must win even if a permanent-looking word
// appears nearby. A rate limit is the classic case: it often carries a 4xx and
// quota-adjacent wording, but it absolutely does clear with time, and treating
// it as permanent would abandon healthy builds.
const TRANSIENT_OVERRIDE =
  /\b(?:rate[_ -]?limit|429\b|overloaded|please try again|temporarily unavailable|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|502\b|503\b|504\b|service unavailable)/i;

export type RetryDecision = {
  readonly klass: RetryClass;
  /** Which rule matched, for logs/telemetry. "unrecognized" when none did. */
  readonly reason: string;
};

export function classifyFailure(text: string): RetryDecision {
  const t = text ?? "";
  if (t.trim() === "") return { klass: "transient", reason: "empty_output" };

  // Transient overrides are checked FIRST so a rate limit is never mistaken for
  // a permanent quota failure.
  if (TRANSIENT_OVERRIDE.test(t)) return { klass: "transient", reason: "transient_marker" };

  for (const [reason, re] of NON_RETRYABLE_PATTERNS) {
    if (re.test(t)) return { klass: "non_retryable", reason };
  }

  // Unrecognized -> retry, preserving existing behavior exactly.
  return { klass: "transient", reason: "unrecognized" };
}

// Should the loop stop retrying now? DEFAULT ON; disable with
// LOKI_SMART_RETRY=0 to restore the retry-everything behavior verbatim.
export function shouldStopRetrying(
  decision: RetryDecision,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env["LOKI_SMART_RETRY"] === "0") return false;
  return decision.klass === "non_retryable";
}
