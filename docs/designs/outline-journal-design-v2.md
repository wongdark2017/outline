# Outline Journal（日记 + 日历）功能设计文档 v2

> 本文档基于 Outline 实际源码结构修订，已纠正 v1 中关于插件化边界、并发处理、权限一致性等问题。

---

## 1. 架构定位（v1 勘误）

### v1 的错误假设

v1 声称"完全通过 Plugin 机制实现，不修改核心模型/路由"。这不成立。

实际的 Outline 插件能力边界：

| 接入方式 | 服务端 PluginManager 支持的 Hook | 客户端 PluginManager 支持的 Hook |
|----------|-------------------------------|-------------------------------|
| 已有 | `api`、`authProvider`、`emailTemplate` | `settings`、`imports`、`icon` |
| **不存在** | ~~model~~、~~policy~~、~~processor~~ | ~~route~~、~~sidebarLink~~ |

### v2 的正确定位

**可以插件化的部分：** API 路由——通过 `Hook.API` 挂载到 `/api` 路由前面。

**必须核心接入的部分：**

- `JournalEntry` Sequelize 模型 → 加入 `server/models/index.ts` 导出链
- 权限策略 → 加入 `server/policies/index.ts` 静态 import
- 前端路由 `/journal` → 注册到 `app/routes/authenticated.tsx`
- 侧栏入口 → 修改现有 Sidebar 组件
- `JournalEntriesStore` → 注册到 `app/stores/RootStore.ts`

这不是一个纯插件功能，而是一个需要在核心代码中做 5-6 处接入的新功能模块，后端 API 逻辑放在 `plugins/journal/` 目录以保持代码组织的清晰。

---

## 2. 数据模型

### 2.1 JournalEntry 模型

```typescript
// server/models/JournalEntry.ts

import {
  Column,
  Table,
  BelongsTo,
  ForeignKey,
  DataType,
  IsDate,
} from "sequelize-typescript";
import { IdModel } from "./base/IdModel";
import User from "./User";
import Team from "./Team";
import Document from "./Document";

@Table({
  tableName: "journal_entries",
  modelName: "journal_entry",
  timestamps: true,    // createdAt + updatedAt
  paranoid: false,      // 不需要软删除，跟随 Document 生命周期
})
class JournalEntry extends IdModel {
  @Column(DataType.DATEONLY)
  date: string;                    // "YYYY-MM-DD"，无时区

  @Column({
    type: DataType.ENUM("productive", "neutral", "tired", "inspired", "frustrated"),
    allowNull: true,
  })
  mood: string | null;

  @Column({ type: DataType.JSONB, defaultValue: [] })
  tags: string[];

  // ── 外键 ──

  @BelongsTo(() => User, "userId")
  user: User;
  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string;

  @BelongsTo(() => Team, "teamId")
  team: Team;
  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Document, "documentId")
  document: Document;
  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;
}

export default JournalEntry;
```

### 2.2 唯一约束（v1 勘误）

v1 使用 `UNIQUE(userId, date)`，隐含一个用户只属于一个团队。Outline 的多租户模型下应改为：

```
UNIQUE(teamId, userId, date)
```

所有查询也必须带 `teamId` 条件，与 Outline 现有的多租户查询模式一致。

### 2.3 数据库迁移

```typescript
// server/migrations/XXXXXX-create-journal-entries.ts

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("journal_entries", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      userId: {                                   // Outline 惯例：migration 中用 camelCase
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      teamId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "teams", key: "id" },
        onDelete: "CASCADE",
      },
      documentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "documents", key: "id" },
        onDelete: "CASCADE",                      // Document 物理删除时级联删 entry
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      mood: {
        type: Sequelize.ENUM("productive", "neutral", "tired", "inspired", "frustrated"),
        allowNull: true,
      },
      tags: {
        type: Sequelize.JSONB,
        defaultValue: [],
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    // 核心：一个用户在一个团队中一天只能有一篇日记
    await queryInterface.addIndex("journal_entries", ["teamId", "userId", "date"], {
      unique: true,
      name: "journal_entries_team_user_date",
    });

    // 查询用：按用户列出日期范围内的 entries
    await queryInterface.addIndex("journal_entries", ["userId", "date"]);

    // 查询用：按团队统计（未来用）
    await queryInterface.addIndex("journal_entries", ["teamId", "date"]);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("journal_entries");
  },
};
```

