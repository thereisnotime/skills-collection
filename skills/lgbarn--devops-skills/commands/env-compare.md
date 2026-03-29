---
description: "Compare Terraform configurations across environments (dev, staging, prod)"
---

Compare infrastructure configurations across multiple environments.

## Usage

```
/env-compare dev prod           # Compare two environments
/env-compare dev staging prod   # Compare three environments
```

## Process

1. **Identify Environment Directories**
   Detect environment structure:
   ```
   environments/
   ├── dev/
   ├── staging/
   └── prod/
   ```

   Or workspace-based:
   ```bash
   terraform workspace list
   ```

2. **Dispatch Parallel Analysis**
   For each environment, launch an agent in a **single message**:

   ```
   Task("Analyze environments/dev configuration")
   Task("Analyze environments/staging configuration")
   Task("Analyze environments/prod configuration")
   ```

   Each agent collects:
   - Resource counts by type
   - Instance sizes/configurations
   - Feature flags/toggles
   - Module versions
   - Variable values (non-sensitive)

3. **Aggregate Results**
   Combine agent outputs into comparison table.

4. **Present Comparison**

   ```markdown
   ## Environment Comparison

   ### Resource Counts
   | Resource Type | dev | staging | prod |
   |---------------|-----|---------|------|
   | aws_instance  | 2   | 4       | 8    |
   | aws_rds_instance | 1 | 1      | 2    |

   ### Configuration Differences
   | Setting | dev | staging | prod |
   |---------|-----|---------|------|
   | instance_type | t3.micro | t3.small | t3.large |
   | multi_az | false | false | true |

   ### Module Versions
   | Module | dev | staging | prod |
   |--------|-----|---------|------|
   | vpc    | 3.1.0 | 3.1.0 | 3.0.0 |

   ### Flags/Toggles
   | Feature | dev | staging | prod |
   |---------|-----|---------|------|
   | debug_mode | true | false | false |

   ### Discrepancies to Review
   - [List any unexpected differences]

   ### Recommendations
   - [e.g., "Align prod VPC module to 3.1.0"]
   ```

5. **Highlight Concerns**
   - Version mismatches between environments
   - Missing resources in higher environments
   - Configuration drift between staging and prod
   - Security settings that differ unexpectedly

## Common Patterns to Check

### Expected Differences (OK)
- Resource counts (more in prod)
- Instance sizes (larger in prod)
- Replica counts (more in prod)

### Unexpected Differences (Flag)
- Different module versions
- Missing security features in prod
- Debug/test settings in prod
- Different provider versions
