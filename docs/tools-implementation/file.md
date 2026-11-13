# 文件与 Office file：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.file`。公开工具名：`file`。动作覆盖：`list`、`readSource`、`readContent`、`download`、`write`、`convert`、`plan`、`generate`、`edit`、`unoApi`、`jsApi`、`render`、`visualIndex`、`visualRead`、`visualReport`、`read（兼容别名）`。并发边界：file-artifacts；工作区还按文档加锁。

## 输入和宿主绑定

createFileToolInput 按宿主是否提供图像输入决定是否公布 visualIndex/visualRead/visualReport。transport 归一化参数，action-guidance 再检查动作必填字段和互斥组合；没有动作、混合多个编辑方式或未知字段会返回可定位的错误。兼容 read 入口保留给旧调用；模型面向 readSource/readContent。

Orbit 用 createBrowserChatFileOperations 将工具绑定到本轮工作区、附件清单、文件阅读回调、图像回调、产物 URL 和进度报告。SDK Node 默认实现则按 realpath 校验产物属于当前 run；附件必须来自已登记 binding。createNodeFileWorkspace 用 AsyncLocalStorage 绑定宿主的产物根目录、下载器、转换器和预览器，避免不同实例共享错误配置。

托管 MCP 工具通过 createManagedToolProviders 转发。模型使用相对于 Orbit 全局产物根目录的 artifactId，工具内部使用相对于会话工作区的 artifactId；入参只转换一次，附件绑定也只执行一次。出参统一转换所有层级的产物 ID，顶层产物、visualIndex、nextRead、nextAction、contentRead 和 content 中的引用必须一致，不能只根据顶层下载 URL 修改 ID。structuredContent 和纯文本 JSON 结果使用相同规则，转换同时校验产物仍在当前会话目录内。

## 所有动作的处理链

| 动作 | 完整职责与处理结果 |
| --- | --- |
| list | 枚举当前 run 的 Office 草稿、工作流、已有源程序、渲染文件和可用素材，返回目录而非全量正文 |
| readSource | 从稳定 documentId 读取生成程序；支持源码单元 path、行范围、诊断与 digest；无范围时可先返回索引；不读取最终 Office 正文 |
| readContent | 从附件/产物提取最终文件的文本、页、节、Excel 工作表和范围；按 offset/limit 分页；includeVisuals 由宿主图像能力控制 |
| download | 解析真实 URL/路径，应用文件名/类型与下载校验，经下载器保存到产物目录；返回 artifactId 和真实下载链接 |
| write | 将传入 content 原样保存为受支持的文本文件，包括空内容与空白；返回文本产物 |
| convert | 解析已有 sourceArtifactId，调用转换器/LibreOffice，保存目标格式；可执行预览验证 |
| plan | 校验稳定 documentId、documentType、fileName、设计简报和 create/modify；同步素材，确定源文件与生成器，保存 planned 草稿 |
| generate | 要求先 plan；body 与 program 必须二选一；body 经 Office facade 编译成程序；保存在同一个草稿源缓冲并执行验证 |
| edit | 要求已有程序；patch 与 replacements 二选一；可限制源码单元；定位冲突时不改源；成功后保存源码及编辑回执并校验，可请求 render |
| unoApi | 按模块、搜索和分页读取高层 UNO facade 说明、现有对象选择器及使用边界，不开放原始 UNO/expert 作为模型接口 |
| jsApi | 读取 JavaScript Office 生成器支持的模块、示例和参数说明 |
| render | 校验当前源码版本及生成能力，执行实际生成、验证与渲染，将可下载文档和预览登记为产物 |
| visualIndex | 校验 artifactId 仍属于当前渲染版本，返回页面/截图索引 |
| visualRead | 按已观察 screenshotIds 读取截图，登记已查看页面及版本证据 |
| visualReport | 保存页面与整份文档的视觉检查结果、问题和覆盖状态；结果绑定当前渲染 digest |
| read | 旧兼容路由：documentId 对应源码读取，附件/产物 ID 对应内容读取；不在当前模型动作枚举中公布 |

## 草稿、生成器与修改原文件

一个逻辑文档使用一个 documentId。重复 plan 已编写或渲染过的文档时复用其 source、operation、设计和工作区，不因恢复调用重新生成。modify 必须绑定真实 Office 源文件，并通过匹配 facade 打开；素材同步建立资产名称、文件路径和指纹，保证后续生成使用同一资源。

生成器由 OFFICE_GENERATION_MODE、输出格式和操作类型选择，支持 UNO、JavaScript 和 HTML 路径。UNO 程序要求同步 create_document(job) 入口，并由受管理的 LibreOffice/Python/worker 执行；JavaScript 路径由 office-js-program-worker 配合 docx、ExcelJS、PptxGenJS 等库生成；HTML 路径有独立解析及格式转换。模型提供内容操作，SDK 持有文档创建/打开、生命周期、保存和资源权限。

## 编辑原子性与重复调用

workspace-source-editor 把 Codex 风格多 hunk patch 或精确 oldText/newText replacements 应用到当前完整源/指定单元。匹配失败、歧义或非法输入返回 rejected/conflict，保留原源。编辑请求摘要与 before/after digest 存入 lastSourceEdit；同一请求且当前源与 afterDigest 一致时返回 already-applied，避免重放修改。源码保存与验证通过分别用 saved/validation 表达：修复被保存但仍有错误时，工具仍返回失败及当前诊断，不能据 saved=true 声称成品完成。

## 验证、缓存和渲染

验证分静态程序分析、生成运行、生成特征/元素验证和渲染验证；结合 plan 指定的演示能力形成质量门槛。缓存键包含源码 digest、worker/runtime 指纹、素材指纹与文档信息。验证证据记录检查时间、作用域、阶段和修订匹配情况；源码、素材或运行环境变化后旧证据失效。

render 只为当前有效源和产物给出就绪结果；不将上一版渲染当作本次成功。图像回调可继续检查版面，记录页面覆盖和失败项；源变更会清空活跃视觉 QA，保留历史证据。中断、验证失败和环境缺失保留可修复草稿并返回具体诊断/下一步。文件提取由有界 worker/pool 执行，PDF/Office 提取与源码编辑是不同入口。

视觉版本校验同时核对源码摘要和当前渲染产物 ID。失败反馈以 source-changed 和 artifact-id-mismatch 区分原因，并提供 expectedArtifactId；摘要相同但引用不符时应修正 ID，重复渲染相同源码不能修复宿主的引用转换问题。

## 返回模型和前端

fileOperationToCapabilityResult 保留结构化数据和诊断，在 content 中附产物、下载 URL 和图片；短 summary 不重复整份源码。Orbit 的 fileToolModelOutput 对 readSource 输出元数据加原样代码块，避免把程序再包为 JSON 转义文本。文件预览、素材选择、阅读页和图像证据经宿主回调进入对话。工作区释放拥有的下载/转换资源；外部注入的资源仍由调用方持有。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `OFFICE_GENERATION_MODE` | uno | runtime | JavaScript 模式：Excel 使用原有引擎，Word、PowerPoint、PDF 从 HTML 生成。Markdown 等文本文件可直接生成。 |

权限契约：`files:read`、`files:write`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/file/index.ts](../../packages/capability-sdk/src/file/index.ts)

