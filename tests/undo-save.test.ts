import assert from 'node:assert/strict';
import test from 'node:test';

// Isolated persistence for the real storage API; no browser profile or cloud account is used.
const values = new Map<string, string>();
let failWrites = false;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('Quota exceeded');
      values.set(key, value);
    },
  },
});
const { readLaterStorage } = await import('../packages/storage/lib/impl/read-later-storage.js');
const { materializeOperations } = await import('../packages/storage/lib/impl/library-operations.js');
const input = { url: 'https://example.com/undo-test', title: 'A page saved by mistake' };
const reset = async () => {
  failWrites = false;
  await readLaterStorage.set({ pages: [], allTags: [], operations: [] });
};
const save = async () => {
  const outcome = await readLaterStorage.savePageWithReceipt(input);
  assert.equal(outcome.result, 'saved');
  if (outcome.result !== 'saved') throw new Error('Expected a new save');
  return outcome.receipt;
};

test('undo removes only this save and records a deletion that survives sync delivery', async () => {
  await reset();
  await readLaterStorage.savePage({ url: 'https://example.com/keep', title: 'Keep this' });
  const receipt = await save();
  const prior = await readLaterStorage.get();
  assert.equal(await readLaterStorage.undoSave(receipt), 'undone');
  const state = await readLaterStorage.get();
  assert.deepEqual(
    state.pages.map(page => page.title),
    ['Keep this'],
  );
  assert.equal(state.operations?.at(-1)?.kind, 'delete');
  await readLaterStorage.mergeCloudOperations(prior.operations ?? []);
  assert.deepEqual(
    JSON.parse(JSON.stringify(materializeOperations((await readLaterStorage.get()).operations ?? []))),
    state.pages,
  );
  assert.equal(await readLaterStorage.undoSave(receipt), 'missing');
});

test('duplicate and unsupported saves have no undo receipt and preserve existing content', async () => {
  await reset();
  await save();
  assert.deepEqual(await readLaterStorage.savePageWithReceipt(input), { result: 'duplicate' });
  assert.deepEqual(await readLaterStorage.savePageWithReceipt({ ...input, url: 'chrome://settings' }), {
    result: 'unsupported',
  });
  assert.equal(await readLaterStorage.savePage(input), 'duplicate');
  assert.equal((await readLaterStorage.get()).pages.length, 1);
});

test('edits and reading progress prevent an old save from being undone', async () => {
  for (const change of [
    { notes: 'Keep my note' },
    { progress: 0.3 },
    { visitedAt: Date.now() },
    { tags: ['important'] },
  ]) {
    await reset();
    const receipt = await save();
    await readLaterStorage.updatePage(receipt.pageId, change);
    assert.equal(await readLaterStorage.undoSave(receipt), 'changed');
    assert.equal((await readLaterStorage.get()).pages.length, 1);
  }
});

test('merged changes from another device also prevent undo', async () => {
  await reset();
  const receipt = await save();
  const at = ((await readLaterStorage.get()).operations?.at(-1)?.at ?? Date.now()) + 1;
  await readLaterStorage.mergeCloudOperations([
    { id: 'phone-edit', at, url: input.url, kind: 'patch', patch: { notes: 'From my phone' } },
  ]);
  assert.equal(await readLaterStorage.undoSave(receipt), 'changed');
  assert.equal((await readLaterStorage.get()).pages[0].notes, 'From my phone');
});

test('an old receipt cannot remove a later re-save or target a different page', async () => {
  await reset();
  const receipt = await save();
  assert.equal(await readLaterStorage.undoSave({ ...receipt, operationId: 'wrong-operation' }), 'changed');
  await readLaterStorage.removePage(receipt.pageId);
  const replacement = await save();
  assert.equal(await readLaterStorage.undoSave(receipt), 'missing');
  assert.equal((await readLaterStorage.get()).pages[0].id, replacement.pageId);
});

test('queued edits win before undo and a failed undo can be retried without data loss', async () => {
  await reset();
  let receipt = await save();
  const edit = readLaterStorage.updatePage(receipt.pageId, { notes: 'Concurrent edit' });
  const undo = readLaterStorage.undoSave(receipt);
  await edit;
  assert.equal(await undo, 'changed');
  await reset();
  receipt = await save();
  failWrites = true;
  await assert.rejects(readLaterStorage.undoSave(receipt), /Quota exceeded/);
  assert.equal((await readLaterStorage.get()).pages.length, 1);
  assert.equal(readLaterStorage.getSnapshot()?.pages.length, 1);
  failWrites = false;
  assert.equal(await readLaterStorage.undoSave(receipt), 'undone');
});

test('concurrent saves return only one undo receipt and a failed save returns none', async () => {
  await reset();
  const results = await Promise.all([
    readLaterStorage.savePageWithReceipt(input),
    readLaterStorage.savePageWithReceipt(input),
  ]);
  assert.deepEqual(
    results.map(result => result.result),
    ['saved', 'duplicate'],
  );
  await reset();
  failWrites = true;
  await assert.rejects(readLaterStorage.savePageWithReceipt(input), /Quota exceeded/);
  assert.equal((await readLaterStorage.get()).pages.length, 0);
  failWrites = false;
  assert.equal(await readLaterStorage.savePage(input), 'saved');
});
