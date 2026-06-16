# Outline 邮箱 + 密码登录功能 — 技术方案 v2

> 目标:在自托管的 Outline(fork)中新增"邮箱 + 密码"登录方式。
> 状态:设计稿 v2(已吸收代码评审意见)· 适用版本:outline/outline main 分支(2026 上半年)

## 变更记录(v1 → v2)

| # | 评审意见 | 处理 |
|---|---|---|
| 1 | Provider 落点错误,当前是 `PluginManager` 插件注册机制 | 新增代码整体迁移到 `plugins/password/`(§3) |
| 2 | `auth.config` 是 RPC POST,presenter 只返回 `{id, name, authUrl}`,无 `enabled` 字段 | 修正接口描述与前端取数方式(§3、§7) |
| 3 | JS setter 不能 async | 改为显式 `setPassword()` / `verifyPassword()` 异步方法(§4) |
| 4 | "内网无 SMTP"前提与"邮件找回密码"自相矛盾 | 新增非邮件初始化/重置路径章节(§6) |
| 5 | 现有 `rateLimiter` 只按用户或 IP 单键,做不到双键限流 | 新增专用 password limiter,分别 consume `ip` / `emailHash` / `ip:emailHash`(§5.1) |
| 6 | 未加入 `NON_SSO_SERVICES` 白名单会被当成 SSO session | 明确修改 `server/routes/api/auth/auth.ts`(§5.4) |
| 7 | 吊销会话应使用现成的 `rotateJwtSecret()` 而非比对 `passwordChangedAt` | 改密成功后调用 `rotateJwtSecret()`(§5.3) |
| — | 估时偏乐观 | 4–5.5 人日 → **6–9 人日**,无 SMTP 流程另加 1–2 天(§11) |

---

## 1. 背景与前提

Outline 官方刻意不提供密码登录,认证完全委托给外部 Provider,这是出于安全考虑的产品决策。由此:

1. **该功能上游不会合并**,属于 fork 级改动,需要长期自己维护(BSL 1.1 允许自托管修改,无合规问题)。
2. 密码体系的"找回/首次设密"默认依赖邮件。**如果部署环境没有 SMTP,必须实现 §6 的非邮件初始化路径,或明确禁用"忘记密码"**——这一点 v1 没有讲清楚,是个真实的功能闭环缺口。

## 2. 零代码替代方案(建议先评估)

| 方案 | 说明 | 适用场景 |
|---|---|---|
| SMTP 魔法链接 | 内置邮箱登录:输入邮箱 → 收一次性登录链接 | 有 SMTP、能接受无密码流程 |
| 前置 IdP(推荐) | Keycloak / Authentik 走 OIDC,密码、MFA、找回全套都有 | 愿意多维护一个轻量服务 |

确认都不满足(典型:内网无 SMTP 且不想加服务)再实施本方案——并按 §6 选定一种密码初始化方式。

## 3. 总体设计

**核心原则不变:把密码登录做成认证体系里的一个普通成员,复用 `signIn`、cookie、审计与登录页配置。落点修正为插件机制。**

当前代码中,auth provider 是插件注册制:

```
plugins/<name>/plugin.json                  ← 插件声明
plugins/<name>/server/index.ts              ← PluginManager.add({ ...,
                                                 type: Hook.AuthProvider, value: { router, id } })
server/routes/auth/index.ts                 ← 遍历已注册插件,动态挂载到 /auth/<id>
```

前端取数:`app/stores/AuthStore.ts` 调用 **`client.post("/auth.config")`**(Outline 的 API 是 RPC 风格,均为 POST),服务端经 `server/presenters/providerConfig.ts` 返回 `{ id, name, authUrl }`。email 与 passkeys 没有 `authUrl`,在 `app/scenes/Login/components/AuthenticationProvider.tsx` 中是**硬编码的特殊分支**(内联表单而非跳转按钮)——password 完全照此模式做第三个分支。

### 改动文件总览

