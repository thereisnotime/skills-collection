# german-elster-tax-filing

Interactive intake skill for German personal income tax filing in ELSTER (tax year 2024+).

## What this skill does

- Runs a complete tax intake questionnaire
- Verifies year-specific ELSTER fields and line numbers using official sources
- Produces:
  1. an estimated tax result
  2. a form-by-form ELSTER mapping with exact fields

## Scope

- Tax years: 2024 onward
- Filing context: German personal income tax
- Output style: structured estimate plus explicit ELSTER field mapping

## Required references in this skill

- `skills/german-elster-tax-filing/references/required-information.md`
- `skills/german-elster-tax-filing/references/output-template.md`

The workflow in `skills/german-elster-tax-filing/SKILL.md` expects both files and uses them as the checklist + output contract.

## How to use it

This skill is intentionally interview-driven. It should start by asking for the tax year, then continue with follow-up questions until every required category has an explicit answer.

Example prompts:

```text
Use german-elster-tax-filing and ask me everything needed for my 2025 return.
```

```text
Use german-elster-tax-filing to estimate my tax result and map each value to ELSTER forms and line numbers.
```

```text
I uploaded my certificates. Use german-elster-tax-filing, extract what you can, then ask only for missing values.
```

## Expected workflow

1. Ask tax year first.
2. Cover all income/deduction categories from `skills/german-elster-tax-filing/references/required-information.md`.
3. Ask follow-ups until no required category is unresolved.
4. Verify year-specific rules and line numbers from official sources.
5. Produce final output using `skills/german-elster-tax-filing/references/output-template.md`.

## Important rules

- Do not assume missing values are zero.
- Do not finalize mapping with unresolved required inputs.
- Treat the calculation as an estimate, not a legally binding result.
- Cite official sources for year-specific thresholds, fields, and line numbers.

## Notes

- `skills/german-elster-tax-filing/SKILL.md` contains the strict questioning rules, source constraints, and output requirements.
