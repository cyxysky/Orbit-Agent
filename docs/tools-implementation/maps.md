# 地图 maps：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.maps`。公开工具名：`maps`。动作覆盖：`request.action=search`、`request.action=route`、`request.action=show`、`mapId 读取`。并发边界：maps。

## 请求契约

顶层必须在 request 与 mapId 中二选一，并带 reason。request 内使用 search/route/show。坐标须在纬度经度范围内；route 的每个 waypoint 必须且只能使用 placeId、address 或 location 一种表示。所有 Google 参数和结果均通过专门 schema 校验。

## 执行分支

| 输入 | 处理链及输出 |
| --- | --- |
| search | 校验 query/limit，预留地点请求额度，向 Google Text Search 发 POST；FieldMask 仅请求显示需要的字段；解析真实地点、地址、坐标、归属和 Google Maps 链接 |
| route | 预留路线请求额度，调用 Compute Routes；DRIVE 使用 TRAFFIC_UNAWARE；解析距离、秒数、警告和 encodedPolyline，解码路径并生成起终点标记 |
| show | 直接使用合法 center/zoom/markers，生成 MapView，不访问地点/路线 API |
| mapId | 从存储读取已保存请求，返回记录及 com.webpilot.maps 响应块；这一步不访问 Google API |

resolve 成功且未取消后才 store.create 保存应用请求。模型响应只带地点和路线摘要，不把全部路径坐标复制到上下文；完整路径由渲染器消费。搜索默认 5 个地点、最多 10 个。请求没有自动重试，额度或配置失败直接返回 MapsError 代码。

## 存储、额度和宿主

MapRecord 使用 map_ 加 24 位随机十六进制 ID，以独占写保存 JSON；仅存应用请求，Google 结果不作为永久快照。reserveMapsRequest 按洛杉矶时区月份和 search/route 分目录，用独占 N.used 文件预留名额，跨进程与重启保持月上限；失败请求已预留的额度不会自动释放。

服务端与浏览器使用独立 API key。宿主地图读取路由先检查 chat/automation 归属，再加载请求及浏览器 key。打开交互卡片可重新请求最新 Google 结果并消耗额度；读取 mapId 与显示交互卡片不是同一次行为。健康检查配置是否齐全，不代表当前网络请求必定成功。

## 显示与错误

地图卡片使用 Google Maps，显示 markers、路线、归属与外链。无交互底图的 MCP viewer 提供位置示意与真实 Google Maps 外链。route 返回覆盖/路线警告，不能解释为实时交通或导航。HTTP 响应有读入大小上限；配置缺失、月上限、无路线和存储失败保持 retryable=false。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `GOOGLE_MAPS_BROWSER_KEY` | 空 | runtime | 仅限 Maps JavaScript API，设置网站来源限制。地图打开时会提供给浏览器；不要复用服务端 Key。 |
| `GOOGLE_MAPS_SERVER_KEY` | 空 | runtime | 仅限 Places API (New) 与 Routes API，用于地点搜索和路线规划；不会传给地图浏览器组件。 |
| `GOOGLE_MAPS_LANGUAGE` | zh-CN | runtime | Google 地图与搜索结果语言，例如 zh-CN、en。 |
| `GOOGLE_MAPS_SEARCH_MONTHLY_LIMIT` | 4500 | runtime | 本应用共享数据目录内的请求上限，包含打开搜索地图时的重新查询；0 表示停用。不能替代 Google Cloud 配额。 |
| `GOOGLE_MAPS_ROUTES_MONTHLY_LIMIT` | 9000 | runtime | 本应用共享数据目录内的请求上限，包含打开路线地图时的重新查询；0 表示停用。 |

权限契约：`network:google-maps`、`artifact:read`、`artifact:write`、`renderer:maps`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/maps/index.ts](../../packages/capability-sdk/src/maps/index.ts)

