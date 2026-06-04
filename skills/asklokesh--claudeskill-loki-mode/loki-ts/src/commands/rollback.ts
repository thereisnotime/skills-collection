// v7.5.2: `loki rollback` CLI command.
//
// Wires the checkpoint rollback API at loki-ts/src/runner/checkpoint.ts which
// shipped in Phase 4 of Part A but had no user-visible entry point. Pre-v7.5.2
// the entire rollback surface (readCheckpoint, listCheckpoints,
// rollbackToCheckpoint, executeRollback) was tested but unreachable from a
// real `loki <command>` invocation -- bug-hunt H4 (dead code) finding F4.
//
// Subcommands:
//   loki rollback list                    -- list checkpoints
//   loki rollback show <id>               -- print metadata for one checkpoint
//   loki rollback to <id>                 -- restore to that checkpoint
//   loki rollback latest                  -- restore to the most recent checkpoint

import {
  listCheckpoints,
  readCheckpoint,
  rollbackToCheckpoint,
  executeRollbackWithSnapshot,
} from "../runner/checkpoint.ts";
import { BOLD, CYAN, GREEN, NC, RED, YELLOW } from "../util/colors.ts";

const HELP = `Usage: loki rollback <subcommand>

Subcommands:
  list                   List checkpoints (newest first)
  show <id>              Print metadata for one checkpoint
  to <id>                Restore .loki/ state + context to that checkpoint
  latest                 Restore to the most recent checkpoint

Restored automatically (safe, non-code):
  .loki/state/orchestrator.json
  .loki/queue/{pending,completed,in-progress,current-task}.json
  .loki/CONTINUITY.md            (iteration / conversation handoff context)

Re-undoable: every rollback first captures a forced pre-rollback snapshot of
your current state, so you can always undo the undo (the snapshot id is printed).

Source code is NOT touched by this command. To also restore the working tree
to the checkpoint's snapshot (if one was anchored at checkpoint time):
  git stash apply refs/loki/cp/<id>

Re-run \`loki start\` to resume from the restored state.
`;

export async function runRollback(argv: readonly string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    process.stdout.write(HELP);
    return sub === undefined ? 1 : 0;
  }

  switch (sub) {
    case "list": {
      // listCheckpoints returns oldest-first; reverse so users see newest at
      // the top (matches the "latest" subcommand semantics below).
      const items = [...listCheckpoints()].reverse();
      if (items.length === 0) {
        process.stdout.write(`${YELLOW}No checkpoints found.${NC}\n`);
        return 0;
      }
      process.stdout.write(`${BOLD}Checkpoints${NC} (${items.length}, newest first):\n`);
      for (const m of items) {
        process.stdout.write(
          `  ${CYAN}${m.id}${NC}  iter=${m.iteration}  ${m.git_branch || "(no branch)"}@${(m.git_sha || "").slice(0, 7)}  ${m.timestamp}\n`,
        );
      }
      return 0;
    }

    case "show": {
      const id = rest[0];
      if (!id) {
        process.stderr.write(`${RED}Missing checkpoint id.${NC} Use \`loki rollback list\`.\n`);
        return 2;
      }
      try {
        const m = readCheckpoint(id);
        process.stdout.write(`${JSON.stringify(m, null, 2)}\n`);
        return 0;
      } catch (err) {
        process.stderr.write(`${RED}Failed to read checkpoint:${NC} ${(err as Error).message}\n`);
        return 1;
      }
    }

    case "to": {
      const id = rest[0];
      if (!id) {
        process.stderr.write(`${RED}Missing checkpoint id.${NC} Use \`loki rollback list\`.\n`);
        return 2;
      }
      return await executePlan(id, rest.includes("--force"));
    }

    case "latest": {
      // listCheckpoints returns oldest-first, so the latest is the last entry.
      const items = listCheckpoints();
      const latest = items[items.length - 1];
      if (!latest) {
        process.stderr.write(`${RED}No checkpoints found to roll back to.${NC}\n`);
        return 1;
      }
      process.stdout.write(`Rolling back to latest checkpoint: ${CYAN}${latest.id}${NC}\n`);
      return await executePlan(latest.id, rest.includes("--force"));
    }

    default:
      process.stderr.write(`Unknown subcommand: ${sub}\n`);
      process.stderr.write(HELP);
      return 2;
  }
}

async function executePlan(id: string, force = false): Promise<number> {
  let plan;
  try {
    plan = rollbackToCheckpoint(id);
  } catch (err) {
    process.stderr.write(`${RED}Cannot plan rollback:${NC} ${(err as Error).message}\n`);
    return 1;
  }
  if (plan.restore.length === 0) {
    process.stdout.write(
      `${YELLOW}Checkpoint ${id} has no restorable state files; nothing to do.${NC}\n`,
    );
    return 0;
  }
  // R6: force a pre-rollback snapshot first, so this restore is itself undoable.
  // If that snapshot fails, executeRollbackWithSnapshot aborts (no destructive
  // restore without a safety net) unless --force is passed.
  let result;
  try {
    result = await executeRollbackWithSnapshot(plan, undefined, force);
  } catch (err) {
    process.stderr.write(`${RED}Rollback aborted:${NC} ${(err as Error).message}\n`);
    return 1;
  }
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      process.stderr.write(`${RED}restore error:${NC} ${e}\n`);
    }
    process.stderr.write(
      `${RED}Partial rollback: ${result.restored}/${plan.restore.length} files restored.${NC}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `${GREEN}Rolled back ${result.restored}/${plan.restore.length} state files from ${id}.${NC}\n`,
  );
  if (result.preRollbackSnapshotId) {
    process.stdout.write(
      `Saved your prior state as ${CYAN}${result.preRollbackSnapshotId}${NC}; undo this rollback with \`loki rollback to ${result.preRollbackSnapshotId}\`.\n`,
    );
  }
  process.stdout.write(`Run \`loki start\` to resume from the restored state.\n`);
  return 0;
}
