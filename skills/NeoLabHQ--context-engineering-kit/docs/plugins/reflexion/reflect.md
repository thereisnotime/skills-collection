# /reflexion:reflect - Self-Refinement

Reflect on previous response and output, based on Self-refinement framework for iterative improvement with complexity triage and verification

- Purpose - Review and improve previous response
- Output - Refined output with improvements

```bash
/reflexion:reflect ["focus area or threshold"]
```

## Arguments

Optional areas to focus or confidence threshold to use, for example "security" or "deep reflect if less than 90% confidence"

## How It Works

1. **Complexity Triage**: Automatically determines appropriate reflection depth
   - Quick Path (5s): Simple tasks get fast verification
   - Standard Path: Multi-file changes get full reflection
   - Deep Path: Critical systems get comprehensive analysis

2. **Self-Assessment**: Evaluates output against quality criteria
   - Completeness check
   - Quality assessment
   - Correctness verification
   - Fact-checking

3. **Refinement Planning**: If improvements needed, generates specific plan
   - Identifies issues
   - Proposes solutions
   - Prioritizes fixes

4. **Implementation**: Produces refined output addressing identified issues

**Confidence Thresholds**

The command uses confidence levels to determine if further iteration is needed:

- **Quick Path**: No specific threshold (fast verification only)
- **Standard Path**: Requires >70% confidence
- **Deep Reflection**: Requires >90% confidence

If confidence threshold isn't met, the command will iterate automatically.

## Usage Examples

```bash
# Basic reflection on previous response
> claude "implement user authentication"
> /reflexion:reflect

# Focused reflection on specific aspect
> /reflexion:reflect security

# After complex feature implementation
> claude "add payment processing with Stripe"
> /reflexion:reflect
```

## Best practices

- Reflect after significant work - Don't reflect on trivial tasks
- Be specific - Provide context about what to focus on
- Iterate when needed - Sometimes multiple reflection cycles are valuable
- Capture learnings - Use `/reflexion:memorize` to preserve insights
