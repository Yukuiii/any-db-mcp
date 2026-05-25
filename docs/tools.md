# 工具详解

## 无权限约束的工具

### connect

动态连接数据库。连接成功自动断开旧连接，返回表名列表和当前权限模式。

| 参数 | 类型 | 必需 | 说明 |
|------|------|:---:|------|
| type | enum | 是 | mysql / postgresql / sqlite / mssql |
| host | string | 否 | 主机地址，默认 localhost（SQLite 不需要） |
| port | number | 否 | 端口，0 表示使用默认端口 |
| user | string | 否 | 用户名（SQLite 不需要） |
| password | string | 否 | 密码（SQLite 不需要） |
| database | string | 否 | 数据库名（SQLite 不需要） |
| filepath | string | 否 | SQLite 文件路径（仅 SQLite） |
| encrypt | boolean | 否 | MSSQL TLS 加密，默认 true |
| trustServerCertificate | boolean | 否 | MSSQL 信任自签证书，默认 false |

成功响应包含：`message`、`type`、`connection`、`permissionMode`、`tableCount`、`tables`。

### disconnect

主动断开连接并释放连接池。幂等，未连接时调用也安全。无参数。

### connection_status

查看当前连接状态。无参数。

返回：`connected`、`type`（数据库类型）、`pingMs`（耗时）、`permissionMode`。

### query

执行只读 SQL 查询。仅允许 `SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN` 开头语句。

| 参数 | 类型 | 说明 |
|------|------|------|
| sql | string | 要执行的 SQL 查询语句 |

返回：`rowCount`、`rows`、`elapsedMs`。

安全约束：拦截多语句，拦截非只读 SQL。

### list_tables

列出当前库所有表名。无参数。

返回：`tableCount`、`tables`、`elapsedMs`。

### describe_table

一次性返回表的结构、索引、外键、估算行数、采样数据。

| 参数 | 类型 | 必需 | 说明 |
|------|------|:---:|------|
| table | string | 是 | 表名 |
| sampleLimit | number | 否 | 采样行数，默认 3，0 不采样，最大 20 |

返回：`table`、`columns`、`indexes`、`foreignKeys`、`rowCount`、`rowCountIsEstimate`、`sampleCount`、`sample`、`elapsedMs`。

### explain

获取 SQL 执行计划，不实际执行原 SQL。仅支持 `SELECT` / `INSERT` / `UPDATE` / `DELETE` / `WITH`。

| 参数 | 类型 | 说明 |
|------|------|------|
| sql | string | 要分析的 SQL（无需自带 EXPLAIN 前缀，工具自动拼接） |

返回：`rowCount`、`plan`（执行计划行数组）、`elapsedMs`。

安全约束：拒绝用户自带 `EXPLAIN` 前缀；拒绝 `ANALYZE` / `VACUUM` 等实质会写入的语句。

## 受权限约束的工具

### execute

执行单条写操作。

| 模式 | 允许 |
|------|------|
| readonly | 禁止此工具 |
| readwrite | 仅 INSERT / UPDATE / DELETE |
| full | DML + DDL（DROP / TRUNCATE / ALTER / CREATE / GRANT / REVOKE） |

| 参数 | 类型 | 说明 |
|------|------|------|
| sql | string | 单条 SQL 写语句 |

返回：`mode`、`affectedRows`、`insertId`、`elapsedMs`。

安全约束：多语句拦截 + 权限模式校验 + SQL 类型正则校验。

### transaction

在事务中顺序执行多条 SQL，任一失败全部回滚。

| 参数 | 类型 | 说明 |
|------|------|------|
| sqls | string[] | SQL 数组，至少一条 |

权限规则与 execute 一致。

成功返回：`committed: true`、`mode`、`stepCount`、`steps`（各步骤 `affectedRows`/`insertId`）、`elapsedMs`。

失败返回：`committed: false`、`failedAt`（0-based 失败位置）、`error`。

安全约束：逐条 SQL 含多语句拦截 + 权限校验，全部通过后才启动事务。
