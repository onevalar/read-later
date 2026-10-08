import assert from 'node:assert/strict';
import test from 'node:test';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
const {
  configureSupabase,
  disconnectSupabase,
  supabaseConfigStorage,
  syncStatusStorage,
  syncReadingLibrary,
  signInToSupabase,
} = await import('../packages/storage/lib/impl/supabase-sync.js');
const { readLaterStorage } = await import('../packages/storage/lib/impl/read-later-storage.js');
const owner = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const config = { url: 'https://session-test.supabase.co', publishableKey: 'sb_publishable_test', enabled: false };
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const reset = async function reset() {
  await supabaseConfigStorage.set({ ...config });
  await syncStatusStorage.set({ phase: 'local' });
  await readLaterStorage.set({ pages: [], allTags: [], operations: [] });
};

test('unconfigured and offline libraries never make a network request', async () => {
  await reset();
  const oldFetch = globalThis.fetch;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.fetch = async () => {
    throw new Error('unexpected network request');
  };
  try {
    await syncReadingLibrary();
    assert.equal((await syncStatusStorage.get()).phase, 'local');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
    await supabaseConfigStorage.set({ ...config, enabled: true, boundUserId: owner });
    await syncReadingLibrary();
    assert.equal((await syncStatusStorage.get()).phase, 'offline');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('a bound library cannot change its project during configuration', async () => {
  await reset();
  await supabaseConfigStorage.set({ ...config, boundUserId: owner });
  await assert.rejects(configureSupabase({ ...config, url: 'https://another-project.supabase.co' }), /绑定云端项目/);
  assert.equal((await supabaseConfigStorage.get()).url, config.url);
});

test('foreign account sign-in cannot upload local content and clears the foreign session', async () => {
  await reset();
  await supabaseConfigStorage.set({ ...config, boundUserId: owner });
  await readLaterStorage.savePage({ url: 'https://example.com/private-local', title: 'Local reading' });
  const oldFetch = globalThis.fetch;
  const user = {
    id: foreign,
    email: 'another@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-10-08T00:00:00Z',
  };
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const token = [
    'eyJhbGciOiJIUzI1NiJ9',
    Buffer.from(JSON.stringify({ sub: foreign, exp: expiry })).toString('base64url'),
    'signature',
  ].join('.');
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname;
    assert.ok(!path.startsWith('/rest/'), 'must not access reading data on a foreign account');
    if (path.endsWith('/token'))
      return json({
        access_token: token,
        refresh_token: 'foreign-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user,
      });
    if (path.endsWith('/user')) return json(user);
    if (path.endsWith('/logout')) return new Response(null, { status: 204 });
    throw new Error('unexpected auth path');
  };
  try {
    await assert.rejects(signInToSupabase(user.email, 'test-only-password'), /其他账号/);
    assert.equal((await supabaseConfigStorage.get()).boundUserId, owner);
    assert.equal((await supabaseConfigStorage.get()).enabled, false);
    assert.equal((await readLaterStorage.get()).pages.length, 1);
    assert.equal(values.get('read-later-supabase-auth'), '{}');
    await disconnectSupabase();
    assert.equal((await readLaterStorage.get()).pages.length, 1);
    assert.equal((await supabaseConfigStorage.get()).boundUserId, owner);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
