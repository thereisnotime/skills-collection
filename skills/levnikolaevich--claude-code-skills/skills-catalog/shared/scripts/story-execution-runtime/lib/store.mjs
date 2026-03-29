import { resolve } from "node:path";
import {
    createRuntimeStore,
    readJsonFile,
} from "../../coordinator-runtime/lib/core.mjs";
import {
    storyGroupRecordSchema,
    storyTaskRecordSchema,
} from "../../coordinator-runtime/lib/schemas.mjs";
import {
    STORY_EXECUTION_GROUP_STATUSES,
    TASK_BOARD_STATUSES,
} from "../../coordinator-runtime/lib/runtime-constants.mjs";
import { assertSchema } from "../../coordinator-runtime/lib/validate.mjs";
import { PHASES } from "./phases.mjs";

const executionManifestSchema = {
    type: "object",
    required: ["skill", "identifier", "story_id", "project_root", "created_at"],
    properties: {
        skill: { type: "string" },
        mode: { type: "string" },
        identifier: { type: "string" },
        story_id: { type: "string" },
        task_provider: { type: "string" },
        project_root: { type: "string" },
        worktree_dir: { type: "string" },
        branch: { type: "string" },
        execution_mode: { type: "string" },
        task_inventory_snapshot: { type: "array" },
        parallel_group_policy: { type: "object" },
        status_transition_policy: { type: "object" },
        created_at: { type: "string", format: "date-time" },
    },
};

const executionStore = createRuntimeStore({
    baseRootParts: [".hex-skills", "story-execution", "runtime"],
    manifestSchema: executionManifestSchema,
    normalizeManifest(manifestInput, projectRoot) {
        return {
            skill: "ln-400",
            mode: manifestInput.mode || "story_execution",
            identifier: manifestInput.story_id || manifestInput.identifier,
            story_id: manifestInput.story_id || manifestInput.identifier,
            task_provider: manifestInput.task_provider || "unknown",
            project_root: resolve(projectRoot || process.cwd()),
            worktree_dir: manifestInput.worktree_dir || null,
            branch: manifestInput.branch || null,
            execution_mode: manifestInput.execution_mode || "execute",
            task_inventory_snapshot: manifestInput.task_inventory_snapshot || [],
            parallel_group_policy: manifestInput.parallel_group_policy || {},
            status_transition_policy: manifestInput.status_transition_policy || {},
            created_at: new Date().toISOString(),
        };
    },
    defaultState(manifest, runId) {
        return {
            run_id: runId,
            skill: manifest.skill,
            mode: manifest.mode,
            identifier: manifest.identifier,
            story_id: manifest.story_id,
            phase: PHASES.CONFIG,
            complete: false,
            paused_reason: null,
            pending_decision: null,
            decisions: [],
            current_task_id: null,
            current_group_id: null,
            processable_counts: {
                todo: 0,
                to_review: 0,
                to_rework: 0,
            },
            rework_counter_by_task: {},
            inflight_workers: {},
            tasks: {},
            groups: {},
            worktree_ready: false,
            worktree_dir: manifest.worktree_dir,
            branch: manifest.branch,
            story_transition_done: false,
            self_check_passed: false,
            final_result: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
    },
});

export const {
    checkpointPhase,
    completeRun,
    loadActiveRun,
    listActiveRuns,
    loadRun,
    pauseRun,
    resolveRunId,
    runtimePaths,
    saveState,
    startRun,
    updateState,
} = executionStore;

export function recordTask(projectRoot, runId, taskRecord) {
    const run = loadRun(projectRoot, runId);
    if (!run) {
        return { ok: false, error: "Run not found" };
    }
    const validation = assertSchema(storyTaskRecordSchema, taskRecord, "story task record");
    if (!validation.ok) {
        return validation;
    }
    return updateState(projectRoot, runId, state => {
        const nextCounters = { ...state.rework_counter_by_task };
        if (taskRecord.to_status === TASK_BOARD_STATUSES.TO_REWORK) {
            nextCounters[taskRecord.task_id] = Number(nextCounters[taskRecord.task_id] || 0) + 1;
        } else if (taskRecord.to_status === TASK_BOARD_STATUSES.DONE) {
            nextCounters[taskRecord.task_id] = 0;
        }
        return {
            ...state,
            current_task_id: taskRecord.task_id,
            tasks: {
                ...state.tasks,
                [taskRecord.task_id]: {
                    task_id: taskRecord.task_id,
                    worker: taskRecord.worker || null,
                    result: taskRecord.result || null,
                    from_status: taskRecord.from_status || null,
                    to_status: taskRecord.to_status || null,
                    tests_run: taskRecord.tests_run || [],
                    files_changed: taskRecord.files_changed || [],
                    error: taskRecord.error || null,
                    completed_at: taskRecord.completed_at || new Date().toISOString(),
                },
            },
            rework_counter_by_task: nextCounters,
        };
    });
}

export function recordGroup(projectRoot, runId, groupRecord) {
    const run = loadRun(projectRoot, runId);
    if (!run) {
        return { ok: false, error: "Run not found" };
    }
    const validation = assertSchema(storyGroupRecordSchema, groupRecord, "story group record");
    if (!validation.ok) {
        return validation;
    }
    return updateState(projectRoot, runId, state => ({
        ...state,
        current_group_id: groupRecord.group_id,
        inflight_workers: groupRecord.inflight_workers || {},
        groups: {
            ...state.groups,
            [groupRecord.group_id]: {
                group_id: groupRecord.group_id,
                task_ids: groupRecord.task_ids || [],
                status: groupRecord.status || STORY_EXECUTION_GROUP_STATUSES.COMPLETED,
                result: groupRecord.result || null,
                completed_at: groupRecord.completed_at || new Date().toISOString(),
            },
        },
    }));
}

export {
    readJsonFile,
};
