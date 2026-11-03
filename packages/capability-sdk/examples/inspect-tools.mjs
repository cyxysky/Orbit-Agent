import { createLocalCapabilities } from '@cjfclonedeep/capability-sdk/local';

// Run from your prepared tool project. No model or model API key is required.
const runtime = await createLocalCapabilities({ tools: ['browser', 'file', 'chart'] });
try {
  console.log(JSON.stringify(Object.values(runtime.snapshot.tools).map(({ publicName, tool }) => ({
    name: publicName,
    description: tool.description,
    inputSchema: tool.input.jsonSchema,
    examples: tool.inputExamples,
  })), null, 2));
} finally {
  await runtime.dispose();
}
