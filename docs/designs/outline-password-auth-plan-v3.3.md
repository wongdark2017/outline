# Outline 邮箱 + 密码登录功能 — 技术方案 v3.3

> 目标:在自托管的 Outline(fork)中新增"邮箱 + 密码"登录方式。
> 状态:设计稿 v3.3(五轮代码评审后,评审结论:可以落地,按本版执行)· 适用版本:outline/outline main 分支(2026 上半年)
> 前稿:`outline-password-auth-plan-v3.md`(v3 / v3.1)、`outline-password-auth-plan-v3.2.md`。本稿为独立全文,以本稿为准。

## 变更记录

**v3.2 → v3.3(本轮)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1 | reset token 只明确携带 `jti` / `teamId`,没有明确目标 `userId`,消费端"给哪个用户设密"来源不清 | §5.2 写清完整 payload `{ type, id(userId), teamId, jti, createdAt }`,照搬现有 `getEmailSigninToken` 形态用 `user.jwtSecret` 签名;Redis 的 jti value 显式存 `{ userId, teamId }`,消费时双向核对(§5.3) |
| 2 | migration 只写了 3 字段,但没写 `server/models/User.ts` 要新增 3 个 `@Column` 属性;`User` 是 sequelize-typescript + `InferAttributes<User>`,不加模型属性会卡类型/运行时映射 | §4 补模型字段声明(`@Column` / `@IsDate` / `@Default` / `@SkipChangeset`,对照现有 `lastSigninEmailSentAt` 等写法) |
| 3 | §5.4 / §8 仍说 `providersForTeam` 用 env-only 布尔控制可见性——会让 core server 反向依赖插件 env,且条件注册后没有必要 | §5.4 / §5.5 / §8 改写:可见性完全由条件注册决定;**核对代码后确认 password 在 `providersForTeam` 现有 self-host 默认分支(`authProvider?.enabled !== false`)下天然可见,core 零修改**,最多加排序微调(可选) |
| 4 | `plugins/password/server/env.ts` 示例不完整,缺 imports 与 `export default new …()`,照抄会漏导出 | §5.5 给出完整文件骨架(imports + 类 + 实例导出,对照 `plugins/oidc/server/env.ts` 尾部的 `export default new OIDCPluginEnvironment()`) |

**v3.1 → v3.2(上轮,已收口)**:`Hook.AuthProvider` 改条件注册(可达性,参照 oidc)+ 端点 env 兜底;登录/reset 先按 hostname 解析 team 再 `{teamId, email}` 查用户(email 非全局唯一);`signIn` result 补必填 `isNewUser: false`;`PASSWORD_AUTH_ENABLED` 放插件本地 env;补 `yarn add argon2` 依赖步骤。

**v3 → v3.1(更早,已收口)**:`signIn(ctx, service, result)` 签名修正且 result 带 `client`;native form 补 CSRF hidden input(`/auth` app 全局 `verifyCSRFToken()`);suspended 在调用 `signIn` 前预检查、按推导域名回跳;失败改为 redirect `?notice=password-auth-failed` / `password-locked` 并新增 `Notices.tsx` 文案;"忘记密码"可见性复用 `@Public` 的 `env.EMAIL_ENABLED`。

**v2 → v3(更早,已收口)**:路由改路径风格(`/auth/password[/reset|/update]`);注册 `Hook.EmailTemplate`;CLI 脚本改 `server/scripts/set-password.ts`;删除 `passwordChangedAt`;team 级开关移入后续演进(首版 env-only);失败回跳覆盖三种入口域名;新字段不复用历史 `passwordDigest` 命名。

**v1 → v2(最早,已收口)**:provider 迁移到 `plugins/password/` 插件机制;`auth.config` 修正为 RPC POST + `{id, name, authUrl}`;async setter 改为显式异步方法;新增无 SMTP 初始化路径;专用三键限流;`NON_SSO_SERVICES` 对接;会话吊销改用 `rotateJwtSecret()`。

---

## 1. 背景与前提

Outline 官方刻意不提供密码登录,认证完全委托给外部 Provider,这是出于安全考虑的产品决策。由此:

1. **该功能上游不会合并**,属于 fork 级改动,需要长期自己维护(BSL 1.1 允许自托管修改,无合规问题)。
2. 密码体系的"找回/首次设密"默认依赖邮件。**无 SMTP 部署必须实现 §6 的非邮件初始化路径,并禁用"忘记密码"入口**。

