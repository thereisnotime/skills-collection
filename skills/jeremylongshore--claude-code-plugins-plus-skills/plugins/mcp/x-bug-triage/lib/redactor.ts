export interface RedactionResult {
  redactedText: string;
  piiFlags: string[];
}

// 1. Email addresses
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// 2. API keys / bearer tokens (long alphanumeric with common prefixes)
const API_KEY_PATTERN = /(?:(?:sk|pk|api|key|token|bearer|secret|auth)[-_]?)[a-zA-Z0-9_]{20,}/gi;
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9]{40,}\b/g;

// 3. Phone numbers
const PHONE_PATTERN = /(?:\+?1[-.\s]?)?(?:\(?[0-9]{3}\)?[-.\s]?)?[0-9]{3}[-.\s]?[0-9]{4}\b/g;

// 4. Account IDs / sensitive identifiers
const ACCOUNT_ID_PATTERN = /(?:account|user|customer|id)[-_:#\s]*[A-Z0-9]{6,}/gi;

// 5. URL-embedded tokens (query params with key/token/auth patterns)
const URL_TOKEN_PATTERN = /(?:[\?&])(?:key|token|auth|secret|api_key|access_token|bearer)=[^&\s]+/gi;

export function redactPii(text: string): RedactionResult {
  const piiFlags: string[] = [];
  let redacted = text;

  // 1. Emails
  if (EMAIL_PATTERN.test(redacted)) {
    piiFlags.push("email");
    redacted = redacted.replace(EMAIL_PATTERN, "[REDACTED:email]");
  }

  // 5. URL tokens (before general API key detection to avoid double-matching)
  if (URL_TOKEN_PATTERN.test(redacted)) {
    piiFlags.push("url_token");
    redacted = redacted.replace(URL_TOKEN_PATTERN, (match) => {
      const param = match.split("=")[0];
      return `${param}=[REDACTED:url_token]`;
    });
  }

  // 2. API keys / bearer tokens
  if (API_KEY_PATTERN.test(redacted)) {
    piiFlags.push("api_key");
    redacted = redacted.replace(API_KEY_PATTERN, "[REDACTED:api_key]");
  }
  // Reset regex state
  API_KEY_PATTERN.lastIndex = 0;

  // Long tokens that weren't caught by prefix-based detection
  const longMatches = redacted.match(LONG_TOKEN_PATTERN);
  if (longMatches) {
    for (const match of longMatches) {
      if (!match.includes("[REDACTED")) {
        if (!piiFlags.includes("api_key")) piiFlags.push("api_key");
        redacted = redacted.replace(match, "[REDACTED:api_key]");
      }
    }
  }

  // 3. Phone numbers
  if (PHONE_PATTERN.test(redacted)) {
    piiFlags.push("phone");
    redacted = redacted.replace(PHONE_PATTERN, "[REDACTED:phone]");
  }

  // 4. Account IDs
  if (ACCOUNT_ID_PATTERN.test(redacted)) {
    piiFlags.push("account_id");
    redacted = redacted.replace(ACCOUNT_ID_PATTERN, "[REDACTED:account_id]");
  }

  // Reset all regex lastIndex
  EMAIL_PATTERN.lastIndex = 0;
  API_KEY_PATTERN.lastIndex = 0;
  PHONE_PATTERN.lastIndex = 0;
  ACCOUNT_ID_PATTERN.lastIndex = 0;
  URL_TOKEN_PATTERN.lastIndex = 0;

  return { redactedText: redacted, piiFlags: [...new Set(piiFlags)] };
}
