---
description: "Detect and analyze infrastructure drift between Terraform state and actual resources"
---

Invoke the devops-skills:terraform-drift-detection skill and follow it exactly.

## Quick Reference

This command will:
1. Verify AWS credentials
2. Run `terraform plan -refresh-only` to detect drift
3. Dispatch the drift-detector agent to categorize changes
4. Present drift findings with:
   - Severity classification
   - Probable causes
   - Resolution recommendations
5. Require user decision on how to resolve each drift

**Options for resolution:**
- Accept drift (update state to match actual)
- Reject drift (apply to revert actual to code)
- Investigate further
