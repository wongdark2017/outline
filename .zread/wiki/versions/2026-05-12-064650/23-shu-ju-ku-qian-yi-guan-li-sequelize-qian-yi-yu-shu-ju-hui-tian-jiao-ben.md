Outline 的数据库演进并不是“写个 migration 文件然后跑完就结束”。如果顺着当前代码看，它实际上有三条并行但互相配合的机制：

- `sequelize-cli` 负责常规 schema migration 命令入口
- 运行时用 Umzug 再做一层“启动即检查并执行待迁移”
- `server/scripts/` 里保留了一批单独的数据回填 / 纠偏脚本

这三条线一起构成了 Outline 的迁移管理方式。理解它，关键是先区分两类问题：

- **schema 变更**：表、列、索引、约束、视图怎么演进
- **data migration / backfill**：旧数据怎么补齐、重写、修正

Sources: [package.json](package.json), [.sequelizerc](.sequelizerc), [server/config/database.js](server/config/database.js), [server/storage/database.ts](server/storage/database.ts), [server/utils/startup.ts](server/utils/startup.ts), [server/index.ts](server/index.ts), [server/migrations/20160619080644-initial.js](server/migrations/20160619080644-initial.js), [server/migrations/20231118195149-add-content-to-documents.js](server/migrations/20231118195149-add-content-to-documents.js), [server/migrations/20220127000000-index-fixes.js](server/migrations/20220127000000-index-fixes.js), [server/migrations/20210730044248-create-realtime.js](server/migrations/20210730044248-create-realtime.js), [server/migrations/20220430043135-collection-sort-backfill.js](server/migrations/20220430043135-collection-sort-backfill.js), [server/migrations/20240319230356-fix-user-permissions-createdby-constraint.js](server/migrations/20240319230356-fix-user-permissions-createdby-constraint.js), [server/migrations/20250601223331-migrate-backlink-to-relationship.js](server/migrations/20250601223331-migrate-backlink-to-relationship.js), [server/scripts/bootstrap.ts](server/scripts/bootstrap.ts), [server/scripts/20221008000000-backfill-crdt.ts](server/scripts/20221008000000-backfill-crdt.ts), [server/scripts/20231119000000-backfill-document-content.ts](server/scripts/20231119000000-backfill-document-content.ts), [server/scripts/20250327062414-resolve-collection-index-collisions.ts](server/scripts/20250327062414-resolve-collection-index-collisions.ts)

## 先建立一张“迁移系统地图”

可以先把 Outline 当前的数据库演进路径理解成：

```text
开发期
  -> yarn db:create-migration
  -> server/migrations/*.js
  -> yarn db:migrate / db:rollback / db:reset

运行期启动
  -> server/index.ts
  -> checkPendingMigrations()
  -> Umzug 发现 pending migration
  -> 自动执行或因 --no-migrate 报错退出

少数版本升级 / 大数据回填
  -> server/scripts/*.ts
  -> bootstrap 加载 env / db / redis
  -> 手工运行脚本完成 backfill
```

这张图背后的重点是：**Outline 把“迁移文件”和“数据修复脚本”分成了两套工具，而不是强迫所有历史数据处理都塞进 migration。**

## 命令入口还是 `sequelize-cli`，但并不是系统唯一的迁移执行器

`package.json` 里保留了传统的脚本：

- `yarn db:create-migration`
- `yarn db:create`
- `yarn db:migrate`
- `yarn db:rollback`
- `yarn db:reset`

这说明开发者日常操作仍然围绕 Sequelize CLI。

### `.sequelizerc` 把 CLI 路径显式固定住了

这个文件告诉 CLI：

- 配置文件在 `server/config/database.js`
- migration 路径在 `server/migrations`
- model 路径在 `server/models`

WHY 这一步重要？因为项目不是扁平结构，而是 monorepo 风格的 server 子目录。没有 `.sequelizerc`，CLI 默认路径就会错位。

### `server/config/database.js` 是给 CLI 用的最小数据库配置

它只暴露：

- host / port / username / password / database
- 以及 production 下的 SSL 差异

也就是说，CLI 配置和应用运行时的数据库初始化并不是完全同一份实现。CLI 配置更轻、更偏兼容 Sequelize 生态。

Sources: [package.json](package.json), [.sequelizerc](.sequelizerc), [server/config/database.js](server/config/database.js)

## 运行时真正使用的是 Umzug，而不是直接在应用里嵌 Sequelize CLI

这一点非常值得注意。真正应用启动时使用的是：

- `createMigrationRunner(...)`
- `new Umzug(...)`

