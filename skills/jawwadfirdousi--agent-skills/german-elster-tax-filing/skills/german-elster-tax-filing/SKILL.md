---
name: german-elster-tax-filing
description: gather all information needed to prepare a german personal income tax return in elster for tax years 2024 onward. use when the user wants a questionnaire-style intake, a tax estimate, or a form-by-form elster mapping with exact fields and line numbers. ask for the tax year first, then continue asking follow-up questions about filing status, employment, self-employment, business income, benefits, capital gains, foreign income, rental income, insurance, travel, home office, work equipment, internet, and other deductible costs until every required item has an explicit answer.
---

# German Elster Tax Filing

## Overview

Use this skill to run a complete intake for a german personal income tax return in elster for tax years 2024 onward, estimate the tax result, and map the final values into the correct official forms and fields.

Read [references/required-information.md](references/required-information.md) at the start of every case. Use [references/output-template.md](references/output-template.md) when producing the final answer.

## Workflow

1. Ask for the tax year first.
2. Determine which income and deduction categories may apply by following the checklist in `references/required-information.md`.
3. Keep asking follow-up questions until every required category has an explicit answer.
4. Review uploaded documents before asking the user for values that can already be extracted from those documents.
5. Verify year-specific rules, thresholds, deadlines, and line numbers using official public sources for the selected tax year.
6. Calculate the tax estimate and then produce a complete elster field mapping.

## Questioning rules

Ask in small batches, but do not stop the intake early.

Treat a category as complete only when the user has explicitly given one of these answers:
- a concrete value or date range
- yes or no
- not applicable / none
- already taxed / already reimbursed
- unknown after checking the relevant document

Do not silently assume zero just because the user did not mention an item.

When the user gives partial information, ask the minimum follow-up questions needed to make the field usable. Examples:
- home office needs both the period and the setup
- work equipment needs cost, purchase date, and work-use share when relevant
- commuting needs days, one-way distance, and whether actual public transport costs should be used instead
- capital gains need the certificate values and whether german withholding already occurred

## Official-source rules

Use only official public sources for tax-law and elster guidance. Prefer these domains:
- `elster.de`
- `bundesfinanzministerium.de`
- `esth.bundesfinanzministerium.de`
- `lsth.bundesfinanzministerium.de`
- `gesetze-im-internet.de`
- `arbeitsagentur.de`
- official state tax administration sites only when the primary sources above do not cover the needed operational detail

Do not rely on memory for year-specific facts such as:
- elster line numbers and field labels
- annual lump sums and thresholds
- tax-table changes
- progression-benefit treatment
- deadlines and late-filing rules

Always verify those with official sources for the selected year and cite them in the final answer.

## Form-mapping rules

Build the mapping only after the intake is complete.

For each item, provide:
- form name
- section name in elster
- exact line number or field label for the selected year
- value to enter
- short reason for why it belongs there

Do not reuse prior-year line numbers without checking the selected year.

If a value is usually transferred automatically from certificates, still state the field and note that the user should verify the imported value instead of entering it twice.

## Calculation rules

Show the estimate as an estimate, not as a legally binding result.

Separate the calculation into:
- taxable income by source
- tax-free but progression-relevant items
- deductions and allowances
- taxes already withheld or prepaid
- estimated refund or amount due

If a necessary input remains unresolved, say exactly which number blocks the estimate and continue the intake instead of guessing.

## Income categories to cover

Check every relevant category in `references/required-information.md`, including:
- employment income and certificates
- self-employment or business income
- capital gains and withholding certificates
- rental income
- foreign income
- pensions and other income
- wage-replacement benefits such as arbeitslosengeld, elterngeld, krankengeld, kurzarbeitergeld, and similar benefits

## Deduction categories to cover

Check every relevant category in `references/required-information.md`, including:
- commuting and other job travel
- home office by period and setup
- dedicated home office room costs
- work equipment and depreciation
- software, phone, and internet
- application and job-search costs
- education and training
- insurances and other special expenses
- household services and tradespeople
- childcare, donations, extraordinary burdens, and any other claimed items

## Output requirements

Use the structure in `references/output-template.md`.

The final answer must contain both:
1. a tax estimate for the selected year
2. a complete elster mapping with exact forms and fields

If an item does not need to be declared, say that explicitly and explain why.

## Example triggers

Use this skill for requests like:
- "help me prepare my german tax return in elster"
- "ask me everything you need for my 2025 tax filing"
- "calculate my german income tax and tell me which elster fields to fill"
- "review my certificates and map them into the elster forms"
