# Outline Quick Notes（速记 / Memos）功能设计文档

## 1. 功能定位

将 usememos/memos 的核心体验——"零摩擦快速捕捉碎片化想法"——作为子功能嵌入 Outline。

| 维度 | Document（已有） | Quick Notes（新增） | Journal（已有设计） |
|------|------------------|---------------------|---------------------|
| 内容长度 | 长篇结构化 | 几行到几段 | 每日一篇 |
| 标题 | 必须 | 不需要 | 自动（日期） |
| 组织方式 | Collection + 树形 | #Tag + Timeline | Calendar + Date |
| 协作 | 多人实时 | 个人为主，可分享 | 个人 |
| 典型场景 | RFC / 技术文档 / Wiki | 灵感/TODO/链接/吐槽 | 每日回顾/工作日志 |

核心价值：Outline 的 Document 创建成本高（选 Collection、起标题、组织结构），Quick Notes 补上"想到就写"的空白。

---

## 2. 从 Memos 中提取的核心特性

经过分析 usememos/memos 的功能集，以下特性适合移植到 Outline：

**必须要有（Phase 1）**
- 即时捕捉输入框（无标题、无 Collection）
- Markdown 内容（复用 Outline 的 Markdown 渲染）
- #Tag 系统（自动解析内容中的 `#tag`，存入 JSONB）
- 时间线展示（按日期分组，倒序）
- 可见性控制（Private / Team）
- Pin 置顶
- 附件（图片拖拽上传）

**锦上添花（Phase 2）**
- Memo → Document 升级（一键将 Memo 转为正式文档）
- Document → Memo 引用（在 Memo 中 @ 引用已有文档）
- Checklist / TODO 支持
- 链接预览卡片
- 标签颜色自定义
- 瀑布流 / Masonry 视图

**不移植的**
- 独立的用户系统（复用 Outline 的）
- gRPC / Protobuf（Outline 用 REST + Koa）
- SQLite 支持（Outline 只用 PostgreSQL）
- SSE 推送（用 Outline 现有的 WebSocket）
- 公开 Explore 页（Outline 是团队内部工具）

---

## 3. 数据模型

### 3.1 Memo 模型

```typescript
// plugins/memos/server/models/Memo.ts

interface Memo {
  id: UUID;
  uid: string;                   // 短 ID，用于 URL（如 "m-a1b2c3"）
  creatorId: UUID;               // FK → User
  teamId: UUID;                  // FK → Team
  content: string;               // Markdown 原文
  visibility: "private" | "team"; // 可见性
  pinned: boolean;               // 是否置顶
  tags: string[];                // 从 content 中解析的 #tag，存入 JSONB 便于查询
  resources: Resource[];         // 附件引用（图片等）
  linkedDocumentId: UUID | null; // 可选：关联到某个 Document
  rowStatus: "normal" | "archived"; // 归档状态

  createdAt: Date;               // Memo 创建时间（核心排序依据）
  updatedAt: Date;
}
```

### 3.2 MemoResource 模型（附件）

```typescript
interface MemoResource {
  id: UUID;
  memoId: UUID;                  // FK → Memo
  attachmentId: UUID;            // FK → Outline 现有的 Attachment
  createdAt: Date;
}
```

### 3.3 关键设计决策：为什么不复用 Document？

Memo 和 Document 在数据层面有本质差异：

```
Document:
  - title 必填 → Memo 没有标题
  - collectionId 必填 → Memo 不属于 Collection
  - content 是 ProseMirror JSON → Memo 只需纯 Markdown
  - state 是 Y.js binary → Memo 不需要实时协作
  - 有版本历史 → Memo 不需要
  - ~20 个字段 → Memo 只需要 ~8 个

复用 Document 会产生大量 null 字段和不必要的逻辑分支。
独立模型更干净，两者通过 linkedDocumentId 互通。
```

### 3.4 数据库迁移

