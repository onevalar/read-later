import { readLaterStorage } from './read-later-storage.js';
import {
  createSupabaseSDK,
  SupabaseLibraryClient,
  SyncAuthenticationError,
  validateSupabaseConnection,
} from './supabase-client.js';
import { syncLibraryRound } from './sync-engine.js';
import { createStorage, StorageEnum } from '../base/index.js';
import type { SupabaseConnection } from './supabase-client.js';
import type { SyncStatus } from './sync-engine.js';

interface SupabaseSyncConfig extends SupabaseConnection {
  enabled: boolean;
  boundUserId?: string;
  email?: string;
}
// Public app configuration only. Reading data remains protected by Auth and RLS.
// Existing device settings take precedence; a fresh installation still waits for sign-in.
const supabaseConfigStorage = createStorage<SupabaseSyncConfig>(
  'read-later-supabase-config',
  {
    url: 'https://btetqmmdsugfbyklasuq.supabase.co',
    publishableKey: 'sb_publishable_lCEM1hdA5xVA8iwcNfWHdw_CrqRCHb9',
    enabled: false,
  },
  { storageEnum: StorageEnum.Local, liveUpdate: true },
);
const syncStatusStorage = createStorage<SyncStatus>(
  'read-later-supabase-status',
  { phase: 'local' },
  { storageEnum: StorageEnum.Local, liveUpdate: true },
);
const authStorage = createStorage<Record<string, string>>(
  'read-later-supabase-auth',
  {},
  { storageEnum: StorageEnum.Local },
);
const sessionStorage = {
  getItem: async (key: string) => (await authStorage.get())[key] ?? null,
  setItem: async (key: string, value: string) => {
    await authStorage.set({ ...(await authStorage.get()), [key]: value });
  },
  removeItem: async (key: string) => {
    const values = { ...(await authStorage.get()) };
    delete values[key];
    await authStorage.set(values);
  },
};
let cached: { key: string; client: SupabaseLibraryClient } | undefined;
const clientFor = function clientFor(config: SupabaseConnection) {
  const key = config.url + '\n' + config.publishableKey;
  if (!cached || cached.key !== key)
    cached = { key, client: new SupabaseLibraryClient(createSupabaseSDK(config, sessionStorage)) };
  return cached.client;
};
let serial: Promise<unknown> = Promise.resolve();
const withSyncLock = <T>(task: () => Promise<T>): Promise<T> => {
  const next = serial
    .catch(() => undefined)
    .then(() => (globalThis.navigator?.locks ? navigator.locks.request('read-later-supabase-sync', task) : task()));
  serial = next;
  return next;
};
const configureSupabase = async function configureSupabase(connection: SupabaseConnection) {
  const valid = validateSupabaseConnection(connection);
  await withSyncLock(async () => {
    const old = await supabaseConfigStorage.get();
    if (old.boundUserId && old.url !== valid.url)
      throw new Error('此阅读库已绑定云端项目。请先导出备份，在独立的浏览器资料中连接另一个项目。');
    await supabaseConfigStorage.set({ ...old, ...valid });
  });
};
const signInToSupabase = async function signInToSupabase(email: string, password: string) {
  if (!email.trim() || !password) throw new Error('请填写阅读库邮箱和密码。');
  await withSyncLock(async () => {
    const config = await supabaseConfigStorage.get();
    const client = clientFor(config);
    const user = await client.signIn(email, password);
    if (config.boundUserId && config.boundUserId !== user.id) {
      await client.sdk.auth.signOut({ scope: 'local' });
      await authStorage.set({});
      await supabaseConfigStorage.set({ ...config, enabled: false });
      await syncStatusStorage.set({ phase: 'local' });
      throw new Error('此设备阅读库已绑定其他账号，已停止连接以保护数据。请使用原账号登录。');
    }
    await supabaseConfigStorage.set({
      ...config,
      boundUserId: user.id,
      email: user.email ?? email.trim(),
      enabled: true,
    });
    await syncStatusStorage.set({ phase: 'pending' });
  });
  await syncReadingLibrary();
};
const disconnectSupabase = async function disconnectSupabase() {
  await withSyncLock(async () => {
    const config = await supabaseConfigStorage.get();
    await supabaseConfigStorage.set({ ...config, enabled: false });
    // Clear local credentials even if the remote sign-out cannot finish offline.
    try {
      if (config.url && config.publishableKey) await clientFor(config).sdk.auth.signOut({ scope: 'local' });
    } finally {
      await authStorage.set({});
      await syncStatusStorage.set({ phase: 'local' });
    }
  });
};
const isOffline = () => globalThis.navigator?.onLine === false;
let inFlight: Promise<void> | null = null;
const syncReadingLibrary = function syncReadingLibrary(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = withSyncLock(async () => {
    for (let round = 0; round < 3; round++) {
      const config = await supabaseConfigStorage.get();
      const prior = await syncStatusStorage.get();
      if (!config.enabled) {
        if (prior.phase !== 'local') await syncStatusStorage.set({ phase: 'local' });
        return;
      }
      if (prior.phase === 'sign-in') return;
      if (isOffline()) {
        await syncStatusStorage.set({ ...prior, phase: 'offline', error: undefined });
        return;
      }
      if (!config.boundUserId) {
        await syncStatusStorage.set({ ...prior, phase: 'sign-in' });
        return;
      }
      await syncStatusStorage.set({ ...prior, phase: 'syncing', error: undefined });
      try {
        const status = await syncLibraryRound(clientFor(config), config.boundUserId, {
          getOperations: async () => (await readLaterStorage.get()).operations ?? [],
          mergeOperations: operations => readLaterStorage.mergeCloudOperations(operations),
        });
        await syncStatusStorage.set(status);
        if (!status.pendingCount) return;
      } catch (error) {
        await syncStatusStorage.set({
          ...prior,
          phase: error instanceof SyncAuthenticationError ? 'sign-in' : isOffline() ? 'offline' : 'error',
          error: error instanceof Error ? error.message : '同步失败，本地数据已保留。',
        });
        return;
      }
    }
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
};

export { readingSyncStatus, type SyncStatus } from './sync-engine.js';
export type { SupabaseSyncConfig };
export {
  supabaseConfigStorage,
  syncStatusStorage,
  configureSupabase,
  signInToSupabase,
  disconnectSupabase,
  syncReadingLibrary,
};
