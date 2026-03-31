import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJsonRpcProcess } from "./jsonrpc.mjs";

function fileUri(projectPath, relFile) {
    return pathToFileURL(resolve(projectPath, relFile)).href;
}

export async function withLspSession({ command, descriptor, projectPath, files }, run) {
    const transport = await createJsonRpcProcess(command, { cwd: projectPath });
    let initialized = false;
    try {
        const result = await transport.request("initialize", {
            processId: null,
            rootUri: pathToFileURL(projectPath).href,
            capabilities: {},
            workspaceFolders: [{ uri: pathToFileURL(projectPath).href, name: descriptor.display_language || projectPath }],
            clientInfo: { name: "hex-graph-mcp", version: "stage2" },
        });
        transport.notify("initialized", {});
        initialized = true;
        for (const relFile of files) {
            transport.notify("textDocument/didOpen", {
                textDocument: {
                    uri: fileUri(projectPath, relFile),
                    languageId: descriptor.language_id,
                    version: 1,
                    text: readFileSync(resolve(projectPath, relFile), "utf8").replace(/\r\n/g, "\n"),
                },
            });
        }
        return await run({
            serverInfo: result?.serverInfo || null,
            async definition(relFile, line, character) {
                return transport.request("textDocument/definition", {
                    textDocument: { uri: fileUri(projectPath, relFile) },
                    position: { line, character },
                });
            },
        });
    } finally {
        if (initialized) {
            try {
                await transport.request("shutdown", {});
            } catch {
                // ignore provider shutdown errors
            }
            transport.notify("exit", {});
        }
        await transport.close();
    }
}

