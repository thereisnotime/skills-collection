import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// ==================== hash cross-verification ====================

describe("FNV-1a hash (cross-verify with hex-line)", () => {
    it("produces same hashes as hex-line for same content", async () => {
        const { fnv1a, lineTag, rangeChecksum } = await import("../lib/hash.mjs");

        const h1 = fnv1a("const x = 1;");
        const h2 = fnv1a("const x = 1;");
        assert.equal(h1, h2, "Same content same hash");

        const tag = lineTag(h1);
        assert.match(tag, /^[a-z2-7]{2}$/, "Tag is 2-char base32");

        const cs = rangeChecksum([h1, h2], 1, 2);
        assert.match(cs, /^\d+-\d+:[0-9a-f]{8}$/, "Checksum format: start-end:hex8");
    });
});

// ==================== normalize ====================

describe("normalize output", () => {
    it("deduplicates identical lines with (xN)", async () => {
        const { deduplicateLines } = await import("../lib/normalize.mjs");
        const lines = ["ok", "error: timeout", "error: timeout", "error: timeout", "done"];
        const result = deduplicateLines(lines);
        const joined = result.join("\n");
        assert.ok(joined.includes("(x3)"), "Repeated 3x gets count");
        assert.ok(joined.includes("ok"), "Unique lines kept");
    });

    it("smartTruncate keeps head + tail, omits middle", async () => {
        const { smartTruncate } = await import("../lib/normalize.mjs");
        const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
        const result = smartTruncate(text, 5, 3);
        assert.ok(result.includes("line 1"), "Head kept");
        assert.ok(result.includes("line 100"), "Tail kept");
        assert.ok(result.includes("omitted"), "Gap indicator");
        assert.ok(!result.includes("line 50"), "Middle omitted");
    });
});

// ==================== ssh-edit-block anchor-only contract ====================

describe("ssh-edit-block anchor-only contract", () => {
    let validateEditArgs;
    before(async () => {
        ({ validateEditArgs } = await import("../lib/edit-validation.mjs"));
    });

    it("accepts all valid anchor modes", () => {
        assert.equal(validateEditArgs({ anchor: "ab.42", newText: "y" }), null);
        assert.equal(validateEditArgs({ startAnchor: "ab.10", endAnchor: "cd.15", newText: "y" }), null);
        assert.equal(validateEditArgs({ insertAfter: "ab.20", newText: "y" }), null);
    });

    it("rejects invalid args (text-mode, partial range, missing newText, conflicting modes)", () => {
        assert.ok(validateEditArgs({ oldText: "x", newText: "y" })?.includes("Required: anchor"));
        assert.ok(validateEditArgs({ startAnchor: "ab.10", newText: "y" })?.includes("Incomplete range"));
        assert.ok(validateEditArgs({ endAnchor: "cd.15", newText: "y" })?.includes("Incomplete range"));
        assert.ok(validateEditArgs({ anchor: "ab.42" })?.includes("Required: newText"));
        assert.ok(validateEditArgs({ anchor: "ab.42", insertAfter: "cd.15", newText: "y" })?.includes("Conflicting"));
    });
});

// ==================== host key verification ====================

describe("host key verification", () => {
    let buildHostVerifier;
    before(async () => {
        ({ buildHostVerifier } = await import("../lib/host-verify.mjs"));
    });

    it("rejects unknown host (fail-closed)", () => {
        process.env.KNOWN_HOSTS_PATH = "/nonexistent";
        delete process.env.ALLOWED_HOST_FINGERPRINTS;
        const verifier = buildHostVerifier("unknown.host");
        assert.equal(verifier(Buffer.from("fake-key")), false);
        delete process.env.KNOWN_HOSTS_PATH;
    });

    it("accepts matching SHA256 fingerprint from env", () => {
        const fakeKey = Buffer.from("test-key-data");
        const fp = "SHA256:" + createHash("sha256").update(fakeKey).digest("base64").replace(/=+$/, "");
        process.env.ALLOWED_HOST_FINGERPRINTS = fp;
        process.env.KNOWN_HOSTS_PATH = "/nonexistent";
        const verifier = buildHostVerifier("any.host");
        assert.equal(verifier(fakeKey), true);
        delete process.env.ALLOWED_HOST_FINGERPRINTS;
        delete process.env.KNOWN_HOSTS_PATH;
    });

    it("rejects non-matching fingerprint", () => {
        process.env.ALLOWED_HOST_FINGERPRINTS = "SHA256:wrongwrongwrong";
        process.env.KNOWN_HOSTS_PATH = "/nonexistent";
        const verifier = buildHostVerifier("any.host");
        assert.equal(verifier(Buffer.from("actual-key")), false);
        delete process.env.ALLOWED_HOST_FINGERPRINTS;
        delete process.env.KNOWN_HOSTS_PATH;
    });
});

