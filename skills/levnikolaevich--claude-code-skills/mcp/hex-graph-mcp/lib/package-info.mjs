import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export function getPackageInfo() {
    return packageJson;
}

export function getPackageVersion() {
    return packageJson.version;
}
