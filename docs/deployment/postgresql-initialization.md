# PostgreSQL 初始化

初始化脚本：[`sql/postgresql-init.sql`](../../sql/postgresql-init.sql)。适用于新的空 PostgreSQL 数据库，包含当前物理表、索引、触发器、外键和 10 条迁移记录。

当前共 **22 张业务表 + 1 张迁移记录表**。

| 分组 | 业务表数量 | 用途 |
| --- | ---: | --- |
| 对话与上下文 | 2 | 会话头与分类对话记录 |
| 执行状态 | 2 | 执行归属与分类执行记录 |
| 自动化 | 3 | 任务定义、计划、执行记录 |
| Skill 与记忆 | 6 | Skill、记忆、回执、知识版本、候选与后台任务 |
| 用户、账号和 Cookie | 3 | 用户身份及引导状态、站点账号、站点 Cookie |
| 通信集成 | 2 | 通信会话与入站消息 |
| AI 运营归档 | 1 | 对话删除前归档的统计信息 |
| 基础设施 | 3 | 配置及会话元数据、WebSocket 票据、API 幂等记录 |

在 PowerShell 中执行：

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f .\sql\postgresql-init.sql
```

随后配置 `DATABASE_DRIVER=postgres` 和 `DATABASE_URL`。脚本在事务中执行并记录已应用迁移，应用启动时不会重复执行这些迁移。**已有数据库使用应用的正常迁移流程，不执行空库初始化脚本。** 合并旧表的升级应先停止旧版本应用并备份数据库；不能依靠迁移 down 拆回旧表。

脚本由 `applicationMigrations` 生成，并移除空库不需要的旧表及数据复制语句：

```powershell
npm run db:postgres:init-sql
```

生成过程不连接数据库。当前脚本已在独立 PGlite PostgreSQL 内核执行，确认 23 张物理表、10 条迁移记录，以及消息文件投影的插入和级联删除。SQLite 的旧库升级和实际存储函数另行验证；未连接部署中的 PostgreSQL 服务器。

合并关系见[数据表合并](../architecture/storage-table-review.md)。
