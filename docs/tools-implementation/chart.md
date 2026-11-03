# 图表与画布 chart：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.chart`。公开工具名：`chart`。动作覆盖：`api`、`create`、`read`、`update`。并发边界：chart-artifacts。

## 服务端执行分支

| 动作 | 实现逻辑 |
| --- | --- |
| api | 无 query 时按 offset/limit 返回内置 API 模块索引；指定模块时返回说明、示例及边界；three/excalidraw 有各自契约 |
| create | 归一化标题、说明、高度、引擎、renderer、maps、option；ECharts 经服务端 SVG SSR 验证；Three/Excalidraw 经各自数据校验；保存后返回 chartId 与响应块 |
| read | 按准确 chartId 读取最新有效记录，返回完整 chart、revision 和响应块 |
| update | 强制 expectedRevision，读取并比较最新版本；归一化更新并验证；存储层再次原子防冲突；返回新 revision |

高度默认 380，限制 240–720。engine 默认为 echarts；持久记录使用 version=3。ECharts option 只接受可序列化配置，拒绝可执行回调和函数字符串；formatter 字符串模板可用，valueFormatter 等函数入口不能作为 JSON 调用。maps 保存地图注册数据，在验证与渲染时先 registerMap。

Three.js 契约支持 bar3D/scatter3D/line3D/surface3D，点使用 [x,y,z]；曲面网格尺寸与点数必须匹配。Excalidraw elements 使用唯一 ID、合法类型及有限尺寸；文本、线/箭头点和 image 文件资源分别校验，appState 只保留场景与导出相关字段，剔除 UI 选区、协作和 DOM 状态。

## 文件存储与版本一致性

createFileSystemChartStore 分配 chart_000001 到 chart_999999。完整 JSON 先写临时文件，再用独占硬链接发布；原始记录不覆写，更新写 chartId.revision-N.json。目录索引缓存按 mtime/ctime/大小和检查时间失效。readLatest 优先最大修订并校验记录身份，遇到并发清理造成文件消失时重读一次。

update 的 expectedRevision 检查加独占目标文件发布，保证同时写相同新修订时只有一个成功；冲突返回 chart-revision-conflict。默认保留最近 20 个修订并永久保留原始文件。维护清理失败不抹掉成功写入，而在 health 报告。Orbit 按 chat/automation run 保存图表，创建/更新后发布 realtime refresh。

## 客户端渲染、编辑和导出

ChartRenderer 按 engine 分派。ECharts/Three 动态导入渲染器，ResizeObserver 经 requestAnimationFrame 合并真正的尺寸变化，更新/销毁时取消观察及实例。可转换的简单二维图表提供临时 3D 视图，复杂坐标或编码保持原表达；视图切换不修改原配置。

数据编辑器保存编辑开始时的 chart/revision，通过表格或 JSON 修改。表格操作保留样式、额外维度及对象元数据；CSV 导出处理引号和公式字符。保存调用宿主 onSave 并带基础修订，防止页面刷新覆盖编辑。ECharts 可导 PNG，SVG renderer 可导 SVG，所有数据图可导 JSON，已识别表格可导 CSV。

Excalidraw 挂载后再加载浏览器编辑器，避免 Node/SSR 执行其代码；场景经 restoreElements 修复绑定并滚动到内容。查看/编辑/保存/取消分别管理本地场景与 generation，更新期间冻结编辑基线。支持 .excalidraw、PNG、SVG。卡片与数据图复用 chartStyles 和宿主主题；原画布内容由场景数据控制。

全屏可由宿主控制，也可用原生 Fullscreen API；全屏 viewport 使用 flex 分配剩余高度。结构化响应块分为 com.webpilot.chart/com.webpilot.canvas，保存稳定 ID，前端 handler 按权限读数据。通信图片和离线导出有独立 PNG/HTML 通道，下载错误通过统一 downloadChartFile 暴露。

## 配置与默认值

该 manifest 没有独立配置项；宿主、模型或驱动配置见正文与源码。

权限契约：`artifact:read`、`artifact:write`、`renderer:chart`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/chart/index.ts](../../packages/capability-sdk/src/chart/index.ts)

