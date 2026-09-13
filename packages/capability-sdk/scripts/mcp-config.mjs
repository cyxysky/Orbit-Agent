import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

export const configFilename = 'capability.config.json';
const boolean = (defaultValue, description) => ({ type: 'boolean', default: defaultValue, description });
const integer = (defaultValue, minimum, maximum, description) => ({ type: 'integer', default: defaultValue, minimum, maximum, description });
const string = (defaultValue, description, values) => ({ type: 'string', default: defaultValue, description, ...(values ? { enum: values } : {}) });
const object = (description, properties) => ({ type: 'object', description, additionalProperties: false, properties });
const enabled = boolean(true, '是否注册该工具；false 时不加载模块，不向 MCP 客户端暴露此工具。修改后重启 MCP。');

// One catalog drives validation, JSON Schema, initialization and reference docs.
export const configSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Capability MCP configuration',
  ...object('按工具分组的本地 MCP 配置。省略字段使用默认值；文件中的显式值优先于环境变量。', {
    $schema: { type: 'string', description: '编辑器使用的本地 JSON Schema 路径，不影响运行。' },
    version: { type: 'integer', const: 1, default: 1, description: '配置格式版本，必须为 1。' },
    server: object('MCP 服务级配置。路径相对于 --project 选定的项目根目录。', {
      name: string('capability-sdk', '客户端显示的 MCP 服务名称。'),
      skillMode: string('eager', 'eager 在初始化时提供说明；lazy 增加 skill 工具按需读取说明。', ['eager', 'lazy']),
      stateDirectory: string('.capability-sdk/mcp', 'MCP 文件、知识库和工作区的存储目录。不会移动已安装的 Chromium/Python 等运行环境。'),
      visualization: object('chart/maps 的 MCP Apps 内嵌界面与本地浏览器预览。无需安装另一份前端。', {
        enabled: boolean(true, '是否提供可视化界面；false 时只返回原有工具数据。'),
        preview: boolean(true, '提供带随机访问令牌的 127.0.0.1 浏览器预览链接；链接在 MCP 进程退出后失效。'),
        port: integer(0, 0, 65535, '本地预览端口；0 自动分配，避免多个 agent 冲突。仅监听 127.0.0.1。'),
        readOnly: boolean(false, '禁止预览页面写回服务器；仍可临时编辑和导出，不改变 agent 调用 chart update 的权限。'),
        staticImages: boolean(true, '为二维 ECharts 生成 PNG 回填；其他引擎保留交互页面和文字/链接，避免自动启动额外浏览器。'),
      }),
    }),
    tools: object('只配置需要调整的字段，其余使用默认值。业务 Provider 仍可通过显式 .mjs 扩展。', {
      browser: object('一个 browser 工具，action 为 open/code/snapshot/close。配置共享于此 MCP 的浏览器会话。', {
        enabled,
        headless: boolean(true, 'true 隐藏浏览器窗口；false 显示窗口。覆盖 HEADLESS_BROWSER/BROWSER_HEADLESS。'),
        isolated: boolean(true, 'true 使用隔离会话与随包 Chromium，忽略外部 CDP 和用户配置目录。使用 cdpEndpoint/userDataDir 时必须设为 false。'),
        maxSessions: integer(8, 1, 100, '同时打开的 browser 会话上限；超过后 open 返回容量错误。复用固定用户配置目录时应设为 1。'),
        idleTimeoutMs: integer(900000, 0, 86400000, '会话空闲回收时间（毫秒）；0 禁用回收。执行中的调用不会因空闲超时被关闭。'),
        slowMoMs: integer(0, 0, 10000, '浏览器操作延迟（毫秒），用于观察操作过程；不等同于导航超时。'),
        viewport: object('控制网页 CSS 视口，而非截图像素尺寸。', {
          mode: string('auto', 'auto 按浏览器运行方式选择视口；fixed 使用下面的 width/height。', ['auto', 'fixed']),
          width: integer(1440, 1, 16384, 'fixed 模式的视口宽度（CSS 像素）。'),
          height: integer(900, 1, 16384, 'fixed 模式的视口高度（CSS 像素）。'),
        }),
        ignoreHTTPSErrors: boolean(false, '是否忽略 HTTPS 证书错误。仅在需要访问对应测试环境时开启。'),
        screenshotTimeoutMs: integer(15000, 1000, 120000, '单次截图超时（毫秒）。'),
        outputPixelRatio: { type: 'number', default: 1.5, minimum: 1, maximum: 2, description: '截图输出像素倍率，不改变网页 CSS 视口。' },
        domQuietMs: integer(250, 0, 60000, '导航后等待 DOM 连续稳定的时间窗口（毫秒）。'),
        domStabilityTimeoutMs: integer(1000, 0, 120000, '导航后等待 DOM 稳定的最长时间（毫秒）。'),
        executablePath: string('', '指定 Chromium 可执行文件；空字符串使用项目内已安装的 Chromium。相对路径按项目根目录解析。'),
        cdpEndpoint: string('', '连接已启动浏览器的 CDP 地址；需 isolated=false。不会自动安装或启动外部浏览器。'),
        userDataDir: string('', '持久化浏览器配置目录，保存登录态；需 isolated=false、maxSessions=1，且不与 cdpEndpoint 同时设置。相对路径按项目根目录解析。'),
      }),
      terminal: object('项目本地终端；以当前用户权限执行，不提供 OS 隔离。', {
        enabled, cwd: string('.', '终端工作目录，相对于项目根目录。'),
        shell: string('auto', 'auto 在 Windows 使用 PowerShell，Linux 使用 Bash；选择 pwsh 时需自行安装 PowerShell 7。', ['auto', 'powershell', 'pwsh', 'bash', 'sh']),
        timeoutMs: integer(120000, 1000, 3600000, '命令最长运行时间（毫秒），工具调用可请求更短时间。'),
        maxOutputChars: integer(50000, 1000, 500000, '每个进程的输出缓冲字符上限。'),
        maxProcesses: integer(4, 1, 16, '此 MCP 实例的终端并发进程上限。'),
      }),
      code: object('codeSandbox：本地 JavaScript/Python 执行与产物保存。临时工作区按执行器隔离。', {
        enabled,
        timeoutMs: integer(30000, 1000, 300000, '单次代码执行超时（毫秒）。'),
        installTimeoutMs: integer(120000, 5000, 300000, '依赖安装与执行共享的时间预算（毫秒）。'),
        maxOutputChars: integer(30000, 1000, 200000, 'stdout/stderr 合计字符上限；输出文件通过独立产物通道保存。'),
        maxConcurrent: integer(2, 1, 16, '本地代码执行器的并发任务上限。'),
        allowPackageInstall: boolean(true, '是否允许代码任务安装固定版本的 npm/Python 包。'),
        maxPackages: integer(16, 0, 32, '单次任务最多安装的依赖数量。'),
      }),
      file: object('文件读写、Office 生成和转换。visual QA 需要具备图像能力的宿主单独接入。', {
        enabled,
        officeGenerationMode: string('uno', 'uno 使用 LibreOffice；javascript 使用 ExcelJS/HTML 文档管线；auto 由现有文件工具选择。', ['uno', 'javascript', 'auto']),
      }),
      chart: object('图表创建、读取和更新；产物保存在 server.stateDirectory/artifacts/charts。', {
        enabled,
        retainedRevisions: integer(20, 1, 1000, '每张图表保留的历史修订数量。'),
      }),
      maps: object('可选 Google Maps 工具；show 无密钥可生成位置示意，搜索/路线需要服务端 Key，底图需要浏览器 Key。', {
        enabled: boolean(false, '是否启用 maps；默认不启用。'),
        browserKeyEnv: string('GOOGLE_MAPS_BROWSER_KEY', 'Maps JavaScript API 浏览器 Key 所在环境变量名；该 Key 会提供给页面，需限制网站来源。'),
        serverKeyEnv: string('GOOGLE_MAPS_SERVER_KEY', 'Places/Routes 服务端 Key 所在环境变量名；不会发送给预览页面。'),
        language: string('zh-CN', '地图语言，例如 zh-CN、en。'),
        searchMonthlyLimit: integer(4500,0,100000,'项目内每月搜索调用上限；0 停用搜索。'),
        routesMonthlyLimit: integer(9000,0,100000,'项目内每月路线调用上限；0 停用路线。'),
      }),
      knowledge: object('持久化参考资料知识库；保存在 server.stateDirectory/knowledge。', {
        enabled,
        chunkChars: integer(1800, 400, 8000, '全文索引每个分块的目标字符数。'),
        searchLimit: integer(8, 1, 30, '知识检索默认返回条数。'),
      }),
      media: object('默认实现本地媒体检查和视频抽帧；OCR/转写/生成需业务 Provider，不会自动接入模型。', {
        enabled,
        timeoutMs: integer(120000, 1000, 900000, 'FFmpeg 处理超时（毫秒）；媒体头检查最长 15 秒。'),
        maxFrames: integer(12, 1, 60, '每次抽帧最多生成的帧数。'),
      }),
      computer: object('Windows 内置桌面驱动，或自行配置的远程驱动。其他平台无 endpoint 时默认不注册。', {
        enabled: { ...enabled, description: '默认自动判断平台：Windows 或配置 endpoint 时启用。显式 false 禁用；不支持的平台显式 true 会报错。' },
        endpoint: string('', '外部桌面驱动地址；空字符串在 Windows 使用内置驱动。'),
        authorizationEnv: string('', '包含外部驱动 Authorization 值的环境变量名称；不在 JSON 中保存密钥。'),
        timeoutMs: integer(30000, 1000, 300000, '单次桌面操作超时（毫秒）。'),
      }),
    }),
  }),
};

