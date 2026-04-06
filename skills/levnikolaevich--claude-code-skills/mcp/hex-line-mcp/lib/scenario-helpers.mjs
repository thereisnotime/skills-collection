import { readFileSync, statSync, readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve, extname } from "node:path";

// ---------------------------------------------------------------------------
// Constants (shared with benchmark.mjs)
// ---------------------------------------------------------------------------

const CODE_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".cs", ".php"]);
const MAX_FILES_PER_CAT = 3;
const RUNS = 5;

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walkDir(dir, depth = 0) {
    if (depth > 10) return [];
    const results = [];
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return results; }
    for (const e of entries) {
        const full = resolve(dir, e.name);
        if (e.isDirectory()) {
            if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "vendor"
                || e.name === "dist" || e.name === "__pycache__" || e.name === "target") continue;
            results.push(...walkDir(full, depth + 1));
        } else if (e.isFile() && CODE_EXTS.has(extname(e.name).toLowerCase())) {
            try {
                const st = statSync(full);
                if (st.size > 0 && st.size < 1_000_000) results.push(full);
            } catch { /* skip */ }
        }
    }
    return results;
}

function getFileLines(f) {
    try { return readFileSync(f, "utf-8").replace(/\r\n/g, "\n").split("\n"); }
    catch { return null; }
}

function categorize(files) {
    const cats = { small: [], medium: [], large: [], xl: [] };
    for (const f of files) {
        const lines = getFileLines(f);
        if (!lines) continue;
        const n = lines.length;
        if (n >= 10 && n <= 50) cats.small.push(f);
        else if (n > 50 && n <= 200) cats.medium.push(f);
        else if (n > 200 && n <= 500) cats.large.push(f);
        else if (n > 500) cats.xl.push(f);
    }
    for (const key of Object.keys(cats)) {
        const arr = cats[key];
        if (arr.length > MAX_FILES_PER_CAT) {
            const step = Math.floor(arr.length / MAX_FILES_PER_CAT);
            cats[key] = Array.from({ length: MAX_FILES_PER_CAT }, (_, i) => arr[i * step]);
        }
    }
    return cats;
}

// ---------------------------------------------------------------------------
// Temp file: 200 lines of realistic JS
// ---------------------------------------------------------------------------

