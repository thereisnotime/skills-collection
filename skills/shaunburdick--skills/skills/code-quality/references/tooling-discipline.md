# Tooling Discipline

Load this when an edit or patch call fails, when choosing between a targeted
edit and a whole-file write, or when a tool name you expected does not exist.
The rules are in `SKILL.md`; this is the reasoning and the measured history
behind them.

The general rule, in every harness: **match the tool to the size and certainty
of the change, and read the whole error before acting on it.**

## Prefer tools whose failure modes are small

An edit tool that verifies your `oldString` still matches will fail when the
file moved underneath you. One that replaces the file wholesale will not.
Choose accordingly:

| Change | Prefer | Because |
| --- | --- | --- |
| Whole file, or most of it | full-file write | No content matching, so nothing to fail on |
| Small, well-understood region | targeted edit | Cheapest and most reviewable |
| Applying a diff you did not author | patch, with care | Verifies context; fails when context is stale |

The last row is the one to watch. A verified-patch tool's dominant failure is
"could not find the expected lines," which means the file changed since you
read it. Re-read the file and re-derive the change rather than retrying the
same patch — the retry costs a call and fails identically.

## Read the error, not the payload

Some harnesses return tool errors as a serialized envelope with a short
message wrapped inside a larger object that may echo your full arguments back.
A single missing argument can produce over a kilobyte of diagnostics.

- Read the **message** field and stop there
- Do not re-send the same call with a guess at a fix
- Do not let an error payload stand in for a re-read of the file — the file you
  saw before the call is not necessarily the file on disk now

## Edit from a fresh read, and never repeat an edit

`edit` failed **4.11%** (389 of 9,468 calls) in one measured window — above its
≤3.1% hold target. The failures are dominated by two self-inflicted classes:
270 edits against a region that had moved since the last read, and 52 re-sends
of a pair already on disk. Neither is retryable, so the protocol below is about
not producing them.

- **Re-read the exact target lines in the turn immediately before you edit.**
  Line numbers and surrounding context from many messages back — or from before
  a compaction — are a guess about the file. A fresh read costs one call; a
  failed `edit` costs that call plus the round trip to recover from it.
- **Never re-send an identical `oldString`/`newString` pair.** If the edit is
  already on disk, the file is correct and the second call can only fail. Say
  the change landed and move on.
- **The argument names are `path`, `oldString`, `newString`.** Other harnesses
  name them `file_path` or `file_name`; those keys are invalid here, and 49
  calls in that window died on exactly that guess.
- **`oldString` must match exactly one place.** If it is ambiguous, widen the
  surrounding context until it is not.
- **If the change is most of the file, use `write`.** An `edit` replacing 80% of
  a file is a whole-file write paying for content matching it does not need.

## Know what the tool surface actually is

Tool names are versioned and do get renamed. A directive written against an
older name silently does nothing rather than erroring usefully. Before
documenting a tool in a directive or writing one into a script, confirm it
exists in the current version.

<details>
<summary>OpenCode v2 reference (measured 2026-09-27)</summary>

| Retired (v1) | Current (v2) | Notes |
| --- | --- | --- |
| `apply_patch` | `edit`, `write`, `patch` | `edit` 3.1% error rate, `patch` 20.6% |
| `task` | `subagent` | `subagent(agent=, description=, prompt=)`; `description` is required, `prompt` is no longer positional. Adds `sessionID` and `background`. |
| `bash` | `shell` | `bash` is **gone**, not aliased — `No tool named "bash" is currently available` |

`edit` is still the best-behaved write tool, but its residual failures are a
protocol problem rather than a schema problem — see *Edit from a fresh read*
above. `patch` was 7 in 34, but that interval is [10.3%, 36.8%] — too wide to
call better or worse than v1's `apply_patch`, which sat at 26.8%.

`edit` errors arrive as a JSON envelope that echoes the full argument object
back, including file content. Read `message` only.

</details>

