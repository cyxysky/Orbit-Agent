'use client';

import { RegisteredResponse } from '@cjfclonedeep/capability-sdk/responses/react';
import { responseRenderers } from './response-renderers';
import { createResponseContext } from './response-context';
import { useI18n } from '@/i18n/I18nProvider';

import {
  Children,
  Fragment,
  isValidElement,
  createContext,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import { browserChatMarkdownBlocks } from './browser-chat-markdown-blocks';
import { resolveBrowserChatArtifactReference, type BrowserChatArtifactSummary } from '@/lib/browser-chat-artifacts';
import { BrowserChatCodeBlock } from '@/components/BrowserChatCodeBlock';
import { PixelImage } from '@/components/ui/pixel-image';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { browserChatHtmlSchema, rehypeBrowserChatSvgReferences } from './browser-chat-html';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {
  browserChatOrderedResponseParts,
  normalizeBrowserChatMarkdown,
  remarkBrowserChatCjkStrong,
} from '@/components/browser-chat-markdown';
import { normalizeEmbeddedBrowserAddress } from '@/components/browser-chat-embedded-url';
import type { BrowserChatUIMessagePart } from '@/lib/browser-chat-ui-message';

const BROWSER_CHAT_DOWNLOAD_EXTENSIONS = new Set([
  '.7z',
  '.apk',
  '.bin',
  '.bz2',
  '.csv',
  '.deb',
  '.dmg',
  '.doc',
  '.docx',
  '.exe',
  '.gz',
  '.ipa',
  '.msi',
  '.pkg',
  '.ppt',
  '.pptx',
  '.rar',
  '.rpm',
  '.tar',
  '.tgz',
  '.xls',
  '.xlsx',
  '.xz',
  '.zip',
]);

function normalizeBrowserChatMarkdownHref(href: string) {
  const trimmed = href.trim();
  if (!trimmed) return '';
  if (/^[./?#/]/.test(trimmed)) {
    try {
      return new URL(trimmed, typeof window === 'undefined' ? 'http://127.0.0.1/' : window.location.href).toString();
    } catch {
      return '';
    }
  }
  return normalizeEmbeddedBrowserAddress(trimmed);
}

function isBrowserChatDownloadHref(href: string) {
  const normalizedHref = normalizeBrowserChatMarkdownHref(href);
  if (!normalizedHref) return false;
  try {
    const parsed = new URL(normalizedHref);
    const downloadValue = parsed.searchParams.get('download');
    if (downloadValue !== null && !/^(0|false|no)$/i.test(downloadValue)) return true;
    const attachmentValue = [
      parsed.searchParams.get('content-disposition'),
      parsed.searchParams.get('response-content-disposition'),
    ].filter(Boolean).join(' ').toLowerCase();
    if (attachmentValue.includes('attachment')) return true;
    const pathname = decodeURIComponent(parsed.pathname || '').toLowerCase();
    const extension = pathname.match(/\.([a-z0-9]{1,8})$/)?.[0] || '';
    return BROWSER_CHAT_DOWNLOAD_EXTENSIONS.has(extension);
  } catch {
    return false;
  }
}

export function handleBrowserChatMarkdownLinkClick(event: ReactMouseEvent<HTMLAnchorElement>, href?: string) {
  const rawHref = String(href || '').trim();
  if (!rawHref || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (rawHref.startsWith('#') || /^(javascript|mailto|tel):/i.test(rawHref)) return;
  const url = normalizeBrowserChatMarkdownHref(rawHref);
  if (!url) return;
  if (isBrowserChatDownloadHref(rawHref)) {
    const systemBridge = typeof window === 'undefined' ? undefined : window.webPilotSystem;
    if (!systemBridge?.downloadUrl) return;
    event.preventDefault();
    systemBridge.downloadUrl({ url }).catch(() => undefined);
    return;
  }
  const bridge = typeof window === 'undefined' ? undefined : window.webPilotEmbeddedBrowser;
  if (!bridge) return;
  event.preventDefault();
  bridge.createTab({ url }).catch(() => undefined);
}

function BrowserChatMarkdownTable({ children }: { children: ReactNode }) {
  return (
    <div className="browser-chat-markdown-table-scroll table-root table-root--primary">
      <div className="table__scroll-container" tabIndex={0}>
        <table className="table__content">{children}</table>
      </div>
    </div>
  );
}

export const BrowserChatSessionIdContext = createContext<string | undefined>(undefined);
export const BrowserChatMarkdownArtifactsContext = createContext<readonly BrowserChatArtifactSummary[]>([]);
export const BrowserChatAutomationRunIdContext = createContext<string | undefined>(undefined);

// Keep renderer identities stable while a streamed response grows.
const markdownComponents: Components = {
  img: ({ src, alt, title }) => typeof src === 'string' && src ? (
    <PixelImage src={src} alt={alt || ''} title={title} loading="lazy" />
  ) : <span>{alt || '图片暂不可用'}</span>,
  pre: ({ children }) => {
    const code = Children.toArray(children)[0];
    if (!isValidElement<{ className?: string; children?: ReactNode }>(code)) return <pre>{children}</pre>;
    const language = /language-([^\s]+)/.exec(code.props.className || '')?.[1] || '';
    return <BrowserChatCodeBlock code={String(code.props.children || '')} language={language} />;
  },
  a: ({ href, onClick, ...props }) => href ? (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        handleBrowserChatMarkdownLinkClick(event, href);
      }}
      target={isBrowserChatDownloadHref(href || '') ? '_self' : '_blank'}
      rel="noopener noreferrer"
    />
  ) : <span>{props.children}</span>,
  table: ({ children }) => <BrowserChatMarkdownTable>{children}</BrowserChatMarkdownTable>,
  thead: ({ children }) => <thead className="table__header">{children}</thead>,
  tbody: ({ children }) => <tbody className="table__body">{children}</tbody>,
  tr: ({ children }) => <tr className="table__row">{children}</tr>,
  th: ({ children, style }) => <th className="table__column" style={style}>{children}</th>,
  td: ({ children, style }) => <td className="table__cell" style={style}>{children}</td>,
};

const BrowserChatMarkdownBlock = memo(function BrowserChatMarkdownBlock({ markdown }: { markdown: string }) {
  const artifacts = useContext(BrowserChatMarkdownArtifactsContext);
  return (
    <ReactMarkdown
      urlTransform={(url, key) => defaultUrlTransform(resolveBrowserChatArtifactReference(url, artifacts, key === 'src'))}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, browserChatHtmlSchema], rehypeBrowserChatSvgReferences, rehypeKatex]}
      remarkPlugins={[remarkGfm, remarkMath, remarkBrowserChatCjkStrong]}
      components={markdownComponents}
    >
      {markdown}
    </ReactMarkdown>
  );
});

