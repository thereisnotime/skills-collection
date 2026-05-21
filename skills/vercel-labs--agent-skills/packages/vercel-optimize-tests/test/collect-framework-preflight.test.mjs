import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const COLLECT = join(HERE, '..', '..', '..', 'skills', 'vercel-optimize', 'scripts', 'collect-signals.mjs');

test('collect-signals: unsupported framework stops before Observability and usage calls', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'vo-framework-preflight-'));
  const bin = join(scratch, 'bin');
  try {
    await mkdir(bin, { recursive: true });
    await mkdir(join(scratch, '.vercel'), { recursive: true });
    await writeFile(join(scratch, 'package.json'), JSON.stringify({
      dependencies: { hono: '^4.7.0' },
    }), 'utf-8');
    await writeFile(join(scratch, '.vercel', 'project.json'), JSON.stringify({
      projectId: 'prj_test',
      orgId: 'team_test',
    }), 'utf-8');
    const fakeVercel = join(bin, 'vercel');
    await writeFile(fakeVercel, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "53.0.0"
  exit 0
fi
if [ "$1" = "whoami" ]; then
  echo "test-user"
  exit 0
fi
echo "unexpected vercel call: $*" >&2
exit 66
`, 'utf-8');
    await chmod(fakeVercel, 0o755);

    const { stdout, stderr } = await exec('node', [COLLECT], {
      cwd: scratch,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      maxBuffer: 8 * 1024 * 1024,
    });
    const out = JSON.parse(stdout);
    assert.equal(out.stack.framework, 'hono');
    assert.equal(out.frameworkSupportBlocker, 'unsupported_framework');
    assert.equal(out.observabilityPlus, null);
    assert.equal(out.usageError, 'NOT_COLLECTED_UNSUPPORTED_FRAMEWORK');
    assert.match(stderr, /framework=hono@4\.7\.0 support=unsupported/);
    assert.doesNotMatch(stderr, /unexpected vercel call/);
    assert.doesNotMatch(stderr, /checking Observability Plus configuration/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('collect-signals: uses Vercel account billing.plan before empty-contract heuristics', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'vo-plan-preflight-'));
  const bin = join(scratch, 'bin');
  try {
    await mkdir(bin, { recursive: true });
    await mkdir(join(scratch, '.vercel'), { recursive: true });
    await writeFile(join(scratch, 'package.json'), JSON.stringify({
      dependencies: { next: '^15.3.0' },
    }), 'utf-8');
    await writeFile(join(scratch, '.vercel', 'project.json'), JSON.stringify({
      projectId: 'prj_test',
      orgId: 'team_hobby',
    }), 'utf-8');
    const fakeVercel = join(bin, 'vercel');
    await writeFile(fakeVercel, `#!/usr/bin/env node
const args = process.argv.slice(2);
function json(value, code = 0) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\\n');
  process.exit(code);
}
if (args[0] === '--version') {
  process.stdout.write('54.1.0\\n');
  process.exit(0);
}
if (args[0] === 'whoami') {
  process.stdout.write('test-user\\n');
  process.exit(0);
}
if (args[0] === 'api') {
  const path = args[1];
  if (path.startsWith('/v1/observability/manage/configuration/projects')) {
    json({ error: { code: 'not_found', message: 'Observability Plus is not enabled' } }, 1);
  }
  if (path === '/v9/projects/prj_test?teamId=team_hobby') {
    json({ id: 'prj_test', name: 'fixture-site' });
  }
  if (path === '/v2/teams/team_hobby') {
    json({ id: 'team_hobby', slug: 'fixture', billing: { plan: 'hobby' } });
  }
}
if (args[0] === 'contract') {
  json({ context: 'fixture', commitments: [], totalCommitments: 0 });
}
if (args[0] === 'usage') {
  json({
    context: 'fixture',
    groupBy: { dimension: 'project', data: [] },
    services: [],
    totals: { billedCost: 0 },
  });
}
process.stderr.write('unexpected vercel call: ' + args.join(' ') + '\\n');
process.exit(66);
`, 'utf-8');
    await chmod(fakeVercel, 0o755);

    const { stdout, stderr } = await exec('node', [COLLECT, '--continue-without-observability'], {
      cwd: scratch,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      maxBuffer: 8 * 1024 * 1024,
    });
    const out = JSON.parse(stdout);
    assert.equal(out.plan.plan, 'hobby');
    assert.match(out.plan.reason, /team\.billing\.plan=hobby/);
    assert.deepEqual(out.contract, { context: 'fixture', commitments: [], totalCommitments: 0 });
    assert.equal(out.usageError, null);
    assert.doesNotMatch(stderr, /unexpected vercel call/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('collect-signals: no orgId uses current CLI team billing.plan before user billing.plan', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'vo-current-team-plan-'));
  const bin = join(scratch, 'bin');
  try {
    await mkdir(bin, { recursive: true });
    await mkdir(join(scratch, '.vercel'), { recursive: true });
    await writeFile(join(scratch, 'package.json'), JSON.stringify({
      dependencies: { next: '^15.3.0' },
    }), 'utf-8');
    await writeFile(join(scratch, '.vercel', 'project.json'), JSON.stringify({
      projectId: 'prj_test',
    }), 'utf-8');
    const fakeVercel = join(bin, 'vercel');
    await writeFile(fakeVercel, `#!/usr/bin/env node
const args = process.argv.slice(2);
function json(value, code = 0) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\\n');
  process.exit(code);
}
if (args[0] === '--version') {
  process.stdout.write('54.1.0\\n');
  process.exit(0);
}
if (args[0] === 'whoami' && args[1] === '--format') {
  json({
    username: 'test-user',
    billing: { plan: 'hobby' },
    team: { id: 'team_current', slug: 'current-team', name: 'Current Team' },
  });
}
if (args[0] === 'whoami') {
  process.stdout.write('test-user\\n');
  process.exit(0);
}
if (args[0] === 'api') {
  const path = args[1];
  if (path === '/v9/projects/prj_test') {
    json({ id: 'prj_test', name: 'fixture-site' });
  }
  if (path === '/v2/teams/team_current') {
    json({ id: 'team_current', slug: 'current-team', billing: { plan: 'pro' } });
  }
  if (path === '/v2/user') {
    json({ user: { username: 'test-user', billing: { plan: 'hobby' } } });
  }
}
if (args[0] === 'contract') {
  json({ context: 'current-team', commitments: [], totalCommitments: 0 });
}
if (args[0] === 'usage') {
  json({
    context: 'current-team',
    groupBy: { dimension: 'project', data: [] },
    services: [],
    totals: { billedCost: 0 },
  });
}
process.stderr.write('unexpected vercel call: ' + args.join(' ') + '\\n');
process.exit(66);
`, 'utf-8');
    await chmod(fakeVercel, 0o755);

    const { stdout, stderr } = await exec('node', [COLLECT, '--continue-without-observability'], {
      cwd: scratch,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      maxBuffer: 8 * 1024 * 1024,
    });
    const out = JSON.parse(stdout);
    assert.equal(out.plan.plan, 'pro');
    assert.match(out.plan.reason, /team\.billing\.plan=pro/);
    assert.equal(out.orgId, null);
    assert.doesNotMatch(stderr, /unexpected vercel call/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
