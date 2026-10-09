import { materializeOperations, mergeOperations, operationsForChange } from './library-operations.js';
import { createStorage, StorageEnum } from '../base/index.js';
import type { LibraryOperation } from './library-operations.js';

// 保存的页面数据结构
interface SavedPage {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  tags: string[]; // 用户手动添加的标签
  autoTags: string[]; // 自动生成的标签（智能分类）
  savedAt: number; // 保存时间戳
  visitedAt?: number; // 最后访问时间
  notes?: string; // 用户笔记
  articleText?: string; // 保存时提取的纯文本，手机和离线阅读使用
  progress?: number; // 0..1
}

// Read Later 状态类型
interface ReadLaterState {
  pages: SavedPage[];
  allTags: string[]; // 所有使用过的标签（始终由 pages 推导，不单独维护）
  operations?: LibraryOperation[];
}

// 保存结果
type SaveResult = 'saved' | 'duplicate' | 'unsupported' | 'error';
type SaveInput = { url: string; title: string; favicon?: string; articleText?: string };
type SaveReceipt = { pageId: string; url: string; operationId: string };
type SaveOutcome = { result: 'saved'; receipt: SaveReceipt } | { result: 'duplicate' | 'unsupported' | 'error' };
type UndoSaveResult = 'undone' | 'changed' | 'missing';

// 只允许保存普通网页，chrome://、file://、about: 等一律拒绝
const isSavableUrl = function isSavableUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

// 域名匹配：example.com 同时匹配 example.com 和 *.example.com，不会误中 dropbox.com 这类
const hostIs = function hostIs(hostname: string, ...domains: string[]): boolean {
  return domains.some(d => hostname === d || hostname.endsWith(`.${d}`));
};

// 智能分类：根据 URL 域名和标题识别内容类型和来源
const generateAutoTags = function generateAutoTags(url: string, title: string): string[] {
  const autoTags: string[] = [];
  const titleLower = title.toLowerCase();

  let hostname = '';
  let pathname = '';
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    // URL 无法解析时只按标题识别
  }

  // 识别视频网站
  if (hostIs(hostname, 'youtube.com', 'youtu.be')) {
    autoTags.push('🎬 Video', '📺 YouTube');
  } else if (hostIs(hostname, 'vimeo.com')) {
    autoTags.push('🎬 Video', '📺 Vimeo');
  } else if (hostIs(hostname, 'bilibili.com')) {
    autoTags.push('🎬 Video', '📺 Bilibili');
  } else if (hostIs(hostname, 'tiktok.com')) {
    autoTags.push('🎬 Video', '📱 TikTok');
  }

  // 识别音乐/音频网站
  if (hostIs(hostname, 'spotify.com')) {
    autoTags.push('🎵 Audio', '🎧 Spotify');
  } else if (hostIs(hostname, 'soundcloud.com')) {
    autoTags.push('🎵 Audio', '🎧 SoundCloud');
  } else if (hostIs(hostname, 'music.apple.com')) {
    autoTags.push('🎵 Audio', '🎧 Apple Music');
  }

  // 识别社交媒体
  if (hostIs(hostname, 'twitter.com', 'x.com')) {
    autoTags.push('📱 Social', '🐦 X/Twitter');
  } else if (hostIs(hostname, 'facebook.com')) {
    autoTags.push('📱 Social', '👥 Facebook');
  } else if (hostIs(hostname, 'instagram.com')) {
    autoTags.push('📱 Social', '📸 Instagram');
  } else if (hostIs(hostname, 'reddit.com')) {
    autoTags.push('📱 Social', '🤖 Reddit');
  } else if (hostIs(hostname, 'linkedin.com')) {
    autoTags.push('📱 Social', '💼 LinkedIn');
  }

  // 识别开发者网站
  if (hostIs(hostname, 'github.com')) {
    autoTags.push('💻 Dev', '🐙 GitHub');
  } else if (hostIs(hostname, 'stackoverflow.com')) {
    autoTags.push('💻 Dev', '📚 Stack Overflow');
  } else if (hostIs(hostname, 'dev.to')) {
    autoTags.push('💻 Dev', '📝 Dev.to');
  } else if (hostIs(hostname, 'medium.com')) {
    autoTags.push('📝 Article', '📰 Medium');
  }

  // 识别购物网站
  if (hostIs(hostname, 'amazon.com')) {
    autoTags.push('🛒 Shopping', '📦 Amazon');
  } else if (hostIs(hostname, 'taobao.com', 'tmall.com')) {
    autoTags.push('🛒 Shopping', '🛍️ Taobao');
  } else if (hostIs(hostname, 'jd.com')) {
    autoTags.push('🛒 Shopping', '🛍️ JD');
  }

  // 识别新闻网站（只看域名，不看路径，避免 /newsletter 之类误判）
  if (hostIs(hostname, 'cnn.com', 'bbc.com', 'nytimes.com') || /(^|[.-])news([.-]|$)/.test(hostname)) {
    autoTags.push('📰 News');
  }

  // 识别文档和 PDF
  if (pathname.endsWith('.pdf')) {
    autoTags.push('📄 PDF');
  } else if (hostIs(hostname, 'docs.google.com')) {
    autoTags.push('📄 Document', '📝 Google Docs');
  }

  // 根据标题识别内容类型
  if (titleLower.includes('tutorial') || titleLower.includes('how to')) {
    autoTags.push('📚 Tutorial');
  } else if (titleLower.includes('blog') || titleLower.includes('article')) {
    autoTags.push('📝 Article');
  }

  // 如果没有识别到任何类型，添加通用标签
  if (autoTags.length === 0) {
    autoTags.push('🌐 Web Page');
  }

  // 去重（比如 Medium 和标题 article 会重复）
  return Array.from(new Set(autoTags));
};

