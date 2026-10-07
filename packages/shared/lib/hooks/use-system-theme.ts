import { useEffect, useState } from 'react';

const query = '(prefers-color-scheme: dark)';

// 跟随系统的浅色/深色主题；同时把结果告诉 background，用来选择工具栏图标
export const useSystemTheme = () => {
  const [isDark, setIsDark] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'SYSTEM_THEME', theme: isDark ? 'dark' : 'light' }).catch(() => undefined);
  }, [isDark]);

  return { isLight: !isDark };
};
