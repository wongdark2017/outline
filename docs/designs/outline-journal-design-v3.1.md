# Outline Journal（日记 + 日历）功能设计文档 v3.1

> v3 → v3.1 变更摘要（5 处编译/运行时错误修正）：
> 1. JournalProcessor 改为 extends BaseProcessor + static applicableEvents + perform() 实例方法
> 2. 修正 import：transaction 改为命名导出 `{ transaction }`，documentCreator 改为默认导出（去掉花括号）
> 3. Collection 并发创建改用 pg_advisory_xact_lock 替代无效的 LOCK.UPDATE
> 4. 前端 client.post 去掉 "/api" 前缀，改为 "journal.calendar" 风格
> 5. 前端 JournalEntry 添加 static modelName，Store 覆写 apiEndpoint，RootStore 改用 registerStore()

---

## 1. 架构定位

### 插件化边界（v3 修正）

| 层面 | 能力 | 接入方式 |
|------|------|----------|
| API 路由 | `Hook.API` ✅ | 插件目录 `plugins/journal/server/` |
| 事件处理器 | `Hook.Processor` ✅ | 插件目录 `plugins/journal/server/` |
| Sequelize 模型 | ❌ 不支持插件注册 | 核心接入 `server/models/index.ts` |
| 权限策略 | ❌ 不支持插件注册 | 核心接入 `server/policies/index.ts` |
| 前端路由 | ❌ 不支持插件注册 | 核心接入 `app/routes/authenticated.tsx` |
| 侧栏入口 | ❌ 不支持插件注册 | 核心接入 `app/components/Sidebar/App.tsx` |
| 前端 Store | ❌ 不支持插件注册 | 核心接入 `app/stores/RootStore.ts` |

v2 遗漏了 `Hook.Processor`。实际上 Outline 的 PluginManager 支持 `Hook.Processor`（passkeys 等插件已在使用），所以 Document 删除联动可以完全放在插件目录中，不需要改核心文件。

### 核心文件改动清单（5 处，每处 1-3 行）

```
server/models/index.ts                  # +1 行：export JournalEntry
server/policies/index.ts                # +1 行：import "./journalEntry"
app/routes/authenticated.tsx            # +2 行：Journal 路由（约 L86 附近）
app/components/Sidebar/App.tsx          # +3 行：Journal 侧栏链接（Home/Search/Drafts 那一段，约 L104 附近）
app/stores/RootStore.ts                 # +2 行：import + registerStore(JournalEntriesStore)（约 L40 + L150）
```

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
} from "sequelize-typescript";
import IdModel from "./base/IdModel";          // 默认导出，不是命名导出
import User from "./User";
import Team from "./Team";
import Document from "./Document";

@Table({
  tableName: "journal_entries",
  modelName: "journal_entry",
  timestamps: true,
  paranoid: false,
})
class JournalEntry extends IdModel {
  @Column(DataType.DATEONLY)
  date: string;

  @Column({
    type: DataType.ENUM("productive", "neutral", "tired", "inspired", "frustrated"),
    allowNull: true,
  })
  mood: string | null;

  @Column({ type: DataType.JSONB, defaultValue: [] })
  tags: string[];

  // ── Associations ──

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

模型导出：

```typescript
// server/models/index.ts — 在现有导出列表中新增一行

export { default as JournalEntry } from "./JournalEntry";
```

### 2.2 数据库迁移

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
      userId: {
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
        onDelete: "CASCADE",
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

    await queryInterface.addIndex("journal_entries", ["teamId", "userId", "date"], {
      unique: true,
      name: "journal_entries_team_user_date",
    });
    await queryInterface.addIndex("journal_entries", ["userId", "date"]);
    await queryInterface.addIndex("journal_entries", ["teamId", "date"]);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("journal_entries");
  },
};
```

---

## 3. 权限策略

```typescript
// server/policies/journalEntry.ts

import { allow } from "./cancan";
import { User, JournalEntry } from "@server/models";