// 创建存储
const storage = createStorage<ReadLaterState>(
  'read-later-storage-key',
  {
    pages: [],
    allTags: [],
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

const createId = () => `page-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// allTags 永远由页面推导，避免删除/改标签后残留
const withDerivedTags = (pages: SavedPage[], operations: LibraryOperation[] = []): ReadLaterState => ({
  pages,
  operations,
  allTags: Array.from(new Set(pages.flatMap(p => p.tags))),
});

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

// 把导入的一条数据清洗成合法页面，不合法则丢弃
const sanitizeImportedPage = (raw: unknown): SavedPage | null => {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.url !== 'string' || !isSavableUrl(item.url)) return null;

  const title = typeof item.title === 'string' && item.title ? item.title : item.url;
  return {
    id: createId(), // 一律重新生成，避免与现有数据 id 冲突
    url: item.url,
    title,
    favicon: typeof item.favicon === 'string' ? item.favicon : undefined,
    tags: asStringArray(item.tags),
    autoTags: asStringArray(item.autoTags).length ? asStringArray(item.autoTags) : generateAutoTags(item.url, title),
    savedAt: typeof item.savedAt === 'number' ? item.savedAt : Date.now(),
    visitedAt: typeof item.visitedAt === 'number' ? item.visitedAt : undefined,
    notes: typeof item.notes === 'string' ? item.notes : undefined,
    articleText: typeof item.articleText === 'string' ? item.articleText.slice(0, 120000) : undefined,
    progress:
      typeof item.progress === 'number' && Number.isFinite(item.progress)
        ? Math.max(0, Math.min(1, item.progress))
        : undefined,
  };
};

// 同一个上下文内的写入排队执行；每次写入前重新读取最新数据，
// 避免 background 和 popup 同时写时互相覆盖
let writeQueue: Promise<unknown> = Promise.resolve();
const queueWrite = <T>(run: () => Promise<T>): Promise<T> => {
  const locked = () => (globalThis.navigator?.locks ? navigator.locks.request('read-later-library-write', run) : run());
  const next = writeQueue.then(locked, locked);
  writeQueue = next.catch(() => undefined);
  return next;
};
const mutate = <T>(fn: (pages: SavedPage[]) => { pages: SavedPage[]; result: T }): Promise<T> =>
  queueWrite(async () => {
    const fresh = await storage.get();
    const { pages, result } = fn(fresh.pages);
    await storage.set(() => withDerivedTags(pages, operationsForChange(fresh.pages, pages, fresh.operations ?? [])));
    return result;
  });

const saveWithReceipt = ({ url, title, favicon, articleText }: SaveInput): Promise<SaveOutcome> =>
  queueWrite(async () => {
    if (!isSavableUrl(url)) return { result: 'unsupported' };
    const fresh = await storage.get();
    if (fresh.pages.some(page => page.url === url)) return { result: 'duplicate' };
    const page: SavedPage = {
      id: createId(),
      url,
      title: title || url,
      favicon,
      articleText: articleText?.slice(0, 120000),
      tags: [],
      autoTags: generateAutoTags(url, title || url),
      savedAt: Date.now(),
    };
    const pages = [page, ...fresh.pages];
    const operations = operationsForChange(fresh.pages, pages, fresh.operations ?? []);
    const created = operations.find(op => op.kind === 'create' && op.url === url && op.patch.id === page.id);
    if (!created) throw new Error('The save could not be recorded.');
    await storage.set(withDerivedTags(pages, operations));
    return { result: 'saved', receipt: { pageId: page.id, url, operationId: created.id } };
  });

// Read Later 存储类型
interface ReadLaterStorageType {
  get: typeof storage.get;
  set: typeof storage.set;
  subscribe: typeof storage.subscribe;
  getSnapshot: typeof storage.getSnapshot;
  savePage: (page: SaveInput) => Promise<SaveResult>;
  savePageWithReceipt: (page: SaveInput) => Promise<SaveOutcome>;
  undoSave: (receipt: SaveReceipt) => Promise<UndoSaveResult>;
  mergeCloudOperations: (operations: LibraryOperation[]) => Promise<void>;
  removePage: (id: string) => Promise<void>;
  updatePage: (id: string, updates: Partial<SavedPage>) => Promise<void>;
  addTag: (pageId: string, tag: string) => Promise<void>;
  removeTag: (pageId: string, tag: string) => Promise<void>;
  searchPages: (query: string) => Promise<SavedPage[]>;
  getPagesByTag: (tag: string) => Promise<SavedPage[]>;
  getPagesByAutoTag: (autoTag: string) => Promise<SavedPage[]>;
  exportData: () => Promise<string>;
  importData: (jsonData: string) => Promise<{ added: number; skipped: number }>;
}

// 导出 Read Later 存储
const readLaterStorage: ReadLaterStorageType = {
  ...storage,

  // 保存页面：所有入口（右键、快捷键、popup 按钮）统一走这里，统一做过滤和去重
  savePage: async page => (await saveWithReceipt(page)).result,
  savePageWithReceipt: saveWithReceipt,

  // Only the unchanged create operation may be undone. An edit, read or re-save wins.
  undoSave: receipt =>
    queueWrite(async () => {
      if (
        !receipt ||
        typeof receipt.pageId !== 'string' ||
        typeof receipt.url !== 'string' ||
        typeof receipt.operationId !== 'string'
      )
        return 'missing';
      const fresh = await storage.get();
      const page = fresh.pages.find(p => p.id === receipt.pageId && p.url === receipt.url);
      if (!page) return 'missing';
      const history = (fresh.operations ?? []).filter(op => op.url === receipt.url);
      const latest = history[history.length - 1];
      if (latest?.id !== receipt.operationId || latest.kind !== 'create' || latest.patch.id !== receipt.pageId)
        return 'changed';
      const pages = fresh.pages.filter(p => p.id !== receipt.pageId);
      await storage.set(withDerivedTags(pages, operationsForChange(fresh.pages, pages, fresh.operations ?? [])));
      return 'undone';
    }),

  // 删除页面
  removePage: id => mutate(pages => ({ pages: pages.filter(p => p.id !== id), result: undefined })),

  mergeCloudOperations: remote =>
    queueWrite(async () => {
      const fresh = await storage.get();
      const local = operationsForChange(fresh.pages, fresh.pages, fresh.operations ?? []);
      const operations = mergeOperations(local, remote);
      if (JSON.stringify(operations) === JSON.stringify(fresh.operations ?? [])) return;
      await storage.set(withDerivedTags(materializeOperations(operations), operations));
    }),

  // 更新页面
  updatePage: (id, updates) =>
    mutate(pages => ({
      pages: pages.map(p =>
        p.id === id ? { ...p, ...updates, id: p.id, title: updates.title?.trim() || p.title } : p,
      ),
      result: undefined,
    })),

  // 添加标签
  addTag: (pageId, tag) =>
    mutate(pages => ({
      pages: pages.map(p => (p.id === pageId && !p.tags.includes(tag) ? { ...p, tags: [...p.tags, tag] } : p)),
      result: undefined,
    })),

  // 移除标签
  removeTag: (pageId, tag) =>
    mutate(pages => ({
      pages: pages.map(p => (p.id === pageId ? { ...p, tags: p.tags.filter(t => t !== tag) } : p)),
      result: undefined,
    })),

  // 搜索页面
  searchPages: async query => {
    const state = await storage.get();
    const queryLower = query.toLowerCase();
    return state.pages.filter(
      p =>
        p.title.toLowerCase().includes(queryLower) ||
        p.url.toLowerCase().includes(queryLower) ||
        p.tags.some(t => t.toLowerCase().includes(queryLower)) ||
        p.autoTags.some(t => t.toLowerCase().includes(queryLower)) ||
        (p.notes && p.notes.toLowerCase().includes(queryLower)),
    );
  },

  // 按标签获取页面
  getPagesByTag: async tag => {
    const state = await storage.get();
    return state.pages.filter(p => p.tags.includes(tag));
  },

  // 按自动标签获取页面
  getPagesByAutoTag: async autoTag => {
    const state = await storage.get();
    return state.pages.filter(p => p.autoTags.includes(autoTag));
  },

  // 导出数据
  exportData: async () => {
    const state = await storage.get();
    return JSON.stringify(state, null, 2);
  },

  // 导入数据：校验格式、重新生成 id、按网址去重
  importData: async jsonData => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonData);
    } catch {
      throw new Error('Invalid JSON data');
    }

    const rawPages = (parsed as { pages?: unknown } | null)?.pages;
    if (!Array.isArray(rawPages)) {
      throw new Error('Invalid data format');
    }

    return mutate(pages => {
      const knownUrls = new Set(pages.map(p => p.url));
      const incoming: SavedPage[] = [];
      let skipped = 0;

      for (const raw of rawPages) {
        const page = sanitizeImportedPage(raw);
        if (!page || knownUrls.has(page.url)) {
          skipped += 1;
          continue;
        }
        knownUrls.add(page.url);
        incoming.push(page);
      }

      return { pages: [...incoming, ...pages], result: { added: incoming.length, skipped } };
    });
  },
};

export type {
  SavedPage,
  ReadLaterState,
  SaveResult,
  SaveInput,
  SaveReceipt,
  SaveOutcome,
  UndoSaveResult,
  ReadLaterStorageType,
};
export { isSavableUrl, generateAutoTags, readLaterStorage };