而不是在代码里去 shell 调 `sequelize db:migrate`。

### `server/storage/database.ts` 里同时维护了数据库连接和迁移 runner

这个文件做了几件关键事：

- 创建主写连接 `sequelize`
- 可选创建只读连接 `sequelizeReadOnly`
- 通过 `createMigrationRunner` 包装 Umzug
- 最终导出 `migrations`

这让“数据库连接”和“迁移执行”处在同一套运行时上下文里，日志、错误处理和环境配置都能统一。

### `createMigrationRunner` 明确把 migration 文件当 CommonJS 模块加载

它会：

- 用 glob 找 `migrations/*.js`
- `require(path)`
- 期望模块导出 `up` / `down`
- 把执行上下文设为 `db.getQueryInterface()`
- 用 `SequelizeStorage` 记录执行历史

这说明当前迁移文件格式虽然看起来是老派 JS，但它和 Umzug 的整合是有意识维持的。

### 迁移日志也被接入了统一 Logger

Runner 的 logger 会把：

- migrating
- migrated
- error

都转到项目自己的 `Logger` 体系，而不是让 Umzug 自己往 stdout 乱写。

这让迁移在生产环境里也更像正式基础设施行为。

Sources: [server/storage/database.ts](server/storage/database.ts)

## 应用启动时会主动检查 pending migration，而不是“假设外部已经跑好”

`server/index.ts` 在 master 进程启动时会调用：

- `checkPendingMigrations()`

这个设计很重要，它意味着 Outline 默认认为：

- 应用启动前不一定有人手工跑过 `db:migrate`

因此系统要自己兜一次。

### `checkPendingMigrations` 先拿一把分布式锁

在真正跑 pending 之前，它会通过：

- `MutexLock.acquire("migrations", ...)`

先竞争一把 migrations 锁。

WHY 这里要加锁？因为 Outline 支持多进程 / 多服务启动。如果没有这把锁，多个实例同时发现 pending 并一起跑 migration，后果会很差。

### 有 pending 时会自动迁移，除非显式传了 `--no-migrate`

逻辑大致是：

- 有 pending
- 如果传了 `--no-migrate`，直接 fatal
- 否则 `migrations.up()`

这说明 Outline 的生产默认更偏“自举成功”，而不是“严格要求外部编排系统先做完一切”。

### 启动检查里还包含一类“手工数据迁移提醒”

`checkDataMigrations()` 会针对某些历史版本组合，在生产环境直接 fatal，并打印明确提示：

- 先备份数据库
- 跑完 schema migration
- 再手工执行指定脚本

这很有现实感。不是所有历史数据问题都适合做成自动 migration，系统会坦率承认某些升级路径需要人工介入。

Sources: [server/index.ts](server/index.ts), [server/utils/startup.ts](server/utils/startup.ts)

## migration 文件本身反映了项目长期演进的历史

`server/migrations/` 目录从 2016 年一直延续到现在，而且能明显看出 Outline 架构的逐步演化。

## 最初的 migration 更像“快速建起第一版产品骨架”

例如 `20160619080644-initial.js` 里还能看到：

- `atlases`
- 早期 `documents`
- 早期 `users`
- 早期 `teams`

这说明 migration 目录不只是当前 schema 的变更记录，它还是项目历史本身。

### 从旧 migration 可以直接看出命名和数据模型的演进轨迹

像：

- `atlases -> collections`
- `html / preview` 这类旧字段
- 早期 `isAdmin` 布尔位

都能说明今天的模型结构是怎样一步步长出来的。

Sources: [server/migrations/20160619080644-initial.js](server/migrations/20160619080644-initial.js)

## 常规 schema 增量变更通常非常小而清楚

例如：

- `20231118195149-add-content-to-documents.js`

只做了两件事：

- 给 `documents` 加 `content`
- 给 `revisions` 加 `content`

这类 migration 非常符合理想状态：

- 只动 schema
- up / down 对称
- 不掺业务 backfill

后续真正把旧 `text/state` 转成 `content` 的工作，再交给单独脚本。

这正是 Outline 迁移策略的核心之一：**schema 先到位，数据慢慢补。**

Sources: [server/migrations/20231118195149-add-content-to-documents.js](server/migrations/20231118195149-add-content-to-documents.js)

## 索引和约束修复经常直接写 raw SQL 或 QueryInterface 操作

以 `20220127000000-index-fixes.js` 为例，它会：

- 添加多个实际查询需要的索引
- 删除一些历史遗留、命名奇怪或不再需要的索引

这说明 migration 并不只负责“新功能加列”，也承担性能治理和 schema 清理。

类似的，像：