```typescript
// server/migrations/XXXXXX-create-memos.ts

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("memos", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      uid: { type: Sequelize.STRING(12), allowNull: false, unique: true },
      creatorId: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      teamId: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: "teams", key: "id" },
      },
      content: { type: Sequelize.TEXT, allowNull: false, defaultValue: "" },
      visibility: {
        type: Sequelize.ENUM("private", "team"),
        allowNull: false,
        defaultValue: "private",
      },
      pinned: { type: Sequelize.BOOLEAN, defaultValue: false },
      tags: { type: Sequelize.JSONB, defaultValue: [] },
      linkedDocumentId: {
        type: Sequelize.UUID, allowNull: true,
        references: { model: "documents", key: "id" },
        onDelete: "SET NULL",
      },
      rowStatus: {
        type: Sequelize.ENUM("normal", "archived"),
        defaultValue: "normal",
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    // 核心索引
    await queryInterface.addIndex("memos", ["creatorId", "createdAt"]);
    await queryInterface.addIndex("memos", ["teamId", "visibility", "createdAt"]);
    await queryInterface.addIndex("memos", { fields: ["tags"], using: "GIN" });  // JSONB GIN 索引加速 tag 查询
    await queryInterface.addIndex("memos", ["uid"], { unique: true });

    // 全文搜索索引
    await queryInterface.sequelize.query(`
      ALTER TABLE memos ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;
      CREATE INDEX idx_memos_search ON memos USING GIN(search_vector);
    `);

    // 附件关联表
    await queryInterface.createTable("memo_resources", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      memoId: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: "memos", key: "id" },
        onDelete: "CASCADE",
      },
      attachmentId: {
        type: Sequelize.UUID, allowNull: false,
        references: { model: "attachments", key: "id" },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex("memo_resources", ["memoId"]);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("memo_resources");
    await queryInterface.dropTable("memos");
  },
};
```

---

## 4. 后端 API

### 4.1 路由总览

| 端点 | 方法 | 说明 |
|------|------|------|
| `memos.create` | POST | 创建 Memo |
| `memos.list` | POST | 列表（时间线 / 按 tag / 按日期） |
| `memos.info` | POST | 获取单条详情 |
| `memos.update` | POST | 更新内容 / 可见性 / pin |
| `memos.delete` | POST | 删除（软删除 → archived） |
| `memos.search` | POST | 全文搜索 |
| `memos.tags` | POST | 获取用户所有 tag 及计数 |
| `memos.promote` | POST | 升级为 Document |

### 4.2 核心接口设计

#### `memos.create`

```typescript
// Request
{
  content: "New auth middleware pattern is cleaner #engineering #architecture",
  visibility?: "private" | "team",       // 默认 "private"
  linkedDocumentId?: "uuid",             // 可选关联
  resourceIds?: ["attachment-uuid-1"]    // 可选附件
}

// Response
{
  data: {
    id: "uuid",
    uid: "m-a1b2c3",
    content: "New auth middleware pattern is cleaner #engineering #architecture",
    visibility: "private",
    pinned: false,
    tags: ["engineering", "architecture"],  // 自动从 content 中解析
    resources: [],
    creator: { id: "uuid", name: "You" },
    createdAt: "2026-06-02T10:42:00Z"
  }
}
```

Tag 解析逻辑（服务端）：

```typescript
function extractTags(content: string): string[] {
  // 匹配 #tag，支持中文、字母、数字、下划线、连字符、斜杠（层级标签）
  const regex = /#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5/\-]*)/g;
  const tags = new Set<string>();
  let match;
  while ((match = regex.exec(content)) !== null) {
    tags.add(match[1].toLowerCase());
  }
  return Array.from(tags);
}
```

#### `memos.list`

```typescript
// Request
{
  // 过滤条件（均可选）
  creatorId?: "uuid",             // 按作者
  tag?: "engineering",            // 按 tag
  visibility?: "team",            // 按可见性
  pinned?: true,                  // 只看置顶
  startDate?: "2026-06-01",       // 日期范围
  endDate?: "2026-06-30",
  rowStatus?: "normal",           // 默认 normal

  // 分页
  offset?: 0,
  limit?: 20,                     // 默认 20，最大 50
  sort?: "createdAt",
  direction?: "desc"
}

// Response
{
  data: [ /* Memo[] */ ],
  pagination: { offset: 0, limit: 20, total: 128 }
}
```

列表的查询逻辑需处理可见性：