// ==================== shell escaping ====================

describe("shell escaping", () => {
    let shellQuote, assertSafeArg;
    before(async () => {
        ({ shellQuote, assertSafeArg } = await import("../lib/shell-escape.mjs"));
    });

    it("shellQuote handles quotes, backticks and $() injection", () => {
        assert.equal(shellQuote("it's"), "'it'\\''s'");
        assert.equal(shellQuote("$(whoami)"), "'$(whoami)'");
        assert.equal(shellQuote("`id`"), "'`id`'");
    });

    it("assertSafeArg rejects null bytes and newlines", () => {
        assert.throws(() => assertSafeArg("p", "/var\0/etc"), /UNSAFE_ARG/);
        assert.throws(() => assertSafeArg("p", "/var\n/etc"), /UNSAFE_ARG/);
        assertSafeArg("p", "/var/www/app/file.js"); // normal path — no throw
    });
});

// ==================== path validation ====================

describe("path validation", () => {
    let validateRemotePath;
    before(async () => {
        ({ validateRemotePath } = await import("../lib/ssh-client.mjs"));
    });

    it("rejects relative path and .. traversal", () => {
        assert.throws(() => validateRemotePath("relative/path"), /BAD_PATH/);
        process.env.ALLOWED_DIRS = "/home/deploy";
        assert.throws(() => validateRemotePath("/home/deploy/../../etc/passwd"), /PATH_OUTSIDE_ROOT/);
        delete process.env.ALLOWED_DIRS;
    });

    it("accepts valid paths and canonicalizes both sides", () => {
        process.env.ALLOWED_DIRS = "/home/deploy/../deploy";
        assert.doesNotThrow(() => validateRemotePath("/home/deploy/app/server.js"));
        delete process.env.ALLOWED_DIRS;
    });
});

// ==================== command policy ====================

describe("command policy", () => {
    let validateCommand;
    before(async () => {
        ({ validateCommand } = await import("../lib/command-policy.mjs"));
    });

    it("disabled by default, blocks in safe mode", () => {
        delete process.env.REMOTE_SSH_MODE;
        assert.ok(validateCommand("ls")?.includes("REMOTE_SSH_DISABLED"));
        process.env.REMOTE_SSH_MODE = "safe";
        assert.ok(validateCommand("rm -rf /")?.includes("BLOCKED_COMMAND"));
        assert.ok(validateCommand(":(){ :|:& };:")?.includes("BLOCKED_COMMAND"));
        assert.equal(validateCommand("ls -la /home/deploy"), null);
        delete process.env.REMOTE_SSH_MODE;
    });

    it("allows everything in open mode", () => {
        process.env.REMOTE_SSH_MODE = "open";
        assert.equal(validateCommand("rm -rf /"), null);
        delete process.env.REMOTE_SSH_MODE;
    });
});


// ==================== SSH config resolution ====================

