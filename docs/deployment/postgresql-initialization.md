# PostgreSQL 初始化

初始化脚本：[sql/postgresql-init.sql](../../sql/postgresql-init.sql)。适用于新的空 PostgreSQL 数据库，包含当前物理表、索引、触发器、外键和 **12 条迁移记录**。

当前共 **6 张业务表 + 1 张迁移记录表，共 7 张物理表**。

| 表 | 用途 |
| --- | --- |
| runtime_meta | 配置、知识版本、管理员会话 |
| workspace_entity | 对话头、归档、自动化、通信会话和执行归属 |
| workspace_record | 分类明细、运行状态、记忆流程和通信入站消息 |
| knowledge_record | Skill 和记忆条目 |
| user_record | 用户档案、账号凭据和站点 Cookie |
| request_record | 一次性票据和幂等记录 |
| typeorm_migration | 迁移历史 |

在 PowerShell 中执行：

~~~powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f .\sql\postgresql-init.sql
~~~

随后配置 DATABASE_DRIVER=postgres 和 DATABASE_URL。脚本在事务中执行并记录已应用迁移，启动时不会重复执行。**已有数据库使用应用正常迁移，不执行空库脚本。** 升级前停止旧应用并备份数据库；合并与压缩迁移只能向前，回退需恢复备份。

脚本由 applicationMigrations 生成，空库不创建已退役的表、函数或触发器：

~~~powershell
npm run db:postgres:init-sql
~~~

生成不连接数据库。脚本已在独立 PGlite PostgreSQL 内核执行，确认 7 张物理表与 12 条迁移记录；还验证旧结构升级、密文与 BYTEA 正文保留、知识版本触发器、跨类型同 ID、外键、账号和 Cookie 隔离。没有连接部署中的 PostgreSQL。

合并关系见[数据表与存储精简](../architecture/storage-table-review.md)，体积与回收规则见[存储压缩说明](../architecture/storage-compaction.md)。
