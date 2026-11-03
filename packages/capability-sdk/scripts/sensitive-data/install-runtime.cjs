/* Optional sensitive-data installation shares the SDK runtime installer. */
const { installSensitiveData } = require('../runtime.cjs');

installSensitiveData().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