### 2.4 Document 删除联动

Outline 的 Document 删除分两步：软删除（设 `deletedAt`）和物理删除（永久清理）。

对于软删除，外键 CASCADE 不会触发。需要在事件处理器中处理：

```typescript
// plugins/journal/server/processors/JournalProcessor.ts
// 或直接放在 server/queues/processors/ 中

import { Event, JournalEntry } from "@server/models";

export default class JournalProcessor {
  // Document 被软删除时，同步删除关联的 JournalEntry
  static async documentDeleted(event: Event) {
    const { documentId } = event;
    await JournalEntry.destroy({
      where: { documentId },
    });
  }

  // Document 被恢复时无需处理，因为 entry 已删除
  // 用户需要从 Journal 界面重新创建当天的日记
}
```

注册事件处理的方式取决于 Outline 现有的 event/processor 体系。如果走 `server/queues/processors`，需要在对应的 document processor 中加一个调用。

---

## 3. 核心接入点（共 6 处核心文件修改）

### 3.1 模型导出

```typescript
// server/models/index.ts — 新增一行

export { default as JournalEntry } from "./JournalEntry";
```

这一行确保 Sequelize 的 `sequelize.addModels()` 能发现并注册 JournalEntry 表。

### 3.2 权限策略

```typescript
// server/policies/journalEntry.ts

import { allow } from "./cancan";
import { User, JournalEntry } from "@server/models";

allow(User, "read", JournalEntry, (actor, entry) => {
  // 只有作者本人可以读取日记元数据
  return actor.id === entry.userId && actor.teamId === entry.teamId;
});

allow(User, "update", JournalEntry, (actor, entry) => {
  return actor.id === entry.userId && actor.teamId === entry.teamId;
});

allow(User, "delete", JournalEntry, (actor, entry) => {
  return actor.id === entry.userId && actor.teamId === entry.teamId;
});

// MVP 不做：管理员统计
```

注册：

```typescript
// server/policies/index.ts — 新增一行

import "./journalEntry";
```

### 3.3 前端路由

```typescript
// app/routes/authenticated.tsx — 在现有路由列表中新增

const Journal = lazy(() => import("~/scenes/Journal"));

// 在 <Switch> 内新增
<Route exact path="/journal" component={Journal} />
<Route exact path="/journal/:date" component={Journal} />
```

### 3.4 侧栏入口

在 Outline 现有的 Sidebar 组件体系中添加 Journal 链接。具体位置取决于 Sidebar 的组件结构（通常在 `app/components/Sidebar/` 下的主导航区域），与 Home、Search、Drafts、Starred 同级：

```tsx
// 在 Sidebar 的主导航区域中新增

<SidebarLink
  to="/journal"
  icon={<CalendarIcon />}
  label={t("Journal")}
/>
```

### 3.5 前端 Store