allow(User, "read", JournalEntry, (actor, entry) =>
  actor.id === entry.userId && actor.teamId === entry.teamId
);

allow(User, "update", JournalEntry, (actor, entry) =>
  actor.id === entry.userId && actor.teamId === entry.teamId
);

allow(User, "delete", JournalEntry, (actor, entry) =>
  actor.id === entry.userId && actor.teamId === entry.teamId
);
```

注册：

```typescript
// server/policies/index.ts — 新增一行

import "./journalEntry";
```

### 分享一致性策略（不变）

JournalEntry 元数据（mood、tags）仅作者可访问。日记正文是 Document，可通过原生分享功能分享给他人。被分享者看到的是普通文档，看不到 Journal 的日历/心情上下文。

---

## 4. 后端 API

### 4.1 路由风格说明（v3 修正）

v2 手写了 `sequelize.transaction(async (transaction) => {...})`，这不是 Outline 的实际模式。

Outline 路由的实际模式是 middleware 链：

```
router.post("name", auth(), validate(schema), transaction(), handler)
```

- `auth()` → 校验认证，挂 `ctx.state.auth.user`
- `validate(schema)` → 用 zod 校验 request body
- `transaction()` → 开启事务，挂 `ctx.state.transaction`，handler 正常返回则自动 commit，throw 则自动 rollback

handler 中通过 `ctx.state.transaction` 获取事务对象。`documentCreator` 等 command 的签名是 `(ctx, props)`，接收完整的 ctx。

注意 import 形状：`transaction` 是命名导出（`import { transaction } from ...`），`documentCreator` 是默认导出（`import documentCreator from ...`）。

### 4.2 路由实现

```typescript
// plugins/journal/server/api/journal.ts

import Router from "koa-router";
import { z } from "zod";
import { Op } from "sequelize";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { transaction } from "@server/middlewares/transaction";
import { authorize } from "@server/policies";
import { Collection, Document, JournalEntry } from "@server/models";
import documentCreator from "@server/commands/documentCreator";
import { presentJournalEntry } from "../presenters/journalEntry";

const router = new Router();
const JOURNAL_COLLECTION_NAME = "__journal__";

// ────────────────────────────────────
// journal.upsert
// ────────────────────────────────────

const upsertSchema = z.object({
  body: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mood: z.enum(["productive", "neutral", "tired", "inspired", "frustrated"]).optional(),
    tags: z.array(z.string()).optional(),
    title: z.string().max(255).optional(),
  }),
});

router.post(
  "journal.upsert",
  auth(),
  validate(upsertSchema),
  transaction(),
  async (ctx) => {
    const { date, mood, tags, title } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    // 1. 快速路径：已有 entry 则直接返回（更新 mood/tags）
    let entry = await JournalEntry.findOne({
      where: { userId: user.id, teamId: user.teamId, date },
      include: [{ model: Document, as: "document" }],
      transaction,
    });

    if (entry) {
      if (mood !== undefined) entry.mood = mood;
      if (tags !== undefined) entry.tags = tags;
      if (entry.changed()) await entry.save({ transaction });

      ctx.body = { data: presentJournalEntry(entry) };
      return;
    }

    // 2. 确保私有 Journal collection
    //    LOCK.UPDATE 锁的是已存在的行，首次创建时没有行可锁，无法防止并发。
    //    用 pg_advisory_xact_lock 对 (teamId, userId) 做事务级排他锁。
    const lockKey = Buffer.from(`${user.teamId}:${user.id}:journal`);
    const lockId = lockKey.readInt32BE(0);   // 取前 4 字节做 int32 lock key
    await JournalEntry.sequelize!.query(
      `SELECT pg_advisory_xact_lock(:lockId)`,
      { replacements: { lockId }, transaction }
    );

    let collection = await Collection.findOne({
      where: {
        teamId: user.teamId,
        name: JOURNAL_COLLECTION_NAME,
        createdById: user.id,
      },
      transaction,
    });

    if (!collection) {
      collection = await Collection.create(
        {
          name: JOURNAL_COLLECTION_NAME,
          teamId: user.teamId,
          createdById: user.id,
          permission: null,
          sharing: false,
          sort: { field: "title", direction: "asc" },
        },
        { transaction }
      );
    }

    // 3. 用 documentCreator 创建文档
    //    签名：documentCreator(ctx, props)
    const document = await documentCreator(ctx, {
      title: title || date,
      text: "",
      collectionId: collection.id,
      publish: true,
    });

    // 4. 创建 JournalEntry
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
    } catch (err: any) {
      // 唯一约束冲突 = 另一个请求抢先完成
      if (err.name === "SequelizeUniqueConstraintError") {
        // transaction() middleware 会 rollback 当前事务（包括已创建的 Document）
        // 重新查询已有 entry（在新事务/无事务中）
        const existing = await JournalEntry.scope().findOne({
          where: { userId: user.id, teamId: user.teamId, date },
          include: [{ model: Document, as: "document" }],
        });
        if (existing) {
          ctx.body = { data: presentJournalEntry(existing) };
          return;
        }
      }
      throw err;
    }

    entry.document = document;
    ctx.body = { data: presentJournalEntry(entry) };
  }
);

