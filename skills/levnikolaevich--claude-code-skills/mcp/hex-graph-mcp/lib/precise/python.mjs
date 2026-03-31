import { providerForLanguage } from "./provider-status.mjs";
import { runExternalPreciseOverlay } from "./external.mjs";

export function runPythonPreciseOverlay(context) {
    return runExternalPreciseOverlay({
        ...context,
        language: "python",
        descriptor: providerForLanguage("python"),
    });
}

