import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Compute SHA256 fingerprint from raw host key buffer.
 * Returns "SHA256:<base64>" format (same as `ssh-keygen -lf`).
 */
function fingerprint(keyBuf) {
    return "SHA256:" + createHash("sha256").update(keyBuf).digest("base64").replace(/=+$/, "");
}

/**
 * Build hostVerifier callback for ssh2.
 * Sources (checked in order):
 *   1. ALLOWED_HOST_FINGERPRINTS env - comma-separated "SHA256:<base64>" values
 *   2. ~/.ssh/known_hosts - parsed, fingerprints computed from stored keys
 * If neither has a match -> reject (fail-closed).
 * @param {string} lookupHost - Host to match in known_hosts (HostKeyAlias or resolved host)
 * @param {number} [targetPort=22] - SSH port
 */
export function buildHostVerifier(lookupHost, targetPort = 22) {
    const allowed = new Set();

    // Source 1: env var
    const envFps = process.env.ALLOWED_HOST_FINGERPRINTS;
    if (envFps) {
        for (const fp of envFps.split(",")) allowed.add(fp.trim());
    }

    // Source 2: known_hosts
    const khPath = process.env.KNOWN_HOSTS_PATH
        || resolve(homedir(), ".ssh", "known_hosts");
    try {
        const lines = readFileSync(khPath, "utf-8").split("\n");
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) continue;
            const hosts = parts[0].split(",");
            const hostMatch = hosts.some(h => {
                if (h.startsWith("[")) {
                    const m = h.match(/^\[(.+)\]:(\d+)$/);
                    return m && m[1] === lookupHost && parseInt(m[2]) === targetPort;
                }
                return h === lookupHost && targetPort === 22;
            });
            if (hostMatch) {
                // Compute fingerprint from stored base64 key
                const keyBuf = Buffer.from(parts[2], "base64");
                allowed.add(fingerprint(keyBuf));
            }
        }
    } catch { /* known_hosts not found — rely on env only */ }

    return (key) => {
        if (allowed.size === 0) return false; // fail-closed
        return allowed.has(fingerprint(key));
    };
}
