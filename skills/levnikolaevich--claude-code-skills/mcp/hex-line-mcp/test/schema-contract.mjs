import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CWD = resolve(__dirname, "..");

async function withMcpClient(run) {
    const { Client } = await import("@modelcontextprotocol/sdk/client");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const client = new Client({ name: "hex-line-schema-contract", version: "1.0.0" }, { capabilities: {} });
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
    it("listTools preserves read_file property descriptions under Zod 4", async () => {
        await withMcpClient(async (client) => {
            const result = await client.listTools();
            assert.equal(result.tools.length, 9, "hex-line exposes the compact 9-tool surface");
            toolByName(result.tools, "inspect_path");
            const readFile = toolByName(result.tools, "read_file");
            const props = readFile.inputSchema.properties || {};
            assert.equal(props.path?.description, "File path");
            assert.equal(props.offset?.description, "Start line (1-indexed, default: 1)");
            assert.equal(props.include_graph, undefined);
        });
    });
});
