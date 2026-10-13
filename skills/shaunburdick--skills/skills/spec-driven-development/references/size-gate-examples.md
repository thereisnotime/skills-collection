# Size Gate: Worked Examples

The three Small-lane checks are in `SKILL.md`. These are the examples that
show how they fall, for when a case is not obvious.

## Examples

| Change | 1 · ACs unaided | 2 · Breaks a consumed contract | 3 · One revert | Lane |
|---|---|---|---|---|
| Add a display name to an existing field | yes | no — additive | yes | **Small** |
| Typo fix in a doc | yes | no | yes | **Small** |
| Add an optional field to a public response | yes | no — additive | yes | **Small** |
| Change what an existing field means | yes | yes | yes | **Full** |
| New feature reaching 40% of the work | no — open questions | yes | no | **Full** |

Answer check 1 by trying: draft the criteria. It takes seconds and cannot be
argued with, which is the point — a change with ten open questions does not pass
by asserting it has none.

**Scale is not the gate.** A 40-file mechanical refactor with no open questions
and no contract change is Small: its spec would contain no information, and what
it actually needs is better tests. Conversely a 5-line change that breaks a
consumed API is Full. If the checks pass but the diff is enormous, that is a
large *diff*, not a complex *change*. File and line counts make a reasonable
"this is probably not Small" nag; they are not the gate.

## A premise that was half right

A real example: GitHub's
issue-event object does carry `actor` ("the person who generated the event"),
so a design that assumed issue history could not be attributed was wrong — but
`commented` events do *not* use that common shape and carry `user` instead. An
implementation reading `event.actor.login` would work on most events and return
null on every comment. One API read surfaces both halves; a memory-only
assumption surfaces neither.