export const BrowserChatMarkdown = memo(function BrowserChatMarkdown({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => browserChatMarkdownBlocks(normalizeBrowserChatMarkdown(markdown)), [markdown]);
  return (
    <div className="browser-chat-agent-markdown">
      {blocks.map((block, index) => (
        <Fragment key={index}>
          {index > 0 ? '\n' : null}
          <BrowserChatMarkdownBlock markdown={block} />
        </Fragment>
      ))}
    </div>
  );
});

export const BrowserChatOrderedResponse = memo(function BrowserChatOrderedResponse({
  fallbackText,
  parts,
}: {
  fallbackText: string;
  parts?: BrowserChatUIMessagePart[];
}) {
  const sessionId = useContext(BrowserChatSessionIdContext);
  const automationRunId = useContext(BrowserChatAutomationRunIdContext);
  const { t, language } = useI18n();
  const responseContext = useMemo(() => createResponseContext({
    sessionId, automationRunId, translate: t, locale: language,
    renderMarkdown: text => <BrowserChatMarkdown markdown={text} />,
  }), [sessionId, automationRunId, t, language]);
  const responseParts = useMemo(() => browserChatOrderedResponseParts(parts, fallbackText), [parts, fallbackText]);
  if (!responseParts.length) return null;
  return <div className="browser-chat-ordered-response">{responseParts.map((part, index) => {
    if (part.type === 'text') return <BrowserChatMarkdown key={`text:${index}`} markdown={part.text} />;
    if (part.type === 'data-response') return <RegisteredResponse
      key={`${automationRunId || sessionId}:${part.id || index}:${part.data.type}`}
      block={part.data} registry={responseRenderers} context={responseContext} />;
    return null;
  })}</div>;
});