- [seriesApiModule](../../packages/capability-sdk/src/chart/index.ts#L104)?：函数，第?? 104 ?? 行。
- [normalizedText](../../packages/capability-sdk/src/chart/index.ts#L305)?：函数，第?? 305 ?? 行。
- [normalizedHeight](../../packages/capability-sdk/src/chart/index.ts#L311)?：函数，第?? 311 ?? 行。
- [normalizedPageNumber](../../packages/capability-sdk/src/chart/index.ts#L315)?：函数，第?? 315 ?? 行。
- [readChartApi](../../packages/capability-sdk/src/chart/index.ts#L319)?：函数，第?? 319 ?? 行。
- [createChart](../../packages/capability-sdk/src/chart/index.ts#L369)?：函数，第?? 369 ?? 行。
- [updateChart](../../packages/capability-sdk/src/chart/index.ts#L416)?：函数，第?? 416 ?? 行。
- [readOrUpdateChart](../../packages/capability-sdk/src/chart/index.ts#L428)?：函数，第?? 428 ?? 行。
- [createChartTool](../../packages/capability-sdk/src/chart/index.ts#L440)?：函数，第?? 440 ?? 行。
- [createChartCapability](../../packages/capability-sdk/src/chart/index.ts#L477)?：函数，第?? 477 ?? 行。
- [readChart](../../packages/capability-sdk/src/chart/index.ts#L500)?：函数，第?? 500 ?? 行。

### [packages/capability-sdk/src/chart/core.ts](../../packages/capability-sdk/src/chart/core.ts)

- [recordFromUnknown](../../packages/capability-sdk/src/chart/core.ts#L46)?：函数，第?? 46 ?? 行。
- [serializableClone](../../packages/capability-sdk/src/chart/core.ts#L52)?：函数，第?? 52 ?? 行。
- [hasOptionComponent](../../packages/capability-sdk/src/chart/core.ts#L63)?：函数，第?? 63 ?? 行。
- [isFunctionSource](../../packages/capability-sdk/src/chart/core.ts#L76)?：函数，第?? 76 ?? 行。
- [checkChartFormatters](../../packages/capability-sdk/src/chart/core.ts#L83)?：函数，第?? 83 ?? 行。
- [normalizeChartOption](../../packages/capability-sdk/src/chart/core.ts#L106)?：函数，第?? 106 ?? 行。
- [normalizeChartMaps](../../packages/capability-sdk/src/chart/core.ts#L166)?：函数，第?? 166 ?? 行。
- [echartsMapDefinition](../../packages/capability-sdk/src/chart/core.ts#L185)?：函数，第?? 185 ?? 行。
- [parseChartRecord](../../packages/capability-sdk/src/chart/core.ts#L189)?：函数，第?? 189 ?? 行。
- [ChartRevisionConflict](../../packages/capability-sdk/src/chart/core.ts#L226)?：类，第?? 226 ?? 行。
- [normalizeChartUpdate](../../packages/capability-sdk/src/chart/core.ts#L234)?：函数，第?? 234 ?? 行。
- [normalizeEngineOption](../../packages/capability-sdk/src/chart/core.ts#L242)?：函数，第?? 242 ?? 行。

### [packages/capability-sdk/src/chart/excalidraw-core.ts](../../packages/capability-sdk/src/chart/excalidraw-core.ts)

- [object](../../packages/capability-sdk/src/chart/excalidraw-core.ts#L10)?：函数，第?? 10 ?? 行。
- [normalizeExcalidrawOption](../../packages/capability-sdk/src/chart/excalidraw-core.ts#L17)?：函数，第?? 17 ?? 行。

### [packages/capability-sdk/src/chart/three-core.ts](../../packages/capability-sdk/src/chart/three-core.ts)

- [normalizeThreeChartOption](../../packages/capability-sdk/src/chart/three-core.ts#L27)?：函数，第?? 27 ?? 行。
- [threeChartBounds](../../packages/capability-sdk/src/chart/three-core.ts#L32)?：函数，第?? 32 ?? 行。
- [echartsToThree](../../packages/capability-sdk/src/chart/three-core.ts#L44)?：函数，第?? 44 ?? 行。

### [packages/capability-sdk/src/chart/node.ts](../../packages/capability-sdk/src/chart/node.ts)

- [readExcalidrawFont](../../packages/capability-sdk/src/chart/node.ts#L24)?：函数，第?? 24 ?? 行。
- [publishRecord](../../packages/capability-sdk/src/chart/node.ts#L39)?：函数，第?? 39 ?? 行。
- [validateEChartsOption](../../packages/capability-sdk/src/chart/node.ts#L47)?：函数，第?? 47 ?? 行。
- [createFileSystemChartStore](../../packages/capability-sdk/src/chart/node.ts#L73)?：函数，第?? 73 ?? 行。
- [createNodeChartCapability](../../packages/capability-sdk/src/chart/node.ts#L185)?：函数，第?? 185 ?? 行。

### [packages/capability-sdk/src/chart/react.tsx](../../packages/capability-sdk/src/chart/react.tsx)

- [ChartRenderer](../../packages/capability-sdk/src/chart/react.tsx#L31)?：函数，第?? 31 ?? 行。
- [DataChartRenderer](../../packages/capability-sdk/src/chart/react.tsx#L37)?：函数，第?? 37 ?? 行。

### [packages/capability-sdk/src/chart/excalidraw-react.tsx](../../packages/capability-sdk/src/chart/excalidraw-react.tsx)

- [ExcalidrawRenderer](../../packages/capability-sdk/src/chart/excalidraw-react.tsx#L7)?：函数，第?? 7 ?? 行。

### [packages/capability-sdk/src/chart/excalidraw-view.tsx](../../packages/capability-sdk/src/chart/excalidraw-view.tsx)

- [ExcalidrawView](../../packages/capability-sdk/src/chart/excalidraw-view.tsx#L16)?：函数，第?? 16 ?? 行。

### [packages/capability-sdk/src/chart/echarts-renderer.ts](../../packages/capability-sdk/src/chart/echarts-renderer.ts)

- [svgPng](../../packages/capability-sdk/src/chart/echarts-renderer.ts#L7)?：函数，第?? 7 ?? 行。
- [createEChartsChart](../../packages/capability-sdk/src/chart/echarts-renderer.ts#L19)?：函数，第?? 19 ?? 行。

### [packages/capability-sdk/src/chart/three-renderer.ts](../../packages/capability-sdk/src/chart/three-renderer.ts)

- [createThreeChart](../../packages/capability-sdk/src/chart/three-renderer.ts#L11)?：函数，第?? 11 ?? 行。

### [packages/capability-sdk/src/chart/editor-core.ts](../../packages/capability-sdk/src/chart/editor-core.ts)

- [chartDataTables](../../packages/capability-sdk/src/chart/editor-core.ts#L8)?：函数，第?? 8 ?? 行。
- [tableColumns](../../packages/capability-sdk/src/chart/editor-core.ts#L40)?：函数，第?? 40 ?? 行。
- [cellValue](../../packages/capability-sdk/src/chart/editor-core.ts#L52)?：函数，第?? 52 ?? 行。
- [cellText](../../packages/capability-sdk/src/chart/editor-core.ts#L55)?：函数，第?? 55 ?? 行。
- [parseCell](../../packages/capability-sdk/src/chart/editor-core.ts#L56)?：函数，第?? 56 ?? 行。
- [replaceTableRows](../../packages/capability-sdk/src/chart/editor-core.ts#L63)?：函数，第?? 63 ?? 行。
- [tableCsv](../../packages/capability-sdk/src/chart/editor-core.ts#L71)?：函数，第?? 71 ?? 行。

### [packages/capability-sdk/src/chart/data-editor.tsx](../../packages/capability-sdk/src/chart/data-editor.tsx)

- [ChartDataEditor](../../packages/capability-sdk/src/chart/data-editor.tsx#L11)?：函数，第?? 11 ?? 行。

### [packages/capability-sdk/src/chart/png.ts](../../packages/capability-sdk/src/chart/png.ts)

- [exportExcalidrawPng](../../packages/capability-sdk/src/chart/png.ts#L6)?：函数，第?? 6 ?? 行。
- [exportChartPng](../../packages/capability-sdk/src/chart/png.ts#L29)?：函数，第?? 29 ?? 行。

### [packages/capability-sdk/src/chart/download.ts](../../packages/capability-sdk/src/chart/download.ts)

- [downloadChartFile](../../packages/capability-sdk/src/chart/download.ts#L4)?：函数，第?? 4 ?? 行。

### [packages/capability-sdk/src/chart/response.ts](../../packages/capability-sdk/src/chart/response.ts)

- [definition](../../packages/capability-sdk/src/chart/response.ts#L7)?：函数，第?? 7 ?? 行。
- [chartResponseBlock](../../packages/capability-sdk/src/chart/response.ts#L17)?：函数，第?? 17 ?? 行。

### [packages/capability-sdk/src/chart/response-react.tsx](../../packages/capability-sdk/src/chart/response-react.tsx)

- [createStore](../../packages/capability-sdk/src/chart/response-react.tsx#L14)?：函数，第?? 14 ?? 行。
- [createChartResponseRenderers](../../packages/capability-sdk/src/chart/response-react.tsx#L52)?：函数，第?? 52 ?? 行。

### [packages/capability-sdk/src/chart/response-node.ts](../../packages/capability-sdk/src/chart/response-node.ts)

- [createChartResponseHandlers](../../packages/capability-sdk/src/chart/response-node.ts#L15)?：函数，第?? 15 ?? 行。

### [src/server/capabilities/browser-chat-chart.ts](../../src/server/capabilities/browser-chat-chart.ts)

- [browserChatSessionId](../../src/server/capabilities/browser-chat-chart.ts#L22)?：函数，第?? 22 ?? 行。
- [chartStore](../../src/server/capabilities/browser-chat-chart.ts#L30)?：函数，第?? 30 ?? 行。
- [readBrowserChatChart](../../src/server/capabilities/browser-chat-chart.ts#L54)?：函数，第?? 54 ?? 行。
- [updateBrowserChatChart](../../src/server/capabilities/browser-chat-chart.ts#L61)?：函数，第?? 61 ?? 行。
- [executeBrowserChatChart](../../src/server/capabilities/browser-chat-chart.ts#L65)?：函数，第?? 65 ?? 行。

### [src/server/capabilities/browser-chat-chart-image.ts](../../src/server/capabilities/browser-chat-chart-image.ts)

- [renderPng](../../src/server/capabilities/browser-chat-chart-image.ts#L22)?：函数，第?? 22 ?? 行。
- [exportBrowserChatChartImage](../../src/server/capabilities/browser-chat-chart-image.ts#L66)?：函数，第?? 66 ?? 行。

### [src/components/response-renderers.tsx](../../src/components/response-renderers.tsx)

该模块以契约、数据、脚本入口或对象方法为主；直接按上方源码链接阅读。

### [src/components/browser-chat-export.tsx](../../src/components/browser-chat-export.tsx)

- [escapeExportHtml](../../src/components/browser-chat-export.tsx#L27)?：函数变量，第?? 27 ?? 行。
- [exportJson](../../src/components/browser-chat-export.tsx#L28)?：函数变量，第?? 28 ?? 行。
- [safeName](../../src/components/browser-chat-export.tsx#L29)?：函数变量，第?? 29 ?? 行。
- [blobData](../../src/components/browser-chat-export.tsx#L31)?：函数，第?? 31 ?? 行。
- [ExportAssets](../../src/components/browser-chat-export.tsx#L44)?：类，第?? 44 ?? 行。
- [ExportAssets.key](../../src/components/browser-chat-export.tsx#L49)?：方法，第?? 49 ?? 行。
- [ExportAssets.add](../../src/components/browser-chat-export.tsx#L56)?：方法，第?? 56 ?? 行。
- [ExportAssets.read](../../src/components/browser-chat-export.tsx#L64)?：方法，第?? 64 ?? 行。
- [ExportAssets.link](../../src/components/browser-chat-export.tsx#L82)?：方法，第?? 82 ?? 行。
- [ExportAssets.inline](../../src/components/browser-chat-export.tsx#L85)?：方法，第?? 85 ?? 行。
- [buildBrowserChatExport](../../src/components/browser-chat-export.tsx#L124)?：函数，第?? 124 ?? 行。
- [exportBrowserChatHtml](../../src/components/browser-chat-export.tsx#L244)?：函数，第?? 244 ?? 行。

## 完整输入 JSON Schema

以下内容直接来自当前源码导出，并不是手写参数示例。运行时的跨字段校验不由 JSON Schema 完全表达，仍以正文和 input.parse 为准。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "api",
        "create",
        "read",
        "update"
      ],
      "description": "Read API guidance, create a chart, read its latest saved data, or update it using expectedRevision."
    },
    "engine": {
      "description": "Defaults to echarts. Read module three for 3D or excalidraw for editable diagrams.",
      "type": "string",
      "enum": [
        "echarts",
        "three",
        "excalidraw"
      ]
    },
    "chartId": {
      "type": "string",
      "pattern": "^chart_\\d{6}$"
    },
    "expectedRevision": {
      "description": "For update: revision returned by the latest read; prevents overwriting manual edits.",
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740990
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300,
      "description": "Concise reason for this tool call."
    },
    "query": {
      "description": "For action=api: omit for the index or pass an exact module id returned by the index.",
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    },
    "offset": {
      "description": "For action=api index pagination.",
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "limit": {
      "description": "For action=api index pagination.",
      "type": "integer",
      "minimum": 1,
      "maximum": 50
    },
    "title": {
      "description": "Accessible title rendered with the chart.",
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "description": {
      "description": "Accessible plain-language chart summary.",
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    },
    "height": {
      "description": "Rendered height in pixels. Defaults to 380.",
      "type": "integer",
      "minimum": 240,
      "maximum": 720
    },
    "renderer": {
      "description": "ECharts renderer. Defaults to canvas.",
      "type": "string",
      "enum": [
        "canvas",
        "svg"
      ]
    },
    "option": {
      "description": "For create/update: complete JSON option for the chosen engine. ECharts formatter must be a string template, never a function-source string; omit it for default tooltips. Read module three for 3D, or excalidraw for diagrams. Excalidraw: elements is an array; appState is an object; omit files unless using image elements. files is a resource object keyed by fileId, never a string or array.",
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "maps": {
      "description": "Optional GeoJSON or SVG maps registered before rendering.",
      "maxItems": 12,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "geoJson": {
            "anyOf": [
              {
                "type": "object",
                "propertyNames": {
                  "type": "string"
                },
                "additionalProperties": {}
              },
              {
                "type": "string",
                "minLength": 1
              }
            ]
          },
          "specialAreas": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          }
        },
        "required": [
          "name",
          "geoJson"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```
