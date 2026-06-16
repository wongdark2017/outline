# Outline Journal（日记 + 日历）功能设计文档

## 1. 功能概述

为 Outline 新增一个以日历为核心的日记功能，让用户可以按日期写日记或工作日志。核心体验是：点击日历上的某一天，直接进入当天的日记编辑器，使用 Outline 原生的 Markdown 编辑体验。

### 设计原则

- **复用优先**：日记的内容本质上就是 Document，复用 Outline 现有的编辑器、实时协作、版本历史、搜索等全部能力。
- **最小侵入**：通过 Plugin 机制实现，不修改 Outline 核心模型，新增独立的 `JournalEntry` 模型做日期关联。
- **个人空间**：日记默认为私有（只有作者可见），但支持手动分享给团队成员。

---

## 2. 数据模型设计

### 2.1 新增模型：JournalEntry

```typescript
// server/models/JournalEntry.ts

interface JournalEntry {
  id: UUID;                    // 主键
  userId: UUID;                // 所属用户（FK → User）
  teamId: UUID;                // 所属团队（FK → Team）
  documentId: UUID;            // 关联的 Document（FK → Document, UNIQUE）
  date: DATEONLY;              // 日记日期（YYYY-MM-DD，无时区）
  mood: string | null;         // 心情标签（可选）: 'productive' | 'neutral' | 'tired' | 'inspired' | null
  tags: string[];              // 自定义标签数组，如 ['standup', 'retrospective']
  createdAt: Date;
  updatedAt: Date;
}

// 唯一约束：一个用户一天只能有一篇日记
// UNIQUE(userId, date)
```

### 2.2 与现有模型的关系

```
User (1) ──→ (N) JournalEntry (1) ──→ (1) Document (N) ──→ (1) Collection
                                                              ("__journal__")
```

- 每个用户第一次使用 Journal 功能时，系统自动创建一个名为 `__journal__` 的 **私有 Collection**，`permission` 设为 `null`（仅创建者可见）。
- 每个 `JournalEntry` 关联一个 `Document`，该 Document 属于用户的 `__journal__` Collection。
- Document 的 `title` 自动设为日期格式（如 "2026-06-02"），用户可以自行修改。

### 2.3 数据库迁移

```typescript
// server/migrations/XXXXXX-create-journal-entries.ts

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("journal_entries", {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" } },
      teamId: { type: Sequelize.UUID, allowNull: false, references: { model: "teams", key: "id" } },
      documentId: { type: Sequelize.UUID, allowNull: false, unique: true, references: { model: "documents", key: "id" } },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      mood: { type: Sequelize.STRING, allowNull: true },
      tags: { type: Sequelize.ARRAY(Sequelize.STRING), defaultValue: [] },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    // 核心索引
    await queryInterface.addIndex("journal_entries", ["userId", "date"], { unique: true });
    await queryInterface.addIndex("journal_entries", ["userId", "date"], { name: "idx_journal_user_date" });
    await queryInterface.addIndex("journal_entries", ["teamId", "date"]);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("journal_entries");
  },
};
```

---

## 3. 后端 API 设计

所有 API 路由放在 `plugins/journal/server/api/journal.ts` 下，遵循 Outline 现有的 Koa 路由模式。

### 3.1 API 端点

#### `POST /api/journal.entries`

查询指定日期范围内的日记列表。

```typescript
// Request
{
  startDate: "2026-06-01",   // YYYY-MM-DD
  endDate: "2026-06-30",     // YYYY-MM-DD
  sort?: "date",             // 排序字段
  direction?: "desc"         // 排序方向
}

// Response
{
  data: [
    {
      id: "uuid",
      date: "2026-06-02",
      mood: "productive",
      tags: ["standup"],
      document: {
        id: "uuid",
        title: "2026-06-02",
        text: "## Morning standup\n...",
        updatedAt: "2026-06-02T10:42:00Z"
      }
    }
  ],
  pagination: { offset: 0, limit: 31 }
}
```

#### `POST /api/journal.upsert`

创建或更新某天的日记。如果该日期已有日记则返回已有的 Document，否则新建。

```typescript
// Request
{
  date: "2026-06-02",         // 必填
  mood?: "productive",        // 可选
  tags?: ["standup"],         // 可选
  title?: "Sprint review day" // 可选，覆盖默认日期标题
}

// Response
{
  data: {
    id: "journal-entry-uuid",
    date: "2026-06-02",
    mood: "productive",
    document: {
      id: "document-uuid",
      title: "Sprint review day",
      url: "/doc/sprint-review-day-xxxxxxxxxx"
    }
  }
}
```

