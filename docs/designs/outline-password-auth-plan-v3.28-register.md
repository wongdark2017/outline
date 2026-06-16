# Outline 邮箱 + 密码认证功能 — 技术方案 v3.28-register

> 目标：在自托管的 Outline（fork）中新增"邮箱 + 密码"登录 + 注册方式。
> 状态：设计稿 v3.28-register（v3.28 基础上新增注册功能）· 适用版本：outline/outline main 分支（2026 上半年）
> 前稿：`outline-password-auth-plan-v3.md`（v3 / v3.1）、`-v3.2.md` ~ `-v3.28.md`。本稿为独立全文，以本稿为准。

---

## 变更记录

### v3.28 → v3.28-register（本轮）

| # | 变更 | 说明 |
|---|---|---|
| 1 | 新增 §5.6 注册端点 | `POST /auth/password/register`：无 SMTP 直接创建 + 自动登录；有 SMTP 发验证邮件后再创建 |
| 2 | 新增 §5.7 邮箱验证端点 | `POST /auth/password/verify-email`：GETDEL 一次性消费，创建用户 + 自动登录 |
| 3 | 新增 `PASSWORD_REGISTRATION_ENABLED` | 独立开关，依赖 `PASSWORD_AUTH_ENABLED` |
| 4 | §5.0 路由表 +2 端点 | register + verify-email |
| 5 | §7.3 注册与验证页前端 | 注册表单切换 + /verify-email 公开路由 |
| 6 | §8 安全清单 +10 项 | 注册限流/防枚举/TOCTOU/Redis 存储等 |
| 7 | §9 测试 +8 项（26–33） | 总计 33 项 |
| 8 | §12 工作量更新 | 11–15.5 人日 |

### v3.27 → v3.28

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Low) | pre-IP-limit 只写"阈值宽于正式 IP key"，缺少比值/窗口锚点，实现者不确定 2x 还是 10x | §5.1 / §5.2 / §8 补指导口径：建议阈值为正式 IP key 的 3–5 倍、窗口相同；具体值可按部署规模调整，但必须满足测试 4 的跨 workspace 不误伤要求 |
| 2(Low) | pre-IP-limit 是 handler 内 Redis 调用，Redis 短暂故障时是否 500 未声明 | §5.1 / §5.2 / §8 补 fail-open 降级策略：pre-IP-limit Redis 调用外包 try/catch，抛错时跳过预限流并继续 team 解析与正式三键限流，成本防护不改变用户可见错误形态（与 §5.3 EXISTS 降级同口径） |

<details>
<summary>v3.26 → v3.27（已收口）</summary>

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium) | 登录三键限流写在 `User.findOne` 之后，超限请求仍会打到用户表查询 | §5.1 调整顺序为：解析 team 后先 consume 正式三键限流，再查询用户；§8 / §9 测试 7 同步 |
| 2(Medium) | `lockedUntil` / `user.isSuspended` 检查仍写在 `user === null` 分支之前 | 所有 `user.*` 状态检查必须位于 `user !== null` 分支内 |
| 3(Medium-Low) | team 解析失败或 provider 不可用发生在 team-scoped limiter 前，未知 hostname 探测可绕过限流 | §5.1 / §5.2 新增 IP-only 预限流（`password-preteam:ip`），覆盖无 teamId 的失败路径 |
| 4(Low) | reset 的"恒返回成功"没有说明 team/provider/SMTP 失败是否也中性返回 | §5.2 明确防枚举仅覆盖"team 已解析、provider 与 SMTP 可用"后的邮箱存在性 |
| 5(Low) | 测试 7 只写"三键限流"，容易误写成旧的全局 `emailHmac` 口径 | §9 测试 7 明确登录限流三键必须是 `ip` / `teamId:emailHmac` / `ip:teamId:emailHmac` |

</details>

<details>
<summary>v3.25 → v3.26（已收口）</summary>

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium) | 登录失败分支对"用户不存在"仍写成会访问 `user.id`，`User.findOne` 返回 null 时空指针崩溃 | §5.1 拆成 `user === null`（dummy verify only）/ `user !== null` 两条路径 |
| 2(Medium-Low) | 登录/reset 的 email 限流 key 未带 team 维度，同邮箱多 workspace 时 A 攻击限流 B | 限流 key 改为 `ip` / `teamId:emailHmac` / `ip:teamId:emailHmac` |
| 3(Low) | §12 工作量估算未提 EXISTS 成本闸门/降级断言 | §12 测试描述补全 |

</details>

<details>
<summary>更早的变更记录（v3 → v3.25，共 25 轮）</summary>

