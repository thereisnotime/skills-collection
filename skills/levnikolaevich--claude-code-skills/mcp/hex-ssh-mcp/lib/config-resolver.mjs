/**
 * SSH config resolver. Parses ~/.ssh/config and resolves host aliases
 * to connection parameters (HostName, User, Port, IdentityFile[]).
 *
 * Resolution priority (mirrors OpenSSH):
 *   Explicit tool args > ~/.ssh/config > ENV vars > Defaults
 */

import SSHConfig from "ssh-config";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let cached = null; // { config, mtimeMs, path }

/**
 * Expand ~ prefix to user home directory.
 * ssh-config does NOT expand tildes — we must do it manually.
 */
function untildify(p) {
    if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
    if (p === "~") return homedir();
    return p;
}

/**
 * Load and cache SSH config. Re-parses only when file mtime changes.
 * @returns {object|null} Parsed SSHConfig or null if file missing.
 */
function loadConfig() {
    const configPath = process.env.SSH_CONFIG_PATH
        || join(homedir(), ".ssh", "config");
    try {
        const st = statSync(configPath);
        if (cached && cached.path === configPath && cached.mtimeMs === st.mtimeMs) {
            return cached.config;
        }
        const content = readFileSync(configPath, "utf-8");
        const config = SSHConfig.parse(content);
        cached = { config, mtimeMs: st.mtimeMs, path: configPath };
        return config;
    } catch (err) {
        if (err.code === "ENOENT") return null;
        throw new Error(`SSH_CONFIG_ERROR: failed to parse ${configPath}: ${err.message}`);
    }
}

/**
 * Resolve host alias to connection parameters via ~/.ssh/config.
 *
 * @param {string} hostInput - Host alias or hostname/IP from tool call
 * @param {object} [explicitArgs] - Explicit tool args (override config values)
 * @param {string} [explicitArgs.user]
 * @param {number} [explicitArgs.port]
 * @param {string} [explicitArgs.privateKeyPath]
 * @returns {{ host, user, port, privateKeyPath, identityFiles, hostKeyAlias, originalHost }}
 */
export function resolveHost(hostInput, explicitArgs = {}) {
    const config = loadConfig();
    if (!config) {
        return {
            host: hostInput,
            user: explicitArgs.user,
            port: explicitArgs.port || 22,
            privateKeyPath: explicitArgs.privateKeyPath,
            identityFiles: [],
            hostKeyAlias: undefined,
            originalHost: hostInput,
        };
    }

    const computed = config.compute(hostInput);

    // Reject unsupported proxy directives (ssh2 cannot handle them)
    if (computed.ProxyJump || computed.ProxyCommand) {
        throw new Error(
            `UNSUPPORTED_SSH_CONFIG: host "${hostInput}" requires ` +
            `${computed.ProxyJump ? "ProxyJump" : "ProxyCommand"} ` +
            "which hex-ssh does not support. Connect directly or remove the directive."
        );
    }

    // Expand tilde in IdentityFile paths (ssh-config returns raw strings)
    const rawFiles = computed.IdentityFile || [];
    const identityFiles = (Array.isArray(rawFiles) ? rawFiles : [rawFiles])
        .map(untildify);

    return {
        host: explicitArgs.host != null && explicitArgs.host !== hostInput
            ? explicitArgs.host : (computed.HostName || hostInput),
        user: explicitArgs.user || computed.User,
        port: explicitArgs.port || (computed.Port ? parseInt(computed.Port, 10) : 22),
        privateKeyPath: explicitArgs.privateKeyPath,
        identityFiles,
        hostKeyAlias: computed.HostKeyAlias,
        originalHost: hostInput,
    };
}
