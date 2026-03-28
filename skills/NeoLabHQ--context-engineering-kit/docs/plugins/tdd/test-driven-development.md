# test-driven-development - TDD Methodology Skill

Comprehensive TDD methodology and anti-pattern detection guide that ensures rigorous test-first development.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over. No exceptions.

## Red-Green-Refactor Cycle

```
    ┌─────────────────┐
    │                 │
    │   RED           │
    │   Write         │◄────────────────────┐
    │   failing test  │                     │
    │                 │                     │
    └────────┬────────┘                     │
             │                              │
             │ Verify fails correctly       │
             ▼                              │
    ┌─────────────────┐                     │
    │                 │                     │
    │   GREEN         │                     │
    │   Write minimal │                     │
    │   code to pass  │                     │
    │                 │                     │
    └────────┬────────┘                     │
             │                              │
             │ Verify all tests pass        │
             ▼                              │
    ┌─────────────────┐                     │
    │                 │                     │
    │   REFACTOR      │─────────────────────┘
    │   Clean up      │    Next test
    │   (stay green)  │
    │                 │
    └─────────────────┘
```

**RED - Write Failing Test:**
- Write one minimal test showing expected behavior
- Clear, descriptive test name
- Tests real code, not mocks

**Verify RED:**
- Run test and confirm it fails
- Failure should be for expected reason (feature missing, not typo)
- Test passes immediately? Fix the test, you're testing existing behavior

**GREEN - Minimal Code:**
- Write simplest code to pass the test
- No extra features, no over-engineering
- YAGNI (You Aren't Gonna Need It)

**Verify GREEN:**
- All tests pass
- No errors or warnings
- Other tests still green

**REFACTOR:**
- Remove duplication
- Improve names
- Extract helpers
- Keep tests passing throughout

## Testing Anti-Patterns

The skill includes comprehensive anti-pattern detection:

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| Testing mock behavior | Verifies mock works, not code | Test real component or unmock |
| Test-only methods | Pollutes production class | Move to test utilities |
| Mocking without understanding | Breaks behavior test depends on | Understand dependencies first |
| Incomplete mocks | Silent failures downstream | Mirror real API completely |
| Tests as afterthought | Proves nothing about correctness | Follow TDD - tests first |

## Common Rationalizations (Rejected)

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Already manually tested" | Ad-hoc does not equal systematic. No record, can't re-run. |
| "Deleting X hours is wasteful" | Sunk cost fallacy. Unverified code is technical debt. |
| "TDD is dogmatic" | TDD is pragmatic. Faster than debugging in production. |
