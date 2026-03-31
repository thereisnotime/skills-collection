import { createRuntimeStore, readJsonFile } from "../../coordinator-runtime/lib/core.mjs";
import { pendingDecisionSchema } from "../../coordinator-runtime/lib/schemas.mjs";
import { assertSchema } from "../../coordinator-runtime/lib/validate.mjs";

const BASE_MANIFEST_PROPERTIES = {
    skill: { type: "string" },
    mode: { type: "string" },
    identifier: { type: "string" },
    task_provider: { type: "string" },
    auto_approve: { type: "boolean" },
    project_root: { type: "string" },
    created_at: { type: "string", format: "date-time" },
};

export function createPlanningManifestSchema(identifierField) {
    return {
        type: "object",
        required: ["skill", "identifier", "project_root", "created_at"],
        properties: {
            ...BASE_MANIFEST_PROPERTIES,
            [identifierField]: { type: "string" },
        },
    };
}

export function createPlanningState(manifest, runId, phase, extraState = {}) {
    return {
        run_id: runId,
        skill: manifest.skill,
        mode: manifest.mode,
        identifier: manifest.identifier,
        phase,
        complete: false,
        paused_reason: null,
        pending_decision: null,
        decisions: [],
        final_result: null,
        self_check_passed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...extraState,
    };
}

export function createPlanningRuntimeStore({
    baseRootParts,
    manifestSchema,
    normalizeManifest,
    defaultState,
    pausedPhase,
    resumablePhases,
}) {
    const store = createRuntimeStore({
        baseRootParts,
        manifestSchema,
        normalizeManifest,
        defaultState,
    });

    function setPendingDecision(projectRoot, runId, pendingDecision, reason = "Decision required") {
        const run = store.loadRun(projectRoot, runId);
        if (!run) {
            return { ok: false, error: "Run not found" };
        }
        const validation = assertSchema(pendingDecisionSchema, pendingDecision, "pending decision");
        if (!validation.ok) {
            return validation;
        }
        if (resumablePhases && !resumablePhases.has(pendingDecision.resume_to_phase)) {
            return { ok: false, error: `Invalid resume_to_phase: ${pendingDecision.resume_to_phase}` };
        }
        return store.updateState(projectRoot, runId, state => ({
            ...state,
            phase: pausedPhase,
            paused_reason: reason,
            pending_decision: pendingDecision,
        }), { eventType: "RUN_PAUSED" });
    }

    function recordDecision(projectRoot, runId, decision) {
        const run = store.loadRun(projectRoot, runId);
        if (!run) {
            return { ok: false, error: "Run not found" };
        }
        if (!run.state.pending_decision) {
            return { ok: false, error: "No pending decision recorded" };
        }
        if (resumablePhases && !resumablePhases.has(run.state.pending_decision.resume_to_phase)) {
            return { ok: false, error: `Invalid resume_to_phase: ${run.state.pending_decision.resume_to_phase}` };
        }
        const choices = run.state.pending_decision.choices || [];
        if (choices.length > 0 && !choices.includes(decision.selected_choice)) {
            return { ok: false, error: `Invalid selected_choice: ${decision.selected_choice}. Valid: ${choices.join(", ")}` };
        }
        const nextDecision = {
            kind: run.state.pending_decision.kind,
            selected_choice: decision.selected_choice,
            answered_at: new Date().toISOString(),
            context: decision.context || {},
        };
        return store.updateState(projectRoot, runId, state => ({
            ...state,
            phase: state.pending_decision.resume_to_phase,
            paused_reason: null,
            pending_decision: null,
            decisions: [...(state.decisions || []), nextDecision],
        }));
    }

    function recordSummary(projectRoot, runId, summary, schema, label, reducer) {
        const run = store.loadRun(projectRoot, runId);
        if (!run) {
            return { ok: false, error: "Run not found" };
        }
        const validation = assertSchema(schema, summary, label);
        if (!validation.ok) {
            return validation;
        }
        return store.updateState(projectRoot, runId, state => reducer(state, summary));
    }

    return {
        ...store,
        setPendingDecision,
        recordDecision,
        recordSummary,
        readJsonFile,
    };
}
