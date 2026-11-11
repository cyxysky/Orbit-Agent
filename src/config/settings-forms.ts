import { preferenceSettingDefinitions, type SettingsForm } from './settings-schema';
import { mediaSettingFields, mediaModelTypeDefinitions } from '@cjfclonedeep/capability-sdk/media/model-settings';
import { mediaModelDrivers } from '@cjfclonedeep/capability-sdk/media/models';
import { toolCapabilitySettings } from '@/lib/tool-capability-settings';

/** Built-in schema seeds. Pages render these descriptors through shared controls. */
export const settingsForms: SettingsForm[] = [
  { id: 'appearance', title: '基础设置', description: '调整品牌、界面语言与主题色。', fields: preferenceSettingDefinitions.filter(field => !field.hidden) },
  { id: 'tools.switches', title: '工具开关', description: '启用的工具可在每个对话中单独选择；关闭后，该工具将从对话工具列表中移除，也不会提供给 AI。',
    fields: toolCapabilitySettings.map(tool => ({ key: tool.envKey, label: tool.label, description: tool.description, control: 'boolean', defaultValue: 'true' })) },
  { id: 'provider.basic', title: '基础信息', description: '配置供应商名称和可用状态。', fields: [
    { key: 'provider', label: '默认服务商', description: '选择默认使用的 AI 模型服务提供商。', control: 'select' },
    { key: 'displayName', label: '供应商名称', description: '用于模型选择器中的分组名称，可按实际接入服务自由修改。', control: 'text', maxLength: 80 },
    { key: 'enabled', label: '启用服务商', description: '开启后，该服务商下配置的模型才会出现在模型选择列表中。', control: 'boolean' },
    { key: 'apiKey', label: '访问密钥', control: 'secret', secret: true },
  ] },
  { id: 'provider.connection', title: '连接配置', description: '服务地址、接口路径和请求参数仅用于当前类型。', fields: [
    { key: 'baseURL', label: '服务地址', description: '自定义兼容服务地址，留空使用默认地址。', control: 'text' },
    { key: 'extraRequestParameters', label: '额外请求参数', description: '以键值对形式添加到每次 Chat Completions 请求。值支持布尔值、数字、JSON 对象、数组和字符串；model、messages、stream、tools、tool_choice 由应用管理。', control: 'pairs' },
  ] },
  { id: 'model.default', title: '', description: '', fields: [
    { key: 'defaultModel', label: '默认模型', description: '选择当前类型默认使用的模型。', control: 'select' },
  ] },
  { id: 'model.list', title: '模型列表', description: '管理该供应商在当前类型下可选择的模型。', fields: [
    { key: 'models', label: '模型名称', description: '一个类型可以添加多个模型，运行时可在对话框中选择。', control: 'list' },
  ] },
  { id: 'model.capabilities', title: '编辑模型', description: '', fields: [
    { key: 'maxContextTokens', label: '该模型支持的最大上下文', description: '用于上下文用量显示和自动压缩预算。', control: 'number', min: 1, max: Number.MAX_SAFE_INTEGER, step: 1, placeholder: '留空使用默认上下文' },
    { key: 'imageInput', label: '该模型是否支持图片输入', control: 'boolean' },
  ] },
  { id: 'integration.basic', title: '外部集成', description: '', fields: [
    { key: 'driverId', label: '服务类型', control: 'select' },
    { key: 'name', label: '名称', control: 'text', maxLength: 200 },
    { key: 'enabled', label: '启用', description: '停用后保留配置，但 Agent 不会加载它。', control: 'boolean' },
  ] },
  ...mediaModelTypeDefinitions.flatMap(({ id: kind }) => mediaModelDrivers.filter(driver => driver.models[kind]).flatMap(driver => {
    const fields = mediaSettingFields.filter(field => field.kinds.includes(kind)).map(field => ({ ...field, control: field.type }));
    return [
      { id: `media.${kind}.${driver.id}.connection`, title: '连接配置', description: '服务地址、接口路径和请求参数仅用于当前类型。', fields: [
        { key: 'driver', label: '接口协议', description: '选择供应商实际使用的协议；自定义服务地址和路径不会转换请求或响应格式。', control: 'select', options: mediaModelDrivers.filter(item => item.models[kind]).map(item => ({ label: item.label, value: item.id })) },
        { key: 'baseURL', label: '服务地址', description: '填写当前类型的 API 基础地址，与其他类型独立。', control: 'text', placeholder: driver.baseURL },
        ...(driver.models[kind]?.routes || []).map(route => ({ key: `paths.${route.key}`, label: route.label, description: '留空使用供应商默认路径；自定义路径以 / 开头，并保留占位符。', control: 'text' as const, placeholder: route.path })),
        ...fields.filter(field => field.group === 'connection'),
        { key: 'parameters', label: '额外请求参数', description: '填写当前类型 AI SDK 支持的参数名和值。', control: 'pairs' },
      ] },
      { id: `media.${kind}.${driver.id}.generation`, title: '生成参数', description: '留空使用模型默认值；可用参数取决于模型。', fields: fields.filter(field => field.group === 'generation') },
    ] satisfies SettingsForm[];
  })),
];
