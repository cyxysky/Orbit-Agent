# Docker 镜像

主镜像包含 Orbit 前端、Node API 与执行进程，以及 Chromium、LibreOffice 和 SDK 运行资源。浏览器使用 SDK 实际依赖的 Chromium，不再额外携带 Playwright 基础镜像中的其他浏览器。桌面 Electron 二进制不参与下载。

## 镜像职责

| 镜像 | 用途 | 是否参与服务运行 |
| --- | --- | --- |
| `orbit:latest` | 前端、API、执行进程和浏览器/办公运行环境 | 是 |
| `orbit-code-sandbox:latest` | 独立执行 JavaScript、Python 代码的服务；使用临时工作目录、身份验证和资源限制 | Compose 部署会启动并等待其健康检查，代码执行工具调用此服务 |
| `orbit-build-deps:local` | 本机构建过程中保留的依赖阶段，可复用已安装的构建依赖 | 否；不是数据库或必须启动的后台服务，标准 Dockerfile 不依赖此标签 |

构建辅助镜像的标签可删除，但不应将删除它的占用变化误认为主镜像被进一步压缩。构建缓存与运行镜像分开统计。

## 后续体积空间

在依赖裁剪后的镜像内，JavaScript/CSS 的 `.map` 文件共 16,275 个，文件内容约 394,635,995 字节；较大的来源包括 Next、Mermaid、ECharts、PDF 解析库。它们可作为发行包进一步精简的候选，需要结合错误诊断和运行时视频编译等功能验证；此审查没有直接删除这些文件。

其他方向是统一浏览器工具、图表和视频渲染的可执行文件选择，再评估是否仅保留一套 Chromium；或将浏览器、办公组件做成独立的可选运行环境。这些属于不同的发行方案，不能仅按包名删除正在使用的库。

## 外部 Codex 运行时

项目不再直接依赖或内置 `@openai/codex`；转接包引入的同名可选依赖及其平台二进制由安装后的依赖策略排除。转接包本身保留，继续支持外部 Codex 接入。

当前主对话、自动化和子 Agent 的执行引擎都是 Codex App Server，因此外部 CLI 是执行任务的必要条件，其他模型供应商也需要它。宿主机可使用全局安装的 Codex，或在设置页指定 `CODEX_PATH`；此配置保存到数据库，不通过同名环境变量覆盖。

Windows 的 npm 全局安装会生成 `.cmd` 入口。后端按 PATH 找到其 Node 入口后直接启动，不通过 shell 拼接参数；裁剪脚本同时清理指向已删除包的失效命令入口。

Linux 容器必须提供兼容 Linux 和目标 CPU 架构的 CLI，不能直接使用 Windows 的 `codex.exe`。例如在下方启动命令中增加 `--mount type=bind,source=/absolute/path/to/linux-codex,target=/usr/local/bin/codex,readonly`，将原生可执行文件放入容器的 `PATH`。也可以将完整 CLI 目录挂载到容器内，再在设置页填写对应路径。挂载文件须具有执行权限。

缺少外部 CLI 时，Web 页面仍可打开，但对话任务无法执行；移除二进制包不等于已替换执行引擎。

## 构建

常规构建保留 Turbopack 和容器内类型检查：

```powershell
docker build --build-arg ORBIT_BASE_PATH=webpilot -t orbit:latest .
```

本机 Docker 约有 2GB 内存，采用独立类型检查和低内存编译参数。先在宿主机完成生产类型检查，通过后再构建：

```powershell
node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -p tsconfig.production.json --noEmit --incremental false
if ($LASTEXITCODE -ne 0) { throw 'Production type check failed' }
docker build --build-arg ORBIT_BASE_PATH=webpilot --build-arg BUILD_BUNDLER=webpack --build-arg BUILD_TYPECHECK=false -t orbit:latest .
```

