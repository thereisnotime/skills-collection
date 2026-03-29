---
description: "Comprehensive infrastructure-as-code review for Terraform configurations"
---

Perform a comprehensive review of the Terraform code in the current directory.

## Review Process

1. **Identify Scope**
   - List all .tf files in the directory
   - Identify modules being used
   - Map resource dependencies

2. **Dispatch Parallel Reviews**
   Launch these agents in a single message:

   ```
   Task(security-reviewer) → Security analysis of all resources
   Task(terraform-plan-analyzer) → Structure and best practices review
   ```

3. **Analysis Areas**

   ### Code Quality
   - Module organization
   - Variable usage and documentation
   - Output definitions
   - Naming conventions
   - DRY principles

   ### Security
   - IAM policies and roles
   - Security group configurations
   - Encryption settings
   - Public exposure risks
   - Secrets management

   ### Reliability
   - High availability patterns
   - Backup configurations
   - Monitoring and alerting
   - Disaster recovery

   ### Cost
   - Resource sizing
   - Reserved vs on-demand
   - Unused resources
   - Tagging for cost allocation

4. **Present Findings**
   Aggregate agent results into a structured report with:
   - Critical issues (must fix)
   - Important issues (should fix)
   - Suggestions (nice to have)
   - Positive observations

5. **No automatic changes** - this is review only
