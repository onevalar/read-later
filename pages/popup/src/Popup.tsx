import { ReadingLibrary } from '@extension/ui';
import { Suspense } from 'react';

export default function Popup() {
  return (
    <Suspense fallback={<div role="status">Loading…</div>}>
      <ReadingLibrary popup />
    </Suspense>
  );
}
