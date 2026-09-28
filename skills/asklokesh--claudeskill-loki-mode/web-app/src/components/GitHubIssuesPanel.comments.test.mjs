// S-186 / BACKLOG 116: the issue list asks gh for `comments`, which gh returns
// as an array of comment objects, so `issue.comments > 0` was always false and
// the list comment badge never showed.
//
// GitHubIssuesPanel.tsx is JSX and imports ../api/client (browser-only at
// module load), so it cannot be imported under plain `node --test`. ponytail:
// the test lifts the commentCount helper and the badge line out of the source,
// strips types with node:module and evaluates the helper. If the helper moves
// into its own .ts module, import it directly instead.
// Run: node --test web-app/src/components/GitHubIssuesPanel.comments.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const src = fs.readFileSync(new URL('./GitHubIssuesPanel.tsx', import.meta.url), 'utf8');

function loadCommentCount() {
  const start = src.indexOf('function commentCount');
  assert.ok(start >= 0, 'commentCount helper not found in GitHubIssuesPanel.tsx');
  const end = src.indexOf('\n}', start);
  assert.ok(end > start, 'commentCount helper end not found');
  return new Function(`${stripTypeScriptTypes(src.slice(start, end + 2))}\nreturn commentCount;`)();
}

test('an array of 2 comments renders 2', () => {
  assert.equal(loadCommentCount()([{ body: 'a' }, { body: 'b' }]), 2);
});

test('a number 3 renders 3', () => {
  assert.equal(loadCommentCount()(3), 3);
});

test('an empty array, 0 or a missing field renders 0 (badge hidden)', () => {
  const commentCount = loadCommentCount();
  assert.equal(commentCount([]), 0);
  assert.equal(commentCount(0), 0);
  assert.equal(commentCount(undefined), 0);
});

test('the list badge renders through commentCount, not the raw field', () => {
  const badgeAt = src.indexOf('<MessageSquare size={11} />');
  assert.ok(badgeAt >= 0, 'list comment badge not found');
  const around = src.slice(Math.max(0, badgeAt - 300), badgeAt + 200);
  assert.doesNotMatch(around, /issue\.comments\s*>\s*0/, 'badge still compares the raw comments field');
  assert.match(around, /commentCount\(issue\.comments\)\s*>\s*0/, 'badge condition must use commentCount');
  assert.match(around.slice(300), /\{commentCount\(issue\.comments\)\}/, 'badge text must use commentCount');
});