function validate(value, schema, location) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${location} must be an object.`);
    for (const [key, entry] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`Unknown configuration: ${location}.${key}`);
      validate(entry, schema.properties[key], `${location}.${key}`);
    }
  } else {
    if (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type) throw new Error(`${location} must be ${schema.type}.`);
    if (schema.const !== undefined && value !== schema.const) throw new Error(`${location} must be ${schema.const}.`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${location} must be one of: ${schema.enum.join(', ')}.`);
    if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) throw new Error(`${location} must be between ${schema.minimum} and ${schema.maximum}.`);
  }
}

export function defaultsFor(schema = configSchema) {
  if (schema.type !== 'object') return schema.default;
  return Object.fromEntries(Object.entries(schema.properties).filter(([key]) => key !== '$schema').map(([key, field]) => [key, defaultsFor(field)]));
}

export async function loadConfig(projectRoot, filename) {
  const target = path.resolve(projectRoot, filename || configFilename);
  try {
    const value = JSON.parse((await readFile(target, 'utf8')).replace(/^\uFEFF/, ''));
    validate(value, configSchema, 'config');
    const browser = value.tools?.browser;
    if (browser?.cdpEndpoint && browser?.userDataDir) throw new Error('browser.cdpEndpoint and browser.userDataDir are mutually exclusive.');
    if ((browser?.cdpEndpoint || browser?.userDataDir) && browser.isolated !== false) throw new Error('browser.cdpEndpoint/userDataDir requires isolated=false.');
    if (browser?.userDataDir && browser.maxSessions !== 1) throw new Error('browser.userDataDir requires maxSessions=1 to avoid profile locks.');
    return { value, filename: target };
  } catch (error) {
    if (!filename && error.code === 'ENOENT') return { value: {}, filename: undefined };
    throw new Error(`Invalid MCP configuration ${target}: ${error.message}`);
  }
}

