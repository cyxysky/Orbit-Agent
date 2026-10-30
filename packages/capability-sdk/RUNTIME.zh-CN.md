# 自动准备项目执行环境

React 与 React DOM 声明为 npm 自动安装的必需 peer 依赖，使前端项目复用已有 React 实例，同时避免 Excalidraw 旧 UI 依赖造成的解析循环。使用方仍只需执行一次安装命令。

`@cjfclonedeep/capability-sdk@0.2.1` 将基础 SDK、全部工具、响应和适配器合为一个 npm 包。安装时通过 `postinstall` 自动准备执行环境：

```sh
npm install @cjfclonedeep/capability-sdk --foreground-scripts
```

可执行程序、Python 依赖、模型权重与下载缓存默认保存在**使用方项目根目录**的 `.capability-sdk/<平台>-<架构>/` 下：

```text
你的项目/
├─ package.json
├─ node_modules/
└─ .capability-sdk/
   └─ win32-x64/            # Linux 为 linux-x64 或 linux-arm64
      ├─ browsers/         # Chromium
      ├─ libreoffice/      # LibreOffice、UNO
      ├─ python/           # Python 3.11；Linux UNO 可能另需匹配版本
      ├─ venv/             # 敏感数据和文档处理 Python 依赖
      ├─ bin/              # FFmpeg
      ├─ models/           # gliner、chinese、pii 三个模型
      ├─ huggingface/      # 模型运行缓存
      └─ runtime.json      # 验证通过后的安装信息
```

npm 安装脚本识别使用方项目根目录，不会放进 SDK 自身的 node_modules 目录。应用和维护命令也应从项目根目录执行。请将 `.capability-sdk/` 加入 `.gitignore`。显式设置 `CAPABILITY_RUNTIME_HOME` 可以覆盖默认位置，安装和运行时需保持相同设置。运行时包含绝对路径；移动项目或更换机器、平台后应重新准备。

首次安装需要下载浏览器、Python 依赖和三个模型，可能需要较长时间和数 GB 空间。安装成功前会验证可执行程序、浏览器启动和三个模型的离线加载。失败会让 npm 安装报错；重试复用已下载内容。可以通过标准 `HF_HUB_CACHE` 环境变量指定已有模型缓存作为下载来源，最终模型仍复制到项目的 `models/` 中。

| 环境 | 安装行为 |
| --- | --- |
| Chromium | Playwright 下载与当前平台、版本匹配的浏览器到 `browsers/` |
| LibreOffice / UNO | Windows 将可用安装复制到项目，或校验并解包官方 MSI；Linux 通过 apt 准备后复制到项目，并准备匹配 UNO ABI 的本地 Python |
| Python | 校验过的 uv 下载 Python 3.11，建立项目内虚拟环境 |
| 敏感数据 | 安装 CPU PyTorch、GLiNER 等依赖，下载三个默认模型 |
| FFmpeg | 从 ffmpeg-static 复制对应平台的可执行程序到 `bin/` |
| 本地终端 | 使用系统 PowerShell/Bash；子进程 PATH 自动加入项目内 Python、FFmpeg 和 LibreOffice |

自动安装目标为 **Windows x64、Ubuntu 22.04/24.04 和 Debian 12/13 的 x64/arm64**。Linux 的系统动态库和字体仍需要 apt 提供；缺少系统包时需要 root 或免密码 sudo。系统终端也由操作系统提供。不支持的平台会明确失败。

```sh
npx capability-runtime plan     # 查看计划，不安装
npx capability-runtime doctor   # 验证程序和模型是否可用
npx capability-runtime install  # 中断后重试或修复
```

显式配置的可执行程序和模型路径仍优先于自动准备的默认值。`/runtime` 子入口提供 `readManagedRuntime()` 与 `runtimeDirectory()`。

`CAPABILITY_SKIP_RUNTIME_INSTALL=1` 显式跳过环境准备，之后可执行 `npx capability-runtime install`。npm 的 `--ignore-scripts` 也会跳过准备，并可能跳过第三方原生依赖的安装脚本。跳过不代表环境已可用。

安装程序不配置业务账号、API Key、数据库服务或外接设备。内置原生桌面控制驱动仅支持 Windows，且需要交互桌面；Linux 桌面控制仍需外接驱动。

实现：[安装脚本](scripts/runtime.cjs)、[下载来源及 SHA-256](runtime/managed/spec.json)。
