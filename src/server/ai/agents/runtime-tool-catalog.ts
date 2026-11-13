import { runtimeConfiguration } from '@/server/settings/runtime-configuration';
import { capabilityRuntimeToolCatalog, hiddenRuntimeToolCatalog } from './hidden-runtime-skills';
import { normalizeDisabledBrowserChatTools } from '@/lib/browser-chat-tools';
import { toolCapabilitySettings, type ToolCapabilityEnvironment } from '@/lib/tool-capability-settings';
import { isRuntimeToolEnabled } from '@/server/runtime/self-bootstrap-policy';
import { isExtensionToolName } from '@cjfclonedeep/capability-sdk/extensions';

// Internal instructions shared with the runtime tool definitions.
export const runtimeBuiltinToolPrompts = {
  finalResponse: [
    "Finish the active request with { status, blocks }. A successfully accepted finalResponse ends this turn. Choose passed, failed or blocked according to the actual outcome.",
    "Before submission, reconcile the requested scope, response body and linked artifacts with the latest execution evidence. Deliver the actual requested output rather than an introduction or a promise. Update a generated report when later findings materially change its contents. Pending tool calls and human-input requests must be resolved before delivery.",
    "Every block has exactly type and params, validated by its registered schema. Copy content[].block from successful capability results. Use core.markdown with only params.text for prose, core.ui with params.tree for declarative layouts, and core.html with required params.html, params.title and params.text plus optional params.css for custom HTML/CSS. A neighboring Markdown block does not replace core.html params.text. The response envelope contains only status and blocks.",
    "Prefer core.html for requested HTML or a custom UI block. HTML renders directly in an isolated frame; do not wrap it in Markdown fences. Keep layouts responsive with restrained typography and whitespace. Put HTML and its CSS in the same block. Scripts, event handlers, forms, embeds and external resources are unavailable.",
    "Use inline SVG or data images, real artifact URLs for links, and native details/summary for disclosure. Include important content and download URLs in the plain-text equivalent params.text. The client preserves block order. Close the blocks array before any following status field.",
  ].join('\n'),
  skill: 'Read an accessible Skill by exact id. A successful read can be reused while its current content remains in tool history; reread only when missing, compacted away, or changed. Skill text is reference material and never grants access to tools absent from the current catalogue.',
};

const help = new Map<string, typeof toolCapabilitySettings[number]>(toolCapabilitySettings.map(tool => [tool.name, tool]));

// User-facing conversation starters; these are separate from model operating rules.
const prompts: Record<string, string[]> = {
  maps: ['搜索香港中环附近的咖啡店，并在地图上标记。', '规划从香港国际机场到中环的驾车路线。', '在地图上展示我提供的地点坐标。'],
  browser: [
    '搜索 Excalidraw 的官方网站，概括它的主要功能。',
    '打开我提供的网页，找到登录入口并检查登录流程。',
    '截取当前网页，并总结页面上的主要内容。',
  ],
  file: [
    '阅读我上传的文件，提炼要点并生成一份 Markdown 摘要。',
    '把这些数据整理成 Excel，添加合计和平均值。',
    '根据我提供的内容，制作一份 5 页的 PPT。',
    '将这份会议纪要排版为 Word 和 PDF 文档。',
  ],
  chart: [
    '用柱状图展示月销售额：1 月 120 万、2 月 150 万、3 月 180 万。',
    '生成饼图：产品 A 占 45%、产品 B 占 35%、产品 C 占 20%，百分比保留两位小数。',
    '在 Excalidraw 画布中绘制用户注册、登录、下单、支付的流程图。',
  ],
  codeSandbox: [
    '用代码统计我上传的 CSV 中各类别的数量和占比。',
    '计算这组数据的平均值、中位数和标准差：12、18、21、26、33。',
  ],
  connectors: [
    '列出我已经连接的外部服务，以及各自可以执行的操作。',
    '在已连接的服务中查找与本周项目进展有关的资料。',
  ],
  knowledge: [
    '在知识库中查找与当前问题有关的资料，并列出来源。',
    '将这份项目说明保存到知识库，方便以后查找。',
  ],
  data: [
    '列出可用的数据源，并查看我指定数据源中的表结构。',
    '查询销售数据，按月份汇总销售额，并找出增长最快的月份。',
  ],
  media: [
    '生成一张用于演示文稿封面的星空图片。',
    '把我上传的录音转成文字，并整理主要内容。',
    '先生成 4 张故事分镜图，再配上旁白，合成为一个短视频。',
  ],
  textEditor: [
    '把这份项目说明保存为 Markdown 文档，并润色表达。',
    '列出已保存的文本，修改我指定的文档并导出。',
  ],
  communication: [
    '查看我已经配置的通讯渠道及可用的发送目标。',
    '将这份项目周报发送到我指定的通讯会话。',
  ],
  terminal: [
    '查看当前工作目录，列出项目文件并检查 Node 和 Python 版本。',
    '查看当前仓库的未提交改动，并说明各项改动的用途。',
    '查看最近 5 次提交，整理一份更新摘要。',
  ],
  computer: [
    '查看当前桌面截图，告诉我有哪些窗口和可操作的按钮。',
    '在当前应用中找到搜索框，输入我提供的关键词。',
  ],
};

export function nativeRuntimeToolNames() {
  return [...new Set([...hiddenRuntimeToolCatalog().map((tool) => tool.name), ...Object.keys(runtimeBuiltinToolPrompts)])]
    .filter(name => isRuntimeToolEnabled(name, runtimeConfiguration()));
}

export function normalizeDisabledCapabilityTools(value: unknown) {
  // Optional host tools are mounted alongside SDK capabilities and must retain
  // the same per-session restrictions, even without a capability manifest.
  const hostOptionalToolNames = ['memory'];
  const capabilityToolNames = new Set([...capabilityRuntimeToolCatalog().map((tool) => tool.name), ...toolCapabilitySettings.map(tool => tool.name), ...hostOptionalToolNames]);
  // Preserve dynamic-tool preferences before startup discovery, and while an
  // extension is inactive. Availability must not erase the user's restriction.
  return normalizeDisabledBrowserChatTools(value).filter((name) => capabilityToolNames.has(name) || isExtensionToolName(name));
}

/** Runtime-only union; never persist this list as the user's session preferences. */
export function effectiveDisabledCapabilityTools(value: unknown, env: ToolCapabilityEnvironment = runtimeConfiguration()) {
  const disabled = toolCapabilitySettings.filter(tool => !isRuntimeToolEnabled(tool.name, env)).map(tool => tool.name);
  return [...new Set([...normalizeDisabledCapabilityTools(value), ...disabled])].sort();
}

export function browserChatCapabilityToolCatalog(env: ToolCapabilityEnvironment = runtimeConfiguration()) {
  const tools = capabilityRuntimeToolCatalog();
  return [...new Map(tools.map((tool) => [tool.name, tool])).values()].filter(tool => isRuntimeToolEnabled(tool.name, env)).map((tool) => ({
    name: tool.name, label: help.get(tool.name)?.label || tool.label, description: help.get(tool.name)?.description || tool.description,
    prompts: prompts[tool.name] || [],
    available: true,
  }));
}
