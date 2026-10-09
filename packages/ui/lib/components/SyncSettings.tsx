import { useStorage } from '@extension/shared';
import {
  configureSupabase,
  disconnectSupabase,
  signInToSupabase,
  supabaseConfigStorage,
  syncReadingLibrary,
} from '@extension/storage';
import { Button } from '@onevalar/pro/react/button';
import { Input } from '@onevalar/pro/react/input';
import { useId, useState } from 'react';
import type { SyncStatus } from '@extension/storage';

const text = (cn: string, en: string) => ((globalThis.navigator?.language ?? 'en').startsWith('zh') ? cn : en);
const syncLabel = function syncLabel(status: SyncStatus): string {
  if ((status.phase === 'pending' || status.phase === 'offline') && status.pendingCount)
    return (
      (status.phase === 'offline' ? text('离线 · ', 'Offline · ') : '') +
      text('等待同步 · ', 'Waiting to sync · ') +
      status.pendingCount +
      text(' 项改动', ' changes')
    );
  return {
    local: text('未开启云同步', 'Cloud sync is off'),
    pending: text('等待同步', 'Sync pending'),
    offline: text('离线 · 等待同步', 'Offline · sync pending'),
    'sign-in': text('需要登录', 'Sign in to sync'),
    syncing: text('正在同步…', 'Syncing…'),
    synced: text('已同步', 'Synced'),
    error: text('同步需要处理', 'Sync needs attention'),
  }[status.phase];
};
const SyncSettings = function SyncSettings({ status }: { status: SyncStatus }) {
  const fieldId = useId();
  const config = useStorage(supabaseConfigStorage);
  const [email, setEmail] = useState(config.email ?? '');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState(config.url);
  const [key, setKey] = useState(config.publishableKey);
  const [advanced, setAdvanced] = useState(!config.url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : text('操作失败，本地数据已保留。', 'Could not complete the request. Your local data is safe.'),
      );
    } finally {
      setBusy(false);
    }
  };
  const login = () =>
    run(async () => {
      try {
        await signInToSupabase(email, password);
      } finally {
        setPassword('');
      }
    });
  return (
    <section>
      <h3>{text('设备间同步', 'Sync across devices')}</h3>
      <p className="reading-muted" role="status">
        {syncLabel(status)}
        {config.enabled && config.email ? ' · ' + config.email : ''}
        {status.lastSyncedAt && config.enabled ? ' · ' + new Date(status.lastSyncedAt).toLocaleString() : ''}
      </p>
      {config.enabled && status.phase !== 'sign-in' ? (
        <div className="reading-actions">
          <Button
            variant="outline"
            onPress={() => void run(syncReadingLibrary)}
            isDisabled={busy || status.phase === 'syncing'}>
            {text('立即同步', 'Sync now')}
          </Button>
          <Button variant="ghost" onPress={() => void run(disconnectSupabase)} isDisabled={busy}>
            {text('退出同步', 'Sign out')}
          </Button>
        </div>
      ) : (
        config.url && (
          <form
            className="reading-form"
            onSubmit={event => {
              event.preventDefault();
              if (!busy) void login();
            }}>
            <p className="reading-muted">
              {text(
                '未登录时，内容保存在此设备。手机和电脑登录同一个阅读库账号后，保存的内容、笔记和进度会自动同步。',
                'Until you sign in, content stays on this device. Sign in to the same library account on phone and computer to automatically sync saved pages, notes and progress.',
              )}
            </p>
            <label>
              {text('邮箱', 'Email')}
              <Input
                type="email"
                autoComplete="username"
                value={email}
                onChange={event => setEmail(event.target.value)}
                fullWidth
                required
              />
            </label>
            <label>
              {text('密码', 'Password')}
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                fullWidth
                required
              />
            </label>
            <Button type="submit" isDisabled={busy || !email.trim() || !password}>
              {busy ? text('正在连接…', 'Connecting…') : text('登录并同步', 'Sign in and sync')}
            </Button>
            <p className="reading-muted">
              {text(
                '使用项目管理员为你创建的阅读库账号，而非 Supabase 管理后台密码。',
                'Use the library account created by your project administrator, not your Supabase dashboard password.',
              )}
            </p>
          </form>
        )
      )}
      {(error || status.error) && (
        <p className="reading-error" role="alert">
          {error || status.error}
        </p>
      )}
      <Button variant="ghost" size="sm" onPress={() => setAdvanced(!advanced)}>
        {text('同步服务设置', 'Sync service settings')}
      </Button>
      {advanced && (
        <div className="reading-config">
          <p className="reading-muted">
            {text(
              '一次性填写你的 Supabase 项目公开连接参数。保存不会上传阅读数据；登录后才会同步。',
              'One-time setup with your Supabase project’s public connection details. Saving does not upload reading data; syncing starts after sign-in.',
            )}
          </p>
          <label htmlFor={`${fieldId}-url`}>
            Project URL
            <Input
              id={`${fieldId}-url`}
              type="url"
              placeholder="https://your-project.supabase.co"
              value={url}
              onChange={event => setUrl(event.target.value)}
              fullWidth
              disabled={!!config.boundUserId}
            />
          </label>
          <label htmlFor={`${fieldId}-key`}>
            Publishable key
            <Input
              id={`${fieldId}-key`}
              placeholder="sb_publishable_…"
              value={key}
              onChange={event => setKey(event.target.value)}
              fullWidth
            />
          </label>
          <Button
            variant="outline"
            isDisabled={busy || !url.trim() || !key.trim()}
            onPress={() =>
              void run(async () => {
                await configureSupabase({ url, publishableKey: key });
                setAdvanced(false);
              })
            }>
            {text('保存连接设置', 'Save connection settings')}
          </Button>
        </div>
      )}
    </section>
  );
};

export { syncLabel, SyncSettings };