## 2. 零代码替代方案(建议先评估)

| 方案 | 说明 | 适用场景 |
|---|---|---|
| SMTP 魔法链接 | 内置邮箱登录:输入邮箱 → 收一次性登录链接 | 有 SMTP、能接受无密码流程 |
| 前置 IdP(推荐) | Keycloak / Authentik 走 OIDC,密码、MFA、找回全套都有 | 愿意多维护一个轻量服务 |

确认都不满足(典型:内网无 SMTP 且不想加服务)再实施本方案,并按 §6 选定密码初始化方式。

## 3. 总体设计

**核心原则:以 `plugins/password` 插件的身份加入 Provider 体系,复用 `signIn`、cookie、审计与登录页配置。**

当前代码中 auth provider 是插件注册制:

```
plugins/<name>/plugin.json                  ← 插件声明
plugins/<name>/server/index.ts              ← PluginManager.add([{ type: Hook.AuthProvider, … },
                                                                  { type: Hook.EmailTemplate, … }])
server/routes/auth/index.ts                 ← 遍历 AuthenticationHelper.providers(全量已注册 hook),
                                               动态挂载到 /auth/<id>
```

> **注意**:路由挂载读的是 `AuthenticationHelper.providers`——即 `PluginManager.getHooks(Hook.AuthProvider)` 全量列表(`server/models/helpers/AuthenticationHelper.ts:16`);`providersForTeam` 只用于 `auth.config` 的登录页展示过滤。**"注册了就可达"**,因此开关必须控制注册本身,见 §5.5。

前端取数:`app/stores/AuthStore.ts` 调用 **`client.post("/auth.config")`**(RPC 风格,均为 POST),服务端经 `server/presenters/providerConfig.ts` 返回 `{ id, name, authUrl }`。email 与 passkeys 没有 `authUrl`,在 `app/scenes/Login/components/AuthenticationProvider.tsx` 中是**硬编码的特殊分支**——password 照此模式做第三个分支。

### 改动文件总览

```
plugins/password/plugin.json                          ★ 插件声明
plugins/password/server/index.ts                      ★ 条件注册 Hook.AuthProvider + Hook.EmailTemplate(参照 oidc)
plugins/password/server/env.ts                        ★ 插件本地 env:PASSWORD_AUTH_ENABLED(完整骨架见 §5.5)
plugins/password/server/auth/password.ts              ★ 路由:登录 / reset / update
plugins/password/server/auth/schema.ts                ★ zod 校验 schema
plugins/password/server/auth/password.test.ts         ★ 集成测试
plugins/password/server/email/PasswordResetEmail.tsx  ★ 找回邮件模板(经 Hook 注册)
server/migrations/XXXX-add-user-password.js           ★ 数据库迁移(3 字段)
server/models/User.ts                                 ✎ 3 个 @Column 字段声明 + setPassword / verifyPassword /
                                                        getPasswordResetToken 方法(§4、§5.2)
server/routes/api/auth/auth.ts                        ✎ NON_SSO_SERVICES 加入 "password"
server/scripts/set-password.ts                        ★ 无 SMTP 初始化路径(§6)
package.json                                          ✎ 新增 argon2 依赖 + yarn script(yarn 安装,更新 yarn.lock)
app/scenes/Login/components/AuthenticationProvider.tsx ✎ id === "password" 分支
app/scenes/Login/components/Notices.tsx               ✎ 新增 password-auth-failed / password-locked 文案
app/scenes/Settings/(个人 Profile/Preferences)        ★ 修改密码卡片
server/models/helpers/AuthenticationHelper.ts         ✎(可选)providersForTeam 排序微调,见 §5.4——非必需,
                                                        默认分支已天然兼容
```

> 侵入式修改集中在 5 个现有文件(`package.json` 与可选的 `AuthenticationHelper.ts` 之外),其余均在 `plugins/password/` 与独立脚本——rebase 上游时冲突面小且位置固定。`server/env.ts` **不修改**:`PASSWORD_AUTH_ENABLED` 按 OIDC 先例放插件本地 env(§5.5)。

## 4. 数据层

**新增依赖**:当前 `package.json` / `yarn.lock` 没有 `argon2`,实现第一步:

```bash
yarn add argon2   # 原生模块,确认构建镜像有 prebuilt 二进制或编译工具链;装完提交 package.json + yarn.lock
```

migration 在 `users` 表上新增 **3 个字段**(均 nullable / 带默认值,不影响存量数据):

