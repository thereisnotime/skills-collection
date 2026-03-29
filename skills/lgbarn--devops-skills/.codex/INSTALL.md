# Installing DevOps Skills for Codex

Quick setup to enable devops-skills in Codex.

## Installation

1. **Clone devops-skills repository**:
   ```bash
   mkdir -p ~/.codex/devops-skills
   cd ~/.codex/devops-skills
   git clone https://github.com/lgbarn/devops-skills.git .
   ```

2. **Create personal skills directory**:
   ```bash
   mkdir -p ~/.codex/skills
   ```

3. **Update ~/.codex/AGENTS.md** to include this devops-skills section:
   ```markdown
   ## DevOps Skills System

   <EXTREMELY_IMPORTANT>
   You have devops-skills. DevOps Skills teach you new skills and capabilities. RIGHT NOW run: `~/.codex/devops-skills/.codex/devops-skills-codex bootstrap` and follow the instructions it returns.
   </EXTREMELY_IMPORTANT>
   ```

## Verification

Test the installation:
```bash
~/.codex/devops-skills/.codex/devops-skills-codex bootstrap
```

You should see skill listings and bootstrap instructions. The system is now ready for use.