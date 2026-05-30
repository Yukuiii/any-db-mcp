
  [
    {"file":"src/adapters/oracle.ts","line":164,"summary":"transaction() 中前序 
  DDL 在 Oracle 会隐式提交,后续步骤失败时 rollback 无法撤销,却仍返回 
  committed:false,向调用方误报整体已回滚。","failure_scenario":"sqls=[CREATE 
  TABLE t..., 非法 INSERT] → CREATE 已隐式提交且不可回滚,返回 
  {committed:false},调用方据此以为无副作用,实际表已残留。"},
    {"file":"src/adapters/postgresql.ts","line":207,"summary":"describeTable 
  索引查询按表列号 a.attnum 排序而非索引键序(indkey 
  数组顺序),复合索引列序被打乱(被本次 schema 
  改动触达的函数内既有缺陷)。","failure_scenario":"表 t(a,b) 上 CREATE 
  INDEX(b,a) → 返回该索引 columns=[a,b],与真实键序 [b,a] 相反,LLM 
  据此按错误前导列写查询无法命中索引。"},
    {"file":"src/adapters/mssql.ts","line":254,"summary":"describeTable 
  索引查询未过滤 ic.is_included_column,INCLUDE 的非键列(key_ordinal=0)被并入 
  columns,且因 ORDER BY key_ordinal 
  排在键列之前(触达函数内既有缺陷)。","failure_scenario":"CREATE INDEX ix ON 
  t(a) INCLUDE(b,c) → 索引键被错误呈现为 (b,c,a),误导索引选择。"},
    {"file":"src/adapters/mssql.ts","line":288,"summary":"外键 referenced_table 
  仅取 t2.name 裸表名,丢失被引用父表的 schema 限定;本次引入多 schema 
  支持后该问题从理论变为现实风险。","failure_scenario":"sales.orders 外键引用 
  billing.customers,而 sales 下也有同名 customers → referencedTable 输出 
  'customers',消费方无法分辨真实父表,跨 schema 关联串台。"},
    {"file":"src/adapters/oracle.ts","line":504,"summary":"normalizeOracleName 
  无条件 toUpperCase,使所有 owner=:schema 过滤对用双引号创建的小写/混合大小写 
  owner 永不匹配。","failure_scenario":"配置 DB_SCHEMA=\"billing\"(库中 owner 
  实为小写 billing)→ 归一化为 BILLING → listTables 
  返回空、describeTable/sampleData/estimateRowCount 全部判表不存在。"},
    {"file":"src/adapters/oracle.ts","line":531,"summary":"formatOracleType 对 
  NUMBER(*,s)(data_precision 为 NULL、data_scale=s)跳过 NUMBER 
  分支,落到末尾返回裸 \"NUMBER\",丢失 scale。","failure_scenario":"列定义 
  NUMBER(*,2) → 类型显示为裸 NUMBER,LLM 误判为整数列。"},
    {"file":"src/adapters/postgresql.ts","line":204,"summary":"索引查询用 
  a.attnum = ANY(ix.indkey) 关联 pg_attribute,表达式/函数索引 indkey 含 0 
  占位无法 join,该索引的表达式列被静默丢弃(触达函数内既有缺陷)。","failure_scena
  rio":"CREATE INDEX ix ON t(lower(email)) → indkey={0} join pg_attribute 
  无匹配行 → 该索引在结果中缺列或整体消失,LLM 误判无此索引。"},
    {"file":"src/adapters/oracle.ts","line":310,"summary":"外键 referencedTable 
  在跨 schema 时拼成 'schema.table'、同 schema 时为裸表名,与其它 4 个 
  adapter(恒裸表名)及自身结果集内不一致。","failure_scenario":"自动解析得 
  orders∈BILLING,其两个外键分别指向 BILLING.customers 与 PUBLIC.regions → 
  referencedTable 分别为 'customers' 和 
  'PUBLIC.regions',命名风格不一,消费方统一处理时出错。"},
    {"file":"src/resources.ts","line":40,"summary":"db://tables 读取回调 
  db.listTables() 无 .catch(两个 list 回调均有),读取期间 reject 会被 SDK 转为 
  JSON-RPC error 而非 resourceJson,违反'返回内容必须是 
  JSON'约定。","failure_scenario":"读取 db://tables 时连接中途丢失 → 
  listTables() reject → 客户端收到原始 InternalError 而非带 error 字段的 JSON 
  资源。"},
    {"file":"src/tools/describe-table.ts","line":33,"summary":"未配置/未传 
  schema 时,Promise.all 
  三路(describeTable/estimateRowCount/sampleData)各自独立调用一次 
  resolveTableSchema/resolveTableTarget,产生 3 次相同的解析往返,2 
  次纯冗余。","failure_scenario":"对 PG/MSSQL/Oracle 调用 describe_table 不带 
  schema → 同一 table 发起 3 次相同解析 SELECT,高延迟连接下每次调用多约 
  2×RTT;先解析一次再传具体 schema 即可消除。"},

  {"file":"src/adapters/postgresql.ts","line":342,"summary":"resolveTableSchema 
  在显式/已配置 schema 时直接返回不校验表是否存在;describeTable 对该 schema 
  下不存在的表返回 {schema:非null,columns:[]}(伪存在),而 sampleData 拼 SQL 后抛 
  relation does not exist,二者'不存在'语义不一致(非本次新引入,但被非 public 
  schema 放大)。","failure_scenario":"配置 
  schema=tenant_app,describe_table('missing') → describeTable
  返回空结构看似存在,内部 sampleData 抛错被 .catch 吞为 [];直接调 db.sampleData
  则暴露崩溃,MSSQL 同理。"},
    {"file":"src/adapters/oracle.ts","line":410,"summary":"未配置 schema 时,同一
  owner 内存在仅大小写不同的两张表会被 table_name=:table OR UPPER(:table) 
  同时命中,触发'在多个 schema 中存在'歧义错误,而二者实为同一 
  schema。","failure_scenario":"BILLING 下同时有 \"orders\" 与 ORDERS → 
  describeTable('orders') 抛 '候选:BILLING.orders, BILLING.ORDERS','多个 
  schema'与'请指定 schema'提示均误导(指定 BILLING 也无法消歧)。极罕见。"},
    {"file":"src/adapters/oracle.ts","line":348,"summary":"estimateRowCount 用 
  Number(raw) 转换 all_tables.num_rows,超过 2^53 时精度丢失且 Number.isFinite 
  仍为 true 不回退 null(mysql/mssql 同模式)。","failure_scenario":"num_rows 
  统计值 > 9e15 → 
  返回被舍入的值;机制真实但触发需千万亿级行数,现实近乎不可能。"},
    {"file":"__test__/resources.test.mjs","line":162,"summary":"resources 
  测试传入已 decode 的 variables 且通过私有字段 template._callbacks.list() 
  调用,既未覆盖 handler 的 decodeURIComponent 真实链路,又依赖 SDK 
  内部结构。","failure_scenario":"schema/表名含 %20/中文时若 decode 
  逻辑回归,测试仍通过;SDK 重命名内部字段时 .list() 抛 TypeError,list 
  行为回归无人察觉。"},
    {"file":"src/adapters/postgresql.ts","line":336,"summary":"altitude/重复:sch
  ema 解析(resolveTableSchema/resolveTableTarget,含一字不差的歧义文案)在 
  PG/MSSQL/Oracle 三处平行重复,clampLimit(5份)、normalizeSchema(3份)、isXxxConne
  ctionLost+withRetry(4份)、quote 函数及 
  DEFAULT_PORTS(config.ts+connect.ts)均多份;config.ts 对 DB_TYPE 直接 as 
  不做枚举校验。","failure_scenario":"修改 schema 
  解析语义/歧义文案/采样上限/默认端口需同步 3-5 处,漏改即产生 adapter
  间行为分叉;新增数据库类型时 DB_TYPE 拼写错误只在 createAdapter switch default
  才暴露,错误信息远离根因。"}
  ]