| 字段 | 类型 | 用途 |
|---|---|---|
| `passwordHash` | TEXT, nullable | 为 null 表示该用户仅可走 SSO |
| `failedSignInAttempts` | INTEGER, default 0 | 连续失败计数 |
| `lockedUntil` | TIMESTAMP, nullable | 账号锁定截止时间 |

**模型字段声明(v3.3,必须与 migration 配套)**:`User` 模型是 `sequelize-typescript` 声明式 + `InferAttributes<User>` 类型推导(`server/models/User.ts:137`),只加 migration 不加模型属性,`this.passwordHash` 等访问处过不了类型检查,运行时也没有列映射。在 `server/models/User.ts` 字段区(对照现有 `lastSigninEmailSentAt` 等写法)新增:

```ts
@Column(DataType.TEXT)
passwordHash: string | null;

@Default(0)
@Column(DataType.INTEGER)
@SkipChangeset
failedSignInAttempts: number;

@IsDate
@Column
@SkipChangeset
lockedUntil: Date | null;
```

> `failedSignInAttempts` / `lockedUntil` 标 `@SkipChangeset`,避免登录失败计数进入 events/changeset 噪音;`passwordHash` 不标——改密本身要出现在 `users.update` 审计里(§5.3),但 presenter 序列化必须排除该字段,确保哈希永不出现在 API 响应与 events payload(§8)。

> **v3 变更**:删除 v2 的 `passwordChangedAt`。会话吊销由 `rotateJwtSecret()` 承担,reset token 一次性由 jti + Redis 承担,该字段职责已空心化;若未来需要"上次修改密码时间"的审计展示,再以纯展示字段加回,不参与任何鉴权(见 §10)。
>
> **历史提醒**:仓库历史上存在过密码字段——`passwordDigest` 由 `server/migrations/20160911234928-user-password.js` 添加、`20180707231201-remove-passwords.js` 删除。新字段命名为 `passwordHash`,**不要复用旧字段名**,写迁移时也确认与这两个历史 migration 无相互影响。

`server/models/User.ts` 增加显式异步方法:

```ts
async setPassword(plain: string) {
  this.passwordHash = await argon2.hash(plain, { type: argon2.argon2id }); // OWASP 推荐参数
}

async verifyPassword(plain: string): Promise<boolean> {
  if (!this.passwordHash) {
    await argon2.verify(DUMMY_HASH, plain); // 对无密码用户做假校验,抹平时序差异
    return false;
  }
  return argon2.verify(this.passwordHash, plain);
}
```

`DUMMY_HASH` 为模块级常量(对固定随机串预计算的 argon2 哈希),保证"用户不存在 / 无密码"与"密码错误"两条路径耗时一致。

## 5. 服务端(plugins/password)

### 5.0 路由命名

三个端点采用**路径风格**,不沿用 auth router 里的点号 RPC 风格:

```
POST /auth/password           登录
POST /auth/password/reset     发起找回
POST /auth/password/update    设置 / 重置密码
```

理由:`email.callback` 那类点号命名是单一路径下 callback 的特例;密码生命周期是一组接口,路径风格更稳定,也避免把 API 层的 RPC 风格混进 auth router。另外 `shared/utils/domains.ts` 已将 `"password"` 列为保留子路径词,路由命名无冲突。

### 5.1 `POST /auth/password` — 登录

1. `schema.ts` 中的 zod schema 校验 `email` / `password` / `client`(邮箱小写归一;`client` 取值 `Client.Web` / `Client.Desktop`,由表单 hidden input 提交,见 §7)。
2. **专用限流器**(现有 `rateLimiter` 只支持按已登录用户或 IP 单键):基于同一套 RateLimiterRedis 新建 password 专用 limiter,**分别 consume `ip`、`emailHash`、`ip:emailHash` 三个 key**,任一超限即 429。emailHash 避免把明文邮箱写进 Redis key。
3. **先解析 team,再按 team 作用域查用户(必须做)**:Outline 的 `users.email` 自 `20170712055148-non-unique-email.js` 起**不是全局唯一**,同一邮箱可存在于多个 workspace。照搬现有 email 登录的解析逻辑(`plugins/email/server/auth/email.ts:31`):
   - self-host(`!env.isCloudHosted`)→ `Team.findOne()`(单租户);
   - 自定义域名(`domain.custom`)→ 按 `domain` 查;
   - 子域名(`domain.teamSubdomain`)→ 按 `subdomain` 查;
   - team 不存在或 password provider 对该 team 不可用 → 拒绝。
   然后 **`User.findOne({ where: { teamId: team.id, email } })`**,禁止只按 email 全局查询。
