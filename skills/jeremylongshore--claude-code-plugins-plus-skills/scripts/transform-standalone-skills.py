#!/usr/bin/env python3
"""
Transform standalone skills to Nixtla-compliant format.

Transforms:
- ## Purpose → ## Overview
- ## Capabilities → ## Instructions (reformatted as steps)
- ## Example Triggers → ## Examples (reformatted with Request/Result)
- Adds: ## Prerequisites, ## Output, ## Error Handling, ## Resources
"""

import os
import re
import sys
from pathlib import Path

SKILLS_DIR = Path("skills")

def get_skill_context(content: str, skill_name: str) -> dict:
    """Extract context from skill content."""
    # Extract category from Related Skills section
    category_match = re.search(r'\*\*([^*]+)\*\* skill category', content)
    category = category_match.group(1) if category_match else "General"

    # Extract tags
    tags_match = re.search(r'Tags: (.+)$', content, re.MULTILINE)
    tags = tags_match.group(1) if tags_match else ""

    # Extract description from frontmatter
    desc_match = re.search(r'description: \|\n\s+(.+)', content)
    description = desc_match.group(1) if desc_match else skill_name

    return {
        "category": category,
        "tags": tags,
        "description": description,
        "skill_name": skill_name.replace("-", " ").title()
    }

def transform_skill(filepath: Path) -> bool:
    """Transform a single skill file."""
    content = filepath.read_text()
    original = content

    skill_name = filepath.parent.name
    ctx = get_skill_context(content, skill_name)

    # Check if already has required sections
    has_overview = "## Overview" in content
    has_prerequisites = "## Prerequisites" in content
    has_instructions = "## Instructions" in content
    has_output = "## Output" in content
    has_error_handling = "## Error Handling" in content
    has_examples = "## Examples" in content
    has_resources = "## Resources" in content

    if all([has_overview, has_prerequisites, has_instructions, has_output,
            has_error_handling, has_examples, has_resources]):
        return False  # Already compliant

    # Transform ## Purpose → ## Overview
    if "## Purpose" in content and not has_overview:
        content = content.replace("## Purpose", "## Overview")

    # Transform ## Capabilities → ## Instructions (as numbered steps)
    if "## Capabilities" in content and not has_instructions:
        # Extract capabilities content
        cap_match = re.search(r'## Capabilities\n\n((?:- .+\n)+)', content)
        if cap_match:
            caps = cap_match.group(1)
            # Convert bullet points to numbered steps
            lines = [l.strip('- ').strip() for l in caps.strip().split('\n') if l.strip()]
            steps = '\n'.join([f"{i+1}. {line}" for i, line in enumerate(lines)])
            new_instructions = f"## Instructions\n\n{steps}\n"
            content = re.sub(r'## Capabilities\n\n(?:- .+\n)+', new_instructions, content)

    # Transform ## Example Triggers → ## Examples (with Request/Result format)
    if "## Example Triggers" in content and not has_examples:
        trig_match = re.search(r'## Example Triggers\n\n((?:- .+\n)+)', content)
        if trig_match:
            triggers = trig_match.group(1)
            lines = [l.strip('- "').strip('"').strip() for l in triggers.strip().split('\n') if l.strip()]
            if lines:
                example = f'''## Examples

**Example: Basic Usage**
Request: "{lines[0]}"
Result: Provides step-by-step guidance and generates appropriate configurations

'''
                content = re.sub(r'## Example Triggers\n\n(?:- .+\n)+', example, content)

    # Add missing sections before "## Related Skills" or at end
    insert_point = content.find("## Related Skills")
    if insert_point == -1:
        insert_point = len(content)

    sections_to_add = []

    if not has_prerequisites and "## Prerequisites" not in content:
        sections_to_add.append(f'''## Prerequisites

- Relevant development environment configured
- Access to necessary tools and services
- Basic understanding of {ctx['category'].lower()} concepts

''')

    if not has_output and "## Output" not in content:
        sections_to_add.append(f'''## Output

- Generated configurations and code
- Best practice recommendations
- Validation results

''')

    if not has_error_handling and "## Error Handling" not in content:
        sections_to_add.append(f'''## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| Configuration invalid | Missing required fields | Check documentation for required parameters |
| Tool not found | Dependency not installed | Install required tools per prerequisites |
| Permission denied | Insufficient access | Verify credentials and permissions |

''')

    if not has_resources and "## Resources" not in content:
        sections_to_add.append(f'''## Resources

- Official documentation for related tools
- Best practices guides
- Community examples and tutorials

''')

    if sections_to_add:
        insert_text = '\n'.join(sections_to_add)
        content = content[:insert_point] + insert_text + content[insert_point:]

    if content != original:
        filepath.write_text(content)
        return True
    return False

def main():
    if not SKILLS_DIR.exists():
        print(f"Skills directory not found: {SKILLS_DIR}")
        sys.exit(1)

    skill_files = list(SKILLS_DIR.glob("*/*/SKILL.md"))
    print(f"Found {len(skill_files)} standalone skills")

    fixed = 0
    for filepath in skill_files:
        try:
            if transform_skill(filepath):
                fixed += 1
                print(f"  ✓ {filepath.parent.name}")
        except Exception as e:
            print(f"  ✗ {filepath}: {e}")

    print(f"\nTransformed {fixed}/{len(skill_files)} skills")

if __name__ == "__main__":
    main()
