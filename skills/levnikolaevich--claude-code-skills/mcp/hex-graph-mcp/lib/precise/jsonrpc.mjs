import { spawn } from "node:child_process";

function toHeaderBuffer(message) {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    return Buffer.concat([
        Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8"),
        payload,
    ]);
}

export async function createJsonRpcProcess(command, { cwd } = {}) {
    if (!Array.isArray(command) || command.length === 0) {
        throw new Error("JSON-RPC provider command must be a non-empty array");
    }
    const [binary, ...args] = command;
    const child = spawn(binary, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    });

    const pending = new Map();
    const stderr = [];
    let buffer = Buffer.alloc(0);
    let nextId = 1;
    let closed = false;

    const failPending = (error) => {
        for (const { reject } of pending.values()) reject(error);
        pending.clear();
    };

    const readMessages = () => {
        while (true) {
            const marker = buffer.indexOf("\r\n\r\n");
            if (marker === -1) return;
            const header = buffer.subarray(0, marker).toString("utf8");
            const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
            if (!lengthMatch) {
                buffer = Buffer.alloc(0);
                return;
            }
            const bodyLength = Number.parseInt(lengthMatch[1], 10);
            const bodyStart = marker + 4;
            const bodyEnd = bodyStart + bodyLength;
            if (buffer.length < bodyEnd) return;
            const message = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf8"));
            buffer = buffer.subarray(bodyEnd);
            if (message && Object.prototype.hasOwnProperty.call(message, "id") && pending.has(message.id)) {
                const slot = pending.get(message.id);
                pending.delete(message.id);
                if (Object.prototype.hasOwnProperty.call(message, "error")) {
                    const details = message.error?.message || JSON.stringify(message.error);
                    slot.reject(new Error(details));
                } else {
                    slot.resolve(message.result);
                }
            }
        }
    };

    child.stdout.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        readMessages();
    });
    child.stderr.on("data", chunk => {
        stderr.push(chunk.toString("utf8"));
    });

    const started = new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
    });
    const exited = new Promise(resolve => {
        child.once("exit", (code, signal) => {
            closed = true;
            const suffix = stderr.join("").trim();
            const detail = suffix ? ` ${suffix}` : "";
            failPending(new Error(`Provider process exited (${code ?? "null"}${signal ? `, ${signal}` : ""}).${detail}`.trim()));
            resolve();
        });
    });

    await started;

    return {
        async request(method, params = {}) {
            if (closed) throw new Error("Provider process is already closed");
            const id = nextId++;
            const message = { jsonrpc: "2.0", id, method, params };
            const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
            child.stdin.write(toHeaderBuffer(message));
            return response;
        },
        notify(method, params = {}) {
            if (closed) return;
            child.stdin.write(toHeaderBuffer({ jsonrpc: "2.0", method, params }));
        },
        async close() {
            if (closed) return;
            closed = true;
            try {
                child.stdin.end();
            } catch {
                // ignore
            }
            child.kill();
            await exited;
        },
        getStderr() {
            return stderr.join("").trim();
        },
    };
}

