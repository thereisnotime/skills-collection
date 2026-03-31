import { providerForLanguage } from "./provider-status.mjs";
import { runExternalPreciseOverlay } from "./external.mjs";

export function runPhpPreciseOverlay(context) {
    return runExternalPreciseOverlay({
        ...context,
        language: "php",
        descriptor: providerForLanguage("php"),
    });
}
