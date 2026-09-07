'use client';

import { memo, useMemo, type ReactNode } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import { CopyTextButton } from '@/components/ui/copy-text-button';
import { useI18n } from '@/i18n/I18nProvider';

Prism.manual = true;

function tokenNodes(tokens: (string | Prism.Token)[]): ReactNode[] {
  return tokens.map((token, index) => typeof token === 'string' ? token : <span className={['token', token.type, ...([token.alias || ''].flat())].filter(Boolean).join(' ')} key={index}>{tokenNodes(typeof token.content === 'string' ? [token.content] : Array.isArray(token.content) ? token.content : [token.content])}</span>);
}

export const BrowserChatCodeBlock = memo(function BrowserChatCodeBlock({ code, language = '' }: { code: string; language?: string }) {
  const { t } = useI18n();
  const normalizedLanguage = language.toLowerCase();
  const content = useMemo(() => {
    const grammar = Prism.languages[normalizedLanguage];
    if (!grammar || code.length > 100_000) return code;
    try { return tokenNodes(Prism.tokenize(code, grammar)); } catch { return code; }
  }, [code, normalizedLanguage]);
  return <div className="browser-chat-code-block">
    <div className="browser-chat-code-header">
      <span>{normalizedLanguage || t('纯文本')}</span>
      <CopyTextButton text={code} label={t('复制代码')} className="browser-chat-code-copy" size={14} />
    </div>
    <pre><code>{content}</code></pre>
  </div>;
});