- **v3.24 → v3.25**：EXISTS 成本闸门补测试 8b（spy/stub）；EXISTS 失败降级 try/catch；落地口径声明。
- **v3.23 → v3.24**：reset 分支 hash 前 Redis EXISTS 成本闸门；多处旧文案改为预计算模式；`hashPassword`/`setPassword` 补 `@throws`。
- **v3.22 → v3.23**：reset 限流 limiter；CLI `findByPk` null 处理；argon2 hash 移到行锁外预计算。
- **v3.21 → v3.22**：`presentUser` 改用 `includePasswordState` option；测试 8h 只保留 stub 方案；8a 拆分断言时序；`hasPassword` 不加 `@Field`；JSDoc 最终形态。
- **v3.20 → v3.21**：`getPasswordResetToken` 返回 `{ token, jti }`；CLI 与 §5.3 同口径；SSO-only 用户卡片可见性；arrow property 方法风格；测试 8h 确定性模拟。
- **v3.19 → v3.20**：改密清零锁定状态；date-fns import；handler 级 XOR guard；测试 8 拆为 8a–8i；JSDoc 要求。
- **v3.18 → v3.19**：`resetToken` 显式 `if` 收窄 + const 绑定；60 秒时钟偏差容忍；去掉 `rejectOnEmpty`；两区 catch 叙述修正；zod safeParse 替代类型守卫。
- **v3.17 → v3.18**：discriminated union；reset payload 结构化校验；createdAt 校验加固；Redis value 解析安全；error import 补全。
- **v3.16 → v3.17**：`import JWT from "jsonwebtoken"` 修正；reset 预验证完整代码；`newAccessToken` null guard；测试 24 改为不绑定顺序；测试 21/23g 补 400 不触发 logout 断言。
- **v3.15 → v3.16**：transport 校验替代 `type === APP`；多 reset token 并发 + 行级锁；cookie 不传 `domain`；`ResetTokenConsumedError`；登录态失败响应 JSON。
- **v3.14 → v3.15**：GETDEL 唯一权威判定；登录态只接受 APP session → 改为 cookie transport 校验。
- **v3.13 → v3.14**：`ServiceUnavailableError`；`resignSession` 替换为具体实现；SMTP 文案修正。
- **v3.12 → v3.13**：成功响应形态 JSON；`Event.createFromContext` 4 参数；SMTP 判断双条件；`hooks: false` 边界说明。
- **v3.11 → v3.12**：`failedSignInAttempts` NOT NULL DEFAULT 0；reset 审计 auth context 隔离；Redis/DB 一致性说明；原子 increment。
- **v3.10 → v3.11**：`Event.createFromContext` 事务参数位置；测试 18 拆分并发子用例。
- **v3.9 → v3.10**：cloud guard；显式事务；`rotateJwtSecret` 签名修正；原子 increment。
- **v3.8 → v3.9**：`?token=` 断言收窄；optional auth activeAt 副作用定性。
- **v3.7 → v3.8**：`token` 红线扩展到 query；空 query strict；update XOR。
- **v3.6 → v3.7**：body schema `.strict()` 枚举全部合法字段；中间件执行顺序说明。
- **v3.5 → v3.6**：reset token body 字段改名 `resetToken`（CSRF 修复）。
- **v3.4 → v3.5**：`baseUrl: "/auth"`；reset 不自动登录；ResetPassword 视觉体系。
- **v3.3 → v3.4**：`@SkipChangeset`；显式事件 data；前端 reset 闭环。
- **v3.2 → v3.3**：token payload 写死；`user.jwtSecret` 签名；插件 env 骨架。
- **v3.1 → v3.2**：条件注册；team 作用域；`isNewUser: false`。
- **v3 → v3.1**：`signIn` 签名修正；CSRF hidden input；suspended 预检查。
- **v2 → v3**：路径风格路由；`Hook.EmailTemplate`；CLI 脚本。
- **v1 → v2**：插件机制；async 方法；专用限流；`rotateJwtSecret()`。

</details>

> **落地口径声明（v3.25）**：旧轮次变更记录保留原始评审语境，部分描述（如"事务内 `setPassword`"）已被后续版本替代。**实现以正文 §4/§5.3/§6/§8 为最终落地口径。**

---

## 1. 背景与前提

Outline 官方刻意不提供密码登录，认证完全委托给外部 Provider，这是出于安全考虑的产品决策。由此：

1. **该功能上游不会合并**，属于 fork 级改动，需要长期自己维护（BSL 1.1 允许自托管修改，无合规问题）。
2. 密码体系的"找回/首次设密"默认依赖邮件。**无 SMTP 部署必须实现 §6 的非邮件初始化路径，并禁用"忘记密码"入口**。

---

## 2. 零代码替代方案（建议先评估）

| 方案 | 说明 | 适用场景 |
|---|---|---|
| SMTP 魔法链接 | 内置邮箱登录：输入邮箱 → 收一次性登录链接 | 有 SMTP、能接受无密码流程 |
| 前置 IdP（推荐） | Keycloak / Authentik 走 OIDC，密码、MFA、找回全套都有 | 愿意多维护一个轻量服务 |

确认都不满足（典型：内网无 SMTP 且不想加服务）再实施本方案，并按 §6 选定密码初始化方式。

---

## 3. 总体设计

**核心原则：以 `plugins/password` 插件的身份加入 Provider 体系，复用 `signIn`、cookie、审计与登录页配置。**

```
plugins/<name>/plugin.json                  ← 插件声明
plugins/<name>/server/index.ts              ← PluginManager.add([{ type: Hook.AuthProvider, … },
                                                                  { type: Hook.EmailTemplate, … }])
server/routes/auth/index.ts                 ← 遍历 AuthenticationHelper.providers（全量已注册 hook），
                                               动态挂载到 /auth/<id>
```

> **注意**：路由挂载读的是 `AuthenticationHelper.providers`——即 `PluginManager.getHooks(Hook.AuthProvider)` 全量列表。**"注册了就可达"**，因此开关必须控制注册本身，见 §5.5。每个 provider router 挂载时都统一套了 `authMiddleware({ optional: true })`——password 路由进入 handler 前，请求中携带的任何有效凭据都已被解析进 `ctx.state.auth`。

### 改动文件总览

```
★ plugins/password/plugin.json                          插件声明
★ plugins/password/server/index.ts                      条件注册 Hook.AuthProvider + Hook.EmailTemplate
★ plugins/password/server/env.ts                        插件本地 env: PASSWORD_AUTH_ENABLED + PASSWORD_REGISTRATION_ENABLED
★ plugins/password/server/auth/password.ts              路由: 登录 / reset / update / register / verify-email
★ plugins/password/server/auth/schema.ts                zod 校验 schema × 5 (body .strict() + query 空 strict)
★ plugins/password/server/auth/password.test.ts         集成测试
★ plugins/password/server/email/PasswordResetEmail.tsx   找回邮件模板
★ plugins/password/server/email/RegistrationVerifyEmail.tsx  注册验证邮件模板 (new)
★ plugins/password/server/email/RegistrationAlertEmail.tsx   已注册告警邮件模板 (new)
★ server/migrations/XXXX-add-user-password.js           数据库迁移（3 字段）
✎ server/models/User.ts                                 3 个 @Column + setPassword/verifyPassword/getPasswordResetToken
✎ server/routes/api/auth/auth.ts                        NON_SSO_SERVICES 加入 "password"
✎ server/presenters/user.ts                             新增 includePasswordState option
★ server/scripts/set-password.ts                        无 SMTP 初始化路径（§6）
✎ package.json                                          新增 argon2 依赖 + yarn script
✎ app/routes/index.tsx                                  新增公开路由 /reset-password + /verify-email
★ app/scenes/Login/ResetPassword.tsx                    重置密码公开页面
★ app/scenes/Login/VerifyEmail.tsx                      邮箱验证页面 (new)
✎ app/scenes/Login/components/AuthenticationProvider.tsx id === "password" 分支
✎ app/scenes/Login/components/Notices.tsx               新增 6 条 notice 文案（含注册）
★ app/scenes/Settings/(个人 Profile)                    修改密码卡片
```

