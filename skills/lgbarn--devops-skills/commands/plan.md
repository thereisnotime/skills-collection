---
description: "Run terraform plan with parallel agent analysis for comprehensive risk review"
---

Invoke the devops-skills:terraform-plan-review skill and follow it exactly.

## Quick Reference

This command will:
1. Verify AWS credentials match the target environment
2. Run `terraform plan -out=plan.out`
3. Convert plan to JSON for analysis
4. Dispatch parallel agents:
   - terraform-plan-analyzer (risk assessment)
   - security-reviewer (security implications)
   - historical-pattern-analyzer (past patterns)
5. Aggregate findings into a unified report
6. Present for explicit user approval before any apply

**Remember: Never auto-apply. Always wait for explicit "approve" from user.**