// ────────────────────────────────────
// journal.entries
// ────────────────────────────────────

const entriesSchema = z.object({
  body: z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    direction: z.enum(["asc", "desc"]).default("desc"),
  }),
});

router.post(
  "journal.entries",
  auth(),
  validate(entriesSchema),
  async (ctx) => {
    const { startDate, endDate, direction } = ctx.input.body;
    const { user } = ctx.state.auth;

    const entries = await JournalEntry.findAll({
      where: {
        userId: user.id,
        teamId: user.teamId,
        date: { [Op.between]: [startDate, endDate] },
      },
      include: [{
        model: Document,
        as: "document",
        attributes: ["id", "title", "updatedAt"],
        where: { deletedAt: null },
        required: false,
      }],
      order: [["date", direction]],
    });

    ctx.body = {
      data: entries.filter((e) => e.document).map(presentJournalEntry),
    };
  }
);

// ────────────────────────────────────
// journal.calendar
// ────────────────────────────────────

const calendarSchema = z.object({
  body: z.object({
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12),
  }),
});

router.post(
  "journal.calendar",
  auth(),
  validate(calendarSchema),
  async (ctx) => {
    const { year, month } = ctx.input.body;
    const { user } = ctx.state.auth;

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

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
    const streak = await calculateStreak(user.id, user.teamId);

    ctx.body = { data: { dates, streak } };
  }
);

// ────────────────────────────────────
// journal.info
// ────────────────────────────────────

const infoSchema = z.object({
  body: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});

router.post(
  "journal.info",
  auth(),
  validate(infoSchema),
  async (ctx) => {
    const { date } = ctx.input.body;
    const { user } = ctx.state.auth;

    const entry = await JournalEntry.findOne({
      where: { userId: user.id, teamId: user.teamId, date },
      include: [{ model: Document, as: "document" }],
    });

    if (!entry) {
      ctx.throw(404, "Journal entry not found");
    }

    authorize(user, "read", entry);

    ctx.body = { data: presentJournalEntry(entry) };
  }
);

// ────────────────────────────────────
// Helpers
// ────────────────────────────────────

