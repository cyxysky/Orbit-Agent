# PostgreSQL 初始化

初始化脚本：[`sql/postgresql-init.sql`](../../sql/postgresql-init.sql)。适用于新的空 PostgreSQL 数据库，包含应用表、索引、触发器、外键及当前全部迁移记录。

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
