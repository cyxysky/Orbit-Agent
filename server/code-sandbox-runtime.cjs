const path = require('node:path');
const { existsSync } = require('node:fs');

const executionRuntime = [path.join(__dirname, 'capability-runtime', 'execution'),
  path.join(__dirname, '..', 'capability-runtime', 'execution'),
  path.join(__dirname, '..', 'packages', 'capability-sdk', 'runtime', 'execution')]
  .find(directory => existsSync(path.join(directory, 'engine.cjs')));
if (!executionRuntime) throw new Error('Code sandbox execution runtime is missing.');

module.exports = { executionRuntime, ...require(path.join(executionRuntime, 'engine.cjs')) };
