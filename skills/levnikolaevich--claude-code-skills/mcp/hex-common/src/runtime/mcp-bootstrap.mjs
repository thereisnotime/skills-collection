export async function createServerRuntime({ name, version }) {
    let McpServer, StdioServerTransport;
    try {
        ({ McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js"));
        ({ StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js"));
    } catch {
        process.stderr.write(
            `${name}: @modelcontextprotocol/sdk not found.\n` +
            `Run: npm install @modelcontextprotocol/sdk\n`
        );
        process.exit(1);
    }

    const shutdown = () => { process.exit(0); };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    return {
        server: new McpServer({ name, version }),
        StdioServerTransport,
    };
}
