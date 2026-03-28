# MCP Plugin

Commands for integrating Model Context Protocol (MCP) servers with your AI-powered development workflow. Set up well-known MCP servers and create custom servers to extend LLM capabilities.

## Plugin Target

Simplify integration of MCP servers into your development workflow.

## Overview

The MCP (Model Context Protocol) plugin helps you integrate MCP servers into your development environment. MCP is an open protocol that enables AI assistants to interact with external services, databases, and tools through a standardized interface.

This plugin provides five key commands:

1. **Context7 MCP Setup** - Access up-to-date documentation for any library or framework
2. **Serena MCP Setup** - Enable semantic code analysis and symbol-based operations
3. **Codemap CLI Setup** - Enable intelligent codebase visualization and navigation
4. **arXiv/Paper Search MCP Setup** - Search and download academic papers from multiple sources
5. **Build MCP** - Create custom MCP servers for any service or API

Each setup command supports configuration at multiple levels:

- **Project level (shared)** - Configuration tracked in git, shared with team via `./CLAUDE.md`
- **Project level (personal)** - Local configuration in `./CLAUDE.local.md`, not tracked in git
- **User level (global)** - Configuration in `~/.claude/CLAUDE.md`, applies to all projects

The command guides through the MCP setup process and updates the appropriate CLAUDE.md file based on your choice to ensure consistent MCP usage.

## Quick Start

Open Claude Code in your project directory and run the following commands to setup MCP servers.

```bash
# Install the plugin
/plugin install mcp@NeoLabHQ/context-engineering-kit

# Set up documentation access for your project
> /mcp:setup-context7-mcp react, typescript, prisma

# Enable semantic code analysis
> /mcp:setup-serena-mcp

# Set up codebase visualization
> /mcp:setup-codemap-cli
```

[Usage Examples](./usage-examples.md)

## Commands

- [/mcp:setup-context7-mcp](./setup-context7-mcp.md) - Set up Context7 MCP server to provide real-time access to library and framework documentation, eliminating hallucinations from outdated training data.
- [/mcp:setup-serena-mcp](./setup-serena-mcp.md) - Set up Serena MCP server for semantic code retrieval and symbol-based editing capabilities, enabling precise code manipulation in large codebases.
- [/mcp:setup-codemap-cli](./setup-codemap-cli.md) - Set up Codemap CLI for intelligent codebase visualization and navigation, providing tree views, dependency analysis, and change tracking.
- [/mcp:setup-arxiv-mcp](./setup-arxiv-mcp.md) - Set up the Paper Search MCP server via Docker MCP for searching and downloading academic papers from multiple sources including arXiv, PubMed, Semantic Scholar, and more.
- [/mcp:build-mcp](./build-mcp.md) - Comprehensive guide for creating high-quality MCP servers that enable LLMs to interact with external services through well-designed tools.