```typescript
// app/stores/JournalEntriesStore.ts

import { observable, action, runInAction, computed } from "mobx";
import RootStore from "./RootStore";
import JournalEntry from "~/models/JournalEntry";
import { client } from "~/utils/ApiClient";

export default class JournalEntriesStore {
  @observable selectedDate: string = "";    // YYYY-MM-DD
  @observable currentMonth: { year: number; month: number };
  @observable entries: Map<string, JournalEntry> = new Map();  // date → entry
  @observable calendarDots: Set<string> = new Set();
  @observable streak: number = 0;
  @observable isLoading: boolean = false;
  @observable error: string | null = null;

  rootStore: RootStore;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    const now = new Date();
    this.currentMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };
    this.selectedDate = this.formatDate(now);
  }

  private formatDate(d: Date): string {
    return d.toISOString().split("T")[0];   // YYYY-MM-DD
  }

  @action
  async fetchCalendar(year: number, month: number) {
    try {
      const res = await client.post("/api/journal.calendar", { year, month });
      runInAction(() => {
        this.calendarDots = new Set(res.data.dates);
        this.streak = res.data.streak;
      });
    } catch (err) {
      runInAction(() => { this.error = err.message; });
    }
  }

  /**
   * 核心方法：获取或创建某天的日记。
   * 返回关联 Document 的 URL，前端跳转到现有的 Document Scene。
   */
  @action
  async fetchOrCreateByDate(date: string): Promise<string | null> {
    this.isLoading = true;
    this.error = null;
    try {
      const res = await client.post("/api/journal.upsert", { date });
      runInAction(() => {
        this.entries.set(date, new JournalEntry(res.data));
        this.calendarDots.add(date);
        this.isLoading = false;
      });
      return res.data.document.url;       // 返回 Document URL 供跳转
    } catch (err) {
      runInAction(() => {
        this.error = err.message;
        this.isLoading = false;
      });
      return null;
    }
  }

  @action
  async fetchRange(startDate: string, endDate: string) {
    const res = await client.post("/api/journal.entries", {
      startDate,
      endDate,
      direction: "desc",
    });
    runInAction(() => {
      for (const item of res.data) {
        this.entries.set(item.date, new JournalEntry(item));
      }
    });
  }
}
```

注册到 RootStore：

```typescript
// app/stores/RootStore.ts — 新增

import JournalEntriesStore from "./JournalEntriesStore";

class RootStore {
  // 现有 stores...
  journalEntries: JournalEntriesStore;

  constructor() {
    // 现有初始化...
    this.journalEntries = new JournalEntriesStore(this);
  }
}
```

### 3.6 前端 Model

```typescript
// app/models/JournalEntry.ts

import BaseModel from "./BaseModel";

class JournalEntry extends BaseModel {
  id: string;
  date: string;
  mood: string | null;
  tags: string[];
  documentId: string;
  document: {
    id: string;
    title: string;
    url: string;
    updatedAt: string;
  };
  createdAt: string;
  updatedAt: string;

  constructor(data: Record<string, any>) {
    super(data);
    Object.assign(this, data);
  }
}

export default JournalEntry;
```

---

## 4. 后端 API（通过 Hook.API 插件化）

API 路由是唯一真正走插件机制的部分。放在 `plugins/journal/server/api/journal.ts`。

### 4.1 journal.upsert（v1 勘误：事务化 + 并发安全）

这是最关键的接口。v1 的 findOne → create 是非原子的，两个标签页同时点击同一天会导致竞态。

