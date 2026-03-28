# Find Jobs — Discover & Score

Search for jobs matching your profile and score each one against your resume.

## Search Query
$ARGUMENTS

## Instructions

You are an expert career advisor. The user wants to find jobs that match their resume and score each one for fit.

### Phase 1: Setup

1. **Read the master resume** from `config.json` -> `master_resume_path` (or glob for `*MASTER*RESUME*.md`, `*MASTER*RESUME*.docx`, `*MASTER*RESUME*.pdf`).
   - `.md`/`.txt` -> use `Read` tool directly
   - `.docx` -> call `extract_text` MCP tool
   - `.pdf` -> use `Read` tool directly

2. **Parse the user's query** from `$ARGUMENTS`:
   - Extract the **job title** (e.g., "Data Scientist", "Clinical Research Associate")
   - Extract **location** if specified (e.g., "in New York", "NYC", "Remote")
   - Detect **remote preference** (keywords: "remote", "work from home", "WFH")
   - If the query is empty or unclear, ask the user what role they're looking for

### Phase 2: Job Discovery

3. **Call the `discover_jobs` MCP tool** with:
   - `resume_text`: Full text of the master resume
   - `job_title`: Extracted job title
   - `location`: Extracted location (empty string if not specified)
   - `remote_only`: True if user mentioned remote preference
   - `max_results`: 10 (default)

### Phase 3: Display Results

4. **Display a ranked results table** with the top matches:

```
## Job Discovery Results

| Rank | Title | Company | Location | ATS | HR | Salary |
|------|-------|---------|----------|-----|-----|--------|
| 1 | ... | ... | ... | 82% | 74% | $120-150K |
| 2 | ... | ... | ... | 78% | 71% | $100-130K |
```

5. **For each top-3 job**, show a brief breakdown:
   - Matched keywords (from ats_detail)
   - Missing keywords (what you'd need to add)
   - HR recommendation (INTERVIEW, MAYBE, PASS)
   - Apply URL

6. **Show the attribution** line from the response (e.g., "Powered by Adzuna")

### Phase 4: Next Steps

7. **Offer actionable next steps** — present these as numbered options the user can pick:

   **Option 1 — Apply to a specific job:**
   "Type a number (e.g., '1') and I'll generate a tailored resume + cover letter for that job using its description. I'll run the full `/resume` workflow automatically."

   When the user picks a job number:
   - Extract that job's `description` from the discovery results
   - Save the description to `applications/{Company} - {Title}/job_description.txt`
   - Run the full `/resume` workflow using that job description as input
   - After DOCX is created, show the apply URL so the user can submit

   **Option 2 — Search again:**
   "Run `/find-jobs [new query]` to search with different criteria"

   **Option 3 — View full description:**
   "Type 'details #N' to see the full job description for any result"

### Error Handling

- If no results are found, suggest broadening the search (shorter title, different location)
- If API keys are not configured, inform the user:
  "Job discovery requires Adzuna API keys. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to your .env file.
   Get free API keys at: https://developer.adzuna.com/"
- If the MCP tool is not available, fall back to informing the user about manual search options
