---
description: "Auto-generate documentation for Terraform modules and infrastructure"
---

Generate documentation for Terraform configurations in the current directory.

## Documentation Types

### Module README
For Terraform modules, generate:
- Description and purpose
- Requirements (Terraform version, providers)
- Input variables (with types, defaults, descriptions)
- Output values
- Usage examples
- Resource diagram (if applicable)

### Environment Documentation
For environment directories, generate:
- Environment overview
- Resource inventory
- Network topology
- Access patterns
- Dependencies

### Runbook
For operational documentation, generate:
- Common operations
- Troubleshooting steps
- Emergency procedures
- Contact information

## Process

1. **Analyze Configuration**
   ```bash
   # Find all .tf files
   find . -name "*.tf" -type f

   # Extract variables
   grep -h "^variable" *.tf

   # Extract outputs
   grep -h "^output" *.tf

   # Extract resources
   grep -h "^resource" *.tf
   ```

2. **Parse Structure**
   - Variables with descriptions
   - Outputs with values
   - Resources and their relationships
   - Module calls

3. **Generate Documentation**

   ### For Modules (README.md)
   ```markdown
   # Module Name

   Brief description of what this module does.

   ## Requirements

   | Name | Version |
   |------|---------|
   | terraform | >= X.Y |
   | aws | >= X.Y |

   ## Inputs

   | Name | Description | Type | Default | Required |
   |------|-------------|------|---------|----------|

   ## Outputs

   | Name | Description |
   |------|-------------|

   ## Usage

   ```hcl
   module "example" {
     source = "./path/to/module"
     # ...
   }
   ```

   ## Resources

   | Name | Type |
   |------|------|
   ```

4. **Review with User**
   Present generated documentation for review before writing.

5. **Write Files**
   Only after user approval:
   - README.md for modules
   - RUNBOOK.md for operations
   - Update existing docs if present

## Options

- `--format markdown` (default)
- `--format terraform-docs` (terraform-docs compatible)
- `--include-examples` (generate usage examples)
- `--include-diagram` (generate resource diagram)