async function calculateStreak(userId: string, teamId: string): Promise<number> {
  let streak = 0;
  const checkDate = new Date();

  while (true) {
    const dateStr = checkDate.toISOString().split("T")[0];
    const exists = await JournalEntry.count({
      where: { userId, teamId, date: dateStr },
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

export default router;
```

### 4.3 Presenter

```typescript
// plugins/journal/server/presenters/journalEntry.ts

import JournalEntry from "@server/models/JournalEntry";

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
          url: entry.document.url,
          updatedAt: entry.document.updatedAt,
        }
      : null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
```

---

## 5. Document 删除联动（Hook.Processor 插件化）

v2 把这部分定性为核心改动。实际上 `Hook.Processor` 是 PluginManager 支持的 hook 类型，可以完全放在插件目录中。

```typescript
// plugins/journal/server/processors/JournalProcessor.ts

import BaseProcessor from "@server/queues/processors/BaseProcessor";
import { JournalEntry } from "@server/models";
import { Event } from "@server/types";

export default class JournalProcessor extends BaseProcessor {
  // 声明该 processor 关心哪些事件
  static applicableEvents: string[] = [
    "documents.delete",
    "documents.permanent_delete",
  ];

  // 实例方法，由调度框架调用
  async perform(event: Event): Promise<void> {
    if (!event.documentId) return;

    switch (event.name) {
      case "documents.delete":
      case "documents.permanent_delete": {
        // Document 被软删除或物理删除时，同步删除关联的 JournalEntry
        await JournalEntry.destroy({
          where: { documentId: event.documentId },
        });
        break;
      }
    }
  }
}
```

插件注册入口：

```typescript
// plugins/journal/server/index.ts

import { Hook, PluginManager } from "@server/utils/PluginManager";
import router from "./api/journal";
import JournalProcessor from "./processors/JournalProcessor";

PluginManager.add([
  {
    type: Hook.API,
    value: router,
  },
  {
    type: Hook.Processor,
    value: JournalProcessor,
  },
]);
```

这样 Document 删除联动完全在 `plugins/journal/` 中完成，不需要修改核心 processor 文件。

---

## 6. 前端数据层（v3 修正）

### 6.1 Model

v2 写了 `import BaseModel from "./BaseModel"`，但 Outline 仓库中没有 `BaseModel`，实际基类是 `./base/Model`。并且模型构造函数需要接收 `store` 引用，不能直接 `new JournalEntry(data)` 实例化。

```typescript
// app/models/JournalEntry.ts

import { observable } from "mobx";
import Model from "./base/Model";
import type JournalEntriesStore from "~/stores/JournalEntriesStore";

class JournalEntry extends Model {
  // Store<T> 构造函数通过 modelName 推导 apiEndpoint
  static modelName = "journal_entry";

  store: JournalEntriesStore;

  id: string;

  @observable
  date: string;

  @observable
  mood: string | null;

  @observable
  tags: string[];

  documentId: string;

  @observable
  document: {
    id: string;
    title: string;
    url: string;
    updatedAt: string;
  } | null;

  createdAt: string;
  updatedAt: string;
}

export default JournalEntry;
```

### 6.2 Store

v2 手写了一个全自定义 Store。Outline 的前端 Store 体系是继承 `stores/base/Store<T>`，统一走 `add()`、`addPolicies()` 等方法管理模型实例。

```typescript
// app/stores/JournalEntriesStore.ts

import { observable, action, runInAction, computed } from "mobx";
import Store from "./base/Store";
import JournalEntry from "~/models/JournalEntry";
import RootStore from "./RootStore";
import { client } from "~/utils/ApiClient";

export default class JournalEntriesStore extends Store<JournalEntry> {
  // 后端端点是 "journal.*"，不是 Store<T> 从 modelName 推导的 "journalEntries.*"
  apiEndpoint = "journal";

  @observable
  selectedDate: string = new Date().toISOString().split("T")[0];

  @observable
  currentMonth: { year: number; month: number };

  @observable
  calendarDots: Set<string> = new Set();

  @observable
  streak: number = 0;

  @observable
  isLoading: boolean = false;

  @observable
  error: string | null = null;

  constructor(rootStore: RootStore) {
    super(rootStore, JournalEntry);

    const now = new Date();
    this.currentMonth = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };
  }

  // ── Calendar data ──

  @action
  async fetchCalendar(year: number, month: number) {
    try {
      const res = await client.post("/journal.calendar", { year, month });
      runInAction(() => {
        this.calendarDots = new Set(res.data.dates);
        this.streak = res.data.streak;
      });
    } catch (err: any) {
      runInAction(() => {
        this.error = err.message;
      });
    }
  }

  // ── Upsert: get-or-create entry for a date ──

  @action
  async fetchOrCreateByDate(date: string): Promise<string | null> {
    this.isLoading = true;
    this.error = null;
    try {
      const res = await client.post("/journal.upsert", { date });

      runInAction(() => {
        // 用基类 Store 的 add() 管理实例生命周期
        this.add(res.data);
        this.addPolicies(res.policies);
        this.calendarDots.add(date);
        this.isLoading = false;
      });

      // 返回 Document URL 供跳转
      return res.data.document?.url ?? null;
    } catch (err: any) {
      runInAction(() => {
        this.error = err.message;
        this.isLoading = false;
      });
      return null;
    }
  }

  // ── Fetch date range ──

  @action
  async fetchRange(startDate: string, endDate: string) {
    try {
      const res = await client.post("/journal.entries", {
        startDate,
        endDate,
      });
      runInAction(() => {
        for (const item of res.data) {
          this.add(item);
        }
      });
    } catch (err: any) {
      runInAction(() => {
        this.error = err.message;
      });
    }
  }

  // ── Computed: entries grouped by date for RecentEntries ──

  @computed
  get recentEntries(): JournalEntry[] {
    return Array.from(this.data.values())
      .filter((e) => e.document)
      .sort((a, b) => (a.date > b.date ? -1 : 1));
  }
}
```

注册到 RootStore（使用现有的 `registerStore()` 模式）：

```typescript
// app/stores/RootStore.ts — 约 L40 import 区域新增，约 L150 registerStore 区域新增

import JournalEntriesStore from "./JournalEntriesStore";

class RootStore {
  // ...existing stores...
  journalEntries: JournalEntriesStore;

  constructor() {
    // ...existing init...

    // 沿用现有 registerStore 模式，不要手工 new
    this.registerStore(JournalEntriesStore);
  }
}
```

---

## 7. 前端 UI

### 7.1 路由注册

```typescript
// app/routes/authenticated.tsx — 约 L86 附近，在现有路由中新增

const Journal = lazy(() => import("~/scenes/Journal"));

// 在 <Switch> 内
<Route exact path="/journal" component={Journal} />
<Route exact path="/journal/:date" component={Journal} />
```

### 7.2 侧栏入口

```tsx
// app/components/Sidebar/App.tsx — 约 L104 附近
// 在 Home / Search / Drafts 那一段中新增

<SidebarLink
  to="/journal"
  icon={<CalendarIcon />}
  label={t("Journal")}
/>
```

### 7.3 Journal Scene

MVP 策略不变：点击日期 → upsert 拿 Document URL → `history.push()` 跳转到现有 Document Scene。

```tsx
// app/scenes/Journal/index.tsx

import { observer } from "mobx-react";
import { useHistory, useParams } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import useStores from "~/hooks/useStores";
import Scene from "~/components/Scene";
import CalendarGrid from "./components/CalendarGrid";
import RecentEntries from "./components/RecentEntries";

const Journal = observer(() => {
  const { journalEntries } = useStores();
  const history = useHistory();
  const { date } = useParams<{ date?: string }>();
  const { t } = useTranslation();

  // 加载当月日历数据
  useEffect(() => {
    const { year, month } = journalEntries.currentMonth;
    journalEntries.fetchCalendar(year, month);
  }, [journalEntries.currentMonth.year, journalEntries.currentMonth.month]);

  // URL 带 date 参数时直接打开
  useEffect(() => {
    if (date) {
      handleSelectDate(date);
    }
  }, [date]);

  const handleSelectDate = async (selectedDate: string) => {
    const documentUrl = await journalEntries.fetchOrCreateByDate(selectedDate);
    if (documentUrl) {
      history.push(documentUrl);
    }
  };

  const handleChangeMonth = (year: number, month: number) => {
    journalEntries.currentMonth = { year, month };
  };

  return (
    <Scene title={t("Journal")}>
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
          {t("{{ count }} day streak", { count: journalEntries.streak })}
        </StreakInfo>
      )}

      <RecentEntries entries={journalEntries.recentEntries} />

      {journalEntries.isLoading && <LoadingIndicator />}
    </Scene>
  );
});

