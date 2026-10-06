import '@src/Options.css';
import { t } from '@extension/i18n';
import { PROJECT_URL_OBJECT, useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner, ToggleButton } from '@extension/ui';
import { useState, useEffect } from 'react';

interface IconTheme {
  mode: 'auto' | 'light' | 'dark';
}

const Options = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const logo = isLight ? 'options/logo_horizontal.svg' : 'options/logo_horizontal_dark.svg';
  const [iconTheme, setIconTheme] = useState<IconTheme>({ mode: 'auto' });

  const goGithubSite = () => chrome.tabs.create(PROJECT_URL_OBJECT);

  // 加载图标主题设置
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_ICON_THEME' }, (response) => {
      if (response?.theme) {
        setIconTheme(response.theme);
      }
    });
  }, []);

  // 设置图标主题
  const setIconThemeMode = (mode: 'auto' | 'light' | 'dark') => {
    const newTheme = { mode };
    chrome.runtime.sendMessage(
      { type: 'SET_ICON_THEME', theme: newTheme },
      (response) => {
        if (response?.success) {
          setIconTheme(newTheme);
        }
      }
    );
  };

  return (
    <div className={cn('App', isLight ? 'bg-slate-50 text-gray-900' : 'bg-gray-800 text-gray-100')}>
      <button onClick={goGithubSite}>
        <img src={chrome.runtime.getURL(logo)} className="App-logo" alt="logo" />
      </button>
      <p>
        Edit <code>pages/options/src/Options.tsx</code>
      </p>
      <ToggleButton onClick={exampleThemeStorage.toggle}>{t('toggleTheme')}</ToggleButton>
      
      {/* 图标主题设置 */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-3">图标主题</h3>
        <div className="space-y-2">
          {[
            { value: 'auto', label: '跟随系统' },
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' }
          ].map(({ value, label }) => (
            <label key={value} className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name="iconTheme"
                value={value}
                checked={iconTheme.mode === value}
                onChange={() => setIconThemeMode(value as any)}
                className="w-4 h-4"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <LoadingSpinner />), ErrorDisplay);
