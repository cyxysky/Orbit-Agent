const stages = [
  ['source', '准备工具'], ['graph', '解析依赖'], ['dependencies', '安装依赖'],
  ['runtime', '安装运行环境'], ['verify', '验证工具'], ['publish', '完成安装'],
];

function createInstallProgress(tool, at = new Date().toISOString()) {
  return { startedAt: at, currentStep: 'source', steps: stages.filter(([id]) => id !== 'runtime' || tool.runtime)
    .map(([id, label]) => ({ id, label, status: id === 'source' ? 'running' : 'pending', ...(id === 'source' ? { startedAt: at } : {}) })) };
}

function advanceInstallProgress(progress, phase, at = new Date().toISOString()) {
  const currentStep = phase === 'starting' ? 'source' : phase === 'failed' ? progress.currentStep : phase;
  const index = progress.steps.findIndex(step => step.id === currentStep);
  return { ...progress, currentStep: phase === 'ready' ? undefined : currentStep, steps: progress.steps.map((step, i) => {
    const status = phase === 'ready' || (index >= 0 && i < index) ? 'completed'
      : i === index ? phase === 'failed' ? 'failed' : 'running' : step.status;
    return { ...step, status, ...(status === 'running' && !step.startedAt ? { startedAt: at } : {}),
      ...((status === 'completed' || status === 'failed') && !step.finishedAt ? { finishedAt: at } : {}) };
  }) };
}

module.exports = { createInstallProgress, advanceInstallProgress };
