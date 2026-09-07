import type { CapabilitySkill } from '@webpilot/capability-sdk';

export const codeSandboxRuntimeSkillId = 'system-code-sandbox-runtime';
export const codeSandboxRuntimeSkill = Object.freeze({
  id: codeSandboxRuntimeSkillId,
  title: 'Code Sandbox Runtime',
  summary: `<system_skill id="${codeSandboxRuntimeSkillId}">Run ESM JavaScript/Python; save generated files under outputs/ to receive persistent artifact IDs and URLs. Read saved content with readFile and reuse files with inputFiles. Inspect results before claiming success.</system_skill>`,
  content: `# Code Sandbox Runtime

Use JavaScript or Python for deterministic computation, parsing, and transformation. Read this Skill before the first run.

## Tool arguments

codeSandbox({ action: "run", reason, language: "javascript" | "python", code, args?, packages?, timeoutMs?, maxOutputChars?, outputFiles?, inputFiles? })
codeSandbox({ action: "readFile", reason, artifactId, offset?, limit?, encoding?: "utf8" | "base64" })

- Use only these arguments. timeoutMs is an integer from 1000 to 300000; maxOutputChars is an integer from 1000 to 200000. Send JSON numbers, not strings. Both are capped by host settings; a larger request does not override the host ceiling.
- stdout and stderr share one character budget (default 30000). The host exposes this as Code Sandbox / Output limit (AGENT_CODE_SANDBOX_MAX_OUTPUT_CHARS). Dependencies and execution share the total timeout budget.

## JavaScript module mode and dependencies

- JavaScript runs in Node.js as an ESM .mjs file, including when packages are installed. Use import statements or await import(); top-level await is supported. Bare require, module.exports, __dirname and __filename are not provided.
- Example: packages: ["lodash@4.17.21"], code: "import lodash from 'lodash'; console.log(lodash.sum([1, 2, 3]));".
- For sharp use import sharp from 'sharp'; with an exact sharp version in packages. If a CommonJS-only API needs require, explicitly define it: import { createRequire } from 'node:module'; const require = createRequire(import.meta.url).
- A 'require is not defined in ES module scope' error means the submitted code used CommonJS syntax in ESM. Fix the import syntax; do not diagnose it as a failed installation.
- Request a small number of exact-version dependencies: JavaScript uses lodash@4.17.21; Python uses requests==2.32.3. npm lifecycle scripts are disabled. Packages requiring install-time compilation may not work; prefer packages with compatible prebuilt binaries.

## Output and deliverables

- Return compact JSON, aggregates or a small sample. Never print image/file Base64, entire datasets, or dependency debug logs to stdout.
- Excess stdout/stderr is discarded after the budget is reached; the process continues under its timeout. truncated=true or outputLimitExceeded=true means the captured output is incomplete, even when exitCode=0. Do not parse a truncated JSON result, decode a truncated image, or claim complete output was delivered. Reduce the output before any necessary rerun; increasing maxOutputChars cannot bypass host limits.
- The workspace is disposable, but files under outputs/ are automatically exported BEFORE cleanup into persistent application storage. outputs/ already exists. For an existing script that writes bar-chart.png in the working directory, pass outputFiles: ["bar-chart.png"]. Nested outputs/ directories are supported. Only regular files are exported, never symlinks or paths outside the workspace. Limits: 16 files, 10 MB per file, 32 MB total; export has a separate budget from stdout.
- Example: code: "import fs from 'node:fs'; fs.writeFileSync('outputs/result.json', JSON.stringify({total: 42})); console.log('done');". For canvas use fs.writeFileSync('outputs/chart.png', canvas.toBuffer('image/png')); do not print the buffer.
- A successful run returns artifacts with artifactId, fileName, size, mediaType, url (inline preview), and downloadUrl. Copy these exact addresses into Markdown: ![chart](url) for an image and [Download](downloadUrl) for a file. Do not invent a URL or expose temporary paths. Exported files survive workspace cleanup, refresh and later calls.
- Read actual file content with action=readFile and the returned artifactId. Text defaults to UTF-8; binary can be read as bounded Base64 pages. offset and nextOffset are byte offsets, limit is 1..24000 bytes (default 8192). Images also enter the model's visual context when available. Use the returned nextOffset to continue; do not assume one page is the whole file.
- To process a saved binary or large file, use inputFiles: [{ artifactId: "<exact returned id>", path: "inputs/chart.png" }] in a NEW run, then read inputs/chart.png from JavaScript/Python. This transfers full file bytes directly, without routing Base64 through the model. New output files should go under outputs/. Dependencies must be requested again for each execution.
- For an interactive chart, use the chart tool and a structured finalResponse chart block. For a custom PNG/SVG or other code-generated file, use sandbox exports. For supported office documents, the File capability remains available after reading its Skill.
- A zero exit code proves only process completion. Validate the computed result before relying on it.

The workspace and executable set are host-controlled. Do not probe paths, environment variables, credentials, or the host machine. Network is available in the configured remote runner; use it only when needed and do not exfiltrate local or user data. Local process mode is not a security boundary; never attempt sandbox escape or network-policy bypass.`,
  required: true,
  activation: [{ toolName: 'codeSandbox', actions: ['run', 'readFile'] }],
} satisfies CapabilitySkill);