> 侵入式修改集中在 8 个现有文件，其余均在 `plugins/password/`、新场景文件与独立脚本——rebase 上游时冲突面小。`server/env.ts` **不修改**。

---

## 4. 数据层

**新增依赖**：

```bash
yarn add argon2   # 原生模块，确认构建镜像有 prebuilt 二进制或编译工具链
```

migration 在 `users` 表上新增 **3 个字段**：

| 字段 | 类型 | 用途 |
|---|---|---|
| `passwordHash` | TEXT, nullable | 为 null 表示该用户仅可走 SSO |
| `failedSignInAttempts` | INTEGER, NOT NULL, default 0 | 连续失败计数（NOT NULL 保证原子 +1 不产生 NULL） |
| `lockedUntil` | TIMESTAMP, nullable | 账号锁定截止时间 |

**模型字段声明**：

```typescript
@Column(DataType.TEXT)
@SkipChangeset
passwordHash: string | null;

@AllowNull(false)
@Default(0)
@Column(DataType.INTEGER)
@SkipChangeset
failedSignInAttempts: number;

@IsDate
@Column
@SkipChangeset
lockedUntil: Date | null;
```

> **3 个字段全部标 `@SkipChangeset`**：`Model.insertEvent` 会把 `previousChangeset` 写入 `events.changes`，`passwordHash` 进 changeset 意味着每次改密都会把新旧 hash 持久化到 events 表。"密码已修改"的审计语义改由显式事件 `data: { passwordChanged: true }` 承担。

### User 模型方法

```typescript
/**
 * Set the user's password by hashing the provided plaintext with argon2id.
 *
 * @param plain plaintext password to hash.
 * @returns promise that resolves when the hash is computed and assigned.
 * @throws if argon2 hashing encounters a runtime error.
 */
setPassword = async (plain: string) => {
  this.passwordHash = await argon2.hash(plain, { type: argon2.argon2id });
};

/**
 * Verify the user's password against the stored hash. For users without
 * a password (SSO-only), a dummy hash is verified to prevent timing
 * side-channel enumeration.
 *
 * @param plain plaintext password to verify.
 * @returns whether the password matches.
 * @throws if argon2 verification encounters a runtime error.
 */
verifyPassword = async (plain: string): Promise<boolean> => {
  if (!this.passwordHash) {
    await argon2.verify(DUMMY_HASH, plain);
    return false;
  }
  return argon2.verify(this.passwordHash, plain);
};

/**
 * Hash a plaintext password with argon2id without mutating any instance.
 * Use to pre-compute hash outside a database transaction.
 *
 * @param plain plaintext password to hash.
 * @returns the argon2id hash string.
 * @throws if argon2 hashing encounters a runtime error.
 */
static hashPassword = async (plain: string): Promise<string> => {
  return argon2.hash(plain, { type: argon2.argon2id });
};
```

---

## 5. 服务端（plugins/password）

### 5.0 路由命名与请求字段约定

| 端点 | 用途 |
|---|---|
| `POST /auth/password` | 登录 |
| `POST /auth/password/reset` | 发起找回 |
| `POST /auth/password/update` | 设置 / 重置密码 |
| `POST /auth/password/register` | 注册 **[new]** |
| `POST /auth/password/verify-email` | 邮箱验证回调（仅 SMTP 模式）**[new]** |

> **`token` 字段红线（body 与 query）**：任何 `/auth/password/*` 端点的请求体和 query string 中都禁止出现名为 `token` 的字段。`parseAuthentication` 按 body → query → cookie 的顺序取认证 token——body/query 中的 `token` 会污染 transport 使 `verifyCSRFToken` 整体跳过 CSRF 校验。

**封堵方式（不对称）**：

- **body 向量**：字段改名 `resetToken`——让合法请求保持 cookie transport，CSRF 校验恢复生效；`.strict()` 是钉死改名的纵深。
- **query 向量**：合法请求不带任何 query，封堵用 `query: z.object({}).strict()`——route 层 400 先于 handler，password 端点状态变更不执行。

**Schema 示例（update 端点）**：

```typescript
export const PasswordUpdateSchema = BaseSchema.extend({
  body: z
    .object({
      resetToken:      z.string().min(1).optional(),    // reset token 路径
      currentPassword: z.string().min(1).optional(), // 登录态路径
      password:        z.string().min(12),
      [CSRF.fieldName]: z.string().optional(),       // "_csrf" hidden input
    })
    .strict()
    .superRefine((body, ctx) => {
      const hasReset   = body.resetToken !== undefined;
      const hasCurrent = body.currentPassword !== undefined;
      if (hasReset === hasCurrent) {
        ctx.addIssue({ code: z.ZodIssueCode.custom,
          message: "Provide exactly one of resetToken or currentPassword" });
      }
    }),
  query: z.object({}).strict(),
});
```

---

### 5.1 `POST /auth/password` — 登录

1. **Schema 校验**：`email` / `password` / `client`（邮箱小写归一），body `.strict()` 枚举含 `_csrf` + 空 query strict。
2. **Pre-IP-limit** [v3.27] [v3.28]：consume 轻量 IP-only key `password-login-preteam:ip:${ip}`。阈值为正式登录 IP key 的 **3–5 倍**，窗口相同。Redis 调用外包 try/catch，**fail-open**：抛错时跳过预限流继续后续流程。
3. **解析 team**：照搬 email 登录的 hostname → team 三分支解析。team 不存在 / provider 不可用 → 拒绝。team suspended → 按域名推导回跳。
4. **正式三键限流** [v3.26]：consume `ip` / `teamId:emailHmac` / `ip:teamId:emailHmac`，任一超限即 429。`emailHmac` = HMAC-SHA256(email, `SECRET_KEY`)。**必须在 User.findOne 之前执行**。
5. **用户查询**：`User.findOne({ where: { teamId: team.id, email } })`，禁止全局查询。
6. **密码验证** [v3.26]：

   **`user === null`**（用户不存在）→ 仅 `argon2.verify(DUMMY_HASH, password)` + redirect `?notice=password-auth-failed`。**不递增计数、不写锁定、不写审计事件。**

   **`user !== null`** →
   - 检查 `user.isSuspended` / `user.lockedUntil`（**必须在 null 分支内**）
   - 失败 → 原子 `User.increment('failedSignInAttempts', ...)`，达阈值写 `lockedUntil`
   - 成功 → 清零计数，`signIn(ctx, "password", { user, team, client, isNewTeam: false, isNewUser: false })`

