import type { CapabilitySettingDefinition } from '../index.ts';
export const mediaCapabilitySettings = [
  { key: 'AGENT_VIDEO_RENDER_TIMEOUT_MS', label: '视频渲染超时', description: 'Remotion 合成视频的最长持续时间（毫秒），独立于模型生成超时。', section: 'runtime', group: '媒体', defaultValue: '900000', control: 'number', applyMode: 'runtime', min: 1000, max: 3600000, step: 1000 },
  { key: 'AGENT_MEDIA_TIMEOUT_MS', label: '媒体操作超时', description: '媒体操作的最长持续时间（毫秒）。', section: 'runtime', group: '媒体', defaultValue: '120000', control: 'number', applyMode: 'runtime', min: 1000, max: 900000, step: 1000 },
  { key: 'AGENT_MEDIA_MAX_FRAMES', label: '最大抽帧数', description: '单次抽帧操作生成的最大帧数。', section: 'runtime', group: '媒体', defaultValue: '12', control: 'number', applyMode: 'runtime', min: 1, max: 60, step: 1 },
] as const satisfies readonly CapabilitySettingDefinition[];