```typescript
async function listMemos(ctx) {
  const user = ctx.state.auth.user;
  const { tag, visibility, pinned, startDate, endDate, creatorId } = ctx.body;

  const where: any = {
    teamId: user.teamId,
    rowStatus: "normal",
  };

  // 可见性过滤：自己的全能看，别人的只看 team
  if (creatorId && creatorId !== user.id) {
    where.visibility = "team";
    where.creatorId = creatorId;
  } else if (creatorId) {
    where.creatorId = creatorId;
    if (visibility) where.visibility = visibility;
  } else {
    // 时间线视图：自己的全部 + 团队可见的
    where[Op.or] = [
      { creatorId: user.id },
      { visibility: "team" },
    ];
  }

  if (tag) {
    where.tags = { [Op.contains]: [tag] };       // JSONB @> 查询
  }
  if (pinned !== undefined) where.pinned = pinned;
  if (startDate) where.createdAt = { [Op.gte]: startDate };
  if (endDate) where.createdAt = { ...where.createdAt, [Op.lte]: endDate };

  const memos = await Memo.findAll({ where, order, limit, offset, include: [...] });
  return memos.map(presentMemo);
}
```

#### `memos.tags`

```typescript
// Request
{ /* 无参数，返回当前用户所有 tag */ }

// Response
{
  data: [
    { name: "engineering", count: 12 },
    { name: "ideas",       count: 8 },
    { name: "bug",         count: 5 },
    { name: "reading",     count: 3 },
    { name: "meeting",     count: 15 },
  ]
}
```

实现（利用 JSONB 展开聚合）：

```sql
SELECT tag, COUNT(*) as count
FROM memos, jsonb_array_elements_text(tags) AS tag
WHERE creator_id = :userId
  AND row_status = 'normal'
GROUP BY tag
ORDER BY count DESC;
```

#### `memos.promote`

将 Memo 升级为正式 Document：

```typescript
// Request
{
  id: "memo-uuid",
  collectionId: "target-collection-uuid",
  title?: "Auth middleware pattern"          // 可选，不填则取 content 前 50 字
}

// Response
{
  data: {
    document: { id: "doc-uuid", url: "/doc/auth-middleware-xxxxxx" },
    memo: { id: "memo-uuid", linkedDocumentId: "doc-uuid" }  // Memo 自动关联到新 Document
  }
}
```

核心逻辑：

```typescript
async function promoteMemo(ctx) {
  const { id, collectionId, title } = ctx.body;
  const user = ctx.state.auth.user;
  const memo = await Memo.findByPk(id);

  authorize(user, "update", memo);

  // 1. 创建 Document
  const document = await documentCreator({
    title: title || memo.content.slice(0, 50).replace(/[#\n]/g, " ").trim(),
    text: memo.content,
    collectionId,
    user,
    publish: true,
  });

  // 2. 关联 Memo → Document
  memo.linkedDocumentId = document.id;
  await memo.save();

  // 3. 迁移附件
  const resources = await MemoResource.findAll({ where: { memoId: memo.id } });
  for (const r of resources) {
    await DocumentAttachment.create({
      documentId: document.id,
      attachmentId: r.attachmentId,
    });
  }

  return { document: presentDocument(document), memo: presentMemo(memo) };
}
```

### 4.3 搜索集成

在 Outline 的全局搜索中加入 Memo 结果：

```typescript
// 扩展 server/routes/api/search.ts

// 在现有 Document 搜索之外，额外查 memos
const memoResults = await Memo.findAll({
  where: {
    [Op.and]: [
      { teamId: user.teamId },
      {
        [Op.or]: [
          { creatorId: user.id },
          { visibility: "team" },
        ],
      },
      Sequelize.literal(`search_vector @@ plainto_tsquery('simple', :query)`),
    ],
  },
  replacements: { query },
  order: [
    [Sequelize.literal(`ts_rank(search_vector, plainto_tsquery('simple', '${query}'))`), "DESC"],
  ],
  limit: 5,
});

// 混合排序后返回
return {
  documents: documentResults,
  memos: memoResults.map(presentMemo),   // 新增字段
};
```

### 4.4 权限策略

```typescript
// plugins/memos/server/policies/memo.ts

allow(User, "read", Memo, (user, memo) => {
  if (memo.creatorId === user.id) return true;
  if (memo.visibility === "team" && memo.teamId === user.teamId) return true;
  return false;
});

allow(User, "update", Memo, (user, memo) => {
  return memo.creatorId === user.id;
});

allow(User, "delete", Memo, (user, memo) => {
  return memo.creatorId === user.id || user.isAdmin;
});
```

