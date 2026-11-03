import { createLocalCapabilities } from '@cjfclonedeep/capability-sdk/local';
import { toOpenAIResponsesTools } from '@cjfclonedeep/capability-sdk/openai';

// This adapter also supplies invoke(); calling it does not send a model request.
const runtime = await createLocalCapabilities({ tools: ['browser'] });
const tools = toOpenAIResponsesTools(runtime.snapshot, { resolveImage: runtime.resolveImage });
let browserSessionId;
try {
  const opened = await tools.invoke('browser', { action: 'open', url: 'https://example.com/', reason: 'Open the example page' });
  if (!opened.ok) throw new Error(opened.error.message);
  browserSessionId = opened.data.browserSessionId;
  const result = await tools.invoke('browser', {
    action: 'code', browserSessionId, reason: 'Read the page title and heading',
    code: "var info = await page.evaluate(() => ({ title: document.title, heading: document.querySelector('h1')?.innerText || '' })); nodeRepl.write(info);",
  });
  if (!result.ok) throw new Error(result.error.message);
  console.log(JSON.stringify(result.data.result, null, 2));
} finally {
  try {
    if (browserSessionId) await tools.invoke('browser', { action: 'close', browserSessionId });
  } finally {
    await runtime.dispose();
  }
}
