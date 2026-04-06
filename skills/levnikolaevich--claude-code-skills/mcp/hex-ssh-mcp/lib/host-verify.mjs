import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Compute SHA256 fingerprint from raw host key buffer.
 * Returns "SHA256:<base64>" format (same as `ssh-keygen -lf`).
 */
function fingerprint(keyBuf) {
    return "SHA256:" + createHash("sha256").update(keyBuf).digest("base64").replace(/=+$/, "");
}

function hostCandidates(lookupHost, targetPort) {
    const candidates = new Set([lookupHost]);
    if (targetPort !== 22) candidates.add(`[${lookupHost}]:${targetPort}`);
    return [...candidates];
}

function matchesHashedHost(pattern, candidate) {
    const match = pattern.match(/^\|1\|([^|]+)\|([^|]+)$/);
    if (!match) return false;
    const salt = Buffer.from(match[1], "base64");
    const expected = Buffer.from(match[2], "base64");
    const actual = createHmac("sha1", salt).update(candidate).digest();
    return actual.length === expected.length && actual.equals(expected);
}

function hostMatches(pattern, candidates, targetPort) {
    if (pattern.startsWith("|1|")) {
        return candidates.some((candidate) => matchesHashedHost(pattern, candidate));
    }
    if (pattern.startsWith("[")) {
        const match = pattern.match(/^\[(.+)\]:(\d+)$/);
        return !!match && candidates.includes(`[${match[1]}]:${parseInt(match[2], 10)}`);
    }
    return targetPort === 22 && candidates.includes(pattern);
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
    const candidates = hostCandidates(lookupHost, targetPort);

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
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const parts = trimmed.split(/\s+/);
            if (parts.length < 3) continue;
            let hostTokenIndex = 0;
            let keyTokenIndex = 2;
            if (parts[0].startsWith("@")) {
                if (parts.length < 4) continue;
                hostTokenIndex = 1;
                keyTokenIndex = 3;
            }
            const hosts = parts[hostTokenIndex].split(",");
            const hostMatch = hosts.some((hostPattern) => hostMatches(hostPattern, candidates, targetPort));
            if (hostMatch) {
                // Compute fingerprint from stored base64 key
                const keyBuf = Buffer.from(parts[keyTokenIndex], "base64");
                allowed.add(fingerprint(keyBuf));
            }
        }
    } catch { /* known_hosts not found — rely on env only */ }

    return (key) => {
        if (allowed.size === 0) return false; // fail-closed
        return allowed.has(fingerprint(key));
    };
}
