# MCP 图表与地图显示

本文对应当前工作区的未发布实现。npm 的 `0.2.1` 不包含本次适配。发布后，使用方仍只安装 `@cjfclonedeep/capability-sdk`，无需另建前端项目或安装 UI 插件依赖。

## 客户端如何显示

`chart` 和 `maps` 保持各一个工具，使用同一套页面提供两种入口：

| 客户端能力 | 展示方式 |
| --- | --- |
| 支持 MCP Apps 的客户端，例如支持此功能的 Cursor 版本 | 通过工具的 `_meta.ui.resourceUri` 加载内嵌页面，可以编辑、刷新、导出图表 |
| 没有启用 MCP Apps，或仅支持普通工具调用的客户端 | 工具结果返回本机浏览器预览链接；打开链接使用相同页面 |
| 支持 MCP 图片结果的客户端 | 二维 ECharts 额外返回 PNG，可显示静态预览；是否直接显示取决于客户端 |
| 自有 Agent，直接使用 `/local`、`/openai` 或 `/ai-sdk` | 工具执行本身不创建聊天界面；由业务前端使用 `/chart/react`、`/maps/react` 或 response renderer，或采用本 SDK 的 MCP 服务提供上述页面 |

Codex、Claude Code 等可以继续使用普通 MCP 配置。不要假设每个版本或每种运行界面都支持 MCP Apps；没有内嵌界面时，使用工具返回的 `Interactive preview` 链接。终端输出不能运行 React 组件。MCP Apps 也是由宿主加载沙盒页面，并非执行工具结果中的任意 JSX。

