# PostgreSQL 初始化

初始化脚本：[`sql/postgresql-init.sql`](../../sql/postgresql-init.sql)。适用于新的空 PostgreSQL 数据库，包含应用表、索引、触发器、外键及当前全部迁移记录。

当前共 34 张表，`application_user` 保存用户 Cookie 身份绑定。导出 SQL 没有另外创建一套业务表。

| 分组 | 数量 | 用途 |
| --- | ---: | --- |
| 对话与上下文 | 7 | 会话、消息、步骤、日志、模型上下文记录和请求清单，以及文件消息投影 |
| Agent 和浏览器运行状态 | 6 | 当前运行状态、事件、调用去重、压缩快照、执行归属，以及浏览器代码持久状态 |
| 自动化 | 3 | 任务定义、定时计划、执行记录 |
| Skill 与记忆 | 6 | Skill、记忆条目、处理回执、知识版本、记忆候选和后台记忆任务 |
| 用户、账号和 Cookie | 4 | 用户身份绑定、站点登录账号、站点 Cookie、用户引导进度 |
| 通信集成 | 2 | 通信会话和入站消息 |
| AI 运营归档 | 1 | 对话删除前归档的统计信息 |
| 基础设施 | 5 | 应用配置、运行元数据、WebSocket 票据、API 幂等记录、数据库迁移记录 |

拆分消息、日志和上下文记录是为了分别分页读取；当前运行状态用于恢复，调用记录用于去重，事件和压缩历史属于追踪数据。文件消息表属于加速文件列表查询的投影。当前调用链中，两张运行历史表没有生产读取方，用户引导状态也存在合并空间，具体依据见[数据表精简审查](../architecture/storage-table-review.md)。

在 PowerShell 中执行：

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f .\sql\postgresql-init.sql
```

随后按部署配置设置 `DATABASE_DRIVER=postgres` 和 `DATABASE_URL`。脚本在事务中执行，记录当前 9 个迁移，因此应用启动不会重复创建这些表。已有数据库使用应用正常迁移，不执行本初始化脚本。

脚本从应用实际使用的 `applicationMigrations` 清单生成；增加迁移后重新导出：

```powershell
npm run db:postgres:init-sql
```

生成过程不连接数据库。已在隔离 PGlite PostgreSQL 内核中执行整份 SQL，确认创建 34 张表（含迁移记录表）及 9 条迁移记录；未连接或变更部署数据库。