export default Journal;
```

### 7.4 CalendarGrid

```tsx
// app/scenes/Journal/components/CalendarGrid.tsx

import React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";

type Props = {
  year: number;
  month: number;
  dots: Set<string>;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onChangeMonth: (year: number, month: number) => void;
};

const CalendarGrid: React.FC<Props> = ({
  year, month, dots, selectedDate, onSelectDate, onChangeMonth,
}) => {
  const today = new Date().toISOString().split("T")[0];
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const offset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

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

  const handlePrev = () =>
    month === 1 ? onChangeMonth(year - 1, 12) : onChangeMonth(year, month - 1);
  const handleNext = () =>
    month === 12 ? onChangeMonth(year + 1, 1) : onChangeMonth(year, month + 1);

  return (
    <Wrapper>
      <MonthNav>
        <NavButton onClick={handlePrev}>&lsaquo;</NavButton>
        <MonthLabel>
          {new Date(year, month - 1).toLocaleString("default", {
            month: "long",
            year: "numeric",
          })}
        </MonthLabel>
        <NavButton onClick={handleNext}>&rsaquo;</NavButton>
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
              $isToday={cell.isToday}
              $hasEntry={cell.hasEntry}
              $isFuture={cell.isFuture}
              $isSelected={cell.date === selectedDate}
              onClick={() => !cell.isFuture && onSelectDate(cell.date)}
            >
              {cell.day}
              {cell.hasEntry && <Dot />}
            </DayCell>
          ) : (
            <EmptyCell key={`empty-${i}`} />
          )
        )}
      </DayGrid>
    </Wrapper>
  );
};