4. 检查 `lockedUntil`。**suspended 预检查**:`signIn` 内部对 `team.isSuspended` / `user.isSuspended` 是硬编码 `ctx.redirect("/?notice=…")` 根路径(`server/utils/authentication.ts:38`),在子域名 / 自定义域名入口会把用户踢回错误域名。因此 password 路由在调用 `signIn` **之前**自行检查这两个状态,命中时按 §7 的域名推导规则回跳 `?notice=team-suspended` / `?notice=user-suspended`(复用 `Notices.tsx` 已有文案),确保 `signIn` 内部分支不会被触发。
5. `user.verifyPassword(password)`(用户不存在时仍走 dummy verify):
   - 失败 → 对存在的用户 `failedSignInAttempts += 1`,达到阈值(如 5 次)置 `lockedUntil = now + 15min`;**redirect 回登录页 `?notice=password-auth-failed`**(锁定中为 `?notice=password-locked`),前端展示模糊文案「邮箱或密码不正确」,不区分"用户不存在/无密码/密码错"。native form POST 场景下用 redirect 而非 JSON 错误,与 §7 的回跳域名推导配合。
   - 成功 → 清零计数,调用 **`signIn(ctx, "password", { user, team, client, isNewTeam: false, isNewUser: false })`**——注意三点:实际签名是 `signIn(ctx, service, result)`,`service` 是独立的第二参数;`AuthenticationResult = AccountProvisionerResult & { client }`,其中 `user` / `team` / `isNewTeam` / `isNewUser` **四个字段全部必填**(`server/commands/accountProvisioner.ts:80`、`server/types.ts:53`),缺 `isNewUser` 过不了编译;`client` 决定 Desktop 场景的 `desktop-redirect` 分支(`server/utils/authentication.ts:31`)。由其完成 cookie、`users.signin` 审计事件与重定向。

### 5.2 `POST /auth/password/reset` — 发起找回(依赖 SMTP)

- **team 作用域**:与 §5.1 第 3 步同样先按 hostname 解析 team,再 `{teamId, email}` 查用户;否则同邮箱多 workspace 场景会把 A workspace 的 reset 发给 B workspace 的同名账号,造成串账号。
- 无论邮箱是否存在都返回成功(防枚举)。
- **token 形态(v3.3 写死,实现勿自创)**:照搬现有 `User.getEmailSigninToken` 的形态(`server/models/User.ts:665`——payload 含 `id` + `type` + `createdAt`,用 **`user.jwtSecret`** 签名),在 `User` 上新增 `getPasswordResetToken()`:

  ```ts
  // server/models/User.ts
  getPasswordResetToken = () =>
    JWT.sign(
      {
        id: this.id,            // 目标 userId —— 消费端"给谁设密"的唯一来源
        teamId: this.teamId,    // 与请求 hostname 解析出的 team 核对
        type: "password-reset",
        createdAt: new Date().toISOString(),
        jti: crypto.randomUUID(),
      },
      this.jwtSecret
    );
  ```

  同时把 `jti` 写入 Redis,**value 显式存 `{ userId, teamId }`**、15 分钟 TTL:键的存在性提供一次性消费,value 提供与 token 声明的交叉核对。用 `user.jwtSecret` 签名的额外收益:§5.3 改密成功后 `rotateJwtSecret()` 会让同一用户所有未消费的 reset token 一并失效。
- 经现有 mailer 队列发送 `PasswordResetEmail`(链接域名用 `team.url` 拼,不用根域)。**注意**:模板文件在插件目录内,要走 `.schedule()` 队列链路就必须在 `plugins/password/server/index.ts` 注册 **`Hook.EmailTemplate`**(参照 `plugins/passkeys/server/index.ts`)——`EmailTask` 是按模板名从注册表(`server/emails/templates/index.ts`)取类的,不注册则队列侧找不到模板。
- 未配置 SMTP 时:端点返回明确的 unavailable 错误,前端隐藏"忘记密码"入口,改走 §6。判断口径统一用 `env.EMAIL_ENABLED`(`server/env.ts:401`,已是 `@Public` 公共布尔,前后端同一语义,见 §7)。

### 5.3 `POST /auth/password/update` — 设置 / 重置密码

