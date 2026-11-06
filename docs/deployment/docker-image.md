# Docker 镜像

主镜像包含 Orbit 前端、Node API 与执行进程，以及 Chromium、LibreOffice 和 SDK 运行资源。浏览器使用 SDK 实际依赖的 Chromium，不再额外携带 Playwright 基础镜像中的其他浏览器。桌面 Electron 二进制不参与下载。

## 一个发布镜像

代码沙箱的任务隔离与公共知识库变更见[用户数据边界](../architecture/user-data-isolation.md)。升级时先重建镜像，再用当前 Compose 启动；沙箱需要预置执行身份、Landlock 和新增的协调进程权限，不能继续使用旧镜像。

构建、分发和加载只需要 `orbit:latest`。Docker Compose 从同一镜像启动两个容器：

| 容器 | 入口 | 职责 |
| --- | --- | --- |
| `webpilot-qa` | `node server/webpilot-server.js` | 前端、API、执行进程、浏览器和办公工具 |
| `webpilot-code-sandbox` | `node server/code-sandbox-runner.js` | 使用临时目录执行 JavaScript/Python |

两个容器共享镜像的只读层，镜像不因启动两次而复制一份。沙箱保留单独的只读文件系统、临时空间、内存/CPU/进程数限制及降权执行；它不挂载主服务的数据目录，也不接收主服务的模型配置。合并发布镜像不需要取消这些进程边界。

此前的 `orbit-code-sandbox:latest` 已不再构建或引用，独立 Dockerfile 已移除。`orbit-build-deps:local` 是之前本机打包时留下的临时依赖标签，标准 Dockerfile 不依赖它。正常构建的依赖阶段保留在 BuildKit 缓存中，不需要额外发布构建镜像；删除旧标签与主镜像减重分开统计。

## 发行资源裁剪

`scripts/prune-runtime-dependencies.cjs --strip-source-maps` 在编译和移除开发依赖后，删除 node_modules 中独立的 JavaScript/CSS `.map` 文件。该选项仅用于发行镜像，普通 npm 安装仍保留调试资源；开发源码、可执行文件和必要的运行时编译依赖不受此规则影响。文件遍历不跟随符号链接，删除前校验路径；`--dry-run` 可以查看计划。

此前镜像的这类文件共 16,275 个、394,635,995 字节。浏览器安装使用 `--no-shell chromium`，保留完整 Chromium，不再额外下载约 261MiB 的 headless shell。浏览器工具和文档渲染通过 `AI_WEB_TEST_CHROMIUM_EXECUTABLE_PATH`，视频渲染通过 `REMOTION_BROWSER_EXECUTABLE`，统一指向安装时解析的 `/usr/local/bin/orbit-chromium`。完整 Chromium 支持无头运行。

这会减少发行环境的依赖源码调试能力；运行日志和应用错误仍保留。裁剪后需验证浏览器、文档和 Remotion 的运行时编译与渲染。

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
docker run -d --name orbit -p 127.0.0.1:3001:3000 -e ORBIT_REQUIRE_MOUNT_USER_ID=false -v orbit-data:/app/.data -v orbit-artifacts:/app/artifacts -v orbit-knowledge:/app/knowledge orbit:latest
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

代码沙箱仍作为独立受限容器运行，直接使用同一个主镜像。构建一次后启动整套服务：

```powershell
docker compose build webpilot-qa
docker compose up -d
```

Compose 沿用已有的 `CODE_SANDBOX_RUNNER_TOKEN` 配置，不对外发布沙箱端口。

镜像仅构建到本地 Docker，没有发布到远端镜像仓库。

## 上次发行镜像验证（隔离修复前）

2026-11-06，Linux amd64。最终 `orbit:latest` 为 `a99db9405875`：Docker 本地磁盘占用约 4.00GB（4001827175 字节），压缩内容约 1.01GB；本轮开始时分别约 4.91GB、1.21GB。使用同一个 Docker 显示口径，主镜像减少约 0.91GB；删除旧辅助标签释放的空间不包含在这个减重数字内。

镜像仍保留完整浏览器、办公和代码执行能力。当前大项包括约 1.45GB 的 node_modules、一份完整 Chromium、LibreOffice/Python 及系统依赖。较早依赖清理前 node_modules 约 2.55GB，上一轮约 1.84GB，本轮进一步删除约 395MB 的独立 source map。

本机已没有用户记忆中的旧 3GB 多镜像，无法确认其具体依赖和统计口径；不将压缩内容、镜像磁盘占用及全局构建缓存混为同一数字。本轮没有清理全局构建缓存或用户数据。

- Compose 配置仅引用一个镜像。实际从同一最终镜像分别启动主服务和沙箱；使用新数据库和无业务挂载的临时容器，没有启动会读取现有本地数据的 Compose 服务。
- 新实例健康接口、对话、自动化、AI 运营和设置路由返回成功，API 与执行进程内存数据可用。
- 容器内通过 Cap SDK 启动 Chromium 并读取页面；LibreOffice 可启动，Python 可导入 UNO。
- 通过 SDK 生成 HTML PDF、渲染 PDF 预览，并实际编译和渲染一段 3 帧的 Remotion MP4。该检查覆盖 source map 裁剪后的视频运行时编译。
- 沙箱通过 SDK HTTP 执行器分别执行 JavaScript/Python、回传生成文件；进程降权为 UID 10001，写入应用目录被拒绝，未鉴权请求返回 401，且不挂载主服务目录。
- 修复了 SDK 在代码失败且声明输出缺失时使用文件收集错误覆盖原始失败的问题；实际验证保留退出码、stderr 和已生成的部分文件，成功执行仍严格检查声明输出。
- 镜像内没有额外 headless shell；重复裁剪计划为零，没有私有 .env。

本轮只重新打包发行资源和共享执行运行时，沿用上一轮已验证的前后端编译产物。未运行项目 dev/build，未新增测试文件。未调用真实模型或执行业务自动化任务。
