# Google Maps 地图工具包

独立的 `@webpilot/capability-maps` 包，提供 `maps` 工具和 `GoogleMapRenderer` React 组件。支持地点搜索、驾车／步行／骑行路线、坐标标记、地图缩放／拖动、标准／卫星底图、全屏和 Google Maps 外链。默认不启用街景，也不计算实时交通路线。

## 在 Orbit 中配置

1. 登录 [Google Cloud Console](https://console.cloud.google.com/)，创建或选择项目，关联有效结算账户。免费额度内不产生对应 API 使用费，但生产 API 仍需开启结算。
2. 在“API 和服务 → 库”启用以下三个 API：
   - **Maps JavaScript API**：聊天卡片中的交互地图。
   - **Places API (New)**：地点文字搜索。请选择 New 服务，不是旧版 Places API。
   - **Routes API**：基础路线规划；不需要旧版 Directions API。
3. 在“API 和服务 → 凭据 → 创建凭据 → API 密钥”创建两把不同的 Key：

| Key | API 限制 | 应用限制 |
| --- | --- | --- |
| 浏览器 Key | 仅 Maps JavaScript API | 网站来源（HTTP referrers） |
| 服务端 Key | 仅 Places API (New)、Routes API | 服务端请求实际使用的公网出口 IP |

浏览器 Key 的本地开发来源填：

```text
http://127.0.0.1:3000/*
http://localhost:3000/*
```

上线后添加实际访问域名，例如 `https://orbit.example.com/*`。浏览器 Key 本来就会发送给浏览器，来源限制是必要的保护。服务端 Key 不进入组件、地图记录或工具结果；不要对服务端 Key 设置网站来源限制。

IP 限制填写的是 Google 实际看到的公网出口 IP，不是 `127.0.0.1` 或局域网地址。若本地网络没有固定出口，可先使用只允许上述两个 API 的开发 Key，测试结束后删除；正式部署使用固定出口 IP 限制的 Key。服务器和浏览器均需能够连接 Google 服务。

4. 用管理员账号打开 **设置 → 工具能力 → 地图**，填写并保存：
   - **Google 地图浏览器 Key**：第一把 Key。
   - **Google 地图服务端 Key**：第二把 Key。
   - 地图语言默认 `zh-CN`，可保持默认。
5. 在聊天输入框的工具面板中打开“地图”，尝试：

```text
搜索香港中环附近的咖啡店，并在地图上标记。
规划从香港国际机场到中环的驾车路线。
```

**不用将 Key 发到聊天中。** 保存设置后新请求使用新值；浏览器中已经加载过地图 SDK 时，修改浏览器 Key 或语言后刷新页面。

也可以在本机 `.env.local` 中设置以下变量，不要提交真实密钥。数据库中的已保存设置优先；使用环境文件需要重启已有进程。

```dotenv
GOOGLE_MAPS_BROWSER_KEY=your_browser_key
GOOGLE_MAPS_SERVER_KEY=your_server_key
GOOGLE_MAPS_LANGUAGE=zh-CN
GOOGLE_MAPS_SEARCH_MONTHLY_LIMIT=4500
GOOGLE_MAPS_ROUTES_MONTHLY_LIMIT=9000
```

本次加入了工作区包及 Next 配置；已有开发进程若未识别新包，需要自行重启。开发与构建命令没有由本次接入自动执行。

## 调用量与行为

- 搜索只请求 ID、名称、地址、坐标、Google Maps 链接及来源标注，对应 **Text Search Pro**；不默认请求评分、评价或营业时间。
- 路线只计算一个基础方案，驾车使用 `TRAFFIC_UNAWARE`，对应 **Compute Routes Essentials**；不请求实时路况、最优途经点或路线矩阵。
- 默认每月搜索上限 4,500 次，路线请求上限 9,000 次，0 表示禁用相应请求。计数按美国太平洋时区的月份持久化在 `APP_DATA_DIR/.data/maps-usage`，同一数据目录的 UI／Runtime 进程共享。失败请求保守计入上限，不自动退款或重试；达到上限即在应用中阻止新请求。
- 此上限只控制本应用的两种服务端请求。浏览器地图加载、其他应用、其他数据目录及同一结算账户的其他项目仍需在 Google Cloud 中设置配额和监控。预算提醒本身不会停止扣费，不能把应用上限理解成 Google 账户费用封顶。
- 地图卡片只在点击“打开地图”后加载 SDK 和地图。打开搜索／路线卡片会再发起一次相应查询，以显示当前结果；打开历史对话不会自动请求所有地图。每次重新打开页面中的卡片可能产生新的地图加载和查询。
- 地图文件只保存请求描述，不把 Google 地图图片或完整路线数据长期保存为本地产物。响应中的地图数据用于当前显示；地图清晰度和功能可用性由 Google 服务决定。聊天中的结果摘要属于会话内容，宿主应根据自己的数据保留策略和 Google 服务条款管理。
- 默认保留 Google 原生署名和第三方来源标注。对外上线时，宿主还需提供适用的使用条款和隐私政策。

## 在其他 Agent 框架中复用

```ts
import { createMapsCapability } from '@webpilot/capability-maps';
import { createFileSystemMapStore, reserveMapsRequest } from '@webpilot/capability-maps/node';
import { GoogleMapRenderer } from '@webpilot/capability-maps/react';
```

宿主提供会话隔离的 `MapStore`、配置和 `reserveRequest` 计数回调。能力提供者可交给现有 Capability AI SDK／MCP 适配器，或直接调用 `createMapsTool`。

成功结果包含 `mapId` 和 `content: [{type:'ui', renderer:'com.webpilot.maps/google', resourceId:mapId}]`。Orbit 使用 `finalResponse.blocks` 中的 `{type:'map',mapId,title?}` 渲染。其他 React 宿主直接导入 `GoogleMapRenderer`，传入 `load(signal)`：返回 `{record,view,browserKey,language}`；无需实现组件注册系统。`createGoogleMapsClient(...).resolve(record.request, signal)` 可生成当前 `view`。

服务端的记录读取和 `load` 端点必须验证会话所有权。`browserKey` 只能是受来源限制的浏览器 Key，不能填入服务端 Key。

## 排障与官方文档

- 未配置 Key：进入地图设置填写对应项，不要让 Agent 反复重试。
- HTTP 401／403：检查 API 启用状态、结算账户、Key 的 API 限制与公网出口 IP。
- 浏览器授权失败：检查 Maps JavaScript API、浏览器 Key、实际网站来源和结算配置。
- HTTP 429／应用月上限：检查配额、当月计数；需要时手动调整。
- 超时：分别检查浏览器访问 `maps.googleapis.com`、`maps.gstatic.com` 以及服务端访问 `places.googleapis.com`、`routes.googleapis.com` 的网络。

[Google 项目与 Key 设置](https://developers.google.com/maps/documentation/javascript/get-api-key) · [密钥限制](https://developers.google.com/maps/api-security-best-practices) · [全球价格表](https://developers.google.com/maps/billing-and-pricing/pricing) · [成本控制](https://developers.google.com/maps/billing-and-pricing/manage-costs) · [Places 政策](https://developers.google.com/maps/documentation/places/web-service/policies) · [Routes 政策](https://developers.google.com/maps/documentation/routes/policies)
