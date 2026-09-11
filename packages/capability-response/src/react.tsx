'use client';

import { Component, Suspense, createElement, lazy, type ComponentType, type ReactNode } from 'react';
import { ResponseRegistry, type ResponseBlock, type ResponseDefinition } from '@webpilot/capability-sdk';
import { markdownResponse, uiResponse } from './index.ts';

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

class ResponseErrorBoundary extends Component<{ children: ReactNode; context: ResponseRenderContext; params: unknown }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ params: unknown }>) {
    if (this.state.failed && previous.params !== this.props.params) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <div role="alert">{this.props.context.translate('此内容暂时无法显示。')}</div> : this.props.children;
  }
}

export function RegisteredResponse({ block, registry, context }: {
  block: ResponseBlock; registry: ResponseRendererRegistry; context: ResponseRenderContext;
}) {
  const renderer = registry.get(block.type);
  if (!renderer) return <div role="status">{context.translate('此内容的展示组件未安装。')}</div>;
  return <ResponseErrorBoundary key={`${context.identity}:${block.type}`} context={context} params={block.params}>
    <Suspense fallback={<div role="status">{context.translate('正在加载内容…')}</div>}>
      <renderer.component params={block.params} context={context} />
    </Suspense>
  </ResponseErrorBoundary>;
}

const DataUI = lazy(() => import('./data-ui.tsx').then(module => ({ default: module.DeclarativeResponseView })));
export const coreResponseRenderers = [
  defineResponseRenderer({ definition: markdownResponse, component: ({ params, context }) => <>{context.renderMarkdown(params.text)}</> }),
  defineResponseRenderer({ definition: uiResponse, component: ({ params, context }) => <DataUI tree={params.tree} renderMarkdown={context.renderMarkdown} /> }),
];