```
plugins/password/plugin.json                          ★ 插件声明
plugins/password/server/index.ts                      ★ PluginManager 注册(Hook.AuthProvider)
plugins/password/server/auth/password.ts              ★ 路由:登录 / reset / update
plugins/password/server/auth/schema.ts                ★ zod 校验 schema
plugins/password/server/auth/password.test.ts         ★ 集成测试
plugins/password/server/email/PasswordResetEmail.tsx  ★ 找回邮件模板(有 SMTP 时)
server/migrations/XXXX-add-user-password.js           ★ 数据库迁移
server/models/User.ts                                 ✎ setPassword / verifyPassword 方法
server/models/helpers/AuthenticationHelper.ts         ✎ providersForTeam 像 email/passkeys 一样特殊处理
server/routes/api/auth/auth.ts                        ✎ NON_SSO_SERVICES 加入 "password"
app/scenes/Login/components/AuthenticationProvider.tsx ✎ id === "password" 分支
app/scenes/Settings/(个人 Profile/Preferences)        ★ 修改密码卡片
scripts/set-password.ts(或 yarn script)              ★ 无 SMTP 初始化路径(§6,可选)
```

> 侵入式修改集中在 4 个现有文件,其余均为 `plugins/password/` 下的新增——rebase 上游时冲突面可控,这一点比 v1 更好(插件目录天然隔离)。

## 4. 数据层

migration 在 `users` 表上新增 4 个字段(均 nullable / 带默认值,不影响存量数据):

| 字段 | 类型 | 用途 |
|---|---|---|
| `passwordHash` | TEXT, nullable | 为 null 表示该用户仅可走 SSO |
| `passwordChangedAt` | TIMESTAMP, nullable | 审计与 reset token 失效参考 |
| `failedSignInAttempts` | INTEGER, default 0 | 连续失败计数 |
| `lockedUntil` | TIMESTAMP, nullable | 账号锁定截止时间 |

`server/models/User.ts` 增加**显式异步方法**(JS setter 不能 await,v1 的虚拟 setter 写法不成立):

```ts
async setPassword(plain: string) {
  this.passwordHash = await argon2.hash(plain, { type: argon2.argon2id }); // OWASP 推荐参数
  this.passwordChangedAt = new Date();
}

async verifyPassword(plain: string): Promise<boolean> {
  if (!this.passwordHash) {
    await argon2.verify(DUMMY_HASH, plain); // 对无密码用户做假校验,抹平时序差异
    return false;
  }
  return argon2.verify(this.passwordHash, plain);
}
```

`DUMMY_HASH` 为模块级常量(对固定随机串预计算的 argon2 哈希),保证"用户不存在 / 无密码"与"密码错误"两条路径耗时一致,降低时序枚举风险。

## 5. 服务端(plugins/password)

`plugins/password/server/auth/password.ts` 暴露一个 koa router,经插件机制挂载到 `/auth/password` 下,共三个端点。

### 5.1 `POST /auth/password` — 登录

1. `schema.ts` 中的 zod schema 校验 `email` / `password`(邮箱小写归一)。
2. **专用限流器**(现有 `rateLimiter` 只支持按已登录用户或 IP 单键,不满足需求):基于同一套 RateLimiterRedis 新建 password 专用 limiter,**分别 consume 三个 key:`ip`、`emailHash`、`ip:emailHash`**,任一超限即 429。emailHash 用于避免把明文邮箱写进 Redis key。
3. 查用户;检查 `lockedUntil` 与 `user.isSuspended`。
4. `user.verifyPassword(password)`(用户不存在时仍走 dummy verify,见 §4):
   - 失败 → 对存在的用户 `failedSignInAttempts += 1`,达到阈值(如 5 次)置 `lockedUntil = now + 15min`;统一返回模糊错误「邮箱或密码不正确」。
   - 成功 → 清零计数,调用 `signIn(ctx, { user, team, service: "password", isNewUser: false })`,由其完成 cookie、`users.signin` 审计事件与重定向。