- [createMapsTool](../../packages/capability-sdk/src/maps/index.ts#L37)?：函数，第?? 37 ?? 行。
- [createMapsCapability](../../packages/capability-sdk/src/maps/index.ts#L66)?：函数，第?? 66 ?? 行。

### [packages/capability-sdk/src/maps/core.ts](../../packages/capability-sdk/src/maps/core.ts)

- [MapsError](../../packages/capability-sdk/src/maps/core.ts#L33)?：类，第?? 33 ?? 行。
- [mapsUrl](../../packages/capability-sdk/src/maps/core.ts#L36)?：函数，第?? 36 ?? 行。
- [safeGoogleMapsUrl](../../packages/capability-sdk/src/maps/core.ts#L49)?：函数，第?? 49 ?? 行。
- [decodePolyline](../../packages/capability-sdk/src/maps/core.ts#L53)?：函数，第?? 53 ?? 行。

### [packages/capability-sdk/src/maps/google.ts](../../packages/capability-sdk/src/maps/google.ts)

- [waypoint](../../packages/capability-sdk/src/maps/google.ts#L19)?：函数变量，第?? 19 ?? 行。
- [createGoogleMapsClient](../../packages/capability-sdk/src/maps/google.ts#L21)?：函数，第?? 21 ?? 行。

### [packages/capability-sdk/src/maps/node.ts](../../packages/capability-sdk/src/maps/node.ts)

- [createFileSystemMapStore](../../packages/capability-sdk/src/maps/node.ts#L10)?：函数，第?? 10 ?? 行。
- [reserveMapsRequest](../../packages/capability-sdk/src/maps/node.ts#L27)?：函数，第?? 27 ?? 行。

### [packages/capability-sdk/src/maps/react.tsx](../../packages/capability-sdk/src/maps/react.tsx)

- [loadGoogleMaps](../../packages/capability-sdk/src/maps/react.tsx#L20)?：函数，第?? 20 ?? 行。
- [MapIcon](../../packages/capability-sdk/src/maps/react.tsx#L48)?：函数，第?? 48 ?? 行。
- [safeAttributionUrl](../../packages/capability-sdk/src/maps/react.tsx#L53)?：函数，第?? 53 ?? 行。
- [GoogleMapRenderer](../../packages/capability-sdk/src/maps/react.tsx#L58)?：函数，第?? 58 ?? 行。

### [packages/capability-sdk/src/maps/response.ts](../../packages/capability-sdk/src/maps/response.ts)

- [mapResponseBlock](../../packages/capability-sdk/src/maps/response.ts#L16)?：函数，第?? 16 ?? 行。

### [packages/capability-sdk/src/maps/response-node.ts](../../packages/capability-sdk/src/maps/response-node.ts)

- [createMapResponseHandlers](../../packages/capability-sdk/src/maps/response-node.ts#L8)?：函数，第?? 8 ?? 行。

### [src/server/capabilities/browser-chat-maps.ts](../../src/server/capabilities/browser-chat-maps.ts)

- [mapScope](../../src/server/capabilities/browser-chat-maps.ts#L10)?：函数，第?? 10 ?? 行。
- [browserChatMapStore](../../src/server/capabilities/browser-chat-maps.ts#L16)?：函数，第?? 16 ?? 行。
- [mapConfiguration](../../src/server/capabilities/browser-chat-maps.ts#L17)?：函数，第?? 17 ?? 行。
- [clientOptions](../../src/server/capabilities/browser-chat-maps.ts#L20)?：函数，第?? 20 ?? 行。
- [executeBrowserChatMaps](../../src/server/capabilities/browser-chat-maps.ts#L27)?：函数，第?? 27 ?? 行。
- [resolveBrowserChatMap](../../src/server/capabilities/browser-chat-maps.ts#L31)?：函数，第?? 31 ?? 行。

### [src/server/capabilities/response-handlers.ts](../../src/server/capabilities/response-handlers.ts)

该模块以契约、数据、脚本入口或对象方法为主；直接按上方源码链接阅读。

## 完整输入 JSON Schema

以下内容直接来自当前源码导出，并不是手写参数示例。运行时的跨字段校验不由 JSON Schema 完全表达，仍以正文和 input.parse 为准。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "request": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "const": "search"
            },
            "query": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "limit": {
              "default": 5,
              "type": "integer",
              "minimum": 1,
              "maximum": 10
            }
          },
          "required": [
            "action",
            "query"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "const": "route"
            },
            "origin": {
              "type": "object",
              "properties": {
                "placeId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                },
                "address": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 500
                },
                "location": {
                  "type": "object",
                  "properties": {
                    "lat": {
                      "type": "number",
                      "minimum": -90,
                      "maximum": 90
                    },
                    "lng": {
                      "type": "number",
                      "minimum": -180,
                      "maximum": 180
                    }
                  },
                  "required": [
                    "lat",
                    "lng"
                  ],
                  "additionalProperties": false
                }
              },
              "additionalProperties": false
            },
            "destination": {
              "type": "object",
              "properties": {
                "placeId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                },
                "address": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 500
                },
                "location": {
                  "type": "object",
                  "properties": {
                    "lat": {
                      "type": "number",
                      "minimum": -90,
                      "maximum": 90
                    },
                    "lng": {
                      "type": "number",
                      "minimum": -180,
                      "maximum": 180
                    }
                  },
                  "required": [
                    "lat",
                    "lng"
                  ],
                  "additionalProperties": false
                }
              },
              "additionalProperties": false
            },
            "travelMode": {
              "default": "DRIVE",
              "type": "string",
              "enum": [
                "DRIVE",
                "WALK",
                "BICYCLE"
              ]
            }
          },
          "required": [
            "action",
            "origin",
            "destination"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "const": "show"
            },
            "center": {
              "type": "object",
              "properties": {
                "lat": {
                  "type": "number",
                  "minimum": -90,
                  "maximum": 90
                },
                "lng": {
                  "type": "number",
                  "minimum": -180,
                  "maximum": 180
                }
              },
              "required": [
                "lat",
                "lng"
              ],
              "additionalProperties": false
            },
            "zoom": {
              "default": 13,
              "type": "integer",
              "minimum": 1,
              "maximum": 20
            },
            "markers": {
              "default": [],
              "maxItems": 30,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "position": {
                    "type": "object",
                    "properties": {
                      "lat": {
                        "type": "number",
                        "minimum": -90,
                        "maximum": 90
                      },
                      "lng": {
                        "type": "number",
                        "minimum": -180,
                        "maximum": 180
                      }
                    },
                    "required": [
                      "lat",
                      "lng"
                    ],
                    "additionalProperties": false
                  },
                  "label": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 120
                  }
                },
                "required": [
                  "position",
                  "label"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "action",
            "center"
          ],
          "additionalProperties": false
        }
      ]
    },
    "mapId": {
      "type": "string",
      "pattern": "^map_[a-f0-9]{24}$"
    }
  },
  "required": [
    "reason"
  ],
  "additionalProperties": false
}
```