- [isFileAction](../../packages/capability-sdk/src/file/index.ts#L64)?：函数，第?? 64 ?? 行。
- [isFileVisualAction](../../packages/capability-sdk/src/file/index.ts#L68)?：函数，第?? 68 ?? 行。
- [isFileVisualToolAction](../../packages/capability-sdk/src/file/index.ts#L72)?：函数，第?? 72 ?? 行。
- [executionFailure](../../packages/capability-sdk/src/file/index.ts#L82)?：函数，第?? 82 ?? 行。
- [executeFileAction](../../packages/capability-sdk/src/file/index.ts#L92)?：函数，第?? 92 ?? 行。
- [executeFileVisualAction](../../packages/capability-sdk/src/file/index.ts#L134)?：函数，第?? 134 ?? 行。
- [createFileTools](../../packages/capability-sdk/src/file/index.ts#L168)?：函数，第?? 168 ?? 行。
- [createFileCapability](../../packages/capability-sdk/src/file/index.ts#L247)?：函数，第?? 247 ?? 行。

### [packages/capability-sdk/src/file/schema.ts](../../packages/capability-sdk/src/file/schema.ts)

- [validateVisualInput](../../packages/capability-sdk/src/file/schema.ts#L140)?：函数，第?? 140 ?? 行。
- [createFileToolSchema](../../packages/capability-sdk/src/file/schema.ts#L199)?：函数，第?? 199 ?? 行。
- [createFileToolInput](../../packages/capability-sdk/src/file/schema.ts#L229)?：函数，第?? 229 ?? 行。

### [packages/capability-sdk/src/file/transport.ts](../../packages/capability-sdk/src/file/transport.ts)

- [booleanFromString](../../packages/capability-sdk/src/file/transport.ts#L9)?：函数，第?? 9 ?? 行。
- [numberFromString](../../packages/capability-sdk/src/file/transport.ts#L17)?：函数，第?? 17 ?? 行。
- [normalizedDocumentType](../../packages/capability-sdk/src/file/transport.ts#L25)?：函数，第?? 25 ?? 行。
- [normalizedAction](../../packages/capability-sdk/src/file/transport.ts#L34)?：函数，第?? 34 ?? 行。
- [documentTypeFromFileName](../../packages/capability-sdk/src/file/transport.ts#L47)?：函数，第?? 47 ?? 行。
- [normalizeFileToolInput](../../packages/capability-sdk/src/file/transport.ts#L56)?：函数，第?? 56 ?? 行。

### [packages/capability-sdk/src/file/action-guidance.ts](../../packages/capability-sdk/src/file/action-guidance.ts)

- [fileActionInputIssues](../../packages/capability-sdk/src/file/action-guidance.ts#L4)?：函数，第?? 4 ?? 行。

### [packages/capability-sdk/src/file/formats.ts](../../packages/capability-sdk/src/file/formats.ts)

- [text](../../packages/capability-sdk/src/file/formats.ts#L29)?：函数变量，第?? 29 ?? 行。
- [normalizedFileExtension](../../packages/capability-sdk/src/file/formats.ts#L134)?：函数，第?? 134 ?? 行。
- [fileFormatForExtension](../../packages/capability-sdk/src/file/formats.ts#L150)?：函数，第?? 150 ?? 行。
- [fileFormatForName](../../packages/capability-sdk/src/file/formats.ts#L154)?：函数，第?? 154 ?? 行。
- [fileFormatForMimeType](../../packages/capability-sdk/src/file/formats.ts#L158)?：函数，第?? 158 ?? 行。
- [generatedFileExtensions](../../packages/capability-sdk/src/file/formats.ts#L162)?：函数，第?? 162 ?? 行。
- [readableFileExtensions](../../packages/capability-sdk/src/file/formats.ts#L168)?：函数，第?? 168 ?? 行。
- [officePreviewExtensions](../../packages/capability-sdk/src/file/formats.ts#L174)?：函数，第?? 174 ?? 行。
- [artifactContentType](../../packages/capability-sdk/src/file/formats.ts#L183)?：函数，第?? 183 ?? 行。
- [uploadStorageExtension](../../packages/capability-sdk/src/file/formats.ts#L187)?：函数，第?? 187 ?? 行。

### [packages/capability-sdk/src/file/node/capability.ts](../../packages/capability-sdk/src/file/node/capability.ts)

- [resolveContextValue](../../packages/capability-sdk/src/file/node/capability.ts#L49)?：函数，第?? 49 ?? 行。
- [record](../../packages/capability-sdk/src/file/node/capability.ts#L55)?：函数，第?? 55 ?? 行。
- [fileOperationToCapabilityResult](../../packages/capability-sdk/src/file/node/capability.ts#L61)?：函数，第?? 61 ?? 行。
- [unavailable](../../packages/capability-sdk/src/file/node/capability.ts#L123)?：函数，第?? 123 ?? 行。
- [progressReporter](../../packages/capability-sdk/src/file/node/capability.ts#L127)?：函数，第?? 127 ?? 行。
- [createNodeFileOperations](../../packages/capability-sdk/src/file/node/capability.ts#L131)?：函数，第?? 131 ?? 行。
- [createNodeFileCapability](../../packages/capability-sdk/src/file/node/capability.ts#L352)?：函数，第?? 352 ?? 行。

### [packages/capability-sdk/src/file/node/workspace.ts](../../packages/capability-sdk/src/file/node/workspace.ts)

- [officeOperationWasInterrupted](../../packages/capability-sdk/src/file/node/workspace.ts#L43)?：函数，第?? 43 ?? 行。
- [compactToolText](../../packages/capability-sdk/src/file/node/workspace.ts#L131)?：函数，第?? 131 ?? 行。
- [compactValidationDiagnosticsForTool](../../packages/capability-sdk/src/file/node/workspace.ts#L141)?：函数，第?? 141 ?? 行。
- [compactWorkflowForTool](../../packages/capability-sdk/src/file/node/workspace.ts#L153)?：函数，第?? 153 ?? 行。
- [describeDocumentAsset](../../packages/capability-sdk/src/file/node/workspace.ts#L168)?：函数，第?? 168 ?? 行。
- [sha256File](../../packages/capability-sdk/src/file/node/workspace.ts#L183)?：函数，第?? 183 ?? 行。
- [optimizeWorkspaceImage](../../packages/capability-sdk/src/file/node/workspace.ts#L189)?：函数，第?? 189 ?? 行。
- [configuredOfficeGenerator](../../packages/capability-sdk/src/file/node/workspace.ts#L227)?：函数，第?? 227 ?? 行。
- [plannedSourceDocument](../../packages/capability-sdk/src/file/node/workspace.ts#L242)?：函数，第?? 242 ?? 行。
- [assetFileName](../../packages/capability-sdk/src/file/node/workspace.ts#L282)?：函数，第?? 282 ?? 行。
- [visibleFiles](../../packages/capability-sdk/src/file/node/workspace.ts#L296)?：函数，第?? 296 ?? 行。
- [visibleFilesRecursive](../../packages/capability-sdk/src/file/node/workspace.ts#L305)?：函数，第?? 305 ?? 行。
- [syncDocumentAssets](../../packages/capability-sdk/src/file/node/workspace.ts#L329)?：函数，第?? 329 ?? 行。
- [artifactResultPayload](../../packages/capability-sdk/src/file/node/workspace.ts#L397)?：函数，第?? 397 ?? 行。
- [resolveEditDocumentId](../../packages/capability-sdk/src/file/node/workspace.ts#L422)?：函数，第?? 422 ?? 行。
- [downloadFileArtifact](../../packages/capability-sdk/src/file/node/workspace.ts#L439)?：函数，第?? 439 ?? 行。
- [convertFileArtifact](../../packages/capability-sdk/src/file/node/workspace.ts#L445)?：函数，第?? 445 ?? 行。
- [listOfficeDraftCatalog](../../packages/capability-sdk/src/file/node/workspace.ts#L471)?：函数，第?? 471 ?? 行。
- [listOfficeDrafts](../../packages/capability-sdk/src/file/node/workspace.ts#L518)?：函数，第?? 518 ?? 行。
- [officeDraftCatalogForPrompt](../../packages/capability-sdk/src/file/node/workspace.ts#L530)?：函数，第?? 530 ?? 行。
- [invalidateActiveVisualQa](../../packages/capability-sdk/src/file/node/workspace.ts#L542)?：函数，第?? 542 ?? 行。
- [sourceUnitForRequestedPath](../../packages/capability-sdk/src/file/node/workspace.ts#L559)?：函数，第?? 559 ?? 行。
- [readUnoDraftUnlocked](../../packages/capability-sdk/src/file/node/workspace.ts#L564)?：函数，第?? 564 ?? 行。
- [getUnoApi](../../packages/capability-sdk/src/file/node/workspace.ts#L718)?：函数，第?? 718 ?? 行。
- [getUnoApiUnlocked](../../packages/capability-sdk/src/file/node/workspace.ts#L730)?：函数，第?? 730 ?? 行。
- [getOfficeJsApi](../../packages/capability-sdk/src/file/node/workspace.ts#L804)?：函数，第?? 804 ?? 行。
- [assertOfficeValidationPassed](../../packages/capability-sdk/src/file/node/workspace.ts#L905)?：函数，第?? 905 ?? 行。
- [includeGeneratedRuntimeValidation](../../packages/capability-sdk/src/file/node/workspace.ts#L916)?：函数，第?? 916 ?? 行。
- [includeRendererValidation](../../packages/capability-sdk/src/file/node/workspace.ts#L932)?：函数，第?? 932 ?? 行。
- [officeQualityGate](../../packages/capability-sdk/src/file/node/workspace.ts#L947)?：函数，第?? 947 ?? 行。
- [generatedElementMap](../../packages/capability-sdk/src/file/node/workspace.ts#L968)?：函数，第?? 968 ?? 行。
- [generatedVerificationIssues](../../packages/capability-sdk/src/file/node/workspace.ts#L977)?：函数，第?? 977 ?? 行。
- [generatedFeatureCounts](../../packages/capability-sdk/src/file/node/workspace.ts#L1030)?：函数，第?? 1030 ?? 行。
- [generatedRuntimeDiagnostics](../../packages/capability-sdk/src/file/node/workspace.ts#L1039)?：函数，第?? 1039 ?? 行。
- [officeValidationCacheBaseName](../../packages/capability-sdk/src/file/node/workspace.ts#L1057)?：函数，第?? 1057 ?? 行。
- [requestedPresentationCapabilities](../../packages/capability-sdk/src/file/node/workspace.ts#L1074)?：函数，第?? 1074 ?? 行。
- [missingRequestedPresentationCapabilityDiagnostics](../../packages/capability-sdk/src/file/node/workspace.ts#L1084)?：函数，第?? 1084 ?? 行。
- [validationCachePaths](../../packages/capability-sdk/src/file/node/workspace.ts#L1102)?：函数，第?? 1102 ?? 行。
- [clearValidationCacheFiles](../../packages/capability-sdk/src/file/node/workspace.ts#L1119)?：函数，第?? 1119 ?? 行。
- [documentAssetsFingerprint](../../packages/capability-sdk/src/file/node/workspace.ts#L1128)?：函数，第?? 1128 ?? 行。
- [generateValidatedDraftCandidate](../../packages/capability-sdk/src/file/node/workspace.ts#L1146)?：函数，第?? 1146 ?? 行。
- [prepareValidatedDraft](../../packages/capability-sdk/src/file/node/workspace.ts#L1224)?：函数，第?? 1224 ?? 行。
- [validateDraft](../../packages/capability-sdk/src/file/node/workspace.ts#L1355)?：函数，第?? 1355 ?? 行。
- [validateDraftSourceUnit](../../packages/capability-sdk/src/file/node/workspace.ts#L1446)?：函数，第?? 1446 ?? 行。
- [renderDraft](../../packages/capability-sdk/src/file/node/workspace.ts#L1650)?：函数，第?? 1650 ?? 行。
- [planFileArtifactUnlocked](../../packages/capability-sdk/src/file/node/workspace.ts#L1848)?：函数，第?? 1848 ?? 行。
- [generateUnoFileArtifactUnlocked](../../packages/capability-sdk/src/file/node/workspace.ts#L1977)?：函数，第?? 1977 ?? 行。
- [editUnoFileArtifactUnlocked](../../packages/capability-sdk/src/file/node/workspace.ts#L2019)?：函数，第?? 2019 ?? 行。
- [renderFileArtifactUnlocked](../../packages/capability-sdk/src/file/node/workspace.ts#L2227)?：函数，第?? 2227 ?? 行。
- [readUnoDraft](../../packages/capability-sdk/src/file/node/workspace.ts#L2238)?：函数，第?? 2238 ?? 行。
- [planFileArtifact](../../packages/capability-sdk/src/file/node/workspace.ts#L2247)?：函数，第?? 2247 ?? 行。
- [generateUnoFileArtifact](../../packages/capability-sdk/src/file/node/workspace.ts#L2275)?：函数，第?? 2275 ?? 行。
- [editUnoFileArtifact](../../packages/capability-sdk/src/file/node/workspace.ts#L2284)?：函数，第?? 2284 ?? 行。
- [renderFileArtifact](../../packages/capability-sdk/src/file/node/workspace.ts#L2293)?：函数，第?? 2293 ?? 行。
- [bindNodeFileWorkspaceOperation](../../packages/capability-sdk/src/file/node/workspace.ts#L2302)?：函数，第?? 2302 ?? 行。
- [legacyOperationData](../../packages/capability-sdk/src/file/node/workspace.ts#L2309)?：函数，第?? 2309 ?? 行。
- [structuredOperationErrorCode](../../packages/capability-sdk/src/file/node/workspace.ts#L2317)?：函数，第?? 2317 ?? 行。
- [structuredFileOperationResult](../../packages/capability-sdk/src/file/node/workspace.ts#L2324)?：函数，第?? 2324 ?? 行。
- [bindNodeFileWorkspaceResultOperation](../../packages/capability-sdk/src/file/node/workspace.ts#L2344)?：函数，第?? 2344 ?? 行。
- [createNodeFileWorkspace](../../packages/capability-sdk/src/file/node/workspace.ts#L2360)?：函数，第?? 2360 ?? 行。

### [packages/capability-sdk/src/file/node/workspace-host.ts](../../packages/capability-sdk/src/file/node/workspace-host.ts)

- [resolveNodeFileWorkspaceHost](../../packages/capability-sdk/src/file/node/workspace-host.ts#L30)?：函数，第?? 30 ?? 行。
- [currentNodeFileWorkspaceHost](../../packages/capability-sdk/src/file/node/workspace-host.ts#L64)?：函数，第?? 64 ?? 行。
- [disposeDefaultNodeFileWorkspace](../../packages/capability-sdk/src/file/node/workspace-host.ts#L79)?：函数，第?? 79 ?? 行。

### [packages/capability-sdk/src/file/node/workspace-draft-store.ts](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts)

- [artifactDir](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L23)?：函数，第?? 23 ?? 行。
- [draftPath](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L27)?：函数，第?? 27 ?? 行。
- [draftProgramPath](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L31)?：函数，第?? 31 ?? 行。
- [draftTransactionPath](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L38)?：函数，第?? 38 ?? 行。
- [draftLockPath](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L42)?：函数，第?? 42 ?? 行。
- [requireDocumentId](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L46)?：函数，第?? 46 ?? 行。
- [acquireFilesystemDraftLock](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L54)?：函数，第?? 54 ?? 行。
- [withDraftLock](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L94)?：函数，第?? 94 ?? 行。
- [writeDraftJsonAtomically](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L115)?：函数，第?? 115 ?? 行。
- [recoverDraftTransaction](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L125)?：函数，第?? 125 ?? 行。
- [loadDraft](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L161)?：函数，第?? 161 ?? 行。
- [writeDraftWorkspace](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L219)?：函数，第?? 219 ?? 行。
- [saveDraft](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L247)?：函数，第?? 247 ?? 行。
- [saveWorkingDraft](../../packages/capability-sdk/src/file/node/workspace-draft-store.ts#L256)?：函数，第?? 256 ?? 行。

### [packages/capability-sdk/src/file/node/workspace-source-editor.ts](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts)

- [sourceDigest](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L6)?：函数，第?? 6 ?? 行。
- [normalizedDraftSource](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L10)?：函数，第?? 10 ?? 行。
- [normalizedSourceUnitPath](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L28)?：函数，第?? 28 ?? 行。
- [parseSourceUnits](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L36)?：函数，第?? 36 ?? 行。
- [inferredUnitSegment](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L56)?：函数，第?? 56 ?? 行。
- [inferredPythonSymbolSourceUnits](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L65)?：函数，第?? 65 ?? 行。
- [pythonCallEndIndex](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L109)?：函数，第?? 109 ?? 行。
- [inferredPythonSlideFactoryCallUnits](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L139)?：函数，第?? 139 ?? 行。
- [uniqueInferredSourceUnitPaths](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L178)?：函数，第?? 178 ?? 行。
- [inferredPresentationSourceUnits](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L193)?：函数，第?? 193 ?? 行。
- [inferredWriterSourceUnits](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L248)?：函数，第?? 248 ?? 行。
- [inferredCalcSourceUnits](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L285)?：函数，第?? 285 ?? 行。
- [sourceUnitsForDraft](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L323)?：函数，第?? 323 ?? 行。
- [replaceSourceUnit](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L342)?：函数，第?? 342 ?? 行。
- [isolateSourceUnit](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L348)?：函数，第?? 348 ?? 行。
- [synchronizeSourceUnits](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L367)?：函数，第?? 367 ?? 行。
- [draftSourceLineCount](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L387)?：函数，第?? 387 ?? 行。
- [emptyCodexDraftPatchChunk](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L400)?：函数，第?? 400 ?? 行。
- [parseCodexDraftPatch](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L404)?：函数，第?? 404 ?? 行。
- [codexDraftPatchChunkHasChange](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L487)?：函数，第?? 487 ?? 行。
- [seekCodexPatchSequence](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L492)?：函数，第?? 492 ?? 行。
- [codexDraftPatchReplacements](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L510)?：函数，第?? 510 ?? 行。
- [applyUnoDraftPatch](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L573)?：函数，第?? 573 ?? 行。
- [replacementConflictSourceContext](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L585)?：函数，第?? 585 ?? 行。
- [sourceEditRangesOverlap](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L617)?：函数，第?? 617 ?? 行。
- [applyUnoDraftPatchHunks](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L624)?：函数，第?? 624 ?? 行。
- [applyUnoDraftReplacements](../../packages/capability-sdk/src/file/node/workspace-source-editor.ts#L686)?：函数，第?? 686 ?? 行。

### [packages/capability-sdk/src/file/node/workspace-visual-qa.ts](../../packages/capability-sdk/src/file/node/workspace-visual-qa.ts)

- [failedPageVisualChecks](../../packages/capability-sdk/src/file/node/workspace-visual-qa.ts#L19)?：函数，第?? 19 ?? 行。
- [failedDeckVisualChecks](../../packages/capability-sdk/src/file/node/workspace-visual-qa.ts#L32)?：函数，第?? 32 ?? 行。
- [verifyCurrentUnoRenderedArtifact](../../packages/capability-sdk/src/file/node/workspace-visual-qa.ts#L49)?：函数，第?? 49 ?? 行。
- [versionedRenderedArtifact](../../packages/capability-sdk/src/file/node/workspace-visual-qa.ts#L85)?：函数，第?? 85 ?? 行。
- [recordOfficeVisualQaProgress](../../packages/capability-sdk/src/file/node/workspace-visual-qa.ts#L96)?：函数，第?? 96 ?? 行。

### [packages/capability-sdk/src/file/node/workspace-result.ts](../../packages/capability-sdk/src/file/node/workspace-result.ts)

- [escapeMarkdownLinkLabel](../../packages/capability-sdk/src/file/node/workspace-result.ts#L92)?：函数，第?? 92 ?? 行。
- [compactAutomaticValidation](../../packages/capability-sdk/src/file/node/workspace-result.ts#L96)?：函数，第?? 96 ?? 行。
- [compactVisualVerification](../../packages/capability-sdk/src/file/node/workspace-result.ts#L113)?：函数，第?? 113 ?? 行。
- [compactOfficeFailure](../../packages/capability-sdk/src/file/node/workspace-result.ts#L124)?：函数，第?? 124 ?? 行。
- [officeValidationRepairHints](../../packages/capability-sdk/src/file/node/workspace-result.ts#L196)?：函数，第?? 196 ?? 行。
- [formatFileArtifactResult](../../packages/capability-sdk/src/file/node/workspace-result.ts#L325)?：函数，第?? 325 ?? 行。

### [packages/capability-sdk/src/file/node/download.ts](../../packages/capability-sdk/src/file/node/download.ts)

- [parseContentDispositionFileName](../../packages/capability-sdk/src/file/node/download.ts#L82)?：函数，第?? 82 ?? 行。
- [fileNameFromUrl](../../packages/capability-sdk/src/file/node/download.ts#L95)?：函数，第?? 95 ?? 行。
- [normalizedDownloadFileType](../../packages/capability-sdk/src/file/node/download.ts#L105)?：函数，第?? 105 ?? 行。
- [resolveDownloadUrl](../../packages/capability-sdk/src/file/node/download.ts#L113)?：函数，第?? 113 ?? 行。
- [alternateWikimediaThumbnailUrls](../../packages/capability-sdk/src/file/node/download.ts#L131)?：函数，第?? 131 ?? 行。
- [preferredDownloadUrl](../../packages/capability-sdk/src/file/node/download.ts#L153)?：函数，第?? 153 ?? 行。
- [writeLimitedResponse](../../packages/capability-sdk/src/file/node/download.ts#L166)?：函数，第?? 166 ?? 行。
- [createNodeFileDownloader](../../packages/capability-sdk/src/file/node/download.ts#L194)?：函数，第?? 194 ?? 行。

### [packages/capability-sdk/src/file/node/convert.ts](../../packages/capability-sdk/src/file/node/convert.ts)

- [createNodeFileConverter](../../packages/capability-sdk/src/file/node/convert.ts#L83)?：函数，第?? 83 ?? 行。

### [packages/capability-sdk/src/file/node/read.ts](../../packages/capability-sdk/src/file/node/read.ts)

- [normalizeFileReadLimit](../../packages/capability-sdk/src/file/node/read.ts#L39)?：函数，第?? 39 ?? 行。
- [assertVisualQaPageChecks](../../packages/capability-sdk/src/file/node/read.ts#L55)?：函数，第?? 55 ?? 行。
- [assertVisualQaDeckChecks](../../packages/capability-sdk/src/file/node/read.ts#L67)?：函数，第?? 67 ?? 行。
- [normalizedOffset](../../packages/capability-sdk/src/file/node/read.ts#L86)?：函数，第?? 86 ?? 行。
- [extensionOf](../../packages/capability-sdk/src/file/node/read.ts#L91)?：函数，第?? 91 ?? 行。
- [formatSize](../../packages/capability-sdk/src/file/node/read.ts#L95)?：函数，第?? 95 ?? 行。
- [attachmentKind](../../packages/capability-sdk/src/file/node/read.ts#L101)?：函数，第?? 101 ?? 行。
- [isImageFileAttachment](../../packages/capability-sdk/src/file/node/read.ts#L111)?：函数，第?? 111 ?? 行。
- [fileAttachmentMetadata](../../packages/capability-sdk/src/file/node/read.ts#L115)?：函数，第?? 115 ?? 行。
- [extractAttachmentText](../../packages/capability-sdk/src/file/node/read.ts#L119)?：函数，第?? 119 ?? 行。
- [readFileAttachment](../../packages/capability-sdk/src/file/node/read.ts#L146)?：函数，第?? 146 ?? 行。
- [screenshotPage](../../packages/capability-sdk/src/file/node/read.ts#L217)?：函数，第?? 217 ?? 行。
- [readFileVisuals](../../packages/capability-sdk/src/file/node/read.ts#L230)?：函数，第?? 230 ?? 行。

### [packages/capability-sdk/src/file/node/write.ts](../../packages/capability-sdk/src/file/node/write.ts)

- [writeTextFileArtifact](../../packages/capability-sdk/src/file/node/write.ts#L19)?：函数，第?? 19 ?? 行。

### [packages/capability-sdk/src/file/node/text-extraction.ts](../../packages/capability-sdk/src/file/node/text-extraction.ts)

该模块以契约、数据、脚本入口或对象方法为主；直接按上方源码链接阅读。

### [packages/capability-sdk/src/file/node/text-extraction-pool.ts](../../packages/capability-sdk/src/file/node/text-extraction-pool.ts)

- [configureNodeFileTextExtractionObserver](../../packages/capability-sdk/src/file/node/text-extraction-pool.ts#L20)?：函数，第?? 20 ?? 行。
- [integer](../../packages/capability-sdk/src/file/node/text-extraction-pool.ts#L37)?：函数，第?? 37 ?? 行。
- [gauges](../../packages/capability-sdk/src/file/node/text-extraction-pool.ts#L46)?：函数，第?? 46 ?? 行。
- [retire](../../packages/capability-sdk/src/file/node/text-extraction-pool.ts#L51)?：函数，第?? 51 ?? 行。
- [workerPath](../../packages/capability-sdk/src/file/node/text-extraction-pool.ts#L64)?：函数，第?? 64 ?? 行。
- [parse](../../packages/capability-sdk/src/file/node/text-extraction-pool.ts#L77)?：函数，第?? 77 ?? 行。
- [extractFileTextInWorker](../../packages/capability-sdk/src/file/node/text-extraction-pool.ts#L150)?：函数，第?? 150 ?? 行。
- [nodeFileTextExtractionPoolSnapshot](../../packages/capability-sdk/src/file/node/text-extraction-pool.ts#L195)?：函数，第?? 195 ?? 行。
- [disposeNodeFileTextExtractionPool](../../packages/capability-sdk/src/file/node/text-extraction-pool.ts#L196)?：函数，第?? 196 ?? 行。

### [packages/capability-sdk/src/file/node/visual-index.ts](../../packages/capability-sdk/src/file/node/visual-index.ts)

- [fileVisualScreenshotId](../../packages/capability-sdk/src/file/node/visual-index.ts#L5)?：函数，第?? 5 ?? 行。
- [createFileVisualIndex](../../packages/capability-sdk/src/file/node/visual-index.ts#L10)?：函数，第?? 10 ?? 行。

### [packages/capability-sdk/src/file/node/office-authoring.ts](../../packages/capability-sdk/src/file/node/office-authoring.ts)

- [officeAuthoringGuidance](../../packages/capability-sdk/src/file/node/office-authoring.ts#L7)?：函数，第?? 7 ?? 行。

### [packages/capability-sdk/src/file/node/office-body.ts](../../packages/capability-sdk/src/file/node/office-body.ts)

- [compileOfficeBody](../../packages/capability-sdk/src/file/node/office-body.ts#L10)?：函数，第?? 10 ?? 行。

### [packages/capability-sdk/src/file/node/office/uno.ts](../../packages/capability-sdk/src/file/node/office/uno.ts)

- [assertControlledUnoProgram](../../packages/capability-sdk/src/file/node/office/uno.ts#L46)?：函数，第?? 46 ?? 行。
- [isTransientUnoBridgeError](../../packages/capability-sdk/src/file/node/office/uno.ts#L52)?：函数，第?? 52 ?? 行。
- [isUnoBridgeStartupError](../../packages/capability-sdk/src/file/node/office/uno.ts#L57)?：函数，第?? 57 ?? 行。
- [isUnoWorkerInternalError](../../packages/capability-sdk/src/file/node/office/uno.ts#L61)?：函数，第?? 61 ?? 行。
- [isUnoStylePropertyInfoError](../../packages/capability-sdk/src/file/node/office/uno.ts#L66)?：函数，第?? 66 ?? 行。
- [resolveUnoProgramWorker](../../packages/capability-sdk/src/file/node/office/uno.ts#L72)?：函数，第?? 72 ?? 行。
- [disposeUnoRuntime](../../packages/capability-sdk/src/file/node/office/uno.ts#L100)?：函数，第?? 100 ?? 行。
- [abortReason](../../packages/capability-sdk/src/file/node/office/uno.ts#L107)?：函数，第?? 107 ?? 行。
- [terminateWorkerProcessTree](../../packages/capability-sdk/src/file/node/office/uno.ts#L111)?：函数，第?? 111 ?? 行。
- [runWorker](../../packages/capability-sdk/src/file/node/office/uno.ts#L144)?：函数，第?? 144 ?? 行。
- [inspectUnoApiUncached](../../packages/capability-sdk/src/file/node/office/uno.ts#L252)?：函数，第?? 252 ?? 行。
- [stopPersistentUnoHost](../../packages/capability-sdk/src/file/node/office/uno.ts#L286)?：函数，第?? 286 ?? 行。
- [ensurePersistentUnoHost](../../packages/capability-sdk/src/file/node/office/uno.ts#L293)?：函数，第?? 293 ?? 行。
- [withPersistentUnoHost](../../packages/capability-sdk/src/file/node/office/uno.ts#L328)?：函数，第?? 328 ?? 行。
- [inspectUnoApi](../../packages/capability-sdk/src/file/node/office/uno.ts#L339)?：函数，第?? 339 ?? 行。
- [readUnoDocument](../../packages/capability-sdk/src/file/node/office/uno.ts#L379)?：函数，第?? 379 ?? 行。
- [generateUnoProgramDocument](../../packages/capability-sdk/src/file/node/office/uno.ts#L437)?：函数，第?? 437 ?? 行。

### [packages/capability-sdk/src/file/node/office/javascript.ts](../../packages/capability-sdk/src/file/node/office/javascript.ts)

- [assertControlledOfficeJsProgram](../../packages/capability-sdk/src/file/node/office/javascript.ts#L23)?：函数，第?? 23 ?? 行。
- [resolveOfficeJsProgramWorker](../../packages/capability-sdk/src/file/node/office/javascript.ts#L33)?：函数，第?? 33 ?? 行。
- [runWorker](../../packages/capability-sdk/src/file/node/office/javascript.ts#L61)?：函数，第?? 61 ?? 行。
- [generateOfficeJsProgramDocument](../../packages/capability-sdk/src/file/node/office/javascript.ts#L95)?：函数，第?? 95 ?? 行。

### [packages/capability-sdk/src/file/node/office/html.ts](../../packages/capability-sdk/src/file/node/office/html.ts)

- [alignment](../../packages/capability-sdk/src/file/node/office/html.ts#L17)?：函数变量，第?? 17 ?? 行。
- [tableCellStyle](../../packages/capability-sdk/src/file/node/office/html.ts#L20)?：函数，第?? 20 ?? 行。
- [wordBorders](../../packages/capability-sdk/src/file/node/office/html.ts#L37)?：函数，第?? 37 ?? 行。
- [wordBlocks](../../packages/capability-sdk/src/file/node/office/html.ts#L48)?：函数，第?? 48 ?? 行。
- [writeSlides](../../packages/capability-sdk/src/file/node/office/html.ts#L93)?：函数，第?? 93 ?? 行。
- [generateHtmlOfficeDocument](../../packages/capability-sdk/src/file/node/office/html.ts#L172)?：函数，第?? 172 ?? 行。
- [htmlOfficeRuntimeSource](../../packages/capability-sdk/src/file/node/office/html.ts#L268)?：函数，第?? 268 ?? 行。

### [packages/capability-sdk/src/file/node/office/validation.ts](../../packages/capability-sdk/src/file/node/office/validation.ts)

- [normalizedFontName](../../packages/capability-sdk/src/file/node/office/validation.ts#L34)?：函数，第?? 34 ?? 行。
- [installedFontNames](../../packages/capability-sdk/src/file/node/office/validation.ts#L50)?：函数，第?? 50 ?? 行。
- [expectedPackageEntry](../../packages/capability-sdk/src/file/node/office/validation.ts#L71)?：函数，第?? 71 ?? 行。
- [mediaPrefix](../../packages/capability-sdk/src/file/node/office/validation.ts#L79)?：函数，第?? 79 ?? 行。
- [xmlAttribute](../../packages/capability-sdk/src/file/node/office/validation.ts#L87)?：函数，第?? 87 ?? 行。
- [mappedIssue](../../packages/capability-sdk/src/file/node/office/validation.ts#L91)?：函数，第?? 91 ?? 行。
- [validateRelationships](../../packages/capability-sdk/src/file/node/office/validation.ts#L104)?：函数，第?? 104 ?? 行。
- [validatePresentationPackage](../../packages/capability-sdk/src/file/node/office/validation.ts#L131)?：函数，第?? 131 ?? 行。
- [validateWordPackage](../../packages/capability-sdk/src/file/node/office/validation.ts#L210)?：函数，第?? 210 ?? 行。
- [validateSpreadsheetPackage](../../packages/capability-sdk/src/file/node/office/validation.ts#L226)?：函数，第?? 226 ?? 行。
- [officePackageFormatChecks](../../packages/capability-sdk/src/file/node/office/validation.ts#L249)?：函数，第?? 249 ?? 行。
- [preserveOnlyFeatureCounts](../../packages/capability-sdk/src/file/node/office/validation.ts#L346)?：函数，第?? 346 ?? 行。
- [validatePreserveOnlyFeatures](../../packages/capability-sdk/src/file/node/office/validation.ts#L393)?：函数，第?? 393 ?? 行。
- [validatePdf](../../packages/capability-sdk/src/file/node/office/validation.ts#L418)?：函数，第?? 418 ?? 行。
- [validateOfficeArtifact](../../packages/capability-sdk/src/file/node/office/validation.ts#L438)?：函数，第?? 438 ?? 行。
- [inspectRenderedPage](../../packages/capability-sdk/src/file/node/office/validation.ts#L606)?：函数，第?? 606 ?? 行。

### [packages/capability-sdk/src/file/node/office/program-analysis.ts](../../packages/capability-sdk/src/file/node/office/program-analysis.ts)

- [diagnosticSourceExcerpt](../../packages/capability-sdk/src/file/node/office/program-analysis.ts#L31)?：函数，第?? 31 ?? 行。
- [draftTracebackLineNumbers](../../packages/capability-sdk/src/file/node/office/program-analysis.ts#L69)?：函数，第?? 69 ?? 行。
- [lineAndColumn](../../packages/capability-sdk/src/file/node/office/program-analysis.ts#L77)?：函数，第?? 77 ?? 行。
- [javascriptDiagnostics](../../packages/capability-sdk/src/file/node/office/program-analysis.ts#L83)?：函数，第?? 83 ?? 行。
- [pythonDiagnostics](../../packages/capability-sdk/src/file/node/office/program-analysis.ts#L127)?：函数，第?? 127 ?? 行。
- [analyzeOfficeProgram](../../packages/capability-sdk/src/file/node/office/program-analysis.ts#L722)?：函数，第?? 722 ?? 行。
- [diagnoseOfficeProgramRuntimeError](../../packages/capability-sdk/src/file/node/office/program-analysis.ts#L740)?：函数，第?? 740 ?? 行。

### [packages/capability-sdk/src/file/node/office/validation-evidence.ts](../../packages/capability-sdk/src/file/node/office/validation-evidence.ts)

- [currentUnoWorkerDigest](../../packages/capability-sdk/src/file/node/office/validation-evidence.ts#L9)?：函数，第?? 9 ?? 行。
- [beginOfficeValidation](../../packages/capability-sdk/src/file/node/office/validation-evidence.ts#L18)?：函数，第?? 18 ?? 行。
- [officeValidationEvidence](../../packages/capability-sdk/src/file/node/office/validation-evidence.ts#L29)?：函数，第?? 29 ?? 行。

### [packages/capability-sdk/src/file/node/office/render-validation.ts](../../packages/capability-sdk/src/file/node/office/render-validation.ts)

- [pdfSummary](../../packages/capability-sdk/src/file/node/office/render-validation.ts#L18)?：函数，第?? 18 ?? 行。
- [validateOfficeRendererMatrix](../../packages/capability-sdk/src/file/node/office/render-validation.ts#L30)?：函数，第?? 30 ?? 行。

### [src/server/capabilities/browser-chat-file.ts](../../src/server/capabilities/browser-chat-file.ts)

- [progressReporter](../../src/server/capabilities/browser-chat-file.ts#L37)?：函数，第?? 37 ?? 行。
- [unavailable](../../src/server/capabilities/browser-chat-file.ts#L43)?：函数，第?? 43 ?? 行。
- [createBrowserChatFileOperations](../../src/server/capabilities/browser-chat-file.ts#L47)?：函数，第?? 47 ?? 行。
- [createBrowserChatFileCapability](../../src/server/capabilities/browser-chat-file.ts#L231)?：函数，第?? 231 ?? 行。
- [executeBrowserChatFile](../../src/server/capabilities/browser-chat-file.ts#L240)?：函数，第?? 240 ?? 行。

### [src/server/capabilities/webpilot-file-workspace.ts](../../src/server/capabilities/webpilot-file-workspace.ts)

- [createWebPilotFileWorkspace](../../src/server/capabilities/webpilot-file-workspace.ts#L6)?：函数，第?? 6 ?? 行。

### [src/server/capabilities/browser-chat-file-links.ts](../../src/server/capabilities/browser-chat-file-links.ts)

- [verifiedArtifactDownloadUrl](../../src/server/capabilities/browser-chat-file-links.ts#L24)?：函数，第?? 24 ?? 行。
- [fileArtifactDownloadsFromToolResult](../../src/server/capabilities/browser-chat-file-links.ts#L35)?：函数，第?? 35 ?? 行。
- [artifactMarkdownUrl](../../src/server/capabilities/browser-chat-file-links.ts#L56)?：函数，第?? 56 ?? 行。
- [normalizedMarkdownLinkLabel](../../src/server/capabilities/browser-chat-file-links.ts#L65)?：函数，第?? 65 ?? 行。
- [repairArtifactDownloadLinks](../../src/server/capabilities/browser-chat-file-links.ts#L72)?：函数，第?? 72 ?? 行。
- [repairFileArtifactDownloadLinks](../../src/server/capabilities/browser-chat-file-links.ts#L101)?：函数，第?? 101 ?? 行。

### [src/server/ai/agents/browser-chat-file-model-output.ts](../../src/server/ai/agents/browser-chat-file-model-output.ts)

- [fileToolModelOutput](../../src/server/ai/agents/browser-chat-file-model-output.ts#L5)?：函数，第?? 5 ?? 行。

### [packages/capability-sdk/runtime/file/javascript/office-js-program-worker.mjs](../../packages/capability-sdk/runtime/file/javascript/office-js-program-worker.mjs)

- [value](../../packages/capability-sdk/runtime/file/javascript/office-js-program-worker.mjs#L8)?：函数，第?? 8 ?? 行。
- [progress](../../packages/capability-sdk/runtime/file/javascript/office-js-program-worker.mjs#L19)?：函数，第?? 19 ?? 行。
- [assetPath](../../packages/capability-sdk/runtime/file/javascript/office-js-program-worker.mjs#L23)?：函数，第?? 23 ?? 行。
- [normalizeOutputBytes](../../packages/capability-sdk/runtime/file/javascript/office-js-program-worker.mjs#L32)?：函数，第?? 32 ?? 行。
- [main](../../packages/capability-sdk/runtime/file/javascript/office-js-program-worker.mjs#L39)?：函数，第?? 39 ?? 行。

### [packages/capability-sdk/runtime/file/javascript/text-extraction-worker.cjs](../../packages/capability-sdk/runtime/file/javascript/text-extraction-worker.cjs)

- [zipFrom](../../packages/capability-sdk/runtime/file/javascript/text-extraction-worker.cjs#L5)?：函数，第?? 5 ?? 行。
- [extract](../../packages/capability-sdk/runtime/file/javascript/text-extraction-worker.cjs#L10)?：函数，第?? 10 ?? 行。

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
        "list",
        "readSource",
        "readContent",
        "download",
        "write",
        "convert",
        "plan",
        "generate",
        "edit",
        "unoApi",
        "jsApi",
        "render",
        "visualIndex",
        "visualRead",
        "visualReport"
      ],
      "description": "Required. write + fileName + content publishes text/code files immediately. readSource + documentId = editable Office generation code; readContent + artifactId/attachmentId = file text/data; visualIndex/visualRead/visualReport = rendered-page QA. generate/edit validate Office source; render publishes it."
    },
    "reason": {
      "description": "User-visible explanation only. Saying \"read source\" here does NOT select source reading; action and identity fields control behavior.",
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "attachmentId": {
      "description": "For readContent: exact uploaded attachment id. Not a draft id and not usable to read generation source.",
      "type": "string",
      "maxLength": 160
    },
    "artifactId": {
      "description": "For readContent/visualIndex/visualRead/visualReport: exact finished-file artifact id from render/download/convert. Reading an .xlsx artifact returns spreadsheet content, NOT Python source.",
      "type": "string",
      "maxLength": 4000
    },
    "sourceArtifactId": {
      "description": "For convert: exact artifact id of the existing Office file to export as PDF. Does not read or modify generation source.",
      "type": "string",
      "maxLength": 4000
    },
    "documentId": {
      "description": "Required for readSource/generate/edit/render; copy from plan/list. Optional for a new plan (generated automatically) and unoApi/jsApi (unbound documentation reads). Re-plan an existing document using its returned id. New ids use 1-96 ASCII letters/numbers/dot/underscore/hyphen.",
      "type": "string",
      "maxLength": 96
    },
    "fileName": {
      "description": "For write/plan/download/convert: output name with extension. Required for write; optional for plan, which derives it from the intent/title and documentType when omitted. A name is not an artifactId or documentId. The bundled convert outputs PDF only.",
      "type": "string",
      "maxLength": 180
    },
    "content": {
      "description": "For write only: exact UTF-8 text to save as a downloadable file (Markdown, HTML, code, configuration, CSV, etc.). Preserves whitespace and empty strings. No Markdown fences unless part of the requested file. Does not execute code or render Office documents.",
      "type": "string",
      "maxLength": 1000000
    },
    "fileType": {
      "description": "For download: expected extension without a dot.",
      "type": "string",
      "pattern": "^[a-z0-9]{1,10}$"
    },
    "documentType": {
      "description": "Required for plan. Optional for unoApi/jsApi: choose word/spreadsheet/presentation to read that API without a documentId; omit both to get the document-type index. Common Office extension aliases are normalized before validation.",
      "type": "string",
      "enum": [
        "word",
        "spreadsheet",
        "presentation"
      ]
    },
    "operation": {
      "description": "For plan: create a new document or modify an attached existing Office document.",
      "type": "string",
      "enum": [
        "create",
        "modify"
      ]
    },
    "sourceAttachmentId": {
      "description": "For operation=modify: exact attachment id of the existing Office file.",
      "type": "string",
      "maxLength": 160
    },
    "intent": {
      "description": "For plan: concise description of the document to create or modify.",
      "type": "string",
      "maxLength": 8000
    },
    "design": {
      "description": "For initial plan: template for conventional fast files; bespoke for original art direction. Bespoke records audience/objective, 2–3 distinct directions (or one grounded user reference), selectedDirection, selectionReason and page rhythm. This is not a visual pass or permission to delete requested content.",
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": [
            "template",
            "bespoke"
          ]
        },
        "audience": {
          "type": "string",
          "minLength": 1,
          "maxLength": 320
        },
        "objective": {
          "type": "string",
          "minLength": 1,
          "maxLength": 320
        },
        "reference": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500,
          "description": "A concrete user-supplied deck, image, URL or named visual reference that fixes composition. Quality adjectives such as world-class, Swiss precision, restrained or cinematic are NOT a reference; compare 2-3 distinct directions instead."
        },
        "directions": {
          "minItems": 1,
          "maxItems": 3,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "minLength": 1,
                "maxLength": 40
              },
              "concept": {
                "type": "string",
                "minLength": 1,
                "maxLength": 320
              },
              "composition": {
                "type": "string",
                "minLength": 1,
                "maxLength": 320
              },
              "typography": {
                "type": "string",
                "minLength": 1,
                "maxLength": 320
              },
              "imagery": {
                "type": "string",
                "minLength": 1,
                "maxLength": 320
              }
            },
            "required": [
              "id",
              "concept",
              "composition",
              "typography",
              "imagery"
            ],
            "additionalProperties": false
          }
        },
        "selectedDirection": {
          "type": "string",
          "minLength": 1,
          "maxLength": 40
        },
        "selectionReason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 320
        },
        "rhythm": {
          "type": "string",
          "minLength": 1,
          "maxLength": 320
        },
        "preserve": {
          "description": "At most 8 strings, each at most 320 characters. A semicolon/newline-separated string is also accepted and normalized to an array.",
          "maxItems": 8,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 320
          }
        },
        "avoid": {
          "description": "At most 8 strings, each at most 320 characters. A semicolon/newline-separated string is also accepted and normalized to an array.",
          "maxItems": 8,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 320
          }
        }
      },
      "required": [
        "mode"
      ],
      "additionalProperties": false
    },
    "url": {
      "description": "For download: verified direct file URL, not a search result, preview webpage, artifactId or source-unit path.",
      "type": "string",
      "maxLength": 8000
    },
    "path": {
      "description": "For readSource/edit: exact source-unit path returned by readSource, not draft.py, an Office filename or filesystem path. For download: legacy alias of urlOrPath, accepting an HTTP(S) URL or page-relative URL path; local filesystem paths are unsupported.",
      "type": "string",
      "maxLength": 8000
    },
    "startLine": {
      "description": "For readSource only: one-based first code line; use the returned coordinateSpace when a source-unit path is selected. Maximum 80 lines per response.",
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "endLine": {
      "description": "For readSource only: inclusive last code line, at least startLine. This is not a worksheet row or PDF page number.",
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "includeDiagnostics": {
      "description": "readSource only, default false: include saved diagnostic details, NOT a new validation run. Check validationEvidence source/worker freshness before treating old errors as current blockers. Ordinary reads return counts, not full warnings.",
      "type": "boolean"
    },
    "urlOrPath": {
      "description": "For download: real HTTP(S) file URL or page-relative URL path resolved against sourcePageUrl. Not an operating-system path. Local assets must be uploaded/host-bound attachments. Supply exactly one of urlOrPath/url/path.",
      "type": "string",
      "maxLength": 8000
    },
    "program": {
      "description": "Advanced generate input: complete HTML, or complete Python/JavaScript source with the engine entrypoint. UNO requires def create_document(job): and exactly one document save/close. Prefer body to omit this boilerplate. Choose exactly one of body or program. readSource returns the complete stored source; use edit for repairs.",
      "type": "string"
    },
    "body": {
      "description": "Preferred custom generate input. UNO: Python content operations using the provided deck (presentation), document (Word/flowing PDF), or workbook (Excel) variable. ExcelJS: JavaScript using provided workbook; await is allowed. HTML: a fragment, with section[data-slide] for PPTX. The SDK creates the document and adds entrypoint/save/close or HTML shell. Do not include those yourself. Follow plan.sourceGuidance. Choose exactly one of body or program. Repairs use edit on the complete source returned by readSource.",
      "type": "string",
      "minLength": 1,
      "maxLength": 1000000
    },
    "patch": {
      "description": "For edit, use patch OR replacements. Codex patch: Begin Patch, Update File: draft.py, @@ hunks, End Patch. Literal -old/+new markers are separate from ALL source indentation. Every target must match uniquely and exactly in the current source. Any conflict rejects the WHOLE call; no partial saves or fuzzy matching. Prefer replacements for small fixes.",
      "type": "string",
      "maxLength": 200000
    },
    "replacements": {
      "description": "Preferred for small/indentation repairs: unique exact oldText/newText pairs on the current source. All pairs commit together or NONE do; combine helper and caller changes in one call. No whitespace guessing. Missing oldText is a conflict, not proof of previous success. Use documentId; inspect saved and validation separately.",
      "minItems": 1,
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "oldText": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100000,
            "description": "Exact unique source substring copied from readSource.program, including ALL indentation; no diff markers or line numbers. Include surrounding code to disambiguate. Cannot be empty."
          },
          "newText": {
            "type": "string",
            "maxLength": 100000,
            "description": "Replacement source verbatim, preserving intended indentation. Empty string deletes oldText. For insertion include the old anchor in newText."
          }
        },
        "required": [
          "oldText",
          "newText"
        ],
        "additionalProperties": false
      }
    },
    "render": {
      "description": "Legacy generate/edit flag; use a separate action=render to publish. generate/edit create or validate source, not a deliverable download.",
      "type": "boolean"
    },
    "includeVisuals": {
      "description": "For readContent only: false by default; true explicitly attaches rendered pages. Text reading is not visual QA. For page inspection, use visualRead with render.visualIndex; request visualIndex only if no current index is available.",
      "type": "boolean"
    },
    "offset": {
      "description": "readContent: zero-based character offset. visualIndex: zero-based screenshot-list offset. Never a source line number.",
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "sheet": {
      "description": "readContent: exact spreadsheet worksheet name.",
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "range": {
      "description": "readContent: A1 cell/range, for example A1:D20; specify sheet for multi-sheet files.",
      "type": "string",
      "minLength": 1,
      "maxLength": 40
    },
    "contentPages": {
      "description": "readContent: PDF text pages or presentation slides in actual document order, one-based. Independent from visual-preview pages.",
      "minItems": 1,
      "maxItems": 100,
      "type": "array",
      "items": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      }
    },
    "section": {
      "description": "readContent: exact, unique Word document heading; reads through the next heading of the same or higher level.",
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "limit": {
      "description": "readContent: maximum text characters (default 8000, max 40000), NOT source lines. visualIndex: maximum index entries (default 100, max 200). readSource uses startLine/endLine instead.",
      "type": "integer",
      "minimum": 1,
      "maximum": 40000
    },
    "pages": {
      "description": "Only for readContent(includeVisuals=true): one-based rendered/printed page numbers, at most six. A worksheet may span multiple pages. visualRead instead uses screenshotIds.",
      "maxItems": 6,
      "type": "array",
      "items": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      }
    },
    "query": {
      "description": "For an API lookup: omit to list modules, then pass an exact module id returned by that index.",
      "type": "string",
      "maxLength": 1000
    },
    "screenshotIds": {
      "description": "For visualRead: one to eight exact screenshot ids from render.visualIndex or action=visualIndex. Prefer render.visualIndex.nextRead without repeating the index call.",
      "minItems": 1,
      "maxItems": 8,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 40
      }
    },
    "reviews": {
      "description": "For visualReport: conclusions for pages actually seen via visualRead on this artifact. passed requires no failed checks and no issues; failed requires a failed check and concrete issues. Reporting does not modify source.",
      "minItems": 1,
      "maxItems": 100,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "screenshotId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "status": {
            "type": "string",
            "enum": [
              "failed",
              "passed"
            ]
          },
          "observation": {
            "type": "string",
            "minLength": 20,
            "maxLength": 1000,
            "description": "Concrete page-specific pixel evidence covering composition and readability."
          },
          "checks": {
            "type": "object",
            "properties": {
              "overlap": {
                "type": "string",
                "enum": [
                  "failed",
                  "not-applicable",
                  "passed"
                ],
                "description": "No warning check status. Any unresolved visible defect requires failed. Warning is only an issue severity, not permission to pass the check."
              },
              "clipping": {
                "type": "string",
                "enum": [
                  "failed",
                  "not-applicable",
                  "passed"
                ],
                "description": "No warning check status. Any unresolved visible defect requires failed. Warning is only an issue severity, not permission to pass the check."
              },
              "alignment": {
                "type": "string",
                "enum": [
                  "failed",
                  "not-applicable",
                  "passed"
                ],
                "description": "No warning check status. Any unresolved visible defect requires failed. Warning is only an issue severity, not permission to pass the check."
              },
              "spacing": {
                "type": "string",
                "enum": [
                  "failed",
                  "not-applicable",
                  "passed"
                ],
                "description": "No warning check status. Any unresolved visible defect requires failed. Warning is only an issue severity, not permission to pass the check."
              },
              "typography": {
                "type": "string",
                "enum": [
                  "failed",
                  "not-applicable",
                  "passed"
                ],
                "description": "No warning check status. Any unresolved visible defect requires failed. Warning is only an issue severity, not permission to pass the check."
              },
              "contrast": {
                "type": "string",
                "enum": [
                  "failed",
                  "not-applicable",
                  "passed"
                ],
                "description": "No warning check status. Any unresolved visible defect requires failed. Warning is only an issue severity, not permission to pass the check."
              },
              "visualHierarchy": {
                "type": "string",
                "enum": [
                  "failed",
                  "not-applicable",
                  "passed"
                ],
                "description": "No warning check status. Any unresolved visible defect requires failed. Warning is only an issue severity, not permission to pass the check."
              },
              "chartTableLegibility": {
                "type": "string",
                "enum": [
                  "failed",
                  "not-applicable",
                  "passed"
                ],
                "description": "No warning check status. Any unresolved visible defect requires failed. Warning is only an issue severity, not permission to pass the check."
              },
              "imageQuality": {
                "type": "string",
                "enum": [
                  "failed",
                  "not-applicable",
                  "passed"
                ],
                "description": "No warning check status. Any unresolved visible defect requires failed. Warning is only an issue severity, not permission to pass the check."
              }
            },
            "required": [
              "overlap",
              "clipping",
              "alignment",
              "spacing",
              "typography",
              "contrast",
              "visualHierarchy",
              "chartTableLegibility",
              "imageQuality"
            ],
            "additionalProperties": false
          },
          "issues": {
            "maxItems": 50,
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 500
                },
                "region": {
                  "type": "string",
                  "maxLength": 120
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "error",
                    "warning"
                  ]
                }
              },
              "required": [
                "type",
                "description"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "screenshotId",
          "status",
          "observation",
          "checks"
        ],
        "additionalProperties": false
      }
    },
    "deckReview": {
      "description": "Complete-document consistency review submitted after every page has been read and reviewed.",
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "failed",
            "passed"
          ]
        },
        "observation": {
          "type": "string",
          "minLength": 30,
          "maxLength": 2000,
          "description": "Concrete cross-page comparison of the complete rendered artifact."
        },
        "checks": {
          "type": "object",
          "properties": {
            "templateConsistency": {
              "type": "string",
              "enum": [
                "failed",
                "passed"
              ]
            },
            "typographyConsistency": {
              "type": "string",
              "enum": [
                "failed",
                "passed"
              ]
            },
            "colorConsistency": {
              "type": "string",
              "enum": [
                "failed",
                "passed"
              ]
            },
            "spacingRhythm": {
              "type": "string",
              "enum": [
                "failed",
                "passed"
              ]
            },
            "componentConsistency": {
              "type": "string",
              "enum": [
                "failed",
                "passed"
              ]
            },
            "designIntent": {
              "description": "Required for bespoke plans: rendered hierarchy, type, imagery and data expression realize the selected design direction and preserved requirements, not merely its palette.",
              "type": "string",
              "enum": [
                "failed",
                "passed"
              ]
            },
            "compositionRhythm": {
              "description": "Required for bespoke plans: composition and density serve page purposes; repetition is intentional for comparable content, not a universal shell. Do not impose arbitrary layout quotas.",
              "type": "string",
              "enum": [
                "failed",
                "passed"
              ]
            },
            "contentConsistency": {
              "description": "Required for bespoke plans: recompute displayed changes/shares/totals from the same data used by charts; verify titles, axes, units, dates and callouts agree across pages. Pixel inspection alone cannot pass this check. Describe concrete calculations and page numbers in observation.",
              "type": "string",
              "enum": [
                "failed",
                "passed"
              ]
            },
            "sourceTraceability": {
              "description": "Required for bespoke plans: material factual values match actually accessed source rows, periods and accounting basis. Assumptions are visibly identified. A successful fetch is not verification. Describe exact source/table references in observation; missing evidence means failed.",
              "type": "string",
              "enum": [
                "failed",
                "passed"
              ]
            }
          },
          "required": [
            "templateConsistency",
            "typographyConsistency",
            "colorConsistency",
            "spacingRhythm",
            "componentConsistency"
          ],
          "additionalProperties": false
        },
        "issues": {
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80
              },
              "description": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "region": {
                "type": "string",
                "maxLength": 120
              },
              "severity": {
                "type": "string",
                "enum": [
                  "error",
                  "warning"
                ]
              }
            },
            "required": [
              "type",
              "description"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "status",
        "observation",
        "checks"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": {}
}
```