核心逻辑（伪代码）：

```typescript
async function journalUpsert(ctx) {
  const { date, mood, tags, title } = ctx.body;
  const user = ctx.state.auth.user;

  // 1. 确保用户有 journal collection
  let collection = await Collection.findOne({
    where: { teamId: user.teamId, name: "__journal__", createdById: user.id }
  });
  if (!collection) {
    collection = await Collection.create({
      name: "__journal__",
      teamId: user.teamId,
      createdById: user.id,
      permission: null,         // 私有
      sharing: false,
    });
  }

  // 2. 查找或创建 JournalEntry
  let entry = await JournalEntry.findOne({
    where: { userId: user.id, date }
  });

  if (entry) {
    // 更新 mood/tags
    if (mood !== undefined) entry.mood = mood;
    if (tags !== undefined) entry.tags = tags;
    await entry.save();
  } else {
    // 新建 Document + JournalEntry
    const document = await documentCreator({
      title: title || date,
      collectionId: collection.id,
      user,
      publish: true,
    });

    entry = await JournalEntry.create({
      userId: user.id,
      teamId: user.teamId,
      documentId: document.id,
      date,
      mood: mood || null,
      tags: tags || [],
    });
  }

  return presentJournalEntry(entry);
}
```

#### `POST /api/journal.calendar`

返回指定月份中有日记的日期列表和写作连续天数（streak），用于日历渲染。

```typescript
// Request
{
  year: 2026,
  month: 6         // 1-12
}

// Response
{
  data: {
    dates: ["2026-06-01", "2026-06-02"],   // 有日记的日期
    streak: 2,                               // 当前连续写作天数
    totalEntries: 47                          // 总日记数
  }
}
```

#### `POST /api/journal.info`

获取某一天日记的详细信息。

```typescript
// Request
{ date: "2026-06-02" }

// Response
{
  data: {
    id: "uuid",
    date: "2026-06-02",
    mood: "productive",
    tags: ["standup"],
    document: { /* full document presenter output */ }
  }
}
```

### 3.2 权限策略

在 `plugins/journal/server/policies/journal.ts` 中定义：

```typescript
allow(User, "read", JournalEntry, (user, entry) => {
  return user.id === entry.userId;        // 只有作者能看自己的日记
});

allow(User, "update", JournalEntry, (user, entry) => {
  return user.id === entry.userId;
});

allow(User, "delete", JournalEntry, (user, entry) => {
  return user.id === entry.userId;
});

// 管理员可以看到团队统计（不看内容）
allow(User, "listTeamStats", JournalEntry, (user) => {
  return user.isAdmin;
});
```

---

## 4. 前端设计

### 4.1 文件结构

```
plugins/journal/
├── client/
│   ├── index.tsx              # 插件注册入口
│   ├── components/
│   │   ├── CalendarGrid.tsx    # 月历网格组件
│   │   ├── CalendarNav.tsx     # 月份导航（前/后月）
│   │   ├── DayCell.tsx         # 单日格子（有无日记标识）
│   │   ├── MoodPicker.tsx      # 心情选择器
│   │   ├── RecentEntries.tsx   # 最近日记列表
│   │   ├── StreakBadge.tsx     # 连续写作天数展示
│   │   └── JournalSidebar.tsx  # 左侧日历面板整合
│   ├── scenes/
│   │   └── Journal.tsx         # 日记主页面 Scene
│   ├── stores/
│   │   └── JournalStore.ts     # MobX Store
│   └── models/
│       └── JournalEntry.ts     # 前端数据模型
└── server/
    ├── api/
    │   ├── journal.ts           # API 路由
    │   └── schema.ts            # Zod 请求校验
    ├── models/
    │   └── JournalEntry.ts      # Sequelize 模型
    ├── policies/
    │   └── journal.ts           # 权限策略
    ├── presenters/
    │   └── journalEntry.ts      # API 输出格式化
    └── index.ts                 # 服务端插件注册
```

### 4.2 路由注册

```typescript
// plugins/journal/client/index.tsx

import { PluginManager } from "@shared/utils/PluginManager";

PluginManager.add([
  {
    type: "route",
    value: {
      path: "/journal",
      component: lazy(() => import("./scenes/Journal")),
      exact: true,
    },
  },
  {
    type: "route",
    value: {
      path: "/journal/:date",     // 直接通过 URL 跳到某天
      component: lazy(() => import("./scenes/Journal")),
      exact: true,
    },
  },
  {
    type: "sidebarLink",
    value: {
      title: "Journal",
      path: "/journal",
      icon: CalendarIcon,         // 使用 outline-icons 中的日历图标
      position: "top",            // 放在侧边栏靠上的位置
    },
  },
]);
```

