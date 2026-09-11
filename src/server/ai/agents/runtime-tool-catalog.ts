import { capabilityRuntimeToolCatalog, hiddenRuntimeToolCatalog, hiddenRuntimeSkillIds } from './hidden-runtime-skills';
import { normalizeDisabledBrowserChatTools } from '@/lib/browser-chat-tools';

// Internal instructions shared with the runtime tool definitions.
export const runtimeBuiltinToolPrompts = {
  reportDefect: 'Proactively report one evidence-backed product defect or reproducible product problem found while testing the live interface. During a testing task, calling this tool is mandatory as soon as browser action=code has reproduced the issue and emitted at least one screenshot that visibly proves it; do not defer the report to the final answer or wait for the user to ask. Do not report speculation, expected behavior, environment/configuration/permission limitations, or the same issue twice. screenshotFileNames must exactly match the safe file names returned by a successful browser action=code call in this Agent run.',
  finalResponse: 'Finish the request with ordered registered response blocks. Every block has type and params, validated by the selected type schema. Copy content[].block from successful capability results. Use core.markdown with params.text for prose and core.ui with params.tree for declarative layouts. The client preserves array order.',
  skill: `Read a Skill by exact id. Hidden runtime Skills for this mode are ${hiddenRuntimeSkillIds().join(', ')}. A successful read can be reused while its exact current content remains in the active tool history; reread only when missing, compacted away, or changed.`,
};

const help: Record<string, [string, string]> = {
  browser: ['浏览器', '搜索并读取网页、操作页面、检查界面和截图。'],
  file: ['文件', '读取和修改文件，生成 Word、Excel、PPT、PDF，以及 Markdown 等文本文件。'],
  chart: ['图表与画布', '创建和更新二维、三维图表，以及可编辑的 Excalidraw 画布。'],
  maps: ['地图', '搜索 Google 地点，规划驾车、步行和骑行路线，并展示交互地图。'],
  codeSandbox: ['代码沙箱', '运行隔离的代码，计算数据、处理文件和生成程序产物。'],
  connectors: ['连接器', '调用已配置外部服务的接口和操作。'],
  knowledge: ['知识库', '保存、检索和维护可复用的参考资料。'],
  data: ['数据源', '查询已配置的数据源，读取结构并分析数据。'],
  media: ['多媒体', '按模型和服务配置生成、转写或处理图片、音频和视频。'],
  communication: ['通信', '通过已配置的渠道读取消息、发送文字或文件。'],
  git: ['Git', '查看仓库和差异，管理版本与代码变更。'],
  computer: ['电脑操作', '通过已配置的电脑控制服务观察界面、点击和输入。'],
  workflow: ['工作流', '维护多阶段任务、状态和执行进度。'],
};

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
  ],
  communication: [
    '查看我已经配置的通讯渠道及可用的发送目标。',
    '将这份项目周报发送到我指定的通讯会话。',
  ],
  git: [
    '查看当前仓库的未提交改动，并说明各项改动的用途。',
    '查看最近 5 次提交，整理一份更新摘要。',
  ],
  computer: [
    '查看当前桌面截图，告诉我有哪些窗口和可操作的按钮。',
    '在当前应用中找到搜索框，输入我提供的关键词。',
  ],
  workflow: [
    '把这项任务拆成几个阶段，并记录每个阶段的进度。',
    '查看当前工作流的执行状态，列出还未完成的步骤。',
  ],
};

export function nativeRuntimeToolNames() {
  return [...new Set([...hiddenRuntimeToolCatalog().map((tool) => tool.name), ...Object.keys(runtimeBuiltinToolPrompts)])];
}

const capabilityToolNames = new Set(capabilityRuntimeToolCatalog().map((tool) => tool.name));

export function normalizeDisabledCapabilityTools(value: unknown) {
  return normalizeDisabledBrowserChatTools(value).filter((name) => capabilityToolNames.has(name));
}

export function browserChatCapabilityToolCatalog() {
  const tools = capabilityRuntimeToolCatalog();
  return [...new Map(tools.map((tool) => [tool.name, tool])).values()].map((tool) => ({
    name: tool.name, label: help[tool.name]?.[0] || tool.label, description: help[tool.name]?.[1] || tool.description,
    prompts: prompts[tool.name] || [],
    available: true,
  }));
}
