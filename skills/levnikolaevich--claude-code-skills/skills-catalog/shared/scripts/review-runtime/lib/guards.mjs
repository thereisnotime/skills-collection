import {
    REVIEW_AGENT_STATUSES,
    REVIEW_RESOLVED_AGENT_STATUS_SET,
} from "../../coordinator-runtime/lib/runtime-constants.mjs";
import { PHASES } from "./phases.mjs";

export const RESOLVED_AGENT_STATUSES = REVIEW_RESOLVED_AGENT_STATUS_SET;

const ALLOWED_TRANSITIONS = new Map([
    [PHASES.CONFIG, new Set([PHASES.DISCOVERY])],
    [PHASES.DISCOVERY, new Set([PHASES.AGENT_LAUNCH])],
    [PHASES.AGENT_LAUNCH, new Set([PHASES.RESEARCH])],
    [PHASES.RESEARCH, new Set([PHASES.DOCS])],
    [PHASES.DOCS, new Set([PHASES.AUTOFIX, PHASES.MERGE])],
    [PHASES.AUTOFIX, new Set([PHASES.MERGE])],
    [PHASES.MERGE, new Set([PHASES.REFINEMENT])],
    [PHASES.REFINEMENT, new Set([PHASES.APPROVE, PHASES.SELF_CHECK])],
    [PHASES.APPROVE, new Set([PHASES.SELF_CHECK])],
    [PHASES.SELF_CHECK, new Set([PHASES.DONE])],
    [PHASES.PAUSED, new Set([])],
    [PHASES.DONE, new Set([])],
]);

function hasCheckpoint(checkpoints, phase) {
    return Boolean(checkpoints?.[phase]);
}

function agentsResolved(state) {
    return Object.values(state.agents || {}).every(agent => RESOLVED_AGENT_STATUSES.has(agent.status));
}

export function validateTransition(manifest, state, checkpoints, toPhase) {
    const allowed = ALLOWED_TRANSITIONS.get(state.phase);
    if (!allowed || !allowed.has(toPhase)) {
        return {
            ok: false,
            error: `Invalid transition: ${state.phase} -> ${toPhase}`,
        };
    }

    if (!hasCheckpoint(checkpoints, state.phase)) {
        return {
            ok: false,
            error: `Checkpoint missing for ${state.phase}`,
        };
    }

    if (toPhase === PHASES.RESEARCH) {
        if (!state.health_check_done) {
            return { ok: false, error: "Phase 2 health check not recorded" };
        }
        if (state.agents_available === 0 && !state.agents_skipped_reason) {
            return { ok: false, error: "Agents skipped without machine-readable reason" };
        }
        if (state.agents_available > 0 && !state.launch_ready) {
            return { ok: false, error: "No agents registered for launch" };
        }
    }

    if (toPhase === PHASES.AUTOFIX || toPhase === PHASES.MERGE) {
        if (state.phase === PHASES.DOCS && manifest.mode === "story" && !state.docs_checkpoint) {
            return { ok: false, error: "Phase 4 docs checkpoint missing \u2014 record docs_created or docs_skipped_reason" };
        }
        if (toPhase === PHASES.MERGE && manifest.mode === "story" && state.phase !== PHASES.AUTOFIX) {
            return { ok: false, error: "Story mode must pass through Phase 5 before merge" };
        }
        if (toPhase === PHASES.MERGE && state.agents_available > 0 && !agentsResolved(state)) {
            return { ok: false, error: "Not all agents are resolved" };
        }
    }

    if (toPhase === PHASES.REFINEMENT && !state.merge_summary) {
        return { ok: false, error: "Merge summary missing" };
    }

    if ((toPhase === PHASES.APPROVE || toPhase === PHASES.SELF_CHECK) && state.phase === PHASES.REFINEMENT) {
        if (!state.refinement_exit_reason) {
            return { ok: false, error: "Refinement exit reason missing \u2014 checkpoint Phase 7 with exit_reason before advancing" };
        }
        // Non-SKIPPED exit requires at least 1 iteration actually executed
        if (state.refinement_exit_reason !== "SKIPPED" && (state.refinement_iterations || 0) < 1) {
            return { ok: false, error: "Refinement exit requires iterations >= 1 \u2014 cannot claim CONVERGED/MAX_ITER without running" };
        }
        // SKIPPED is only valid when Codex was genuinely unavailable
        if (state.refinement_exit_reason === "SKIPPED" && state.agents_available > 0) {
            // Check if Codex specifically was unavailable (dead/failed/disabled)
            const codex = state.agents?.codex;
            const codexDead = codex && (codex.status === "dead" || codex.status === "failed" || codex.status === "skipped");
            if (!codexDead) {
                return { ok: false, error: "Refinement SKIPPED but Codex was available \u2014 Phase 7 is mandatory when Codex is healthy" };
            }
        }
    }

    if (toPhase === PHASES.SELF_CHECK && manifest.mode === "story" && state.phase !== PHASES.APPROVE) {
        return { ok: false, error: "Story mode requires approval checkpoint before self-check" };
    }

    if (toPhase === PHASES.DONE && !state.self_check_passed) {
        return { ok: false, error: "Self-check must pass before completion" };
    }
    if (toPhase === PHASES.DONE && !state.final_result) {
        return { ok: false, error: "Final result not recorded" };
    }

    return { ok: true };
}

export function computeResumeAction(manifest, state, checkpoints) {
    if (state.complete || state.phase === PHASES.DONE) {
        return "Run complete";
    }
    if (state.phase === PHASES.PAUSED) {
        return `Paused: ${state.paused_reason || "manual intervention required"}`;
    }
    if (!checkpoints?.[state.phase]) {
        return `Complete ${state.phase} and write its checkpoint`;
    }
    if (state.phase === PHASES.AGENT_LAUNCH && state.agents_available > 0 && !agentsResolved(state)) {
        return "Sync agent metadata until every launched agent is resolved";
    }
    if (state.phase === PHASES.MERGE && !state.merge_summary) {
        return "Record merge summary checkpoint before advancing";
    }
    if (state.phase === PHASES.SELF_CHECK && !state.self_check_passed) {
        return "Fix self-check failures, then checkpoint Phase 9 with pass=true";
    }

    const nextPhase = Array.from(ALLOWED_TRANSITIONS.get(state.phase) || []).find(phase => {
        if (phase === PHASES.AUTOFIX && manifest.mode !== "story") {
            return false;
        }
        if (phase === PHASES.APPROVE && manifest.mode !== "story") {
            return false;
        }
        return true;
    });

    return nextPhase
        ? `Advance to ${nextPhase}`
        : "No automatic resume action available";
}
