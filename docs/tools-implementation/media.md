# 多媒体 media：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.media`。公开工具名：`media`。动作覆盖：`listModels`、`inspect`、`extractFrames`、`ocr`、`transcribe`、`composeVideo`、`generateImage`、`generateVideo`、`generateSpeech`。并发边界：media-processing。

## 组合能力

MediaOperations 把本地 inspect/extract/compose 和模型 generateImage/generateVideo/generateSpeech 组合为同一工具。Orbit 先按模型配置创建 AI SDK/Codex 生成通道，再组合 Remotion 处理通道，并绑定真实附件和本轮产物解析器。sourceRef 必须为登记附件、本轮产物或允许的用户上传/视频项目，拒绝越界路径；参考图片最多 50 MB。

## 全部执行动作

| 动作 | 实现逻辑 |
| --- | --- |
| listModels | 返回启用模型的稳定配置 ID、类型、名称、模型和默认值；额外报告本地 composeVideo、引擎、最大场景/时长和渲染超时，不需要视频生成模型 |
| inspect | 解析合法 sourceRef，ffprobe 存在时取 JSON stream/format 信息，否则用 FFmpeg 零时长读头部；输出隐藏实际本地路径 |
| extractFrames | 按 intervalSeconds 或 thumbnail 过滤器解码抽帧；maxFrames 取调用与配置较小值；逐张发布 JPG 并清理临时目录 |
| ocr | 调用宿主 OCR 实现；未配置则 media-operation-unavailable，不假装已识别 |
| transcribe | 调用宿主转写实现，timestamps 默认 true；未配置返回不可用 |
| composeVideo | schema 校验 scenes/音频/size，处理真实图像/视频来源，合成 MP4，发布产物并在 Orbit 保存可编辑项目 |
| generateImage | 要求 prompt，按 modelRef 或默认图像模型选择服务，读取 sourceRefs/maskRef 后调用生成，发布真实图像产物 |
| generateVideo | 只调用配置的视频生成模型；可接一张起始参考图，与本地拼接场景是两条路径 |
| generateSpeech | 要求文字 prompt 与已配置语音模型，只产生一个音频，发布受支持格式 |

模型通道使用稳定 modelRef，不能把 provider 的任意模型名当配置 ID。生成时的 count、size、aspectRatio、voice、outputFormat、duration 和语言按动作限制；组合视频不接受生成专用的 prompt/modelRef 等字段。所有最终产物依 MIME/kind 再校验，然后保存文件/URL。

## 视频组合和编辑

videoSceneSchema 支持 image/video、duration、camera motion、caption、trimStart、muted；最多 60 场景、总时长 600 秒。音轨支持 offset、trimStart、duration、volume。Remotion 将场景变为 React composition，处理镜头运动、字幕和音频；渲染时使用受控浏览器与 FFmpeg 输出 MP4。FFmpeg fallback 把图像归一化为目标尺寸，视频验证裁剪时间，每段统一 30fps、尺寸与音频，再合并；旁白存在时替换原场景音轨并补齐/裁到影片时长。

renderTimeout 独立于普通媒体处理超时；Orbit 的 agentMediaToolTimeoutMs 覆盖最长启用模型/渲染期限，并加保存项目余量。publishArtifact 保存结果到 run/media，saveCompositionProject 把场景/素材绑定、时间、音轨和版本持久化，用户可通过视频编辑器修改再渲染。项目 revision 与 renderedRevision 区分“已修改”与“已输出当前版”。

## 取消、失败和释放

FFmpeg/模型/Remotion 接收取消信号。运行失败不生成伪 URL，返回 aborted/failed 且 retryable=false；不配置某种实现时明确 unavailable。临时视频、帧目录在 finally 清理，受管理进程有输出上限和树终止，产物发布前检查取消。composeVideo 的镜头/字幕并不实现角色骨骼动画或任意 React 场景编程。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `AGENT_VIDEO_RENDER_TIMEOUT_MS` | 900000 | runtime | Remotion 合成视频的最长持续时间（毫秒），独立于模型生成超时。 |
| `AGENT_MEDIA_TIMEOUT_MS` | 120000 | runtime | 媒体操作的最长持续时间（毫秒）。 |
| `AGENT_MEDIA_MAX_FRAMES` | 12 | runtime | 单次抽帧操作生成的最大帧数。 |

