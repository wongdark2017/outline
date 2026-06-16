# Outline 邮箱 + 密码登录功能 — 技术方案 v3.1

> 目标:在自托管的 Outline(fork)中新增"邮箱 + 密码"登录方式。
> 状态:设计稿 v3.1(三轮代码评审后,评审结论:可以落地,按本版执行)· 适用版本:outline/outline main 分支(2026 上半年)

## 变更记录

**v3 → v3.1(本轮)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1 | `signIn` 调用签名写错:实际是 `signIn(ctx, service, result)`,`service` 是独立参数而非 result 对象成员;且 `AuthenticationResult` 必须带 `client`(`server/utils/authentication.ts:31`、`server/types.ts:53`) | §5.1 修正为 `signIn(ctx, "password", { user, team, client, isNewTeam: false, … })`,登录表单随之必须提交 `client` 字段(§7) |
| 2 | `/auth` app 全局挂了 `verifyCSRFToken()`,passkeys native form 会注入 `[CSRF.fieldName]: getCookie(CSRF.cookieName)` hidden input;password 表单漏了会在已有 cookie 场景下 POST 403(`server/routes/auth/index.ts:94`) | §7 明确 password 表单必须带 CSRF hidden input 与 `client` hidden input |
| 3 | `signIn` 内部对 `team.isSuspended` / `user.isSuspended` 硬编码 `ctx.redirect("/?notice=…")` 根路径,会把子域名 / 自定义域名入口踢回错误域名(`server/utils/authentication.ts:38`) | §5.1 明确:password 路由在调用 `signIn` **之前**自行检查两类 suspended 并按推导域名回跳,保证不触发 `signIn` 内部的根路径重定向 |
| 4 | "返回模糊错误"与 native form POST 不匹配,失败应 redirect 到 `?notice=…`;且 Login `Notices.tsx` 无对应 case,会显示 unknown error | §5.1 / §7 改为 redirect `?notice=password-auth-failed` / `?notice=password-locked`,新增 `Notices.tsx` 两个 case 的文案与测试(§7、§9) |
| 5 | (小建议)前端隐藏"忘记密码"直接复用现成的公共布尔 `env.EMAIL_ENABLED`(已标 `@Public`);`PASSWORD_AUTH_ENABLED` 仅服务端控制 provider 可见性即可,前端无需读取 | §5.5、§7 采纳 |

