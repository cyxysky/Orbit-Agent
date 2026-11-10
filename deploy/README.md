# Orbit 内网源码迁移与 Kubernetes 部署

本目录针对当前的纯净基础镜像：保留 Web、API、执行调度和基础能力；浏览器、Office、视频等工具及依赖分别安装。`deploy/kustomization.yaml` 是部署入口，Nginx 配置由同目录文件生成 ConfigMap，不维护两份代理配置。

## 1. 导入内网 GitLab

源码压缩包来自固定 Git 提交，包含前后端、`packages/capability-sdk` 工作区源码、锁文件、Dockerfile、SQL 和部署模板。它不包含 Git 历史、node_modules、编译产物、`.env`、数据库、上传文件、凭据、浏览器资料或下载的工具运行环境。无需依赖外部 SDK Git 仓库才能拿到本次工作区的源码。

解压后在源码根目录执行；将 URL 换成你的 GitLab 仓库：

```sh
git init -b main
git add .
git commit -m "Import Orbit source"
git remote add origin https://gitlab.example.internal/ai/orbit.git
git push -u origin main
```

源码不等于离线依赖包。内网构建机还需要内部 npm 仓库、Node 基础镜像及 Debian 包源；可在 Dockerfile 的依赖阶段配置企业镜像源和企业 CA。不要使用跳过 TLS 校验代替配置 CA。

## 2. 构建内网镜像

在内网构建机执行，示例为 Linux amd64、域名根路径；镜像标签使用你自己的发布版本：

```sh
docker build --platform linux/amd64 \
  --build-arg ORBIT_BASE_PATH= \
  -t registry.gitlab.internal/ai/orbit:YOUR_RELEASE_TAG .
docker push registry.gitlab.internal/ai/orbit:YOUR_RELEASE_TAG
```

