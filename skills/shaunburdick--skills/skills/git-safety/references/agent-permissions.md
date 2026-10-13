# Agent Permission Configuration

If you are authoring an agent definition (e.g., an OpenCode `.md` agent file), add these permissions to the YAML frontmatter to enforce branch protection at the tool level — blocking dangerous commands before they can run:

```yaml
permission:
  shell:
    "git commit *": ask
    "git push": deny
    "git push *": deny
    "git merge": deny
    "git merge *": deny
    "git checkout main": deny
    "git checkout master": deny
    "git checkout develop": deny
    "git switch main": deny
    "git switch master": deny
    "git switch develop": deny
```

> Note: These permissions are set by the human author in the agent definition file — a running agent cannot modify its own permissions. This section is a reference for when you're helping set up or review an agent configuration.