**v2 → v3(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1 | 密码生命周期接口不应在 auth router 里用点号 RPC 风格(`password.reset`),那是 `email.callback` 这类单一 callback 的特例 | 路由改为路径风格:`/auth/password`、`/auth/password/reset`、`/auth/password/update`(§5) |
| 2 | 邮件模板放插件目录又走 `.schedule()` 队列,必须注册 `Hook.EmailTemplate`,否则 `EmailTask` 按模板名取不到类 | `plugins/password/server/index.ts` 同时注册 `Hook.AuthProvider` 与 `Hook.EmailTemplate`(§5.2) |
| 3 | CLI 脚本路径不贴合仓库,现有服务端脚本在 `server/scripts/` | 改为 `server/scripts/set-password.ts` + package.json yarn script(§6) |
| 4 | reset 已切到 jti + Redis,`passwordChangedAt` 职责空心化 | **首版删除该字段**,留作后续审计展示的可选扩展(§4、§10) |
| 5 | team 级开关与 `providersForTeam` 现状(直接依赖 Team 字段/布尔逻辑)不匹配,主路径里留半悬空表述易多做抽象 | 整体移入"后续演进",首版严格 env-only(§5.5、§10) |
| 6 | native form POST 失败回跳要处理 team 子域名 / 自定义域名 / self-host 根域三种入口 | 明确"失败重定向目标由 team.url / 请求 hostname 推导"(§7,安全清单第 11 条) |
| — | 历史上存在过 `passwordDigest` 字段(2016 加、2018 删) | §4 增加历史提醒,新字段命名不复用旧名 |
| — | `shared/utils/domains.ts` 已把 "password" 列为保留子路径词 | §5 记录:路由命名无冲突,好信号 |

**v1 → v2(更早,已收口)**:provider 迁移到 `plugins/password/` 插件机制;`auth.config` 修正为 RPC POST + `{id, name, authUrl}`;async setter 改为显式异步方法;新增无 SMTP 初始化路径;专用三键限流;`NON_SSO_SERVICES` 对接;会话吊销改用 `rotateJwtSecret()`;估时上调至 6–9 人日。

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
server/routes/auth/index.ts                 ← 遍历已注册插件,动态挂载到 /auth/<id>
```

前端取数:`app/stores/AuthStore.ts` 调用 **`client.post("/auth.config")`**(RPC 风格,均为 POST),服务端经 `server/presenters/providerConfig.ts` 返回 `{ id, name, authUrl }`。email 与 passkeys 没有 `authUrl`,在 `app/scenes/Login/components/AuthenticationProvider.tsx` 中是**硬编码的特殊分支**——password 照此模式做第三个分支。

### 改动文件总览

```
plugins/password/plugin.json                          ★ 插件声明
plugins/password/server/index.ts                      ★ 注册 Hook.AuthProvider + Hook.EmailTemplate
plugins/password/server/auth/password.ts              ★ 路由:登录 / reset / update
plugins/password/server/auth/schema.ts                ★ zod 校验 schema
plugins/password/server/auth/password.test.ts         ★ 集成测试
plugins/password/server/email/PasswordResetEmail.tsx  ★ 找回邮件模板(经 Hook 注册)
server/migrations/XXXX-add-user-password.js           ★ 数据库迁移(3 字段)
server/models/User.ts                                 ✎ setPassword / verifyPassword 方法
server/models/helpers/AuthenticationHelper.ts         ✎ providersForTeam 特殊处理(env-only)
server/routes/api/auth/auth.ts                        ✎ NON_SSO_SERVICES 加入 "password"
server/scripts/set-password.ts                        ★ 无 SMTP 初始化路径(§6)
package.json                                          ✎ 新增 yarn script
app/scenes/Login/components/AuthenticationProvider.tsx ✎ id === "password" 分支
app/scenes/Login/components/Notices.tsx               ✎ 新增 password-auth-failed / password-locked 文案
app/scenes/Settings/(个人 Profile/Preferences)        ★ 修改密码卡片
```

> 侵入式修改集中在 6 个现有文件,其余均在 `plugins/password/` 与独立脚本——rebase 上游时冲突面小且位置固定。

## 4. 数据层

migration 在 `users` 表上新增 **3 个字段**(均 nullable / 带默认值,不影响存量数据):

| 字段 | 类型 | 用途 |
|---|---|---|
| `passwordHash` | TEXT, nullable | 为 null 表示该用户仅可走 SSO |
| `failedSignInAttempts` | INTEGER, default 0 | 连续失败计数 |
| `lockedUntil` | TIMESTAMP, nullable | 账号锁定截止时间 |

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

### 5.0 路由命名(v3 修正)

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
3. 查用户;检查 `lockedUntil`。**suspended 预检查(v3.1)**:`signIn` 内部对 `team.isSuspended` / `user.isSuspended` 是硬编码 `ctx.redirect("/?notice=…")` 根路径(`server/utils/authentication.ts:38`),在子域名 / 自定义域名入口会把用户踢回错误域名。因此 password 路由在调用 `signIn` **之前**自行检查这两个状态,命中时按 §7 的域名推导规则回跳 `?notice=team-suspended` / `?notice=user-suspended`(复用 `Notices.tsx` 已有文案),确保 `signIn` 内部分支不会被触发。
4. `user.verifyPassword(password)`(用户不存在时仍走 dummy verify):
   - 失败 → 对存在的用户 `failedSignInAttempts += 1`,达到阈值(如 5 次)置 `lockedUntil = now + 15min`;**redirect 回登录页 `?notice=password-auth-failed`**(锁定中为 `?notice=password-locked`),前端展示模糊文案「邮箱或密码不正确」,不区分"用户不存在/无密码/密码错"。native form POST 场景下用 redirect 而非 JSON 错误,与 §7 的回跳域名推导配合。
   - 成功 → 清零计数,调用 **`signIn(ctx, "password", { user, team, client, isNewTeam: false })`**——注意实际签名是 `signIn(ctx, service, result)`,`service` 是独立的第二参数,`AuthenticationResult` 必须携带 `client`(`server/utils/authentication.ts:31`、`server/types.ts:53`;`client` 决定 Desktop 场景的 `desktop-redirect` 分支)。由其完成 cookie、`users.signin` 审计事件与重定向。

### 5.2 `POST /auth/password/reset` — 发起找回(依赖 SMTP)

- 无论邮箱是否存在都返回成功(防枚举)。
- 存在则签发专用 JWT:`type: "password-reset"`、15 分钟过期、携带 `jti` 并写入 Redis(15 分钟 TTL)做**一次性消费**。
- 经现有 mailer 队列发送 `PasswordResetEmail`。**注意(v3)**:模板文件在插件目录内,要走 `.schedule()` 队列链路就必须在 `plugins/password/server/index.ts` 注册 **`Hook.EmailTemplate`**(参照 `plugins/passkeys/server/index.ts`)——`EmailTask` 是按模板名从注册表(`server/emails/templates/index.ts`)取类的,不注册则队列侧找不到模板。
- 未配置 SMTP 时:端点返回明确的 unavailable 错误,前端隐藏"忘记密码"入口,改走 §6。判断口径统一用 `env.EMAIL_ENABLED`(`server/env.ts:401`,已是 `@Public` 公共布尔,前后端同一语义,见 §7)。

### 5.3 `POST /auth/password/update` — 设置 / 重置密码

- 鉴权两选一:reset token(校验 type + 过期 + **消费 Redis 中的 jti**,消费后即作废)或当前登录态 + 当前密码。
- 密码策略:最少 12 位。
- 落库 `setPassword()` 后,**调用 `user.rotateJwtSecret()`** 使该用户全部旧 JWT 失效,然后要求重新登录、或当场重新 `signIn` 签发当前会话。
- 写 `users.update` 审计事件;有 SMTP 时给用户发"密码已修改"通知邮件。

### 5.4 与现有认证体系的对接(易漏,必须做)

1. **`server/routes/api/auth/auth.ts` 的 `NON_SSO_SERVICES`**:加入 `"password"`,否则 `auth.info` 会把密码登录的 session 当作 SSO session 处理。
2. **`AuthenticationHelper.providersForTeam`**:对 password 做特殊处理。v3 明确:**首版只依赖 `PASSWORD_AUTH_ENABLED` 环境变量这一个布尔条件**,与 email/passkeys 现状(直接依赖 Team 字段/现成布尔逻辑)保持同构,不做 preference 抽象。
3. **`plugins/password/server/index.ts` 注册 `Hook.EmailTemplate`**(见 §5.2)。

### 5.5 开关策略

`PASSWORD_AUTH_ENABLED` 环境变量,**默认 false**;首版严格 self-host、env-only。**前端不直接读取该变量**——provider 可见性由服务端 `providersForTeam` 控制,经 `auth.config` 自然传导到登录页,因此无需在 `server/env.ts` 标 `@Public`(若未来前端确需读取,再补 `@Public`)。team 级开关整体移入 §10 后续演进,主路径不保留相关表述。

## 6. 无 SMTP 环境的密码初始化与找回

| 路径 | 形态 | 说明 |
|---|---|---|
| A. 服务器 CLI(v1 推荐) | `server/scripts/set-password.ts`,package.json 增加 yarn script,构建产物为 `build/server/scripts/set-password.js` | 管理员在服务器为用户设密/重置;半天实现,覆盖初始化与找回(现有脚本如 `server/scripts/reset-encrypted-data.ts` 即此形态) |
| B. 管理后台一次性链接 | 用户管理页生成 set-password 链接(复用 §5.2 的 jti token) | 体验更好,需新增管理 UI 与权限;+1–2 天,列入 §10 |
| C. Bootstrap token | 环境变量注入一次性 token | 只解决首个管理员冷启动 |

v1 落地:**实现 A + 无 SMTP 时禁用忘记密码 UI**。

## 7. 前端

- **登录页**:在 `AuthenticationProvider.tsx` 新增 `id === "password"` 硬编码分支(与 email / passkeys 同构):邮箱 + 密码输入框,**native form POST 到 `/auth/password`**(参照 passkeys),让 `signIn` 的 302 + Set-Cookie 行为最自然。
- **CSRF 与 client 字段(v3.1,必须做)**:`/auth` app 在 router 之前全局挂了 `verifyCSRFToken()`(`server/routes/auth/index.ts:94`),passkeys 的 native form 提交前会注入 `[CSRF.fieldName]: getCookie(CSRF.cookieName)` hidden input(`AuthenticationProvider.tsx:117`)。password 表单**同样必须带这个 CSRF hidden input**,否则已有 CSRF cookie 的场景下 POST 会 403。同时带 `client` hidden input(`Desktop.isElectron() ? Client.Desktop : Client.Web`,passkeys 同款逻辑),供服务端传入 `signIn` 的 `AuthenticationResult`。
- **失败回跳**:登录页 notice 机制是 query-string 驱动的,但登录入口存在三种形态——team 子域名、自定义域名、self-host 根域。后端失败重定向**禁止硬编码根路径**,目标 URL 必须由**当前 team.url / 请求 hostname 推导**后再拼 `?notice=…`,否则会把用户踢回错误域名(`signIn` 内部的 suspended 根路径重定向即反例,已由 §5.1 预检查绕开)。
- **Notices 文案(v3.1)**:`app/scenes/Login/components/Notices.tsx` 的 `Message` switch 当前没有 password 相关 case,未注册的 notice 会落到默认的 "unknown error"。需新增两个 case:
  - `password-auth-failed` → 「邮箱或密码不正确。」(模糊文案,不区分用户不存在/密码错)
  - `password-locked` → 「登录失败次数过多,账号已临时锁定,请稍后再试。」
- **"忘记密码"链接**:仅在 SMTP 可用时渲染,判断直接复用现成的 **`env.EMAIL_ENABLED`**(`server/env.ts:401`,已标 `@Public`,前端经 public env 可读),服务端 §5.2 的 unavailable 判断用同一布尔,前后端口径一致。
- **设置页**:修改密码卡片放**个人 Profile / Preferences**,不放团队 Security。
- **i18n**:代码中只写 `t("…")` / `<Trans>`,locale 文件由工具自动提取,不要手改。

## 8. 安全清单(实现时逐条对照)

- [ ] 哈希用 argon2id(`argon2` 包),禁止自拼 crypto 原语。
- [ ] 登录失败统一模糊 notice(`password-auth-failed`);不存在的用户走 dummy hash verify,抹平时序枚举。
- [ ] 专用限流器三键 consume(`ip` / `emailHash` / `ip:emailHash`)+ 账号锁定,双层防爆破。
- [ ] reset token:`type: "password-reset"`、15 分钟、jti 入 Redis 一次性消费。
- [ ] 改密成功调用 `rotateJwtSecret()` 吊销全部旧会话,并重新签发/要求重登。
- [ ] 改密成功发邮件通知(SMTP 可用时)。
- [ ] 密码明文永不进入日志与 events payload。
- [ ] `"password"` 加入 `NON_SSO_SERVICES`,避免被当作 SSO session。
- [ ] `providersForTeam` 以 env-only 布尔条件控制可见性,不做额外抽象。
- [ ] `passwordHash` 为 null 的 SSO 用户走密码登录 → 拒绝,且耗时与密码错误一致。
- [ ] 失败回跳目标由 team.url / 请求 hostname 推导,覆盖子域名 / 自定义域名 / 根域三种入口。
- [ ] suspended(team / user)在调用 `signIn` 前预检查并按推导域名回跳,绕开 `signIn` 内部的根路径硬编码重定向。
- [ ] native form 提交携带 CSRF hidden input(`CSRF.fieldName` ← `CSRF.cookieName`),通过 `/auth` app 全局 `verifyCSRFToken()`。

## 9. 测试(plugins/password/server/auth/password.test.ts)

1. `auth.config` 在开关开/关时正确暴露/隐藏 password provider;
2. 正确密码登录成功,cookie 与 `users.signin` 审计事件正确(`signIn(ctx, "password", …)` 形参与 `client` 传递正确,Web / Desktop 两种 client 的重定向分支);
3. 错误密码:redirect 到 `?notice=password-auth-failed` + 计数递增;用户不存在时响应与耗时形态一致;
4. 连续失败触发锁定(redirect `?notice=password-locked`),锁定期内正确密码也被拒,到期解锁;
5. 三键限流任一超限返回 429;
6. reset token:正常消费一次成功,二次使用被拒(jti 已消费);过期被拒;
7. 改密后旧 cookie 全部失效(`rotateJwtSecret` 生效),新登录正常;
8. SSO-only 用户(`passwordHash = null`)被拒;
9. suspended:`user.isSuspended` / `team.isSuspended` 均在 `signIn` 前被拒,且回跳到发起请求的正确域名(不落到根路径);
10. 无 SMTP 配置(`EMAIL_ENABLED = false`)时 `/auth/password/reset` 返回 unavailable,前端"忘记密码"入口隐藏;
11. 登录失败时重定向到发起请求的正确域名(子域名 / 自定义域名 / 根域三种入口);
12. 缺少 / 错误 CSRF 字段的 POST 被 `verifyCSRFToken()` 拒绝,携带正确 hidden input 的表单提交通过;
13. 前端 `Notices.tsx`:`password-auth-failed` / `password-locked` 渲染对应文案,不落入 unknown error 默认分支。

## 10. 后续演进(明确不在首版)

- **team 级开关**:待确有多团队差异化需求时再做,届时评估写入 Team 字段还是 preferences,避免首版过度抽象。
- **路径 B:管理后台一次性 set-password 链接**(+1–2 天)。
- **`passwordChangedAt` 审计展示字段**:纯展示用途,不参与鉴权。
- 密码强度增强:zxcvbn / HIBP 泄露库比对。

## 11. 发布、回滚与长期维护

- 功能由 `PASSWORD_AUTH_ENABLED` 包住,默认关闭;关闭即回到纯 SSO,无需回滚代码。
- migration 写好 `down`,3 个字段全部 nullable,不影响存量数据。
- 改动集中在 `plugins/password/` 独立目录与 `server/scripts/`,侵入式修改仅 5 个文件——rebase 上游冲突面小且位置固定。
- 建议以独立分支 / patch 系列管理,跟随上游升级。

## 12. 工作量估算

| 模块 | 估时 |
|---|---|
| 数据层(migration + User 方法 + dummy hash) | 0.5 – 1 天 |
| 服务端插件(注册 ×2 Hook + 3 端点 + 专用限流 + jti 一次性 + 对接 ×2) | 2.5 – 3.5 天 |
| CLI 脚本 + yarn script | 0.5 天 |
| 前端(登录分支 native form + 回跳域名推导 + 个人设置卡片) | 1 – 1.5 天 |
| 测试(13 项)与安全打磨 | 1.5 – 2 天 |
| 联调、评审与 rebase 演练 | 0.5 – 1 天 |
| **合计** | **6.5 – 9.5 人日** |
| (后续)路径 B:管理后台一次性链接 | +1 – 2 天 |

---

*核心参考文件:`plugins/email/server/index.ts` · `plugins/passkeys/server/index.ts`(Hook.EmailTemplate 注册形态)· `server/routes/auth/index.ts`(provider 动态挂载 + 全局 `verifyCSRFToken()`)· `server/utils/authentication.ts` / `server/types.ts`(`signIn(ctx, service, result)` 签名、`AuthenticationResult` 含 `client`、suspended 根路径重定向)· `app/scenes/Login/components/AuthenticationProvider.tsx`(passkeys native form 的 CSRF / client hidden input 形态)· `app/scenes/Login/components/Notices.tsx`(notice switch)· `server/emails/templates/index.ts` / `server/queues/tasks/EmailTask.ts`(模板注册表与队列取类)· `app/stores/AuthStore.ts` / `server/presenters/providerConfig.ts` · `server/middlewares/rateLimiter.ts` · `server/models/User.ts` / `server/utils/jwt.ts`(rotateJwtSecret)· `server/env.ts`(`EMAIL_ENABLED` @Public)· `server/scripts/reset-encrypted-data.ts`(脚本形态)· `shared/utils/domains.ts`(保留词)· `server/migrations/20160911234928` / `20180707231201`(passwordDigest 历史)。*
