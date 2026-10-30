'use client';

import { Component, Suspense, createElement, type ComponentType, type ReactNode } from 'react';
import { ResponseRegistry, type ResponseBlock, type ResponseDefinition } from '../index.ts';
import { htmlResponse, markdownResponse, uiResponse } from './index.ts';
import { DeclarativeResponseView as DataUI } from './data-ui.tsx';
import { HTMLResponseView as HTMLUI } from './html-ui.tsx';

// Static export hosts use the same safe document and declarative layout renderers.
export { DeclarativeResponseView } from './data-ui.tsx';
export { createHTMLResponseDocument, HTML_FRAME_MESSAGE, HTML_FRAME_SANDBOX } from './html-document.ts';

export type ResponseRenderContext = {
  identity: string;
  readOnly: boolean;
  locale: string;
  translate(text: string): string;
  renderMarkdown(text: string): ReactNode;
  request<T>(block: ResponseBlock, operation: string, input?: unknown, signal?: AbortSignal): Promise<T>;
  subscribe(block: ResponseBlock, refresh: () => void): () => void;
};
export type ResponseComponentProps<T = Record<string, unknown>> = { params: T; context: ResponseRenderContext };
export interface ResponseRenderer<T = Record<string, unknown>> {
  definition: ResponseDefinition<T>;
  component: ComponentType<ResponseComponentProps<T>>;
}

/** Erase the heterogeneous component type only after pairing it with its own parser. */
export function defineResponseRenderer<T extends Record<string, unknown>>(renderer: ResponseRenderer<T>): ResponseRenderer {
  return {
    definition: renderer.definition,
    component: function ValidatedResponse(props) {
      return createElement(renderer.component, { ...props, params: renderer.definition.params.parse(props.params) });
    },
  };
}

export class ResponseRendererRegistry {
  readonly #renderers = new Map<string, ResponseRenderer>();
  constructor(readonly definitions: ResponseRegistry) {}
  register(renderers: readonly ResponseRenderer[]) {
    for (const renderer of renderers) {
      if (this.definitions.require(renderer.definition.type) !== renderer.definition) throw new Error(`Mismatched renderer definition: ${renderer.definition.type}`);
      if (this.#renderers.has(renderer.definition.type)) throw new Error(`Duplicate response renderer: ${renderer.definition.type}`);
      this.#renderers.set(renderer.definition.type, renderer);
    }
    return this;
  }
  assertComplete() {
    for (const definition of this.definitions.definitions()) {
      if (!this.#renderers.has(definition.type)) throw new Error(`Missing response renderer: ${definition.type}`);
    }
    return this;
  }
  get(type: string) { return this.#renderers.get(type); }
}

type ResponseErrorBoundaryProps = {
  children: ReactNode;
  context: ResponseRenderContext;
  params: unknown;
  renderer: ResponseRenderer;
  fallbackText: () => string;
};

class ResponseErrorBoundary extends Component<ResponseErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<ResponseErrorBoundaryProps>) {
    if (this.state.failed && (previous.params !== this.props.params || previous.renderer !== this.props.renderer)) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div>
      <div role="alert">{this.props.context.translate('此内容暂时无法显示。')}</div>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{this.props.fallbackText()}</div>
      <button type="button" onClick={() => this.setState({ failed: false })}>{this.props.context.translate('重试')}</button>
    </div>;
  }
}

export function RegisteredResponse({ block, registry, context }: {
  block: ResponseBlock; registry: ResponseRendererRegistry; context: ResponseRenderContext;
}) {
  const renderer = registry.get(block.type);
  // Keep the declared plain-text equivalent independent of rich renderers.
  const fallbackText = () => {
    try { return registry.definitions.get(block.type)?.toText(block.params) || ''; }
    catch { return ''; }
  };
  if (!renderer) return <div>
    <div role="status">{context.translate('此内容的展示组件未安装。')}</div>
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{fallbackText()}</div>
  </div>;
  return <ResponseErrorBoundary key={`${context.identity}:${block.type}`} context={context} params={block.params} renderer={renderer} fallbackText={fallbackText}>
    <Suspense fallback={<div role="status">{context.translate('正在加载内容…')}</div>}>
      <renderer.component params={block.params} context={context} />
    </Suspense>
  </ResponseErrorBoundary>;
}

// These small core views load with the entry point, so ordinary replies do
// not depend on a second chunk request. Optional renderers retain Suspense.
export const coreResponseRenderers = [
  defineResponseRenderer({ definition: markdownResponse, component: ({ params, context }) => <>{context.renderMarkdown(params.text)}</> }),
  defineResponseRenderer({ definition: uiResponse, component: ({ params, context }) => <DataUI tree={params.tree} renderMarkdown={context.renderMarkdown} /> }),
  defineResponseRenderer({ definition: htmlResponse, component: ({ params, context }) => <HTMLUI params={params} locale={context.locale} /> }),
];
