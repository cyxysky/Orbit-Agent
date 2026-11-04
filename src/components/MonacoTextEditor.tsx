'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type * as Monaco from 'monaco-editor/editor/editor.api.js';
import { applyMonacoEditorTheme, loadMonacoEditor } from '@/lib/monaco-editor';
import { CreativeEditorLoading } from './CreativeEditorLoading';

export type MonacoTextEditorHandle = { flush(): Promise<void> };
type Props = {
  value: string; disabled?: boolean; readOnly?: boolean; label: string;
  language?: 'text' | 'markdown' | 'html'; handleRef?: Ref<MonacoTextEditorHandle>;
  onChange?(value: string): void;
  onSave?(): void | Promise<void>;
  onComposition?(composing: boolean): void;
  onSelection?(start: number, end: number, bounds: DOMRect): void;
};
const modelLanguage = (language?: Props['language']) => !language || language === 'text' ? 'plaintext' : language;

export function MonacoTextEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null), editor = useRef<Monaco.editor.IStandaloneCodeEditor>(null);
  const model = useRef<Monaco.editor.ITextModel>(null), callbacks = useRef(props), emitted = useRef(props.value);
  const monacoApi = useRef<typeof Monaco>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined), composing = useRef(false), changed = useRef(false);
  const flushRef = useRef<() => void>(() => {});
  const externalUpdate = useRef<(value: string) => void>(() => {});
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  callbacks.current = props;
  useImperativeHandle(props.handleRef, () => ({ flush: async () => {
    const deadline = Date.now() + 2000;
    while (composing.current) {
      if (Date.now() >= deadline) throw new Error('请先完成当前文字输入，再保存或关闭。');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    flushRef.current();
  } }), []);

  useEffect(() => {
    let disposed = false, applyingValue = false, selecting = false, selectionFrame = 0, lastSelection = '';
    let resizeTheme: MutationObserver | undefined;
    const subscriptions: Monaco.IDisposable[] = [];
    const flush = () => {
      clearTimeout(timer.current); timer.current = undefined;
      if (!changed.current || !model.current || disposed) return;
      if (composing.current) { timer.current = setTimeout(flush, 50); return; }
      changed.current = false; emitted.current = model.current.getValue();
      callbacks.current.onChange?.(emitted.current);
    };
    flushRef.current = flush;
    const publishSelection = () => {
      if (disposed || selecting || composing.current || !editor.current || !model.current) return;
      const selection = editor.current.getSelection(); if (!selection) return;
      const from = model.current.getOffsetAt(selection.getStartPosition()), to = model.current.getOffsetAt(selection.getEndPosition());
      if (`${from}:${to}` === lastSelection) return;
      lastSelection = `${from}:${to}`;
      if (from !== to) flush();
      const node = editor.current.getDomNode(); if (!node) return;
      const bounds = node.getBoundingClientRect(), position = editor.current.getScrolledVisiblePosition(selection.getPosition());
      const scaleX = bounds.width / (node.clientWidth || 1), scaleY = bounds.height / (node.clientHeight || 1);
      callbacks.current.onSelection?.(from, to, position
        ? new DOMRect(bounds.left + position.left * scaleX, bounds.top + position.top * scaleY, scaleX, position.height * scaleY)
        : bounds);
    };
    const scheduleSelection = () => { cancelAnimationFrame(selectionFrame); selectionFrame = requestAnimationFrame(publishSelection); };
    const finishSelection = () => { if (!selecting) return; selecting = false; scheduleSelection(); };
    window.addEventListener('pointerup', finishSelection);
    window.addEventListener('pointercancel', finishSelection);
    void loadMonacoEditor().then(monaco => {
      if (disposed || !host.current) return;
      const current = callbacks.current; monacoApi.current = monaco;
      applyMonacoEditorTheme(monaco);
      emitted.current = current.value;
      const textModel = monaco.editor.createModel(current.value, modelLanguage(current.language));
      model.current = textModel;
      const view = monaco.editor.create(host.current, {
        model: textModel, theme: 'orbit-text-editor', ariaLabel: current.label,
        readOnly: Boolean(current.disabled || current.readOnly), domReadOnly: Boolean(current.disabled || current.readOnly),
        automaticLayout: true, minimap: { enabled: false }, glyphMargin: false,
        editContext: false,
        lineNumbers: current.readOnly ? 'off' : 'on', lineNumbersMinChars: 3, lineDecorationsWidth: 4,
        folding: false, overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--app-font-mono').trim() || 'Consolas, monospace',
        fontSize: 14, lineHeight: 24, tabSize: 2, padding: { top: 4, bottom: 8 },
        renderLineHighlight: 'none', selectionHighlight: false, occurrencesHighlight: 'off',
        wordBasedSuggestions: 'off', wordWrap: 'off', scrollBeyondLastLine: false,
        largeFileOptimizations: true, renderValidationDecorations: 'off',
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
      });
      editor.current = view;
      if (current.onSave) subscriptions.push(view.addAction({ id: 'orbit.save-text-document', label: '保存文本', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => callbacks.current.onSave?.() }));
      subscriptions.push(
        view.onDidChangeModelContent(() => {
          if (applyingValue) return;
          changed.current = true; lastSelection = ''; clearTimeout(timer.current); timer.current = setTimeout(flush, 200); scheduleSelection();
        }),
        view.onDidChangeCursorSelection(scheduleSelection),
        view.onMouseDown(() => { selecting = true; }),
        view.onMouseUp(() => { selecting = false; scheduleSelection(); }),
        view.onDidBlurEditorText(flush),
        view.onDidCompositionStart(() => { composing.current = true; callbacks.current.onComposition?.(true); }),
        view.onDidCompositionEnd(() => { composing.current = false; callbacks.current.onComposition?.(false); clearTimeout(timer.current); timer.current = setTimeout(flush, 0); scheduleSelection(); }),
      );
      // Prop updates share the same model and preserve undo history for external edits.
      externalUpdate.current = value => {
        if (value === emitted.current) return;
        applyingValue = true;
        try {
          // Synchronize the model even while user input is disabled during a save.
          textModel.pushStackElement();
          textModel.pushEditOperations(view.getSelections(), [{ range: textModel.getFullModelRange(), text: value }], () => null);
          textModel.pushStackElement();
          emitted.current = value; changed.current = false; lastSelection = '';
          clearTimeout(timer.current); timer.current = undefined;
        }
        finally { applyingValue = false; }
      };
      resizeTheme = new MutationObserver(() => applyMonacoEditorTheme(monaco));
      resizeTheme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      setReady(true);
    }).catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => {
      disposed = true; resizeTheme?.disconnect(); subscriptions.forEach(subscription => subscription.dispose());
      window.removeEventListener('pointerup', finishSelection); window.removeEventListener('pointercancel', finishSelection);
      cancelAnimationFrame(selectionFrame); clearTimeout(timer.current); timer.current = undefined;
      flushRef.current = () => {}; externalUpdate.current = () => {};
      editor.current?.dispose(); model.current?.dispose(); editor.current = null; model.current = null; monacoApi.current = null;
      composing.current = false; changed.current = false;
    };
  }, [attempt]);

  useEffect(() => { externalUpdate.current(props.value); }, [props.value]);
  useEffect(() => {
    editor.current?.updateOptions({ readOnly: Boolean(props.disabled || props.readOnly), domReadOnly: Boolean(props.disabled || props.readOnly), ariaLabel: props.label, lineNumbers: props.readOnly ? 'off' : 'on' });
    if (model.current) monacoApi.current?.editor.setModelLanguage(model.current, modelLanguage(props.language));
  }, [props.disabled, props.readOnly, props.label, props.language]);
  return <div className="text-monaco-editor">
    <div ref={host} className="text-monaco-host" />
    {!ready && !error && <CreativeEditorLoading label="正在加载编辑器" />}
    {error && <div className="text-editor-load-error" role="alert"><p>{error}</p><button type="button" className="ui-button" onClick={() => { setError(''); setReady(false); setAttempt(value => value + 1); }}>重新加载编辑器</button></div>}
  </div>;
}