### 5.2 `POST /auth/password.reset` — 发起找回(依赖 SMTP)

- 无论邮箱是否存在都返回成功(防枚举)。
- 存在则签发专用 JWT:`type: "password-reset"`、15 分钟过期、**携带 `jti`,并把 `jti` 写入 Redis(15 分钟 TTL)用于一次性消费**——只靠 email-signin token 那种无状态模式不够严格,无法保证单次使用。
- 经现有 mailer 发送 `PasswordResetEmail`。
- **未配置 SMTP 时:端点返回明确的 unavailable 错误,前端隐藏"忘记密码"入口**,改走 §6。

### 5.3 `POST /auth/password.update` — 设置 / 重置密码

- 鉴权两选一:reset token(校验 type + 过期 + **消费 Redis 中的 jti**,消费后即作废)或当前登录态 + 当前密码。
- 密码策略:最少 12 位,可选接 zxcvbn。
- 落库 `setPassword()` 后,**调用 `user.rotateJwtSecret()`**(`server/models/User.ts` / `server/utils/jwt.ts` 现成机制)使该用户全部旧 JWT 失效,然后要求重新登录、或当场重新 `signIn` 签发当前会话。这取代 v1 设想的 `passwordChangedAt` 比对——不动会话校验链路,改动更小且语义就是为此设计的。
- 写 `users.update` 审计事件;有 SMTP 时给用户发"密码已修改"通知邮件。

### 5.4 与现有认证体系的两处对接(易漏,必须做)

1. **`server/routes/api/auth/auth.ts` 的 `NON_SSO_SERVICES`**:当前只有 `email`、`passkeys` 被排除在 SSO 校验外。`"password"` 必须加入,否则 `auth.info` 会把密码登录的 session 当作 SSO session 处理,后续行为不可预期。
2. **`AuthenticationHelper.providersForTeam`**:像 email/passkeys 一样对 password 做特殊处理,决定其对某个 team 是否可用(结合 `PASSWORD_AUTH_ENABLED` 与可选的 team 级开关)。

### 5.5 开关策略

- `PASSWORD_AUTH_ENABLED` 环境变量,**默认 false**。
- v1 范围建议:仅 self-host、env-only;team 级开关(写入 team preferences)作为后续增强,避免首版引入设置页与权限联动的额外面积。

## 6. 无 SMTP 环境的密码初始化与找回(新增)

邮件不可用时,必须提供至少一条替代路径,按实现成本从低到高:

| 路径 | 形态 | 说明 |
|---|---|---|
| A. 服务器 CLI(v1 推荐) | `node ./build/server/scripts/set-password.js --email a@b.c` 或 yarn script | 管理员在服务器上直接为用户设密/重置;实现半天,覆盖初始化与找回两个场景 |
| B. 管理后台一次性链接 | 管理员在用户管理页生成 set-password 链接(同 §5.2 的 jti token),复制给用户 | 体验更好,需要新增管理 UI 与权限校验 |
| C. Bootstrap token | 环境变量注入一次性 token,仅用于首个管理员设密 | 只解决冷启动,不解决日常找回 |

v1 落地:**实现 A + "无 SMTP 时禁用忘记密码 UI"**;B 列入后续迭代。

## 7. 前端

- **登录页**:在 `app/scenes/Login/components/AuthenticationProvider.tsx` 新增 `id === "password"` 硬编码分支(与现有 email / passkeys 同构):邮箱 + 密码输入框。提交方式用 **native form POST 到 `/auth/password`**(参照 passkeys),让 `signIn` 的 302 + Set-Cookie 行为最自然,避免 XHR 跟随重定向的边角问题。失败回跳登录页时复用现有 `?notice=` 提示机制。"忘记密码"链接仅在 SMTP 可用时渲染。
- **设置页**:修改密码卡片放在**个人 Profile / Preferences**,不要放团队 Security(那里是 team 级安全策略,语义不符)。表单:当前密码 + 新密码 ×2,调 `password.update`,成功后按 §5.3 引导重新登录。
- **i18n**:代码中只写 `t("…")`,**不要手动改 `shared/i18n/locales`**——项目约定翻译字符串由工具自动提取。

