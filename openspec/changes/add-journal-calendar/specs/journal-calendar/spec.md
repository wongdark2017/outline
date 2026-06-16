## 新增需求

### 需求:用户可以打开 Journal 月历
系统必须为已认证用户提供 Journal 入口，用户从侧栏进入后可以看到当前用户时区下的月历视图、已有日记日期标记、连续记录统计和最近记录列表。

#### 场景:从侧栏进入 Journal
- **当** 已认证用户点击侧栏中的 Journal 入口
- **那么** 系统打开 `/journal` 路由并展示 Journal Scene

#### 场景:加载月历数据
- **当** 用户打开 Journal Scene
- **那么** 系统请求当前年月的 Journal calendar 数据并展示该月已有日记的日期标记

#### 场景:显示连续记录统计
- **当** 当前用户有连续日记记录
- **那么** 系统展示连续天数，并在超过可精确计算上限时展示 `366+ day streak`

### 需求:用户可以按日期创建或打开日记
系统必须允许已认证用户点击非未来日期，打开该日期已有日记文档；若该日期没有日记，则创建私有 Journal 文档和 JournalEntry 后打开文档。

#### 场景:首次点击日期创建日记
- **当** 用户点击一个没有 JournalEntry 的非未来日期
- **那么** 系统创建 Journal collection、Document 和 JournalEntry，并跳转到新文档 URL

#### 场景:重复点击日期打开已有日记
- **当** 用户点击一个已有 JournalEntry 且关联 Document 未在 Trash 的日期
- **那么** 系统返回同一个 Document URL，不创建重复 JournalEntry 或重复 Document

#### 场景:禁止创建未来日期
- **当** 用户请求为其 profile timezone 下晚于今天的日期创建 JournalEntry
- **那么** 系统拒绝请求并返回 400

#### 场景:禁止编辑 Trash 中的日记
- **当** 用户请求打开或更新一个关联 Document 已软删除的 JournalEntry
- **那么** 系统返回 409，并要求用户先恢复文档

### 需求:JournalEntry 元数据受权限保护
系统必须将 JournalEntry 的 mood 和 tags 仅暴露给同一团队内的作者本人，并禁止 viewer 和 guest 更新 JournalEntry 元数据。

#### 场景:作者读取自己的日记元数据
- **当** JournalEntry 的作者请求 `journal.info` 或日期范围数据
- **那么** 系统返回该 entry 的 date、mood、tags、document、createdAt 和 updatedAt

#### 场景:拒绝跨用户读取
- **当** 同团队其他用户请求不属于自己的 JournalEntry
- **那么** 系统禁止访问该 JournalEntry

#### 场景:viewer 打开已有日记但不更新元数据
- **当** viewer 请求打开自己已有的 JournalEntry 且请求中不包含 mood 或 tags
- **那么** 系统允许读取并返回关联文档

#### 场景:viewer 或 guest 更新元数据被拒绝
- **当** viewer 或 guest 请求更新 JournalEntry 的 mood 或 tags
- **那么** 系统拒绝更新请求

### 需求:Journal 系统集合保持私有并从普通集合列表隐藏
系统必须为每个用户创建或复用带有 `sourceMetadata.externalId = "outline:journal"` 标记的私有 Journal collection，并在普通集合侧栏中隐藏该系统集合。

#### 场景:创建系统集合
- **当** 用户首次创建 JournalEntry 且没有已标记的 Journal collection
- **那么** 系统创建名称为 `__journal__`、`permission = null`、`sharing = false` 且 `sourceMetadata.externalId = "outline:journal"` 的集合

#### 场景:复用已标记集合
- **当** 用户已有带 `sourceMetadata.externalId = "outline:journal"` 标记的 Journal collection
- **那么** 系统复用该集合创建新的 Journal 文档

#### 场景:不复用历史同名集合
- **当** 用户已有名称为 `__journal__` 但没有 `outline:journal` sourceMetadata 标记的集合
- **那么** 系统不得将该集合当作 Journal 系统集合复用或隐藏

#### 场景:隐藏系统集合
- **当** 侧栏渲染普通集合列表
- **那么** 系统过滤掉 `sourceMetadata.externalId = "outline:journal"` 的集合

### 需求:保留系统集合名称前缀
系统必须禁止普通集合通过 create 或 update API 使用 `__` 开头的名称，防止用户创建与系统集合冲突的名称。

#### 场景:拒绝创建保留名集合
- **当** 用户通过普通集合创建 API 提交以 `__` 开头的集合名称
- **那么** 系统返回 400 并提示集合名称为保留名称

#### 场景:拒绝重命名为保留名
- **当** 用户通过普通集合更新 API 将集合名称改为以 `__` 开头
- **那么** 系统返回 400 并提示集合名称为保留名称

#### 场景:允许非改名更新
- **当** 用户通过普通集合更新 API 修改非 name 字段且请求未包含 name
- **那么** 系统不得因为保留名校验而抛出运行时错误

### 需求:日历和列表只展示可见日记
系统必须在 `journal.entries` 和 `journal.calendar` 中排除关联 Document 已软删除的 JournalEntry，并在 Document 恢复后重新展示该日记。

#### 场景:软删除后从日历隐藏
- **当** JournalEntry 关联的 Document 被软删除
- **那么** `journal.calendar` 和 `journal.entries` 不返回该 entry

#### 场景:恢复文档后重新展示
- **当** 已软删除的 Journal Document 被恢复
- **那么** `journal.calendar` 和 `journal.entries` 再次返回该 entry

#### 场景:永久删除后清理元数据
- **当** Journal Document 触发 `documents.permanent_delete` 事件
- **那么** 系统删除关联的 JournalEntry

### 需求:Journal API 校验日期范围和时区
系统必须校验 Journal API 的日期、范围、tags、mood 和 timezone 输入，拒绝无效请求并限制查询成本。

#### 场景:拒绝无效日期
- **当** 用户提交 `2026-02-31` 或非日期字符串
- **那么** 系统拒绝请求并返回校验错误

#### 场景:拒绝反向日期范围
- **当** 用户请求 `journal.entries` 且 startDate 晚于 endDate
- **那么** 系统拒绝请求并返回校验错误

#### 场景:拒绝超长日期范围
- **当** 用户请求超过 366 天的 inclusive 日期范围
- **那么** 系统拒绝请求并返回校验错误

#### 场景:拒绝无效 tags
- **当** 用户提交空字符串 tag、超过 40 字符的 tag 或超过 20 个 tags
- **那么** 系统拒绝请求并返回校验错误

#### 场景:拒绝无效 timezone
- **当** 用户向 `journal.calendar` 提交无效 IANA timezone
- **那么** 系统拒绝请求并返回校验错误

### 需求:并发 upsert 不产生重复数据
系统必须在同一用户同一日期的并发 `journal.upsert` 请求下保持幂等，最多创建一个 JournalEntry 和一个关联 Document。

#### 场景:并发创建同一日期
- **当** 同一用户并发请求创建同一日期的 JournalEntry
- **那么** 所有成功响应指向同一个 JournalEntry 和同一个 Document

#### 场景:唯一约束兜底
- **当** 数据库发生 JournalEntry 唯一约束冲突
- **那么** 系统必须回滚当前事务，避免提交孤儿 Document

## 修改需求

无。

## 移除需求

无。
