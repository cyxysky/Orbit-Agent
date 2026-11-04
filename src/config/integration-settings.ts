import type { SettingsField, SettingsForm } from './settings-schema';

type IntegrationCategory = 'connector' | 'communication' | 'data';

export const integrationPanels: Record<IntegrationCategory, {
  addLabel: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  namePlaceholder: string;
  typeLabel: string;
  editLabel: string;
  deleteTitle: string;
}> = {
  connector: {
    addLabel: '添加 MCP 服务',
    description: '配置 MCP 服务地址与授权，供 Agent 发现和调用工具。',
    emptyTitle: '尚未配置 MCP 服务',
    emptyDescription: '添加 MCP 服务地址及必要的授权信息，然后测试连接。',
    namePlaceholder: '例如：企业 MCP 服务',
    typeLabel: '连接类型',
    editLabel: '编辑 MCP 服务',
    deleteTitle: '删除 MCP 服务',
  },
  communication: {
    addLabel: '添加发送渠道',
    description: '每种渠道由独立驱动负责协议、认证、消息转换和结果校验。',
    emptyTitle: '尚未配置发送渠道',
    emptyDescription: '添加企业微信智能机器人或标准消息 Webhook。',
    namePlaceholder: '例如：企业微信通知',
    typeLabel: '渠道类型',
    editLabel: '编辑发送渠道',
    deleteTitle: '删除发送渠道',
  },
  data: {
    addLabel: '添加数据源',
    description: '添加 SQLite 或 PostgreSQL 数据库，填写连接信息后即可测试表结构。',
    emptyTitle: '尚未添加数据源',
    emptyDescription: '选择数据库类型并填写常规连接信息，无需编写 JSON 或连接脚本。',
    namePlaceholder: '例如：业务分析库',
    typeLabel: '数据库类型',
    editLabel: '编辑数据源',
    deleteTitle: '删除数据源',
  },
};


export function integrationDriverForm(driver: { id: string; label: string; description: string; fields: Array<Omit<SettingsField, 'control'> & { hidden?: boolean; control: 'text' | 'password' | 'url' | 'textarea' | 'select' }> }): SettingsForm {
  return { id: 'integration.' + driver.id, title: driver.label, description: driver.description, fields: driver.fields.filter(field => !field.hidden).map(field => ({ ...field, control: field.secret || field.control === 'password' ? 'secret' : field.control === 'url' ? 'text' : field.control, inputType: field.control === 'url' ? 'url' : undefined })) };
}
