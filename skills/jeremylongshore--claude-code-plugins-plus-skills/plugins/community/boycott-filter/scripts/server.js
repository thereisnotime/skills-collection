#!/usr/bin/env node
/**
 * Boycott Filter — Local sync server
 *
 * Tiny HTTP server that serves the boycott list to the Chrome extension.
 * Claude Code writes to boycott-list.json, this serves it with CORS.
 *
 * Port 7847 (BOYCOTT on a phone keypad, close enough)
 */

import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIST_FILE = join(__dirname, '..', 'boycott-list.json');
const PORT = 7847;

// Maximum request body size (protects against unbounded accumulation in req.on('data'))
const MAX_BODY_BYTES = 1024 * 1024;  // 1 MB — boycott entries are tiny, more than enough

// Validation limits — stops oversize / wrong-type values from feeding into the
// XSS surface in the Chrome extension (which uses esc() defensively but
// belt-and-suspenders is correct here).
const MAX_NAME_LEN = 200;
const MAX_REASON_LEN = 1000;
const MAX_ALIASES = 50;
const MAX_ALIAS_LEN = 200;

function readList() {
  try {
    return JSON.parse(readFileSync(LIST_FILE, 'utf8'));
  } catch {
    return { companies: [], updated_at: null };
  }
}

function writeList(data) {
  data.updated_at = new Date().toISOString();
  writeFileSync(LIST_FILE, JSON.stringify(data, null, 2));
  return data;
}

/**
 * Read the request body with a hard size cap. Aborts the connection if the
 * client tries to send more than MAX_BODY_BYTES — prevents memory exhaustion
 * from a malicious / buggy client.
 */
function readBody(req, res, cb) {
  let body = '';
  let aborted = false;
  req.on('data', chunk => {
    if (aborted) return;
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      aborted = true;
      res.writeHead(413);
      res.end(JSON.stringify({ error: 'request body too large (max 1MB)' }));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (aborted) return;
    cb(body);
  });
}

/**
 * Validate an /add payload. Returns null if OK, an error string otherwise.
 * Enforces type + length limits to guard the extension's XSS surface.
 */
function validateAddPayload(p) {
  if (!p || typeof p !== 'object') return 'payload must be an object';
  if (typeof p.name !== 'string' || !p.name.trim()) return 'name required (non-empty string)';
  if (p.name.length > MAX_NAME_LEN) return `name too long (max ${MAX_NAME_LEN} chars)`;
  if (p.reason !== undefined && p.reason !== null) {
    if (typeof p.reason !== 'string') return 'reason must be a string';
    if (p.reason.length > MAX_REASON_LEN) return `reason too long (max ${MAX_REASON_LEN} chars)`;
  }
  if (p.aliases !== undefined && p.aliases !== null) {
    if (!Array.isArray(p.aliases)) return 'aliases must be an array';
    if (p.aliases.length > MAX_ALIASES) return `too many aliases (max ${MAX_ALIASES})`;
    for (const a of p.aliases) {
      if (typeof a !== 'string') return 'every alias must be a string';
      if (a.length > MAX_ALIAS_LEN) return `alias too long (max ${MAX_ALIAS_LEN} chars)`;
    }
  }
  return null;
}

const server = createServer((req, res) => {
  // No CORS headers by design.
  //
  // The Chrome extension declares `host_permissions: http://127.0.0.1:7847/*`
  // in its manifest, which gives it cross-origin network access to this server
  // independent of CORS — the browser treats it as same-origin-ish for declared
  // host permissions. Random websites the user visits do NOT have that grant,
  // so without `Access-Control-Allow-Origin` they cannot read responses.
  //
  // The previous wildcard `Access-Control-Allow-Origin: *` let any visited
  // website query (info disclosure) and POST (XSS injection) into the local
  // boycott list. Removed.

  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    // Preflight without CORS headers — browser will reject for cross-origin
    // callers. Same-origin / extension-origin requests don't need preflight.
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/list') {
    res.writeHead(200);
    res.end(JSON.stringify(readList()));
    return;
  }

  if (req.method === 'POST' && req.url === '/add') {
    readBody(req, res, (body) => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }
      const err = validateAddPayload(payload);
      if (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: err }));
        return;
      }
      const { name, reason, aliases } = payload;
      const list = readList();
      const existing = list.companies.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: 'already boycotted', company: existing }));
        return;
      }
      list.companies.push({
        name: name.trim(),
        reason: reason ? String(reason) : null,
        aliases: aliases || [],
        added_at: new Date().toISOString()
      });
      const updated = writeList(list);
      res.writeHead(201);
      res.end(JSON.stringify({ ok: true, list: updated }));
    });
    return;
  }

  if (req.method === 'DELETE' && req.url === '/remove') {
    readBody(req, res, (body) => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }
      if (!payload || typeof payload.name !== 'string' || !payload.name.trim()) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'name required (non-empty string)' }));
        return;
      }
      const { name } = payload;
      const list = readList();
      const before = list.companies.length;
      list.companies = list.companies.filter(c => c.name.toLowerCase() !== name.toLowerCase());
      if (list.companies.length === before) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      const updated = writeList(list);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, list: updated }));
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', companies: readList().companies.length }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Boycott Filter server running on http://127.0.0.1:${PORT}`);
  console.log(`List file: ${LIST_FILE}`);
});
