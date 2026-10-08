import { ReadingLibrary } from '@extension/ui';
import { Button } from '@onevalar/pro/react/button';
import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@extension/ui/reading-library.css';

const init = async function init() {
  createRoot(document.getElementById('app-container')!).render(
    <Suspense fallback={<p role="status">Loading your reading library…</p>}>
      <ReadingLibrary />
    </Suspense>,
  );
  if ('serviceWorker' in navigator) {
    if (import.meta.env.PROD) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    else
      void navigator.serviceWorker
        .getRegistrations()
        .then(registrations =>
          Promise.all(
            registrations
              .filter(
                registration =>
                  new URL(registration.scope).origin === location.origin &&
                  registration.active?.scriptURL === new URL('/sw.js', location.origin).href,
              )
              .map(registration => registration.unregister()),
          ),
        );
  }
};
void init().catch(error => {
  const zh = navigator.language.startsWith('zh');
  createRoot(document.getElementById('app-container')!).render(
    <div role="alert" className="reading-empty">
      <h2>{zh ? '暂时无法打开阅读库' : 'Unable to open your library'}</h2>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      <Button variant="outline" onPress={() => location.reload()}>
        {zh ? '重新载入' : 'Reload'}
      </Button>
    </div>,
  );
});
