import type { LibraryOperation } from './library-operations.js';
import type { LibraryRemote } from './supabase-client.js';

interface SyncStatus {
  phase: 'local' | 'pending' | 'offline' | 'sign-in' | 'syncing' | 'synced' | 'error';
  lastSyncedAt?: number;
  operationCount?: number;
  pendingCount?: number;
  error?: string;
}
const readingSyncStatus = function readingSyncStatus(
  status: SyncStatus,
  enabled: boolean,
  operationCount: number,
  online: boolean,
): SyncStatus {
  if (!enabled) return { phase: 'local' };
  if (!['synced', 'pending', 'offline'].includes(status.phase)) return status;
  const pendingCount = Math.max(0, operationCount - (status.operationCount ?? 0));
  return { ...status, pendingCount, phase: !online ? 'offline' : pendingCount ? 'pending' : status.phase };
};
/** Check identity before any reading data crosses the account boundary. */
const syncLibraryRound = async function syncLibraryRound(
  remote: LibraryRemote,
  boundUserId: string,
  local: {
    getOperations(): Promise<LibraryOperation[]>;
    mergeOperations(operations: LibraryOperation[]): Promise<void>;
  },
): Promise<SyncStatus> {
  if ((await remote.currentUser()).id !== boundUserId)
    throw new Error('登录账号与此阅读库绑定的账号不同，已停止同步，避免混合数据。');
  const cloud = await remote.fetchOperations(boundUserId);
  await local.mergeOperations(cloud);
  const snapshot = [...(await local.getOperations())];
  const known = new Set(cloud.map(op => op.id));
  await remote.pushOperations(
    boundUserId,
    snapshot.filter(op => !known.has(op.id)),
  );
  const acknowledged = new Set(snapshot.map(op => op.id));
  const latest = await local.getOperations();
  const pendingCount = latest.filter(op => !acknowledged.has(op.id)).length;
  return {
    phase: pendingCount ? 'pending' : 'synced',
    lastSyncedAt: Date.now(),
    operationCount: snapshot.length,
    pendingCount,
  };
};

export type { SyncStatus };
export { readingSyncStatus, syncLibraryRound };
