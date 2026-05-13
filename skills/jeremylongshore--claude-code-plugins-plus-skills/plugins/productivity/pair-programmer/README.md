# Pair Programmer

**Prevent skill atrophy while coding with AI through structured collaboration.**

## The Problem

AI code generation creates deceptive productivity. You ship features faster while your problem-solving muscles atrophy.
As MIT professor Roberto Rigobon warns about AI dependency: "When we stop using our brains... we forget."

"Vibe coding" - passively accepting AI-generated code - feels productive but degrades the skills that make you valuable:
debugging, architecture decisions, performance intuition, and deep understanding of your codebase.

## The Solution

A graduated assistance framework that maintains cognitive load while leveraging AI as a force multiplier. Think of it as
weight training: you need resistance to build strength.

## Four Levels of Assistance

### Level 1: Pure Architecture

**AI advises, you code everything.**

Use when learning new patterns or maintaining sharp skills.

```text
You: "Should I use event delegation for these dynamic elements?"
AI: "Event delegation works well here because..."
You: [writes all the code]
AI: [reviews and suggests improvements]
```

**Best for:**

- Learning new technologies
- Critical algorithm implementation
- Maintaining coding skills
- Deep architectural decisions

### Level 2: Scaffolding

**AI provides structure, you implement logic.**

AI creates interfaces, type definitions, file structure. You write the actual logic and business rules.

```text
AI: [generates class skeleton with method signatures]
You: [implements method bodies]
```

**Best for:**

- New feature development
- Refactoring with clear requirements
- Projects with well-defined interfaces
- When you want structure but need to understand implementation

### Level 3: Pair Programming

**Collaborative alternation with mandatory engagement.**

Alternate function-by-function. You must modify or improve AI code before moving on - no passive copying.

```text
You: [writes authentication function]
AI: [writes validation function]
You: [modifies AI code, then writes next function]
```

**Best for:**

- Large feature development
- Balanced learning and velocity
- Complex implementations requiring back-and-forth
- When you want to see alternative approaches

### Level 4: Full Generation

**AI writes complete implementations. Use sparingly.**

Reserve for boilerplate, well-solved problems, or time-critical situations. **Mandatory explain-back**: you must
explain every line before using it.

```text
You: "Generate OAuth2 boilerplate for GitHub login"
AI: [provides complete implementation]
You: [explains back how every part works]
```

**Best for:**

- Standard boilerplate (config files, build scripts)
- Well-solved problems (date formatting, common algorithms)
- Time-critical production issues
- Code you've written 100 times before

## Warning Signs of Dependency

The Agent will stop and reassess if it notices that you:

- Can't explain how AI-generated code works
- Copying code without modification
- Uncomfortable coding without AI available
- Reaching for AI before attempting yourself
- Debugging by asking AI instead of using tools
- Can't remember how to solve problems you "solved" yesterday

## Active Learning Techniques

### 1. Explain-Back Protocol

After AI provides anything, explain it back in your own words. If you can't, you don't understand it.

### 2. Modification Requirement

Change something in AI code before using it - variable names, structure, approach. Forces active engagement.

### 3. Implementation Comparison

Code it yourself first, then compare with AI approach. Learn from differences.

### 4. Constraint Exercises

"Help me solve X but don't write code, only describe the approach." Forces you to do the implementation.

## Session Declaration Pattern

When you launch with `--agent pair-programmer:coach`, the agent greets you automatically
and asks for your name and assistance level. Just respond to the prompt.

If you prefer to declare upfront, or if the agent is invoked mid-session, use this pattern:

```bash
# Level 1 example
"Level 1: I want to implement this authentication flow myself.
Just advise on security considerations and API choices."

# Level 2 example
"Level 2: Give me class structure for a chatbot framework.
I'll implement all the methods."

# Level 3 example
"Level 3: Let's alternate on this feature. I'll write the data
layer, you write the API, I'll modify and write the UI."

# Level 4 example
"Level 4: Generate OAuth2 boilerplate - I've done this 20 times
and just need the standard pattern."
```

## Installation

Inside Claude Code, run:

```text
/plugin marketplace add ali5ter/claude-plugins
/plugin install pair-programmer@ali5ter
```

## Usage

### Starting a Session

Launch Claude Code with the pair-programmer agent:

```bash
claude --agent pair-programmer:coach
```

The agent will greet you, introduce itself, and ask for your name and assistance level.
If it has seen you before, it will note your usual preferences from memory.

### Declaring Your Level

Respond to the agent's greeting, or declare your level explicitly at any time:

```text
"Level 1: I want to implement a rate limiter myself. Just advise on algorithm choices."
"Level 2: Scaffold an API client class for GitHub. I'll implement the request methods."
"Level 3: Let's alternate building a CLI tool. I'll start with argument parsing."
"Level 4: Generate standard Express middleware boilerplate."
```

### Ending a Session

Signal the end of your session to receive a brief retrospective:

```text
"Done for today."   "Thanks, let's stop here."   "End session."
```

The agent will summarise what was built, assess engagement quality, and recommend
a level for your next session on this type of work.

### Switching Agents

Return to default Claude Code (no agent):

```bash
claude
```

### Mid-Session Level Changes

You can change levels during a session:

```text
"Let's switch to Level 2 for this next feature."
```

The agent will confirm the change and reset state tracking.

### Session Tips

- **Respond to the greeting** — the agent will ask for your name and level automatically
- **Modify AI code** in Level 3 to demonstrate understanding (cosmetic changes won't pass)
- **Explain back** in Level 4 before moving to next task
- **Use Level 1** when learning new patterns or maintaining sharp skills
- **Reserve Level 4** for true boilerplate and time-sensitive situations
- **End explicitly** — saying "done for today" triggers a useful retrospective

## Philosophy

This framework is built on several principles:

**Cognitive load is necessary.** If coding feels effortless, you're probably atrophying. Good collaboration should be mentally
demanding.

**Understanding > Shipping.** Better to ship slightly slower while maintaining deep knowledge of your codebase than to become
a prompt engineer who can't debug their own code.

**AI as a tool, not a replacement.** Use AI like you use a debugger, profiler, or code review - as a specialist that augments
your capabilities, not replaces your thinking.

**Graduated resistance training.** Choose the level that maintains appropriate challenge. Too easy and you atrophy;
too hard and you burn out.

---

*Remember: The goal isn't to avoid AI. It's to use AI in a way that makes you stronger, not weaker.*
