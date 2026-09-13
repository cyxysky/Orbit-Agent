# Changelog

## Unreleased

- Add `generate.body` for Word, Excel, PPT and PDF authoring: the SDK supplies UNO/ExcelJS lifecycle code or the HTML shell. Keep advanced complete `program` input.
- Remove structured Office `spec` generation, its compiler, public semantic types/exports and plan recommendations. Legacy spec calls fail explicitly; existing executable drafts remain editable/renderable.
- Include format-specific variables, starter bodies and installed core API guidance in document plans; retain guidance in model-facing results and avoid redundant API lookups.

## 0.3.0

- Add the unified `capability-mcp` CLI, Cursor initialization, grouped project configuration and JSON Schema.
- Expose browser actions through one client-compatible tool name.
- Add `/local` and `/openai` for native OpenAI Agents SDK and Responses API tool execution.
- Add chart/maps MCP Apps resources, loopback browser previews, chart editing with revision checks, and ECharts PNG responses.
- Add opt-in maps configuration, local location diagrams and Google Maps presentation support.
- Fix Office temporary paths on Windows, MCP screenshot byte resolution and optional maps defaults in input schemas.
- Document Codex, Cursor, Claude Code, custom MCP clients and native framework integration.

Validation: Windows local tool/runtime audits, official client and Agents SDK protocol fixtures, and real Chromium UI checks. Actual client UI embedding and live Google Maps services remain dependent on client support and configuration; see MCP-UI.zh-CN.md.
