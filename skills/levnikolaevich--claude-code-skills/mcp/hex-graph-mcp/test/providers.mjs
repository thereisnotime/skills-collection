import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { installGraphProviders, planGraphProviders } from "../lib/providers/index.mjs";

const tmpRoots = [];

function tempProject(name) {
    const root = mkdtempSync(join(tmpdir(), `hex-graph-${name}-`));
    tmpRoots.push(root);
    return root;
}

function mockRuntime(ok = false) {
    return {
        uv: { ok, stdout: ok ? "uv 0.8.0" : "", stderr: "", error: ok ? null : new Error("uv missing") },
        python: { ok, stdout: ok ? "Python 3.12.0" : "", stderr: "", error: ok ? null : new Error("python missing") },
        py: { ok, stdout: ok ? "Python 3.12.0" : "", stderr: "", error: ok ? null : new Error("py missing") },
        dotnet: { ok, stdout: ok ? "9.0.100" : "", stderr: "", error: ok ? null : new Error("dotnet missing") },
        composer: { ok, stdout: ok ? "Composer version 2.8.0" : "", stderr: "", error: ok ? null : new Error("composer missing") },
        npm: { ok, stdout: ok ? "11.0.0" : "", stderr: "", error: ok ? null : new Error("npm missing") },
    };
}

after(() => {
    for (const root of tmpRoots) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe("graph provider planner", () => {
    it("reports no extra providers for JavaScript and TypeScript projects", () => {
        const root = tempProject("ts");
        writeFileSync(join(root, "package.json"), "{\n  \"name\": \"demo\"\n}\n", "utf8");
        writeFileSync(join(root, "tsconfig.json"), "{\n  \"compilerOptions\": {}\n}\n", "utf8");
        mkdirSync(join(root, "src"), { recursive: true });
        writeFileSync(join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");

        const plan = planGraphProviders({ path: root, runtime: mockRuntime(false) });
        assert.deepEqual(plan.detected_languages, ["typescript"]);
        assert.equal(plan.items.length, 0);
        assert.equal(plan.problems.length, 0);
        assert.match(plan.instructions_for_agent[0], /no extra graph providers are required/i);
    });

    it("returns explicit Python remediation steps for agents", () => {
        const root = tempProject("python");
        writeFileSync(join(root, "pyproject.toml"), "[project]\nname = \"demo\"\nversion = \"0.1.0\"\n", "utf8");
        mkdirSync(join(root, "src"), { recursive: true });
        writeFileSync(join(root, "src", "app.py"), "print('ok')\n", "utf8");

        const plan = installGraphProviders({
            path: root,
            mode: "check",
            detectedLanguages: ["python"],
            runtime: mockRuntime(true),
        });

        const ids = plan.items.map(item => item.id);
        assert.deepEqual(ids, ["basedpyright", "scip-python"]);
        assert.equal(plan.summary.all_ok, false);
        assert.equal(plan.summary.missing_count, 2);
        assert.ok(plan.instructions_for_agent.some(line => line.includes("basedpyright")));
        assert.ok(plan.instructions_for_agent.some(line => line.includes("scip-python")));
        assert.ok(plan.instructions_for_agent.some(line => line.includes("HEX_GRAPH_SCIP_PYTHON_BINARY")));
    });

    it("uses the patched Windows scip-python install hint when needed", () => {
        const root = tempProject("python-win");
        writeFileSync(join(root, "pyproject.toml"), "[project]\nname = \"demo\"\nversion = \"0.1.0\"\n", "utf8");

        const plan = installGraphProviders({
            path: root,
            mode: "check",
            detectedLanguages: ["python"],
            runtime: mockRuntime(true),
        });

        const scipPython = plan.items.find(item => item.id === "scip-python");
        assert.ok(scipPython);
        if (process.platform === "win32") {
            assert.match(scipPython.install?.label || "", /github:levnikolaevich\/scip-python#fix\/windows-path-sep-regex/);
        } else {
            assert.match(scipPython.install?.label || "", /@sourcegraph\/scip-python/);
        }
    });

    it("returns the isolated PHP fork install path for SCIP export", () => {
        const root = tempProject("php");
        writeFileSync(join(root, "composer.json"), "{\n  \"name\": \"demo/php\"\n}\n", "utf8");
        writeFileSync(join(root, "composer.lock"), "{\n  \"packages\": []\n}\n", "utf8");
        mkdirSync(join(root, "app"), { recursive: true });
        writeFileSync(join(root, "app", "Example.php"), "<?php\n", "utf8");
        const previous = process.env.HEX_GRAPH_SCIP_PHP_BINARY;
        process.env.HEX_GRAPH_SCIP_PHP_BINARY = join(root, "missing", "scip-php");
        try {
            const plan = installGraphProviders({
                path: root,
                mode: "check",
                detectedLanguages: ["php"],
                runtime: mockRuntime(true),
            });

            const scipPhp = plan.items.find(item => item.id === "scip-php");
            assert.ok(scipPhp);
            assert.equal(Array.isArray(scipPhp.install?.steps), true);
            assert.match(scipPhp.install.steps[0].label, /repositories\.levnikolaevich-scip-php/);
            assert.match(scipPhp.install.steps[1].label, /dev-fix\/windows-runtime-fixes/);
            assert.ok(plan.instructions_for_agent.some(line => line.includes("HEX_GRAPH_SCIP_PHP_BINARY")));
        } finally {
            if (previous === undefined) {
                delete process.env.HEX_GRAPH_SCIP_PHP_BINARY;
            } else {
                process.env.HEX_GRAPH_SCIP_PHP_BINARY = previous;
            }
        }
    });
});