协议参考：[MCP Apps](https://modelcontextprotocol.io/extensions/apps/build)、[Cursor MCP 帮助](https://prod.cursor.com/help/customization/mcp)。

## 项目配置

编辑项目根目录的 `capability.config.json`，然后重启 MCP 服务。以下字段合并进已有配置即可；无需重新下载执行环境。

```json
{
  "$schema": "./node_modules/@cjfclonedeep/capability-sdk/mcp-config.schema.json",
  "version": 1,
  "server": {
    "visualization": {
      "enabled": true,
      "preview": true,
      "port": 0,
      "readOnly": false,
      "staticImages": true
    }
  },
  "tools": {
    "chart": { "enabled": true },
    "maps": {
      "enabled": true,
      "browserKeyEnv": "GOOGLE_MAPS_BROWSER_KEY",
      "serverKeyEnv": "GOOGLE_MAPS_SERVER_KEY",
      "language": "zh-CN"
    }
  }
}
```

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `server.visualization.enabled` | `true` | 为已挂载的 chart/maps 注册 MCP Apps 资源、浏览器预览及图片；关闭时仍返回原有结构化工具数据 |
| `server.visualization.preview` | `true` | 启动只监听 `127.0.0.1` 的预览服务并返回链接；关闭后仍提供 MCP Apps 和二维 PNG |
| `server.visualization.port` | `0` | 由系统分配空闲端口；也可指定 1–65535 的空闲端口。固定端口被占用会导致启动失败 |
| `server.visualization.readOnly` | `false` | 禁止预览页面写回图表。页面内临时编辑和导出仍可使用；这不是 Agent 工具的写权限开关，工具权限由宿主 policy 控制 |
| `server.visualization.staticImages` | `true` | 在 ECharts 工具结果中附加 PNG。关闭可降低响应大小和渲染开销；Three、Excalidraw 和 maps 不自动附加 PNG |
| `tools.maps.enabled` | `false` | 挂载地图工具。默认 Windows 仍为原有 8 个工具，启用后增加 maps |
| `tools.maps.browserKeyEnv` | `GOOGLE_MAPS_BROWSER_KEY` | 浏览器地图密钥所在的环境变量名；用于 Google Maps JavaScript 底图 |
| `tools.maps.serverKeyEnv` | `GOOGLE_MAPS_SERVER_KEY` | 服务端密钥所在的环境变量名；用于地点搜索和路线查询，不发送到预览页面 |
| `tools.maps.language` | `zh-CN` | 地图服务语言 |

地图额度等完整字段、约束和单位见 [分组配置说明](MCP-CONFIG.zh-CN.md)。密钥值在 MCP 客户端的环境变量设置里填写；JSON 中的 `*KeyEnv` 填环境变量名称。浏览器密钥会用于前端请求，应按 Google 的浏览器密钥配置设置来源限制；不要把服务端密钥填入 `browserKeyEnv` 所指的变量。

CLI 未指定 `--tools` 时会自动包含已启用的 maps。若现有客户端参数显式列出了 `--tools chart`，需改为 `--tools chart,maps` 或移除该筛选才能使用地图。其他客户端接入步骤见 [Agent 接入说明](AGENT-INTEGRATIONS.zh-CN.md)。

## 图表交互与保存

- ECharts：二维图表、数据表编辑、JSON 编辑及既有导出操作。
- Three：三维图表及既有交互、数据编辑与导出操作。
- Excalidraw：画布查看、编辑与导出。

页面编辑后保存会调用原来的 chart 更新逻辑，执行输入校验及宿主 policy，并携带 `expectedRevision`。其他会话先更新过图表时会拒绝覆盖，页面提供重新加载入口。刷新读取当前保存版本，不自动同步所有已打开页面。

图表存储沿用 `server.stateDirectory`，默认为项目的 `.capability-sdk/mcp`。预览服务只访问它已签发链接的图表/地图，不提供任意文件路径或任意工具执行接口。

## 地图没有密钥时

`request.action = "show"` 可以在无密钥情况下生成位置示意和 Google Maps 链接。位置示意没有道路、地形或比例尺，不等同于真实地图底图。配置浏览器密钥后，页面提供加载 Google 地图的入口；搜索和路线计算还需要服务端密钥及相应 API 配置。

CLI 仅在当前进程内暂存最近地图查询结果用于显示，刷新预览不自动再次执行收费的搜索或路线请求。服务重启后，已有 show 请求可以恢复示意；已有搜索/路线记录保留外部地图链接，详细交互展示需要重新查询或由自定义宿主提供 `loadMap`。

真实 Google 底图需要网络和有效授权。MCP Apps 宿主还需允许资源声明中的 Google 来源；预览页的本机字体请求也受宿主策略约束。

## 链接、资源和生命周期

浏览器地址带随机令牌，绑定当前 MCP 进程，仅在该进程运行期间有效。页面具有更新图表的能力时，不应把链接发给不需要访问的人。最多保留 200 个图表/地图预览，较旧链接可能失效；重新调用工具可获取有效链接。

MCP 重启后请重新调用工具取得新链接。浏览器需要与 MCP 服务在同一台机器；远程 HTTP MCP 服务返回的 `127.0.0.1` 地址不会自动变成远程访问入口。远程宿主可以关闭 `preview`，使用 MCP Apps，或自行提供经过授权的资源服务。

页面资源随 npm 包分发，ECharts、Three、Excalidraw 和 MCP Apps 桥接代码不依赖在线 JS CDN。HTML 当前约 5.2 MB，内嵌压缩脚本在浏览器用 `DecompressionStream` 解压，需现代浏览器/WebView。默认画布字体随页面携带，部分额外字体从本机预览服务读取；关闭预览服务时这些字体可能使用系统回退。地图底图仍使用 Google 在线服务。

## 自定义 MCP 宿主

`createCapabilityMcpServer`、`createCapabilityMcpHandler` 和 `serveCapabilityMcpStdio` 的 options 接受 `visualization`，字段与 `server.visualization` 对应。还可提供：

```ts
visualization: {
  preview: true,
  loadMap: async (mapId, record) => {
    // 返回 /maps/react 的 GoogleMapPayload：
    // { record, view, browserKey, language }
    return yourMapPresentationStore.load(mapId);
  }
}
```

`createMapsCapability({ onView(record, view) { ... } })` 可把本次查询得到的视图传给宿主内存缓存。该钩子应快速完成，不抛异常。业务方自行决定缓存期限。工具数据仍走普通 `structuredContent`，展示数据放在 `_meta['capability/visualization']`，避免把整份 UI 数据重复加入模型上下文。

## 维护与验证

UI 源码位于 `src/mcp-ui/viewer.tsx`。维护者修改页面后用 `npm run bundle-ui --workspace @cjfclonedeep/capability-sdk` 更新 `runtime/ui/viewer.html`；使用方安装时不运行 bundler。发布 prepack 会生成该资源。

本次在 Windows 的独立 consumer 中验证了三种图表的真实 Chromium 渲染、浏览器编辑保存、冲突拒绝、地图无密钥示意、MCP Apps iframe 握手及经宿主保存、跨来源写入拒绝和服务关闭。MCP Apps 测试使用协议宿主夹具，尚未代替 Cursor/Codex 实际界面测试；未使用真实 Google 密钥验证底图和计费 API。验证脚本为 consumer 项目的 `audit-ui.mjs`，报告及截图在 `artifacts/ui-adaptation/`。
