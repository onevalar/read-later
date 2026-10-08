import type { SavedPage } from './read-later-storage.js';

type LibraryOperation = {
  id: string;
  at: number;
  url: string;
  kind: 'create' | 'patch' | 'delete';
  patch: Record<string, unknown>;
};
const fields = [
  'id',
  'title',
  'favicon',
  'tags',
  'autoTags',
  'savedAt',
  'visitedAt',
  'notes',
  'articleText',
  'progress',
] as const;
const httpUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const validateOperation = function validateOperation(raw: unknown): LibraryOperation {
  const op = raw as LibraryOperation;
  if (
    !op ||
    typeof op.id !== 'string' ||
    !/^[a-z0-9-]{1,80}$/i.test(op.id) ||
    typeof op.url !== 'string' ||
    op.url.length > 16000 ||
    !httpUrl(op.url) ||
    !Number.isFinite(op.at) ||
    op.at < 0 ||
    !['create', 'patch', 'delete'].includes(op.kind) ||
    !op.patch ||
    typeof op.patch !== 'object' ||
    Array.isArray(op.patch)
  )
    throw new Error('Invalid reading-library operation');
  for (const [key, value] of Object.entries(op.patch)) {
    if (!fields.includes(key as (typeof fields)[number])) throw new Error('Unknown reading-library field');
    if (value === null) continue;
    if (['tags', 'autoTags'].includes(key)) {
      if (!Array.isArray(value) || value.length > 200 || value.some(v => typeof v !== 'string' || v.length > 500))
        throw new Error('Invalid tags');
    } else if (['savedAt', 'visitedAt', 'progress'].includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key === 'progress' && value > 1))
        throw new Error('Invalid reading progress');
    } else if (typeof value !== 'string' || value.length > (key === 'articleText' ? 120000 : 30000))
      throw new Error('Invalid reading-library text');
  }
  return op;
};

/** Object key order is not data: extension storage and JSON transports may reorder it. */
const serializeOperation = function serializeOperation(operation: LibraryOperation): string {
  return JSON.stringify(operation, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
};

/** Immutable operations preserve offline edits. A delete needs an explicit create to restore it. */
const mergeOperations = function mergeOperations(...sets: LibraryOperation[][]): LibraryOperation[] {
  const unique = new Map<string, LibraryOperation>();
  for (const raw of sets.flat()) {
    const op = validateOperation(raw);
    const old = unique.get(op.id);
    if (old && serializeOperation(old) !== serializeOperation(op))
      throw new Error('Conflicting reading-library operation ID');
    unique.set(op.id, op);
  }
  return [...unique.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
};
const materializeOperations = function materializeOperations(operations: LibraryOperation[]): SavedPage[] {
  const library = new Map<string, SavedPage | null>();
  for (const op of mergeOperations(operations)) {
    if (op.kind === 'delete') {
      library.set(op.url, null);
      continue;
    }
    const old = library.get(op.url);
    if (op.kind === 'patch' && !old) continue;
    const patch = Object.fromEntries(Object.entries(op.patch).map(([k, v]) => [k, v === null ? undefined : v]));
    const next = { ...(old ?? {}), ...patch, url: op.url } as SavedPage;
    if (!next.id || typeof next.title !== 'string' || !Number.isFinite(next.savedAt))
      throw new Error('Incomplete reading-library record');
    library.set(op.url, { ...next, tags: next.tags ?? [], autoTags: next.autoTags ?? [] });
  }
  return [...library.values()].filter((p): p is SavedPage => p !== null).sort((a, b) => b.savedAt - a.savedAt);
};
const operationsForChange = function operationsForChange(
  before: SavedPage[],
  after: SavedPage[],
  existing: LibraryOperation[],
): LibraryOperation[] {
  const operations = [...existing];
  const fullPatch = (page: SavedPage) => Object.fromEntries(fields.map(key => [key, page[key] ?? null]));
  if (!operations.length)
    for (const page of before)
      operations.push({
        id: crypto.randomUUID(),
        at: page.savedAt,
        url: page.url,
        kind: 'create',
        patch: fullPatch(page),
      });
  let at = operations.reduce((latest, op) => Math.max(latest, op.at + 1), Date.now());
  const prior = new Map(before.map(p => [p.url, p]));
  const current = new Map(after.map(p => [p.url, p]));
  for (const page of after) {
    const old = prior.get(page.url);
    const patch = old
      ? Object.fromEntries(
          fields
            .filter(key => JSON.stringify(old[key] ?? null) !== JSON.stringify(page[key] ?? null))
            .map(key => [key, page[key] ?? null]),
        )
      : fullPatch(page);
    if (!old || Object.keys(patch).length)
      operations.push({ id: crypto.randomUUID(), at: at++, url: page.url, kind: old ? 'patch' : 'create', patch });
  }
  for (const page of before)
    if (!current.has(page.url))
      operations.push({ id: crypto.randomUUID(), at: at++, url: page.url, kind: 'delete', patch: {} });
  return mergeOperations(operations);
};

export type { LibraryOperation };
export { validateOperation, serializeOperation, mergeOperations, materializeOperations, operationsForChange };