export async function initConfig(projectRoot) {
  const value = defaultsFor();
  // Preserve automatic platform selection in a cross-platform checked-in file.
  delete value.tools.computer.enabled;
  const filename = path.join(projectRoot, configFilename);
  try {
    await writeFile(filename, JSON.stringify({ $schema: './node_modules/@cjfclonedeep/capability-sdk/mcp-config.schema.json', ...value }, null, 2) + '\n', { flag: 'wx' });
    console.error(`Created ${filename}`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await loadConfig(projectRoot);
    console.error(`Kept existing ${filename}`);
  }
}

export const toolConfigurationKeys = {
  browser: { 'viewport.mode': 'BROWSER_VIEWPORT_MODE', 'viewport.width': 'BROWSER_VIEWPORT_WIDTH', 'viewport.height': 'BROWSER_VIEWPORT_HEIGHT',
    ignoreHTTPSErrors: 'BROWSER_IGNORE_HTTPS_ERRORS', screenshotTimeoutMs: 'SCREENSHOT_TIMEOUT_MS', outputPixelRatio: 'BROWSER_OUTPUT_PIXEL_RATIO',
    domQuietMs: 'BROWSER_NAVIGATION_DOM_QUIET_MS', domStabilityTimeoutMs: 'BROWSER_NAVIGATION_DOM_STABILITY_TIMEOUT_MS',
    executablePath: 'AI_WEB_TEST_CHROMIUM_EXECUTABLE_PATH', cdpEndpoint: 'BROWSER_CDP_ENDPOINT', userDataDir: 'BROWSER_USER_DATA_DIR' },
  terminal: { enabled: 'AGENT_TERMINAL_ENABLED', shell: 'AGENT_TERMINAL_SHELL', timeoutMs: 'AGENT_TERMINAL_TIMEOUT_MS', maxOutputChars: 'AGENT_TERMINAL_MAX_OUTPUT_CHARS', maxProcesses: 'AGENT_TERMINAL_MAX_PROCESSES' },
  code: { enabled: 'AGENT_CODE_SANDBOX_ENABLED', timeoutMs: 'AGENT_CODE_SANDBOX_TIMEOUT_MS', installTimeoutMs: 'AGENT_CODE_SANDBOX_INSTALL_TIMEOUT_MS', maxOutputChars: 'AGENT_CODE_SANDBOX_MAX_OUTPUT_CHARS', maxConcurrent: 'AGENT_CODE_SANDBOX_MAX_CONCURRENCY', allowPackageInstall: 'AGENT_CODE_SANDBOX_ALLOW_PACKAGE_INSTALL', maxPackages: 'AGENT_CODE_SANDBOX_MAX_PACKAGES' },
  file: { officeGenerationMode: 'OFFICE_GENERATION_MODE' },
  knowledge: { chunkChars: 'AGENT_KNOWLEDGE_CHUNK_CHARS', searchLimit: 'AGENT_KNOWLEDGE_SEARCH_LIMIT' },
  media: { timeoutMs: 'AGENT_MEDIA_TIMEOUT_MS', maxFrames: 'AGENT_MEDIA_MAX_FRAMES' },
  computer: { enabled: 'AGENT_COMPUTER_ENABLED', endpoint: 'AGENT_COMPUTER_ENDPOINT', timeoutMs: 'AGENT_COMPUTER_TIMEOUT_MS' },
};

export function toolConfiguration(config, group, projectRoot) {
  const values = config.tools?.[group] || {};
  const result = {};
  for (const [key, target] of Object.entries(toolConfigurationKeys[group] || {})) {
    let value = key.split('.').reduce((part, segment) => part?.[segment], values);
    if (value === undefined) continue;
    if (group === 'browser' && ['executablePath', 'userDataDir'].includes(key) && value) value = path.resolve(projectRoot, value);
    result[target] = String(value);
  }
  if (group === 'computer' && values.authorizationEnv) {
    const secret = process.env[values.authorizationEnv];
    if (!secret) throw new Error(`Missing environment variable named by tools.computer.authorizationEnv: ${values.authorizationEnv}`);
    result.AGENT_COMPUTER_AUTHORIZATION = secret;
  }
  if (group === 'maps') {
    for (const [setting, field] of [['GOOGLE_MAPS_BROWSER_KEY','browserKeyEnv'],['GOOGLE_MAPS_SERVER_KEY','serverKeyEnv']]) {
      if (values[field]) result[setting] = process.env[values[field]] || '';
    }
    for (const [setting, field] of [['GOOGLE_MAPS_LANGUAGE','language'],['GOOGLE_MAPS_SEARCH_MONTHLY_LIMIT','searchMonthlyLimit'],['GOOGLE_MAPS_ROUTES_MONTHLY_LIMIT','routesMonthlyLimit']]) {
      if (values[field] !== undefined) result[setting] = String(values[field]);
    }
  }
  if (group === 'browser' && values.viewport?.mode === 'fixed') {
    result.BROWSER_VIEWPORT_WIDTH ??= process.env.BROWSER_VIEWPORT_WIDTH || '1440';
    result.BROWSER_VIEWPORT_HEIGHT ??= process.env.BROWSER_VIEWPORT_HEIGHT || '900';
  }
  return result;
}