权限契约：`artifact:read`、`artifact:write`、`media:process`、`model:media`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/media/index.ts](../../packages/capability-sdk/src/media/index.ts)

- [createMediaTool](../../packages/capability-sdk/src/media/index.ts#L80)?：函数，第?? 80 ?? 行。
- [createMediaCapability](../../packages/capability-sdk/src/media/index.ts#L132)?：函数，第?? 132 ?? 行。

### [packages/capability-sdk/src/media/generation.ts](../../packages/capability-sdk/src/media/generation.ts)

该模块以契约、数据、脚本入口或对象方法为主；直接按上方源码链接阅读。

### [packages/capability-sdk/src/media/models.ts](../../packages/capability-sdk/src/media/models.ts)

- [mediaModelDriver](../../packages/capability-sdk/src/media/models.ts#L69)?：函数，第?? 69 ?? 行。
- [publicMediaModelConfiguration](../../packages/capability-sdk/src/media/models.ts#L135)?：函数，第?? 135 ?? 行。
- [mergeMediaModelConfiguration](../../packages/capability-sdk/src/media/models.ts#L142)?：函数，第?? 142 ?? 行。
- [resolveMediaModel](../../packages/capability-sdk/src/media/models.ts#L153)?：函数，第?? 153 ?? 行。

### [packages/capability-sdk/src/media/model-settings.ts](../../packages/capability-sdk/src/media/model-settings.ts)

- [schemaForKind](../../packages/capability-sdk/src/media/model-settings.ts#L29)?：函数，第?? 29 ?? 行。
- [createMediaTypeSettings](../../packages/capability-sdk/src/media/model-settings.ts#L45)?：函数，第?? 45 ?? 行。
- [normalizeMediaTypeSettings](../../packages/capability-sdk/src/media/model-settings.ts#L51)?：函数，第?? 51 ?? 行。
- [normalizeProviderMediaSettings](../../packages/capability-sdk/src/media/model-settings.ts#L56)?：函数，第?? 56 ?? 行。
- [mediaModelSelectionId](../../packages/capability-sdk/src/media/model-settings.ts#L64)?：函数，第?? 64 ?? 行。
- [parseMediaModelSelection](../../packages/capability-sdk/src/media/model-settings.ts#L68)?：函数，第?? 68 ?? 行。
- [scopedMediaModelRef](../../packages/capability-sdk/src/media/model-settings.ts#L73)?：函数，第?? 73 ?? 行。
- [resolveMediaTypeSelection](../../packages/capability-sdk/src/media/model-settings.ts#L88)?：函数，第?? 88 ?? 行。
- [mediaConfigurationForProviders](../../packages/capability-sdk/src/media/model-settings.ts#L105)?：函数，第?? 105 ?? 行。

### [packages/capability-sdk/src/media/ai-sdk.ts](../../packages/capability-sdk/src/media/ai-sdk.ts)

- [parameters](../../packages/capability-sdk/src/media/ai-sdk.ts#L22)?：函数，第?? 22 ?? 行。
- [routeUrl](../../packages/capability-sdk/src/media/ai-sdk.ts#L28)?：函数，第?? 28 ?? 行。
- [boundedBytes](../../packages/capability-sdk/src/media/ai-sdk.ts#L53)?：函数，第?? 53 ?? 行。
- [modelFetch](../../packages/capability-sdk/src/media/ai-sdk.ts#L77)?：函数，第?? 77 ?? 行。
- [effectiveMediaModel](../../packages/capability-sdk/src/media/ai-sdk.ts#L103)?：函数，第?? 103 ?? 行。
- [minimaxImageModel](../../packages/capability-sdk/src/media/ai-sdk.ts#L110)?：函数，第?? 110 ?? 行。
- [loadModels](../../packages/capability-sdk/src/media/ai-sdk.ts#L155)?：函数，第?? 155 ?? 行。
- [createAiSdkMediaGenerationOperations](../../packages/capability-sdk/src/media/ai-sdk.ts#L193)?：函数，第?? 193 ?? 行。

### [packages/capability-sdk/src/media/codex-cli.ts](../../packages/capability-sdk/src/media/codex-cli.ts)

- [isImage](../../packages/capability-sdk/src/media/codex-cli.ts#L21)?：函数，第?? 21 ?? 行。
- [imageBytes](../../packages/capability-sdk/src/media/codex-cli.ts#L28)?：函数，第?? 28 ?? 行。
- [createCodexImageModel](../../packages/capability-sdk/src/media/codex-cli.ts#L55)?：函数，第?? 55 ?? 行。

### [packages/capability-sdk/src/media/node.ts](../../packages/capability-sdk/src/media/node.ts)

- [run](../../packages/capability-sdk/src/media/node.ts#L14)?：函数，第?? 14 ?? 行。
- [createFfmpegMediaOperations](../../packages/capability-sdk/src/media/node.ts#L17)?：函数，第?? 17 ?? 行。
- [createNodeMediaCapability](../../packages/capability-sdk/src/media/node.ts#L123)?：函数，第?? 123 ?? 行。
- [createRemotionMediaOperations](../../packages/capability-sdk/src/media/node.ts#L126)?：函数，第?? 126 ?? 行。

### [packages/capability-sdk/src/media/remotion-renderer.ts](../../packages/capability-sdk/src/media/remotion-renderer.ts)

- [compositionPath](../../packages/capability-sdk/src/media/remotion-renderer.ts#L24)?：函数，第?? 24 ?? 行。
- [createRemotionVideoComposer](../../packages/capability-sdk/src/media/remotion-renderer.ts#L36)?：函数，第?? 36 ?? 行。

### [packages/capability-sdk/src/media/video-project.ts](../../packages/capability-sdk/src/media/video-project.ts)

- [videoDuration](../../packages/capability-sdk/src/media/video-project.ts#L24)?：函数，第?? 24 ?? 行。
- [compositionFromVideoDocument](../../packages/capability-sdk/src/media/video-project.ts#L25)?：函数，第?? 25 ?? 行。

### [packages/capability-sdk/src/media/video-composition.tsx](../../packages/capability-sdk/src/media/video-composition.tsx)

- [videoCompositionMetadata](../../packages/capability-sdk/src/media/video-composition.tsx#L5)?：函数，第?? 5 ?? 行。
- [VideoScene](../../packages/capability-sdk/src/media/video-composition.tsx#L10)?：函数，第?? 10 ?? 行。
- [MediaVideoComposition](../../packages/capability-sdk/src/media/video-composition.tsx#L30)?：函数，第?? 30 ?? 行。

### [packages/capability-sdk/src/media/video-editor.tsx](../../packages/capability-sdk/src/media/video-editor.tsx)

- [frameTime](../../packages/capability-sdk/src/media/video-editor.tsx#L13)?：函数变量，第?? 13 ?? 行。
- [clock](../../packages/capability-sdk/src/media/video-editor.tsx#L14)?：函数变量，第?? 14 ?? 行。
- [MediaVideoEditor](../../packages/capability-sdk/src/media/video-editor.tsx#L31)?：函数，第?? 31 ?? 行。

### [src/server/capabilities/agent-infrastructure.ts](../../src/server/capabilities/agent-infrastructure.ts)

- [safeSegment](../../src/server/capabilities/agent-infrastructure.ts#L42)?：函数，第?? 42 ?? 行。
- [createAgentCodeSandboxCapability](../../src/server/capabilities/agent-infrastructure.ts#L47)?：函数，第?? 47 ?? 行。
- [configuredConnectors](../../src/server/capabilities/agent-infrastructure.ts#L65)?：函数，第?? 65 ?? 行。
- [configuredCommunicationChannels](../../src/server/capabilities/agent-infrastructure.ts#L71)?：函数，第?? 71 ?? 行。
- [configuredDataSources](../../src/server/capabilities/agent-infrastructure.ts#L77)?：函数，第?? 77 ?? 行。
- [createConfiguredMediaOperations](../../src/server/capabilities/agent-infrastructure.ts#L90)?：函数，第?? 90 ?? 行。
- [agentMediaToolTimeoutMs](../../src/server/capabilities/agent-infrastructure.ts#L167)?：函数，第?? 167 ?? 行。
- [createAgentInfrastructureProviders](../../src/server/capabilities/agent-infrastructure.ts#L176)?：函数，第?? 176 ?? 行。

### [src/server/capabilities/video-projects.ts](../../src/server/capabilities/video-projects.ts)

- [owner](../../src/server/capabilities/video-projects.ts#L17)?：函数，第?? 17 ?? 行。
- [videoArtifactRef](../../src/server/capabilities/video-projects.ts#L22)?：函数，第?? 22 ?? 行。
- [openStore](../../src/server/capabilities/video-projects.ts#L31)?：函数，第?? 31 ?? 行。
- [readProject](../../src/server/capabilities/video-projects.ts#L39)?：函数，第?? 39 ?? 行。
- [ownedSource](../../src/server/capabilities/video-projects.ts#L46)?：函数，第?? 46 ?? 行。
- [preserveAssets](../../src/server/capabilities/video-projects.ts#L49)?：函数，第?? 49 ?? 行。
- [saveCompositionProject](../../src/server/capabilities/video-projects.ts#L79)?：函数，第?? 79 ?? 行。
- [openVideoProject](../../src/server/capabilities/video-projects.ts#L105)?：函数，第?? 105 ?? 行。
- [updateVideoProject](../../src/server/capabilities/video-projects.ts#L125)?：函数，第?? 125 ?? 行。
- [renderVideoProject](../../src/server/capabilities/video-projects.ts#L142)?：函数，第?? 142 ?? 行。

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
        "listModels",
        "inspect",
        "extractFrames",
        "ocr",
        "transcribe",
        "composeVideo",
        "generateImage",
        "generateVideo",
        "generateSpeech"
      ]
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "sourceRef": {
      "type": "string",
      "minLength": 1,
      "maxLength": 8000
    },
    "sourceRefs": {
      "maxItems": 10,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 8000
      }
    },
    "maskRef": {
      "type": "string",
      "minLength": 1,
      "maxLength": 8000
    },
    "modelRef": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    },
    "prompt": {
      "type": "string",
      "minLength": 1,
      "maxLength": 20000
    },
    "language": {
      "type": "string",
      "minLength": 2,
      "maxLength": 40
    },
    "timestamps": {
      "type": "boolean"
    },
    "intervalSeconds": {
      "type": "number",
      "minimum": 0.1,
      "maximum": 3600
    },
    "maxFrames": {
      "type": "integer",
      "minimum": 1,
      "maximum": 60
    },
    "size": {
      "type": "string",
      "pattern": "^\\d+x\\d+$"
    },
    "aspectRatio": {
      "type": "string",
      "pattern": "^\\d+:\\d+$"
    },
    "count": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10
    },
    "duration": {
      "type": "number",
      "exclusiveMinimum": 0,
      "maximum": 600
    },
    "voice": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "outputFormat": {
      "type": "string",
      "minLength": 1,
      "maxLength": 40
    },
    "scenes": {
      "minItems": 1,
      "maxItems": 60,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "sourceRef": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8000
          },
          "duration": {
            "type": "number",
            "minimum": 0.1,
            "maximum": 600
          },
          "kind": {
            "type": "string",
            "enum": [
              "image",
              "video"
            ]
          },
          "trimStart": {
            "type": "number",
            "minimum": 0,
            "maximum": 86400
          },
          "muted": {
            "type": "boolean"
          },
          "motion": {
            "type": "string",
            "enum": [
              "none",
              "zoomIn",
              "zoomOut",
              "panLeft",
              "panRight"
            ]
          },
          "caption": {
            "type": "string",
            "maxLength": 500
          }
        },
        "required": [
          "sourceRef",
          "duration"
        ],
        "additionalProperties": false
      }
    },
    "audioRef": {
      "type": "string",
      "minLength": 1,
      "maxLength": 8000
    },
    "audioOffset": {
      "type": "number",
      "minimum": 0,
      "maximum": 600
    },
    "audioTrimStart": {
      "type": "number",
      "minimum": 0,
      "maximum": 86400
    },
    "audioDuration": {
      "type": "number",
      "minimum": 0.1,
      "maximum": 600
    },
    "audioVolume": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```