## 8. 安全清单(实现时逐条对照)

- [ ] 哈希用 argon2id(`argon2` 包),禁止自拼 crypto 原语。
- [ ] 登录失败统一模糊错误;不存在的用户走 dummy hash verify,抹平时序枚举。
- [ ] 专用限流器三键 consume(`ip` / `emailHash` / `ip:emailHash`)+ 账号锁定,双层防爆破。
- [ ] reset token:`type: "password-reset"`、15 分钟、jti 入 Redis 一次性消费。
- [ ] 改密成功调用 `rotateJwtSecret()` 吊销全部旧会话,并重新签发/要求重登。
- [ ] 改密成功发邮件通知(SMTP 可用时)。
- [ ] 密码明文永不进入日志与 events payload。
- [ ] `"password"` 加入 `NON_SSO_SERVICES`,避免被当作 SSO session。
- [ ] `providersForTeam` 正确控制 provider 对 team 的可见性。
- [ ] `passwordHash` 为 null 的 SSO 用户走密码登录 → 拒绝(且耗时与密码错误一致)。

## 9. 测试(plugins/password/server/auth/password.test.ts)

1. `auth.config` 在开关开/关时是否正确暴露/隐藏 password provider;
2. 正确密码登录成功,cookie 与 `users.signin` 审计事件正确;
3. 错误密码:模糊错误 + 计数递增;用户不存在时响应与耗时形态一致;
4. 连续失败触发锁定,锁定期内正确密码也被拒,到期解锁;
5. 三键限流任一超限返回 429;
6. reset token:正常消费一次成功,**二次使用被拒**(jti 已消费);过期被拒;
7. 改密后旧 cookie 全部失效(`rotateJwtSecret` 生效),新登录正常;
8. SSO-only 用户(`passwordHash = null`)被拒;
9. `isSuspended` 用户被拒;
10. 无 SMTP 配置时 `password.reset` 返回 unavailable,前端入口隐藏。

## 10. 发布、回滚与长期维护

- 功能由 `PASSWORD_AUTH_ENABLED` 包住,默认关闭;关闭即回到纯 SSO,无需回滚代码。
- migration 写好 `down`,字段全部 nullable,不影响存量数据。
- 改动集中在 `plugins/password/` 独立目录,侵入式修改仅 4 个文件(User model、AuthenticationHelper、auth.ts、登录组件)——每次 rebase 上游冲突面小且位置固定。
- 建议以独立分支 / patch 系列管理,跟随上游升级。

## 11. 工作量估算(v2 上调)

| 模块 | 估时 |
|---|---|
| 数据层(migration + User 方法 + dummy hash) | 0.5 – 1 天 |
| 服务端插件(注册 + 3 端点 + 专用限流 + jti 一次性 + NON_SSO/Helper 对接) | 2.5 – 3.5 天 |
| 前端(登录分支 native form + 个人设置卡片) | 1 – 1.5 天 |
| 测试(10 项)与安全打磨 | 1.5 – 2 天 |
| 联调、评审与 rebase 演练 | 0.5 – 1 天 |
| **合计** | **6 – 9 人日** |
| (可选)§6 路径 B:管理后台一次性链接 | +1 – 2 天 |

---

*核心参考文件:`plugins/email/server/index.ts`(插件注册形态)· `server/routes/auth/index.ts`(动态挂载)· `app/stores/AuthStore.ts` / `server/presenters/providerConfig.ts`(auth.config 形态)· `server/middlewares/rateLimiter.ts`(限流基建)· `server/models/User.ts` / `server/utils/jwt.ts`(rotateJwtSecret)· `app/scenes/Login/components/AuthenticationProvider.tsx`(email/passkeys 特殊分支)。*
