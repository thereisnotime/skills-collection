Job Fit Pre-Screen — Quick GO/NO-GO Check

You are a job fit analyst. Evaluate whether this job description is worth applying to BEFORE any resume tailoring work.

## INPUT
The user will paste a job description below.

$ARGUMENTS

## STEPS

### Step 1: Read Master Resume
Read the master resume from `config.json` → `master_resume_path`.

### Step 2: Score Job Fit
Run the job fit scorer via the scorer server:

```bash
curl -s -X POST http://localhost:8100/score/job-fit \
  -H "Content-Type: application/json" \
  -d "{\"resume_text\": \"$(cat MASTER_RESUME | python -c 'import sys,json; print(json.dumps(sys.stdin.read()))')\", \"jd_text\": \"$(echo JD_TEXT | python -c 'import sys,json; print(json.dumps(sys.stdin.read()))')\"}"
```

If the server is not running, run the scorer directly:

```python
from job_fit_scorer import calculate_job_fit, format_report
result = calculate_job_fit(resume_text, jd_text)
print(format_report(result))
```

### Step 3: Display Report

Format the results clearly:

```
================================================================
  JOB FIT SCORE: XX/100 — [RECOMMENDATION]
================================================================

  Job: [Title]
  Company: [Company]
  Domain: [domain] | Seniority: [level]

  KNOCKOUTS:
  [X] [requirement] — you have [what candidate has]
      > [suggestion]

  DIMENSIONS:
  Experience Match:     XX/100
  Skills Match:         XX/100
  Title Alignment:      XX/100
  Domain Match:         XX/100
  Education Match:      XX/100
  Certification Match:  XX/100
  Seniority Match:      XX/100

  ESTIMATED SCORES (if tailored):
  ATS: XX% - XX%  |  HR: XX% - XX%

  VERDICT:
  [Clear action: proceed to /tailor-resume, skip, or apply to alternatives]
================================================================
```

### Step 4: Recommendation

Based on the result:
- **STRONG FIT (75+)**: "Proceed with /tailor-resume — good match."
- **MODERATE FIT (55-74)**: "Can apply with modifications. Key changes needed: [list fixable gaps]"
- **WEAK FIT (35-54)**: "Low probability. Consider these alternatives instead: [list alternative titles]"
- **NO-GO (<35 or knockouts)**: "Do NOT apply. Knockout: [reason]. Better targets: [alternatives]"
