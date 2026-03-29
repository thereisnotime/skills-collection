import { resolve } from "node:path";
import { taskPlanWorkerSummarySchema } from "../../coordinator-runtime/lib/schemas.mjs";
import {
    createPlanningManifestSchema,
    createPlanningRuntimeStore,
    createPlanningState,
} from "../../planning-runtime/lib/store.mjs";
import { PHASES } from "./phases.mjs";

const taskPlanningStore = createPlanningRuntimeStore({
    baseRootParts: [".hex-skills", "task-planning", "runtime"],
    manifestSchema: createPlanningManifestSchema("story_id"),
    normalizeManifest(manifestInput, projectRoot) {
        const storyId = manifestInput.story_id || manifestInput.identifier;
        return {
            skill: "ln-300",
            mode: manifestInput.mode || "task_planning",
            identifier: manifestInput.identifier || `story-${storyId}`,
            story_id: storyId,
            task_provider: manifestInput.task_provider || "unknown",
            auto_approve: manifestInput.auto_approve === true,
            project_root: resolve(projectRoot || process.cwd()),
            created_at: new Date().toISOString(),
        };
    },
    defaultState(manifest, runId) {
        return createPlanningState(manifest, runId, PHASES.CONFIG, {
            story_id: manifest.story_id,
            discovery_ready: false,
            ideal_plan_summary: null,
            readiness_score: null,
            readiness_findings: [],
            mode_detection: null,
            plan_result: null,
            verification_summary: null,
        });
    },
    pausedPhase: PHASES.PAUSED,
});

export const {
    checkpointPhase,
    completeRun,
    loadActiveRun,
    listActiveRuns,
    loadRun,
    pauseRun,
    readJsonFile,
    recordDecision,
    resolveRunId,
    runtimePaths,
    saveState,
    setPendingDecision,
    startRun,
    updateState,
} = taskPlanningStore;

export function recordPlan(projectRoot, runId, summary) {
    return taskPlanningStore.recordSummary(
        projectRoot,
        runId,
        summary,
        taskPlanWorkerSummarySchema,
        "task plan worker summary",
        (state, nextSummary) => ({
            ...state,
            plan_result: nextSummary,
        }),
    );
}
