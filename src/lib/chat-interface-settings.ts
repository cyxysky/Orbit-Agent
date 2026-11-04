export type ChatInterfaceSettings = {
  showMoreMenu: boolean;
  showToolConfiguration: boolean;
  attachmentUploadEnabled: boolean;
  attachmentAccept: string;
};

export const defaultChatInterfaceSettings: ChatInterfaceSettings = {
  showMoreMenu: true,
  showToolConfiguration: true,
  attachmentUploadEnabled: true,
  attachmentAccept: '',
};

export function normalizeAttachmentAccept(value: string) {
  const rules = [...new Set(value.toLowerCase().split(/[\s,;]+/u).filter(Boolean))];
  if (rules.some(rule => !/^\.[a-z0-9][a-z0-9.+_-]*$/u.test(rule)
    && !/^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*)$/u.test(rule)
    && rule !== '*/*')) throw new Error('附件类型请填写扩展名或 MIME 类型，例如 .pdf、.docx、image/*');
  return rules.join(',');
}

export function readChatInterfaceSettings(env: Record<string, string | undefined>): ChatInterfaceSettings {
  const enabled = (key: string) => !['false', '0', 'off', 'no'].includes((env[key] || 'true').trim().toLowerCase());
  return {
    showMoreMenu: enabled('CHAT_SHOW_MORE_MENU'),
    showToolConfiguration: enabled('CHAT_SHOW_TOOL_CONFIGURATION'),
    attachmentUploadEnabled: enabled('CHAT_ATTACHMENT_UPLOAD_ENABLED'),
    attachmentAccept: normalizeAttachmentAccept(env.CHAT_ATTACHMENT_ACCEPT || ''),
  };
}

/** The same accept rules drive the picker and both upload transports. */
export function acceptsChatAttachment(file: { name: string; type: string }, accept: string) {
  if (!accept.trim()) return true;
  const name = file.name.toLowerCase();
  const mime = file.type.split(';')[0].trim().toLowerCase();
  return normalizeAttachmentAccept(accept).split(',').some(rule => rule === '*/*'
    || (rule.startsWith('.') ? name.endsWith(rule)
      : rule.endsWith('/*') ? mime.startsWith(rule.slice(0, -1)) : mime === rule));
}
