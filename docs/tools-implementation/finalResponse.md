# 最终响应工具 finalResponse

`finalResponse` 提交本轮有序响应。输入只有 `status` 和 `blocks`，工具成功接受后结束本轮；宿主不再调用模型进行独立完成审核。

## 输入契约

```json
{
  "status": "passed",
  "blocks": [
    { "type": "core.markdown", "params": { "text": "1 + 1 = 2。" } }
  ]
}
```

- `status`：`passed`、`failed` 或 `blocked`，表示实际结果。
- `blocks`：1–64 个有序响应块，每个块严格包含 `type` 和 `params`。
- 顶层仅允许这两个字段；额外字段会收到明确的字段名和允许字段列表。
- 可用块类型由本轮实际启用能力的 manifest 注册，并按工具权限过滤。
- `core.markdown` 使用 `params.text`；`core.ui` 使用 `params.tree`；`core.html` 要求 `params.html/title/text`，可选 `params.css`。
- 生成资源使用成功工具结果返回的 `content[].block`，不要自行编造资源标识符。

## 接受链

1. Capability SDK 的 `ResponseRegistry` 验证响应结构、已注册类型和对应参数。
2. AI SDK / Agents 适配器调用 Orbit 的 `onAccept`，通过 `record('finalResponse')` 保存工具执行证据。
3. 运行时检查是否仍有未结束的工具调用、尚未收到结果的持久化调用或待回答的人机输入。这些状态尚未结束时返回未接受结果。
4. 检查通过后登记 `status` 和 `blocks`，返回接受回执及 `blockCount`。Agents 的结束判断基于已接受响应。
5. `ResponseSession.finish()` 保留显式块顺序，并补齐成功工具返回但未显式包含的资源块。客户端按顺序渲染。

响应格式有效只说明数据可以解析和交付，不构成业务事实核验。模型仍需根据真实执行结果回答，并在响应里实际包含承诺的图表、文件或其它交付物。

## 输入错误与重试

输入格式错误发生在工具接受前，不产生交付副作用。SDK 返回可重试的参数反馈，模型应修正字段或块参数后重新调用。此前成功生成的资源可复用，不需要为修正展示参数重新生成。

失败的调用不会写入已接受响应。普通助手文本是过程说明；兼容模型只返回自然文本时，Orbit 可将文本包装成标准 `status/blocks` 并走同一条接受链。

## 展示、权限与导出

HTML 在隔离框架显示，其纯文本等价内容由 `params.text` 提供。图表和画布由对应能力的响应处理器读取；读取和更新仍受用户、会话权限与资源版本约束。

通信和导出使用已注册响应块及实际产物。响应格式调整不改变资源访问权限、工具授权或待处理操作的生命周期。

## 实现入口

- [响应注册、校验与会话组装](../../packages/capability-sdk/src/response.ts)
- [AI SDK 最终响应适配器](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts)
- [Agents 工具适配器](../../packages/capability-sdk/src/adapters/openai-agents/index.ts)
- [Orbit 工具挂载与回执](../../src/server/ai/agents/browser-chat-executor.agent.ts)
- [Agents 运行与接受状态](../../src/server/ai/agents/browser-chat-agents-runtime.ts)
- [模型可见工具说明](../../src/server/ai/agents/runtime-tool-catalog.ts)
- [前端消息投影](../../src/lib/browser-chat-ui-message.ts)
