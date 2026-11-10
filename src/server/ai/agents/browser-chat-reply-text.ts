import { stripBrowserChatContextMarkers } from '../../../lib/browser-chat-visible-text';
export { browserChatInterruptedTurnContextMarker } from '../../../lib/browser-chat-visible-text';

import { containsModelToolProtocol, modelVisibleText } from '@/lib/model-visible-text';

export function containsPrivateToolProtocol(value: string | undefined) { return containsModelToolProtocol(value || ''); }

export function normalizeBrowserChatFinalReplyText(value: string | undefined) {
  return stripBrowserChatContextMarkers(modelVisibleText((value || '').replace(/\r\n?/g, '\n')));
}

export function isBrowserChatDomObservationText(value: string | undefined) {
  const text = normalizeBrowserChatFinalReplyText(value);
  if (!text) return false;
  return /(?:^|\n)DOM snapshot (?:actionable|full|text):/i.test(text)
    || /(?:^|\n)Inter-action changes(?:\s|:)/i.test(text)
    || /\buid=dom-\d+-\d+\b/.test(text) && /<\/?[a-z][^>]*>/i.test(text)
    || /\buid=\d+\s+(?:RootWebArea|button|link|textbox|combobox|StaticText)\b/.test(text);
}