- `20240319230356-fix-user-permissions-createdby-constraint.js`

则是明确修改约束的 `onDelete` 行为。

WHY 把这类修复也放 migration 而不是手工 DBA 操作？因为它们本质仍是 schema contract 的一部分，应该和代码版本一起走。

Sources: [server/migrations/20220127000000-index-fixes.js](server/migrations/20220127000000-index-fixes.js), [server/migrations/20240319230356-fix-user-permissions-createdby-constraint.js](server/migrations/20240319230356-fix-user-permissions-createdby-constraint.js)

## 较复杂的结构演进会在 migration 里显式处理兼容层

`20250601223331-migrate-backlink-to-relationship.js` 是一个很好的例子。它不只是：

- rename table

而是同时做了：

- `backlinks -> relationships`
- 加 `type` enum 列
- 加新索引
- 创建一个 `backlinks` view 做兼容

这类 migration 的重点不是“改成新名字”，而是**让新旧代码和历史数据在过渡期还能共存**。

这也说明 Outline 的 migration 并不总追求最短脚本，有时会明确为兼容期付出复杂度。

Sources: [server/migrations/20250601223331-migrate-backlink-to-relationship.js](server/migrations/20250601223331-migrate-backlink-to-relationship.js)

## 功能开关型 migration 往往只先铺最小存储结构

例如协作编辑相关的：

- `20210730044248-create-realtime.js`

只是：

- 给 `documents` 加 `state`
- 给 `teams` 加 `collaborativeEditing`

WHY 这样的小 migration 值得注意？因为它体现了一个常见策略：

- 先给未来功能铺字段
- 再让应用代码、后台服务和 backfill 脚本逐步接上

这比一次 migration 同时做 schema、数据迁移、业务切换更稳。

Sources: [server/migrations/20210730044248-create-realtime.js](server/migrations/20210730044248-create-realtime.js)

## 不是所有“数据回填”都去 `server/scripts/`，少量轻量 backfill 也会留在 migration 里

例如：

- `20220430043135-collection-sort-backfill.js`

它直接在 migration 里：

- 每次处理 1000 行
- 给 `sort IS NULL` 的 collection 回填默认值

这说明 Outline 的边界并不是死板地“migration 绝不碰数据”。更准确地说是：

- **轻量、低风险、与 schema 强绑定的数据修复** 可以留在 migration
- **重、慢、可能长时间运行或需要人工控制的 backfill** 更适合单独脚本

Sources: [server/migrations/20220430043135-collection-sort-backfill.js](server/migrations/20220430043135-collection-sort-backfill.js)

## `server/scripts/` 是另一条非常重要的数据迁移通道

很多真正麻烦的数据迁移都被放进：

- `server/scripts/*.ts`

这些脚本的共同点通常是：

- 需要分页扫全表
- 可能很慢
- 可能依赖应用级 helper、editor schema、Redis 或模型方法
- 往往不适合跟 schema migration 绑死在一次启动窗口里

### `bootstrap.ts` 给这些脚本准备了完整运行环境

它会先：

- 加载 dotenv
- require 数据库
- require Redis

这样脚本运行时就能直接复用应用里的：

- model
- helper
- storage
- env

所以这些脚本不是“数据库外的零散小工具”，而是应用内部的正式维护工具。

Sources: [server/scripts/bootstrap.ts](server/scripts/bootstrap.ts)

## `backfill-crdt.ts` 很能说明为什么某些迁移必须独立成脚本

这份脚本做的事情包括：

- 分页扫文档
- 跳过已有 `state` 或没有 `text` 的文档
- 把 Markdown / text parse 成 ProseMirror
- 再写回 Yjs CRDT `state`
- 最后 `hooks: false`、`silent: true` 保存

WHY 这不适合塞进 migration？

- 它依赖编辑器 parser / serializer / Yjs
- 成本可能很高
- 逻辑上是“旧数据补齐”，不是 schema 变更
- 跑的时机可能需要按 team 分批进行

脚本里甚至还要求：

- hosted 场景必须传 teamId

这进一步说明它是面向真实线上运维约束设计的。

Sources: [server/scripts/20221008000000-backfill-crdt.ts](server/scripts/20221008000000-backfill-crdt.ts)

## `backfill-document-content.ts` 展示了“先加列，再慢慢填值”的典型套路

这份脚本会：

- 找 `content` 为空但 `text` 存在的文档
- 如果有 `state`，优先从 Yjs 转 `content`
- 否则从 `text` parse 成 ProseMirror JSON
- 显式 `changed("content", true)`
- 再 `hooks: false` / `silent: true` 保存