```typescript
// plugins/journal/server/api/journal.ts

import Router from "koa-router";
import { sequelize } from "@server/storage/database";
import { authorize } from "@server/policies";
import { User, Document, Collection, JournalEntry } from "@server/models";
import { documentCreator } from "@server/commands/documentCreator";
import { presentJournalEntry } from "../presenters/journalEntry";
import { z } from "zod";

const router = new Router();

const JOURNAL_COLLECTION_NAME = "__journal__";

/**
 * 确保用户有私有的 Journal collection。
 * 在事务内调用，避免并发创建多个 collection。
 */
async function ensureJournalCollection(
  user: User,
  teamId: string,
  transaction: any
): Promise<Collection> {
  // 先查找
  let collection = await Collection.findOne({
    where: {
      teamId,
      name: JOURNAL_COLLECTION_NAME,
      createdById: user.id,
    },
    transaction,
    lock: transaction.LOCK.UPDATE,       // 行级锁防止并发创建
  });

  if (collection) return collection;

  // 创建私有 collection
  collection = await Collection.create(
    {
      name: JOURNAL_COLLECTION_NAME,
      teamId,
      createdById: user.id,
      permission: null,                  // null = 私有，只有创建者可见
      sharing: false,
      sort: { field: "title", direction: "asc" },
    },
    { transaction }
  );

  // Outline 的 Collection.create afterCreate hook 会自动给创建者
  // 添加 Admin membership，这里不需要手动处理

  return collection;
}

// ── journal.upsert ──
// 获取或创建某天的日记

const upsertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),   // 严格 YYYY-MM-DD
  mood: z.enum(["productive", "neutral", "tired", "inspired", "frustrated"]).optional(),
  tags: z.array(z.string()).optional(),
  title: z.string().max(255).optional(),
});

router.post("journal.upsert", async (ctx) => {
  const body = upsertSchema.parse(ctx.request.body);
  const { user } = ctx.state.auth;
  const { date, mood, tags, title } = body;

  const result = await sequelize.transaction(async (transaction) => {
    // 1. 先查找已有 entry（最常见路径，快速返回）
    let entry = await JournalEntry.findOne({
      where: { userId: user.id, teamId: user.teamId, date },
      include: [{ model: Document, as: "document" }],
      transaction,
    });

    if (entry) {
      // 已存在：只更新 mood/tags
      if (mood !== undefined) entry.mood = mood;
      if (tags !== undefined) entry.tags = tags;
      if (entry.changed()) await entry.save({ transaction });
      return entry;
    }

    // 2. 不存在：创建 collection → document → entry
    const collection = await ensureJournalCollection(user, user.teamId, transaction);

    // 使用 Outline 的 documentCreator command
    // 它会处理 publish、revision 创建、事件触发等
    const document = await documentCreator({
      title: title || date,
      text: "",
      collectionId: collection.id,
      user,
      publish: true,
      transaction,
      ip: ctx.request.ip,
    });

    // 3. 创建 JournalEntry
    try {
      entry = await JournalEntry.create(
        {
          userId: user.id,
          teamId: user.teamId,
          documentId: document.id,
          date,
          mood: mood || null,
          tags: tags || [],
        },
        { transaction }
      );
    } catch (err) {
      // 唯一约束冲突 = 并发创建，另一个请求抢先完成了
      if (err.name === "SequelizeUniqueConstraintError") {
        // 回滚当前事务中创建的 Document（事务回滚会自动处理）
        // 重新查询已有的 entry
        throw err;  // 让事务回滚
      }
      throw err;
    }

    entry.document = document;
    return entry;
  }).catch(async (err) => {
    // 如果是唯一约束冲突，事务已回滚，重新查询
    if (err.name === "SequelizeUniqueConstraintError") {
      const existing = await JournalEntry.findOne({
        where: { userId: user.id, teamId: user.teamId, date },
        include: [{ model: Document, as: "document" }],
      });
      if (existing) return existing;
    }
    throw err;
  });

  ctx.body = {
    data: presentJournalEntry(result),
  };
});
```

关键改进：
- 整个 find-or-create 包在 `sequelize.transaction()` 中
- `ensureJournalCollection` 用 `LOCK.UPDATE` 防止并发创建多个 collection
- 唯一约束冲突时事务回滚，重新查询已有 entry
- 使用 Outline 的 `documentCreator` command（不是直接 `Document.create`），保证 publish 流程、revision 创建等副作用正确执行

### 4.2 journal.entries

```typescript
const entriesSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

router.post("journal.entries", async (ctx) => {
  const { startDate, endDate, direction } = entriesSchema.parse(ctx.request.body);
  const { user } = ctx.state.auth;

  const entries = await JournalEntry.findAll({
    where: {
      userId: user.id,
      teamId: user.teamId,                // 始终带 teamId
      date: {
        [Op.gte]: startDate,
        [Op.lte]: endDate,
      },
    },
    include: [{
      model: Document,
      as: "document",
      attributes: ["id", "title", "updatedAt"],
      // 排除已软删除的 Document
      where: { deletedAt: null },
      required: false,
    }],
    order: [["date", direction]],
  });

  // 过滤掉关联 Document 已被软删除的 entries
  const validEntries = entries.filter((e) => e.document !== null);

  ctx.body = {
    data: validEntries.map(presentJournalEntry),
    pagination: { offset: 0, limit: validEntries.length },
  };
});
```

### 4.3 journal.calendar

