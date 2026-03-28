# Network Scan Skill for Claude Code

Proactively scan your LinkedIn contacts' companies for job openings that match your profile. Instead of waiting for jobs to appear on search engines, this skill starts from your network and checks if companies where you know someone are hiring.

## Features

- **Network-first approach** - leverage your LinkedIn connections for warm introductions
- **Careers page caching** - first run builds a cache of company careers URLs, subsequent runs are fast
- **Smart matching** - evaluates roles against your resume and preferences
- **ATS support** - handles Greenhouse, Lever, Workday, and direct careers pages
- **Contact mapping** - shows which contact to reach out to at each company

## Prerequisites

1. [Claude Code CLI](https://claude.ai/code) installed
2. [Claude in Chrome](https://chromewebstore.google.com/detail/claude-in-chrome) extension installed
3. Chrome browser running with the extension active
4. LinkedIn contacts imported via `/proficiently:setup`

## Usage

### Scan recent contacts (default: 25)
```bash
claude "/proficiently:network-scan"
```

### Scan a specific number
```bash
claude "/proficiently:network-scan 50"
```

### Scan all contacts
```bash
claude "/proficiently:network-scan all"
```

## File Structure

**Plugin files:**
```
network-scan/
├── SKILL.md                      # Main skill definition
├── README.md                     # This file
└── scripts/
    └── evaluate-company.md       # Company evaluation subagent
```

**User data (at `~/.proficiently/`):**
```
~/.proficiently/
├── linkedin-contacts.csv         # LinkedIn contacts export
├── company-careers.json          # Cached careers page URLs
├── network-scan-history.md       # Log of all scan results
├── resume/                       # Your resume PDF/DOCX
├── preferences.md                # Job matching rules
└── jobs/                         # Per-job application folders
```

## How It Works

1. **Parse contacts** - reads your LinkedIn contacts CSV and extracts unique companies
2. **Resolve careers pages** - finds each company's careers/jobs page (cached for 7 days)
3. **Scan for roles** - browses careers pages for openings matching your preferences
4. **Score matches** - evaluates each role against your resume (High/Medium/Low/Skip)
5. **Present results** - shows matches with your contact at each company for warm intros

## Careers Cache

The skill maintains `~/.proficiently/company-careers.json` to avoid re-discovering careers pages on every run. Cache entries expire after 7 days and are automatically refreshed.

Supported careers page types:
- **direct** - company's own careers page (e.g., careers.google.com)
- **greenhouse** - Greenhouse ATS
- **lever** - Lever ATS
- **workday** - Workday ATS
- **other_ats** - other ATS platforms
- **not_found** - no careers page could be located

### Updating the Cache

Tell Claude to update entries:
- *"The careers page for Acme is actually acme.com/jobs"*
- *"Skip Google from future scans"*

## Troubleshooting

### "No LinkedIn contacts found"
Run `/proficiently:setup` and import your LinkedIn contacts CSV.

### Careers pages not resolving
Make sure Chrome is running and the Claude in Chrome extension is active. Some small companies may not have public careers pages.

### Too many companies to scan
Start with a smaller number: `/proficiently:network-scan 10`. Increase once you've confirmed it works.

### Stale results
The careers cache refreshes every 7 days. To force a refresh, delete `~/.proficiently/company-careers.json` and re-run.

## License

MIT
