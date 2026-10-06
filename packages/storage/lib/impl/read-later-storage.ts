import { createStorage, StorageEnum } from '../base/index.js';

// 保存的页面数据结构
export interface SavedPage {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  tags: string[]; // 用户手动添加的标签
  autoTags: string[]; // 自动生成的标签（智能分类）
  savedAt: number; // 保存时间戳
  visitedAt?: number; // 最后访问时间
  notes?: string; // 用户笔记
}

// Read Later 状态类型
export interface ReadLaterState {
  pages: SavedPage[];
  allTags: string[]; // 所有使用过的标签
}

// 智能分类：根据 URL 识别内容类型和来源
export function generateAutoTags(url: string, title: string): string[] {
  const autoTags: string[] = [];
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();

  // 识别视频网站
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    autoTags.push('🎬 Video', '📺 YouTube');
  } else if (urlLower.includes('vimeo.com')) {
    autoTags.push('🎬 Video', '📺 Vimeo');
  } else if (urlLower.includes('bilibili.com')) {
    autoTags.push('🎬 Video', '📺 Bilibili');
  } else if (urlLower.includes('tiktok.com')) {
    autoTags.push('🎬 Video', '📱 TikTok');
  }

  // 识别音乐/音频网站
  if (urlLower.includes('spotify.com')) {
    autoTags.push('🎵 Audio', '🎧 Spotify');
  } else if (urlLower.includes('soundcloud.com')) {
    autoTags.push('🎵 Audio', '🎧 SoundCloud');
  } else if (urlLower.includes('music.apple.com')) {
    autoTags.push('🎵 Audio', '🎧 Apple Music');
  }

  // 识别社交媒体
  if (urlLower.includes('twitter.com') || urlLower.includes('x.com')) {
    autoTags.push('📱 Social', '🐦 X/Twitter');
  } else if (urlLower.includes('facebook.com')) {
    autoTags.push('📱 Social', '👥 Facebook');
  } else if (urlLower.includes('instagram.com')) {
    autoTags.push('📱 Social', '📸 Instagram');
  } else if (urlLower.includes('reddit.com')) {
    autoTags.push('📱 Social', '🤖 Reddit');
  } else if (urlLower.includes('linkedin.com')) {
    autoTags.push('📱 Social', '💼 LinkedIn');
  }

  // 识别开发者网站
  if (urlLower.includes('github.com')) {
    autoTags.push('💻 Dev', '🐙 GitHub');
  } else if (urlLower.includes('stackoverflow.com')) {
    autoTags.push('💻 Dev', '📚 Stack Overflow');
  } else if (urlLower.includes('dev.to')) {
    autoTags.push('💻 Dev', '📝 Dev.to');
  } else if (urlLower.includes('medium.com')) {
    autoTags.push('📝 Article', '📰 Medium');
  }

  // 识别购物网站
  if (urlLower.includes('amazon.com')) {
    autoTags.push('🛒 Shopping', '📦 Amazon');
  } else if (urlLower.includes('taobao.com') || urlLower.includes('tmall.com')) {
    autoTags.push('🛒 Shopping', '🛍️ Taobao');
  } else if (urlLower.includes('jd.com')) {
    autoTags.push('🛒 Shopping', '🛍️ JD');
  }

  // 识别新闻网站
  if (
    urlLower.includes('news') ||
    urlLower.includes('cnn.com') ||
    urlLower.includes('bbc.com') ||
    urlLower.includes('nytimes.com')
  ) {
    autoTags.push('📰 News');
  }

  // 识别文档和 PDF
  if (urlLower.endsWith('.pdf')) {
    autoTags.push('📄 PDF');
  } else if (urlLower.includes('docs.google.com')) {
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

  return autoTags;
}

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

// Read Later 存储类型
export interface ReadLaterStorageType {
  get: typeof storage.get;
  set: typeof storage.set;
  subscribe: typeof storage.subscribe;
  addPage: (page: Omit<SavedPage, 'id' | 'savedAt' | 'autoTags'>) => Promise<void>;
  removePage: (id: string) => Promise<void>;
  updatePage: (id: string, updates: Partial<SavedPage>) => Promise<void>;
  addTag: (pageId: string, tag: string) => Promise<void>;
  removeTag: (pageId: string, tag: string) => Promise<void>;
  searchPages: (query: string) => Promise<SavedPage[]>;
  getPagesByTag: (tag: string) => Promise<SavedPage[]>;
  getPagesByAutoTag: (autoTag: string) => Promise<SavedPage[]>;
  exportData: () => Promise<string>;
  importData: (jsonData: string) => Promise<void>;
}

// 导出 Read Later 存储
export const readLaterStorage: ReadLaterStorageType = {
  ...storage,

  // 添加页面
  addPage: async page => {
    await storage.set(currentState => {
      const newPage: SavedPage = {
        ...page,
        id: `page-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        savedAt: Date.now(),
        autoTags: generateAutoTags(page.url, page.title),
      };

      // 更新所有标签列表
      const allTags = new Set([...currentState.allTags, ...page.tags]);

      return {
        pages: [newPage, ...currentState.pages],
        allTags: Array.from(allTags),
      };
    });
  },

  // 删除页面
  removePage: async id => {
    await storage.set(currentState => ({
      ...currentState,
      pages: currentState.pages.filter(p => p.id !== id),
    }));
  },

  // 更新页面
  updatePage: async (id, updates) => {
    await storage.set(currentState => ({
      ...currentState,
      pages: currentState.pages.map(p => (p.id === id ? { ...p, ...updates } : p)),
    }));
  },

  // 添加标签
  addTag: async (pageId, tag) => {
    await storage.set(currentState => {
      const allTags = new Set([...currentState.allTags, tag]);
      return {
        pages: currentState.pages.map(p =>
          p.id === pageId ? { ...p, tags: [...p.tags, tag] } : p,
        ),
        allTags: Array.from(allTags),
      };
    });
  },

  // 移除标签
  removeTag: async (pageId, tag) => {
    await storage.set(currentState => ({
      ...currentState,
      pages: currentState.pages.map(p =>
        p.id === pageId ? { ...p, tags: p.tags.filter(t => t !== tag) } : p,
      ),
    }));
  },

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

  // 导入数据
  importData: async jsonData => {
    try {
      const importedState: ReadLaterState = JSON.parse(jsonData);
      await storage.set(currentState => ({
        pages: [...importedState.pages, ...currentState.pages],
        allTags: Array.from(new Set([...importedState.allTags, ...currentState.allTags])),
      }));
    } catch (error) {
      throw new Error('Invalid JSON data');
    }
  },
};
