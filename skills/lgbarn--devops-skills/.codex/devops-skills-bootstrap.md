# DevOps Skills Bootstrap for Codex

<EXTREMELY_IMPORTANT>
You have devops-skills.

**Tool for running skills:**
- `~/.codex/devops-skills/.codex/devops-skills-codex use-skill <skill-name>`

**Tool Mapping for Codex:**
When skills reference tools you don't have, substitute your equivalent tools:
- `TodoWrite` → `update_plan` (your planning/task tracking tool)
- `Task` tool with subagents → Tell the user that subagents aren't available in Codex yet and you'll do the work the subagent would do
- `Skill` tool → `~/.codex/devops-skills/.codex/devops-skills-codex use-skill` command (already available)
- `Read`, `Write`, `Edit`, `Bash` → Use your native tools with similar functions

**Skills naming:**
- Superpowers skills: `devops-skills:skill-name` (from ~/.codex/devops-skills/skills/)
- Personal skills: `skill-name` (from ~/.codex/skills/)
- Personal skills override devops-skills skills when names match

**Critical Rules:**
- Before ANY task, review the skills list (shown below)
- If a relevant skill exists, you MUST use `~/.codex/devops-skills/.codex/devops-skills-codex use-skill` to load it
- Announce: "I've read the [Skill Name] skill and I'm using it to [purpose]"
- Skills with checklists require `update_plan` todos for each item
- NEVER skip mandatory workflows (brainstorming before coding, TDD, systematic debugging)

**Skills location:**
- Superpowers skills: ~/.codex/devops-skills/skills/
- Personal skills: ~/.codex/skills/ (override devops-skills when names match)

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.
</EXTREMELY_IMPORTANT>