- 鉴权两选一:
  1. **reset token 路径(消费顺序 v3.3 写死)**:参照 `getUserForEmailSigninToken` 的验证形态(`server/utils/jwt.ts:99`):
     1. `getJWTPayload(token)` 解出 payload,校验 `type === "password-reset"` 与 `createdAt` 未超 15 分钟;
     2. 按 hostname 解析当前 team(§5.1 第 3 步同口径),校验 `payload.teamId === team.id`;
     3. **`User.findOne({ where: { id: payload.id, teamId: team.id } })` 取目标用户**——目标用户来源只能是 token 的 `id` 声明,请求体不传、也不接受 email 参数;
     4. `JWT.verify(token, user.jwtSecret)` 验签;
     5. 原子消费 Redis 中的 `jti`(GETDEL / Lua),并核对 value 中的 `{ userId, teamId }` 与 payload 一致;任一步失败即拒绝,jti 已消费即拒绝。
  2. **登录态路径**:当前 session + 提交当前密码(`verifyPassword` 通过才允许改)。
- 密码策略:最少 12 位。
- 落库 `setPassword()` 后,**调用 `user.rotateJwtSecret()`** 使该用户全部旧 JWT 失效(含其余未消费的 reset token,见 §5.2),然后要求重新登录、或当场重新 `signIn` 签发当前会话。
- 写 `users.update` 审计事件;有 SMTP 时给用户发"密码已修改"通知邮件。

### 5.4 与现有认证体系的对接(易漏,必须做)

1. **`server/routes/api/auth/auth.ts` 的 `NON_SSO_SERVICES`**:加入 `"password"`,否则 `auth.info` 会把密码登录的 session 当作 SSO session 处理。
2. **`AuthenticationHelper.providersForTeam`——core 零修改(v3.3 核对)**:password 的可见性**完全由 §5.5 的条件注册决定**,core 不读插件 env(避免 core → 插件的反向依赖)。已核对 `providersForTeam` 现有默认分支(`server/models/helpers/AuthenticationHelper.ts:70`):对非 email / passkeys 的 provider,self-host 下条件是 `!isCloudHosted && authProvider?.enabled !== false`——password 没有对应的 `team.authenticationProviders` 记录,`authProvider` 为 `undefined`,`undefined !== false` 为 true,**注册即天然可见,无需任何特判**(cloud-hosted 下同理天然隐藏,与"首版严格 self-host"一致)。唯一可选项:现有 sort 把 email / passkeys 排在末尾,password 若想挨着 email 展示可在 sort 中加一行——纯展示微调,不做也不影响功能。
3. **`plugins/password/server/index.ts` 注册 `Hook.EmailTemplate`**(见 §5.2)。

### 5.5 开关策略

`PASSWORD_AUTH_ENABLED`,**默认 false**;首版严格 self-host、env-only。两处落点:

1. **env 定义——插件本地,不动 `server/env.ts`**:参照 OIDC 先例(`plugins/oidc/server/env.ts`),新增 `plugins/password/server/env.ts`。**完整文件骨架(v3.3,照此实现,勿漏尾部实例导出)**:

   ```ts
   import { IsBoolean } from "class-validator";
   import { Environment } from "@server/env";
   import environment from "@server/utils/environment";

   class PasswordPluginEnvironment extends Environment {
     /**
      * Enables email + password authentication. Self-hosted only.
      */
     @IsBoolean()
     public PASSWORD_AUTH_ENABLED = this.toBoolean(
       environment.PASSWORD_AUTH_ENABLED ?? "false"
     );
   }

   export default new PasswordPluginEnvironment();
   ```

   类型化定义、默认 false、布尔校验、实例导出四者齐备,插件内 `import env from "./env"` 后 `env.PASSWORD_AUTH_ENABLED` 编译可过;不标 `@Public`(前端不读它,见下)。
2. **条件注册——开关控制可达性(关键)**:`/auth` 路由挂载遍历的是 `AuthenticationHelper.providers` 全量 hook(`server/routes/auth/index.ts:23` → `PluginManager.getHooks(Hook.AuthProvider)`),与 `providersForTeam` 无关——**只要注册了 `Hook.AuthProvider`,`/auth/password` 就可达**。因此照搬 OIDC 的形态(`plugins/oidc/server/index.ts`:配置不满足则整个 `PluginManager.add` 不执行):

   ```ts
   if (env.PASSWORD_AUTH_ENABLED) {
     PluginManager.add([
       { ...config, type: Hook.AuthProvider, value: { router, id: config.id } },
       { type: Hook.EmailTemplate, value: PasswordResetEmail },
     ]);
   }
   ```

   关闭时路由根本不挂载(POST 得 404),`providersForTeam` 也自然看不到它,登录页与端点一致;开启时按 §5.4 第 2 条,core 无需任何配合修改。
