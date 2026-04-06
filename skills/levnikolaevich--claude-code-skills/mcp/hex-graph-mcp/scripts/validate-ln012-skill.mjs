#!/usr/bin/env node

import { validateLn012Consistency } from "./quality-support.mjs";

const issues = validateLn012Consistency();
if (issues.length) {
    for (const issue of issues) {
        console.error(issue);
    }
    process.exitCode = 1;
}
