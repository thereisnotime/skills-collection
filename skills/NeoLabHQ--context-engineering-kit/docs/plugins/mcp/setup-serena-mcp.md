# /mcp:setup-serena-mcp - Semantic Code Analysis

Set up Serena MCP server for semantic code retrieval and symbol-based editing capabilities, enabling precise code manipulation in large codebases.

- Purpose - Enable intelligent code navigation and manipulation
- Output - Configured Serena integration with indexed project

```bash
/mcp:setup-serena-mcp [configuration preferences]
```

## What is Serena?

Serena is an MCP server that provides semantic understanding of your codebase. Unlike text-based search (grep), Serena understands code structure - functions, classes, types, and their relationships.

Benefits:
- Find symbols by meaning, not just text matching
- Navigate complex codebases with symbol-based operations
- Make precise code changes without breaking references
- Understand code relationships and dependencies
- Refactor with confidence using semantic operations

## Arguments

Optional configuration preferences or client type. The command adapts its setup guidance based on your development environment (Claude Code, Claude Desktop, Cursor, VSCode, etc.).

## How It Works

1. **Availability Check**: Tests if Serena tools (`find_symbol`, `list_symbols`) are accessible
2. **Documentation Loading**: Fetches latest Serena documentation for setup guidance
3. **Prerequisites Verification**: Confirms `uv` is installed (required for running Serena)
4. **Client Configuration**: Provides setup instructions specific to your MCP client
5. **Project Setup**: Guides through project initialization and indexing
6. **Connection Test**: Verifies Serena tools are working correctly
7. **CLAUDE.md Update**: Adds semantic code analysis guidelines to your project

## Usage Examples

```bash
# Standard setup with auto-detection
> /mcp:setup-serena-mcp

# Specify your client
> /mcp:setup-serena-mcp cursor

# With specific configuration needs
> /mcp:setup-serena-mcp claude-desktop
```

After setup, your CLAUDE.md will include:

```markdown
### Use Serena MCP for Semantic Code Analysis

Serena MCP is available for advanced code retrieval and editing capabilities.

- Use Serena's tools for precise code manipulation in structured codebases
- Prefer symbol-based operations over file-based grep/sed operations

Key usage points:
- Use `find_symbol` to locate functions, classes, and types by name
- Use `list_symbols` to explore available symbols in a file or module
- Prefer semantic operations for refactoring over text replacement
```

## Best Practices

- Set up Serena for large codebases where text search becomes unwieldy
- Use semantic operations for refactoring to ensure all references are updated
- Re-index the project after major structural changes
- Combine with Context7 for documentation + code understanding
- Prefer symbol-based navigation over grep for code exploration