### 4.3 核心组件设计

#### Journal Scene（主页面）

```
┌──────────────────────────────────────────────────┐
│  [<] June 2026 [>]        [Month] [Timeline]     │
├───────────────┬──────────────────────────────────┤
│               │                                   │
│  ┌─Calendar─┐ │  Tuesday, June 2, 2026            │
│  │Mo Tu We..│ │  ── Title ───────────────────      │
│  │ 1  2  3  │ │                                   │
│  │ ...      │ │  [ Outline Document Editor ]       │
│  └──────────┘ │  （复用现有 DocumentEditor）         │
│               │                                   │
│  ── Recent ── │                                   │
│  • Jun 2      │  ┌─Mood: 😊 Productive ─┐         │
│  • Jun 1      │  │Tags: #standup         │         │
│  • May 30     │  └───────────────────────┘         │
│               │                                   │
└───────────────┴──────────────────────────────────┘
```

#### JournalStore（MobX）

```typescript
class JournalStore {
  @observable selectedDate: string = today();    // YYYY-MM-DD
  @observable currentMonth: { year: number; month: number };
  @observable entries: Map<string, JournalEntry> = new Map();  // date → entry
  @observable calendarDots: Set<string> = new Set();           // 有日记的日期集合
  @observable streak: number = 0;
  @observable isLoading: boolean = false;

  // 切换日期 → 自动加载或创建日记
  @action
  async selectDate(date: string) {
    this.selectedDate = date;
    await this.fetchOrCreateEntry(date);
  }

  // 切换月份 → 重新加载日历数据
  @action
  async changeMonth(year: number, month: number) {
    this.currentMonth = { year, month };
    await this.fetchCalendarData(year, month);
  }

  // 获取月历打点数据
  async fetchCalendarData(year: number, month: number) {
    const res = await client.post("/api/journal.calendar", { year, month });
    runInAction(() => {
      this.calendarDots = new Set(res.data.dates);
      this.streak = res.data.streak;
    });
  }

  // 获取或创建某天日记
  async fetchOrCreateEntry(date: string) {
    this.isLoading = true;
    const res = await client.post("/api/journal.upsert", { date });
    runInAction(() => {
      this.entries.set(date, res.data);
      this.calendarDots.add(date);
      this.isLoading = false;
    });
  }
}
```

#### CalendarGrid 组件核心逻辑

```tsx
const CalendarGrid: React.FC<{
  year: number;
  month: number;
  dots: Set<string>;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}> = ({ year, month, dots, selectedDate, onSelectDate }) => {
  const firstDay = new Date(year, month - 1, 1).getDay();    // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = formatDate(new Date());

  const cells = [];
  // 填充月初空白
  const offset = firstDay === 0 ? 6 : firstDay - 1;          // 调整为周一起始
  for (let i = 0; i < offset; i++) cells.push(null);
  // 填充日期
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({
      day: d,
      date: dateStr,
      hasEntry: dots.has(dateStr),
      isToday: dateStr === today,
      isSelected: dateStr === selectedDate,
      isFuture: dateStr > today,
    });
  }

  return (
    <Grid>
      {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
        <WeekdayHeader key={d}>{d}</WeekdayHeader>
      ))}
      {cells.map((cell, i) =>
        cell ? (
          <DayCell
            key={cell.date}
            {...cell}
            onClick={() => !cell.isFuture && onSelectDate(cell.date)}
          />
        ) : (
          <EmptyCell key={`empty-${i}`} />
        )
      )}
    </Grid>
  );
};
```

### 4.4 两种视图模式

#### 月历视图（默认）

左侧日历面板 + 右侧编辑器，如上面的 UI 概念图所示。

#### 时间线视图

类似于 Outline 现有的文档列表页，按时间倒序排列所有日记条目，每个条目显示日期、标题、摘要（前 200 字）、心情和标签。适合回顾和搜索。

```
┌──────────────────────────────────────────────┐
│  Timeline                                     │
│                                               │
│  June 2, 2026 · 😊 Productive                │
│  Morning standup                              │
│  Discussed the new authentication flow...     │
│  #standup                                     │
│  ─────────────────────────────────────────    │
│  June 1, 2026 · 💡 Inspired                  │
│  Sprint review notes                          │
│  Great progress on the API refactor...        │
│  #retrospective                               │
│  ─────────────────────────────────────────    │
│  May 30, 2026                                 │
│  API refactor ideas                           │
│  ...                                          │
└──────────────────────────────────────────────┘
```

