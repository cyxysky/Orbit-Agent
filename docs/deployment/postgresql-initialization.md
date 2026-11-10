# PostgreSQL 初始化

初始化脚本：[`sql/postgresql-init.sql`](../../sql/postgresql-init.sql)。适用于新的空 PostgreSQL 数据库，包含当前物理表、索引、触发器、外键和 **11 条迁移记录**。

当前共 **18 张服务端业务表 + 1 张迁移记录表**。

| 分组 | 业务表数量 | 用途 |
| --- | ---: | --- |
| 对话与上下文 | 2 | 会话头、分类记录与可选无损压缩正文 |
| 执行状态 | 2 | 执行归属、当前状态、调用去重、变量 |
| 自动化 | 3 | 定义、计划、执行记录 |
| Skill 与记忆 | 3 | Skill、记忆条目、分类记忆流程记录 |
| 用户、账号和 Cookie | 3 | 用户身份及引导状态、账号、站点 Cookie |
| 通信集成 | 2 | 会话与入站消息 |
| AI 运营归档 | 1 | 对话删除前归档的统计信息 |
| 基础设施 | 2 | 配置及版本元数据、分类请求记录 |

在 PowerShell 中执行：

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f .\sql\postgresql-init.sql
```

随后配置 `DATABASE_DRIVER=postgres` 和 `DATABASE_URL`。脚本在事务中执行并记录已应用迁移，启动时不会重复执行。**已有数据库使用应用正常迁移，不执行空库脚本。** 升级前停止旧应用并备份数据库；合并与压缩迁移只能向前，回退需恢复备份。

脚本由 `applicationMigrations` 生成，空库不创建已退役的表、函数或触发器：

```powershell
npm run db:postgres:init-sql
```

生成不连接数据库。当前脚本已在独立 PGlite PostgreSQL 内核执行，确认 19 张物理表与 11 条迁移记录；另验证旧结构迁移、候选分页、知识版本触发器和 BYTEA 无损正文。没有连接部署中的 PostgreSQL。

合并关系见[数据表与存储精简](../architecture/storage-table-review.md)，体积与回收规则见[存储压缩说明](../architecture/storage-compaction.md)。
