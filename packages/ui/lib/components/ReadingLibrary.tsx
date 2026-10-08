import { SyncSettings, syncLabel } from './SyncSettings.js';
import { useStorage } from '@extension/shared';
import {
  isSavableUrl,
  readLaterStorage,
  supabaseConfigStorage,
  syncStatusStorage,
  syncReadingLibrary,
  readingSyncStatus,
  removeLegacySyncCredentials,
  createStorage,
} from '@extension/storage';
import { Button } from '@onevalar/pro/react/button';
import { Input } from '@onevalar/pro/react/input';
import { Modal } from '@onevalar/pro/react/modal';
import { TextArea } from '@onevalar/pro/react/textarea';
import { Component, Suspense, useEffect, useRef, useState } from 'react';
import type { SavedPage, SaveReceipt } from '@extension/storage';
import type { ReactNode, PropsWithChildren } from 'react';

const zh = (globalThis.navigator?.language ?? 'en').startsWith('zh');
const text = (cn: string, en: string) => (zh ? cn : en);
const prefsStorage = createStorage<{ appearance: 'system' | 'light' | 'dark' }>(
  'read-later-appearance',
  { appearance: 'system' },
  { liveUpdate: true },
);
const paths = {
  bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  cloud: (
    <>
      <path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5 5 0 0 1 0 11H6" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  arrow: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  phone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <path d="M10 18h4" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  back: <path d="m15 5-7 7 7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  external: (
    <>
      <path d="M14 3h7v7m0-7L11 13" />
      <path d="M10 3H3v18h18v-7" />
    </>
  ),
  book: (
    <>
      <path d="M12 5C8 3 4 3 2 5v15c3-2 7-2 10 0 3-2 7-2 10 0V5c-3-2-7-2-10 0z" />
      <path d="M12 5v15" />
    </>
  ),
} as const;
const Icon = function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      {paths[name]}
    </svg>
  );
};
const IconButton = function IconButton({
  name,
  label,
  onPress,
}: {
  name: keyof typeof paths;
  label: string;
  onPress: () => void;
}) {
  return (
    <Button size="sm" variant="ghost" isIconOnly aria-label={label} onPress={onPress}>
      <Icon name={name} />
    </Button>
  );
};
const Dialog = function Dialog({
  title,
  open,
  close,
  children,
  footer,
}: {
  title: string;
  open: boolean;
  close: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={v => {
        if (!v) close();
      }}>
      <Modal.Container placement="center" size="lg">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
            <Modal.CloseTrigger aria-label={text('关闭', 'Close')} />
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
          {footer && <Modal.Footer>{footer}</Modal.Footer>}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
};
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const ReadingLibraryContent = function ReadingLibraryContent({ popup = false }: { popup?: boolean }) {
  const state = useStorage(readLaterStorage);
  const config = useStorage(supabaseConfigStorage);
  const sync = useStorage(syncStatusStorage);
  const displaySync = readingSyncStatus(sync, config.enabled, state.operations?.length ?? 0, navigator.onLine);
  const prefs = useStorage(prefsStorage);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<'unread' | 'read'>('unread');
  const [view, setView] = useState<'all' | 'continue'>('all');
  const [newestFirst, setNewestFirst] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(() => location.hash === '#settings');
  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [undoReceipt, setUndoReceipt] = useState<SaveReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SavedPage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [readerId, setReaderId] = useState<string | null>(() =>
    new URLSearchParams(location.hash.slice(1)).get('read'),
  );
  useEffect(() => {
    const navigate = () => {
      setReaderId(new URLSearchParams(location.hash.slice(1)).get('read'));
      setSettingsOpen(location.hash === '#settings');
    };
    window.addEventListener('popstate', navigate);
    window.addEventListener('hashchange', navigate);
    return () => {
      window.removeEventListener('popstate', navigate);
      window.removeEventListener('hashchange', navigate);
    };
  }, []);
  const [iconMode, setIconMode] = useState<'auto' | 'light' | 'dark'>('auto');
  const fileInput = useRef<HTMLInputElement>(null);
  const unread = state.pages.filter(p => !p.visitedAt).length;
  const reader = state.pages.find(p => p.id === readerId);
  const filtered = state.pages
    .filter(
      p =>
        (filter === 'unread' ? !p.visitedAt : !!p.visitedAt) &&
        (view === 'all' || (filter === 'unread' && (p.progress ?? 0) > 0)) &&
        [p.title, p.url, p.notes ?? '', ...p.tags, ...p.autoTags].some(s =>
          s.toLowerCase().includes(query.toLowerCase()),
        ),
    )
    .sort((a, b) => (newestFirst ? b.savedAt - a.savedAt : a.savedAt - b.savedAt));
  const resume = state.pages.find(
    p => !p.visitedAt && (p.progress ?? 0) > 0 && (p.progress ?? 0) < 0.98 && p.articleText,
  );
  const extension = !!globalThis.chrome?.runtime?.id;
  useEffect(() => {
    if (popup) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popup]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const mode = prefs.appearance === 'system' ? (media.matches ? 'dark' : 'light') : prefs.appearance;
      document.documentElement.dataset.theme = 'linear-' + mode;
      document.documentElement.style.colorScheme = mode;
      if (extension)
        void chrome.runtime
          .sendMessage({ type: 'SYSTEM_THEME', theme: media.matches ? 'dark' : 'light' })
          .catch(() => undefined);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [prefs.appearance, extension]);
  useEffect(() => {
    const run = () => {
      void syncReadingLibrary().catch(() =>
        setNotice(text('暂时无法同步，本地内容已保留。', 'Sync is unavailable. Your local data is safe.')),
      );
    };
    void removeLegacySyncCredentials().catch(() =>
      setNotice(
        text(
          '旧登录信息清理失败，请重新打开阅读库。',
          'Could not clear retired sign-in data. Please reopen the library.',
        ),
      ),
    );
    run();
    window.addEventListener('online', run);
    window.addEventListener('offline', run);
    window.addEventListener('focus', run);
    const timer = setInterval(run, 120000);
    let saveTimer: ReturnType<typeof setTimeout>;
    const unsubscribe = extension
      ? () => undefined
      : readLaterStorage.subscribe(() => {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(run, 700);
        });
    return () => {
      unsubscribe();
      clearTimeout(saveTimer);
      clearInterval(timer);
      window.removeEventListener('online', run);
      window.removeEventListener('offline', run);
      window.removeEventListener('focus', run);
    };
  }, [extension]);
  useEffect(() => {
    if (!settingsOpen) return;
    if (extension)
      void chrome.runtime.sendMessage({ type: 'GET_ICON_THEME' }).then(response => {
        if (response?.theme?.mode) setIconMode(response.theme.mode);
      });
  }, [settingsOpen, extension]);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setNotice('');
    try {
      await task();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : text('操作失败，请重试。', 'Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  const openLibrary = (hash = '') => {
    if (extension) void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') + hash });
    else setSettingsOpen(true);
  };
  const saveCurrent = () =>
    void run(async () => {
      setUndoReceipt(null);
      const response = await chrome.runtime.sendMessage({ type: 'SAVE_CURRENT_PAGE' });
      if (response?.error) throw new Error(response.error);
      setUndoReceipt(response?.result === 'saved' ? (response.receipt ?? null) : null);
      setNotice(
        response?.result === 'saved'
          ? ''
          : response?.result === 'duplicate'
            ? text('这篇内容已在阅读库中。', 'This page is already in your library.')
            : text('此页面无法保存。', 'This page cannot be saved.'),
      );
    });
  const addUrl = () =>
    void run(async () => {
      const value = url.trim();
      if (!isSavableUrl(value))
        throw new Error(text('请输入 http 或 https 网页链接。', 'Enter an http or https link.'));
      const outcome = await readLaterStorage.savePageWithReceipt({ url: value, title: value });
      setUndoReceipt(outcome.result === 'saved' ? outcome.receipt : null);
      setAddOpen(false);
      setUrl('');
      setNotice(outcome.result === 'duplicate' ? text('这篇内容已在阅读库中。', 'Already in your library.') : '');
    });
  const undoSave = () =>
    void run(async () => {
      if (!undoReceipt) return;
      const result = await readLaterStorage.undoSave(undoReceipt);
      setUndoReceipt(null);
      setNotice(
        result === 'undone'
          ? text('已撤销保存。', 'Save undone.')
          : result === 'changed'
            ? text('这篇内容已有阅读或编辑记录，已为你保留。', 'This page has been read or edited, so it was kept.')
            : text('这次保存已不在阅读库中。', 'This saved page is no longer in your library.'),
      );
    });
  const openPage = (page: SavedPage) => {
    setNotice('');
    if (page.articleText) {
      if (popup) openLibrary('#read=' + encodeURIComponent(page.id));
      else {
        setReaderId(page.id);
        history.pushState({ readLaterReader: page.id }, '', '#read=' + encodeURIComponent(page.id));
      }
    } else {
      window.open(page.url, '_blank', 'noopener,noreferrer');
      void run(() => readLaterStorage.updatePage(page.id, { visitedAt: Date.now() }));
    }
  };
  const startEdit = (page: SavedPage) => {
    setEditing(page);
    setTitle(page.title);
    setNotes(page.notes ?? '');
    setTags(page.tags.join(', '));
    setConfirmDelete(false);
  };
  const saveEdit = () =>
    void run(async () => {
      if (!editing) return;
      await readLaterStorage.updatePage(editing.id, {
        title: title.trim() || editing.url,
        notes: notes.trim(),
        tags: [
          ...new Set(
            tags
              .split(/[,，]/)
              .map(s => s.trim())
              .filter(Boolean),
          ),
        ],
      });
      setEditing(null);
    });
  const exportData = () =>
    void run(async () => {
      const blob = new Blob([await readLaterStorage.exportData()], { type: 'application/json' });
      const link = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = 'read-later-backup.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    });
  const date = (at: number) => {
    const startOfDay = (time: number) => new Date(new Date(time).setHours(0, 0, 0, 0)).getTime();
    const days = Math.round((startOfDay(Date.now()) - startOfDay(at)) / 864e5);
    if (days <= 0) return text('今天', 'Today');
    if (days === 1) return text('昨天', 'Yesterday');
    return new Date(at).toLocaleDateString(zh ? 'zh-CN' : undefined, { month: zh ? 'long' : 'short', day: 'numeric' });
  };
  if (reader)
    return (
      <ArticleReader
        key={reader.id}
        page={reader}
        close={() => {
          if (history.state?.readLaterReader === reader.id) history.back();
          else {
            setReaderId(null);
            history.replaceState(null, '', location.pathname + location.search);
          }
        }}
        onError={setNotice}
        error={notice}
      />
    );
  const rows = filtered.length ? (
    filtered.map(page => (
      <div className="reading-row" key={page.id}>
        <Button variant="ghost" className="reading-row-open" onPress={() => openPage(page)}>
          <span className="site-mark">{host(page.url).charAt(0).toUpperCase()}</span>
          <span className="reading-row-text">
            <strong>{page.title}</strong>
            <small>
              {host(page.url)} · {date(page.savedAt)}
              {page.articleText &&
                ' · ' + Math.max(1, Math.ceil(page.articleText.length / 900)) + text(' 分钟', ' min')}
              {(page.progress ?? 0) > 0 && !page.visitedAt && ' · ' + Math.round((page.progress ?? 0) * 100) + '%'}
            </small>
          </span>
        </Button>
        <IconButton
          name="more"
          label={text('更多操作：', 'More actions: ') + page.title}
          onPress={() => startEdit(page)}
        />
      </div>
    ))
  ) : (
    <div className="reading-empty">
      <Icon name="bookmark" size={28} />
      <h2>
        {query
          ? text('没有找到这篇内容', 'Nothing found')
          : filter === 'read'
            ? text('读过的内容会留在这里', 'Your finished reading lives here')
            : text('把值得读的，留给有空的你。', 'Save something worth slowing down for.')}
      </h2>
      <p>
        {query
          ? text('换一个词试试。', 'Try another search.')
          : text('保存一个页面，阅读库就从这里开始。', 'Save a page to begin your reading library.')}
      </p>
    </div>
  );
  const heading = filter === 'unread' ? text('待读', 'To read') : text('已读', 'Read');
  return (
    <div className={popup ? 'reading-app reading-popup' : 'reading-app reading-full'}>
      {!popup && (
        <aside className="reading-sidebar">
          <div className="reading-brand">
            <Icon name="bookmark" size={22} />
            <strong>Read Later</strong>
          </div>
          <Button
            variant="ghost"
            className={filter === 'unread' ? 'nav-active' : ''}
            onPress={() => setFilter('unread')}>
            <Icon name="bookmark" size={17} />
            <em>{text('待读', 'To read')}</em>
            <span>{unread}</span>
          </Button>
          <Button variant="ghost" className={filter === 'read' ? 'nav-active' : ''} onPress={() => setFilter('read')}>
            <Icon name="check" size={17} />
            <em>{text('已读', 'Read')}</em>
            <span>{state.pages.length - unread}</span>
          </Button>
          <Button variant="ghost" className={searchOpen ? 'nav-active' : ''} onPress={() => setSearchOpen(!searchOpen)}>
            <Icon name="search" size={17} />
            <em>{text('搜索', 'Search')}</em>
            <span>⌘ K</span>
          </Button>
          <div className="sidebar-bottom">
            <Button variant="ghost" onPress={() => setSettingsOpen(true)}>
              <Icon name="cloud" size={17} />
              <em>{syncLabel(displaySync)}</em>
            </Button>
            <Button variant="ghost" onPress={() => setSettingsOpen(true)}>
              <Icon name="settings" size={17} />
              <em>{text('设置', 'Settings')}</em>
            </Button>
          </div>
        </aside>
      )}
      <main className="reading-main">
        <header className={popup ? 'reading-header' : 'reading-header reading-mobile-head'}>
          <div className="reading-brand">
            <Icon name="bookmark" />
            <strong>Read Later</strong>
          </div>
          <div className="reading-actions">
            {popup && (
              <IconButton
                name="search"
                label={text('搜索阅读库', 'Search library')}
                onPress={() => setSearchOpen(!searchOpen)}
              />
            )}
            <IconButton
              name="settings"
              label={text('设置', 'Settings')}
              onPress={() => (popup ? openLibrary('#settings') : setSettingsOpen(true))}
            />
          </div>
        </header>
        {notice && (
          <div className="reading-notice" role="status">
            {notice}
          </div>
        )}
        <div className="reading-content">
          {popup ? (
            undoReceipt ? (
              <div className="save-current save-succeeded">
                <Icon name="check" size={16} />
                {text('已保存当前页面', 'Page saved')}
              </div>
            ) : (
              <Button className="save-current" fullWidth onPress={saveCurrent} isDisabled={busy}>
                <Icon name="plus" size={16} />
                {text('保存当前页面', 'Save this page')}
              </Button>
            )
          ) : (
            <>
              <div className="library-title">
                <div>
                  <h1 className="title-desktop">{heading}</h1>
                  <h1 className="title-mobile">{text('留给稍后的好内容', 'Good things for later')}</h1>
                  <p className="title-desktop">
                    {text(
                      filtered.length + ' 篇好内容，留给有空的你。',
                      filtered.length + ' good reads, saved for when you have time.',
                    )}
                  </p>
                  <p className="title-mobile">
                    <Icon name="cloud" size={14} />
                    {syncLabel(displaySync)}
                  </p>
                </div>
                <Button className="add-link" onPress={() => setAddOpen(true)}>
                  <Icon name="plus" size={16} />
                  {text('添加链接', 'Add a link')}
                </Button>
              </div>
              <div className="library-chips">
                <div role="group" aria-label={text('视图', 'View')}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={view === 'all' ? 'chip-active' : ''}
                    onPress={() => setView('all')}>
                    {text('全部', 'All')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={view === 'continue' ? 'chip-active' : ''}
                    onPress={() => {
                      setView('continue');
                      setFilter('unread');
                    }}>
                    {text('继续阅读', 'Continue reading')}
                  </Button>
                </div>
                <Button variant="ghost" size="sm" className="sort-button" onPress={() => setNewestFirst(!newestFirst)}>
                  {newestFirst ? text('最近保存', 'Newest first') : text('最早保存', 'Oldest first')}
                  <Icon name="chevronDown" size={14} />
                </Button>
              </div>
            </>
          )}
          {(searchOpen || !popup) && (
            <Input
              className={searchOpen || popup ? 'library-search open' : 'library-search'}
              aria-label={text('搜索标题、网址或笔记', 'Search titles, links or notes')}
              placeholder={text('搜索阅读库', 'Search your library')}
              value={query}
              onChange={e => setQuery(e.target.value)}
              fullWidth
            />
          )}
          {!popup && resume && !query && filter === 'unread' && view === 'all' && (
            <div className="resume-reading">
              <div className="resume-meta">
                <span>
                  <Icon name="phone" size={16} />
                  {text('上次读到了 ', 'You left off at ') + Math.round((resume.progress ?? 0) * 100) + '%'}
                </span>
              </div>
              <div className="resume-body">
                <span>
                  <strong>{resume.title}</strong>
                  <small>
                    {host(resume.url)} · {text('还需约 ', 'About ')}
                    {Math.max(1, Math.ceil(((resume.articleText?.length ?? 0) * (1 - (resume.progress ?? 0))) / 900))}
                    {text(' 分钟', ' min left')}
                  </small>
                </span>
                <Button variant="outline" onPress={() => openPage(resume)}>
                  <Icon name="arrow" size={16} />
                  {text('继续阅读', 'Continue')}
                </Button>
              </div>
            </div>
          )}
          {popup ? (
            <div className="library-tabs">
              <div role="group" aria-label={text('阅读状态', 'Reading status')}>
                <Button
                  size="sm"
                  variant="ghost"
                  className={filter === 'unread' ? 'tab-active' : ''}
                  onPress={() => setFilter('unread')}>
                  {text('待读', 'To read')}
                  <span>{unread}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={filter === 'read' ? 'tab-active' : ''}
                  onPress={() => setFilter('read')}>
                  {text('已读', 'Read')}
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="sync-indicator" onPress={() => openLibrary('#settings')}>
                <Icon name="cloud" size={14} />
                {syncLabel(displaySync)}
              </Button>
            </div>
          ) : (
            <div className="mobile-seg" role="group" aria-label={text('阅读状态', 'Reading status')}>
              <Button
                variant="ghost"
                className={filter === 'unread' ? 'seg-active' : ''}
                onPress={() => setFilter('unread')}>
                {text('待读', 'To read')} {unread}
              </Button>
              <Button
                variant="ghost"
                className={filter === 'read' ? 'seg-active' : ''}
                onPress={() => setFilter('read')}>
                {text('已读', 'Read')}
              </Button>
            </div>
          )}
          <div className="reading-list">{rows}</div>
        </div>
        {undoReceipt ? (
          <footer className="reading-footer reading-undo">
            <span role="status">{text('已加入待读', 'Added to your reading list')}</span>
            <Button variant="ghost" size="sm" onPress={undoSave} isDisabled={busy}>
              {text('撤销', 'Undo')}
            </Button>
          </footer>
        ) : popup ? (
          <footer className="reading-footer">
            <span>
              {config.enabled && displaySync.phase === 'synced'
                ? text('在手机上接着读', 'Continue on your phone')
                : text('快捷键 ⌘ ⇧ S 快速保存', 'Press ⌘ ⇧ S to save quickly')}
            </span>
            <Button variant="ghost" size="sm" onPress={() => openLibrary()}>
              {text('打开阅读库', 'Open library')}
              <Icon name="arrow" size={13} />
            </Button>
          </footer>
        ) : (
          <footer className="reading-footer mobile-bar">
            <span>
              <Icon name="monitor" size={15} />
              {text('包含电脑保存的内容', 'Includes pages saved on your computer')}
            </span>
            <IconButton name="plus" label={text('添加链接', 'Add a link')} onPress={() => setAddOpen(true)} />
          </footer>
        )}
      </main>
      <Dialog
        title={text('添加链接', 'Add a link')}
        open={addOpen}
        close={() => setAddOpen(false)}
        footer={
          <>
            <Button variant="ghost" onPress={() => setAddOpen(false)}>
              {text('取消', 'Cancel')}
            </Button>
            <Button onPress={addUrl} isDisabled={busy || !url.trim()}>
              {text('加入阅读库', 'Save link')}
            </Button>
          </>
        }>
        <Input
          aria-label={text('网页链接', 'Page URL')}
          placeholder="https://"
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          fullWidth
        />
      </Dialog>
      <Dialog
        title={confirmDelete ? text('删除这篇内容？', 'Delete this page?') : text('整理这篇内容', 'Organize this page')}
        open={!!editing}
        close={() => setEditing(null)}
        footer={
          confirmDelete ? (
            <>
              <Button variant="ghost" onPress={() => setConfirmDelete(false)}>
                {text('取消', 'Cancel')}
              </Button>
              <Button
                variant="danger"
                onPress={() =>
                  void run(async () => {
                    if (editing) await readLaterStorage.removePage(editing.id);
                    setEditing(null);
                  })
                }>
                {text('确认删除', 'Delete page')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="danger-soft" onPress={() => setConfirmDelete(true)}>
                {text('删除', 'Delete')}
              </Button>
              <Button
                variant="ghost"
                onPress={() =>
                  void run(async () => {
                    if (editing)
                      await readLaterStorage.updatePage(editing.id, {
                        visitedAt: editing.visitedAt ? undefined : Date.now(),
                        progress: editing.visitedAt ? 0 : 1,
                      });
                    setEditing(null);
                  })
                }>
                {editing?.visitedAt ? text('标为待读', 'Mark unread') : text('标为已读', 'Mark read')}
              </Button>
              <Button onPress={saveEdit}>{text('保存', 'Save')}</Button>
            </>
          )
        }>
        {confirmDelete ? (
          <p>
            {editing?.title}
            <br />
            {config.enabled
              ? text('删除也会同步到你的其他设备。', 'This deletion will also sync to your other devices.')
              : text('将从此设备的阅读库中删除。', 'This will be removed from this device’s library.')}
          </p>
        ) : (
          <div className="reading-form">
            <label>
              {text('标题', 'Title')}
              <Input value={title} onChange={e => setTitle(e.target.value)} fullWidth />
            </label>
            <label>
              {text('标签（逗号分隔）', 'Tags (comma separated)')}
              <Input value={tags} onChange={e => setTags(e.target.value)} fullWidth />
            </label>
            <label>
              {text('笔记', 'Notes')}
              <TextArea value={notes} onChange={e => setNotes(e.target.value)} rows={4} />
            </label>
          </div>
        )}
      </Dialog>
      <Dialog
        title={text('设置', 'Settings')}
        open={settingsOpen}
        close={() => {
          setSettingsOpen(false);
          if (location.hash === '#settings') history.replaceState(null, '', location.pathname + location.search);
        }}>
        <div className="reading-form">
          <SyncSettings status={displaySync} />
          <section>
            <h3>{text('外观', 'Appearance')}</h3>
            <div className="reading-actions">
              {(['system', 'light', 'dark'] as const).map(mode => (
                <Button
                  key={mode}
                  size="sm"
                  variant={prefs.appearance === mode ? 'secondary' : 'outline'}
                  onPress={() => void prefsStorage.set({ appearance: mode })}>
                  {
                    { system: text('跟随系统', 'System'), light: text('浅色', 'Light'), dark: text('深色', 'Dark') }[
                      mode
                    ]
                  }
                </Button>
              ))}
            </div>
          </section>
          {extension && (
            <section>
              <h3>{text('工具栏图标', 'Toolbar icon')}</h3>
              <div className="reading-actions">
                {(['auto', 'light', 'dark'] as const).map(mode => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={iconMode === mode ? 'secondary' : 'outline'}
                    onPress={() =>
                      void run(async () => {
                        await chrome.runtime.sendMessage({ type: 'SET_ICON_THEME', theme: { mode } });
                        setIconMode(mode);
                      })
                    }>
                    {{ auto: text('自动', 'Auto'), light: text('浅色', 'Light'), dark: text('深色', 'Dark') }[mode]}
                  </Button>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3>{text('数据备份', 'Backup')}</h3>
            <p className="reading-muted">
              {text(
                '导入会合并新增链接，已有链接保持不变。备份不包含登录凭据。',
                'Import adds new links and leaves existing links unchanged. Backups do not include sign-in credentials.',
              )}
            </p>
            <div className="reading-actions">
              <Button variant="outline" onPress={exportData}>
                {text('导出阅读库', 'Export library')}
              </Button>
              <Button variant="outline" onPress={() => fileInput.current?.click()}>
                {text('导入备份', 'Import backup')}
              </Button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={e => {
                const file = e.target.files?.[0];
                if (file)
                  void run(async () => {
                    const result = await readLaterStorage.importData(await file.text());
                    setNotice(
                      text('已导入 ', 'Imported ') + result.added + text(' 篇，跳过 ', ', skipped ') + result.skipped,
                    );
                  });
                e.target.value = '';
              }}
            />
          </section>
          {!extension && (
            <p className="reading-muted">
              {text(
                '在 iPhone 的 Safari 中打开后，可通过分享菜单“添加到主屏幕”。',
                'On iPhone, open in Safari and choose Share → Add to Home Screen.',
              )}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
      </Dialog>
    </div>
  );
};
const ArticleReader = function ArticleReader({
  page,
  close,
  onError,
  error,
}: {
  page: SavedPage;
  close: () => void;
  onError: (error: string) => void;
  error?: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(page.progress ?? 0);
  const [closing, setClosing] = useState(false);
  const latest = useRef(page.progress ?? 0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastWritten = useRef(page.progress ?? 0);
  const persist = async (markFinished = false) => {
    const value = latest.current;
    if (!markFinished && Math.abs(value - lastWritten.current) < 0.001) return true;
    try {
      await readLaterStorage.updatePage(page.id, {
        progress: value,
        ...(value >= 0.98 ? { visitedAt: Date.now() } : {}),
      });
      lastWritten.current = value;
      return true;
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Could not save reading progress.');
      return false;
    }
  };
  useEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = (el.scrollHeight - el.clientHeight) * (page.progress ?? 0);
    const flush = () => {
      clearTimeout(timer.current);
      void persist();
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      flush();
    };
  }, [page.id]);
  const finishNavigation = async (finished = false) => {
    setClosing(true);
    clearTimeout(timer.current);
    if (finished) latest.current = 1;
    if (await persist(finished)) close();
    else setClosing(false);
  };
  const minutes = Math.max(1, Math.ceil((page.articleText?.length ?? 0) / 900));
  return (
    <div className="article-reader">
      <header>
        <Button variant="ghost" size="sm" isDisabled={closing} onPress={() => void finishNavigation()}>
          <Icon name="back" size={18} />
          {text('待读', 'To read')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          aria-label={text('打开原文', 'Open original')}
          onPress={() => window.open(page.url, '_blank', 'noopener,noreferrer')}>
          <Icon name="external" size={16} />
        </Button>
      </header>
      {error && (
        <p className="reading-notice" role="alert">
          {error}
        </p>
      )}
      <div
        ref={scroll}
        className="reader-scroll"
        onScroll={() => {
          const el = scroll.current;
          if (!el) return;
          const value = Math.min(1, Math.max(0, el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)));
          latest.current = value;
          setProgress(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void persist(), 500);
        }}>
        <article>
          <span className="reader-site">{host(page.url)}</span>
          <h1>{page.title}</h1>
          <p className="reader-meta">{minutes + text(' 分钟阅读', ' min read')}</p>
          {page.articleText
            ?.split(/\n+/)
            .filter(Boolean)
            .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </article>
      </div>
      <div className="reader-progress">
        <span style={{ width: progress * 100 + '%' }} />
      </div>
      <footer className="reader-footer">
        <span>{Math.round(progress * 100) + '% · ' + text('进度已保存', 'Progress saved')}</span>
        <Button variant="secondary" isDisabled={closing} onPress={() => void finishNavigation(true)}>
          <Icon name="check" size={16} />
          {text('标为已读', 'Mark as read')}
        </Button>
      </footer>
    </div>
  );
};

class LibraryBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="reading-empty" role="alert">
        <h2>{text('暂时无法打开阅读库', 'Unable to open your library')}</h2>
        <p>{this.state.error.message}</p>
        <Button variant="outline" onPress={() => location.reload()}>
          {text('重新载入', 'Reload')}
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const ReadingLibrary = function ReadingLibrary(props: { popup?: boolean }) {
  return (
    <LibraryBoundary>
      <Suspense
        fallback={
          <div className="reading-empty" role="status">
            {text('正在打开阅读库…', 'Opening your library…')}
          </div>
        }>
        <ReadingLibraryContent {...props} />
      </Suspense>
    </LibraryBoundary>
  );
};

export { ReadingLibrary };