3. **端点入口兜底**:三个端点处理器开头再各加一次 `env.PASSWORD_AUTH_ENABLED` 检查(false 即 404/403)。正常情况下不会走到(未注册即不可达),作为防御纵深保留,防止未来重构改变注册时机后开关失效。

前端不直接读取该变量——provider 可见性由条件注册经 `providersForTeam` / `auth.config` 自然传导到登录页。env 是进程启动时读取的,改开关需重启,这与现有 OIDC 等插件行为一致。team 级开关整体移入 §10 后续演进,主路径不保留相关表述。

## 6. 无 SMTP 环境的密码初始化与找回

| 路径 | 形态 | 说明 |
|---|---|---|
| A. 服务器 CLI(v1 推荐) | `server/scripts/set-password.ts`,package.json 增加 yarn script,构建产物为 `build/server/scripts/set-password.js` | 管理员在服务器为用户设密/重置;半天实现,覆盖初始化与找回(现有脚本如 `server/scripts/reset-encrypted-data.ts` 即此形态)。多 workspace 场景下脚本参数需含 team 标识(子域名或 teamId),按 `{teamId, email}` 定位用户(§5.1 同口径) |
| B. 管理后台一次性链接 | 用户管理页生成 set-password 链接(复用 §5.2 的 jti token) | 体验更好,需新增管理 UI 与权限;+1–2 天,列入 §10 |
| C. Bootstrap token | 环境变量注入一次性 token | 只解决首个管理员冷启动 |

v1 落地:**实现 A + 无 SMTP 时禁用忘记密码 UI**。

## 7. 前端

- **登录页**:在 `AuthenticationProvider.tsx` 新增 `id === "password"` 硬编码分支(与 email / passkeys 同构):邮箱 + 密码输入框,**native form POST 到 `/auth/password`**(参照 passkeys),让 `signIn` 的 302 + Set-Cookie 行为最自然。
- **CSRF 与 client 字段(必须做)**:`/auth` app 在 router 之前全局挂了 `verifyCSRFToken()`(`server/routes/auth/index.ts:94`),passkeys 的 native form 提交前会注入 `[CSRF.fieldName]: getCookie(CSRF.cookieName)` hidden input(`AuthenticationProvider.tsx:117`)。password 表单**同样必须带这个 CSRF hidden input**,否则已有 CSRF cookie 的场景下 POST 会 403。同时带 `client` hidden input(`Desktop.isElectron() ? Client.Desktop : Client.Web`,passkeys 同款逻辑),供服务端传入 `signIn` 的 `AuthenticationResult`。
- **失败回跳**:登录页 notice 机制是 query-string 驱动的,但登录入口存在三种形态——team 子域名、自定义域名、self-host 根域。后端失败重定向**禁止硬编码根路径**,目标 URL 必须由**当前 team.url / 请求 hostname 推导**后再拼 `?notice=…`,否则会把用户踢回错误域名(`signIn` 内部的 suspended 根路径重定向即反例,已由 §5.1 预检查绕开)。
- **Notices 文案**:`app/scenes/Login/components/Notices.tsx` 的 `Message` switch 当前没有 password 相关 case,未注册的 notice 会落到默认的 "unknown error"。需新增两个 case:
  - `password-auth-failed` → 「邮箱或密码不正确。」(模糊文案,不区分用户不存在/密码错)
  - `password-locked` → 「登录失败次数过多,账号已临时锁定,请稍后再试。」
- **"忘记密码"链接**:仅在 SMTP 可用时渲染,判断直接复用现成的 **`env.EMAIL_ENABLED`**(`server/env.ts:401`,已标 `@Public`,前端经 public env 可读),服务端 §5.2 的 unavailable 判断用同一布尔,前后端口径一致。
- **设置页**:修改密码卡片放**个人 Profile / Preferences**,不放团队 Security。
- **i18n**:代码中只写 `t("…")` / `<Trans>`,locale 文件由工具自动提取,不要手改。

## 8. 安全清单(实现时逐条对照)