---

## 5. Plugin 注册

### 5.1 服务端注册

```typescript
// plugins/journal/server/index.ts

import { PluginManager } from "@server/utils/PluginManager";
import router from "./api/journal";
import JournalEntry from "./models/JournalEntry";
import policy from "./policies/journal";

PluginManager.add([
  { type: "apiRoute",  value: router },
  { type: "model",     value: JournalEntry },
  { type: "policy",    value: policy },
]);
```

### 5.2 事件处理

```typescript
// plugins/journal/server/events/journal.ts

// 当关联的 Document 被删除时，同步删除 JournalEntry
Event.on("documents.delete", async ({ document }) => {
  const entry = await JournalEntry.findOne({
    where: { documentId: document.id }
  });
  if (entry) {
    await entry.destroy();
  }
});

// 当用户被从团队移除时，归档其日记 Collection
Event.on("users.delete", async ({ user }) => {
  const collection = await Collection.findOne({
    where: { name: "__journal__", createdById: user.id }
  });
  if (collection) {
    await collection.archive(user);
  }
});
```

---

## 6. 特殊功能

### 6.1 写作连续天数（Streak）

在日历页面顶部展示"已连续写作 X 天"的徽章，鼓励用户每天记录。

计算逻辑：

```sql
-- 从今天向前查找连续有日记的天数
WITH dates AS (
  SELECT date FROM journal_entries
  WHERE user_id = :userId
  ORDER BY date DESC
)
SELECT COUNT(*) AS streak
FROM (
  SELECT date, date - ROW_NUMBER() OVER (ORDER BY date DESC)::int AS grp
  FROM dates
) t
WHERE grp = (
  SELECT date - ROW_NUMBER() OVER (ORDER BY date DESC)::int
  FROM dates
  LIMIT 1
);
```

### 6.2 心情追踪

每篇日记可选设一个心情标签（mood），在日历上以不同颜色的圆点展示。在时间线视图中可以按心情过滤。

预设心情：
- `productive` → 蓝色点
- `inspired` → 紫色点
- `neutral` → 灰色点
- `tired` → 黄色点
- `frustrated` → 红色点

### 6.3 快捷方式

- `Cmd/Ctrl + J` → 打开今天的日记
- URL 直接访问：`/journal/2026-06-02` → 跳到指定日期
- 侧边栏中 Journal 入口右侧显示 streak badge

### 6.4 搜索集成

日记内容本质是 Document，所以 Outline 的全文搜索天然覆盖日记内容。可在搜索结果中通过图标区分普通文档和日记。

### 6.5 导出

复用 Outline 现有的 Document 导出功能（Markdown / HTML / PDF）。额外提供按月份批量导出。

---

## 7. 实施路线建议

### Phase 1：核心功能（2-3 周）

- 数据库迁移 + JournalEntry 模型
- journal.upsert / journal.entries / journal.calendar API
- 权限策略
- Journal Scene + CalendarGrid 组件
- 侧边栏注册

### Phase 2：体验增强（1-2 周）

- Streak 计算和展示
- 心情选择器 + 日历打点颜色
- 时间线视图
- 快捷键绑定

### Phase 3：进阶功能（可选）

- 日记模板（每天预填固定结构，如 standup 格式）
- 按月/按标签的统计面板
- 团队管理员仪表盘（只看活跃度统计，不看内容）
- WebSocket 推送，多端实时同步日历状态

---

## 8. 技术风险和注意事项

**数据隔离**：`__journal__` Collection 的 permission 必须设为 null，确保默认私有。需要在 Collection 的列表查询中过滤掉该特殊 Collection，避免在普通侧边栏显示。

**时区处理**：使用 `DATEONLY` 类型存储日期，避免时区转换问题。前端在创建日记时使用用户本地日期（而非 UTC）。

**性能**：日历打点查询只返回日期列表（不含 Document 内容），避免一次性加载整月文档。Document 内容按需加载（点击某天时才 fetch）。

**冲突处理**：`journal.upsert` 使用 `UNIQUE(userId, date)` 约束，并在应用层做 find-or-create 逻辑，确保同一天不会创建多篇日记。

**向前兼容**：如果未来 Outline 官方增加类似功能，`__journal__` Collection 和 `journal_entries` 表可以通过迁移脚本平滑合并。
