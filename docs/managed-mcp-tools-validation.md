# MCP 按需组件与纯净镜像验收

验收日期：2026-11-09。使用独立的 SQLite 数据库、工具目录和 Docker 数据卷；没有修改业务数据库、已有对话或共享知识库内容，没有新增仓库测试源码。所有实际工具调用均通过 Capability SDK 或其 MCP 传输执行。

## 已完成的功能检查

| 范围 | 实际执行与结果 |
| --- | --- |
| 组件管理 | 单独安装、失败重试、停止、禁用、卸载、重装；拒绝 all ID，安装终端不会安装其他八个组件；不响应的 MCP 子进程初始化会超时退出 |
| 权限与配置 | 非管理员拒绝访问；环境变量密文落库、返回值掩码；禁用后旧工具注册也不能执行；组件环境不能授予宿主执行权限或绕过远程沙箱要求 |
| 工具运行 | 九个组件分别安装并完成真实 MCP 初始化和工具发现 |
| 浏览器 | 操作真实页面、返回截图；借用指定宿主 target、新建标签同步预览、拒绝跨会话 target、关闭连接后宿主仍存在 |
| 文件 | Unicode 文本读写、XLSX 读取、LibreOffice 转 PDF、PDF 内容提取 |
| 知识库 | 写入与检索；对话实例只读约束 |
| 图表与地图 | 图表创建、读取和按修订更新；地图无外部 API 的位置示意与回读 |
| 多媒体与桌面 | 媒体能力发现、图片检查、Remotion 合成实际 MP4；Windows 桌面观察返回真实像素 |
| 代码沙箱 | MCP 调用 Linux Landlock 执行器，JavaScript/Python 计算、产物持久化与回读；拒绝读取 /etc/shadow |
| 终端面板 | 模型与面板共享对话终端；SSE 初始快照和增量输出；面板读取不消费模型输出；对话清理回收进程 |
| 第三方 MCP | 本地进程驱动发现工具并传入单独配置的环境变量；密钥不回显；无效 JSON/变量名拒绝保存 |
| 页面 | 生产对话、自动化、AI 运营、设置路由返回 200；实际浏览器检查工具列表、配置保存、密钥掩码、窄屏和暗色模式 |
| 代码检查 | 生产代码 TypeScript 检查、变更 JavaScript/CJS/MJS 语法检查通过 |

浏览器、文件、媒体和代码组件在 Windows 的功能检查复用已有的相应运行环境，避免重复下载。Linux 浏览器运行环境另行从缺省基础镜像完成过下载和系统库提取；浏览器的系统库位于持久卷中的 sysroot，没有写入基础镜像。

Linux 运行容器中，分别通过设置 API 安装终端和浏览器。终端安装完成时其余八个工具仍为未安装，两个组件安装结束时只有这两个工具可用。真实 MCP 调用验证了终端环境变量、交互式 PTY、浏览器页面操作和截图，未安装编译器。浏览器复用持久卷中已经下载的 Linux 运行环境。

从最终镜像重新创建容器并保留临时数据卷后，两个组件的安装、启用状态仍保留，上述终端和浏览器调用再次通过。最终镜像的只读 Linux 沙箱通过了 JavaScript/Python、产物回读和文件访问限制检查。编译后的 MCP 客户端面对不响应初始化的子进程，按配置超时结束并关闭进程；300ms 初始化超时的这次检查连同进程回收共约 1.8 秒。

工具配置页使用实际构建产物检查。桌面与 390px 窄屏下，多行 JSON 编辑区高度均至少 190px，页脚保存按钮可见。Impeccable 复核对这次编辑区高度与窄屏排版修复给出 ship；该结论限于列出的修复范围。

## 镜像测量

使用相同 Docker Desktop 存储口径比较，不包含构建缓存、容器可写层和工具数据卷。

| 镜像 | 压缩内容 | Docker 本地显示占用 |
| --- | ---: | ---: |
| 改造前 orbit:latest | 1.01 GB | 4.00 GB |
| 纯净 orbit:core | 约 161 MB | 约 684 MB |

最终镜像 ID：`sha256:8809a82a984fb410ba660263e49f50bd60db297bdf2e0cb997bd6591131e4ae3`。本地标签为 `orbit:core`；原 `orbit:latest` 保留用于比较。

Docker Desktop 的 [containerd 存储](https://docs.docker.com/engine/storage/containerd/) 同时保留压缩层和展开层，本地显示占用会高于拉取体积。数据卷中的 Chromium、Office、FFmpeg、组件 npm 包及下载缓存另计。

纯净镜像检查确认不包含 Electron、node-pty、Patchright/Chromium、LibreOffice、FFmpeg、Remotion 等可选工具包或大型运行环境，也没有 make/g++ 编译器。它保留安装模板、Web 页面和服务器的实际运行依赖。

参考应用目录测量：node_modules 约 151 MiB，Next 产物约 45 MiB，后端约 7 MiB，SDK 安装模板约 10 MiB。其余空间包含 Node、系统 Python、隔离监督所需系统组件和基础系统层。

## 构建与部署要点

此次低内存 Docker Desktop 使用 Webpack、一个构建 worker；类型检查已在主机单独完成。复现构建命令：

~~~powershell
node node_modules/typescript/bin/tsc -p tsconfig.production.json --noEmit --incremental false
docker build --build-arg BUILD_BUNDLER=webpack --build-arg BUILD_CPUS=1 --build-arg BUILD_HEAP_MB=1280 --build-arg BUILD_TYPECHECK=false -t orbit:core .
~~~

Docker 仅有约 2 GB 内存时，共享 npm 缓存挂载下的安装出现过系统内存终止。依赖安装阶段限制 npm 内存、连接数与构建线程，不使用共享 npm 缓存挂载后完成构建。构建期缓存和开发 node_modules 的大小不等于运行镜像大小。

Compose 的 Web 与代码执行器使用同一镜像，仍为独立进程和容器；代码执行器保留只读文件系统、权限降级与 Landlock 隔离。工具持久卷由 Web 写入，代码执行器只读挂载，安装和升级不会要求把大型组件重新塞进基础镜像。

## 验证边界

- 对话执行沿用外部 Codex App Server。镜像不内置 Codex CLI；需要部署方配置外部可执行文件及模型服务。本次未提交真实模型对话，不能据此宣称所有模型供应商均可用。
- Google Maps 的付费搜索/路线、外部图像/语音生成、远程电脑服务等依赖部署方凭据，本轮没有调用这些外部服务。
- Windows 服务安装器做了脚本检查，没有生成并安装 Windows EXE 包。
- 组件首次安装仍需要访问 npm 及对应运行环境下载源；下载失败会保留失败状态供单工具重试。