// styled-components 定义（遵循 Outline 的 s() 主题约定）
const Wrapper = styled.div``;
const MonthNav = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
`;
const NavButton = styled.button`
  background: none; border: none; cursor: pointer;
  font-size: 18px; color: ${s("textSecondary")};
`;
const MonthLabel = styled.span`
  font-size: 14px; font-weight: 500;
`;
const WeekdayRow = styled.div`
  display: grid; grid-template-columns: repeat(7, 1fr);
  text-align: center; font-size: 11px; color: ${s("textTertiary")};
  margin-bottom: 4px;
`;
const WeekdayHeader = styled.span``;
const DayGrid = styled.div`
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 2px; text-align: center; font-size: 12px;
`;
const DayCell = styled.div<{
  $isToday: boolean; $hasEntry: boolean; $isFuture: boolean; $isSelected: boolean;
}>`
  position: relative;
  padding: 5px 0;
  border-radius: 4px;
  cursor: ${(p) => (p.$isFuture ? "default" : "pointer")};
  opacity: ${(p) => (p.$isFuture ? 0.3 : 1)};
  background: ${(p) => (p.$isSelected ? s("accent") : "transparent")};
  color: ${(p) => (p.$isSelected ? "white" : p.$isToday ? s("accent") : s("text"))};
  font-weight: ${(p) => (p.$isToday ? 500 : 400)};

  &:hover {
    background: ${(p) => (p.$isFuture ? "transparent" : p.$isSelected ? s("accent") : s("secondaryBackground"))};
  }
`;
const EmptyCell = styled.div``;
const Dot = styled.span`
  position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%);
  width: 4px; height: 4px; border-radius: 50%;
  background: ${s("accent")};
`;

export default CalendarGrid;
```

### 7.5 MVP 排除项（不变）