```typescript
const calendarSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

router.post("journal.calendar", async (ctx) => {
  const { year, month } = calendarSchema.parse(ctx.request.body);
  const { user } = ctx.state.auth;

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;

  // 1. 查询当月有日记的日期
  const entries = await JournalEntry.findAll({
    where: {
      userId: user.id,
      teamId: user.teamId,
      date: { [Op.between]: [startDate, endDate] },
    },
    attributes: ["date"],
    include: [{
      model: Document,
      as: "document",
      attributes: [],
      where: { deletedAt: null },
    }],
  });

  const dates = entries.map((e) => e.date);

  // 2. 计算连续写作天数（streak）
  const streak = await calculateStreak(user.id, user.teamId);

  ctx.body = {
    data: { dates, streak },
  };
});

async function calculateStreak(userId: string, teamId: string): Promise<number> {
  // 从今天向前找连续有日记的天数
  // 用简单的逐天回溯，因为 streak 通常不会很长
  const today = new Date();
  let streak = 0;
  let checkDate = new Date(today);

  while (true) {
    const dateStr = checkDate.toISOString().split("T")[0];
    const exists = await JournalEntry.count({
      where: {
        userId,
        teamId,
        date: dateStr,
      },
      include: [{
        model: Document,
        as: "document",
        where: { deletedAt: null },
        attributes: [],
      }],
    });

    if (exists > 0) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}
```

注意：`calculateStreak` 的逐天查询在 streak 很长时会有 N 次查询。如果后续发现性能问题，可以改为单条 SQL（用窗口函数），但 MVP 阶段这个实现足够用，因为大多数用户的 streak 不会超过 30 天。

### 4.4 journal.info

```typescript
const infoSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.post("journal.info", async (ctx) => {
  const { date } = infoSchema.parse(ctx.request.body);
  const { user } = ctx.state.auth;

  const entry = await JournalEntry.findOne({
    where: { userId: user.id, teamId: user.teamId, date },
    include: [{ model: Document, as: "document" }],
  });

  if (!entry) {
    ctx.throw(404, "Journal entry not found");
  }

  authorize(user, "read", entry);

  ctx.body = {
    data: presentJournalEntry(entry),
  };
});
```

### 4.5 API 路由注册

```typescript
// plugins/journal/server/index.ts

import { Hook, PluginManager } from "@server/utils/PluginManager";
import router from "./api/journal";

// Hook.API 是 Outline 插件系统中唯一支持的路由挂载方式
PluginManager.add({
  type: Hook.API,
  value: router,
});
```

### 4.6 Presenter

```typescript
// plugins/journal/server/presenters/journalEntry.ts

import { JournalEntry } from "@server/models";

export function presentJournalEntry(entry: JournalEntry) {
  return {
    id: entry.id,
    date: entry.date,
    mood: entry.mood,
    tags: entry.tags,
    documentId: entry.documentId,
    document: entry.document
      ? {
          id: entry.document.id,
          title: entry.document.title,
          url: entry.document.url,         // Outline Document 有 url getter
          updatedAt: entry.document.updatedAt,
        }
      : null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
```

---

## 5. 权限与分享一致性（v1 勘误）

### 问题

v1 同时声称"支持手动分享给团队成员"和"JournalEntry 只有作者可读"。这产生不一致：Document 被分享后，被分享者能看到正文但拿不到 Journal 元数据（mood、tags）。

### MVP 策略

- JournalEntry 元数据（mood、tags）仅作者可访问，不支持分享。
- 日记正文是 Document，可以通过 Outline 原生的 Document 分享功能分享给他人。
- 被分享者看到的是普通文档，不会看到 Journal 的日历/心情等上下文。
- 这不是 bug 而是设计选择：日记元数据是个人私有的，正文可选分享。

### 未来扩展

如果后续需要"分享日记（含元数据）"，在 JournalEntry 上加 `sharedWith: UUID[]` 字段，并扩展 policy 的 read 规则。但 MVP 不做。

---

## 6. 前端 UI

### 6.1 MVP 策略（v1 勘误）

v1 设计了左右分栏的内嵌编辑器布局。这需要把 DocumentEditor 从 DocumentScene 中解耦出来单独使用，工作量和风险都不小。

