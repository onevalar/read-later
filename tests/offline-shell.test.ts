import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const template = await readFile(new URL('../pages/library/public/sw.js', import.meta.url), 'utf8');
const source = template
  .replace("'__BUILD_CACHE__'", "'read-later-shell-test'")
  .replace("'__BUILD_ASSETS__'", "'/assets/app.js', '/assets/app.css'");
type WorkerEvent = {
  waitUntil?: (value: Promise<unknown>) => void;
  request?: { method: string; url: string; mode: string };
  respondWith?: (value: Promise<Response>) => void;
};
type WorkerHandler = (event: WorkerEvent) => void;
const worker = function worker() {
  const handlers = new Map<string, WorkerHandler>();
  const deleted: string[] = [];
  let precached: string[] = [];
  const cache = {
    addAll: async (urls: string[]) => {
      precached = [...urls];
    },
    // Reproduce Vary: Origin: a module request differs from the original precache request.
    match: async (request: string | { url: string }, options: { ignoreVary?: boolean }) => {
      const path = typeof request === 'string' ? request : new URL(request.url).pathname;
      return precached.includes(path) && options?.ignoreVary
        ? new Response(path === '/assets/app.js' ? 'bundled-js' : 'app-shell')
        : undefined;
    },
  };
  runInNewContext(source, {
    self: {
      location: { origin: 'https://reader.test' },
      addEventListener: (type: string, handler: WorkerHandler) => handlers.set(type, handler),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => cache,
      keys: async () => ['another-app-cache', 'read-later-shell-old', 'read-later-shell-test'],
      delete: async (key: string) => {
        deleted.push(key);
      },
    },
    fetch: async () => {
      throw new Error('offline');
    },
    URL,
    Response,
  });
  return {
    handlers,
    deleted,
    get precached() {
      return precached;
    },
  };
};

test('first installation precaches the complete shell and preserves unrelated app caches', async () => {
  const app = worker();
  let operation: Promise<unknown> | undefined;
  app.handlers.get('install')!({
    waitUntil: (value: Promise<unknown>) => {
      operation = value;
    },
  });
  await operation;
  assert.ok(app.precached.includes('/assets/app.js'));
  assert.ok(app.precached.includes('/assets/app.css'));
  app.handlers.get('activate')!({
    waitUntil: (value: Promise<unknown>) => {
      operation = value;
    },
  });
  await operation;
  assert.deepEqual(app.deleted, ['read-later-shell-old']);
});

test('offline module requests with a different Origin still load the precached bundle', async () => {
  const app = worker();
  let installed: Promise<unknown> | undefined;
  app.handlers.get('install')!({
    waitUntil: (value: Promise<unknown>) => {
      installed = value;
    },
  });
  await installed;
  let result: Promise<Response> | undefined;
  app.handlers.get('fetch')!({
    request: { method: 'GET', url: 'https://reader.test/assets/app.js', mode: 'cors' },
    respondWith: (value: Promise<Response>) => {
      result = value;
    },
  });
  assert.equal(await (await result!).text(), 'bundled-js');
  result = undefined;
  app.handlers.get('fetch')!({
    request: { method: 'GET', url: 'https://example-project.supabase.co/rest/v1/reading_operations', mode: 'cors' },
    respondWith: (value: Promise<Response>) => {
      result = value;
    },
  });
  assert.equal(result, undefined, 'private cloud requests must stay outside the app shell cache');
});
