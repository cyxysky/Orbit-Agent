# Docker 镜像

主镜像包含 Orbit 前端、Node API 与执行进程，以及 Chromium、LibreOffice 和 SDK 运行资源。浏览器使用 SDK 实际依赖的 Chromium，不再额外携带 Playwright 基础镜像中的其他浏览器。桌面 Electron 二进制不参与下载。

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

代码沙箱是独立服务，使用现有 `docker-compose.yml` 中的网络与权限配置。对应镜像可以单独构建：

```powershell
docker build -f Dockerfile.code-sandbox -t orbit-code-sandbox:latest .
```

镜像仅构建到本地 Docker，没有发布到远端镜像仓库。

## 本机验证范围

2026-11-06，Linux amd64。Docker 显示主镜像约 5.92GB，代码沙箱镜像约 404MB，包含运行依赖和浏览器/办公套件，不是纯源码大小，也不是导出压缩包大小。

- 新实例健康接口及对话、自动化、AI 运营、设置路由可用。
- 后端状态返回 API、执行进程两组真实内存数据。
- 容器内通过 SDK 启动 Chromium 并读取健康页面；LibreOffice 可启动，Python 可导入 UNO。
- 代码沙箱分别执行 JavaScript、Python 并返回结果，未鉴权请求返回 401。
- 未启动应用的干净镜像中，根目录没有私有 `.env`，`.data` 为空。
- 生产界面检查覆盖时间切换/刷新骨架屏、筛选浮层、深色模式和窄屏。表格界面采用独立浏览器内的统计数据样本，没有复制本地业务数据库或运行既有自动化任务。

以上不是带真实模型供应商、外部站点和业务数据的全流程验收。