**MVP 做法：点击日期 → 调用 upsert 拿到 Document URL → 跳转到 `/doc/.../edit`。** 复用完整的现有 Document Scene。

用户体验流程：

```
侧栏点 [Journal]
     ↓
显示 Journal Scene（日历 + 最近日记列表）
     ↓
点击某天的日期
     ↓
调 journal.upsert → 返回 document.url
     ↓
router.push(document.url)  ← 跳转到现有 Document 编辑页
     ↓
用户在标准 Outline 编辑器中写日记
```

第二阶段再考虑内嵌编辑器的分栏布局。

### 6.2 Journal Scene

```tsx
// app/scenes/Journal/index.tsx

import { observer } from "mobx-react";
import { useHistory, useParams } from "react-router-dom";
import useStores from "~/hooks/useStores";
import CalendarGrid from "./components/CalendarGrid";
import RecentEntries from "./components/RecentEntries";

const Journal = observer(() => {
  const { journalEntries } = useStores();
  const history = useHistory();
  const { date } = useParams<{ date?: string }>();

  useEffect(() => {
    const { year, month } = journalEntries.currentMonth;
    journalEntries.fetchCalendar(year, month);
  }, [journalEntries.currentMonth.year, journalEntries.currentMonth.month]);

  // 如果 URL 中有 date 参数，直接打开该日日记
  useEffect(() => {
    if (date) {
      handleSelectDate(date);
    }
  }, [date]);

  const handleSelectDate = async (selectedDate: string) => {
    const documentUrl = await journalEntries.fetchOrCreateByDate(selectedDate);
    if (documentUrl) {
      history.push(documentUrl);       // 跳转到现有 Document 编辑页
    }
  };

  const handleChangeMonth = (year: number, month: number) => {
    journalEntries.currentMonth = { year, month };
  };

  return (
    <Scene title="Journal">
      <Container>
        <CalendarGrid
          year={journalEntries.currentMonth.year}
          month={journalEntries.currentMonth.month}
          dots={journalEntries.calendarDots}
          selectedDate={journalEntries.selectedDate}
          onSelectDate={handleSelectDate}
          onChangeMonth={handleChangeMonth}
        />

        {journalEntries.streak > 0 && (
          <StreakInfo>
            {journalEntries.streak} day streak
          </StreakInfo>
        )}

        <RecentEntries entries={journalEntries.entries} />

        {journalEntries.isLoading && <LoadingIndicator />}
        {journalEntries.error && <ErrorMessage>{journalEntries.error}</ErrorMessage>}
      </Container>
    </Scene>
  );
});

export default Journal;
```

### 6.3 CalendarGrid 组件

```tsx
// app/scenes/Journal/components/CalendarGrid.tsx

const CalendarGrid: React.FC<{
  year: number;
  month: number;
  dots: Set<string>;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onChangeMonth: (year: number, month: number) => void;
}> = ({ year, month, dots, selectedDate, onSelectDate, onChangeMonth }) => {
  const today = new Date().toISOString().split("T")[0];

  const handlePrevMonth = () => {
    if (month === 1) onChangeMonth(year - 1, 12);
    else onChangeMonth(year, month - 1);
  };

  const handleNextMonth = () => {
    if (month === 12) onChangeMonth(year + 1, 1);
    else onChangeMonth(year, month + 1);
  };

  // 计算月历网格
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const offset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // 周一起始

  const cells: Array<null | {
    day: number;
    date: string;
    hasEntry: boolean;
    isToday: boolean;
    isFuture: boolean;
  }> = [];

  for (let i = 0; i < offset; i++) cells.push(null);

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({
      day: d,
      date: dateStr,
      hasEntry: dots.has(dateStr),
      isToday: dateStr === today,
      isFuture: dateStr > today,
    });
  }

  return (
    <CalendarWrapper>
      <MonthNav>
        <NavButton onClick={handlePrevMonth}>&lt;</NavButton>
        <MonthLabel>
          {new Date(year, month - 1).toLocaleString("default", { month: "long", year: "numeric" })}
        </MonthLabel>
        <NavButton onClick={handleNextMonth}>&gt;</NavButton>
      </MonthNav>

      <WeekdayRow>
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <WeekdayHeader key={d}>{d}</WeekdayHeader>
        ))}
      </WeekdayRow>

      <DayGrid>
        {cells.map((cell, i) =>
          cell ? (
            <DayCell
              key={cell.date}
              isToday={cell.isToday}
              hasEntry={cell.hasEntry}
              isFuture={cell.isFuture}
              onClick={() => !cell.isFuture && onSelectDate(cell.date)}
            >
              {cell.day}
              {cell.hasEntry && <EntryDot />}
            </DayCell>
          ) : (
            <EmptyCell key={`empty-${i}`} />
          )
        )}
      </DayGrid>
    </CalendarWrapper>
  );
};
```

