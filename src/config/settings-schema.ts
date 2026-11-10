import { z } from 'zod';
import type { RuntimeSettingDefinition } from './settings';

export const settingsSchemaMetaKey = 'settings-schema-v1';
export const settingsSections = ['general', 'runtime', 'browser', 'capabilities', 'sensitive-data'] as const;
const safeKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,159}$/);

export const registeredSettingSchema = z.object({
  key: safeKey,
  label: z.string().trim().min(1).max(160),
  description: z.string().max(2000),
  tab: z.enum(settingsSections),
  group: z.string().trim().min(1).max(160),
  defaultValue: z.string().max(64000),
  control: z.enum(['boolean', 'number', 'select', 'text', 'secret', 'textarea']),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().positive().optional(),
  options: z.array(z.object({ label: z.string().max(160), value: z.string().max(1000) }).strict()).max(200).optional(),
  secret: z.boolean().optional(),
  hidden: z.boolean().optional(),
  applyMode: z.literal('runtime').default('runtime'),
}).strict().superRefine((field, context) => {
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    context.addIssue({ code: 'custom', message: 'Minimum exceeds maximum.' });
  }
  if (field.control === 'select' && !field.options?.length) {
    context.addIssue({ code: 'custom', message: 'Select fields require options.' });
  }
  if ((field.secret || field.control === 'secret') && field.defaultValue) {
    context.addIssue({ code: 'custom', message: 'Secret defaults must be empty.' });
  }
});

export const settingRegistrationSchema = z.object({
  namespace: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  fields: z.array(registeredSettingSchema).min(1).max(100),
}).strict();

export type RegisteredSetting = z.infer<typeof registeredSettingSchema> & { namespace: string };
export type SettingsRegistration = z.infer<typeof settingRegistrationSchema>;

const configurationDomain = z.enum(['catalog', 'runtime', 'preferences', 'model', 'integration']);
export const configurationRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('query'), domain: configurationDomain.default('catalog'), keys: z.array(z.string().max(200)).max(200).optional(), prefix: z.string().max(160).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict(),
  z.object({ action: z.literal('set'), domain: configurationDomain.exclude(['catalog']), values: z.record(z.string().max(200), z.unknown()) }).strict(),
  z.object({ action: z.literal('register'), registration: settingRegistrationSchema }).strict(),
]);

export type SettingsField = {
  key: string;
  label: string;
  description?: string;
  control: RuntimeSettingDefinition['control'] | 'color' | 'list' | 'json' | 'pairs';
  defaultValue?: string;
  options?: ReadonlyArray<{ label: string; value: string }>;
  min?: number;
  max?: number;
  step?: number;
  scale?: number;
  maxLength?: number;
  placeholder?: string;
  inputType?: 'text' | 'url';
  required?: boolean;
  hidden?: boolean;
  secret?: boolean;
  picker?: 'directory' | 'file';
  applyMode?: 'runtime' | 'recreate';
  visibleWhen?: { field: string; value: string };
};

export type SettingsForm = {
  id: string;
  title: string;
  description: string;
  fields: SettingsField[];
};

export const preferenceSettingDefinitions: SettingsField[] = [
  { key: 'UI_TOOL_ORDER', label: '工具列表顺序', description: '保存工具和 MCP 服务列表的拖拽顺序。', control: 'json', defaultValue: '{}', maxLength: 64000, hidden: true },
  { key: 'UI_BRAND_PREFIX', label: '品牌前缀', description: '设置侧边栏中的品牌前缀。', control: 'text', defaultValue: '', maxLength: 48 },
  { key: 'UI_BRAND_TEXT', label: '产品名称', description: '设置侧边栏中显示的产品名称。', control: 'text', defaultValue: 'Orbit', maxLength: 48 },
  { key: 'UI_LANGUAGE', label: '界面语言', description: '选择界面显示语言。', control: 'select', defaultValue: 'zh', options: [{ label: '中文', value: 'zh' }, { label: 'English', value: 'en' }] },
  { key: 'UI_THEME_COLOR', label: '主题色', description: '按当前配色比例联动背景、按钮、菜单、选择器和滚动条。夜间保持黑白灰。', control: 'color', defaultValue: '#1a2227' },
  { key: 'UI_THEME_MODE', label: '显示模式', description: '选择浅色或深色界面。', control: 'select', defaultValue: 'light', options: [{ label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }] },
];

export function validateSettingValue(field: SettingsField, raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') throw new Error(`Invalid value for ${field.key}.`);
  const value = String(raw);
  if (value.length > (field.maxLength ?? 2_000_000)) throw new Error(`${field.key} exceeds its length limit.`);
  if (field.control === 'boolean' && value !== 'true' && value !== 'false') throw new Error(`${field.key} requires true or false.`);
  if (field.control === 'select' && !field.options?.some(option => option.value === value)) throw new Error(`${field.key} has an unsupported option.`);
  if (field.control === 'number' && value !== '') {
    const number = Number(value);
    if (!Number.isFinite(number) || (field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) throw new Error(`${field.key} is outside its numeric range.`);
  }
  if (field.control === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${field.key} requires a six-digit color.`);
  if (field.control === 'json' && value) JSON.parse(value);
  return value;
}
