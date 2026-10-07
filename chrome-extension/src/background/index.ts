import 'webextension-polyfill';
import { readLaterStorage, type SaveResult } from '@extension/storage';

// 图标主题管理
interface IconTheme {
  mode: 'auto' | 'light' | 'dark';
}

const ICON_THEME_KEY = 'iconTheme';

// 设置图标
async function setIcon(theme: 'light' | 'dark') {
  const iconPaths = {
    light: {
      '16': 'icons/icon-16-light.png',
      '32': 'icons/icon-32-light.png',
    },
    dark: {
      '16': 'icons/icon-16-dark.png',
      '32': 'icons/icon-32-dark.png',
    }
  };

  try {
    await chrome.action.setIcon({ path: iconPaths[theme] });
  } catch (error) {
    // 回退到默认图标
    await chrome.action.setIcon({ path: 'icon-34.png' });
  }
}

// 系统主题：service worker 拿不到 matchMedia，由 popup / 设置页打开时上报并缓存在这里
const SYSTEM_THEME_KEY = 'systemTheme';

async function getSystemTheme(): Promise<'light' | 'dark'> {
  const stored = await chrome.storage.local.get(SYSTEM_THEME_KEY);
  return stored[SYSTEM_THEME_KEY] === 'dark' ? 'dark' : 'light';
}

// 初始化图标主题
async function initializeIconTheme() {
  try {
    const stored = await chrome.storage.local.get(ICON_THEME_KEY);
    const iconTheme: IconTheme = stored[ICON_THEME_KEY] || { mode: 'auto' };
    
    let targetTheme: 'light' | 'dark';
    
    if (iconTheme.mode === 'auto') {
      targetTheme = await getSystemTheme();
    } else {
      targetTheme = iconTheme.mode;
    }
    
    await setIcon(targetTheme);
  } catch (error) {
    console.log('Failed to initialize icon theme:', error);
  }
}

// 提供设置图标主题的方法
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SET_ICON_THEME') {
    const theme: IconTheme = message.theme;
    chrome.storage.local.set({ [ICON_THEME_KEY]: theme }).then(() => {
      initializeIconTheme();
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (message.type === 'SYSTEM_THEME') {
    const theme = message.theme === 'dark' ? 'dark' : 'light';
    chrome.storage.local.set({ [SYSTEM_THEME_KEY]: theme }).then(() => {
      initializeIconTheme();
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_ICON_THEME') {
    chrome.storage.local.get(ICON_THEME_KEY).then(stored => {
      const iconTheme: IconTheme = stored[ICON_THEME_KEY] || { mode: 'auto' };
      sendResponse({ theme: iconTheme });
    });
    return true;
  }
  
  return false;
});

// 扩展启动时初始化图标和右键菜单
chrome.runtime.onStartup.addListener(initializeIconTheme);
chrome.runtime.onInstalled.addListener(() => {
  initializeIconTheme();
  // 创建右键菜单
  chrome.contextMenus.create({
    id: 'save-to-read-later',
    title: chrome.i18n.getMessage('contextMenuTitle'),
    contexts: ['page', 'link'],
  });
});

// ============ Read Later 功能 ============

// 获取 favicon URL
function getFaviconUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
  } catch {
    return '';
  }
}

// 在图标上短暂显示保存结果，让用户知道有没有成功
async function showBadge(text: string, color: string) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => undefined);
    }, 2000);
  } catch (error) {
    console.error('Failed to set badge:', error);
  }
}

// 统一的保存入口：保存并把结果反馈到图标上
async function savePageWithFeedback(page: { url?: string; title?: string; favicon?: string }): Promise<SaveResult> {
  const url = page.url ?? '';
  const result = await readLaterStorage.savePage({
    url,
    title: page.title || url,
    favicon: page.favicon || getFaviconUrl(url),
  });

  if (result === 'saved') {
    await showBadge('✓', '#16a34a');
  } else if (result === 'duplicate') {
    await showBadge('=', '#ca8a04');
  } else {
    await showBadge('!', '#dc2626');
  }
  return result;
}

// 保存当前页面
async function saveCurrentPage(tab?: chrome.tabs.Tab): Promise<SaveResult> {
  try {
    // 如果没有传入 tab，获取当前活动标签页
    if (!tab) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = activeTab;
    }

    return await savePageWithFeedback({ url: tab?.url, title: tab?.title, favicon: tab?.favIconUrl });
  } catch (error) {
    console.error('Failed to save page:', error);
    await showBadge('!', '#dc2626');
    return 'unsupported';
  }
}

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'save-to-read-later') {
    return;
  }

  if (info.linkUrl) {
    // 在链接上右键：保存链接（拿不到目标页标题，用网址代替）
    savePageWithFeedback({ url: info.linkUrl, title: info.linkUrl }).catch(error => {
      console.error('Failed to save link:', error);
      showBadge('!', '#dc2626');
    });
  } else if (tab) {
    saveCurrentPage(tab);
  }
});

// 监听快捷键
chrome.commands.onCommand.addListener((command) => {
  if (command === 'save-page') {
    saveCurrentPage();
  }
});

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SAVE_CURRENT_PAGE') {
    saveCurrentPage().then(result => {
      sendResponse({ success: result === 'saved', result });
    });
    return true;
  }

  return false;
});

console.log('Background loaded with Read Later support');
