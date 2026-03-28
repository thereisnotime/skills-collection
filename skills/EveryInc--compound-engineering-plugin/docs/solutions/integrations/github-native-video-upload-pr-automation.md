---
title: "GitHub inline video embedding via programmatic browser upload"
category: integrations
date: 2026-03-22
tags:
  - github
  - video-embedding
  - agent-browser
  - playwright
  - feature-video
  - pr-description
related_to:
  - plugins/compound-engineering/skills/feature-video/SKILL.md
  - plugins/compound-engineering/skills/agent-browser/SKILL.md
  - plugins/compound-engineering/skills/agent-browser/references/authentication.md
---

# GitHub Native Video Upload for PRs

## Problem

Embedding video demos in GitHub PR descriptions required external storage (R2/rclone)
or GitHub Release assets. Release asset URLs render as plain download links, not inline
video players. Only `user-attachments/assets/` URLs render with GitHub's native inline
video player -- the same result as pasting a video into the PR editor manually.

The distinction is absolute:

| URL namespace | Rendering |
|---|---|
| `github.com/releases/download/...` | Plain download link (bad UX, triggers download on mobile) |
| `github.com/user-attachments/assets/...` | Native inline `<video>` player with controls |

## Investigation

1. **Public upload API** -- No public API exists. The `/upload/policies/assets` endpoint
   requires browser session cookies and is not exposed via REST or GraphQL. GitHub CLI
   (`gh`) has no support; issues cli/cli#1895, #4228, and #4465 are all closed as
   "not planned". GitHub keeps this private to limit abuse surface (malware hosting,
   spam CDN, DMCA liability).

2. **Release asset approach (Strategy B)** -- URLs render as download links, not video
   players. Clickable GIF previews trigger downloads on mobile. Unacceptable UX.

3. **Claude-in-Chrome JavaScript injection with base64** -- Blocked by CSP/mixed-content
   policy. HTTPS github.com cannot fetch from HTTP localhost. Base64 chunking is possible
   but does not scale for larger videos.

4. **`tonkotsuboy/github-upload-image-to-pr`** -- Open-source reference confirming
   browser automation is the only working approach for producing native URLs.

5. **agent-browser `upload` command** -- Works. Playwright sets files directly on hidden
   file inputs without base64 encoding or fetch requests. CSP is not a factor because
   Playwright's `setInputFiles` operates at the browser engine level, not via JavaScript.

## Working Solution

### Upload flow

```bash
# Navigate to PR page (authenticated Chrome session)
agent-browser --engine chrome --session-name github \
  open "https://github.com/[owner]/[repo]/pull/[number]"
agent-browser scroll down 5000

# Upload video via the hidden file input
agent-browser upload '#fc-new_comment_field' tmp/videos/feature-demo.mp4

# Wait for GitHub to process the upload (typically 3-5 seconds)
agent-browser wait 5000

# Extract the URL GitHub injected into the textarea
agent-browser eval "document.getElementById('new_comment_field').value"
# Returns: https://github.com/user-attachments/assets/[uuid]

# Clear the textarea without submitting (upload already persisted server-side)
agent-browser eval "const ta = document.getElementById('new_comment_field'); \
  ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }))"

# Embed in PR description (URL on its own line renders as inline video player)
gh pr edit [number] --body "[body with video URL on its own line]"
```

### Key selectors (validated March 2026)

| Selector | Element | Purpose |
|---|---|---|
| `#fc-new_comment_field` | Hidden `<input type="file">` | Target for `agent-browser upload`. Accepts `.mp4`, `.mov`, `.webm` and many other types. |
| `#new_comment_field` | `<textarea>` | GitHub injects the `user-attachments/assets/` URL here after processing the upload. |

GitHub's comment form contains the hidden file input. After Playwright sets the file,
GitHub uploads it server-side and injects a markdown URL into the textarea. The upload
is persisted even if the form is never submitted.

## What Was Removed

The following approaches were removed from the feature-video skill:

- R2/rclone setup and configuration
- Release asset upload flow (`gh release upload`)
- GIF preview generation (unnecessary with native inline video player)
- Strategy B fallback logic

Total: approximately 100 lines of SKILL.md content removed. The skill is now simpler
and has zero external storage dependencies.

## Prevention

### URL validation

After any upload step, confirm the extracted URL contains `user-attachments/assets/`
before writing it into the PR description. If the URL does not match, the upload failed
or used the wrong method.

### Upload failure handling

If the textarea is empty after the wait, check:
1. Session validity (did GitHub redirect to login?)
2. Wait time (processing can be slow under load -- retry after 3-5 more seconds)
3. File size (10MB free, 100MB paid accounts)

Do not silently substitute a release asset URL. Report the failure and offer to retry.

### DOM selector fragility

`#fc-new_comment_field` and `#new_comment_field` are GitHub's internal element IDs and
may change in future UI updates. If the upload stops working, snapshot the PR page and
inspect the current comment form structure for updated selectors.

### Size limits

- Free accounts: 10MB per file
- Paid (Pro, Team, Enterprise): 100MB per file

Check file size before attempting upload. Re-encode at lower quality if needed.

## References

- GitHub CLI issues: cli/cli#1895, #4228, #4465 (all closed "not planned")
- `tonkotsuboy/github-upload-image-to-pr` -- reference implementation
- GitHub Community Discussions: #29993, #46951, #28219