---

## 5. 前端设计

### 5.1 文件结构

```
plugins/memos/
├── client/
│   ├── index.tsx                 # 插件注册
│   ├── components/
│   │   ├── MemoComposer.tsx      # 顶部快速输入框
│   │   ├── MemoCard.tsx          # 单条 Memo 卡片
│   │   ├── MemoTimeline.tsx      # 时间线（按日期分组）
│   │   ├── MemoActions.tsx       # 操作菜单（pin/archive/promote/delete）
│   │   ├── TagList.tsx           # 侧边栏 Tag 列表
│   │   ├── TagPill.tsx           # Tag 标签组件
│   │   ├── VisibilityBadge.tsx   # 可见性标识
│   │   ├── LinkPreview.tsx       # 链接预览卡片
│   │   └── PromoteDialog.tsx     # Memo → Document 升级对话框
│   ├── scenes/
│   │   └── QuickNotes.tsx        # 主页面 Scene
│   ├── stores/
│   │   └── MemoStore.ts          # MobX Store
│   └── models/
│       └── Memo.ts               # 前端数据模型
└── server/
    ├── api/
    │   ├── memos.ts              # API 路由
    │   └── schema.ts             # Zod 校验
    ├── models/
    │   ├── Memo.ts               # Sequelize 模型
    │   └── MemoResource.ts
    ├── policies/
    │   └── memo.ts
    ├── presenters/
    │   └── memo.ts
    └── index.ts
```

### 5.2 核心组件

#### MemoComposer（快速输入框）

这是整个功能的灵魂。设计原则：打开即写，0 个必填项。

```tsx
const MemoComposer: React.FC = observer(() => {
  const { memoStore } = useStores();
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<"private" | "team">("private");
  const [isExpanded, setIsExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    await memoStore.createMemo({
      content: content.trim(),
      visibility,
    });
    setContent("");
    setIsExpanded(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Ctrl/Cmd + Enter 提交
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = async (e: ClipboardEvent) => {
    // 支持粘贴图片
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await uploadAndInsert(file);
      }
    }
  };

  return (
    <ComposerContainer onClick={() => setIsExpanded(true)}>
      <TextArea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="What's on your mind? Markdown and #tags supported..."
        rows={isExpanded ? 4 : 1}
      />
      {isExpanded && (
        <Toolbar>
          <ToolbarLeft>
            <IconButton onClick={() => fileInputRef.current?.click()}>
              <PhotoIcon />
            </IconButton>
            <IconButton onClick={insertLink}>
              <LinkIcon />
            </IconButton>
            <IconButton onClick={insertCode}>
              <CodeIcon />
            </IconButton>
            <IconButton onClick={insertChecklist}>
              <CheckboxIcon />
            </IconButton>
          </ToolbarLeft>
          <ToolbarRight>
            <VisibilitySelect value={visibility} onChange={setVisibility} />
            <SubmitButton onClick={handleSubmit} disabled={!content.trim()}>
              Save
            </SubmitButton>
          </ToolbarRight>
        </Toolbar>
      )}
    </ComposerContainer>
  );
});
```

#### MemoCard（单条卡片）

```tsx
const MemoCard: React.FC<{ memo: MemoModel }> = observer(({ memo }) => {
  return (
    <Card>
      <CardHeader>
        <Avatar user={memo.creator} size={22} />
        <UserName>{memo.creator.name}</UserName>
        <TimeAgo dateTime={memo.createdAt} />
        <VisibilityBadge visibility={memo.visibility} />
        {memo.pinned && <PinIndicator />}
        <MemoActions memo={memo} />
      </CardHeader>

      <CardContent>
        <MarkdownRenderer content={memo.content} />
      </CardContent>

      {memo.resources.length > 0 && (
        <ResourceGrid resources={memo.resources} />
      )}

      {memo.linkedDocumentId && (
        <LinkedDocument documentId={memo.linkedDocumentId} />
      )}

      <CardFooter>
        <TagList>
          {memo.tags.map((tag) => (
            <TagPill key={tag} tag={tag} onClick={() => filterByTag(tag)} />
          ))}
        </TagList>
      </CardFooter>
    </Card>
  );
});
```

