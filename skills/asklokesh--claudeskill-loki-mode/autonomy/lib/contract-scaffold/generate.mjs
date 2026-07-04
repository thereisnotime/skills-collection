#!/usr/bin/env node
// generate.mjs -- M2 backend-floor generator (template substitution, NOT heredocs).
//
// Reads the server template files and substitutes tokens derived from a portable
// {resource, fields} descriptor, producing a REAL Express + SQLite backend that
// persists. General by construction: no knowledge of any specific PRD.
//
// Why a Node generator and not a bash heredoc: a heredoc emitting JS collides with
// JS `${...}` template literals and backticks (bit both the M1 yaml and a first
// M2 js heredoc). Templates + substitution keeps generated code reviewable as real
// code. See artifacts/beat-replit-engineering-plan.md (M2 architecture decision).
//
// Usage: node generate.mjs <out_dir> <resource> [field:type ...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const TPL = join(__dir, "templates", "server");

const [, , outDir, resource, ...fieldArgs] = process.argv;
if (!outDir || !resource) {
  console.error("usage: generate.mjs <out_dir> <resource> [field:type ...]");
  process.exit(2);
}

const fields = (fieldArgs.length ? fieldArgs : ["title:string"]).map((f) => {
  const [name, type = "string"] = f.split(":");
  return { name, type };
});

const cap = resource.charAt(0).toUpperCase() + resource.slice(1);
const coll = resource.endsWith("s") ? resource : resource + "s";

const sqlType = (t) =>
  ["int", "integer", "number", "bool", "boolean"].includes(t) ? "INTEGER" : "TEXT";
const seedVal = (t) =>
  ["int", "integer", "number"].includes(t) ? "1"
  : ["bool", "boolean"].includes(t) ? "0"
  : "'sample value'";

const tokens = {
  __COLL__: coll,
  __RESOURCE_CAP__: cap,
  __COLUMNS_SQL__: fields.map((f) => `  ${f.name} ${sqlType(f.type)},`).join("\n"),
  __SEED_COLS__: fields.length ? fields.map((f) => f.name).join(", ") + "," : "",
  __SEED_VALS__: fields.length ? fields.map((f) => seedVal(f.type)).join(", ") + "," : "",
  __INSERT_COLS__: fields.length ? fields.map((f) => f.name).join(", ") + "," : "",
  __INSERT_PLACEHOLDERS__: fields.length ? fields.map((f) => "@" + f.name).join(", ") + "," : "",
  __BODY_FIELDS__: fields.map((f) => `"${f.name}"`).join(", "),
};

function render(tpl) {
  let out = tpl;
  // Replace longer tokens first so __RESOURCE_CAP__ isn't partially hit, etc.
  for (const key of Object.keys(tokens).sort((a, b) => b.length - a.length)) {
    out = out.split(key).join(tokens[key]);
  }
  return out;
}

mkdirSync(join(outDir, "server"), { recursive: true });
for (const [tpl, dest] of [
  ["index.mjs.tmpl", "index.mjs"],
  ["package.json.tmpl", "package.json"],
]) {
  const src = readFileSync(join(TPL, tpl), "utf8");
  writeFileSync(join(outDir, "server", dest), render(src));
}

// M3: the design-system UI templates (tokens + dark + three states), wired to the
// M1 contract hooks. Emitted into src/ alongside the generated client so a
// generated frontend looks DESIGNED (not default) and cannot reference a
// non-contract endpoint. Optional: skip with --no-ui.
if (!process.argv.includes("--no-ui")) {
  const UI = join(__dir, "templates", "ui");
  mkdirSync(join(outDir, "src"), { recursive: true });
  for (const [tpl, dest] of [
    ["theme.css.tmpl", "theme.css"],
    ["ListView.tsx.tmpl", `${cap}ListView.tsx`],
  ]) {
    const src = readFileSync(join(UI, tpl), "utf8");
    writeFileSync(join(outDir, "src", dest), render(src));
  }
}

console.log(`generated real backend floor at ${outDir}/server (Express + SQLite, /${coll})`);
if (!process.argv.includes("--no-ui"))
  console.log(`generated design-system UI at ${outDir}/src (tokens + dark + 3 states, wired to the contract)`);
console.log(`next: (cd ${outDir}/server && npm install && PORT=3000 npm start)`);
