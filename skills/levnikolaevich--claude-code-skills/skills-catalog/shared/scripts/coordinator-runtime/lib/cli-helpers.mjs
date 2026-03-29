export function outputJson(data) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function failJson(message, code = 2) {
    process.stderr.write(JSON.stringify({ ok: false, error: message }) + "\n");
    process.exit(code);
}

export function failResult(result, code = 2) {
    if (typeof result === "string") {
        failJson(result, code);
    }
    process.stderr.write(JSON.stringify({ ok: false, ...result }) + "\n");
    process.exit(code);
}

export function readPayload(values, readJsonFile) {
    if (values["payload-file"]) {
        const payload = readJsonFile(values["payload-file"]);
        if (payload == null) {
            failJson(`Unable to read payload file: ${values["payload-file"]}`);
        }
        return payload;
    }
    if (!values.payload) {
        return {};
    }
    try {
        return JSON.parse(values.payload);
    } catch (error) {
        failJson(`Invalid JSON payload: ${error.message}`);
    }
}

export function readManifestOrFail(values, readJsonFile, flagName = "manifest-file") {
    const filePath = values[flagName];
    const manifest = readJsonFile(filePath);
    if (manifest == null) {
        failJson(`Manifest file not found or invalid: ${filePath}`);
    }
    return manifest;
}

function buildRuntimeMeta(run, stateOverride = null) {
    const state = stateOverride || run.state;
    return {
        skill: run.manifest.skill,
        identifier: run.manifest.identifier,
        run_id: state.run_id,
        phase: state.phase,
        complete: state.complete,
    };
}

export function outputInactiveRuntime(output) {
    output({
        ok: true,
        active: false,
        runtime: null,
    });
}

export function outputRuntimeStatus(output, projectRoot, run, runtimePaths, computeResumeAction) {
    output({
        ok: true,
        active: !run.state.complete,
        runtime: buildRuntimeMeta(run),
        manifest: run.manifest,
        state: run.state,
        checkpoints: run.checkpoints,
        paths: runtimePaths(projectRoot, run.state.run_id, run.manifest.skill, run.manifest.identifier),
        resume_action: computeResumeAction(run.manifest, run.state, run.checkpoints),
    });
}

export function outputRuntimeState(output, run, state, extra = {}) {
    output({
        ok: true,
        runtime: buildRuntimeMeta(run, state),
        state,
        ...extra,
    });
}

export function outputGuardFailure(output, guard) {
    output({
        ok: false,
        error: guard.error || "Transition blocked",
        validation_errors: guard.details || [],
        guard,
    });
    process.exit(1);
}