#### MemoTimeline（时间线）

```tsx
const MemoTimeline: React.FC = observer(() => {
  const { memoStore } = useStores();
  const groupedMemos = memoStore.groupedByDate;  // Map<string, Memo[]>

  return (
    <Timeline>
      {Array.from(groupedMemos.entries()).map(([dateLabel, memos]) => (
        <DateGroup key={dateLabel}>
          <DateHeader>{dateLabel}</DateHeader>  {/* "Today", "Yesterday", "May 30" */}
          {memos.map((memo) => (
            <MemoCard key={memo.id} memo={memo} />
          ))}
        </DateGroup>
      ))}
      <InfiniteScrollTrigger onVisible={() => memoStore.loadMore()} />
    </Timeline>
  );
});
```

### 5.3 MemoStore（MobX）

```typescript
class MemoStore extends BaseStore<Memo> {
  @observable memos: Memo[] = [];
  @observable tags: TagCount[] = [];
  @observable filter: MemoFilter = { rowStatus: "normal" };
  @observable isLoading = false;
  @observable hasMore = true;
  @observable offset = 0;

  @computed get groupedByDate(): Map<string, Memo[]> {
    const groups = new Map<string, Memo[]>();
    const today = formatDate(new Date());
    const yesterday = formatDate(addDays(new Date(), -1));

    for (const memo of this.sortedMemos) {
      const date = formatDate(memo.createdAt);
      let label = date;
      if (date === today) label = "Today";
      else if (date === yesterday) label = "Yesterday";

      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(memo);
    }
    return groups;
  }

  @computed get sortedMemos(): Memo[] {
    // 置顶的排前面，然后按时间倒序
    return [...this.memos].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  @action async createMemo(params: CreateMemoParams) {
    const res = await client.post("/api/memos.create", params);
    runInAction(() => {
      this.memos.unshift(new Memo(res.data));
      this.refreshTags();
    });
  }

  @action async loadMore() {
    if (this.isLoading || !this.hasMore) return;
    this.isLoading = true;

    const res = await client.post("/api/memos.list", {
      ...this.filter,
      offset: this.offset,
      limit: 20,
    });

    runInAction(() => {
      this.memos.push(...res.data.map((d: any) => new Memo(d)));
      this.offset += res.data.length;
      this.hasMore = res.data.length === 20;
      this.isLoading = false;
    });
  }

  @action setTagFilter(tag: string | null) {
    this.filter = { ...this.filter, tag: tag || undefined };
    this.memos = [];
    this.offset = 0;
    this.hasMore = true;
    this.loadMore();
  }

  @action async refreshTags() {
    const res = await client.post("/api/memos.tags");
    runInAction(() => { this.tags = res.data; });
  }
}
```

### 5.4 路由与侧边栏注册

```typescript
// plugins/memos/client/index.tsx

PluginManager.add([
  {
    type: "route",
    value: {
      path: "/notes",
      component: lazy(() => import("./scenes/QuickNotes")),
      exact: true,
    },
  },
  {
    type: "route",
    value: {
      path: "/notes/tag/:tag",
      component: lazy(() => import("./scenes/QuickNotes")),
    },
  },
  {
    type: "sidebarLink",
    value: {
      title: "Quick notes",
      path: "/notes",
      icon: BoltIcon,
      position: "top",
      shortcut: "mod+m",   // 全局快捷键
    },
  },
]);
```

### 5.5 全局快捷键

`Ctrl/Cmd + M`：在任何页面打开一个浮动的 Composer 弹窗，写完直接保存，不离开当前页面。

```tsx
// plugins/memos/client/components/GlobalComposer.tsx

const GlobalComposer: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  useHotkeys("mod+m", (e) => {
    e.preventDefault();
    setIsOpen(true);
  });

  if (!isOpen) return null;

  return (
    <Modal onClose={() => setIsOpen(false)}>
      <MemoComposer onSubmit={() => setIsOpen(false)} />
    </Modal>
  );
};
```

---

## 6. 与现有系统的集成点

### 6.1 全局搜索

在搜索结果中增加 "Quick notes" 分类：

