import { ReadingLibrary } from '@extension/ui';
import { Suspense } from 'react';

export default function Options() {
  return (
    <Suspense fallback={<div role="status">Loading…</div>}>
      <ReadingLibrary />
    </Suspense>
  );
}
