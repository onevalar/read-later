import '@src/Options.css';
import { t } from '@extension/i18n';
import { useSystemTheme, withErrorBoundary, withSuspense } from '@extension/shared';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui';
import { useState, useEffect } from 'react';

type IconThemeMode = 'auto' | 'light' | 'dark';

const Options = () => {
  const { isLight } = useSystemTheme();
  const [iconMode, setIconMode] = useState<IconThemeMode>('auto');

  // 加载图标主题设置
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_ICON_THEME' }, response => {
      if (response?.theme?.mode) {
        setIconMode(response.theme.mode);
      }
    });
  }, []);

  // 设置图标主题
  const changeIconMode = (mode: IconThemeMode) => {
    chrome.runtime.sendMessage({ type: 'SET_ICON_THEME', theme: { mode } }, response => {
      if (response?.success) {
        setIconMode(mode);
      }
    });
  };

  const options: { value: IconThemeMode; label: string }[] = [
    { value: 'auto', label: t('iconThemeAuto') },
    { value: 'light', label: t('iconThemeLight') },
    { value: 'dark', label: t('iconThemeDark') },
  ];

  return (
    <div className={cn('App', isLight ? 'bg-slate-50 text-gray-900' : 'bg-gray-800 text-gray-100')}>
      <h1 className="mb-8 text-2xl font-semibold">📚 {t('optionsTitle')}</h1>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">{t('iconTheme')}</h2>
        <div className="space-y-2 text-left">
          {options.map(({ value, label }) => (
            <label key={value} className="flex cursor-pointer items-center space-x-2">
              <input
                type="radio"
                name="iconTheme"
                value={value}
                checked={iconMode === value}
                onChange={() => changeIconMode(value)}
                className="size-4"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </section>

      <p className="text-sm opacity-70">{t('shortcutHint')}</p>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <LoadingSpinner />), ErrorDisplay);
