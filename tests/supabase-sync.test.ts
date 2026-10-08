import { mergeOperations } from '../packages/storage/lib/impl/library-operations.js';
import {
  createSupabaseSDK,
  SupabaseLibraryClient,
  validateSupabaseConnection,
} from '../packages/storage/lib/impl/supabase-client.js';
import { readingSyncStatus, syncLibraryRound } from '../packages/storage/lib/impl/sync-engine.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { LibraryOperation } from '../packages/storage/lib/impl/library-operations.js';
import type { LibraryRemote } from '../packages/storage/lib/impl/supabase-client.js';

const userId = '11111111-1111-4111-8111-111111111111';
const user = {
  id: userId,
  email: 'reader@example.com',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-08T00:00:00Z',
};
const config = { url: 'https://test-reader.supabase.co', publishableKey: 'sb_publishable_test' };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const token = (expiry: number) =>
  [
    'eyJhbGciOiJIUzI1NiJ9',
    Buffer.from(JSON.stringify({ sub: userId, exp: expiry, role: 'authenticated' })).toString('base64url'),
    'signature',
  ].join('.');
const session = (expiry = Math.floor(Date.now() / 1000) + 3600) => ({
  access_token: token(expiry),
  refresh_token: 'test-refresh',
  expires_at: expiry,
  expires_in: 3600,
  token_type: 'bearer',
  user,
});
const operation = (id: string): LibraryOperation => ({
  id,
  at: 1000,
  url: 'https://example.com/' + id,
  kind: 'create',
  patch: { id, title: id, savedAt: 1000, tags: [], autoTags: [] },
});
const client = function client(transport: typeof fetch, existing = session()) {
  const values = new Map<string, string>([['read-later-session-test-reader.supabase.co', JSON.stringify(existing)]]);
  const sdk = createSupabaseSDK(
    config,
    {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: key => {
        values.delete(key);
      },
    },
    transport,
  );
  return { remote: new SupabaseLibraryClient(sdk), values, sdk };
};

test('only hosted HTTPS project URLs and publishable keys can enter client configuration', () => {
  for (const url of [
    'http://test.supabase.co',
    'https://supabase.co.evil.test',
    'https://test.supabase.co/path',
    'https://user:password@test.supabase.co',
  ])
    assert.throws(() => validateSupabaseConnection({ ...config, url }));
  for (const publishableKey of ['sb_secret_do_not_ship', 'service_role', 'eyJhbGciOiJIUzI1NiJ9'])
    assert.throws(() => validateSupabaseConnection({ ...config, publishableKey }));
  assert.deepEqual(
    validateSupabaseConnection({ url: config.url + '/', publishableKey: config.publishableKey }),
    config,
  );
});

test('official SDK refreshes an expired session without another password prompt', async () => {
  const calls: string[] = [];
  const { remote, values } = client(
    async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.pathname + url.search);
      if (url.pathname.endsWith('/token')) {
        assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
        assert.equal(JSON.parse(String(init?.body)).refresh_token, 'test-refresh');
        return json({ ...session(), refresh_token: 'rotated-refresh' });
      }
      assert.equal(url.pathname, '/auth/v1/user');
      assert.ok(new Headers(init?.headers).get('authorization')?.startsWith('Bearer '));
      return json(user);
    },
    session(Math.floor(Date.now() / 1000) - 120),
  );
  assert.equal((await remote.currentUser()).id, userId);
  assert.equal(calls.filter(path => path.includes('grant_type=refresh_token')).length, 1);
  assert.equal(JSON.parse(values.get('read-later-session-test-reader.supabase.co')!).refresh_token, 'rotated-refresh');
});

test('password login sends credentials only to the configured auth endpoint and never stores the password', async () => {
  const password = 'fake-test-password-only';
  const { remote, values } = client(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, config.url);
    assert.ok(!url.href.includes(password));
    if (url.pathname === '/auth/v1/token') {
      assert.equal(url.searchParams.get('grant_type'), 'password');
      assert.deepEqual(JSON.parse(String(init?.body)), { email: user.email, password, gotrue_meta_security: {} });
      return json(session());
    }
    assert.equal(url.pathname, '/auth/v1/user');
    return json(user);
  });
  assert.equal((await remote.signIn(user.email, password)).id, userId);
  assert.ok(!JSON.stringify([...values.values()]).includes(password));
});

test('operation reads page by immutable ID and filter the bound owner on every request', async () => {
  const records = Array.from({ length: 205 }, (_, i) => operation('op-' + String(i).padStart(4, '0')));
  let requests = 0;
  const { remote } = client(async input => {
    const url = new URL(String(input));
    requests++;
    assert.equal(url.searchParams.get('user_id'), 'eq.' + userId);
    assert.equal(url.searchParams.get('order'), 'id.asc');
    const start = url.searchParams.has('id') ? 200 : 0;
    if (start) assert.equal(url.searchParams.get('id'), 'gt.op-0199');
    return json(records.slice(start, start + 200).map(op => ({ id: op.id, payload: JSON.stringify(op) })));
  });
  assert.deepEqual(await remote.fetchOperations(userId), records);
  assert.equal(requests, 2);
});

