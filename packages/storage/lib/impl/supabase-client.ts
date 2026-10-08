import { serializeOperation, validateOperation } from './library-operations.js';
import { createClient } from '@supabase/supabase-js';
import type { LibraryOperation } from './library-operations.js';
import type { SupabaseClient, SupportedStorage } from '@supabase/supabase-js';

interface SupabaseConnection {
  url: string;
  publishableKey: string;
}
class SyncAuthenticationError extends Error {}
const validateSupabaseConnection = function validateSupabaseConnection(
  connection: SupabaseConnection,
): SupabaseConnection {
  let url: URL;
  try {
    url = new URL(connection.url.trim());
  } catch {
    throw new Error('请填写 Supabase Project URL。');
  }
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('请使用 https://项目编号.supabase.co 格式的 Project URL。');
  const publishableKey = connection.publishableKey.trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey))
    throw new Error('请使用 sb_publishable_ 开头的公开密钥，不要填 Secret key 或 service_role。');
  return { url: url.origin, publishableKey };
};
const createSupabaseSDK = function createSupabaseSDK(
  connection: SupabaseConnection,
  storage: SupportedStorage,
  transport: typeof fetch = fetch,
): SupabaseClient {
  const config = validateSupabaseConnection(connection);
  return createClient(config.url, config.publishableKey, {
    auth: {
      storage,
      storageKey: 'read-later-session-' + new URL(config.url).hostname,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        transport.call(globalThis, input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(30000),
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
        }),
    },
  });
};
const fail = function fail(error: { message?: string; status?: number; code?: string; name?: string }): never {
  if (
    error.status === 401 ||
    error.name === 'AuthSessionMissingError' ||
    ['PGRST301', 'PGRST302', 'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(
      error.code ?? '',
    )
  )
    throw new SyncAuthenticationError('登录已失效，请重新登录。设备上的阅读库仍然保留。');
  if (['42P01', 'PGRST205'].includes(error.code ?? ''))
    throw new Error('云端阅读库尚未初始化，请先在 Supabase 执行项目提供的 SQL 脚本。');
  if (error.code === '42501') throw new Error('云端权限检查未通过，请核对数据库的 RLS 配置。');
  throw new Error(error.message || '同步请求失败，本地内容已保留。');
};
const TABLE = 'reading_operations';
const PAGE_SIZE = 200;
const encoder = new TextEncoder();
interface LibraryRemote {
  currentUser(): Promise<{ id: string; email?: string }>;
  fetchOperations(userId: string): Promise<LibraryOperation[]>;
  pushOperations(userId: string, operations: LibraryOperation[]): Promise<void>;
}
class SupabaseLibraryClient implements LibraryRemote {
  constructor(readonly sdk: SupabaseClient) {}
  async currentUser() {
    const { data, error } = await this.sdk.auth.getUser();
    if (error) fail(error);
    if (!data.user) throw new SyncAuthenticationError('请先登录阅读库。');
    return { id: data.user.id, email: data.user.email };
  }
  async signIn(email: string, password: string) {
    const { error } = await this.sdk.auth.signInWithPassword({ email: email.trim(), password });
    if (error) fail(error);
    return this.currentUser();
  }
  async fetchOperations(userId: string) {
    const operations: LibraryOperation[] = [];
    let cursor = '';
    for (;;) {
      let query = this.sdk
        .from(TABLE)
        .select('id,payload')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .limit(PAGE_SIZE);
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error) fail(error);
      if (!Array.isArray(data)) throw new Error('云端阅读库响应格式异常。');
      for (const row of data) {
        const op = validateOperation(JSON.parse(row.payload));
        if (row.id !== op.id || row.id <= cursor) throw new Error('云端阅读库分页或记录标识异常。');
        cursor = row.id;
        operations.push(op);
      }
      if (data.length < PAGE_SIZE) return operations;
    }
  }
  async pushOperations(userId: string, operations: LibraryOperation[]) {
    let batch: { user_id: string; id: string; payload: string }[] = [];
    let bytes = 2;
    const send = async () => {
      if (!batch.length) return;
      // Immutable inserts make timeouts safe to retry. Verify even ignored duplicates.
      const { error } = await this.sdk.from(TABLE).upsert(batch, { onConflict: 'user_id,id', ignoreDuplicates: true });
      if (error) fail(error);
      const { data, error: lookupError } = await this.sdk
        .from(TABLE)
        .select('id,payload')
        .eq('user_id', userId)
        .in(
          'id',
          batch.map(row => row.id),
        );
      if (lookupError) fail(lookupError);
      if (
        !Array.isArray(data) ||
        batch.some(
          row =>
            !data.some(remote => {
              if (remote.id !== row.id) return false;
              const operation = validateOperation(JSON.parse(remote.payload));
              return operation.id === row.id && serializeOperation(operation) === row.payload;
            }),
        )
      )
        throw new Error('部分阅读记录尚未确认上传，本地内容已保留。');
      batch = [];
      bytes = 2;
    };
    for (const raw of operations) {
      const operation = validateOperation(raw);
      const payload = serializeOperation(operation);
      if (encoder.encode(payload).byteLength > 950000) throw new Error('一条阅读记录过大，尚未上传；本地内容已保留。');
      const row = { user_id: userId, id: operation.id, payload };
      const size = encoder.encode(JSON.stringify(row)).byteLength + 1;
      if (batch.length && (batch.length >= 100 || bytes + size > 1500000)) await send();
      batch.push(row);
      bytes += size;
    }
    await send();
  }
}

export type { SupabaseConnection, LibraryRemote };
export { SyncAuthenticationError, validateSupabaseConnection, createSupabaseSDK, SupabaseLibraryClient };