---

### 5.2 `POST /auth/password/reset` — 发起找回

1. **Pre-IP-limit** [v3.27] [v3.28]：consume `password-reset-preteam:ip:${ip}`，阈值为正式 reset IP key 的 **3–5 倍**。同样 **fail-open**。
2. **解析 team** → **正式三键限流**（reset 专用 limiter，阈值**严于登录**），任一超限 429，不生成 token / 不发邮件。
3. **防枚举** [v3.27]：team 已解析 + provider 可用 + SMTP 可用 + 未触发限流 → **无论邮箱是否存在都返回 success**。team/provider/SMTP 失败则分别拒绝或 503。
4. **生成 token**：`user.getPasswordResetToken()` 返回 `{ token, jti }`，Redis SET `password-reset:jti:${jti}` value `{ userId, teamId }`，15min TTL。发送邮件 `${team.url}/reset-password?token=…`。

**Token 生成方法**：

```typescript
getPasswordResetToken = (): { token: string; jti: string } => {
  const jti = crypto.randomUUID();
  const token = JWT.sign(
    { id: this.id, teamId: this.teamId,
      type: "password-reset", createdAt: new Date().toISOString(), jti },
    this.jwtSecret
  );
  return { token, jti };
};
```

---

### 5.3 `POST /auth/password/update` — 设置 / 重置密码

#### 鉴权（必须且只能其一）

1. **Reset token 路径**：字段 `resetToken`，验证 payload → team 核对 → 用户查询 → 验签 → 事务内 GETDEL 消费。
2. **登录态路径**：`ctx.state.auth.user` 存在 **且** `parseAuthentication(ctx).transport === "cookie"`。当前密码错误 → **400**（不用 401，避免 ApiClient logout）。

#### Discriminated Union

```typescript
interface ResetContext {
  kind: "reset";
  user: User; payload: PasswordResetPayload;
  jtiKey: string; resetToken: string;
}
interface LoginContext {
  kind: "login";
  user: User; currentPassword: string; expires: Date;
}
type PasswordUpdateContext = ResetContext | LoginContext;
```

#### 事务骨架（核心流程）

```typescript
// ── handler 级 XOR 防御 ──
if ((resetToken !== undefined) === (currentPassword !== undefined)) {
  throw ValidationError("Provide exactly one of resetToken or currentPassword");
}

// ── 构建鉴权上下文（预验证，区域一 try/catch） ──
let updateContext: PasswordUpdateContext;
if (resetToken !== undefined) {
  const token = resetToken;  // const 绑定，闭包安全
  try { /* decode → safeParse → createdAt → team → user → 验签 */ }
  catch (err) {
    if (err instanceof ResetTokenConsumedError) { ctx.redirect(`...?notice=expired-token`); return; }
    throw err;
  }
} else if (currentPassword !== undefined) {
  // 校验 transport === "cookie" + verifyPassword
} else { throw ValidationError("..."); }

// ── reset 分支：EXISTS 成本闸门（fail-open） ──
if (updateContext.kind === "reset") {
  try { if (!await redis.exists(updateContext.jtiKey)) { redirect; return; } }
  catch { /* 降级：跳过预检 */ }
}

// ── 事务前预计算 hash ──
const newHash = await User.hashPassword(password);

// ── 事务（区域二 try/catch） ──
try {
  const newAccessToken = await sequelize.transaction(async (transaction) => {
    // 1. SELECT ... FOR UPDATE
    const lockedUser = await User.findByPk(updateContext.user.id,
      { transaction, lock: transaction.LOCK.UPDATE });
    if (!lockedUser) { /* null 检查 → 对应路径的错误 */ }

    // 2. 锁内重新验证
    if (updateContext.kind === "reset") {
      JWT.verify(updateContext.resetToken, lockedUser.jwtSecret);
      // 3. GETDEL（唯一权威判定，在 DB 变更前）
      const consumed = await redis.getdel(updateContext.jtiKey);
      if (!consumed) throw new ResetTokenConsumedError();
      // Redis value 解析 + shape 校验
    } else {
      if (!await lockedUser.verifyPassword(updateContext.currentPassword))
        throw ValidationError("Current password is incorrect");
    }

    // 4. 赋值 + 清锁 + save + rotate + 审计
    lockedUser.passwordHash = newHash;
    lockedUser.failedSignInAttempts = 0;
    lockedUser.lockedUntil = null;
    await lockedUser.save({ transaction, hooks: false });
    await lockedUser.rotateJwtSecret({ transaction });
    // 写审计事件（reset 用 Event.create，login 用 createFromContext）

    if (updateContext.kind === "login")
      return lockedUser.getSessionToken(updateContext.expires, "password");
    return null;
  });

  // 5. 事务提交后的响应
  if (updateContext.kind === "reset") ctx.redirect(`...?notice=password-updated`);
  else { /* set cookie + JSON { success: true } */ }
} catch (err) {
  if (updateContext.kind === "reset" &&
      (err instanceof ResetTokenConsumedError ||
       err instanceof JsonWebTokenError ||
       err instanceof TokenExpiredError)) {
    ctx.redirect(`...?notice=expired-token`); return;
  }
  throw err;
}
```

---

### 5.4 与现有认证体系的对接

1. `NON_SSO_SERVICES` 加入 `"password"`。
2. `providersForTeam` — **core 零修改**，可见性由条件注册传导。
3. 注册 `Hook.EmailTemplate`。

---

### 5.5 开关策略

两个环境变量，**均默认 false**；首版严格 self-host：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PASSWORD_AUTH_ENABLED` | `false` | 密码登录总开关（登录 / reset / update） |
| `PASSWORD_REGISTRATION_ENABLED` | `false` | 开放注册开关；**依赖 `PASSWORD_AUTH_ENABLED=true`** |

```typescript
// plugins/password/server/env.ts
class PasswordPluginEnvironment extends Environment {
  @IsBoolean()
  public PASSWORD_AUTH_ENABLED = this.toBoolean(
    environment.PASSWORD_AUTH_ENABLED ?? "false"
  );

