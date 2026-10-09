/* global structuredClone */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import { createContext, SourceTextModule } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

// Each VM has its own modules and caches, like a popup and a background worker.
// Only the browser's storage and lock manager are shared between them.
const createBrowser = () => {
  let data = {};
  let failNextWrite = false;
  const listeners = new Set();
  const locks = new Map();
  const chrome = {
    storage: {
      local: {
        get: async () => {
          const snapshot = structuredClone(data);
          await delay(1);
          return snapshot;
        },
        set: async values => {
          await delay(1);
          if (failNextWrite) {
            failNextWrite = false;
            throw new Error('Storage write failed');
          }
          const changes = Object.fromEntries(
            Object.entries(values).map(([key, newValue]) => [key, { newValue: structuredClone(newValue) }]),
          );
          data = { ...data, ...structuredClone(values) };
          listeners.forEach(listener => listener(changes));
        },
        onChanged: { addListener: listener => listeners.add(listener) },
      },
    },
  };
  const navigator = {
    locks: {
      request: (name, callback) => {
        const next = (locks.get(name) ?? Promise.resolve()).then(() => callback({ name }));
        locks.set(
          name,
          next.catch(() => undefined),
        );
        return next;
      },
    },
  };

  return {
    failWrite: () => {
      failNextWrite = true;
    },
    openContext: async () => {
      const context = createContext({ chrome, navigator, URL, crypto: webcrypto });
      const modules = new Map();
      const load = async url => {
        if (modules.has(url.href)) return modules.get(url.href);
        const source = await readFile(url, 'utf8');
        const { outputText } = transpileModule(source, {
          compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ESNext },
        });
        const module = new SourceTextModule(outputText, { context, identifier: url.href });
        modules.set(url.href, module);
        await module.link((specifier, parent) => load(new URL(specifier.replace(/\.js$/, '.ts'), parent.identifier)));
        return module;
      };
      const module = await load(new URL('../lib/impl/read-later-storage.ts', import.meta.url));
      await module.evaluate();
      const storage = module.namespace.readLaterStorage;
      // Wait for the initial storage snapshot before exercising user operations.
      await delay(5);
      return storage;
    },
  };
};

test('simultaneous saves in independent contexts keep both pages and deduplicate the same URL', async () => {
  const browser = createBrowser();
  const popup = await browser.openContext();
  const background = await browser.openContext();
  assert.deepEqual(
    await Promise.all([
      popup.savePage({ url: 'https://example.com/alpha', title: 'Alpha' }),
      background.savePage({ url: 'https://example.com/beta', title: 'Beta' }),
    ]),
    ['saved', 'saved'],
  );
  const results = await Promise.all([
    popup.savePage({ url: 'https://example.com/shared', title: 'Shared' }),
    background.savePage({ url: 'https://example.com/shared', title: 'Shared' }),
  ]);
  assert.deepEqual(results.sort(), ['duplicate', 'saved']);
  const state = JSON.parse(await popup.exportData());
  assert.deepEqual(state.pages.map(page => page.url).sort(), [
    'https://example.com/alpha',
    'https://example.com/beta',
    'https://example.com/shared',
  ]);
});

test('concurrent import and edit preserve the new page, notes, and derived tags', async () => {
  const browser = createBrowser();
  const popup = await browser.openContext();
  const background = await browser.openContext();
  await popup.savePage({ url: 'https://example.com/existing', title: 'Existing' });
  const {
    pages: [existing],
  } = await popup.get();
  const [summary] = await Promise.all([
    background.importData(
      JSON.stringify({
        pages: [
          { url: 'https://example.com/imported', title: 'Imported', tags: ['research'] },
          { url: existing.url, title: 'Must not replace existing' },
          { url: 'chrome://settings' },
        ],
      }),
    ),
    popup.updatePage(existing.id, { notes: 'Keep this note', tags: ['work'] }),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), { added: 1, skipped: 2 });
  const state = JSON.parse(await popup.exportData());
  assert.equal(state.pages.length, 2);
  assert.equal(state.pages.find(page => page.id === existing.id).notes, 'Keep this note');
  assert.deepEqual(state.allTags.sort(), ['research', 'work']);
  await popup.removePage(existing.id);
  assert.deepEqual(JSON.parse(await popup.exportData()).allTags, ['research']);
});

test('blank title edits retain the original title and still allow marking unread and searching', async () => {
  const storage = await createBrowser().openContext();
  await storage.savePage({ url: 'https://example.com/title', title: 'Original title' });
  const {
    pages: [page],
  } = await storage.get();
  for (const title of [undefined, '', '   ']) {
    await storage.updatePage(page.id, { title, notes: 'Updated note', visitedAt: undefined });
    const state = JSON.parse(await storage.exportData());
    assert.equal(state.pages[0].title, 'Original title');
    assert.equal(state.pages[0].notes, 'Updated note');
    assert.equal(state.pages[0].visitedAt, undefined);
    assert.equal((await storage.searchPages('original')).length, 1);
  }
  await storage.updatePage(page.id, { title: 'New title', visitedAt: 123 });
  assert.equal((await storage.get()).pages[0].title, 'New title');
  await storage.updatePage(page.id, { visitedAt: undefined });
  assert.equal((await storage.get()).pages[0].visitedAt, undefined);
});

test('a failed write rejects without losing prior data or blocking the next context', async () => {
  const browser = createBrowser();
  const popup = await browser.openContext();
  const background = await browser.openContext();
  await popup.savePage({ url: 'https://example.com/prior', title: 'Prior' });
  browser.failWrite();
  await assert.rejects(popup.savePage({ url: 'https://example.com/failed', title: 'Failed' }), /Storage write failed/);
  assert.equal(await background.savePage({ url: 'https://example.com/next', title: 'Next' }), 'saved');
  assert.deepEqual(
    JSON.parse(await popup.exportData())
      .pages.map(page => page.title)
      .sort(),
    ['Next', 'Prior'],
  );
});
