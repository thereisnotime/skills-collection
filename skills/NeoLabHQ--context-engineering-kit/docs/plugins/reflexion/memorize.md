# /reflexion:memorize - Memory Updates

Memorize insights from reflections and updates CLAUDE.md file with this knowledge. Curates insights from reflections and critiques into CLAUDE.md using Agentic Context Engineering.

- Purpose - Save insights to project memory
- Output - Updated CLAUDE.md with learnings

```bash
/reflexion:memorize ["source or scope"]
```

## Arguments

Optional source specification (last, selection, chat:<id>) or --dry-run for preview

## How It Works

1. **Context Harvesting**: Gathers insights from recent work
   - Reflection outputs
   - Critique findings
   - Problem-solving patterns
   - Failed approaches and lessons

2. **Curation Process**: Transforms raw insights into structured knowledge
   - Extracts key insights
   - Categorizes by impact
   - Applies curation rules (relevance, non-redundancy, actionability)
   - Prevents context collapse

3. **CLAUDE.md Updates**: Adds curated insights to appropriate sections
   - Project Context
   - Code Quality Standards
   - Architecture Decisions
   - Testing Strategies
   - Development Guidelines
   - Strategies and Hard Rules

4. **Memory Validation**: Ensures quality of updates
   - Coherence check
   - Actionability test
   - Consolidation review
   - Evidence verification

## Usage Examples

```bash
# Memorize from most recent work
> /reflexion:reflect
> /reflexion:memorize

# Preview without writing
> /reflexion:memorize --dry-run

# Limit insights
> /reflexion:memorize --max=3

# Target specific section
> /reflexion:memorize --section="Testing Strategies"

# Memorize from critique
> /reflexion:critique
> /reflexion:memorize
```

## Best practices

- Regular memorization - Periodically save insights to CLAUDE.md
- Review memory - Occasionally review CLAUDE.md to ensure it stays relevant
- Curate carefully - Only memorize significant, reusable insights
- Organize by topic - Keep CLAUDE.md well-structured
