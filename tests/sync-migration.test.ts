import { removeLegacySyncCredentials } from '../packages/storage/lib/base/base.js';
import assert from 'node:assert/strict';
import test from 'node:test';

test('retired provider migration deletes only obsolete credentials and preserves reading data', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([
    ['read-later-cloudkit', 'old-token'],
    ['read-later-sync-status', 'old-status'],
    ['read-later-storage-key', 'reading-data'],
    ['read-later-supabase-auth', 'new-session'],
  ]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { removeItem: (key: string) => values.delete(key) },
  });
  try {
    await removeLegacySyncCredentials();
    await removeLegacySyncCredentials();
    assert.deepEqual(
      [...values],
      [
        ['read-later-storage-key', 'reading-data'],
        ['read-later-supabase-auth', 'new-session'],
      ],
    );
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