  @IsBoolean()
  public PASSWORD_REGISTRATION_ENABLED = this.toBoolean(
    environment.PASSWORD_REGISTRATION_ENABLED ?? "false"
  );
}
export default new PasswordPluginEnvironment();
```

```typescript
// plugins/password/server/index.ts — 条件注册
if (env.PASSWORD_AUTH_ENABLED && !coreEnv.isCloudHosted) {
  PluginManager.add([
    { ...config, type: Hook.AuthProvider, value: { router, id: config.id } },
    { type: Hook.EmailTemplate, value: PasswordResetEmail },
    ...(env.PASSWORD_REGISTRATION_ENABLED
      ? [{ type: Hook.EmailTemplate, value: RegistrationVerifyEmail }]
      : []),
  ]);
}
```

关闭时或 cloud-hosted 时路由不挂载（404）；端点内再做同条件兜底检查，双层防护。注册端点额外检查 `PASSWORD_REGISTRATION_ENABLED`。

---

### 5.6 `POST /auth/password/register` — 注册 **[new]**

> **两种模式**：由 SMTP 可用性（`EMAIL_ENABLED && SMTP_FROM_EMAIL`）自动决定。有 SMTP → 发验证邮件后创建；无 SMTP → 直接创建并自动登录。**两种模式注册成功后都自动登录。**

#### Schema

```typescript
export const PasswordRegisterSchema = BaseSchema.extend({
  body: z.object({
    email:    z.string().email().transform(v => v.toLowerCase()),
    password: z.string().min(12),
    name:     z.string().min(1).max(255),
    [CSRF.fieldName]: z.string().optional(),
  }).strict(),
  query: z.object({}).strict(),
});
```

#### 流程

1. **Schema 校验**：email / password / name，body `.strict()` + 空 query strict。
2. **Pre-IP-limit**：consume `password-register-preteam:ip:${ip}`，阈值为正式注册 IP key 的 3–5 倍，**fail-open**。
3. **解析 team**：hostname → team 三分支解析（同 §5.1）。
4. **Guard**：`PASSWORD_REGISTRATION_ENABLED && !isCloudHosted`，否则 404。team suspended → redirect。
5. **正式三键限流**（注册专用 limiter，**最严**——建议 IP: 10/h，email: 3/h，组合: 3/h）。key: `ip` / `teamId:emailHmac` / `ip:teamId:emailHmac`。
6. **Team 准入检查**：
   - `team.inviteRequired === true` → 403 `"Registration requires an invitation"`
   - `allowedDomains` 非空 → `team.isDomainAllowed(email)` → 域名不符 403
7. **查重**：`User.findOne({ where: { teamId: team.id, email } })`
8. **分支处理**：

#### 8a — 用户已存在（防枚举）

```typescript
if (existingUser) {
  await User.hashPassword(password);  // timing alignment，防时序旁路

  if (smtpAvailable) {
    // 发"有人尝试注册你的邮箱"告警邮件（异步，不阻塞响应）
    new RegistrationAlertEmail({ to: existingUser.email, ... }).schedule();
    ctx.redirect(`${team.url}?notice=check-email`);
  } else {
    ctx.redirect(`${team.url}?notice=registration-failed`);
  }
  return;
}
```

#### 8b — 用户不存在，有 SMTP

```typescript
const passwordHash = await User.hashPassword(password);
const code = crypto.randomUUID();
await redis.set(
  `password-register:${code}`,
  JSON.stringify({ email, name, passwordHash, teamId: team.id }),
  "EX", 1800  // 30min TTL
);

// 发送验证邮件：链接 ${team.url}/verify-email?code=${code}
new RegistrationVerifyEmail({
  to: email, teamUrl: team.url, verifyUrl: `${team.url}/verify-email?code=${code}`,
}).schedule();

ctx.redirect(`${team.url}?notice=check-email`);
```

#### 8c — 用户不存在，无 SMTP（直接创建 + 自动登录）

```typescript
const passwordHash = await User.hashPassword(password);

const user = await sequelize.transaction(async (transaction) => {
  // 事务内再次查重（防并发注册同邮箱）
  const duplicate = await User.findOne({
    where: { teamId: team.id, email },
    transaction, lock: transaction.LOCK.UPDATE,
  });
  if (duplicate) throw new ValidationError("registration-failed");

  const newUser = await User.create({
    name, email, passwordHash,
    teamId: team.id,
    role: team.defaultUserRole,
    lastActiveAt: new Date(),
    lastActiveIp: ctx.request.ip,
  }, { transaction });

  await Event.create({
    name: "users.create",
    actorId: newUser.id, userId: newUser.id, teamId: team.id,
    ip: ctx.request.ip,
    data: { name: newUser.name, service: "password" },
  }, { transaction });

  return newUser;
});