构建默认执行类型检查。资源有限的构建机可参照 [低内存构建参数](../docs/managed-mcp-tools-validation.md#构建与部署要点)。本轮源码交付没有运行应用 dev/build，也没有替换 Docker Hub 现有镜像；管理员登录、后端鉴权、数据库表合并、无损正文压缩和侧边栏修复在本源码包中，部署时应由本次源码构建镜像。

将官方 `nginx:stable-alpine` 同步到内网镜像仓库，并在 `deploy/kustomization.yaml` 修改两个镜像地址与标签。正式部署建议固定版本或 digest。应用和沙箱使用同一个 Orbit 镜像；Nginx 是代理镜像。

若使用 `/orbit` 等子路径，必须在**构建时**设置 `--build-arg ORBIT_BASE_PATH=/orbit`，并将 `orbit-config` 的 `ORBIT_BASE_PATH` 设置为相同值；只改环境变量无法改变 Next.js 已编译路径。现有 Nginx 配置保留完整 URI，无需剥掉前缀。

## 3. 存储、身份与密钥

模板使用一个 Pod、一个应用实例和 `Recreate` 更新策略。同 Pod 内包含 Orbit、隔离代码执行器和 Nginx。两个 PVC 默认各 30Gi，使用集群默认 StorageClass；没有默认存储类时在 PVC 中指定 `storageClassName`。没有硬编码工作节点或 hostPath。

- `orbit-data`：`/var/lib/orbit`，包含 SQLite、设置、凭据主密钥相关文件、产物、知识库和会话数据。
- `orbit-tools`：`/var/lib/orbit/tool-components`，由 Orbit 安装工具，沙箱仅以只读方式挂载。沙箱不挂载应用数据卷，也不接收模型密钥和凭据主密钥。
- 沙箱 `/tmp` 使用有大小上限的临时磁盘卷，应用退出/Pod 替换后不会作为业务数据保留。浏览器 `/dev/shm` 是 512Mi 内存卷，使用量计入内存占用。

当前不能通过增加 replicas 获得多实例运行：除 SQLite 外，活跃任务、调度与工具会话仍依赖单实例状态。即使改用 PostgreSQL，也不要直接扩大副本数。SQLite PVC 应使用支持其锁语义的本地/块存储，避免将 SQLite 数据库放在不支持其锁语义的网络文件系统。

先创建 namespace，再创建 Secret；示例在 Linux 管理机执行，实际密钥不要提交到 Git：

```sh
kubectl create namespace orbit
kubectl -n orbit create secret generic orbit-secrets \
  --from-literal=ORBIT_ADMIN_SETTINGS_PASSWORD="$(openssl rand -base64 32)" \
  --from-literal=CODE_SANDBOX_RUNNER_TOKEN="$(openssl rand -hex 32)" \
  --from-literal=WEBPILOT_CREDENTIAL_MASTER_KEY="$(openssl rand -base64 32)"
```

也可复制 `k8s/secret.example.yaml` 到仓库外，替换全部占位符后应用。使用密码管理器保管管理员密码与主密钥；已有数据迁移必须使用原来的凭据主密钥，否则数据库中的模型密钥、账号和 MCP 密文无法解密。**不要在每次升级时重新生成这些密钥。**

未登录的页面访问会转到 `/login`，API 返回 401。管理员输入 `ORBIT_ADMIN_SETTINGS_PASSWORD` 后，服务端签发独立的 HttpOnly 会话 Cookie，有效期 8 小时；退出会撤销会话，修改密码并重启后原会话失效。`ORBIT_ADMIN_SETTINGS_PASSWORD_ENABLED=false` 会关闭管理员登录，不会开放匿名管理员。开启登录却未设置密码时，启动会直接报错。原 WEBPILOT 前缀的同名环境变量仍由环境变量映射统一读取。

普通用户沿用宿主系统挂载身份流程；挂载接口不允许签发管理员 ID `1`。`ORBIT_DEFAULT_USER_ID` 只用于服务端资源的默认归属，不能用于登录。已移除匿名访问开关 `ORBIT_REQUIRE_MOUNT_USER_ID`。Cookie 一致性校验应在可信身份完成绑定后再开启；未开启校验的挂载初始化接口不适合作为公网用户登录认证。管理员登录不会读取或复制主站的登录 Cookie。

同一反向代理源下的 iframe 可以使用 Orbit 自己的会话 Cookie。跨站 iframe 必须通过 HTTPS 并设置 `ORBIT_CROSS_SITE_MOUNT=true`，浏览器仍可能阻止第三方 Cookie；优先采用同源代理。不要公开 API/执行子进程端口，Nginx 应覆盖 `X-Real-IP` 和转发头，管理员登录限流才会使用真实客户端地址。

详细鉴权流程见[管理员登录与嵌入身份](../docs/deployment/administrator-authentication.md)。当前服务端数据库为 6 张业务表和 1 张迁移表（共 7 张）；升级前停止旧应用并备份数据库，合并迁移只向新结构转换。见[数据表与存储精简](../docs/architecture/storage-table-review.md)和[存储压缩说明](../docs/architecture/storage-compaction.md)。`ORBIT_API_STARTUP_TIMEOUT_MS` 默认允许 10 分钟启动，模板的应用 startupProbe 允许 11 分钟；若增加该超时，也应同步增加探针等待窗口。

私有镜像仓库需要创建 `orbit-registry` 拉取凭据，并取消 Deployment 中 `imagePullSecrets` 的注释；企业镜像仓库 CA 需在集群节点的容器运行时中配置。

## 4. 应用、检查与访问

```sh
kubectl kustomize deploy > orbit.rendered.yaml
kubectl apply --dry-run=server -k deploy
kubectl apply -k deploy
kubectl -n orbit rollout status deployment/orbit --timeout=900s
kubectl -n orbit get pods,pvc,svc -o wide
```

渲染文件不包含真实 Secret 内容，但包含环境地址；不要把真实 Secret 混入它。`dry-run=server` 需要有目标集群的 kubeconfig；本次没有连接你的内网集群。

Service 仅将 Nginx 的 8080 端口映射为节点端口 30080，应用 3000、沙箱 18100、预览内部端口均不对外发布。模板使用 `externalTrafficPolicy: Local` 保留客户端/网关源地址，因此通过**运行该 Pod 的节点地址**访问 `http://NODE_IP:30080`；可用以下命令做本地转发验证：

```sh
kubectl -n orbit port-forward service/orbit 8080:80
```

应用路由要求身份，TCP 探针只验证主监听服务可用，不伪造用户身份；API/执行子进程由应用监督器管理。沙箱就绪探针会携带共享令牌，并检查实际 Landlock 隔离状态。节点内核和容器运行时必须允许 Landlock；不满足时应更换符合要求的节点/运行时，不能删除隔离校验来绕过。此监督进程以 root 启动后再将任务降权，权限配置与现有 Docker 沙箱保持一致；受集群 Pod Security 限制时，应由管理员为该工作负载评估配置。

## 5. Nginx、HTTPS 与流式连接

`nginx/orbit.conf` 在 Pod 内加载，支持 HTTP/1.1、WebSocket、流式输出和上传；代理不缓存或缓冲响应，不覆盖应用的 Cache-Control。代理的超时与上传上限可按内网策略修改。

已有外部 HTTPS 网关时，使用 `nginx/orbit-tls.conf.example`：修改域名、节点地址和证书路径，并把**该网关的实际源 IP/CIDR**加入 Pod 内 `orbit.conf` 的 `geo $orbit_trusted_proxy`，然后重新应用 `kubectl apply -k deploy`。只有可信网关传来的协议/端口头才会被保留，普通客户端不能伪造转发协议。节点端口访问范围应限制为允许的内网客户端或网关。

修改 Nginx 配置会生成新的 ConfigMap 名称并触发 Pod 更新。两层网关都必须允许 WebSocket，且关闭流式缓冲；外部网关的连接超时也需要覆盖长任务。

## 6. 运行依赖与数据迁移

当前任务引擎仍需要外部 Codex CLI。基础镜像不携带该二进制；准备与节点 CPU 架构匹配的 Linux CLI，放在持久数据卷的 `/var/lib/orbit/bin/codex`，授予执行权限，并在 Orbit 设置中将 `CODEX_PATH` 指向该路径。Web 页面能打开不代表对话执行引擎已配置完成。模型、MCP、工具和用户配置继续从数据库/设置页读取。

基础镜像首次启动不会安装全部工具。每个工具在齿轮弹窗中单独安装、配置和启用。`CAPABILITY_TOOL_REGISTRY` 只覆盖 npm 源；Chromium、Office、Python、FFmpeg 等运行资源还涉及其他下载源，只有 npm 镜像不能保证完全离线安装。完全隔离网络应提前准备对应工具资源/同平台工具持久卷，或按 SDK 下载地址配置企业代理/镜像，并在目标环境验收；不能将 Windows 工具运行目录直接复制给 Linux 使用。

模板默认关闭宿主执行与自举授权。需要终端、电脑操作或相关执行能力时，按实际部署权限配置 `ORBIT_HOST_EXECUTION_ENABLED` 等开关；安装工具本身不会提升部署授权。

纯净源码包没有数据库和密钥。需要保留旧对话及设置时，另行备份并迁移原应用数据目录、凭据主密钥和工具持久卷，升级前停止写入或使用数据库一致性备份。PostgreSQL 的建表文件与说明见 `sql/` 和 [初始化说明](../docs/deployment/postgresql-initialization.md)。

## 本次交付验证（2026-11-09）

共享侧边栏 Hook 已通过 SDK 浏览器的针对性页面验证：收起、展开状态下分别跨 5 个页面挂载，旧的服务端初始值没有覆盖当前选择；并发订阅与外部更新保持同步。生产 TypeScript 检查通过。此检查使用内存中的隔离页面，没有启动应用 dev/build，也没有新增测试文件。

部署目录已通过本地 Kustomize 渲染，7 个资源通过 Kubernetes v1.36.1 OpenAPI Schema 校验，并检查了 ConfigMap 引用及沙箱卷/密钥边界。HTTP 配置和代入临时证书的 HTTPS 网关模板通过 Linux Nginx 语法检查；实测 SSE 首块及时到达、WebSocket 升级及消息回显、可信转发头保留和非可信转发头过滤。临时证书、容器和验证数据不属于源码交付。

没有连接内网 Kubernetes 集群，因此存储类、镜像拉取权限、节点内核隔离能力和真实宿主身份流程仍须在目标集群按上述部署步骤确认。

参考：[Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/)、[持久卷](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)、[Nginx WebSocket](https://nginx.org/en/docs/http/websocket.html)、[Nginx 代理缓冲](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)。
