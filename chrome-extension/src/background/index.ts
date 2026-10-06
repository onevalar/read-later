import 'webextension-polyfill';
import { exampleThemeStorage, readLaterStorage } from '@extension/storage';

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

// 检测系统主题
function getSystemTheme(): 'light' | 'dark' {
  return 'light'; // 默认浅色，因为 background script 无法直接访问 matchMedia
}

// 初始化图标主题
async function initializeIconTheme() {
  try {
    const stored = await chrome.storage.local.get(ICON_THEME_KEY);
    const iconTheme: IconTheme = stored[ICON_THEME_KEY] || { mode: 'auto' };
    
    let targetTheme: 'light' | 'dark';
    
    if (iconTheme.mode === 'auto') {
      targetTheme = getSystemTheme();
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
    title: 'Save to Read Later',
    contexts: ['page', 'link'],
  });
});

// 保持原有功能
exampleThemeStorage.get().then(theme => {
  console.log('theme', theme);
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

// 保存当前页面
async function saveCurrentPage(tab?: chrome.tabs.Tab) {
  try {
    // 如果没有传入 tab，获取当前活动标签页
    if (!tab) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = activeTab;
    }

    if (!tab || !tab.url || !tab.title) {
      throw new Error('Invalid tab');
    }

    // 过滤掉 chrome:// 等特殊页面
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('edge://')) {
      throw new Error('Cannot save special pages');
    }

    // 保存页面
    await readLaterStorage.addPage({
      url: tab.url,
      title: tab.title,
      favicon: tab.favIconUrl || getFaviconUrl(tab.url),
      tags: [],
    });

    console.log('✅ Page saved successfully:', tab.title);
  } catch (error) {
    console.error('Failed to save page:', error);
  }
}

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  try {
    if (info.menuItemId !== 'save-to-read-later') {
      return;
    }

    if (info.linkUrl) {
      // 如果是在链接上右键，保存链接
      readLaterStorage
        .addPage({
          url: info.linkUrl,
          title: info.linkUrl,
          favicon: getFaviconUrl(info.linkUrl),
          tags: [],
        })
        .then(() => {
          console.log('✅ Link saved:', info.linkUrl);
        })
        .catch(error => {
          console.error('❌ Failed to save link:', error);
        });
    } else if (tab) {
      // 否则保存当前页面
      saveCurrentPage(tab);
    }
  } catch (error) {
    console.error('❌ Context menu error:', error);
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
  // ... 已有的图标主题处理代码会在上面

  if (message.type === 'SAVE_CURRENT_PAGE') {
    saveCurrentPage().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  return false;
});

console.log('Background loaded with Read Later support');