`BUILD_CPUS` 默认 1，`BUILD_HEAP_MB` 默认 1280。运行时系统依赖在编译完成后安装，避免两个阶段同时争用内存。`BUILD_TYPECHECK=false` 仅用于已经通过独立类型检查的构建；正常开发和默认构建不跳过检查。构建方式参考 [Next.js 内存优化说明](https://nextjs.org/docs/app/guides/memory-usage)。

约 2GB 的虚拟机内，应用容器与构建进程同时运行仍可能触发内存不足。本次重建时停止了验收用的临时容器，未修改 Docker Desktop 的全局资源设置。

`ORBIT_BASE_PATH` 是编译参数，镜像同时保存相同的运行挂载路径。上面的镜像使用 `/webpilot`；改变挂载路径须用相应参数重新构建。

## 独立本地运行

```powershell
docker run -d --name orbit -p 127.0.0.1:3001:3000 -e ORBIT_REQUIRE_MOUNT_USER_ID=false -v orbit-data:/app/.data -v orbit-artifacts:/app/artifacts orbit:latest
```

访问 `http://localhost:3001/webpilot`。示例使用默认本地身份；挂载到宿主应用时使用项目已有的挂载身份配置。模型等配置可在设置页保存到新实例数据库。

`.env`、本地数据库、上传文件、浏览器配置和构建日志均不进入镜像。数据与生成文件分别持久化到 `/app/.data`、`/app/artifacts`。构建过程不连接或迁移正在使用的数据库。

后端编译器按源文件的模块格式输出：CommonJS 使用 `.cjs`，ESM 使用 `.js`/`.mjs`，并同步重写模块引用，避免生产包的 ESM 目录错误解释 CommonJS 文件。此规则同样适用于其他后端分发包。

## 依赖裁剪

`scripts/prune-runtime-dependencies.cjs` 在普通 `npm install`/`npm ci` 的 `postinstall` 中运行；Docker 复制运行依赖之前和服务端/桌面包复制依赖之后，也会再次执行同一规则。

- 根依赖移除了未使用的 `@lobehub/icons-static-png`，界面继续使用 `public/model-brands` 中的图标。
- `package.json` 的 `runtimeDependencyPolicy.excludedOptionalPackages` 声明不随项目分发的可选包。上游 Codex 转接包仍在锁文件中声明这个可选依赖，安装后会移除其实际目录；不能把锁文件中的上游依赖记录误认为镜像仍内置 CLI。
- 依据包的 `os`、`cpu`、`libc` 元数据及通用 `prebuilds/<platform>-<arch>` 目录约定裁剪异平台文件，不删除仍在使用的终端、图片、视频处理包。
- 每次递归删除都检查解析后的路径位于目标 `node_modules` 内，跳过工作区链接。排除策略仅允许删除锁文件明确标记为可选的包，防止静默移除必要依赖。

可用 `node scripts/prune-runtime-dependencies.cjs --dry-run` 查看计划。显式使用 `--ignore-scripts` 安装时不会执行 `postinstall`，需随后手动运行裁剪脚本。

代码沙箱是独立服务，使用现有 `docker-compose.yml` 中的网络与权限配置。对应镜像可以单独构建：

```powershell
docker build -f Dockerfile.code-sandbox -t orbit-code-sandbox:latest .
```

镜像仅构建到本地 Docker，没有发布到远端镜像仓库。

## 本机验证范围

2026-11-06，Linux amd64。包含最新导航优化的 `orbit:latest` 为 `38669b86be09`：Docker 本地磁盘占用约 4.91GB，压缩内容约 1.21GB；裁剪前分别约 5.92GB、1.51GB。`node_modules` 由约 2.55GB 降至 1.84GB。代码沙箱镜像未变，Docker 显示约 404MB。

这些数字包含运行依赖和浏览器/办公套件，不是纯源码大小。磁盘占用包含压缩内容及解压层；旧构建缓存和其他镜像的占用不属于当前镜像的减重数字。本次未清理全局构建缓存。

- 新实例健康接口及对话、自动化、AI 运营、设置路由可用。
- 后端状态返回 API、执行进程两组真实内存数据。
- 容器内通过 SDK 启动 Chromium 并读取健康页面；LibreOffice 可启动，Python 可导入 UNO。
- 代码沙箱分别执行 JavaScript、Python 并返回结果，未鉴权请求返回 401。
- 未启动应用的干净镜像中，根目录没有私有 `.env`，`.data` 为空。
- 生产界面检查覆盖时间切换/刷新骨架屏、筛选浮层、深色模式和窄屏。表格界面采用独立浏览器内的统计数据样本，没有复制本地业务数据库或运行既有自动化任务。

本轮依赖裁剪额外验证了 Linux 原生终端实际执行、图片编码、GNU 版 Rspack 加载，以及重复裁剪没有额外删除。Windows 使用项目的实际 App Server 客户端，通过默认 PATH 和显式 npm `.cmd` 入口初始化外部 Codex 0.166.0；没有调用模型或创建真实对话任务。裁剪后的容器检查不代表缺少外部 CLI 时也能执行对话。

最新导航版本在容器内重新编译完整前端和后端，并复用本地构建依赖阶段；未运行宿主机 dev/build。额外延迟路由请求时，四个入口均先展示目标加载界面；取消切换保留草稿，连续点击落到最后一个目标，桌面浅色和窄屏深色布局已检查。本轮没有进一步裁剪依赖，体积与上一版基本相同。

以上不是带真实模型供应商、外部站点和业务数据的全流程验收。
