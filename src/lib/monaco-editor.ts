'use client';

import type * as Monaco from 'monaco-editor/editor/editor.api.js';

let loading: Promise<typeof Monaco> | undefined;

/** Keep the editor and its worker local and outside the initial workspace bundle. */
export function loadMonacoEditor() {
  loading ??= (async () => {
    globalThis.MonacoEnvironment = {
      ...globalThis.MonacoEnvironment,
      getWorker: () => new Worker(new URL('../workers/monaco-editor.worker.ts', import.meta.url), { type: 'module', name: 'orbit-text-editor' }),
    };
    const monaco = await import('monaco-editor/editor/editor.api.js');
    await Promise.all([
      import('monaco-editor/editor/contrib/find/browser/findController.js'),
      import('monaco-editor/editor/contrib/clipboard/browser/clipboard.js'),
      import('monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js'),
      import('monaco-editor/editor/contrib/links/browser/links.js'),
      import('monaco-editor/languages/definitions/html/register.js'),
      import('monaco-editor/languages/definitions/markdown/register.js'),
    ]);
    return monaco;
  })().catch(error => { loading = undefined; throw error; });
  return loading;
}

export function applyMonacoEditorTheme(monaco: typeof Monaco) {
  const styles = getComputedStyle(document.documentElement);
  const dark = document.documentElement.dataset.theme === 'dark';
  // Monaco's color registry requires hex; CSS tokens may contain rgb/color-mix.
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  const color = (token: string, fallback: string) => {
    const value = styles.getPropertyValue(token).trim() || fallback;
    if (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value) || !context) return value;
    context.clearRect(0, 0, 1, 1); context.fillStyle = fallback; context.fillStyle = value; context.fillRect(0, 0, 1, 1);
    return `#${Array.from(context.getImageData(0, 0, 1, 1).data).map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  };
  const background = color('--panel', dark ? '#171717' : '#ffffff');
  const foreground = color('--foreground', dark ? '#d4d4d4' : '#1a2227');
  const selection = color('--selection-bg', dark ? '#404040' : '#dfe4e6');
  const selectedText = color('--selection-foreground', foreground);
  monaco.editor.defineTheme('orbit-text-editor', {
    base: dark ? 'vs-dark' : 'vs', inherit: true, rules: [],
    colors: {
      'editor.background': background, 'editor.foreground': foreground,
      'editorGutter.background': background,
      'editorLineNumber.foreground': color('--muted', dark ? '#929292' : '#67747c'),
      'editorLineNumber.activeForeground': foreground,
      'editorCursor.foreground': foreground,
      'editor.selectionBackground': selection, 'editor.inactiveSelectionBackground': selection,
      'editor.selectionForeground': selectedText,
      'editor.lineHighlightBorder': '#00000000', 'editor.lineHighlightBackground': '#00000000',
      focusBorder: '#00000000', contrastBorder: '#00000000',
      'editorWidget.background': color('--panel-elevated', background),
      'editorWidget.border': color('--border', dark ? '#333333' : '#dfe4e6'),
      'list.activeSelectionBackground': selection, 'list.activeSelectionForeground': selectedText,
    },
  });
  monaco.editor.setTheme('orbit-text-editor');
}