### 6.4 不做的事（MVP 排除项）

- ❌ 内嵌编辑器分栏布局（第二阶段）
- ❌ 侧栏 streak badge（避免额外全局请求）
- ❌ `Cmd/Ctrl + J` 全局快捷键（第二阶段）
- ❌ Timeline 时间线视图（第二阶段）
- ❌ 搜索结果日记图标区分
- ❌ WebSocket 实时推送
- ❌ 月度批量导出
- ❌ 管理员团队统计仪表盘

---

## 7. 测试计划

### 7.1 后端 API 测试

```typescript
// plugins/journal/server/api/journal.test.ts

describe("journal.upsert", () => {
  it("should create journal collection, document, and entry on first call", async () => {
    const res = await postApi("/api/journal.upsert", { date: "2026-06-02" });
    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe("2026-06-02");
    expect(res.body.data.document).toBeDefined();
    expect(res.body.data.document.url).toContain("/doc/");
  });

  it("should return existing entry on duplicate upsert, not create new Document", async () => {
    await postApi("/api/journal.upsert", { date: "2026-06-02" });
    const res2 = await postApi("/api/journal.upsert", { date: "2026-06-02" });
    // 两次返回相同的 documentId
    expect(res2.body.data.documentId).toBe(/* 第一次的 documentId */);
    // 数据库中只有 1 个 entry
    const count = await JournalEntry.count({ where: { userId: user.id, date: "2026-06-02" } });
    expect(count).toBe(1);
  });

  it("should handle concurrent upsert without creating duplicate entries", async () => {
    // 并发发送两个请求
    const [res1, res2] = await Promise.all([
      postApi("/api/journal.upsert", { date: "2026-06-03" }),
      postApi("/api/journal.upsert", { date: "2026-06-03" }),
    ]);
    // 两个都应该成功
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // 且返回相同的 entry
    expect(res1.body.data.documentId).toBe(res2.body.data.documentId);
  });

  it("should isolate entries between users with same date", async () => {
    await postApi("/api/journal.upsert", { date: "2026-06-02" }, userA);
    await postApi("/api/journal.upsert", { date: "2026-06-02" }, userB);
    const countA = await JournalEntry.count({ where: { userId: userA.id } });
    const countB = await JournalEntry.count({ where: { userId: userB.id } });
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it("should update mood and tags on existing entry", async () => {
    await postApi("/api/journal.upsert", { date: "2026-06-02" });
    const res = await postApi("/api/journal.upsert", {
      date: "2026-06-02",
      mood: "productive",
      tags: ["standup"],
    });
    expect(res.body.data.mood).toBe("productive");
    expect(res.body.data.tags).toEqual(["standup"]);
  });
});

describe("journal.entries", () => {
  it("should return entries in date range, excluding soft-deleted Documents", async () => {
    // ...
  });
});

describe("journal.calendar", () => {
  it("should return dates with entries and correct streak count", async () => {
    // ...
  });
});

describe("journal collection privacy", () => {
  it("should create collection with permission=null (private)", async () => {
    await postApi("/api/journal.upsert", { date: "2026-06-02" });
    const collection = await Collection.findOne({
      where: { name: "__journal__", createdById: user.id },
    });
    expect(collection.permission).toBeNull();
  });

  it("should not be visible to other team members", async () => {
    // userA 创建日记
    await postApi("/api/journal.upsert", { date: "2026-06-02" }, userA);
    // userB 列出 collections，不应看到 userA 的 __journal__
    const collections = await Collection.findAll({
      where: { teamId: team.id, createdById: userB.id },
    });
    const journalCollections = collections.filter(c => c.name === "__journal__");
    expect(journalCollections.length).toBe(0);
  });
});
```

