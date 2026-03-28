# /mcp:setup-context7-mcp - Documentation Access

Set up Context7 MCP server to provide real-time access to library and framework documentation, eliminating hallucinations from outdated training data.

- Purpose - Configure documentation access for your project's technology stack
- Output - Working Context7 integration with CLAUDE.md configuration

```bash
/mcp:setup-context7-mcp [technologies]
```

## What is Context7?

Context7 is an MCP server that fetches up-to-date documentation with code examples for any library or framework. Instead of relying on potentially outdated training data, the LLM can query actual documentation in real-time.

Benefits:
- Access latest API references and code examples
- Eliminate hallucinations about deprecated methods or incorrect signatures
- Get version-specific documentation for your exact dependencies
- Reduce back-and-forth when the LLM suggests outdated patterns

## Arguments

Optional list of languages and frameworks to configure documentation for. If omitted, the command analyzes your project structure to identify relevant technologies.

Examples:
- `react, typescript, prisma` - Specific technologies
- `nextjs 14, tailwind` - Version-specific documentation
- (no arguments) - Auto-detect from project files

## How It Works

1. **Availability Check**: Verifies if Context7 MCP server is already configured
2. **Setup Guidance**: If not available, guides you through the installation process for your operating system and development environment
3. **Technology Analysis**: Parses your input or scans project structure to identify relevant documentation
4. **Documentation Search**: Queries Context7 to find available documentation IDs for your technologies
5. **CLAUDE.md Update**: Adds recommended library IDs and usage instructions to your project configuration

## Usage Examples

```bash
# Configure for a React/TypeScript project
> /mcp:setup-context7-mcp react, typescript, @tanstack/react-query

# Let the command detect technologies from your project
> /mcp:setup-context7-mcp

# Specific framework versions
> /mcp:setup-context7-mcp nextjs 14, prisma 5, zod
```

After setup, your CLAUDE.md will include:

```markdown
### Use Context7 MCP for Loading Documentation

Context7 MCP is available to fetch up-to-date documentation with code examples.

**Recommended library IDs**:

- `react` - React core library documentation
- `typescript` - TypeScript language reference
- `prisma` - Prisma ORM documentation
```

## Best Practices

- Run early in project setup to establish documentation access from the start
- Include specific versions when working with rapidly evolving libraries
- Review the generated documentation IDs and remove any that are not relevant
- Re-run when adding new major dependencies to your project
