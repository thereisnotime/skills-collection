# What a Good Test Looks Like

Companion to *Tests — the one rule* in `SKILL.md`. That rule says when a test
earns its place; this says what it looks like once it does. Adapted from the
`test-reviewer` skill in
[pertrai1/eslint-plugin-llm-core](https://github.com/pertrai1/eslint-plugin-llm-core)
(MIT), with its per-suite minimums removed.

## State the outcome, do not recompute it

A test that derives its expected value with the same filter, map, conditional,
or string-building as the implementation runs the code twice and checks
nothing. Hard-code the expected output. If you cannot, the case is too big;
split it.

```typescript
// ❌ mirrors the implementation
const expected = users.filter((u) => u.isActive && !u.isDeleted);
expect(getActiveUsers(users)).toEqual(expected);

// ✅ states the outcome
expect(getActiveUsers(users)).toEqual([{ id: "1", isActive: true, isDeleted: false }]);
```

## Assert specific values

`toBeDefined()`, `toBeTruthy()`, `not.toBeNull()` and most negated assertions
pass for wrong values too. Say what the value *is*. A weak assertion is
acceptable only as a guard before a strong one, or for a boolean function
that should return `true`.

```typescript
// ❌ passes for any non-undefined value
expect(user).toBeDefined();

// ✅ only the correct shape passes
expect(user).toEqual({ id: expect.any(String), name: "Alice", email: "alice@test.com" });
```

## Assert outcomes, not mock calls

`expect(mock).toHaveBeenCalledWith(...)` with no assertion on the result tests
the test's own setup. Capture what the system did (returned value, persisted
record, emitted event, message handed to a fake) and assert on that. Mock-call
assertions are fine as an addition, for a side effect with no observable
result, or to prove something was *not* called.

## Edge cases where the code has a branch

Flag a missing empty, null, boundary, or error case only when the code under
test has a branch for it and no test exercises that branch. A function with no
null handling needs no null test. A test for a case the code does not
distinguish is redundant, and removing it is a valid finding.

## Descriptive over DRY

Some duplication in tests is correct. A shared helper or fixture factory that
hides the behaviour under test, forces the reader through indirection, or
makes many tests fail for one helper change costs more than the lines it
saves.

## Outcomes, not internals

Prefer observable state, returned values, rendered output, persisted records,
emitted events. A test that asserts private methods, call order, or framework
behaviour breaks on refactors that change nothing a user can see.

## Isolation

No dependence on execution order, shared mutable state, real time, random
data, network, or external services unless explicitly controlled. A flaky test
costs more trust than it protects.

## Names describe behaviour

`works`, `handles errors`, `test 3` say nothing. The name is the behaviour
being verified, from the user's or caller's side, so a failure reads as a
specification that stopped being true.
