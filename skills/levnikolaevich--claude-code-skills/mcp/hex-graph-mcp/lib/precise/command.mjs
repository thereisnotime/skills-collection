import { providerDetail } from "./provider-status.mjs";

function parseOverride(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(part => typeof part === "string" && part.length > 0)) {
            return parsed;
        }
    } catch {
        // fall through
    }
    return raw.trim() ? [raw.trim()] : null;
}

export function resolveProviderCommand(descriptor) {
    if (!descriptor?.command_env || !descriptor.default_command) return descriptor?.default_command || null;
    return parseOverride(process.env[descriptor.command_env]) || descriptor.default_command;
}

export function providerCommandLabel(command) {
    return Array.isArray(command) ? command.join(" ") : String(command || "");
}

export function unavailableCommandDetail(descriptor, command, overrides = {}) {
    return providerDetail(descriptor, {
        reason: "missing_command",
        command: providerCommandLabel(command),
        ...overrides,
    });
}

