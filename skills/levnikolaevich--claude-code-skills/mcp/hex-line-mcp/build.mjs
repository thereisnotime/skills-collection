// esbuild bundler: inlines hex-common into dist/, keeps npm deps external.
// Run: node build.mjs
import { build } from "esbuild";
import { readFileSync, cpSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
const external = Object.keys(pkg.dependencies || {})
  .concat(Object.keys(pkg.optionalDependencies || {}))
  .filter(d => d !== "@levnikolaevich/hex-common");

await build({
  entryPoints: ["server.mjs", "hook.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "dist",
  external,
  outExtension: { ".js": ".mjs" },
  define: { __HEX_VERSION__: JSON.stringify(pkg.version) },
});

cpSync("../hex-common/artifacts/tree-sitter", "dist/artifacts/tree-sitter", { recursive: true });

console.log("Built dist/server.mjs + dist/hook.mjs");
