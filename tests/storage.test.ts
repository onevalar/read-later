import { createStorage } from '../packages/storage/lib/base/base.js';
import assert from 'node:assert/strict';
import test from 'node:test';

test('a failed persistent write keeps the last saved snapshot and emits no successful change', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => '7',
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    },
  });
  try {
    const storage = createStorage<number>('quota-regression', 0);
    await new Promise<void>(resolve => setImmediate(resolve));
    let notifications = 0;
    storage.subscribe(() => notifications++);
    await assert.rejects(storage.set(8), /Quota exceeded/);
    assert.equal(storage.getSnapshot(), 7);
    assert.equal(notifications, 0);
    assert.equal(await storage.get(), 7);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
