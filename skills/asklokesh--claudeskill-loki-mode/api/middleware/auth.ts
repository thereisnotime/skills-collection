/**
 * Authentication Middleware
 *
 * Provides optional token-based authentication for the API.
 * By default, only allows localhost connections.
 */

export interface AuthConfig {
  // Allow localhost without auth (default: true)
  allowLocalhost: boolean;

  // API token for remote access (optional)
  apiToken?: string;

  // Allowed origins for CORS
  allowedOrigins: string[];
}

const defaultConfig: AuthConfig = {
  allowLocalhost: true,
  apiToken: Deno.env.get("LOKI_API_TOKEN"),
  allowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
};

let config = { ...defaultConfig };

/**
 * Configure authentication
 */
export function configureAuth(newConfig: Partial<AuthConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Authentication middleware
 */
export function authMiddleware(
  handler: (req: Request) => Promise<Response> | Response
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const authResult = checkAuth(req);

    if (!authResult.allowed) {
      return new Response(
        JSON.stringify({
          error: authResult.reason,
          code: "AUTH_FAILED",
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    return handler(req);
  };
}

/**
 * Check if request is authenticated
 */
export function checkAuth(req: Request): { allowed: boolean; reason?: string } {
  const url = new URL(req.url);
  const host = url.hostname;

  // Allow localhost connections if enabled
  if (config.allowLocalhost) {
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { allowed: true };
    }
  }

  // Check API token
  if (config.apiToken) {
    const authHeader = req.headers.get("Authorization");

    if (authHeader) {
      // Support Bearer token format
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match && match[1] === config.apiToken) {
        return { allowed: true };
      }

      // Support X-API-Key header
      const apiKey = req.headers.get("X-API-Key");
      if (apiKey === config.apiToken) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: "Invalid or missing API token",
    };
  }

  // No token configured, deny remote access
  return {
    allowed: false,
    reason: "Remote access not configured. Set LOKI_API_TOKEN to enable.",
  };
}

/**
 * Generate a secure random token
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Get current auth config (for debugging)
 */
export function getAuthConfig(): Omit<AuthConfig, "apiToken"> & {
  hasToken: boolean;
} {
  return {
    allowLocalhost: config.allowLocalhost,
    allowedOrigins: config.allowedOrigins,
    hasToken: !!config.apiToken,
  };
}
