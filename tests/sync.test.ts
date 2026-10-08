import {
  materializeOperations,
  mergeOperations,
  operationsForChange,
  validateOperation,
} from '../packages/storage/lib/impl/library-operations.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SavedPage } from '../packages/storage/lib/impl/read-later-storage.js';

const page: SavedPage = {
  id: 'p1',
  url: 'https://example.com/article',
  title: 'A thoughtful article',
  savedAt: 1000,
  tags: [],
  autoTags: [],
};
test('storage round trips may reorder keys without changing an immutable operation', () => {
  const [original] = operationsForChange([], [page], []);
  const reordered = JSON.parse(
    JSON.stringify(original, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : value,
    ),
  );
  assert.notEqual(JSON.stringify(original), JSON.stringify(reordered));
  assert.equal(mergeOperations([original], [reordered]).length, 1);
  assert.deepEqual(materializeOperations([original, reordered]), materializeOperations([original]));
});
test('same operation ID with genuinely different content remains a conflict', () => {
  const original = {
    id: 'same-id',
    at: 1000,
    url: page.url,
    kind: 'patch' as const,
    patch: { title: 'Original', tags: ['one', 'two'], notes: null },
  };
  for (const changed of [
    { ...original, at: 1001 },
    { ...original, url: 'https://example.com/other' },
    { ...original, kind: 'delete' as const },
    { ...original, patch: { ...original.patch, title: 'Changed' } },
    { ...original, patch: { ...original.patch, tags: ['two', 'one'] } },
    { ...original, patch: { title: 'Original', tags: ['one', 'two'] } },
  ])
    assert.throws(() => mergeOperations([original], [changed]), /Conflicting/);
});
test('offline changes merge in any order and duplicate delivery is idempotent', () => {
  const base = operationsForChange([], [page], []);
  const title = operationsForChange([page], [{ ...page, title: 'Renamed' }], base);
  const notes = operationsForChange([page], [{ ...page, notes: 'Phone note', progress: 0.45 }], base);
  const first = materializeOperations(mergeOperations(title, notes));
  const reversed = materializeOperations(mergeOperations(notes, title, notes));
  assert.deepEqual(first, reversed);
  assert.equal(first[0].title, 'Renamed');
  assert.equal(first[0].notes, 'Phone note');
  assert.equal(first[0].progress, 0.45);
});
test('deletions survive late updates and an explicit save can restore a page', () => {
  const base = operationsForChange([], [page], []);
  const deleted = operationsForChange([page], [], base);
  const late = {
    id: 'late-edit',
    at: Date.now() + 100,
    url: page.url,
    kind: 'patch' as const,
    patch: { notes: 'Stale device' },
  };
  assert.deepEqual(materializeOperations(mergeOperations(deleted, [late])), []);
  const restored = operationsForChange([], [page], mergeOperations(deleted, [late]));
  assert.equal(materializeOperations(restored)[0].url, page.url);
});
test('marking unread clears the synced visit timestamp', () => {
  const read = { ...page, visitedAt: 2000 };
  const base = operationsForChange([], [read], []);
  const updated = operationsForChange([read], [{ ...read, visitedAt: undefined }], base);
  assert.equal(materializeOperations(updated)[0].visitedAt, undefined);
});
test('legacy local libraries migrate without losing records', () => {
  const operations = operationsForChange([page], [page], []);
  assert.deepEqual(JSON.parse(JSON.stringify(materializeOperations(operations)[0])), page);
});
test('remote data cannot inject unsafe URLs, fields or invalid progress', () => {
  const valid = { id: 'op1', at: 100, url: page.url, kind: 'patch', patch: { progress: 0.4 } };
  for (const invalid of [
    { ...valid, url: 'javascript:alert(1)' },
    { ...valid, patch: { progress: NaN } },
    { ...valid, patch: { progress: 2 } },
    { ...valid, patch: { unknown: 'field' } },
  ])
    assert.throws(() => validateOperation(invalid));
});
