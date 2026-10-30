import type { HTMLResponseParams } from './index.ts';

export const HTML_FRAME_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads';
export const HTML_FRAME_MESSAGE = 'capability-html-height';

/** Browser-only document creation. The frame has an opaque origin; only our size observer can execute. */
export function createHTMLResponseDocument(
  params: HTMLResponseParams,
  options: { nonce: string; baseURL: string; locale: string; theme: Record<string, string> },
) {
  // Template contents stay inert (including resource loads) during normalization.
  const template = document.createElement('template');
  template.innerHTML = params.html;
  template.content.querySelectorAll('script, iframe, frame, frameset, object, embed, base, meta, link, form, template, noscript, foreignObject, animate, animateMotion, animateTransform, set, audio, video, source').forEach(node => node.remove());
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ['srcdoc', 'nonce', 'autofocus', 'ping', 'action', 'formaction', 'srcset', 'background'].includes(name)) {
        element.removeAttribute(attribute.name);
      }
      if (['href', 'xlink:href', 'src'].includes(name)) {
        const value = attribute.value.trim();
        const isAnchor = element.localName === 'a' && name === 'href';
        if (value.startsWith('#')) continue;
        if (name === 'src' && element.localName === 'img' && /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml);/i.test(value)) continue;
        if (isAnchor) {
          try {
            const url = new URL(value, options.baseURL);
            if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
              element.setAttribute('href', url.href);
              continue;
            }
          } catch { /* Discard invalid links. */ }
        }
        element.removeAttribute(attribute.name);
      }
    }
    if (element.localName === 'a') {
      const fragment = element.getAttribute('href')?.startsWith('#');
      if (fragment) element.setAttribute('href', `about:srcdoc${element.getAttribute('href')}`);
      element.setAttribute('target', fragment ? '_self' : '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }

  // Identify response boundaries without counting embedded style tags.
  let leadingContent = template.content.firstElementChild;
  while (leadingContent?.localName === 'style') leadingContent = leadingContent.nextElementSibling;
  leadingContent?.setAttribute('data-capability-html-head', '');
  let trailingContent = template.content.lastElementChild;
  while (trailingContent?.localName === 'style') trailingContent = trailingContent.previousElementSibling;
  trailingContent?.setAttribute('data-capability-html-tail', '');

  const frameDocument = document.implementation.createHTMLDocument(params.title);
  frameDocument.documentElement.lang = options.locale;
  for (const [name, value] of Object.entries(options.theme)) {
    frameDocument.documentElement.style.setProperty(name, value);
  }
  const policy = frameDocument.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; script-src 'nonce-${options.nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'`;
  frameDocument.head.prepend(policy);
  const viewport = frameDocument.createElement('meta');
  viewport.name = 'viewport';
  viewport.content = 'width=device-width, initial-scale=1';
  frameDocument.head.append(viewport);
  const styles = frameDocument.createElement('style');
  styles.textContent = `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: transparent; }
    body { display: flow-root; color: var(--foreground, #303e3c); font: 14px/1.75 var(--app-font-sans, system-ui, sans-serif); overflow-wrap: anywhere; }
    :where(body > [data-capability-html-head], body > [data-capability-html-head] > :is(h1, h2, h3, p, ul, ol, dl):first-child) { margin-block-start: 0; }
    :where(body > [data-capability-html-tail], body > [data-capability-html-tail] > :is(p, ul, ol, dl):last-child) { margin-block-end: 0; }
    img, svg { max-width: 100%; }
    a { color: var(--accent-strong, #426c68); text-underline-offset: 4px; }
    :focus-visible { outline: 2px solid var(--accent, #507b78); outline-offset: 4px; }
    ${params.css || ''}
  `.replace(/</g, '\\3c ');
  frameDocument.head.append(styles);
  frameDocument.body.append(template.content);

  // An HTML response is part of the conversation, not a separate scrolling page.
  // Inline important rules keep generated html/body CSS (100vh, max-height,
  // overflow: auto, etc.) from constraining the size we report to the host.
  for (const root of [frameDocument.documentElement, frameDocument.body]) {
    for (const [name, value] of Object.entries({
      height: 'auto', 'min-height': '0', 'max-height': 'none',
      width: '100%', 'min-width': '0', 'max-width': '100%',
      margin: '0',
      background: 'transparent',
      overflow: root === frameDocument.body ? 'visible' : 'hidden',
    })) root.style.setProperty(name, value, 'important');
  }
  frameDocument.documentElement.style.setProperty('padding', '0', 'important');
  frameDocument.body.style.setProperty('display', 'flow-root', 'important');

  const observer = frameDocument.createElement('script');
  observer.setAttribute('nonce', options.nonce);
  observer.textContent = `(() => {
    // Plain outer wrappers must not add page gutters on top of chat spacing.
    // Preserve padding for painted cards, borders and the content inside them.
    const trimBoundary = (selector, edge) => {
      const element = document.querySelector(selector);
      if (!element || !/^(SECTION|MAIN|ARTICLE|DIV)$/.test(element.tagName)) return;
      const style = getComputedStyle(element);
      const transparent = style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent';
      if (!transparent || style.backgroundImage !== 'none' || style.boxShadow !== 'none'
        || ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style['border' + side + 'Width']) > 0)
        || style.outlineStyle !== 'none') return;
      element.style.setProperty('margin-block-' + edge, '0', 'important');
      element.style.setProperty('padding-block-' + edge, '0', 'important');
    };
    trimBoundary('body > [data-capability-html-head]', 'start');
    trimBoundary('body > [data-capability-html-tail]', 'end');
    let previous = -1;
    let scheduled = false;
    const report = () => {
      scheduled = false;
      const height = Math.ceil(Math.max(document.body.getBoundingClientRect().height, document.body.scrollHeight));
      if (height !== previous) {
        previous = height;
        parent.postMessage({ type: '${HTML_FRAME_MESSAGE}', nonce: '${options.nonce}', height }, '*');
      }
    };
    const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(report); } };
    new ResizeObserver(schedule).observe(document.body);
    window.addEventListener('resize', schedule);
    window.addEventListener('load', schedule);
    document.fonts.ready.then(schedule);
    document.addEventListener('toggle', schedule, true);
    schedule();
  })();`;
  frameDocument.body.append(observer);
  return '<!doctype html>' + frameDocument.documentElement.outerHTML;
}
