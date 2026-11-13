const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

// Keep readers on the last complete snapshot, including while Windows briefly
// holds the destination open. Never unlink the destination to force a replace.
async function writeJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, file); return; }
      catch (error) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 8) throw error;
        await delay(25 * (attempt + 1));
      }
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

module.exports = { writeJson };
