# 管理员登录与嵌入身份

匿名页面请求跳转到 `/login?next=...`，受保护 API 返回 401。输入管理员密码后，服务端生成随机会话令牌，以 HttpOnly Cookie `orbit_admin_session` 发送给浏览器。响应 JSON 不包含令牌，数据库只存令牌哈希。

沿用已有环境变量：

| 配置 | 行为 |
| --- | --- |
| `ORBIT_ADMIN_SETTINGS_PASSWORD_ENABLED=true` | 启用管理员密码登录 |
| `ORBIT_ADMIN_SETTINGS_PASSWORD` | 必填管理员密码；启用但为空时启动失败 |
| `ORBIT_ADMIN_SETTINGS_PASSWORD_ENABLED=false` | 关闭管理员登录，仍不允许匿名访问管理员 |
| `ORBIT_TRUST_PROXY=true` | 使用可信反向代理覆盖后的地址和协议头 |
| `ORBIT_CROSS_SITE_MOUNT=true` | 跨站 iframe Cookie 使用 SameSite=None、Secure，需要 HTTPS |
| `ORBIT_USER_COOKIE_CHECK_ENABLED=true` | 普通嵌入用户必须已经绑定且匹配业务登录 Cookie |
| `ORBIT_USER_COOKIE_NAMES` | 可选，仅比较列出的业务 Cookie 名称 |

WEBPILOT 前缀的同名配置仍由统一环境映射读取；不应同时配置相互冲突的 ORBIT/WEBPILOT 值。密码只在服务端环境中配置，不进入前端设置数据。

会话绝对有效期为 8 小时，不因请求而延期。退出删除服务端会话并清除身份 Cookie；同一实例中的活动连接会关闭。过期会关闭活动连接，页面回到前台时也会核对登录状态。修改密码并重启会使旧会话失效。每个客户端地址在 15 分钟内错误输入 5 次后受限；部署的 Nginx 必须覆盖 X-Real-IP，应用监听端口应仅允许可信代理访问。

管理员身份固定为 ID `1`，只通过管理员会话获得。挂载初始化不能申请 ID `1`。登录管理员会清除已有挂载身份；通过有效挂载票据切换到普通用户时，先撤销管理员会话，再签发普通用户身份。缺少身份不会使用默认 ID 登录，已移除 `ORBIT_REQUIRE_MOUNT_USER_ID` 匿名开关。`ORBIT_DEFAULT_USER_ID` 仍可用于服务端资源的默认归属，不能用于认证。

普通用户的 Cookie 一致性校验与管理员登录独立。管理员验证自己的会话记录；普通用户验证签名挂载身份，并在开关启用时验证其 ID 对应的业务 Cookie 指纹。Cookie 绑定只能通过已有可信挂载身份更新，不会将任意首次访问当成可信身份。尚未绑定的用户在开启校验后会被拒绝。主站 Cookie 不会自动跨域传给 iframe；优先使用同源反向代理或集成方的可信身份流程，不能将前端提交的 userId 本身视为登录凭据。

受控的服务端渲染使用私有只读请求头，且浏览器网络限制在本地应用源内；不会通过管理员挂载票据或 URL 参数传递认证令牌。私有 API/执行进程只监听回环地址并要求内部令牌，不应由 Nginx/Kubernetes 单独公开。

管理员会话持久化在 `runtime_meta`，无需新增登录表。设置页及 API 以验证后的管理员身份授权，不再要求第二次输入设置密码或使用前端保存的 Bearer 口令。

鉴权请求独立于工具运行配置刷新和 Runner 恢复。UI 网关仅合并同一会话正在进行的身份预校验，不缓存校验成功的身份；退出、过期和密码变更仍按会话存储判断。认证服务超时或连接中断时，受保护请求返回带 `authentication_service_unavailable` 的 503 响应，不会按已登录放行。API 连接中断返回可识别的 502 服务错误。

设置初始化失败时显示错误和重试入口，保留已有配置，并阻止失败状态下自动保存默认值。Node 的 SQLite ExperimentalWarning 是运行时提示；排查实际失败时，应看认证服务错误、API/执行进程退出记录和连接重置的时间顺序。
