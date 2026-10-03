import type { CapabilitySkill } from '@cjfclonedeep/capability-sdk';

export const subagentRuntimeSkillId = 'system-subagent-runtime';

export const subagentRuntimeSkillSummary = [
  '<system_skill>',
  `<id>${subagentRuntimeSkillId}</id>`,
  '<title>Subagent Runtime</title>',
  '<description>Hidden built-in operating manual for synchronous child-Agent batches, shared capabilities, browser ownership, and complete results.</description>',
  '<required>conditional</required>',
  '</system_skill>',
].join('\n');

export const subagentRuntimeSkillContent = `# Subagent Runtime

This built-in Skill is authoritative for subagent action=spawn. If its instructions are not already available, the host executes spawn through the normal validation and approval flow and supplies these complete instructions alongside the result. Do not repeat the spawn or read this Skill again merely to load its instructions. Children use the same model, execution loop, tools, enabled capabilities, task context, and authorization rules as the parent, with an independent conversation and owned browser pages. Tasks in one batch execute concurrently, but spawn is synchronous: it waits for all children to settle and directly returns their complete results.

## Host tool boundary and API signatures

\`subagent\` is a model tool, not a browserCode JavaScript global. Every example below is one provider-neutral model-tool call.

\`\`\`ts
type SubagentTask = {
  title: string;       // 1-160 characters
  url?: string;        // optional starting absolute URL; omit when no page is needed
  instruction: string; // self-contained task and evidence contract, 1-4,000 characters
};

type SubagentInput =
  | {
      action: "spawn";
      reason?: string;
      tasks: SubagentTask[]; // preferred batch form; concurrent tasks, synchronous batch result
    }
  | {
      action: "spawn";
      reason?: string;
      title: string;
      url?: string;
      instruction: string; // flat fallback for exactly one child
    }
  | {
      action: "read";
      reason?: string;
      uuid: string;       // retrieve one older or resumed child's entire saved result
    };

type SubagentToolResult = {
  ok: boolean;
  actual: string; // JSON text containing complete child results
  failureCategory?: string;
  requiredSkillId?: string;
};

declare function subagent(input: SubagentInput): Promise<SubagentToolResult>;
\`\`\`

The successful spawn result has this semantic shape:

\`\`\`ts
type SpawnActual = {
  action: "spawn";
  asynchronous: false;
  status: "completed";
  allSettled: true;
  subagents: Array<{
    uuid: string;
    index: number;
    title: string;
    status: "queued" | "running" | "awaiting-confirmation" | "passed" | "blocked" | "failed" | "stopped";
    content: string;
    error?: string;
    resumable: boolean;
  }>;
  batchId: string;
  next?: string;
};

type ReadActual = {
  action: "read";
  uuid: string;
  status: "queued" | "running" | "awaiting-confirmation" | "passed" | "blocked" | "failed" | "stopped";
  pending: boolean;
  content: string;
  error?: string;
  resumable: boolean;
  next: string;
};
\`\`\`

\`actual\` is JSON text inside the outer tool result. Spawn waits for the whole batch and returns the full output for each child in this same tool result. Success of the tool call does not imply every child succeeded: assess each child's status, content, partial evidence and error. No additional read call is needed to collect a new spawn's results.

## Spawn examples

Spawn independent pages in one concurrent batch:

\`\`\`js
subagent({
  action: "spawn",
  reason: "并行检查三个互不依赖的业务页面",
  tasks: [
    {
      title: "检查订单 A",
      url: "https://example.com/orders/a",
      instruction: "读取订单 A 的当前状态、金额、更新时间和页面证据；不要修改数据。返回来源 URL、精确字段值、未读取区域和任何阻塞。"
    },
    {
      title: "检查订单 B",
      url: "https://example.com/orders/b",
      instruction: "读取订单 B 的当前状态、金额、更新时间和页面证据；不要修改数据。返回来源 URL、精确字段值、未读取区域和任何阻塞。"
    },
    {
      title: "检查订单 C",
      url: "https://example.com/orders/c",
      instruction: "读取订单 C 的当前状态、金额、更新时间和页面证据；不要修改数据。返回来源 URL、精确字段值、未读取区域和任何阻塞。"
    }
  ]
})
\`\`\`

Spawn exactly one child with the flat form:

\`\`\`js
subagent({
  action: "spawn",
  reason: "让独立页面由单个子 Agent 检查",
  title: "检查独立报表",
  url: "https://example.com/report",
  instruction: "读取报表日期、总计和异常行；返回来源 URL、精确值和可追溯页面证据，不要修改页面。"
})
\`\`\`

Strong child instructions contain five things:

1. One independent objective and its explicit non-goals.
2. The exact starting URL when the task uses a specific page, or relevant file/context identifiers otherwise.
3. The facts or action outcome required from the child.
4. The evidence format: URLs, visible fields, table rows, confirmation text, tab id, or failure details.
5. The stopping/handoff condition, including whether the child may retain an owned deliverable tab.

Do not send a vague instruction such as \`"看看这个页面"\`. Use a self-contained contract:

\`\`\`js
{
  title: "核对发票状态",
  url: "https://example.com/invoices/INV-2048",
  instruction: "只核对 INV-2048，不处理其他发票。返回发票号、客户、金额、付款状态、最后更新时间及其页面证据；若被登录或验证阻塞，返回当前 URL、tab id、active surface、失败操作和交接建议。不要提交、下载或修改任何数据。"
}
\`\`\`

## Retrieving saved results

Use the complete results returned by spawn directly. action="read" is available for results from an older conversation turn or a child resumed after human verification. One read with the exact UUID returns the entire saved output. Do not re-spawn completed tasks to retrieve their output.

\`\`\`js
subagent({ action: "read", uuid: "exact-uuid-from-spawn", reason: "读取已有子 Agent 的完整结果" })
\`\`\`

Results have no child-specific paging or truncation. Preserve findings, sources, conflicts and unresolved items in working notes; normal context compaction remains available for long conversations. Original UUIDs remain usable in follow-up turns and after restart. An older asynchronous task can still have pending=true; that receipt is not a completed result. Never use unrelated browser operations merely to wait. Failed/stopped children are terminal: assess their errors and partial evidence, and report real failed branches alongside successful findings.

## When to delegate

- Spawn only concrete tasks that are independent and useful in parallel.
- Give each child a self-contained title, instruction, expected output, evidence requirement, and starting URL when relevant. A file, research, or code task does not need a fabricated URL.
- Good boundaries include independent URLs, documents, research questions, comparisons, or test branches.
- Keep dependent steps, final synthesis, and externally consequential decisions in the parent Agent.
- Never split consecutive operations on the same interactive page across children. One owner must retain the complete page transaction.

## Shared browser identity and isolated pages

Children may reuse the parent's browser context and authenticated identity, including Cookie-backed login state and, when the runtime supports it, shared storage. They should verify the target page directly and must not log in again or log out merely because they are children.

Each child must work in its own page or tab. It must not take over, navigate, close, or race the parent's current active page. Background children must not steal foreground focus. A child may switch only among tabs it owns or has explicitly claimed for its task.

## Tab ownership and cleanup

- The Agent that creates or explicitly claims a tab owns it.
- A child closes only tabs it owns and only when they are no longer required for evidence, handoff, or delivery.
- Never close the parent's tabs, sibling tabs, or an unowned login/verification page.
- At completion, retain only explicit deliverable or handoff tabs and return their ids, URLs, titles, and status to the parent when relevant.
- The parent decides the final retained-tab set after all child results are integrated.

## Spawning and integrating results

For multiple independent tasks, pass tasks=[{ title, instruction, url? }, ...]. For exactly one child, the flat title, instruction, and optional url form is allowed. Do not retry the same rejected parameter shape repeatedly.

The spawn call waits for every task in its concurrent batch, then directly returns their complete output. Parent/tool cancellation also stops the executing children. Assess successful findings alongside partial results and errors. The parent Agent alone combines evidence, resolves conflicts, decides whether follow-up work is required, and writes the final answer after collecting the required evidence.

## Browser failure handoff

When a child cannot complete a browser operation, it should return:

- the owned tab/page id, current URL, and title;
- the latest active surface id, surface stack, and relevant page state;
- the failed locator or operation and the exact failure;
- whether login/session state was present;
- a concrete suggested next inspection or action for the parent.

Do not hide an unresolved child failure behind a generic summary. The parent should use the returned surface and page evidence to continue safely without rerunning completed child work.
`;

export const subagentRuntimeSkill = Object.freeze({
  id: subagentRuntimeSkillId,
  title: 'Subagent Runtime',
  summary: subagentRuntimeSkillSummary,
  content: subagentRuntimeSkillContent,
  required: false,
  activation: [{ toolName: 'subagent', actions: ['spawn'] }],
} satisfies CapabilitySkill);
