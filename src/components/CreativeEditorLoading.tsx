'use client';

import { BeautifulLoadingState } from './BeautifulLoadingState';

export function CreativeEditorLoading({ label }: { label: string }) {
  return <div className="creative-editor-loading" aria-busy="true"><BeautifulLoadingState label={label} /></div>;
}
