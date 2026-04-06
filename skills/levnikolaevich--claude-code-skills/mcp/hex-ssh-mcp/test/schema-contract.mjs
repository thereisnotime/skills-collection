import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CWD = resolve(__dirname, "..");

async function withMcpClient(run) {
    const { Client } = await import("@modelcontextprotocol/sdk/client");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const client = new Client({ name: "hex-ssh-schema-contract", version: "1.0.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
        command: "node",
        args: ["server.mjs"],
        cwd: CWD,
        stderr: "pipe",
    });
    try {
        await client.connect(transport);
        return await run(client);
    } finally {
        await transport.close().catch(() => {});
    }
}

function toolByName(tools, name) {
    const tool = tools.find(entry => entry.name === name);
    assert.ok(tool, `Tool '${name}' must exist`);
    return tool;
}

describe("schema descriptions", () => {
    it("listTools preserves SSH property descriptions under Zod 4", async () => {
        await withMcpClient(async (client) => {
            const result = await client.listTools();
            const readTool = toolByName(result.tools, "ssh-read-lines");
            const readProps = readTool.inputSchema.properties || {};
            assert.equal(readProps.host?.description, "SSH host - alias from ~/.ssh/config or hostname/IP");
            assert.equal(readProps.filePath?.description, "Path to file on remote server");
            assert.equal(readProps.maxLines?.description, "Max lines to read (default: 200)");
        });
    });
});