- [ ] 哈希用 argon2id(`argon2` 包,**先 `yarn add argon2` 更新 lockfile**),禁止自拼 crypto 原语。
- [ ] 登录失败统一模糊 notice(`password-auth-failed`);不存在的用户走 dummy hash verify,抹平时序枚举。
- [ ] 专用限流器三键 consume(`ip` / `emailHash` / `ip:emailHash`)+ 账号锁定,双层防爆破。
- [ ] **用户查询必须 team 作用域**:先按 hostname 解析 team,再 `{teamId, email}` 查;登录、reset、update、CLI 脚本四处同口径,杜绝同邮箱跨 workspace 串账号。
- [ ] reset token:payload `{ id(userId), teamId, type: "password-reset", createdAt, jti }`,`user.jwtSecret` 签名,15 分钟;jti 入 Redis、value 存 `{ userId, teamId }`、原子一次性消费并交叉核对;**目标用户只能来自 token 的 `id` 声明**,update 请求体不接受 email/userId 参数。
- [ ] 改密成功调用 `rotateJwtSecret()` 吊销全部旧会话(含未消费的 reset token),并重新签发/要求重登。
- [ ] 改密成功发邮件通知(SMTP 可用时)。
- [ ] 密码明文永不进入日志与 events payload;`passwordHash` 不进任何 presenter 序列化输出。
- [ ] `"password"` 加入 `NON_SSO_SERVICES`,避免被当作 SSO session。
- [ ] **`PASSWORD_AUTH_ENABLED=false` 时 `Hook.AuthProvider` 不注册,`POST /auth/password` 不可达(404)**;端点内再做 env 兜底检查,双层防护。
- [ ] `providersForTeam` **零修改**(core 不读插件 env),可见性由条件注册传导;可选排序微调不引入开关逻辑。
- [ ] `passwordHash` 为 null 的 SSO 用户走密码登录 → 拒绝,且耗时与密码错误一致。
- [ ] 失败回跳目标由 team.url / 请求 hostname 推导,覆盖子域名 / 自定义域名 / 根域三种入口。
- [ ] suspended(team / user)在调用 `signIn` 前预检查并按推导域名回跳,绕开 `signIn` 内部的根路径硬编码重定向。
- [ ] native form 提交携带 CSRF hidden input(`CSRF.fieldName` ← `CSRF.cookieName`),通过 `/auth` app 全局 `verifyCSRFToken()`。

## 9. 测试(plugins/password/server/auth/password.test.ts)

1. `auth.config` 在开关开/关时正确暴露/隐藏 password provider;
2. **`PASSWORD_AUTH_ENABLED=false` 时 `POST /auth/password` 不可达**(路由未注册,404);开启后可达;
3. 正确密码登录成功,cookie 与 `users.signin` 审计事件正确(`signIn(ctx, "password", …)` 形参与 `client` 传递正确,Web / Desktop 两种 client 的重定向分支);
4. **同邮箱多 workspace 隔离**:两个 team 各有同邮箱用户、密码不同,从 A 入口用 B 的密码登录被拒,从各自入口用各自密码登录成功且会话归属正确;reset 流程同样只命中当前 team 的用户;
5. 错误密码:redirect 到 `?notice=password-auth-failed` + 计数递增;用户不存在时响应与耗时形态一致;
6. 连续失败触发锁定(redirect `?notice=password-locked`),锁定期内正确密码也被拒,到期解锁;
7. 三键限流任一超限返回 429;
8. reset token:正常消费一次成功且**改的是 token `id` 声明的那个用户**;二次使用被拒(jti 已消费);过期被拒;`teamId` 不匹配当前请求解析出的 team 被拒;Redis value 与 payload 不一致被拒;update 请求体附带的 email/userId 参数被忽略或拒绝;
9. 改密后旧 cookie 全部失效(`rotateJwtSecret` 生效),该用户其余未消费 reset token 同时失效,新登录正常;
10. SSO-only 用户(`passwordHash = null`)被拒;
11. suspended:`user.isSuspended` / `team.isSuspended` 均在 `signIn` 前被拒,且回跳到发起请求的正确域名(不落到根路径);
12. 无 SMTP 配置(`EMAIL_ENABLED = false`)时 `/auth/password/reset` 返回 unavailable,前端"忘记密码"入口隐藏;
13. 登录失败时重定向到发起请求的正确域名(子域名 / 自定义域名 / 根域三种入口);
14. 缺少 / 错误 CSRF 字段的 POST 被 `verifyCSRFToken()` 拒绝,携带正确 hidden input 的表单提交通过;
15. 前端 `Notices.tsx`:`password-auth-failed` / `password-locked` 渲染对应文案,不落入 unknown error 默认分支;
16. API 响应与 events payload 中不出现 `passwordHash`(presenter 排除生效)。

