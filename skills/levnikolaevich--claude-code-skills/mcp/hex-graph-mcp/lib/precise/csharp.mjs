import { providerForLanguage } from "./provider-status.mjs";
import { runExternalPreciseOverlay } from "./external.mjs";

export function runCSharpPreciseOverlay(context) {
    return runExternalPreciseOverlay({
        ...context,
        language: "c_sharp",
        descriptor: providerForLanguage("c_sharp"),
    });
}