- ❌ 内嵌编辑器分栏布局（Phase 2）
- ❌ 侧栏 streak badge
- ❌ `Cmd/Ctrl + J` 全局快捷键
- ❌ Timeline 时间线视图
- ❌ 搜索结果日记图标区分
- ❌ WebSocket 实时推送
- ❌ 月度批量导出
- ❌ 管理员团队统计仪表盘

---

## 8. 测试计划

### 8.1 API 测试

```typescript
// plugins/journal/server/api/journal.test.ts

describe("journal.upsert", () => {
  it("should create collection + document + entry on first call");
  it("should return existing entry on duplicate upsert, same documentId");
  it("should handle concurrent upsert without duplicates");
  it("should isolate entries between users on same date");
  it("should update mood and tags on existing entry");
  it("should create collection with permission=null (private)");
});

describe("journal.entries", () => {
  it("should return entries within date range");
  it("should exclude entries with soft-deleted Documents");
  it("should not return other users' entries");
});

describe("journal.calendar", () => {
  it("should return dates with entries for given month");
  it("should calculate correct streak count");
});

describe("journal.info", () => {
  it("should return entry with document details");
  it("should return 404 for non-existent date");
  it("should deny access to other users' entries");
});
```

### 8.2 模型测试

```typescript
// server/models/JournalEntry.test.ts

describe("JournalEntry", () => {
  it("should enforce unique (teamId, userId, date)");
  it("should cascade delete on Document physical delete");
});
```

### 8.3 运行

```bash
# Journal API 测试
yarn test plugins/journal/server/api/journal.test.ts

# 模型测试
yarn test server/models/JournalEntry.test.ts
```

---

## 9. 文件变更清单

### 新增文件

```
server/models/JournalEntry.ts
server/policies/journalEntry.ts
server/migrations/XXXXXX-create-journal-entries.ts
server/models/JournalEntry.test.ts
plugins/journal/server/index.ts
plugins/journal/server/api/journal.ts
plugins/journal/server/api/journal.test.ts
plugins/journal/server/presenters/journalEntry.ts
plugins/journal/server/processors/JournalProcessor.ts
app/models/JournalEntry.ts
app/stores/JournalEntriesStore.ts
app/scenes/Journal/index.tsx
app/scenes/Journal/components/CalendarGrid.tsx
app/scenes/Journal/components/RecentEntries.tsx
```

### 核心文件改动（5 处）

| 文件 | 改动 | 行数 |
|------|------|------|
| `server/models/index.ts` | export JournalEntry | +1 |
| `server/policies/index.ts` | import journalEntry policy | +1 |
| `app/routes/authenticated.tsx` | 注册 /journal 和 /journal/:date | +2 |
| `app/components/Sidebar/App.tsx` | 在 Home/Search/Drafts 段加 Journal 链接 | +3 |
| `app/stores/RootStore.ts` | import + registerStore(JournalEntriesStore) | +2 |

---

## 10. 执行顺序

### Step 1：后端模型 + 策略（2 天）

1. Migration
2. `server/models/JournalEntry.ts` + 加入 `index.ts` 导出
3. `server/policies/journalEntry.ts` + 加入 `index.ts` import
4. `plugins/journal/server/presenters/journalEntry.ts`

### Step 2：后端 API + Processor（3 天）

5. `plugins/journal/server/api/journal.ts`（4 个端点）
6. `plugins/journal/server/processors/JournalProcessor.ts`
7. `plugins/journal/server/index.ts`（Hook.API + Hook.Processor 注册）

### Step 3：后端测试（2 天）

8. `plugins/journal/server/api/journal.test.ts`
9. `server/models/JournalEntry.test.ts`

此时后端完整可测试。

### Step 4：前端（3 天）

10. `app/models/JournalEntry.ts`
11. `app/stores/JournalEntriesStore.ts` + RootStore 注册
12. `app/scenes/Journal/` 全部组件
13. `authenticated.tsx` 路由注册
14. `Sidebar/App.tsx` 入口

**总计 MVP：~10 人天（2 周）。**