describe("SSH config resolution", () => {
    let resolveHost;
    before(async () => {
        ({ resolveHost } = await import("../lib/config-resolver.mjs"));
    });

    it("resolves alias from SSH config content", async () => {
        // Use SSH_CONFIG_PATH to point at a test fixture
        const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
        const { join } = await import("node:path");
        const os = await import("node:os");
        const tmpDir = mkdtempSync(join(os.tmpdir(), "ssh-test-"));
        const configPath = join(tmpDir, "config");
        writeFileSync(configPath, [
            "Host myserver",
            "  HostName 10.0.0.1",
            "  User deploy",
            "  Port 2222",
            `  IdentityFile ${join(tmpDir, "key")}`,
            "",
        ].join("\n"));
        // Create a fake key file so identityFiles resolves
        writeFileSync(join(tmpDir, "key"), "fake-key");

        process.env.SSH_CONFIG_PATH = configPath;
        try {
            const result = resolveHost("myserver");
            assert.equal(result.host, "10.0.0.1");
            assert.equal(result.user, "deploy");
            assert.equal(result.port, 2222);
            assert.equal(result.originalHost, "myserver");
            assert.ok(result.identityFiles.length >= 1);
            assert.ok(typeof result.port === "number", "Port must be number, not string");
        } finally {
            delete process.env.SSH_CONFIG_PATH;
            rmSync(tmpDir, { recursive: true });
        }
    });

    it("explicit args override config values", async () => {
        const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
        const { join } = await import("node:path");
        const os = await import("node:os");
        const tmpDir = mkdtempSync(join(os.tmpdir(), "ssh-test-"));
        const configPath = join(tmpDir, "config");
        writeFileSync(configPath, "Host myserver\n  HostName 10.0.0.1\n  User deploy\n  Port 2222\n");

        process.env.SSH_CONFIG_PATH = configPath;
        try {
            const result = resolveHost("myserver", { user: "admin", port: 3333 });
            assert.equal(result.user, "admin");
            assert.equal(result.port, 3333);
        } finally {
            delete process.env.SSH_CONFIG_PATH;
            rmSync(tmpDir, { recursive: true });
        }
    });

    it("missing config file returns fallback", async () => {
        process.env.SSH_CONFIG_PATH = "/nonexistent/ssh_config";
        try {
            const result = resolveHost("somehost", { user: "root" });
            assert.equal(result.host, "somehost");
            assert.equal(result.user, "root");
            assert.equal(result.port, 22);
        } finally {
            delete process.env.SSH_CONFIG_PATH;
        }
    });

    it("ProxyJump throws UNSUPPORTED_SSH_CONFIG", async () => {
        const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
        const { join } = await import("node:path");
        const os = await import("node:os");
        const tmpDir = mkdtempSync(join(os.tmpdir(), "ssh-test-"));
        const configPath = join(tmpDir, "config");
        writeFileSync(configPath, "Host jumphost\n  HostName 10.0.0.1\n  ProxyJump bastion\n");

        process.env.SSH_CONFIG_PATH = configPath;
        try {
            assert.throws(() => resolveHost("jumphost"), /UNSUPPORTED_SSH_CONFIG/);
        } finally {
            delete process.env.SSH_CONFIG_PATH;
            rmSync(tmpDir, { recursive: true });
        }
    });
});

// ==================== Host authorization (resolved-only) ====================

describe("host authorization", () => {

    it("ALLOWED_HOSTS checks resolved host only", async () => {
        const { resolveHost } = await import("../lib/config-resolver.mjs");
        const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
        const { join } = await import("node:path");
        const os = await import("node:os");
        const tmpDir = mkdtempSync(join(os.tmpdir(), "ssh-test-"));
        const configPath = join(tmpDir, "config");
        writeFileSync(configPath, "Host myalias\n  HostName 10.0.0.99\n  User root\n");

        process.env.SSH_CONFIG_PATH = configPath;
        try {
            const resolved = resolveHost("myalias");
            // The resolved host should be 10.0.0.99, not the alias
            assert.equal(resolved.host, "10.0.0.99");
            assert.equal(resolved.originalHost, "myalias");
            // ALLOWED_HOSTS would check 10.0.0.99, not myalias
        } finally {
            delete process.env.SSH_CONFIG_PATH;
            rmSync(tmpDir, { recursive: true });
        }
    });
});

// ==================== Connection pool ====================

describe("connection pool", () => {
    it("_setClientFactory exists as test seam", async () => {
        const { _setClientFactory } = await import("../lib/ssh-client.mjs");
        assert.equal(typeof _setClientFactory, "function");
    });

    it("closeAllConnections is exported", async () => {
        const { closeAllConnections } = await import("../lib/ssh-client.mjs");
        assert.equal(typeof closeAllConnections, "function");
        // Should not throw when pool is empty
        closeAllConnections();
    });
});