```
搜索 "auth middleware"
├── Documents (3)
│   ├── Auth refactor RFC
│   ├── Authentication guide
│   └── SSO setup
└── Quick notes (2)        ← 新增
    ├── "New auth middleware pattern is cleaner..." (Jun 2)
    └── "TODO: review auth cookie handling" (May 28)
```

### 6.2 Document 中引用 Memo

在 Document 编辑器中支持输入 `/memo` 命令或粘贴 Memo URL，嵌入一个 Memo 预览卡片：

```
[Memo Preview Card]
┌──────────────────────────────────────┐
│ 🔔 You · Jun 2 · Private            │
│ New auth middleware pattern is...     │
│ #engineering #architecture            │
└──────────────────────────────────────┘
```

### 6.3 Memo 中引用 Document

在 Memo 内容中输入 `[[Doc title]]` 或粘贴 Document URL，自动生成链接预览。

### 6.4 事件系统集成

```typescript
// 发布事件供其他插件消费
Event.emit("memos.create", { memo, actor: user });
Event.emit("memos.update", { memo, actor: user });
Event.emit("memos.delete", { memo, actor: user });

// 监听 Document 事件
Event.on("documents.delete", async ({ document }) => {
  // 清除指向已删除文档的链接
  await Memo.update(
    { linkedDocumentId: null },
    { where: { linkedDocumentId: document.id } }
  );
});
```

### 6.5 WebSocket 实时更新

当团队可见的 Memo 被创建/修改/删除时，通过 Outline 现有的 WebSocket 推送给在线用户：

```typescript
// 在 Memo 创建后
socketio.to(team.id).emit("memos.create", presentMemo(memo));
```

---

## 7. 与 Journal 功能的关系

Quick Notes 和之前设计的 Journal 是互补而非竞争的关系：

```
Quick Notes:  碎片化想法  →  随时随地  →  #tag 组织  →  timeline 浏览
Journal:      每日回顾    →  一天一篇  →  日历组织   →  calendar 浏览
```

可以在 Journal 的日记编辑器中展示"当天的 Quick Notes"，作为回顾素材：

```
┌── June 2 Journal ──────────────────┐
│                                     │
│  [Editor area]                      │
│                                     │
│  ── Today's quick notes (3) ──      │
│  • Auth middleware insight  10:42   │
│  • Meeting takeaways         9:15   │
│  • useCallback audit note    8:30   │
│                                     │
└─────────────────────────────────────┘
```

---

## 8. 实施路线

### Phase 1：核心功能（3-4 周）

- 数据库迁移 + Memo / MemoResource 模型
- memos.create / list / update / delete / tags API
- 权限策略
- QuickNotes Scene + MemoComposer + MemoTimeline
- 侧边栏注册 + Tag 列表
- 可见性控制（Private / Team）
- Pin 置顶

### Phase 2：集成增强（2-3 周）

- 全局搜索集成
- 全局快捷键（Ctrl+M）浮动 Composer
- 图片附件上传
- memos.promote（Memo → Document 升级）
- Document ↔ Memo 互相引用
- WebSocket 实时推送

### Phase 3：体验打磨（1-2 周）

- Tag 颜色自定义
- 链接预览卡片
- Masonry / 瀑布流视图
- Journal 中展示当天 Quick Notes
- 批量操作（多选归档 / 打标签）
- 导出（Markdown / JSON）

---

## 9. 技术注意事项

**性能**：时间线使用 cursor-based pagination（基于 createdAt + id 的复合游标），避免 OFFSET 性能问题。首屏只加载 20 条，滚动时无限加载。

**Tag 解析一致性**：服务端和客户端使用同一套 Tag 正则表达式，确保渲染高亮和存储一致。将正则放在 `shared/utils/tags.ts` 中共享。

**存储预算**：Memo 内容上限 5000 字符（够用且避免滥用）。附件复用 Outline 现有的 Attachment 系统和存储后端（S3 / 本地）。

**安全**：Team 可见的 Memo 内容通过 Outline 的 Markdown 渲染管线输出，XSS 防护由现有的 sanitizer 覆盖。Content 入库前做 sanitize。

**数据删除**：`memos.delete` 默认软删除（rowStatus → archived），30 天后由后台任务永久清理。用户可以在归档列表中恢复。
