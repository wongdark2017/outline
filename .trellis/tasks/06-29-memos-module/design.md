# Design — Outline usememos-style memos module

## Summary

这个任务不是新建一个第二版 Memos，而是把已有的 Memo MVP 发展成一个真正独立的模块。
设计核心是：把 `06-25-memos-quick-capture` 视为基础层，然后用分阶段演进方式把产品体验
向 usememos 靠拢。

新增产品约束：用户希望进入 `/memos` 后的体验与 usememos 网站“几乎一样”。因此设计上要把
首屏 IA、录入入口位置、时间线呈现密度、筛选结构和交互优先级当作一等目标，而不是只补齐后端能力。

## Architecture stance

### Keep

- 现有 `Memo` 模型与基础 API
- 现有 `MemosStore`、`/memos` 路由、侧栏入口
- 现有 `#tag` 建模方向
- Outline 的认证、权限、附件、分享、路由框架
- ProseMirror 编辑器和现有 rich content 基础设施

### Evolve

- `/memos` 页面信息架构
- 时间线展示与录入交互
- 标签筛选和聚合方式
- 搜索索引与查询面
- visibility 从“字段存在”进化到真实产品行为
- 媒体/资源从“附件可挂靠”进化到 usememos 风格资源面

### Avoid

- 推翻现有 `Memo` 模型重做
- 直接嵌入外部 usememos 服务
- 为追求外观相似而引入脱离 Outline 的前端模式

## Module decomposition

### Phase A — Foundation

对应现有子任务 `06-25-memos-quick-capture`。

职责：

- 独立 Memo 实体
- 个人时间线
- 基础录入、编辑、归档、删除
- `#tag` 自动补全
- 基础附件关联

这是后续所有阶段的依赖层。

### Phase B — Capture and timeline UX

目标是让最常用路径先“像 usememos”：

- 录入区更突出、更低摩擦
- 时间线更像信息流，不像表单卡片列表
- 更好的 tag 呈现与点击流转
- 快捷操作更集中
- 移动端录入和浏览体验单独设计

这里优先改的是交互密度和工作流效率，不先做复杂后端能力。

### Phase C — Search and filters

- 全文搜索 memo 内容
- tag + visibility + archived + date range 交叉过滤
- 搜索与时间线一体化，而不是单独临时按钮
- 为未来统计/回顾复用查询能力

这会引入后端索引和查询设计，可能需要与现有 Outline 搜索机制选择“复用”还是“局部专用”。

### Phase D — Visibility, workspace feed, sharing

- `private / workspace / public` 真实可见
- 用户个人流之外的 workspace feed
- 公开访问或分享入口
- 路由和 presenter 按可见性拆分读取规则

这是从“个人工具”变成“团队知识流”的关键阶段。

### Phase E — Review and stats

- 每日回顾 / 时间段回顾
- 标签聚合与热点
- 写作统计、连续天数、热力图
- 面向习惯养成的轻量反馈

这一阶段依赖前面稳定的查询和数据聚合能力。

### Phase F — API and integrations

- 明确的 memos API 面
- 导入 / 导出
- webhook / automation / capture endpoints
- 与外部录入渠道的兼容面

这阶段把模块从 UI 功能扩展成平台能力。

## Key product deltas vs usememos

### Intentional matches

- 快速输入优先
- 时间线优先
- `#tag` 为主组织方式
- 搜索和过滤是核心而不是附属
- 资源/媒体和公开可见性是模块能力的一部分

### Intentional differences

- 编辑器不会退回纯 Markdown；仍以 ProseMirror 为主
- 用户体系、权限体系、分享体系沿用 Outline
- 团队内导航与页面布局要服从 Outline 整体 IA
- 某些社交能力可以晚于个人工作流上线

## Data model direction

当前 `Memo` 模型可以继续承载以下演进：

- `visibility` 真正参与读取逻辑和 feed 查询
- tags 的聚合索引增强
- 资源/附件展示元数据增强
- 统计/搜索所需的派生字段或索引

尽量避免早期就引入独立 `Tag` 表。是否需要单独 `Tag` 实体，应该在搜索/统计阶段再评估。

## Frontend direction

不建议继续把 `/memos` 维持成单页“编辑器 + 卡片列表”。
更接近目标形态的前端结构应当拆成：

- capture composer
- timeline/feed surface
- filters/search bar
- sidebar facets（tags / saved filters / archives）
- detail/resource affordances

这样后续每一阶段都能局部增强，而不是持续把一个页面组件堆胖。

## Backend direction

后端应逐步形成独立 memo 领域，而不是只是一组零散路由：

- list / search / tags / visibility feeds / resource queries
- creator/updater/query services 分层
- presenter 针对个人流、团队流、公开流可能出现差异

## Risks

1. 范围膨胀：如果不先分阶段，“完全复刻”会立刻变成无限任务。
2. UI debt：沿着当前 MVP 页面继续堆功能，会很快失控。
3. Search mismatch：Outline 现有搜索偏文档，memo 搜索需求更轻、更快、更频繁。
4. Resource UX gap：附件字段存在不等于资源体验成立。
5. Product identity drift：过度复制 usememos 细节，可能跟 Outline 整体体验脱节。

## Recommendation

优先按 Phase B → C → D 的顺序推进。

理由：

- 先把“捕获 + 时间线”做对，用户才会持续产生 memo 数据。
- 没有稳定内容量，搜索、统计、团队流都很难验证真实价值。
- visibility 和 workspace feed 可以在有基本使用量后更清楚地落地。
