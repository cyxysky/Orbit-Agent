'use client';

import type { ReactNode } from 'react';
import { responseUIStyles } from './styles.ts';
import type { UINode } from './index.ts';

function textProp(props: Record<string, unknown>, name: string) {
  return typeof props[name] === 'string' ? props[name] : '';
}

function numberProp(props: Record<string, unknown>, name: string) {
  return typeof props[name] === 'number' && Number.isFinite(props[name]) ? props[name] : undefined;
}

function renderChildren(
  children: UINode['children'],
  renderMarkdown?: (markdown: string) => ReactNode,
) {
  return (children || []).map((child, index) => typeof child === 'string'
    ? <span key={index}>{child}</span>
    : <DeclarativeNode key={index} node={child} renderMarkdown={renderMarkdown} />);
}

function DeclarativeNode({
  node,
  renderMarkdown,
}: {
  node: UINode;
  renderMarkdown?: (markdown: string) => ReactNode;
}) {
  const props = node.props || {};
  const children = renderChildren(node.children, renderMarkdown);
  if (node.type === 'card') {
    return <section className="capability-response-ui-card">
      {textProp(props, 'title') ? <h3>{textProp(props, 'title')}</h3> : null}
      {textProp(props, 'description') ? <p>{textProp(props, 'description')}</p> : null}
      {children}
    </section>;
  }
  if (node.type === 'stack' || node.type === 'row' || node.type === 'grid') {
    const columns = Math.max(1, Math.min(4, numberProp(props, 'columns') || 2));
    return <div
      className={`capability-response-ui-${node.type}`}
      style={node.type === 'grid' ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >{children}</div>;
  }
  if (node.type === 'heading') {
    return <h3 className="capability-response-ui-heading">{textProp(props, 'text') || children}</h3>;
  }
  if (node.type === 'text') {
    return <p className="capability-response-ui-text">{textProp(props, 'text') || children}</p>;
  }
  if (node.type === 'markdown') {
    const markdown = textProp(props, 'text');
    return <div className="capability-response-ui-markdown">{renderMarkdown ? renderMarkdown(markdown) : markdown}</div>;
  }
  if (node.type === 'badge') {
    return <span className={`capability-response-ui-badge tone-${textProp(props, 'tone') || 'neutral'}`}>
      {textProp(props, 'text') || children}
    </span>;
  }
  if (node.type === 'time') {
    const value = textProp(props, 'value') || new Date().toISOString();
    const parsed = new Date(value);
    const display = Number.isNaN(parsed.getTime())
      ? value
      : new Intl.DateTimeFormat(textProp(props, 'locale') || undefined, {
          dateStyle: textProp(props, 'dateStyle') === 'full' ? 'full' : 'medium',
          timeStyle: textProp(props, 'timeStyle') === 'short' ? 'short' : 'medium',
          ...(textProp(props, 'timeZone') ? { timeZone: textProp(props, 'timeZone') } : {}),
        }).format(parsed);
    return <div className="capability-response-ui-time">
      {textProp(props, 'label') ? <span>{textProp(props, 'label')}</span> : null}
      <time dateTime={value}>{display}</time>
    </div>;
  }
  if (node.type === 'stat') {
    return <div className="capability-response-ui-stat">
      <span>{textProp(props, 'label')}</span>
      <strong>{textProp(props, 'value')}</strong>
      {textProp(props, 'detail') ? <small>{textProp(props, 'detail')}</small> : null}
    </div>;
  }
  if (node.type === 'progress') {
    const value = Math.max(0, Math.min(100, numberProp(props, 'value') || 0));
    return <div className="capability-response-ui-progress">
      <span>{textProp(props, 'label')}</span>
      <progress max={100} value={value} />
      <strong>{value}%</strong>
    </div>;
  }
  if (node.type === 'divider') return <hr className="capability-response-ui-divider" />;
  if (node.type === 'keyValue') {
    const items = Array.isArray(props.items) ? props.items : [];
    return <dl className="capability-response-ui-key-value">{items.map((item, index) => {
      const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return <div key={index}><dt>{textProp(record, 'label')}</dt><dd>{textProp(record, 'value')}</dd></div>;
    })}</dl>;
  }
  if (node.type === 'timeline') return <ol className="capability-response-ui-timeline">{children.map((child, index) => <li key={index}>{child}</li>)}</ol>;
  if (node.type === 'link') {
    const href = textProp(props, 'href');
    return <a href={href} rel="noreferrer" target="_blank">{textProp(props, 'label') || href || children}</a>;
  }
  return null;
}

export function DeclarativeResponseView({
  tree,
  renderMarkdown,
}: {
  tree: UINode;
  renderMarkdown?: (markdown: string) => ReactNode;
}) {
  return <div className="capability-response-ui"><style>{responseUIStyles}</style><DeclarativeNode node={tree} renderMarkdown={renderMarkdown} /></div>;
}
