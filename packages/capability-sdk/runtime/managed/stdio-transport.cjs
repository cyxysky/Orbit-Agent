const spawn = require('cross-spawn');
const { StringDecoder } = require('node:string_decoder');

/** Own the complete child lifecycle, including waiting for filesystem handles to close. */
function createStdioTransport(input) {
  let child, started = false, closing, ended;
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  const transport = {
    async start() {
      if (started) throw new Error('MCP transport already started.');
      started = true;
      await new Promise((resolve, reject) => {
        child = spawn(input.command, input.args || [], { cwd: input.cwd, env: input.env, windowsHide: true,
          detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', input.stderr === 'inherit' ? 'inherit' : 'ignore'] });
        ended = new Promise(done => child.once('close', () => { done(); transport.onclose?.(); }));
        child.once('spawn', resolve);
        child.on('error', error => { reject(error); transport.onerror?.(error); });
        child.stdin.on('error', error => { if (!closing) transport.onerror?.(error); });
        child.stdout.on('data', chunk => {
          buffer += decoder.write(chunk);
          if (Buffer.byteLength(buffer) > (input.maxMessageBytes || 48 * 1024 * 1024)) {
            transport.onerror?.(new Error('MCP response exceeds the message size limit.')); void transport.close(); return;
          }
          for (;;) {
            const index = buffer.indexOf('\n');
            if (index < 0) break;
            const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
            if (!line) continue;
            try { transport.onmessage?.(JSON.parse(line)); } catch (error) { transport.onerror?.(error); }
          }
        });
      });
    },
    async send(message, options) {
      options?.signal?.throwIfAborted();
      if (!child?.stdin.writable || closing) throw new Error('MCP process is not connected.');
      await new Promise((resolve, reject) => child.stdin.write(JSON.stringify(message) + '\n', error => error ? reject(error) : resolve()));
    },
    close() {
      return closing ||= (async () => {
        if (!child) return;
        child.stdin.end();
        async function wait(milliseconds) {
          let timer;
          try { return await Promise.race([ended.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
          finally { clearTimeout(timer); }
        }
        if (!await wait(1500) && child.pid) {
          if (process.platform === 'win32') await new Promise(resolve => {
            const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            killer.once('error', () => { child.kill(); resolve(); }); killer.once('close', resolve);
          });
          else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
          if (!await wait(2000)) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } await ended; }
        }
        buffer = '';
      })();
    },
  };
  return transport;
}
module.exports = { createStdioTransport };
