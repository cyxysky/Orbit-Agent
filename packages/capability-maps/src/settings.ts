import type { CapabilitySettingDefinition } from '@webpilot/capability-sdk';

export const mapsCapabilitySettings = [
  { key: 'GOOGLE_MAPS_BROWSER_KEY', label: 'Google 地图浏览器 Key', description: '仅限 Maps JavaScript API，设置网站来源限制。地图打开时会提供给浏览器；不要复用服务端 Key。', section: 'runtime', group: '地图', defaultValue: '', control: 'secret', secret: true, applyMode: 'runtime' },
  { key: 'GOOGLE_MAPS_SERVER_KEY', label: 'Google 地图服务端 Key', description: '仅限 Places API (New) 与 Routes API，用于地点搜索和路线规划；不会传给地图浏览器组件。', section: 'runtime', group: '地图', defaultValue: '', control: 'secret', secret: true, applyMode: 'runtime' },
  { key: 'GOOGLE_MAPS_LANGUAGE', label: '地图语言', description: 'Google 地图与搜索结果语言，例如 zh-CN、en。', section: 'runtime', group: '地图', defaultValue: 'zh-CN', control: 'text', applyMode: 'runtime' },
  { key: 'GOOGLE_MAPS_SEARCH_MONTHLY_LIMIT', label: '每月地点搜索上限', description: '本应用共享数据目录内的请求上限，包含打开搜索地图时的重新查询；0 表示停用。不能替代 Google Cloud 配额。', section: 'runtime', group: '地图', defaultValue: '4500', control: 'number', min: 0, max: 100000, step: 100, applyMode: 'runtime' },
  { key: 'GOOGLE_MAPS_ROUTES_MONTHLY_LIMIT', label: '每月路线请求上限', description: '本应用共享数据目录内的请求上限，包含打开路线地图时的重新查询；0 表示停用。', section: 'runtime', group: '地图', defaultValue: '9000', control: 'number', min: 0, max: 100000, step: 100, applyMode: 'runtime' },
] as const satisfies readonly CapabilitySettingDefinition[];
