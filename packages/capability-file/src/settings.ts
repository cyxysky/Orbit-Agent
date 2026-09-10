import type { CapabilitySettingDefinition } from '@webpilot/capability-sdk';

export const fileCapabilitySettings = [
  {
    key: 'OFFICE_GENERATION_MODE',
    label: 'Office 文件生成模式',
    description: 'JavaScript 模式：Excel 使用原有引擎，Word、PowerPoint、PDF 从 HTML 生成。Markdown 等文本文件可直接生成。',
    section: 'runtime',
    group: '文件能力',
    defaultValue: 'uno',
    control: 'select',
    applyMode: 'runtime',
    options: [
      { label: 'LibreOffice UNO', value: 'uno' },
      { label: 'JavaScript（Excel / HTML 文档）', value: 'javascript' },
      { label: '自动选择', value: 'auto' },
    ],
  },
] as const satisfies readonly CapabilitySettingDefinition[];
