# /mcp:build-mcp - Custom MCP Server Development

Comprehensive guide for creating high-quality MCP servers that enable LLMs to interact with external services through well-designed tools.

- Purpose - Build custom MCP servers for any service or API
- Output - Production-ready MCP server with tools and evaluations

```bash
/mcp:build-mcp
```

## When to Build Custom MCP Servers

Build an MCP server when you need the LLM to:
- Interact with internal company APIs or services
- Access databases or data sources not available via existing MCP servers
- Integrate with third-party services (CRMs, project management, communication tools)
- Perform specialized operations unique to your domain

## How It Works

The command guides you through a four-phase development process:

**Phase 1: Deep Research and Planning**

1. **Agent-Centric Design Principles**
   - Build workflow tools, not just API wrappers
   - Optimize for limited context windows
   - Design actionable error messages
   - Follow natural task subdivisions

2. **Protocol Study**: Load MCP specification from `modelcontextprotocol.io`

3. **Framework Selection**:
   - Python with FastMCP for rapid development
   - TypeScript with MCP SDK for type safety

4. **API Research**: Exhaustively study the target API documentation

5. **Implementation Planning**:
   - Tool selection and prioritization
   - Shared utilities design
   - Input/output schema design
   - Error handling strategy

**Phase 2: Implementation**

1. **Project Structure**: Set up according to language-specific best practices
2. **Core Infrastructure**: Build shared utilities first (API helpers, error handling, formatting)
3. **Tool Implementation**: Systematically implement each planned tool
4. **Annotations**: Add proper tool hints (readOnly, destructive, idempotent)

**Phase 3: Review and Refine**

1. **Code Quality Review**: DRY principle, composability, consistency
2. **Testing**: Verify syntax and imports (note: MCP servers are long-running, use evaluation harness)
3. **Quality Checklist**: Language-specific verification

**Phase 4: Create Evaluations**

1. **Tool Inspection**: Understand available capabilities
2. **Content Exploration**: Use read-only operations to explore data
3. **Question Generation**: Create 10 complex, realistic evaluation questions
4. **Answer Verification**: Verify each answer is correct and stable

## Usage Examples

```bash
# Start building an MCP server
> /mcp:build-mcp

# The command will guide you through:
# 1. Understanding your integration requirements
# 2. Choosing Python or TypeScript
# 3. Designing tools for your use case
# 4. Implementing with best practices
# 5. Testing and evaluation
```
