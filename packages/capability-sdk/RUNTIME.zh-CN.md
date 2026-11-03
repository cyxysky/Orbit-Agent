# 项目运行环境

正常 npm 安装会通过 postinstall 准备与当前 Patchright 修订号匹配的 Chromium、LibreOffice/UNO、基础 Python 3.11 环境和 FFmpeg。默认不安装 PyTorch、脱敏推理依赖或模型权重。运行清单只有在可执行程序检查及真实无头浏览器启动通过后才会写入；浏览器修订元数据参与指纹计算，依赖变化后必须重新准备匹配的浏览器。

```sh
npm install @cjfclonedeep/capability-sdk --foreground-scripts
npx capability-runtime plan
npx capability-runtime install
npx capability-runtime doctor
```

默认目录是使用方项目根目录的 `.capability-sdk/<平台>-<架构>/`。请将 `.capability-sdk/` 加入 `.gitignore`。可以通过 `CAPABILITY_RUNTIME_HOME` 指定位置，安装和运行必须使用相同设置。项目移动或更换机器、平台后应重新准备环境。

```text
.capability-sdk/win32-x64/
  browsers/       # 当前 Patchright 对应的浏览器
  libreoffice/    # Office 与独立 UNO Python
  python/         # 基础 Python 解释器
  venv/           # 基础代码执行环境，不含脱敏包
  bin/            # FFmpeg
  runtime.json    # 基础组件就绪清单
```

脱敏默认关闭，只在用户明确请求安装时下载依赖与模型，也可以在宿主设置页点击下载：

```sh
npx capability-runtime install sensitive-data
npx capability-runtime doctor sensitive-data
```

脱敏专用虚拟环境、CPU PyTorch、三个默认模型和 Hugging Face 缓存分别放在 `sensitive-data/venv`、`sensitive-data/models`、`sensitive-data/huggingface` 中，离线加载模型通过后单独写入 `sensitive-data.json`。卸载这些可选组件不会使基础运行清单失效。普通 SDK 安装、Docker 打包和 Orbit 桌面打包不再自动安装或捆绑脱敏推理依赖。

支持 Windows x64，以及 Ubuntu 22.04/24.04、Debian 12/13 的 x64/arm64。Windows 复制本机 Office 或校验并解包官方 MSI；Linux 通过 apt 准备 Office/UNO 和系统库，再复制到项目并准备匹配 UNO ABI 的 Python，缺少系统包时需要 root 或免密码 sudo。基础 Python 由校验过的 uv 管理，不替换系统 Python。

就绪清单使用运行目录内的相对路径，读取时校验并转换为绝对路径。新建 Python 虚拟环境使用 uv 可迁移启动器；移动项目后仍应运行安装命令，修复失效的解释器链接并验证组件。显式配置的程序路径优先于托管默认值。`/runtime` 提供 `readManagedRuntime()`、`readManagedSensitiveDataRuntime()` 和 `runtimeDirectory()`。终端子进程会取得托管程序路径，不修改父进程环境。

`CAPABILITY_SKIP_RUNTIME_INSTALL=1` 可以跳过自动安装，之后需手动执行安装命令。跳过不代表已就绪。业务账号、API Key、数据库服务器和交互桌面仍由宿主配置；内置原生桌面驱动仅支持 Windows。

实现：[安装脚本](scripts/runtime.cjs)、[下载与校验配置](runtime/managed/spec.json)。