function generateTempCode() {
    const lines = [];
    lines.push('import { readFileSync } from "node:fs";');
    lines.push('import { resolve, basename } from "node:path";');
    lines.push("");
    lines.push("const DEFAULT_TIMEOUT = 5000;");
    lines.push("const MAX_RETRIES = 3;");
    lines.push("");
    lines.push("/**");
    lines.push(" * Configuration manager for application settings.");
    lines.push(" * Supports file-based and environment-based config sources.");
    lines.push(" */");
    lines.push("class ConfigManager {");
    lines.push("    constructor(configPath) {");
    lines.push("        this.configPath = resolve(configPath);");
    lines.push("        this.cache = new Map();");
    lines.push("        this.watchers = [];");
    lines.push("        this.loaded = false;");
    lines.push("    }");
    lines.push("");
    lines.push("    load() {");
    lines.push("        const raw = readFileSync(this.configPath, 'utf-8');");
    lines.push("        const parsed = JSON.parse(raw);");
    lines.push("        for (const [key, value] of Object.entries(parsed)) {");
    lines.push("            this.cache.set(key, value);");
    lines.push("        }");
    lines.push("        this.loaded = true;");
    lines.push("        this.notifyWatchers('load', parsed);");
    lines.push("        return this;");
    lines.push("    }");
    lines.push("");
    lines.push("    get(key, defaultValue = undefined) {");
    lines.push("        if (!this.loaded) this.load();");
    lines.push("        return this.cache.has(key) ? this.cache.get(key) : defaultValue;");
    lines.push("    }");
    lines.push("");
    lines.push("    set(key, value) {");
    lines.push("        this.cache.set(key, value);");
    lines.push("        this.notifyWatchers('set', { key, value });");
    lines.push("    }");
    lines.push("");
    lines.push("    watch(callback) {");
    lines.push("        this.watchers.push(callback);");
    lines.push("        return () => {");
    lines.push("            this.watchers = this.watchers.filter(w => w !== callback);");
    lines.push("        };");
    lines.push("    }");
    lines.push("");
    lines.push("    notifyWatchers(event, data) {");
    lines.push("        for (const watcher of this.watchers) {");
    lines.push("            try { watcher(event, data); }");
    lines.push("            catch (e) { console.error('Watcher error:', e.message); }");
    lines.push("        }");
    lines.push("    }");
    lines.push("}");
    lines.push("");
    lines.push("/**");
    lines.push(" * Retry wrapper with exponential backoff.");
    lines.push(" */");
    lines.push("async function withRetry(fn, options = {}) {");
    lines.push("    const { retries = MAX_RETRIES, delay = 100, backoff = 2 } = options;");
    lines.push("    let lastError;");
    lines.push("    for (let attempt = 0; attempt <= retries; attempt++) {");
    lines.push("        try {");
    lines.push("            return await fn(attempt);");
    lines.push("        } catch (err) {");
    lines.push("            lastError = err;");
    lines.push("            if (attempt < retries) {");
    lines.push("                const wait = delay * Math.pow(backoff, attempt);");
    lines.push("                await new Promise(r => setTimeout(r, wait));");
    lines.push("            }");
    lines.push("        }");
    lines.push("    }");
    lines.push("    throw lastError;");
    lines.push("}");
    lines.push("");
    lines.push("/**");
    lines.push(" * HTTP client with timeout and retry support.");
    lines.push(" */");
    lines.push("class HttpClient {");
    lines.push("    constructor(baseUrl, options = {}) {");
    lines.push("        this.baseUrl = baseUrl.replace(/\\/$/, '');");
    lines.push("        this.timeout = options.timeout || DEFAULT_TIMEOUT;");
    lines.push("        this.headers = options.headers || {};");
    lines.push("        this.retries = options.retries || MAX_RETRIES;");
    lines.push("    }");
    lines.push("");
    lines.push("    async request(method, path, body = null) {");
    lines.push("        const url = `${this.baseUrl}${path}`;");
    lines.push("        const controller = new AbortController();");
    lines.push("        const timer = setTimeout(() => controller.abort(), this.timeout);");
    lines.push("");
    lines.push("        try {");
    lines.push("            return await withRetry(async () => {");
    lines.push("                const opts = {");
    lines.push("                    method,");
    lines.push("                    headers: { ...this.headers },");
    lines.push("                    signal: controller.signal,");
    lines.push("                };");
    lines.push("                if (body) {");
    lines.push("                    opts.headers['Content-Type'] = 'application/json';");
    lines.push("                    opts.body = JSON.stringify(body);");
    lines.push("                }");
    lines.push("                const response = await fetch(url, opts);");
    lines.push("                if (!response.ok) {");
    lines.push("                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);");
    lines.push("                }");
    lines.push("                return response.json();");
    lines.push("            }, { retries: this.retries });");
    lines.push("        } finally {");
    lines.push("            clearTimeout(timer);");
    lines.push("        }");
    lines.push("    }");
    lines.push("");
    lines.push("    get(path) { return this.request('GET', path); }");
    lines.push("    post(path, body) { return this.request('POST', path, body); }");
    lines.push("    put(path, body) { return this.request('PUT', path, body); }");
    lines.push("    delete(path) { return this.request('DELETE', path); }");
    lines.push("}");
    lines.push("");
    lines.push("/**");
    lines.push(" * Simple event emitter for pub/sub patterns.");
    lines.push(" */");
    lines.push("class EventEmitter {");
    lines.push("    constructor() {");
    lines.push("        this.listeners = new Map();");
    lines.push("    }");
    lines.push("");
    lines.push("    on(event, handler) {");
    lines.push("        if (!this.listeners.has(event)) {");
    lines.push("            this.listeners.set(event, []);");
    lines.push("        }");
    lines.push("        this.listeners.get(event).push(handler);");
    lines.push("        return this;");
    lines.push("    }");
    lines.push("");
    lines.push("    off(event, handler) {");
    lines.push("        const handlers = this.listeners.get(event);");
    lines.push("        if (handlers) {");
    lines.push("            this.listeners.set(event, handlers.filter(h => h !== handler));");
    lines.push("        }");
    lines.push("        return this;");
    lines.push("    }");
    lines.push("");
    lines.push("    emit(event, ...args) {");
    lines.push("        const handlers = this.listeners.get(event) || [];");
    lines.push("        for (const handler of handlers) {");
    lines.push("            handler(...args);");
    lines.push("        }");
    lines.push("    }");
    lines.push("");
    lines.push("    once(event, handler) {");
    lines.push("        const wrapper = (...args) => {");
    lines.push("            handler(...args);");
    lines.push("            this.off(event, wrapper);");
    lines.push("        };");
    lines.push("        return this.on(event, wrapper);");
    lines.push("    }");
    lines.push("}");
    lines.push("");
    lines.push("/**");
    lines.push(" * Validate and sanitize user input.");
    lines.push(" */");
    lines.push("function validateInput(schema, data) {");
    lines.push("    const errors = [];");
    lines.push("    for (const [field, rules] of Object.entries(schema)) {");
    lines.push("        const value = data[field];");
    lines.push("        if (rules.required && (value === undefined || value === null)) {");
    lines.push("            errors.push(`${field} is required`);");
    lines.push("            continue;");
    lines.push("        }");
    lines.push("        if (value !== undefined && rules.type && typeof value !== rules.type) {");
    lines.push("            errors.push(`${field} must be ${rules.type}`);");
    lines.push("        }");
    lines.push("        if (typeof value === 'string' && rules.maxLength && value.length > rules.maxLength) {");
    lines.push("            errors.push(`${field} exceeds max length ${rules.maxLength}`);");
    lines.push("        }");
    lines.push("        if (typeof value === 'number' && rules.min !== undefined && value < rules.min) {");
    lines.push("            errors.push(`${field} must be >= ${rules.min}`);");
    lines.push("        }");
    lines.push("    }");
    lines.push("    return errors.length > 0 ? { valid: false, errors } : { valid: true };");
    lines.push("}");
    lines.push("");
    lines.push("/**");
    lines.push(" * Format bytes to human-readable string.");
    lines.push(" */");
    lines.push("function formatBytes(bytes) {");
    lines.push("    if (bytes === 0) return '0 B';");
    lines.push("    const units = ['B', 'KB', 'MB', 'GB', 'TB'];");
    lines.push("    const exp = Math.floor(Math.log(bytes) / Math.log(1024));");
    lines.push("    const value = bytes / Math.pow(1024, exp);");
    lines.push("    return `${value.toFixed(exp > 0 ? 1 : 0)} ${units[exp]}`;");
    lines.push("}");
    lines.push("");
    lines.push("/**");
    lines.push(" * Deep merge two objects (source into target).");
    lines.push(" */");
    lines.push("function deepMerge(target, source) {");
    lines.push("    const result = { ...target };");
    lines.push("    for (const key of Object.keys(source)) {");
    lines.push("        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {");
    lines.push("            result[key] = deepMerge(result[key] || {}, source[key]);");
    lines.push("        } else {");
    lines.push("            result[key] = source[key];");
    lines.push("        }");
    lines.push("    }");
    lines.push("    return result;");
    lines.push("}");
    lines.push("");
    lines.push("export { ConfigManager, HttpClient, EventEmitter, withRetry, validateInput, formatBytes, deepMerge };");

    // Pad to exactly 200 lines
    while (lines.length < 200) lines.push("");
    return lines.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Runner utilities
// ---------------------------------------------------------------------------

function median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function runN(fn, n = RUNS) {
    const results = [];
    const times = [];
    for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        results.push(fn());
        times.push(performance.now() - t0);
    }
    return { value: median(results), ms: parseFloat(median(times).toFixed(1)) };
}

function fmt(n) {
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function pctSavings(without, withSL) {
    if (without === 0) return "N/A";
    const pct = ((without - withSL) / without) * 100;
    return pct >= 0 ? `${pct.toFixed(0)}%` : `-${Math.abs(pct).toFixed(0)}%`;
}

export {
    walkDir, getFileLines, categorize, generateTempCode,
    median, runN, fmt, pctSavings, RUNS,
};
