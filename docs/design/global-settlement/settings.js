(() => {
  const pages = window.OrbitPages = window.OrbitPages || {};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const input = (label, value = '', type = 'text', hint = '') => `<label class="field"><span>${label}</span><input type="${type}" value="${esc(value)}"${type === 'number' ? ' min="0" step="any"' : ''}${type === 'password' ? ' autocomplete="new-password"' : ''}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  const select = (label, options, selected) => `<label class="field"><span>${label}</span><select>${options.map(option => `<option${option === selected ? ' selected' : ''}>${option}</option>`).join('')}</select></label>`;
  const textarea = (label, value, hint = '') => `<label class="field settings-textarea"><span>${label}</span><textarea rows="4">${esc(value)}</textarea>${hint ? `<small>${hint}</small>` : ''}</label>`;
  const form = body => `<div class="form-grid">${body}</div>`;
  const tag = (label, tone = '') => `<span class="pill ${tone ? `pill-${tone}` : ''}">${label}</span>`;
  const section = (title, description, content, extra = '') => ({ title, description, content, extra });
  const facts = entries => `<dl class="settings-facts">${entries.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
  const navLink = (ctx, title, target) => ctx.button(title, `data-page="${target}"`);
  const actions = (ctx, singular, overlay) => `<div class="settings-actions">${ctx.button('编辑', `data-overlay="${overlay}" aria-label="编辑${singular}"`)}${ctx.button('删除', `data-overlay="delete" data-delete-name="${singular}" aria-label="删除${singular}"`)}</div>`;
  const filter = (label, selector) => `<label class="field settings-search"><span class="settings-sr-only">${label}</span><input type="search" aria-label="${label}" placeholder="${label}" data-filter="${selector}"></label>`;
  const toolbar = (ctx, label, selector, primaryLabel, overlay) => `<div class="settings-table-toolbar">${filter(label, selector)}<div class="settings-actions">${ctx.button('导入', 'data-overlay="import"')}${ctx.button('导出', 'data-overlay="export"')}${ctx.button(primaryLabel, `data-overlay="${overlay}"`, 'primary')}</div></div>`;
  const table = (id, headers, rows) => `<div class="table-wrap"><table class="data-table settings-table" id="${id}"><thead><tr>${headers.map(item => `<th scope="col">${item}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr data-searchable>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  function layout(ctx, description, sections, context, options = {}) {
    const variant = ['a', 'b', 'c'].includes(ctx.variant) ? ctx.variant : 'a';
    const chapters = sections.map(item => `<section class="settings-chapter"><header class="settings-chapter-head"><div><h2>${item.title}</h2>${item.description ? `<p>${item.description}</p>` : ''}</div>${item.extra}</header><div class="settings-chapter-body">${item.content}</div></section>`).join('');
    return `<div class="settings-view settings-layout-${variant}${options.management ? ' settings-management' : ''}">
      <div class="settings-intro"><p>${description}</p><div class="settings-actions">${options.actions || ''}${options.management ? '' : '<span class="settings-autosave"><span aria-hidden="true"></span>更改自动保存</span>'}</div></div>
      <div class="settings-layout"><div class="settings-main">${chapters}</div><aside class="settings-context" aria-label="相关说明">${context}</aside></div>
    </div>`;
  }

  function contextCard(title, body, dark = false) {
    return `<section class="settings-context-block${dark ? ' settings-context-dark' : ''}"><h2>${title}</h2>${body}</section>`;
  }

  pages.general = {
    title: '通用设置', group: 'settings',
    render(ctx) {
      return layout(ctx, '调整工作空间的品牌、语言与显示偏好。', [
        section('工作空间', '这些名称将显示在导航栏和工作空间入口。', form(input('品牌前缀', 'Orbit') + input('产品名称', '工作空间'))),
        section('语言与外观', '选择适合日常工作的显示方式。', form(select('界面语言', ['简体中文', 'English'], '简体中文') + select('主题模式', ['浅色', '深色', '跟随系统'], '浅色')) + `<div class="settings-color-row"><div><strong>主题色</strong><p>用于选中状态和主要操作。</p></div><label class="settings-color-control"><span class="settings-sr-only">主题色</span><input type="color" value="#c4f95d"><span>#C4F95D</span></label></div>`),
        section('访问管理', '管理员配置按当前工作空间独立保护。', `<div class="setting-row"><div><strong>管理员设置验证</strong><p class="muted">管理模型连接、运行参数与能力配置的访问权限。</p></div>${ctx.button('管理访问', 'data-overlay="admin-access"')}</div>`)
      ], contextCard('让界面更熟悉', `<div class="settings-brand-preview"><span class="settings-orbit-mark" aria-hidden="true"></span><strong>Orbit</strong><span>工作空间</span></div><p>品牌名称用于区分工作空间，不会改变你的账号或已有任务。</p>`) + contextCard('继续配置', `<div class="settings-context-links">${navLink(ctx, '选择默认模型', 'model')}${navLink(ctx, '配置浏览器', 'browser')}${navLink(ctx, '管理登录账号', 'accounts')}</div>`, true));
    }
  };

  const providers = [
    { id: 'openai', name: 'OpenAI', api: 'https://api.example.com/openai/v1', models: ['gpt-5.5', 'gpt-5.4-mini'], image: 'gpt-image-1.5', audio: 'gpt-4o-mini-tts' },
    { id: 'anthropic', name: 'Anthropic', api: 'https://api.example.com/anthropic', models: ['claude-sonnet-4-5', 'claude-opus-4-1'] },
    { id: 'compatible', name: '兼容接口', api: 'https://gateway.example.com/v1', models: ['team-reasoning', 'team-fast'], image: 'team-image', audio: 'team-speech' },
    { id: 'local', name: '本地服务', api: 'http://localhost:11434/v1', models: ['llama3.1', 'qwen3-vl-2b-instruct'] }
  ];

  function modelType(ctx, provider, type, name, models) {
    const id = `model-${provider.id}-${type}`;
    return `<div data-local-panel="${id}"${type === 'text' ? '' : ' hidden'}><div class="settings-model-type-head">${ctx.switchRow(`启用${name}模型`, `允许在任务中使用此供应商的${name}能力。`, true)}</div>${form(select('默认模型', models, models[0]) + input('接口路径', type === 'text' ? '/responses' : type === 'image' ? '/images/generations' : '/audio/speech'))}<div class="settings-subheading"><h3>模型列表</h3>${ctx.button('添加模型', 'data-demo="添加模型"')}</div>${models.map((model, i) => `<div class="settings-model-row"><label class="field"><span class="settings-sr-only">${name}模型 ${i + 1}</span><input aria-label="${name}模型 ${i + 1}" value="${model}"></label>${i === 0 ? tag('默认') : ''}${ctx.button('能力配置', 'data-overlay="model-capabilities"')}${ctx.button('移除', 'data-overlay="delete"')}</div>`).join('')}<details class="settings-details"><summary>请求参数</summary>${form(input('最大输出 Token', type === 'text' ? '16384' : '4096', 'number') + input('请求超时（秒）', '120', 'number'))}${textarea('附加请求参数', '{}', '使用 JSON 对象传入供应商支持的参数。')}</details></div>`;
  }

  function providerPanel(ctx, provider, index) {
    const types = [['text', '文本', provider.models], ...(provider.image ? [['image', '图像', [provider.image]]] : []), ...(provider.audio ? [['audio', '语音', [provider.audio]]] : [])];
    return `<div data-local-panel="provider-${provider.id}"${index ? ' hidden' : ''}><div class="settings-provider-head"><div><h3>${provider.name}</h3><p>为不同类型的模型分别设置连接和能力。</p></div>${tag(index === 0 ? '默认供应商' : '可配置')}</div>${form(input('API Key', '', 'password', provider.id === 'local' ? '本地服务未开启认证时可留空。' : '留空保留已配置的密钥。') + input('服务地址', provider.api))}<div class="settings-inline-actions">${ctx.button('检查连接', 'data-demo="检查模型连接"')}${ctx.button('设为默认供应商', 'data-demo="设置默认供应商"')}</div><div data-tab-group class="settings-model-types"><div class="tabs" role="tablist" aria-label="${provider.name} 模型类型">${types.map(([id, label], i) => `<button type="button" class="tab${i === 0 ? ' active' : ''}" role="tab" aria-selected="${i === 0}" data-local-tab="model-${provider.id}-${id}">${label}</button>`).join('')}</div>${types.map(([id, label, models]) => modelType(ctx, provider, id, label, models)).join('')}</div></div>`;
  }

  pages.model = {
    title: '模型配置', group: 'settings',
    render(ctx) {
      return layout(ctx, '管理模型供应商、服务连接和每类任务使用的默认模型。', [
        section('模型供应商', '先选择供应商，再配置其模型类型。', `<div data-tab-group><div class="tabs settings-provider-tabs" role="tablist" aria-label="模型供应商">${providers.map((provider, i) => `<button type="button" class="tab${i === 0 ? ' active' : ''}" role="tab" aria-selected="${i === 0}" data-local-tab="provider-${provider.id}">${provider.name}</button>`).join('')}</div>${providers.map((provider, index) => providerPanel(ctx, provider, index)).join('')}</div>`),
        section('默认选择', '新对话从这里选择模型，已有对话保留原来的选择。', form(select('默认供应商', providers.map(p => p.name), 'OpenAI') + select('默认文本模型', ['gpt-5.5', 'gpt-5.4-mini'], 'gpt-5.5')))
      ], contextCard('当前默认模型', `<strong class="settings-context-value">gpt-5.5</strong><p>OpenAI · 文本任务</p>${facts([['模型类型', '文本、图像输入'], ['上下文窗口', '256,000 Token'], ['输出上限', '16,384 Token']])}${ctx.button('查看模型能力', 'data-overlay="model-capabilities"')}`, true) + contextCard('配置提示', '<p>模型能力决定图片输入、工具调用和推理参数是否可用。修改模型名称后，请同步检查能力配置。</p><p>每种模型类型保留独立的默认模型与请求参数。</p>'), { actions: ctx.button('导入配置', 'data-overlay="import"') + ctx.button('导出配置', 'data-overlay="export"') });
    }
  };

  pages.runtime = {
    title: '运行配置', group: 'settings',
    render(ctx) {
      return layout(ctx, '控制推理、上下文和任务执行资源。修改后的运行参数用于后续请求。', [
        section('推理与执行', '让推理深度与任务规模相匹配。', form(select('AI 推理强度', ['提供商默认', '低', '中', '高', '最高'], '提供商默认') + input('子 Agent 全局并发数', '20', 'number', '超过上限的任务进入队列。') + input('Agent 执行超时（秒）', '600', 'number') + input('连续请求失败上限', '3', 'number'))),
        section('上下文管理', '为当前任务保留必要的请求、交互与工具结果。', form(input('默认上下文窗口（Token）', '256000', 'number', '模型已配置上下文窗口时，优先使用模型配置。') + input('单张图片估算 Token', '1200', 'number') + input('压缩触发比例', '0.85', 'number', '相对于当前模型可用输入预算。') + input('压缩后建议比例', '0.25', 'number', '目标比例应低于触发比例。'))),
        section('请求与工具超时', '模型响应与工具执行分别计时。', form(input('AI 请求超时（秒）', '120', 'number') + input('Agent 模型请求超时（秒）', '600', 'number') + input('Agent 首包等待时间（秒）', '180', 'number') + input('工具执行超时（秒）', '120', 'number'))),
        section('个性化记忆策略', '按任务相关性召回，保留可复用的使用偏好与业务上下文。', ctx.switchRow('个性化记忆召回', '在相关任务中读取已启用的用户和域名记忆。', true) + ctx.switchRow('个性化记忆提炼', '对话结束后提取候选信息，经确认后进入长期记忆。', true) + form(input('单轮注入条数', '6', 'number') + input('单轮注入字符预算', '12000', 'number') + input('记忆提取并发数', '2', 'number') + input('记忆提取队列上限', '100', 'number'))),
        section('系统规则与维护', '在内置执行规则基础上追加工作要求。', textarea('附加系统规则', '输出结论时附上来源；修改文件前先确认目标路径。', '附加规则不会替换内置执行规则。') + ctx.switchRow('AI 运行指标', '记录请求耗时、首包延迟、Token 用量与工具耗时。', true) + ctx.switchRow('SQLite 自动压缩', '空闲页满足条件时执行数据库维护。', true) + form(input('压缩空闲比例', '0.3', 'number') + input('压缩最小空闲页', '1024', 'number')))
      ], contextCard('上下文预算', `<strong class="settings-context-value">256,000 <small>Token</small></strong><p>默认窗口</p><div class="settings-budget-track" aria-label="85% 为压缩触发阈值"><span></span></div>${facts([['触发压缩', '85%'], ['压缩后目标', '25%'], ['单张图片估算', '1,200 Token']])}`, true) + contextCard('记忆管理', `<p>查看已保存的记忆、适用范围与来源依据，或手动新增一条工作偏好。</p>${navLink(ctx, '管理记忆', 'memory')}`));
    }
  };

  pages.knowledge = {
    title: '知识库', group: 'settings',
    render(ctx) {
      const packages = [
        ['项目交付手册', 'project-delivery', '交付检查点、周报规则与文件归档约定。', '1.4.2', '138', 'project.example.com', '今天 09:42'],
        ['团队文档规范', 'team-writing', '项目纪要、引用格式和文档修订说明。', '2.1.0', '76', 'docs.example.com', '10 月 31 日 16:20'],
        ['历史项目资料索引', 'project-archive', '历史项目的资料目录、缩写和来源定位。', '1.0.3', '214', 'archive.example.com', '10 月 28 日 11:07']
      ];
      const body = packages.map((pack, i) => `<article class="settings-package" data-searchable><div class="settings-package-title"><div><h3>${pack[0]}</h3><p>${pack[2]}</p></div>${tag(i === 2 ? '已停用' : '已启用', i === 2 ? '' : 'success')}</div>${facts([['包 ID', `<code>${pack[1]}</code>`], ['版本', pack[3]], ['记录', `${pack[4]} 条`], ['导入时间', pack[6]]])}<div class="settings-package-footer"><span class="muted">${pack[5]}</span><div class="settings-actions">${ctx.button(i === 2 ? '启用' : '停用', `data-demo="${i === 2 ? '启用' : '停用'}知识包"`)}${ctx.button('删除', 'data-overlay="delete"')}</div></div></article>`).join('');
      return layout(ctx, '导入有来源的业务规则和手册，让 Agent 在相关任务中按需读取。', [
        section('导入知识包', '支持 ZIP、RAR。相同包 ID 的新版本将替换现有内容。', `<div class="settings-import-area"><div class="settings-import-copy"><h3>把团队知识带入工作空间</h3><p>使用模板准备清单、正文、来源与检索索引。</p><div class="settings-actions">${ctx.button('导入知识包', 'data-overlay="knowledge-import"', 'primary')}${ctx.button('下载导入模板', 'data-demo="下载知识包模板"')}</div></div><div class="settings-import-format" aria-label="知识包格式">ZIP<span>或 RAR</span></div></div>`),
        section('已导入的知识包', '3 个知识包 · 2 个已启用', `<div class="settings-table-toolbar">${filter('搜索知识包名称、包 ID 或域名', '.settings-package')}${ctx.button('刷新列表', 'data-demo="刷新知识包列表"')}</div><div class="settings-packages">${body}</div>`)
      ], contextCard('知识包包含什么', '<ol class="settings-explainer-list"><li><strong>清单</strong><span>标识知识包、版本与适用域名。</span></li><li><strong>知识正文</strong><span>保留字段定义、规则和上下文。</span></li><li><strong>来源与索引</strong><span>通过标题、别名和关键词找到原文。</span></li></ol>') + contextCard('按来源使用知识', '<p>检索摘要用于定位资料。涉及业务结论时，再读取完整来源并结合当前页面事实。</p><p>导入只读取内容与索引，包内脚本不会执行。</p>', true), { management: true });
    }
  };

  pages.browser = {
    title: '浏览器配置', group: 'settings',
    render(ctx) {
      return layout(ctx, '配置任务使用的浏览器实例、观察方式和实时预览。', [
        section('浏览器实例', '为自动化任务保留独立的浏览环境。', form(select('浏览器类型', ['内置浏览器', '系统 Chrome', '系统 Edge'], '内置浏览器') + select('运行方式', ['显示浏览器窗口', '后台运行'], '显示浏览器窗口') + input('用户数据目录', './data/browser-profiles') + input('默认站点', 'https://project.example.com')) + ctx.switchRow('复用浏览器会话', '同一工作空间内保留已打开的页面与登录状态。', true)),
        section('浏览器观察', '选择 Agent 理解和操作页面的方式。', form(select('Browser Chat 操作模式', ['混合模式', 'DOM 模式', '纯视觉', 'Playwright MCP'], '混合模式') + select('截图质量', ['标准', '高清'], '标准')) + `<p class="settings-help">混合模式同时提供页面结构与截图，支持定位器和鼠标键盘操作。</p>`),
        section('视口与实时预览', '预览和执行共用同一个浏览器会话。', form(input('视口宽度（px）', '1440', 'number') + input('视口高度（px）', '900', 'number')) + ctx.switchRow('实时浏览器预览', '在任务执行过程中展示当前页面，并允许接管操作。', true) + ctx.switchRow('自动跟随当前页签', 'Agent 切换页签时同步预览中的活动页面。', true)),
        section('调试与恢复', '在需要定位页面问题时开启额外记录。', ctx.switchRow('保留浏览器调试信息', '记录页面加载和操作失败信息。', false) + `<div class="settings-inline-actions">${ctx.button('打开浏览器库', 'data-page="browser-library"')}${ctx.button('检查浏览器连接', 'data-demo="检查浏览器连接"')}${ctx.button('重置当前实例', 'data-overlay="delete"')}</div>`)
      ], contextCard('实例预览', `<div class="settings-mini-browser"><div class="settings-mini-address">project.example.com</div><div class="settings-mini-content"><strong>项目工作台</strong><p>本周交付计划</p><div class="settings-mini-item"><span>整理项目周报</span>${tag('进行中')}</div><div class="settings-mini-item"><span>归档参考资料</span>${tag('已完成')}</div></div></div><p>视口 1440 × 900 · 混合模式</p>`) + contextCard('需要登录', `<p>在账号管理中维护站点凭据，任务可在指定站点按需使用。</p>${navLink(ctx, '管理登录账号', 'accounts')}`, true));
    }
  };

  pages.capabilities = {
    title: '能力配置', group: 'settings',
    render(ctx) {
      return layout(ctx, '按工作需要启用工具能力，并管理各项能力的执行范围。', [
        section('代码与终端', '运行脚本、处理数据与执行工作区命令。', ctx.switchRow('代码沙箱', '在隔离环境中运行代码和数据处理任务。', true) + ctx.switchRow('终端执行', '允许 Agent 使用工作区终端执行命令。', true) + form(input('默认工作目录', './workspace') + input('命令超时（秒）', '120', 'number') + input('单次输出字符上限', '26000', 'number') + select('Codex 沙箱模式', ['工作区可写', '只读', '完全访问'], '工作区可写'))),
        section('文件与文档', '读取、生成和整理任务中的文件。', ctx.switchRow('文件读写', '访问允许目录中的文件与附件。', true) + ctx.switchRow('Office 文档处理', '生成与转换文档、表格和演示文件。', true) + form(input('允许访问的根目录', './workspace, ./outputs') + input('产物输出目录', './outputs'))),
        section('桌面操作', '使用截图、鼠标和键盘操作本机应用。', ctx.switchRow('桌面控制', '为需要本机应用的任务提供桌面操作能力。', false) + form(select('默认显示器', ['主显示器', '显示器 2'], '主显示器') + input('操作间隔（毫秒）', '150', 'number'))),
        section('连接器', '连接团队使用的知识和业务服务。', `<div class="settings-connector"><div><strong>项目文档</strong><p>docs.example.com · 文档检索与读取</p></div>${tag('已配置', 'success')}${ctx.button('管理连接', 'data-overlay="integration"')}</div><div class="settings-connector"><div><strong>团队资料库</strong><p>files.example.com · 文件读取与目录浏览</p></div>${tag('待配置')}${ctx.button('配置连接', 'data-overlay="integration"')}</div><div class="settings-inline-actions">${ctx.button('添加连接器', 'data-overlay="integration"')}</div>`),
        section('通信', '将工作产物交付到已配置的团队渠道。', ctx.switchRow('团队通信', '启用消息、文件和卡片发送能力。', false) + form(select('默认通信渠道', ['未设置', '团队消息', '邮件'], '未设置') + input('默认接收目标', '', 'text', '可在具体任务中另外指定。')) + ctx.button('配置通信集成', 'data-overlay="integration"')),
        section('数据与可视化', '查询结构化数据，并生成图表和地图产物。', ctx.switchRow('结构化数据处理', '读取表格、查询数据和进行聚合分析。', true) + ctx.switchRow('图表生成', '根据任务数据生成图表与可导出产物。', true) + ctx.switchRow('地图能力', '搜索地点、规划线路和展示地理数据。', false) + form(input('单次查询行数上限', '10000', 'number') + select('默认图表导出格式', ['PNG', 'SVG', 'PDF'], 'PNG')))
      ], contextCard('能力与任务', '<p>已启用的能力会出现在任务可调用的工具中。连接配置、目录和输出预算共同决定工具的工作范围。</p>', true) + contextCard('相关配置', `<div class="settings-context-links">${navLink(ctx, '浏览器与预览', 'browser')}${navLink(ctx, '敏感数据过滤', 'sensitive')}${navLink(ctx, '运行超时与并发', 'runtime')}</div>`));
    }
  };

  pages.sensitive = {
    title: '敏感数据', group: 'settings',
    render(ctx) {
      const evaluations = [['邮箱识别', 'contact@example.com', '邮箱', '已配置'], ['手机号识别', '13800000000', '手机号', '已配置'], ['自定义项目代号', '项目 ORBIT-DEMO', '自定义标签', '待评测']];
      return layout(ctx, '配置本地敏感信息识别、过滤规则与评测用例。', [
        section('过滤策略', '在内容发送给模型前，按已启用的规则识别敏感信息。', ctx.switchRow('敏感数据过滤', '对进入模型上下文的文本进行本地识别与替换。', true) + form(select('过滤方式', ['替换为类型占位符', '部分遮盖'], '替换为类型占位符') + input('识别置信度阈值', '0.70', 'number')) + `<fieldset class="settings-checks"><legend>识别类型</legend>${['姓名', '手机号', '邮箱', '证件号码', '银行卡号', '地址'].map(label => `<label><input type="checkbox" checked> ${label}</label>`).join('')}</fieldset>`),
        section('本地脱敏组件', '识别模型在当前运行环境中执行。', form(select('识别模型', ['GLiNER', 'Liquid PII'], 'GLiNER') + select('运行设备', ['自动选择', 'CPU', 'GPU'], '自动选择')) + textarea('自定义识别标签', '项目代号\n内部系统名称', '每行一个标签，用于补充通用识别类型。') + `<div class="settings-inline-actions">${tag('组件可用', 'success')}${ctx.button('检查组件', 'data-demo="检查脱敏组件"')}</div>`),
        section('敏感数据过滤测试', '输入文本，检查识别范围与替换后的内容。', textarea('待检测文本', '请联系林知夏：contact@example.com，手机号为 13800000000。') + `<div class="settings-inline-actions">${ctx.button('运行过滤测试', 'data-demo="运行敏感数据过滤测试"', 'primary')}</div><div class="settings-filter-output"><h3>过滤结果</h3><p>运行后将在这里显示识别项与处理后的文本。</p></div>`),
        section('脱敏评测集', '使用固定用例检查规则和模型调整的影响。', `<div class="settings-table-toolbar">${filter('搜索评测用例', '#settings-evaluations tbody tr')}<div class="settings-actions">${ctx.button('添加用例', 'data-demo="添加脱敏评测用例"')}${ctx.button('运行评测', 'data-demo="运行脱敏评测"')}</div></div>${table('settings-evaluations', ['用例', '输入内容', '预期类型', '状态', '操作'], evaluations.map(row => [...row.slice(0, 3), tag(row[3]), ctx.button('删除', 'data-overlay="delete"')]))}`)
      ], contextCard('先检测，再核对', '<p>不同模型对自然语言的识别范围存在差异。调整阈值或标签后，用评测集检查误识别与漏识别。</p>', true) + contextCard('当前策略', facts([['过滤状态', '已启用'], ['替换方式', '类型占位符'], ['通用类型', '6 类'], ['自定义标签', '2 项']])));
    }
  };

  pages.skills = {
    title: '技能管理', group: 'resources',
    render(ctx) {
      const rows = [
        [`<strong>项目周报整理</strong><small>汇总执行记录，生成摘要和待办清单。</small>`, '所有 ID 共享', '周报、执行记录', tag('可用', 'success'), '今天 09:18', actions(ctx, '项目周报整理', 'skill')],
        [`<strong>资料归档</strong><small>按照项目、日期和文件类型整理资料。</small>`, '仅创建 ID', '归档、整理附件', tag('可用', 'success'), '昨天 16:42', actions(ctx, '资料归档', 'skill')],
        [`<strong>交付前检查</strong><small>检查产物完整性与来源引用。</small>`, '所有 ID 共享', '交付检查', tag('草稿', 'warning'), '10 月 30 日 11:06', actions(ctx, '交付前检查', 'skill')],
        [`<strong>旧版文档转换</strong><small>转换历史模板并保留原文件。</small>`, '仅创建 ID', '旧文档、转换', tag('停用'), '10 月 27 日 15:35', actions(ctx, '旧版文档转换', 'skill')]
      ];
      return layout(ctx, '将常用方法整理成可重复使用的技能，在相关任务中按需调用。', [
        section('工作空间技能', '4 个技能 · 2 个可用 · 1 个草稿', toolbar(ctx, '搜索技能名称、描述或触发词', '#settings-skills tbody tr', '新建技能', 'skill') + table('settings-skills', ['技能', '共享范围', '触发词', '状态', '最近更新', '操作'], rows)),
        section('技能如何参与任务', '先匹配任务，再读取完整说明。', `<div class="settings-flow"><div><strong>识别任务</strong><p>从技能名称、说明与触发词中定位相关方法。</p></div><div><strong>读取说明</strong><p>按技能定义的步骤和输入要求执行工作。</p></div><div><strong>保留产物</strong><p>将任务生成的文件和执行记录留在当前对话。</p></div></div>`)
      ], contextCard('项目周报整理', `<p>读取本周执行记录，汇总完成项、风险与后续行动。</p>${facts([['触发词', '周报、执行记录'], ['共享范围', '所有 ID 共享'], ['创建者', '林知夏']])}<div class="settings-context-links">${ctx.button('查看技能', 'data-overlay="skill"')}${navLink(ctx, '在新对话中使用', 'new-chat')}</div>`, true), { management: true });
    }
  };

  pages.memory = {
    title: '个性化记忆', group: 'resources',
    render(ctx) {
      const rows = [
        [`<strong>项目周报</strong><small>按完成项、风险、下周计划三个部分组织。</small><details class="settings-inline-details"><summary>依据与记录</summary><p>林知夏于 11 月 2 日确认的写作偏好，适用于项目周报任务。</p></details>`, '使用偏好', '全局', tag('启用', 'success'), '昨天 17:08', actions(ctx, '项目周报记忆', 'memory')],
        [`<strong>项目工作台</strong><small>“项目台”指 project.example.com。</small><details class="settings-inline-details"><summary>依据与记录</summary><p>来自用户明确提供的站点别名，按相关任务召回。</p></details>`, '短语别名', '全局', tag('启用', 'success'), '昨天 10:32', actions(ctx, '项目工作台记忆', 'memory')],
        [`<strong>交付资料归档</strong><small>使用项目名称和日期建立文件目录。</small><details class="settings-inline-details"><summary>依据与记录</summary><p>归档任务中确认的文件组织流程。</p></details>`, '工作流程', 'files.example.com', tag('启用', 'success'), '10 月 31 日 16:20', actions(ctx, '交付资料归档记忆', 'memory')],
        [`<strong>历史周报模板</strong><small>保留旧版两段式周报结构供查阅。</small><details class="settings-inline-details"><summary>依据与记录</summary><p>已被新写作偏好替代，当前不参与召回。</p></details>`, '使用偏好', '全局', tag('禁用'), '10 月 28 日 14:15', actions(ctx, '历史周报模板记忆', 'memory')]
      ];
      return layout(ctx, '管理 Agent 可以记住的偏好、别名和工作流程，并保留每条记忆的依据。', [
        section('长期记忆', '4 条记忆 · 3 条启用', toolbar(ctx, '搜索短语、说明或域名', '#settings-memories tbody tr', '新增记忆', 'memory') + table('settings-memories', ['记忆', '类型', '适用范围', '状态', '最近更新', '操作'], rows)),
        section('记忆召回', '相关性、状态与作用域共同决定记忆是否进入当前任务。', ctx.switchRow('启用个性化记忆召回', '只召回已启用且适合当前任务的记忆。', true) + `<div class="settings-inline-actions">${navLink(ctx, '配置提炼与注入预算', 'runtime')}${ctx.button('提炼最近对话', 'data-demo="提炼最近对话记忆"')}</div>`)
      ], contextCard('记忆要有依据', '<p>保留你明确表达的偏好与已确认的信息。对于含义变化的条目，可以编辑说明或暂时停用。</p><p>全局记忆适用于不同站点；域名记忆只在对应站点的相关任务中使用。</p>', true) + contextCard('共享规则', '<p>私有记忆仅当前创建者可用。共享记忆可供其他 ID 使用，编辑与删除权限仍归创建者。</p>'), { management: true });
    }
  };

  pages.accounts = {
    title: '登录账号', group: 'resources',
    render(ctx) {
      const rows = [
        [`<strong>项目协作账号</strong><small>lin.zhixia@example.com</small>`, 'project.example.com', '仅创建 ID', tag('可用', 'success'), '今天 09:32', actions(ctx, '项目协作账号', 'account')],
        [`<strong>团队文档账号</strong><small>docs.team@example.com</small>`, 'docs.example.com', '所有 ID 共享', tag('可用', 'success'), '昨天 14:46', actions(ctx, '团队文档账号', 'account')],
        [`<strong>资料库只读账号</strong><small>archive.reader@example.com</small>`, 'files.example.com', '所有 ID 共享', tag('可用', 'success'), '10 月 31 日 11:25', actions(ctx, '资料库只读账号', 'account')],
        [`<strong>历史项目账号</strong><small>legacy.team@example.com</small>`, 'archive.example.com', '仅创建 ID', tag('已停用'), '10 月 26 日 16:38', actions(ctx, '历史项目账号', 'account')]
      ];
      return layout(ctx, '统一管理任务登录时使用的账号、默认站点与共享范围。', [
        section('已保存的账号', '4 个账号 · 3 个可用', toolbar(ctx, '搜索账号名称、用户名或站点', '#settings-accounts tbody tr', '新增账号', 'account') + table('settings-accounts', ['账号', '默认站点', '共享范围', '状态', '最近更新', '操作'], rows)),
        section('使用账号登录', '任务按目标站点选择账号，登录过程保留在任务记录中。', `<div class="settings-flow"><div><strong>关联站点</strong><p>为账号填写默认域名和登录地址。</p></div><div><strong>选择范围</strong><p>确认仅自己使用，或共享给工作空间。</p></div><div><strong>在任务中使用</strong><p>任务需要登录时，选择匹配的可用账号。</p></div></div>`)
      ], contextCard('凭据使用方式', '<p>密码不会显示在账号列表中，任务通过短期凭据引用使用已保存的账号。</p><p>共享范围与启用状态可在账号编辑中调整。</p>', true) + contextCard('浏览器环境', `<p>同一浏览器实例可以复用已登录会话。查看浏览器配置，管理实例与预览。</p>${navLink(ctx, '浏览器配置', 'browser')}`), { management: true });
    }
  };
})();