这正好和前面的 `add-content-to-documents.js` 配成一组：

1. migration 加 `content` 列
2. script 回填旧数据

这种分层比把所有转换逻辑塞进 migration 稳得多，也更容易中断 / 重跑。

Sources: [server/scripts/20231119000000-backfill-document-content.ts](server/scripts/20231119000000-backfill-document-content.ts), [server/migrations/20231118195149-add-content-to-documents.js](server/migrations/20231118195149-add-content-to-documents.js)

## 纠偏脚本往往比 backfill 更像“线上修复工具”

`20250327062414-resolve-collection-index-collisions.ts` 很有代表性。它不是给新字段补值，而是修历史脏数据：

- 按 team 扫 collection
- 用事务和 `LOCK.UPDATE`
- 找出重复 `index`
- 用 `fractionalIndex(...)` 重新生成区间值
- `hooks: false` / `silent: true` 保存

这类脚本本质上是在做：

- 数据质量修复
- 线上异常状态治理

它和 migration 的“声明 schema 演进”已经不是同一种工作了。

Sources: [server/scripts/20250327062414-resolve-collection-index-collisions.ts](server/scripts/20250327062414-resolve-collection-index-collisions.ts)

## 迁移体系和应用启动、服务拆分是联动的

这一点也很容易被忽略。`server/index.ts` 里的启动顺序大致是：

1. 检查数据库连接
2. 检查并执行 pending migrations
3. 打印环境信息
4. 再启动 web / worker / cron / websockets / collaboration 等服务

WHY 这一步顺序重要？因为一旦 schema 还没跟上，后面的：

- model 加载
- worker 消费
- cron 扫表
- presenter 返回

都可能直接出错。

所以迁移在 Outline 里不是独立运维动作，而是整个服务生命周期的启动前置条件。

Sources: [server/index.ts](server/index.ts), [server/services/index.ts](server/services/index.ts), [server/utils/startup.ts](server/utils/startup.ts)

## 为什么 Outline 要用“migration + script”双轨制

Outline 的数据库演进面临几个现实问题：

1. **Schema 变更很多，但并不都适合绑定长时间数据回填**
2. **有些 backfill 依赖应用层 helper、编辑器逻辑、Yjs 或 Redis**
3. **生产环境是多进程 / 多服务，启动期必须避免并发跑迁移**
4. **某些历史升级路径需要人工判断和分批执行**

在这些条件下，双轨制的优点非常明显：

- migration 保持尽量小、清楚、可回滚
- script 负责慢、重、需要业务 helper 的数据修复
- 启动时 Umzug 再兜一次 pending 检查
- 少数危险升级路径还能显式提示人工步骤

这比“所有东西都塞 migration”要务实得多，也更符合一个长期运营项目的真实需要。

## 建议继续阅读

- 想看这些迁移最终支撑的是哪些 Sequelize 模型结构：读 [数据模型层：Sequelize 模型定义、关联与生命周期钩子](18-shu-ju-mo-xing-ceng-sequelize-mo-xing-ding-yi-guan-lian-yu-sheng-ming-zhou-qi-gou-zi)
- 想看很多 backfill 脚本为什么会依赖协作状态、content 和 helper：读 [实时协作编辑：Hocuspocus、Y.js CRDT 与 WebSocket 持久化](15-shi-shi-xie-zuo-bian-ji-hocuspocus-y-js-crdt-yu-websocket-chi-jiu-hua)
- 想看 worker / cron 这些服务怎样消费迁移后的新字段和索引：读 [异步任务与事件驱动：Bull 队列、Processor 与 Task 体系](22-yi-bu-ren-wu-yu-shi-jian-qu-dong-bull-dui-lie-processor-yu-task-ti-xi)
- 想看附件和对象存储相关 schema 演进的下一层主题：读 [文件存储：S3 兼容存储与附件管理](24-wen-jian-cun-chu-s3-jian-rong-cun-chu-yu-fu-jian-guan-li)
- 想看 Redis、队列和数据库在运维层面的协作：读 [Redis 缓存策略与会话管理](25-redis-huan-cun-ce-lue-yu-hui-hua-guan-li)
- 想从部署角度理解为什么启动时会自动检查迁移：读 [Docker 部署：镜像构建与 docker-compose 配置](31-docker-bu-shu-jing-xiang-gou-jian-yu-docker-compose-pei-zhi) 和 [生产环境配置：环境变量、日志、监控与优雅关闭](32-sheng-chan-huan-jing-pei-zhi-huan-jing-bian-liang-ri-zhi-jian-kong-yu-you-ya-guan-bi)