### 7.2 模型测试

```typescript
// server/models/JournalEntry.test.ts

describe("JournalEntry", () => {
  it("should enforce unique constraint on (teamId, userId, date)", async () => {
    await JournalEntry.create({ userId, teamId, documentId: doc1.id, date: "2026-06-02" });
    await expect(
      JournalEntry.create({ userId, teamId, documentId: doc2.id, date: "2026-06-02" })
    ).rejects.toThrow(/unique/i);
  });

  it("should cascade delete when Document is physically deleted", async () => {
    const entry = await JournalEntry.create({ userId, teamId, documentId: doc.id, date: "2026-06-02" });
    await doc.destroy({ force: true });          // 物理删除
    const found = await JournalEntry.findByPk(entry.id);
    expect(found).toBeNull();
  });
});
```

### 7.3 运行测试

```bash
# 运行 journal API 测试
yarn test plugins/journal/server/api/journal.test.ts

# 运行模型测试
yarn test server/models/JournalEntry.test.ts

# 全量回归（确保没有破坏现有功能）
yarn test
```

---

## 8. 文件变更清单

### 新增文件

```
server/models/JournalEntry.ts              # Sequelize 模型
server/policies/journalEntry.ts            # 权限策略
server/migrations/XXXXXX-create-journal-entries.ts
plugins/journal/server/api/journal.ts       # API 路由（Hook.API）
plugins/journal/server/index.ts             # 插件注册入口
plugins/journal/server/presenters/journalEntry.ts
plugins/journal/server/api/journal.test.ts  # API 测试
app/models/JournalEntry.ts                  # 前端模型
app/stores/JournalEntriesStore.ts           # MobX Store
app/scenes/Journal/index.tsx                # Journal 主页面
app/scenes/Journal/components/CalendarGrid.tsx
app/scenes/Journal/components/RecentEntries.tsx
```

### 修改的核心文件（6 处）

```
server/models/index.ts          # +1 行：export JournalEntry
server/policies/index.ts        # +1 行：import "./journalEntry"
app/routes/authenticated.tsx    # +2 行：Journal 路由
app/stores/RootStore.ts         # +3 行：JournalEntriesStore 注册
app/components/Sidebar/...      # +数行：Journal 侧栏入口
```

每处核心文件的改动量都在 1-5 行，不涉及逻辑重构。

---

## 9. 执行顺序

严格按"后端 → 测试 → 最小前端 → 增强"的顺序：

### Step 1：后端基础（3-4 天）

1. 数据库迁移
2. JournalEntry 模型 + 导出到 `server/models/index.ts`
3. 权限策略 + 导入到 `server/policies/index.ts`
4. Presenter

### Step 2：后端 API（3-4 天）

5. `journal.upsert`（含事务、并发处理）
6. `journal.entries`
7. `journal.calendar`
8. `journal.info`
9. Document 删除事件处理

### Step 3：后端测试（2 天）

10. API 测试（并发 upsert 是重点）
11. 模型测试（唯一约束、级联删除）
12. 权限测试（跨用户隔离）

此时可以用 curl / Postman 验证整个后端逻辑。

### Step 4：最小前端（3-4 天）

13. JournalEntry 前端模型
14. JournalEntriesStore + 注册到 RootStore
15. Journal Scene（日历 + 最近列表）
16. 路由注册到 `authenticated.tsx`
17. 侧栏入口

此时功能可用：点日历 → 跳到 Document 编辑页。

### Step 5：增强（按需）

18. Mood 选择器
19. Tags 编辑
20. Timeline 视图
21. 快捷键 `Cmd/Ctrl + J`
22. 内嵌编辑器分栏布局

**总计 MVP：约 12-16 人天（~3 周）。**