> 测试 1 / 2 涉及 env 开关与模块级条件注册,注意 `PluginManager.add` 发生在模块加载时——用例需通过隔离模块加载或测试专用 env 注入实现两种状态,参照现有插件测试对 env 的 mock 方式。

## 10. 后续演进(明确不在首版)

- **team 级开关**:待确有多团队差异化需求时再做,届时评估写入 Team 字段还是 preferences,避免首版过度抽象。
- **路径 B:管理后台一次性 set-password 链接**(+1–2 天)。
- **`passwordChangedAt` 审计展示字段**:纯展示用途,不参与鉴权。
- 密码强度增强:zxcvbn / HIBP 泄露库比对。

## 11. 发布、回滚与长期维护

- 功能由 `PASSWORD_AUTH_ENABLED` 包住,默认关闭;关闭时插件不注册、路由不可达,即回到纯 SSO,无需回滚代码。
- migration 写好 `down`,3 个字段全部 nullable,不影响存量数据。
- 改动集中在 `plugins/password/` 独立目录与 `server/scripts/`,侵入式修改仅 5–6 个现有文件——rebase 上游冲突面小且位置固定。
- 建议以独立分支 / patch 系列管理,跟随上游升级。

## 12. 工作量估算

| 模块 | 估时 |
|---|---|
| 数据层(argon2 依赖 + migration + 模型字段 + User 方法 + dummy hash) | 0.5 – 1 天 |
| 服务端插件(本地 env + 条件注册 ×2 Hook + 3 端点 + team 作用域 + reset token 消费链 + 专用限流 + 对接) | 2.5 – 3.5 天 |
| CLI 脚本 + yarn script | 0.5 天 |
| 前端(登录分支 native form + 回跳域名推导 + 个人设置卡片) | 1 – 1.5 天 |
| 测试(16 项)与安全打磨 | 1.5 – 2.5 天 |
| 联调、评审与 rebase 演练 | 0.5 – 1 天 |
| **合计** | **6.5 – 10 人日** |
| (后续)路径 B:管理后台一次性链接 | +1 – 2 天 |

---

*核心参考文件:`plugins/email/server/index.ts` · `plugins/email/server/auth/email.ts`(hostname → team 三分支解析 + `{teamId, email}` 查询)· `plugins/passkeys/server/index.ts`(Hook.EmailTemplate 注册形态)· `plugins/oidc/server/index.ts` / `plugins/oidc/server/env.ts`(条件注册 + 插件本地 Environment 子类与 `export default new …()` 先例)· `server/routes/auth/index.ts`(provider 经 `AuthenticationHelper.providers` 全量动态挂载 + 全局 `verifyCSRFToken()`)· `server/models/helpers/AuthenticationHelper.ts`(providers vs providersForTeam 职责差异、self-host 默认分支)· `server/utils/authentication.ts` / `server/types.ts` / `server/commands/accountProvisioner.ts`(`signIn(ctx, service, result)` 签名、`AuthenticationResult` 四必填字段 + `client`、suspended 根路径重定向)· `server/models/User.ts`(`@Column` 字段声明形态、`getEmailSigninToken` payload 先例、rotateJwtSecret)· `server/utils/jwt.ts`(`getUserForEmailSigninToken` 验证链先例)· `app/scenes/Login/components/AuthenticationProvider.tsx`(passkeys native form 的 CSRF / client hidden input 形态)· `app/scenes/Login/components/Notices.tsx`(notice switch)· `server/emails/templates/index.ts` / `server/queues/tasks/EmailTask.ts`(模板注册表与队列取类)· `app/stores/AuthStore.ts` / `server/presenters/providerConfig.ts` · `server/middlewares/rateLimiter.ts` · `server/env.ts`(`EMAIL_ENABLED` @Public、`toBoolean`)· `server/scripts/reset-encrypted-data.ts`(脚本形态)· `shared/utils/domains.ts`(parseDomain / 保留词)· `server/migrations/20170712055148-non-unique-email.js`(email 非全局唯一)· `server/migrations/20160911234928` / `20180707231201`(passwordDigest 历史)。*