// 自动登录
signIn(ctx, "password", {
  user, team, client,
  isNewTeam: false,
});
```

> **事务内再次查重**：步骤 7 是事务外的查询，存在 TOCTOU 窗口。事务内用 `findOne + LOCK.UPDATE` 进行行级锁定，配合 `email + teamId` 唯一约束，保证不创建重复用户。并发注册同邮箱时仅一个成功，另一个 catch 到约束违反 → redirect `?notice=registration-failed`。

---

### 5.7 `POST /auth/password/verify-email` — 邮箱验证 **[new]**

仅 SMTP 模式下可达。前端 `/verify-email` 页面从 URL query 取 `code` 后 native form POST 到此端点。

#### Schema

```typescript
export const PasswordVerifyEmailSchema = BaseSchema.extend({
  body: z.object({
    code: z.string().uuid(),
    client: z.nativeEnum(Client).optional(),
    [CSRF.fieldName]: z.string().optional(),
  }).strict(),
  query: z.object({}).strict(),
});
```

#### 流程

1. **Pre-IP-limit** + 正式限流（复用注册 limiter，按 IP 消费）。
2. **Redis GETDEL** `password-register:${code}` — 唯一权威，一次性消费。
3. **JSON.parse + shape 校验**（email / name / passwordHash / teamId），坏值 → redirect `?notice=verification-expired`。
4. **查找 team**：`Team.findByPk(teamId)`，null / suspended / `!PASSWORD_REGISTRATION_ENABLED` → 拒绝。
5. **事务内创建用户**（与 §5.6 8c 同逻辑）：
   - 事务内 `User.findOne + LOCK.UPDATE` 再次查重——防验证期间 SSO 已创建同邮箱用户
   - duplicate → redirect `?notice=registration-failed`
   - 创建 User，角色 = `team.defaultUserRole`
   - 写 `users.create` 审计事件
6. **自动登录**：`signIn(ctx, "password", { user, team, client, isNewTeam: false })`

#### 失败路径

- code 不存在 / 已消费 / 过期 → redirect `?notice=verification-expired`
- team 准入条件不满足（`inviteRequired` 变更 / 域名策略变更）→ redirect `?notice=registration-failed`

---

## 6. CLI 密码初始化与找回

| 路径 | 形态 | 说明 |
|---|---|---|
| **A. 服务器 CLI（v1 推荐）** | `server/scripts/set-password.ts` | 管理员在服务器为用户设密/重置 |
| B. 管理后台一次性链接 | 用户管理页生成链接 | §10 后续 |
| C. Bootstrap token | 环境变量注入 | 只解决首个管理员冷启动 |

> **CLI 落库要求**：与 §5.3 update handler 完全一致 — 事务前 `User.hashPassword` 预计算 → 事务内 `SELECT ... FOR UPDATE` → null 检查 → 赋值 `passwordHash` + 清零锁定 → `save({ hooks: false })` → `rotateJwtSecret` → 写审计事件。

---

## 7. 前端

### 7.1 登录页

- `AuthenticationProvider.tsx` 新增 `id === "password"` 分支：邮箱 + 密码输入框，native form POST 到 `/auth/password`
- CSRF hidden input（`CSRF.fieldName`）+ `client` hidden input
- "忘记密码"子状态：RPC POST `/auth/password/reset`，注意 `{ baseUrl: "/auth" }`
- "忘记密码"入口仅在 `env.EMAIL_ENABLED` 为 true 时渲染

### 7.2 重置密码公开页面

- 路由：`app/routes/index.tsx` 公开区新增 `/reset-password`
- 场景组件：`app/scenes/Login/ResetPassword.tsx`，复用 Login 视觉体系
- 表单提交：native form POST 到 `/auth/password/update`，hidden input 字段名为 **`resetToken`**
- 成功 → redirect `?notice=password-updated`；失败 → redirect `?notice=expired-token`

### 7.3 注册与验证页 **[new]**

- **注册表单**：`AuthenticationProvider.tsx` 中 `id === "password"` 分支新增"注册"切换链接。点击后表单增加 `name` 字段，form action 切换到 `/auth/password/register`
- 仅在 provider config 返回 `registrationEnabled: true` 时渲染注册入口
- **CSRF hidden input** + `client` hidden input（同登录表单）
- **验证页**：路由 `/verify-email`（公开），场景 `app/scenes/Login/VerifyEmail.tsx`
- 从 URL query 取 `code` → hidden input + native form auto-POST 到 `/auth/password/verify-email`
- 展示"正在验证…"状态；成功后服务端 `signIn` redirect（自动登录）
- 失败 → redirect `?notice=verification-expired`

### 7.4 通用约定

- **失败回跳**：目标 URL 由 `team.url` / 请求 hostname 推导，禁止硬编码根路径
- **Notices 文案**：新增 `password-auth-failed` / `password-locked` / `password-updated` / `check-email` / `registration-failed` / `verification-expired`；reset 失效复用已有 `expired-token`
- **设置页**：修改密码卡片放个人 Profile，走登录态路径（`currentPassword` + `password`）。成功返回 JSON + 重签 cookie，失败返回 JSON error（密码错误 → 400，非 cookie → 401）
- **SSO-only 卡片**：`presentUser` 新增 `includePasswordState` option → `hasPassword: !!user.passwordHash`，仅 `auth.info` 传 true
- **前端类型**：`@observable hasPassword?: boolean`，**不加 `@Field`**

---

## 8. 安全清单

实现时逐条对照：

- [ ] 哈希用 argon2id（`argon2` 包，先 `yarn add argon2`），禁止自拼 crypto 原语。
- [ ] **登录失败路径 user null 安全** [v3.26]：`User.findOne` 返回 null 时仅 dummy verify + 模糊失败 redirect，**不访问 `user.id` / `user.isSuspended`**；`user !== null` 时才检查状态、递增/锁定。
- [ ] **Pre-IP-limit** [v3.27] [v3.28]：登录与 reset 都先 consume IP-only key；**阈值为对应正式 IP key 的 3–5 倍，窗口相同**；必须 **fail-open**（try/catch，抛错跳过）。
- [ ] **登录专用限流器** [v3.26]：三键 `ip` / `teamId:emailHmac` / `ip:teamId:emailHmac` + 账号锁定。key 含 `teamId`，在 `User.findOne` 前执行。
- [ ] **Reset 专用限流器** [v3.23]：同三键，阈值严于登录；在用户查找前对所有邮箱统一执行（防枚举）。
- [ ] **原子 increment**：`User.increment('failedSignInAttempts', ...)`，`failedSignInAttempts` 列 `NOT NULL DEFAULT 0`。
- [ ] **用户查询必须 team 作用域且排在正式限流之后**。
- [ ] **CLI 落库语义与服务端一致**：预计算 hash → FOR UPDATE → null 检查 → 赋值 + 清锁 → save → rotateJwtSecret → 审计。
- [ ] Reset token：payload `{ id, teamId, type, createdAt, jti }`，`user.jwtSecret` 签名，15 分钟。`getPasswordResetToken()` 返回 `{ token, jti }`。
- [ ] **`token` 字段红线**：body 改名 `resetToken`；query 空 strict。
- [ ] **三个 schema body `.strict()`** + 空 query strict + update XOR `.superRefine()`。
- [ ] **Reset 不自动登录**：redirect `?notice=password-updated`。
- [ ] **登录态改密只接受 cookie transport**：检查 `parseAuthentication(ctx).transport === "cookie"`。
- [ ] **显式 `sequelize.transaction()`**：`/auth` 无全局 transaction 中间件。
- [ ] **改密清零锁定状态** [v3.20]：`failedSignInAttempts = 0; lockedUntil = null`。
- [ ] **Reset 审计绕开 `createFromContext`**：用 `Event.create` 直接传 `actorId`/`teamId`。
- [ ] **GETDEL 唯一权威判定**：单次 GETDEL，在 DB 变更之前。
- [ ] **`SELECT ... FOR UPDATE` + 锁内重新验证**：防多 token 并发。
- [ ] **`findByPk` 不用 `rejectOnEmpty`**：手动 null 检查。
- [ ] **两区 catch**：预验证 → redirect；事务内 → redirect。不暴露 500。
- [ ] **登录态失败返回 JSON**：密码错 → **400**（不用 401，避免 ApiClient logout）。
- [ ] `rotateJwtSecret` 吊销全部旧会话；登录态用 `lockedUser.getSessionToken()` 重签。
- [ ] **GETDEL 在 DB 变更前**。
- [ ] **argon2 hash 事务外预计算** [v3.23]。
- [ ] **EXISTS 成本闸门** [v3.24]：fail-open 降级 [v3.25]。
- [ ] **两区 catch 详细分工** [v3.18]。
- [ ] JWT / zod / date-fns import 正确。
- [ ] Reset payload `PasswordResetPayloadSchema.safeParse()` [v3.19]。
- [ ] createdAt 校验：Invalid Date → 未来时间（60s leeway）→ 15min 过期。
- [ ] Redis value 解析安全：JSON.parse + shape 校验，坏值 → `ResetTokenConsumedError`。
- [ ] Discriminated union `PasswordUpdateContext` [v3.18]。
- [ ] 改密成功发邮件通知（SMTP 可用时，事务外异步）。
- [ ] **3 个字段全部 `@SkipChangeset`**。
- [ ] 密码明文永不进日志；`passwordHash` 不进 presenter。
- [ ] `presentUser` `includePasswordState` option，仅 `auth.info` 打开。
- [ ] `"password"` 加入 `NON_SSO_SERVICES`。
- [ ] `PASSWORD_AUTH_ENABLED=false` 或 `isCloudHosted` 时不注册，404 + 端点兜底双层。
- [ ] `providersForTeam` 零修改。
- [ ] SSO-only 用户密码登录被拒，耗时一致。
- [ ] 失败回跳由 `team.url` / hostname 推导。
- [ ] suspended 在 `signIn` 前预检查。
- [ ] native form 携带 CSRF hidden input；RPC 经 ApiClient 带 `{ baseUrl: "/auth" }`。
- [ ] `/reset-password` 页面不在 URL 之外暴露 token。
- [ ] 新增 User 方法补 JSDoc + `@throws`。
- [ ] **注册限流最严** [register]：IP 10/h，email 3/h，组合 3/h；远低于登录/reset 阈值。
- [ ] **Team 准入** [register]：`inviteRequired === true` → 403；`allowedDomains` 非空 → `isDomainAllowed` 校验。
- [ ] **已存在邮箱防枚举** [register]：dummy `hashPassword` + 统一响应；有 SMTP 时发告警邮件。
- [ ] **待验证数据仅存 Redis** [register]：30min TTL，不污染 users 表；存的是 `passwordHash`（非明文）。
- [ ] **验证 GETDEL 一次性消费** [register]：与 reset 同模式。
- [ ] **事务内再次查重** [register]：防 TOCTOU（注册与 SSO 并发创建同邮箱用户）。
- [ ] **verify-email query 不用 `token`** [register]：字段名 `code`，红线同适用。
- [ ] **新用户角色不由前端指定** [register]：强制 `team.defaultUserRole`。
- [ ] **`PASSWORD_REGISTRATION_ENABLED` 依赖 `PASSWORD_AUTH_ENABLED`** [register]：双层 guard + cloud guard。
- [ ] **注册后自动登录** [register]：两种模式都走 `signIn`，cookie / 审计事件 / sessions 一致。

---

## 9. 测试

`plugins/password/server/auth/password.test.ts` — 33 项（含注册 8 项）：

| # | 测试内容 |
|---|---|
| 1 | `auth.config` 开关开/关时正确暴露/隐藏 password provider |
| 2 | `PASSWORD_AUTH_ENABLED=false` → 404；`isCloudHosted` 即使 `=true` 也 404 |
| 3 | 正确密码登录成功，cookie 与 `users.signin` 审计事件正确 |
| 4 | **同邮箱多 workspace 隔离**：密码/会话/reset/限流互不污染；预限流不误伤 |
| 5 | 错误密码 → 计数递增；**用户不存在 → 同响应、不递增、不 500** |
| 6 | 连续失败触发锁定，到期解锁 |
| 7 | **登录限流**：a. 三键超限 429; b. 限流先于用户查询; c. 预 IP 限流 + 降级 |
| 8 | **Reset token 消费与边界**：a. 正常消费; b. 二次使用(含 EXISTS 断言); c. 过期; d. team 不匹配; e. Redis 坏值; f. payload 缺字段; g. 非法/未来日期; h. 用户被删除; i. strict 拒绝额外参数 |
| 9 | 改密后旧 cookie 失效，reset token 失效，锁定清零，事务原子性 |
| 10 | SSO-only 被拒；`hasPassword` presenter 字段正确 |
| 11 | suspended 在 `signIn` 前被拒，回跳正确域名 |
| 12 | SMTP 不可用：a. EMAIL_ENABLED=false; b. SMTP_FROM_EMAIL 缺失 → 503 |
| 13 | 登录失败重定向到正确域名 |
| 14 | **CSRF 与 schema（6 子项）**：a. cookie+CSRF; b. resetToken vs token 对照; c. strict 拒绝; d. 合法字段一一对应; e. `?token=` 被拒; f. XOR |
| 15 | `Notices.tsx` 渲染对应文案 |
| 16 | 审计事件 `passwordChanged: true`；changeset 无 hash |
| 17 | `/reset-password` 页面流（前端测试） |
| 18 | **并发错误密码**：a. N<阈值精确计数; b. N≥阈值触发锁定 |
| 19 | **Auth context 隔离**：a. 跨用户 token 归属正确; b. 事务回滚后 token 已消耗 |
| 20 | CLI set-password 落库完整性 |
| 21 | **设置页响应形态**：成功 JSON + cookie；失败 400（不触发 logout） |
| 22 | **Reset token 并发双提交**：只一个成功 |
| 23 | **Transport 校验（7 子项）**：匿名/API key/OAuth/Bearer header → 401；cookie → 成功；错误密码 → 400 |
| 24 | **多 token 并发**：只一个成功，钉死 FOR UPDATE + 锁内验签 |
| 25 | **Reset 限流（8 子项）**：a-c. IP/邮箱/组合超限; d. 不泄露存在性; e. 窗口恢复; f. 跨 workspace 隔离; g. 预 IP 限流+降级; h. 防枚举边界 |
| | **— 注册功能测试 —** |
| 26 | **注册成功（无 SMTP）**：创建用户 + 自动登录 + cookie + `users.create` 事件 + `users.signin` 事件；角色 = `team.defaultUserRole` |
| 27 | **Team 准入**：a. `inviteRequired=true` → 403; b. `allowedDomains` 不匹配 → 403; c. 域名匹配 → 成功 |
| 28 | **已存在邮箱**：a. 统一响应，不创建重复用户; b. 有 SMTP 时发告警邮件; c. dummy hash timing alignment（响应时间与正常注册无显著差异） |
| 29 | **注册限流**：a. 三键超限 429; b. 预 IP 限流 + fail-open 降级; c. 限流阈值严于登录/reset |
| 30 | **邮箱验证消费（SMTP 模式）**：a. 正常消费 → 创建用户 + 自动登录; b. 二次使用 → `verification-expired`; c. 过期 → `verification-expired`; d. 坏 JSON → `verification-expired` |
| 31 | **验证期间 TOCTOU**：a. SSO 创建同邮箱用户后验证 → 查重拒绝; b. 并发注册同邮箱 → 只一个成功（唯一约束） |
| 32 | **开关**：a. `PASSWORD_REGISTRATION_ENABLED=false` → 404; b. `PASSWORD_AUTH_ENABLED=false` → 404; c. `isCloudHosted` → 404 |
| 33 | **Schema strict + CSRF**：a. 额外字段被拒; b. `query: {token: ...}` 被拒; c. 缺少必填字段 400; d. password < 12 chars 400 |

---

## 10. 后续演进（不在首版）

- Team 级开关（登录 + 注册分别控制）
- 路径 B：管理后台一次性 set-password 链接（+1–2 天）
- Reset 成功后自动登录（显式 tradeoff）
- 注册验证码（CAPTCHA）——开放注册场景下防机器人
- 注册审批流（admin approval queue）——介于开放注册与 inviteRequired 之间
- 匿名请求的 route-level CSRF
- `/auth` 全局层拦截 query token
- `passwordChangedAt` 审计展示字段
- 密码强度增强：zxcvbn / HIBP

---

## 11. 发布、回滚与长期维护

- 登录功能由 `PASSWORD_AUTH_ENABLED && !isCloudHosted` 包住；注册额外需 `PASSWORD_REGISTRATION_ENABLED`。均默认关闭，关闭即回到纯 SSO。
- 注册可独立关闭（关闭注册不影响已有密码用户的登录/改密）。
- migration 写好 `down`，不影响存量数据。
- 改动集中在 `plugins/password/`，侵入式修改仅 8 个现有文件，rebase 冲突面小。
- 建议以独立分支 / patch 系列管理。

---

## 12. 工作量估算

| 模块 | 估时 |
|---|---|
| 数据层（argon2 + migration + 模型 + User 方法） | 0.5 – 1 天 |
| 服务端插件（env + cloud guard + 3 端点 + 事务 + 限流 + token 消费链） | 3 – 4 天 |
| 注册 + 验证端点（§5.6/§5.7 + schema + 限流 + Redis 存储）**[new]** | 1.5 – 2 天 |
| 注册邮件模板（验证 + 告警）**[new]** | 0.5 天 |
| CLI 脚本 | 0.5 天 |
| 前端（登录分支 + 注册表单 + 忘记密码 + /reset-password + /verify-email + 设置页） | 2 – 3 天 |
| 测试（33 项）与安全打磨 | 2.5 – 3.5 天 |
| 联调、评审与 rebase 演练 | 0.5 – 1 天 |
| **合计** | **11 – 15.5 人日** |
| （后续）路径 B：管理后台一次性链接 | +1 – 2 天 |

---

## 参考文件

<details>
<summary>核心参考文件清单</summary>

- `plugins/email/server/index.ts` · `plugins/email/server/auth/email.ts`（hostname → team 三分支解析）
- `plugins/passkeys/server/index.ts`（Hook.EmailTemplate 注册形态）
- `plugins/oidc/server/index.ts` / `plugins/oidc/server/env.ts`（条件注册 + 插件本地 Environment）
- `server/routes/auth/index.ts`（provider 动态挂载 · `authMiddleware({ optional: true })` · `verifyCSRFToken()`）
- `server/models/helpers/AuthenticationHelper.ts`（providers vs providersForTeam）
- `server/middlewares/authentication.ts`（`parseAuthentication` · token 解析优先级 · transport）
- `server/middlewares/csrf.ts`（`shouldProtectRequest`）
- `server/middlewares/validate.ts` / `server/routes/api/schema.ts`（Zod 默认行为）
- `server/middlewares/transaction.ts`（`/api` 使用、`/auth` 不使用）
- `server/utils/authentication.ts`（`signIn` 签名 · cookie 参数 · suspended 重定向）
- `server/models/User.ts`（`rotateJwtSecret` · `getEmailSigninToken` · `updateActiveAt`）
- `server/models/View.ts`（原子 increment 先例）
- `server/models/base/Model.ts`（`insertEvent` · changeset）
- `server/utils/jwt.ts`（无 default export · `getJWTPayload`）
- `server/env.ts`（`isCloudHosted` · `EMAIL_ENABLED`）
- `server/routes/api/auth/auth.ts`（`auth.delete` 事务先例）
- `app/utils/ApiClient.ts`（`baseUrl` · 401 → logout · 503 映射）
- `app/scenes/Login/components/AuthenticationProvider.tsx`（passkeys native form · `baseUrl: "/auth"`）
- `app/scenes/Login/components/Notices.tsx`（notice switch）
- `server/middlewares/rateLimiter.ts` · `server/scripts/reset-encrypted-data.ts`
- `server/commands/userProvisioner.ts`（用户创建流程 · `inviteRequired` / `isDomainAllowed` 检查先例）
- `server/commands/accountProvisioner.ts`（`provisionFirstCollection` · `AuthenticationResult`）
- `server/models/Team.ts`（`defaultUserRole` · `inviteRequired` · `isDomainAllowed`）

</details>
