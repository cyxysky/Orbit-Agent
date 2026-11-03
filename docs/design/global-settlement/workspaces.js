(() => {
  'use strict';

  const pages = window.OrbitPages = window.OrbitPages || {};
  const badge = (text, state = '') => `<span class="pill ${state ? `pill-${state}` : ''}">${text}</span>`;
  const heading = (title, description, actions = '') => `<header class="ws-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="ws-actions">${actions}</div></header>`;
  const table = (headers, rows, className = '') => `<div class="table-wrap"><table class="data-table ${className}"><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr data-searchable>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const pageLink = (id, text) => `<button class="ws-text-button" type="button" data-page="${id}">${text}</button>`;
  const action = (ctx, text, overlay, tone = '') => ctx.button(text, `data-overlay="${overlay}"`, tone);
  const titleCell = (title, description) => `<strong>${title}</strong><span class="ws-cell-meta">${description}</span>`;

  function files(ctx, compact = false) {
    const entries = [
      ['本周执行记录.xlsx', '18 条记录 · 42 KB', 'XLSX'],
      ['执行结果摘要.pdf', '3 页 · 186 KB', 'PDF'],
      ['项目参考资料整理.md', '8 个来源 · 12 KB', 'MD'],
    ];
    return `<div class="ws-file-list ${compact ? 'ws-file-list-compact' : ''}">${entries.map(([name, meta, type]) => `<button class="ws-file" type="button" data-overlay="${type === 'XLSX' ? 'sheet-preview' : type === 'MD' ? 'markdown-preview' : 'file-preview'}"><span class="ws-file-symbol">${ctx.icon('file')}</span><span class="grow"><strong>${name}</strong><span>${meta}</span></span><span class="ws-file-type">${type}</span></button>`).join('')}</div>`;
  }

  function browser(ctx) {
    return `<section class="ws-browser" aria-label="项目空间预览"><div class="ws-browser-toolbar"><span class="ws-address">${ctx.icon('shield')} example.com / projects / orbit</span><button class="icon-btn" type="button" data-overlay="browser-preview" aria-label="展开浏览器预览">${ctx.icon('arrow-right')}</button></div><div class="ws-browser-content"><div class="ws-browser-title"><span>项目空间</span>${badge('已读取', 'success')}</div><h3>Orbit 交付计划</h3><p class="muted small">10 月 26 日—11 月 1 日 · 项目周报资料</p><div class="ws-project-list"><div><span>需求与交付</span><strong>12 项已完成</strong></div><div><span>文档整理</span><strong>6 项已更新</strong></div><div><span>待跟进事项</span><strong>2 项待确认</strong></div></div><div class="ws-browser-note">最后同步于今天 09:42<br><span>内容已加入本次任务的参考资料。</span></div></div><div class="ws-browser-footer"><span>${ctx.icon('browser')} 1 个页面 · 只读浏览</span>${action(ctx, '截图', 'screenshot')}</div></section>`;
  }

  function toolSteps(ctx) {
    return `<details class="ws-tool-details"><summary><span>${ctx.icon('check')} 已完成 4 个执行步骤</span><span class="muted small">1 分 26 秒</span></summary><ol class="ws-trace"><li><span class="ws-step-mark">${ctx.icon('check')}</span><div><strong>读取本周项目记录</strong><p>从项目空间读取 18 条记录，保留标题、负责人和更新时间。</p></div>${action(ctx, '详情', 'tool-detail')}</li><li><span class="ws-step-mark">${ctx.icon('check')}</span><div><strong>核对来源与待确认事项</strong><p>关联 8 个来源；2 项缺少完成时间，已单独列出。</p></div>${action(ctx, '来源', 'browser-preview')}</li><li><span class="ws-step-mark">${ctx.icon('check')}</span><div><strong>生成工作簿与摘要</strong><p>执行记录、结果摘要和参考资料已保存到任务文件。</p></div>${action(ctx, '日志', 'terminal')}</li><li><span class="ws-step-mark">${ctx.icon('check')}</span><div><strong>检查文件内容</strong><p>表头、记录条数与摘要引用已核对，文件可预览。</p></div>${action(ctx, '文件', 'files')}</li></ol></details>`;
  }

  function taskGoal() {
    return `<section class="ws-user-message" aria-label="你的任务"><div class="ws-message-meta"><strong>你</strong><span>今天 09:41</span></div><p>整理上周的项目进展，把已完成和待跟进事项分开，生成一份执行记录和可以直接阅读的 PDF 摘要。保留每条信息的来源。</p></section>`;
  }

  function reply(ctx, includeFiles = true) {
    return `<article class="ws-assistant-message"><div class="ws-message-meta"><strong>Orbit</strong>${badge('已完成', 'success')}<span>09:43</span></div><h2>周报资料已整理完成</h2><p>已核对 <strong>18 条项目记录</strong>，其中 12 项已完成、6 项文档更新。另有 2 项需要确认完成时间，我已放入摘要的「待跟进」部分。</p>${toolSteps(ctx)}${includeFiles ? `<div class="ws-inline-files"><div class="ws-inline-title"><h3>本次生成的文件</h3>${action(ctx, '全部文件', 'files')}</div>${files(ctx, true)}</div>` : ''}<p class="ws-reply-note">摘要中的每条结论都附有来源。你可以先检查文件，再决定是否分享给团队。</p><div class="ws-response-actions">${action(ctx, '预览摘要', 'file-preview')}${action(ctx, '导出文件', 'export')}${action(ctx, '保存为自动化', 'automation-task')}<button class="icon-btn" type="button" data-overlay="more" aria-label="更多回复操作">${ctx.icon('more')}</button></div></article>`;
  }

  function composer(ctx, empty = false) {
    return `<div class="ws-composer"><label class="ws-sr-only" for="workspace-message">${empty ? '描述你的任务' : '继续对话'}</label><textarea id="workspace-message" rows="${empty ? '3' : '2'}" placeholder="${empty ? '描述你的目标，添加资料，交给 Orbit 处理…' : '继续追问，或添加下一步任务…'}"></textarea><div class="ws-composer-controls"><div class="ws-actions"><button class="icon-btn" type="button" data-overlay="files" aria-label="添加文件">${ctx.icon('plus')}</button>${action(ctx, '工具与技能', 'more')}<span class="ws-composer-model">默认模型</span></div>${empty ? ctx.button('开始任务', 'data-page="chat"', 'primary') : ctx.button(`${ctx.icon('arrow-right')}<span class="ws-sr-only">发送消息</span>`, 'data-demo="消息已加入当前任务" aria-label="发送消息"', 'primary')}</div></div>`;
  }

  function inspector(ctx) {
    return `<aside class="secondary-area ws-inspector"><section class="panel"><header class="panel-head"><h2>当前工作区</h2>${action(ctx, '展开', 'browser-preview')}</header><div class="ws-inspector-body">${browser(ctx)}</div></section><section class="panel"><header class="panel-head"><h2>任务文件 <span class="muted small">3</span></h2>${action(ctx, '管理', 'files')}</header>${files(ctx)}</section><div class="ws-context-footer">${ctx.icon('shield')} 本次任务无需额外授权${action(ctx, '权限记录', 'approval')}</div></aside>`;
  }

  function chat(ctx) {
    const top = heading('整理项目周报', '项目进展与执行记录 · 今天 09:41', `${action(ctx, '任务文件', 'files')}${action(ctx, '更多', 'more')}`);
    if (ctx.variant === 'b') {
      return `<div class="ws-workspace ws-chat-b">${top}<section class="workspace-stage"><div class="ws-stage-preview"><div class="ws-inline-title"><h2>工作成果</h2><span class="muted small">已完成 · 3 个文件</span></div><div class="ws-stage-document"><div class="ws-document-heading"><span>项目周报</span><span>2026.10.26—11.01</span></div><h2>本周执行结果摘要</h2><p>围绕交付进度、文档完善与待跟进事项，汇总 18 条项目记录。</p><div class="ws-document-columns"><section><h3>已完成</h3><ul><li>完成 12 项需求与交付事项。</li><li>更新 6 项项目文档及关联资料。</li><li>整理 8 个参考来源，统一归档。</li></ul></section><section><h3>需要跟进</h3><ul><li>补充验收记录的完成时间。</li><li>确认下周文档交付负责人。</li></ul></section></div><div class="ws-document-bottom"><span>来源索引与记录明细见附件</span>${action(ctx, '打开 PDF', 'file-preview')}</div></div><div class="ws-stage-files">${files(ctx, true)}</div></div><div class="ws-stage-browser">${browser(ctx)}<div class="ws-context-footer">${action(ctx, '权限记录', 'approval')}${action(ctx, '终端', 'terminal')}</div></div></section><section class="conversation-dock" aria-label="任务对话"><div class="ws-dock-thread">${taskGoal()}${reply(ctx, false)}</div><div class="ws-dock-composer">${composer(ctx)}</div></section></div>`;
    }
    if (ctx.variant === 'c') {
      return `<div class="ws-workspace ws-chat-c">${top}<main class="continuous-thread">${taskGoal()}${reply(ctx, false)}<details class="ws-inline-workspace"><summary><span>${ctx.icon('browser')} 查看工作区与来源</span><span class="muted small">1 个页面</span></summary>${browser(ctx)}</details><section class="ws-thread-artifacts"><div class="ws-inline-title"><h2>交付文件</h2>${action(ctx, '管理文件', 'files')}</div>${files(ctx)}</section><div class="ws-thread-context">${action(ctx, '权限记录', 'approval')}${action(ctx, '查看终端', 'terminal')}${action(ctx, '恢复任务', 'recovery')}</div>${composer(ctx)}</main></div>`;
    }
    return `<div class="ws-workspace ws-chat-a">${top}<div class="page-grid ws-chat-grid"><main class="primary-area ws-thread"><div class="ws-thread-content">${taskGoal()}${reply(ctx)}</div>${composer(ctx)}</main>${inspector(ctx)}</div></div>`;
  }

  function newChat(ctx) {
    return `<div class="ws-workspace ws-new-chat">${heading('新对话', '从一个具体目标开始。', action(ctx, '浏览任务文件', 'files'))}<main class="ws-new-task"><h2>今天想完成什么？</h2><p>查找资料、整理文件，或让 Orbit 协助操作浏览器。</p>${composer(ctx, true)}<div class="ws-prompt-list"><button type="button" data-page="chat"><span><strong>整理项目周报</strong><small>归纳进展、待办与来源，生成文档</small></span>${ctx.icon('arrow-right')}</button><button type="button" data-overlay="files"><span><strong>分析一份工作簿</strong><small>上传表格，检查数据并汇总结果</small></span>${ctx.icon('arrow-right')}</button><button type="button" data-page="tutorial"><span><strong>练习浏览器操作</strong><small>填写演练表单，检查每一步结果</small></span>${ctx.icon('arrow-right')}</button></div><div class="ws-new-task-footer"><span>${ctx.icon('shield')} 操作前可检查工具与授权范围</span>${action(ctx, '使用帮助', 'help')}</div></main></div>`;
  }

  function automationTabs(current) {
    return `<nav class="ws-section-nav" aria-label="自动化页面">${[['automation', '任务'], ['schedules', '执行计划'], ['runs', '执行记录']].map(([id, label]) => `<button type="button" class="${current === id ? 'active' : ''}" data-page="${id}">${label}</button>`).join('')}</nav>`;
  }

  function automation(ctx) {
    const rows = [
      [pageLink('automation-detail', '整理项目周报'), '从项目空间整理进展、待办与来源', badge('已启用', 'success'), '每周五 17:00', titleCell('成功', '今天 09:43 · 1 分 26 秒'), action(ctx, '运行', 'automation-task')],
      [pageLink('automation-detail', '汇总产品文档更新'), '检查最近更新，生成变更摘要', badge('已启用', 'success'), '工作日 09:00', titleCell('成功', '今天 09:02 · 52 秒'), action(ctx, '运行', 'automation-task')],
      [pageLink('automation-detail', '核对知识库链接'), '检查参考资料中的链接与来源', badge('未设置计划'), '手动运行', titleCell('等待授权', '昨天 16:28'), action(ctx, '检查授权', 'approval')],
      [pageLink('automation-detail', '归档月度执行记录'), '按月份整理文件并生成目录', badge('已暂停'), '每月 1 日 10:00', titleCell('成功', '11 月 1 日 10:03'), action(ctx, '编辑', 'automation-task')],
    ];
    return `<div class="ws-workspace">${heading('自动化任务', '把重复工作保存为任务，按需运行或安排执行计划。', action(ctx, `${ctx.icon('plus')} 新建任务`, 'automation-task', 'primary'))}${automationTabs('automation')}<section class="panel"><div class="ws-table-toolbar"><label class="ws-search">${ctx.icon('search')}<input aria-label="搜索自动化任务" data-filter=".ws-task-table tbody tr" placeholder="搜索任务名称或指令"></label><span class="muted small">4 个任务 · 2 个已启用</span></div>${table(['任务名称', '执行指令', '状态', '执行计划', '最近运行', '操作'], rows, 'ws-task-table')}</section><div class="page-grid ws-secondary-grid"><section class="primary-area panel"><header class="panel-head"><h2>最近运行</h2>${pageLink('runs', '全部记录')}</header><div class="panel-body ws-running-list"><div>${badge('成功', 'success')}<span class="grow"><strong>整理项目周报</strong><small>生成 3 个文件 · 今天 09:43</small></span>${action(ctx, '查看结果', 'logs')}</div><div>${badge('等待授权', 'warning')}<span class="grow"><strong>核对知识库链接</strong><small>访问目标页面前需要确认权限</small></span>${action(ctx, '处理', 'approval')}</div></div></section><aside class="secondary-area dark-panel ws-dark-note"><h2>从已有对话创建任务</h2><p>保留已验证的执行指令和资料，下次直接使用。</p>${ctx.button('选择对话', 'data-page="chat"')}</aside></div></div>`;
  }

  function automationDetail(ctx) {
    return `<div class="ws-workspace">${heading('整理项目周报', '自动化任务 · 创建于 10 月 23 日 · 最近编辑于昨天 16:18', `${action(ctx, '编辑任务', 'automation-task')}${action(ctx, '运行任务', 'automation-task', 'primary')}`)}<div class="ws-detail-nav">${pageLink('automation', '返回任务列表')}${badge('已启用', 'success')}</div><div class="page-grid"><main class="primary-area stack"><section class="panel"><header class="panel-head"><h2>执行指令</h2>${action(ctx, '编辑', 'automation-task')}</header><div class="panel-body ws-instructions"><p>打开项目空间，读取本周更新的项目记录。将已完成事项、文档更新和待跟进事项分开整理，保留每条记录的来源。</p><p>生成执行记录工作簿与 PDF 摘要；缺少负责人或完成时间的内容，标注为待确认。完成后检查文件内容并返回结果。</p><div class="ws-inline-meta"><span>目标页面 <strong>example.com/projects/orbit</strong></span><span>交付内容 <strong>XLSX、PDF、Markdown</strong></span></div></div></section><section class="panel"><header class="panel-head"><h2>最近一次执行</h2>${badge('成功', 'success')}</header><div class="panel-body"><div class="ws-run-facts"><span>今天 09:41:34</span><span>耗时 1 分 26 秒</span><span>手动运行</span></div>${toolSteps(ctx)}<div class="ws-inline-title"><h3>执行结果</h3>${action(ctx, '查看完整记录', 'logs')}</div><p>已整理 18 条项目记录，生成 3 个文件，2 项信息待确认。</p>${files(ctx, true)}</div></section></main><aside class="secondary-area stack"><section class="panel"><header class="panel-head"><h2>执行计划</h2>${action(ctx, '编辑', 'schedule')}</header><div class="panel-body"><div class="ws-schedule-clock">${ctx.icon('clock')}<strong>每周五 17:00</strong></div><p class="muted">Asia/Shanghai</p><dl class="ws-definition"><div><dt>下次运行</dt><dd>11 月 6 日 17:00</dd></div><div><dt>计划状态</dt><dd>已启用</dd></div></dl>${action(ctx, '管理执行计划', 'schedule')}</div></section><section class="panel"><header class="panel-head"><h2>任务设置</h2></header><div class="panel-body"><dl class="ws-definition"><div><dt>执行方式</dt><dd>浏览器与文件工具</dd></div><div><dt>创建者</dt><dd>林亦舟</dd></div><div><dt>任务编号</dt><dd>AT-028</dd></div></dl>${action(ctx, '检查授权', 'approval')}</div></section><div class="ws-actions">${action(ctx, '复制任务', 'automation-task')}${action(ctx, '删除任务', 'delete')}</div></aside></div></div>`;
  }

  function schedules(ctx) {
    return `<div class="ws-workspace">${heading('执行计划', '统一查看任务的运行时间、时区与启用状态。', action(ctx, `${ctx.icon('plus')} 新建计划`, 'schedule', 'primary'))}${automationTabs('schedules')}<section class="panel"><header class="panel-head"><h2>计划列表</h2><span class="muted small">时区 · Asia/Shanghai</span></header>${table(['任务', '重复规则', '下次运行', '上次结果', '状态', '操作'], [[pageLink('automation-detail', '整理项目周报'), '每周五 17:00', '11 月 6 日 17:00', badge('成功', 'success'), badge('已启用', 'success'), action(ctx, '编辑计划', 'schedule')], [pageLink('automation-detail', '汇总产品文档更新'), '周一至周五 09:00', '明天 09:00', badge('成功', 'success'), badge('已启用', 'success'), action(ctx, '编辑计划', 'schedule')], [pageLink('automation-detail', '归档月度执行记录'), '每月 1 日 10:00', '已暂停', badge('成功', 'success'), badge('已暂停'), action(ctx, '编辑计划', 'schedule')]])}</section><div class="page-grid ws-secondary-grid"><section class="primary-area panel"><header class="panel-head"><h2>接下来</h2></header><div class="panel-body ws-agenda"><div><span class="ws-agenda-date">明天<strong>09:00</strong></span><div><h3>汇总产品文档更新</h3><p>工作日运行 · 提取最近一天的更新</p></div>${action(ctx, '查看计划', 'schedule')}</div><div><span class="ws-agenda-date">11 月 6 日<strong>17:00</strong></span><div><h3>整理项目周报</h3><p>每周运行 · 汇总本周项目进展</p></div>${action(ctx, '查看计划', 'schedule')}</div></div></section><aside class="secondary-area panel"><header class="panel-head"><h2>计划与任务</h2></header><div class="panel-body"><p>计划负责安排时间，任务保存执行指令。调整任务内容后，后续运行会使用更新后的指令。</p>${pageLink('automation', '查看自动化任务')}${action(ctx, '计划帮助', 'help')}</div></aside></div></div>`;
  }

  function runs(ctx) {
    return `<div class="ws-workspace">${heading('执行记录', '追踪任务结果、执行步骤与生成文件。', action(ctx, '导出记录', 'export'))}${automationTabs('runs')}<section class="panel"><div class="ws-table-toolbar"><label class="ws-search">${ctx.icon('search')}<input aria-label="搜索执行记录" data-filter=".ws-run-table tbody tr" placeholder="搜索任务或结果"></label>${ctx.select('运行状态', ['全部状态', '成功', '失败', '等待授权'], '全部状态')}</div>${table(['任务 / 运行编号', '开始时间', '触发方式', '状态', '耗时', '结果'], [[titleCell('整理项目周报', 'RUN-1168'), '今天 09:41', '手动', badge('成功', 'success'), '1 分 26 秒', action(ctx, '3 个文件', 'logs')], [titleCell('汇总产品文档更新', 'RUN-1167'), '今天 09:00', '计划', badge('成功', 'success'), '52 秒', action(ctx, '查看记录', 'logs')], [titleCell('核对知识库链接', 'RUN-1161'), '昨天 16:28', '手动', badge('等待授权', 'warning'), '18 秒', action(ctx, '处理授权', 'approval')], [titleCell('整理项目周报', 'RUN-1159'), '昨天 15:16', '手动', badge('失败', 'warning'), '43 秒', action(ctx, '恢复任务', 'recovery')], [titleCell('归档月度执行记录', 'RUN-1142'), '11 月 1 日 10:00', '计划', badge('成功', 'success'), '2 分 12 秒', action(ctx, '查看记录', 'logs')]], 'ws-run-table')}<footer class="ws-table-footer"><span>共 5 条执行记录</span><span>最近 7 天</span></footer></section><section class="ws-recovery-strip"><div>${ctx.icon('clock')}<span><strong>一项任务等待继续</strong><small>核对知识库链接 · 确认目标页面的访问权限后可继续执行。</small></span></div>${action(ctx, '检查并继续', 'recovery')}</section></div>`;
  }

  function operationsNav(current) {
    return `<nav class="ws-section-nav" aria-label="AI 运营页面">${[['operations', '运营总览'], ['trends', '趋势分析'], ['usage', '用户与模型']].map(([id, label]) => `<button type="button" class="${current === id ? 'active' : ''}" data-page="${id}">${label}</button>`).join('')}<span class="ws-admin-label">管理员专属</span></nav>`;
  }

  function stats() {
    return `<dl class="ws-stats"><div><dt>任务总量</dt><dd>284</dd><small>对话 201 · 自动化 83</small></div><div><dt>任务成功率</dt><dd>94.0<span>%</span></dd><small>267 个成功结果</small></div><div><dt>异常任务</dt><dd>14</dd><small>失败 9 · 阻塞 5</small></div><div><dt>平均耗时</dt><dd>38<span> 秒</span></dd><small>P95 · 2 分 14 秒</small></div><div><dt>模型 Token</dt><dd>2.86<span> M</span></dd><small>1,468 次模型调用</small></div><div><dt>活跃用户</dt><dd>17</dd><small>统计范围内有任务的用户</small></div></dl>`;
  }

  function trendChart(result = false) {
    const series = result ? [[28, 39, 30, 49, 41, 40, 40], [2, 2, 3, 3, 2, 2, 3]] : [[22, 29, 24, 37, 31, 28, 30], [8, 12, 9, 15, 12, 14, 13]];
    const labels = ['10/28', '10/29', '10/30', '10/31', '11/01', '11/02', '11/03'];
    const title = result ? '执行结果趋势' : '任务使用趋势';
    const bars = labels.map((day, i) => {
      const x = 63 + i * 72;
      return `<rect x="${x}" y="${184 - series[0][i] * 2.7}" width="21" height="${series[0][i] * 2.7}" rx="2" fill="#1a2227"/><rect x="${x + 24}" y="${184 - series[1][i] * 2.7}" width="21" height="${series[1][i] * 2.7}" rx="2" fill="#c4f95d"/><text x="${x + 22}" y="212" text-anchor="middle">${day}</text>`;
    }).join('');
    return `<div class="ws-chart"><svg role="img" aria-label="${title}，10 月 28 日至 11 月 3 日" viewBox="0 0 590 230"><title>${title}</title><desc>${labels.map((day, i) => `${day}: ${series[0][i]} 与 ${series[1][i]}`).join('；')}</desc>${[0, 20, 40, 60].map(n => `<line x1="49" y1="${184 - n * 2.7}" x2="570" y2="${184 - n * 2.7}" stroke="#e5e8e9"/><text x="36" y="${189 - n * 2.7}" text-anchor="end">${n}</text>`).join('')}${bars}</svg><div class="ws-chart-legend"><span><i></i>${result ? '成功' : '对话任务'}</span><span><i class="lime"></i>${result ? '失败、阻塞与中断' : '自动化运行'}</span></div></div>`;
  }

  function operations(ctx) {
    return `<div class="ws-workspace">${heading('AI 运营总览', '对话、自动化与模型使用情况 · 10 月 28 日—11 月 3 日', `${action(ctx, '运行状态', 'logs')}${action(ctx, '导出统计', 'export')}`)}${operationsNav('operations')}${stats()}<div class="page-grid ws-operations-grid"><section class="primary-area panel"><header class="panel-head"><div><h2>使用趋势</h2><p class="muted small">按天统计对话请求与自动化运行</p></div>${pageLink('trends', '查看趋势')}</header><div class="panel-body">${trendChart()}</div></section><aside class="secondary-area panel"><header class="panel-head"><h2>近期异常</h2>${action(ctx, '查看日志', 'logs')}</header><div class="ws-exceptions"><button type="button" data-overlay="recovery">${badge('失败', 'warning')}<strong>整理项目周报</strong><span>目标页面加载超时</span><small>林亦舟 · 昨天 15:16</small>${ctx.icon('chevron-right')}</button><button type="button" data-overlay="approval">${badge('阻塞', 'warning')}<strong>核对知识库链接</strong><span>等待访问权限确认</span><small>顾知夏 · 昨天 16:28</small>${ctx.icon('chevron-right')}</button><button type="button" data-overlay="logs">${badge('中断')}<strong>整理参考资料</strong><span>用户主动结束任务</span><small>许之珩 · 11 月 1 日 11:42</small>${ctx.icon('chevron-right')}</button></div></aside></div><section class="panel ws-secondary-grid"><header class="panel-head"><h2>目标系统</h2><span class="muted small">按浏览器目标域名统计</span></header>${table(['目标域名', '任务量', '成功率', '平均耗时', '最近活动'], [['example.com', '172', '95.3%', '34 秒', '今天 09:43'], ['docs.example.com', '79', '92.4%', '42 秒', '今天 09:02'], ['workspace.example.com', '33', '90.9%', '49 秒', '昨天 17:16']])}</section></div>`;
  }

  function trends(ctx) {
    return `<div class="ws-workspace">${heading('趋势分析', '按日期、用户与执行结果观察使用变化。', action(ctx, '导出趋势', 'export'))}${operationsNav('trends')}<div class="ws-filter-strip">${ctx.select('时间范围', ['最近 7 天', '最近 30 天', '最近 90 天'], '最近 7 天')}${ctx.select('趋势用户', ['全部用户', '林亦舟', '顾知夏', '许之珩'], '全部用户')}<span class="muted small">10 月 28 日—11 月 3 日 · 每日汇总</span></div><div class="ws-chart-grid"><section class="panel"><header class="panel-head"><h2>使用趋势</h2><span class="muted small">284 次任务</span></header><div class="panel-body">${trendChart()}</div></section><section class="panel"><header class="panel-head"><h2>执行结果趋势</h2><span class="muted small">成功率 94.0%</span></header><div class="panel-body">${trendChart(true)}</div></section></div><section class="panel ws-secondary-grid"><header class="panel-head"><h2>每日明细</h2><span class="muted small">对话请求与自动化运行按任务计数</span></header>${table(['日期', '对话任务', '自动化运行', '成功', '失败', '阻塞', '中断'], [['11 月 3 日', '30', '13', '40', '2', '0', '1'], ['11 月 2 日', '28', '14', '40', '2', '0', '0'], ['11 月 1 日', '31', '12', '41', '1', '1', '0'], ['10 月 31 日', '37', '15', '49', '1', '1', '1'], ['10 月 30 日', '24', '9', '30', '1', '1', '1'], ['10 月 29 日', '29', '12', '39', '1', '1', '0'], ['10 月 28 日', '22', '8', '28', '1', '1', '0']])}</section></div>`;
  }

  function usage(ctx) {
    return `<div class="ws-workspace">${heading('用户与模型', '查看任务使用分布和模型调用情况 · 最近 7 天', action(ctx, '导出用量', 'export'))}${operationsNav('usage')}<section class="panel"><header class="panel-head"><div><h2>用户使用情况</h2><p class="muted small">17 位活跃用户 · 展示任务量最多的 5 位</p></div><label class="ws-search">${ctx.icon('search')}<input aria-label="搜索用户" data-filter=".ws-user-table tbody tr" placeholder="搜索用户"></label></header>${table(['用户', '对话任务', '自动化运行', 'Token 用量', '成功率', '平均耗时'], [[titleCell('林亦舟', '用户 101'), '43', '18', titleCell('681,420', '输入 526,100 · 输出 155,320'), '96.7%', '32 秒'], [titleCell('顾知夏', '用户 102'), '31', '21', titleCell('512,805', '输入 389,780 · 输出 123,025'), '94.2%', '41 秒'], [titleCell('许之珩', '用户 103'), '28', '12', titleCell('394,260', '输入 302,180 · 输出 92,080'), '92.5%', '38 秒'], [titleCell('乔若宁', '用户 104'), '24', '8', titleCell('286,913', '输入 218,750 · 输出 68,163'), '93.8%', '44 秒'], [titleCell('温序', '用户 105'), '17', '7', titleCell('228,604', '输入 174,821 · 输出 53,783'), '95.8%', '29 秒']], 'ws-user-table')}</section><section class="panel ws-secondary-grid"><header class="panel-head"><div><h2>模型使用情况</h2><p class="muted small">历史任务用量与当前服务进程的模型调用统计</p></div>${action(ctx, '指标说明', 'help')}</header>${table(['模型', '提供方', '调用次数', '输入 Token', '输出 Token', '总 Token'], [[titleCell('默认任务模型', 'task-default'), '自定义提供方', '926', '1,386,420', '412,805', '1,799,225'], [titleCell('快速模型', 'task-fast'), '自定义提供方', '428', '617,913', '186,240', '804,153'], [titleCell('视觉模型', 'task-vision'), '自定义提供方', '114', '202,118', '54,504', '256,622']])}</section><div class="ws-inline-note">${ctx.icon('chart')} Token 用量用于了解模型使用规模；调用次数按模型请求计数，与任务数不同。</div></div>`;
  }

  function browserLibrary(ctx) {
    const bookmarks = [['项目空间', 'example.com/projects/orbit', '项目资料'], ['产品文档', 'docs.example.com/product', '常用文档'], ['团队知识库', 'workspace.example.com/knowledge', '项目资料'], ['使用指南', 'docs.example.com/orbit/guide', '常用文档']];
    return `<div class="ws-workspace">${heading('浏览器库', '集中管理书签与浏览记录，快速回到工作现场。', `${action(ctx, '标签页分组', 'tab-groups')}${action(ctx, '打开浏览器', 'browser-preview', 'primary')}`)}<div class="ws-library-toolbar"><div class="tabs" role="tablist" aria-label="浏览器库内容"><button type="button" role="tab" aria-selected="true" class="tab active" data-local-tab="ws-bookmarks">书签 <span>4</span></button><button type="button" role="tab" aria-selected="false" class="tab" data-local-tab="ws-history">历史记录</button></div><label class="ws-search">${ctx.icon('search')}<input aria-label="搜索书签与历史记录" data-filter=".ws-library-items [data-searchable]" placeholder="搜索名称或网址"></label></div><div class="ws-library-items"><section class="panel" data-local-panel="ws-bookmarks"><header class="panel-head"><h2>全部书签</h2>${action(ctx, '添加书签', 'more')}</header>${bookmarks.map(([title, url, group]) => `<div class="ws-bookmark-row" data-searchable><span class="ws-site-icon">${ctx.icon('browser')}</span><div class="grow"><button type="button" class="ws-text-button" data-overlay="browser-preview">${title}</button><span class="ws-cell-meta">${url}</span></div><span class="ws-bookmark-group">${group}</span><button class="icon-btn" type="button" data-overlay="more" aria-label="管理${title}书签">${ctx.icon('more')}</button></div>`).join('')}</section><section class="panel" data-local-panel="ws-history" hidden><header class="panel-head"><h2>浏览记录</h2>${action(ctx, '清理记录', 'delete')}</header>${[['今天 09:42', 'Orbit 交付计划', 'example.com/projects/orbit'], ['今天 09:39', '产品更新记录', 'docs.example.com/product/changelog'], ['昨天 16:27', '团队知识库', 'workspace.example.com/knowledge'], ['昨天 14:06', 'Orbit 使用指南', 'docs.example.com/orbit/guide']].map(([time, title, url]) => `<div class="ws-bookmark-row" data-searchable><time>${time}</time><span class="ws-site-icon">${ctx.icon('clock')}</span><div class="grow"><button class="ws-text-button" type="button" data-overlay="browser-preview">${title}</button><span class="ws-cell-meta">${url}</span></div>${action(ctx, '打开', 'browser-preview')}</div>`).join('')}</section></div><div class="ws-inline-note">${ctx.icon('bookmark')} 常用项目页面可添加到书签，也可以按工作任务整理标签页分组。</div></div>`;
  }

  function tutorial(ctx) {
    return `<div class="ws-workspace">${heading('浏览器操作演练', '练习填写、读取与检查操作结果。', action(ctx, '演练帮助', 'help'))}<div class="page-grid"><main class="primary-area panel"><header class="panel-head"><h2>员工信息演练</h2>${badge('未提交')}</header><div class="panel-body"><form class="ws-tutorial-form"><div class="form-grid">${ctx.field('姓名', '测试用户')}${ctx.select('部门', ['请选择部门', '研发部', '产品部', '市场部'], '研发部')}</div><label class="field"><span>测试附件</span><input type="file" aria-label="选择演练附件"><small>选择用于本次演练的文件。</small></label><div class="ws-actions"><button class="btn" type="reset">重置表单</button>${ctx.button('提交演练', 'data-demo="演练表单已提交"', 'primary')}</div></form><div class="ws-form-status"><h3>当前状态</h3><dl class="ws-definition"><div><dt>姓名</dt><dd>测试用户</dd></div><div><dt>部门</dt><dd>研发部</dd></div><div><dt>测试附件</dt><dd>未选择</dd></div><div><dt>提交状态</dt><dd>未提交</dd></div></dl></div></div></main><aside class="secondary-area panel"><header class="panel-head"><h2>练习步骤</h2></header><div class="panel-body"><ol class="ws-tutorial-steps"><li><strong>填写姓名</strong><p>把姓名填写为「测试用户」。</p></li><li><strong>选择部门</strong><p>选择「研发部」。</p></li><li><strong>添加附件</strong><p>在实时界面中选择一个测试文件。</p></li><li><strong>检查结果</strong><p>先不要提交，读取表单状态，确认姓名、部门与附件。</p></li></ol>${ctx.button('回到对话开始练习', 'data-page="new-chat"')}</div></aside></div><section class="panel ws-secondary-grid"><header class="panel-head"><div><h2>继续练习文件处理</h2><p class="muted small">预览文件后，在对话中尝试总结内容或生成新的工作簿。</p></div></header><div class="ws-tutorial-files"><div>${ctx.icon('file')}<span><strong>Orbit 新手文档.docx</strong><small>阅读文档并提取行动项</small></span>${action(ctx, '预览文档', 'file-preview')}</div><div>${ctx.icon('file')}<span><strong>Orbit 新手工作簿.xlsx</strong><small>读取数据并生成汇总</small></span>${action(ctx, '预览工作簿', 'file-preview')}</div><div>${ctx.icon('folder')}<span><strong>生成你的第一份文件</strong><small>根据演练内容整理结果</small></span>${action(ctx, '生成文件', 'generation')}</div></div></section></div>`;
  }

  function updateTutorial(form) {
    const surface = form.closest('.panel');
    const values = [form.querySelector('input[type="text"]').value || '未填写', form.querySelector('select').value === '请选择部门' ? '未选择' : form.querySelector('select').value, form.querySelector('input[type="file"]').files[0]?.name || '未选择', form.dataset.submitted === 'true' ? '已提交' : '未提交'];
    surface.querySelectorAll('.ws-form-status dd').forEach((node, index) => { node.textContent = values[index]; });
    const state = surface.querySelector('.panel-head .pill');
    state.textContent = values[3];
    state.classList.toggle('pill-success', form.dataset.submitted === 'true');
  }
  document.addEventListener('input', event => {
    const form = event.target.closest('.ws-tutorial-form');
    if (form) { form.dataset.submitted = 'false'; updateTutorial(form); }
  });
  document.addEventListener('change', event => {
    const form = event.target.closest('.ws-tutorial-form');
    if (form) { form.dataset.submitted = 'false'; updateTutorial(form); }
  });
  document.addEventListener('click', event => {
    const submit = event.target.closest('.ws-tutorial-form [data-demo]');
    if (submit) { const form = submit.closest('form'); form.dataset.submitted = 'true'; updateTutorial(form); }
  });
  document.addEventListener('reset', event => {
    const form = event.target.closest('.ws-tutorial-form');
    if (!form) return;
    queueMicrotask(() => {
      form.querySelector('input[type="text"]').value = '';
      form.querySelector('select').selectedIndex = 0;
      form.dataset.submitted = 'false';
      updateTutorial(form);
    });
  });

  [['chat', '当前对话', 'chat', chat], ['new-chat', '新对话', 'chat', newChat], ['automation', '自动化任务', 'automation', automation], ['automation-detail', '任务详情', 'automation', automationDetail], ['schedules', '执行计划', 'automation', schedules], ['runs', '执行记录', 'automation', runs], ['operations', '运营总览', 'operations', operations], ['trends', '趋势分析', 'operations', trends], ['usage', '用户与模型', 'operations', usage], ['browser-library', '浏览器库', 'utilities', browserLibrary], ['tutorial', '新手演练', 'utilities', tutorial]].forEach(([id, title, group, render]) => { pages[id] = { title, group, render }; });
})();