test('retrying an insert verifies ignored duplicates instead of silently accepting conflicting data', async () => {
  const op = operation('duplicate');
  let reads = 0;
  const { remote } = client(async (_input, init) => {
    if (init?.method === 'POST') {
      assert.match(new Headers(init.headers).get('prefer') ?? '', /resolution=ignore-duplicates/);
      return new Response(null, { status: 201 });
    }
    reads++;
    return json([{ id: op.id, payload: JSON.stringify({ ...op, patch: { ...op.patch, title: 'different' } }) }]);
  });
  await assert.rejects(remote.pushOperations(userId, [op]), /尚未确认/);
  assert.equal(reads, 1);
});

test('upload retry accepts the same historical payload with differently ordered JSON keys', async () => {
  const op = operation('legacy-order');
  const historical = {
    patch: { tags: [], savedAt: 1000, title: op.id, autoTags: [], id: op.id },
    kind: op.kind,
    url: op.url,
    at: op.at,
    id: op.id,
  };
  const { remote } = client(async (_input, init) =>
    init?.method === 'POST'
      ? new Response(null, { status: 201 })
      : json([{ id: op.id, payload: JSON.stringify(historical) }]),
  );
  await remote.pushOperations(userId, [op]);
});

test('uploads are byte-bounded and confirmed by an owner-filtered lookup', async () => {
  const operations = Array.from({ length: 15 }, (_, index) => ({
    ...operation('article-' + index),
    patch: { ...operation('article-' + index).patch, articleText: '测'.repeat(110000) },
  }));
  const saved = new Map<string, string>();
  let uploads = 0;
  const { remote } = client(async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === 'POST') {
      uploads++;
      assert.ok(Buffer.byteLength(String(init.body)) <= 1500000);
      for (const row of JSON.parse(String(init.body))) {
        assert.equal(row.user_id, userId);
        saved.set(row.id, row.payload);
      }
      return new Response(null, { status: 201 });
    }
    assert.equal(url.searchParams.get('user_id'), 'eq.' + userId);
    const ids = url.searchParams.get('id')!.slice(4, -1).split(',');
    return json(ids.map(id => ({ id, payload: saved.get(id) })));
  });
  await remote.pushOperations(userId, operations);
  assert.ok(uploads > 1);
  assert.equal(saved.size, operations.length);
});

test('account mismatch stops before any reading data is fetched or sent', async () => {
  let accessed = false;
  const remote: LibraryRemote = {
    currentUser: async () => ({ id: 'someone-else' }),
    fetchOperations: async () => {
      accessed = true;
      return [];
    },
    pushOperations: async () => {
      accessed = true;
    },
  };
  await assert.rejects(
    syncLibraryRound(remote, userId, { getOperations: async () => [], mergeOperations: async () => {} }),
    /账号/,
  );
  assert.equal(accessed, false);
});

test('local edits during upload stay pending and complete on the following round', async () => {
  let local = [operation('first')];
  let cloud: LibraryOperation[] = [];
  let editing = true;
  const remote: LibraryRemote = {
    currentUser: async () => ({ id: userId }),
    fetchOperations: async () => cloud,
    pushOperations: async (_user, ops) => {
      cloud = mergeOperations(cloud, ops);
      if (editing) {
        editing = false;
        local.push(operation('second'));
      }
    },
  };
  const storage = {
    getOperations: async () => local,
    mergeOperations: async (ops: LibraryOperation[]) => {
      local = mergeOperations(local, ops);
    },
  };
  const first = await syncLibraryRound(remote, userId, storage);
  assert.equal(first.phase, 'pending');
  assert.equal(first.pendingCount, 1);
  assert.equal((await syncLibraryRound(remote, userId, storage)).phase, 'synced');
  assert.equal(cloud.length, 2);
});

test('failed upload never acknowledges local edits, and later retry is idempotent', async () => {
  let local = [operation('first')];
  let cloud: LibraryOperation[] = [];
  let failed = false;
  const remote: LibraryRemote = {
    currentUser: async () => ({ id: userId }),
    fetchOperations: async () => cloud,
    pushOperations: async (_user, ops) => {
      cloud = mergeOperations(cloud, ops);
      if (!failed) {
        failed = true;
        throw new Error('connection lost after commit');
      }
    },
  };
  const storage = {
    getOperations: async () => local,
    mergeOperations: async (ops: LibraryOperation[]) => {
      local = mergeOperations(local, ops);
    },
  };
  await assert.rejects(syncLibraryRound(remote, userId, storage), /connection lost/);
  assert.equal(local.length, 1);
  assert.equal((await syncLibraryRound(remote, userId, storage)).phase, 'synced');
  assert.equal(cloud.length, 1);
});

test('status cannot present unsent local changes as already synced', () => {
  assert.equal(readingSyncStatus({ phase: 'synced', operationCount: 1 }, true, 2, true).phase, 'pending');
  assert.equal(readingSyncStatus({ phase: 'synced', operationCount: 1 }, true, 2, false).phase, 'offline');
  assert.equal(readingSyncStatus({ phase: 'synced' }, false, 2, true).phase, 'local');
});
