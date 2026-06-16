# Outline 邮箱 + 密码登录功能 — 技术方案

> 目标:在自托管的 Outline(fork)中新增"邮箱 + 密码"登录方式。
> 状态:方案设计稿 · 适用版本:outline/outline main 分支(2026 上半年)

---

## 1. 背景与前提

Outline 官方**刻意不提供**密码登录:官方文档明确说明 Outline 原生不支持邮箱 + 密码认证,认证完全委托给外部 Provider(Google、Slack、OIDC、SAML、SMTP 魔法链接等),这是出于安全考虑的产品决策。

由此带来两个前提:

1. **该功能上游不会合并**,属于 fork 级改动,需要自己长期维护(Outline 的 BSL 1.1 许可允许自托管修改,无合规问题)。
2. 动手前应先评估两个**零代码替代方案**(见第 2 节),确认确实不满足需求再实施本方案。

## 2. 零代码替代方案(建议先评估)

| 方案 | 说明 | 适用场景 |
|---|---|---|
| SMTP 魔法链接 | Outline 内置的邮箱登录:输入邮箱 → 收一次性登录链接。本质已是"邮箱登录",只是无密码 | 有 SMTP、能接受无密码流程 |
| 前置 IdP(推荐) | 部署 Keycloak / Authentik / Authelia,Outline 走 OIDC 对接。密码、MFA、找回密码、密码策略全部由 IdP 提供 | 愿意多维护一个轻量服务;团队还有其他系统需要统一登录 |

如果环境是内网无 SMTP、且不希望引入额外服务,再走下面的代码改造方案。

## 3. 总体设计

**核心原则:贴着 Outline 现有的认证插件体系做,把密码登录实现为一个新的 auth provider,而不是另起炉灶。**

Outline 的认证架构:

```
app/scenes/Login  ──(GET /api/auth.config)──▶  动态渲染可用 Provider 列表
        │
        ▼ 表单提交 / OAuth 跳转
server/routes/auth/providers/*.ts   ← 每个文件一个 Provider(google / oidc / email …)
        │ 认证成功
        ▼
server/utils/authentication.signIn(ctx, …)   ← 统一:种 cookie、写审计事件、重定向
```

新增的 `password` provider 只要符合这个接口,登录页渲染、会话管理、登出、审计日志全部免费继承。**参照物选 `email`(魔法链接)provider**——它同样是"表单提交而非 OAuth 跳转"的形态,前后端模式可直接复用。

改动文件总览(★ = 新增文件,侵入式修改仅 2 处):

```
server/migrations/XXXX-add-user-password.js          ★ 数据库迁移
server/models/User.ts                                   修改:密码字段与校验方法
server/routes/auth/providers/password.ts             ★ Provider 主体(3 个端点)
server/emails/templates/PasswordResetEmail.tsx       ★ 找回密码邮件模板
app/scenes/Login/…                                      修改:登录页密码表单分支
app/scenes/Settings/…                                ★ 设置页"修改密码"卡片
shared/i18n/locales/…                                   补充翻译键
```

## 4. 数据层

写一个 Sequelize migration,在 `users` 表上新增 4 个字段:

| 字段 | 类型 | 说明 |
|---|---|---|
| `passwordHash` | TEXT, nullable | 为 `null` 表示该用户仅可走 SSO 登录 |
| `passwordChangedAt` | TIMESTAMP, nullable | 用于失效旧的 reset token / 旧会话 |
| `failedSignInAttempts` | INTEGER, default 0 | 连续失败计数 |
| `lockedUntil` | TIMESTAMP, nullable | 账号锁定截止时间 |

`server/models/User.ts` 改动:

```ts
// 虚拟字段:写入时即哈希,模型上不保留明文
set password(value: string) {
  this.passwordHash = await argon2.hash(value, {
    type: argon2.argon2id,   // 参数遵循 OWASP 推荐
  });
  this.passwordChangedAt = new Date();
}

async verifyPassword(plain: string): Promise<boolean> {
  if (!this.passwordHash) return false;
  return argon2.verify(this.passwordHash, plain);
}
```

> 设计取舍:不单独建凭据表。除非未来要支持一个用户多套凭据,单列方案改动面最小、与现有模型最贴合。

## 5. 服务端 Provider

新建 `server/routes/auth/providers/password.ts`,导出符合现有 provider 约定的 `config` 与 router:

```ts
export const config = {
  id: "password",
  name: "Email & Password",
  enabled: env.PASSWORD_AUTH_ENABLED === "true",  // 默认关闭
};
```

### 5.1 `POST /auth/password` — 登录

处理流程:

1. zod 校验 `email` / `password`(邮箱做小写归一)。
2. 套用 `server/middlewares/rateLimiter` 最严格档,**按 IP + email 双键限流**。
3. 查询用户;检查 `lockedUntil` 与 `user.isSuspended`。
4. `user.verifyPassword(password)`:
   - 失败 → `failedSignInAttempts += 1`;达到阈值(如 5 次)则 `lockedUntil = now + 15min`;返回**统一模糊错误**「邮箱或密码不正确」(不区分用户不存在/密码错误,防枚举)。
   - 成功 → 清零计数,调用:
     ```ts
     await signIn(ctx, { user, team, service: "password", isNewUser: false });
     ```
5. `signIn` 负责种 cookie、写 `users.signin` 审计事件、重定向回应用。

### 5.2 `POST /auth/password.reset` — 发起找回

- **无论邮箱是否存在都返回成功**(防枚举)。
- 存在则签发短时效 JWT(参照 email provider 登录 token 的签发方式):
  - `expiresIn: 15m`;
  - payload 携带 `passwordChangedAt`,改密后旧 token 自动失效;
- 通过现有 mailer 发送,模板 `PasswordResetEmail` 照 `SigninEmail` 仿写。

### 5.3 `POST /auth/password.update` — 设置/重置密码

- 鉴权:reset token **或** 当前登录态(改密时需附带当前密码)。
- 密码策略:最少 12 位;可选接入 zxcvbn 强度校验。
- 落库:写新哈希、更新 `passwordChangedAt`。
- 善后:写 `users.update` 审计事件;给用户发"密码已修改"通知邮件。

## 6. 前端

**登录页**(`app/scenes/Login`):Provider 列表由 `/api/auth.config` 数据驱动。email provider 已有"按钮点开变内联表单"的组件形态,为 password 做一个类似分支:

- 邮箱 + 密码输入框,提交 POST `/auth/password`;
- 失败时复用登录页现有 `?notice=` 错误参数机制展示提示;
- 旁边放「忘记密码」链接 → reset 表单。

**设置页**(`app/scenes/Settings`):账户安全部分新增「修改密码」卡片(当前密码 + 新密码 ×2),调用 `password.update`。

两处均需在 `shared/i18n` 补充翻译键(至少 zh-CN / en)。

## 7. 安全清单(实现时逐条对照)

- [ ] 哈希算法用 **argon2id**(`argon2` 包),禁止自拼 crypto。
- [ ] 登录失败信息统一模糊化,不暴露"用户是否存在"。
- [ ] **IP 限流 + 账号锁定**双层防爆破。
- [ ] reset token 一次性、短时效(15 min),改密后整体失效。
- [ ] 改密成功向用户发邮件通知。
- [ ] 密码明文**永不**进入日志与 events payload。
- [ ] 尊重 team 安全设置:若管理员禁用了某些登录方式,password provider 同样受控(参照其他 provider 读取 team 设置的方式)。
- [ ] 评估改密后是否吊销其他会话:会话为 JWT cookie,可在校验链路比对 `passwordChangedAt`。
- [ ] `passwordHash` 为 `null` 的 SSO 用户尝试密码登录 → 直接拒绝。

## 8. 测试

在 `server/routes/auth/` 旁按现有测试风格(jest + factories)编写集成测试,至少覆盖:

1. 正确密码登录成功,cookie 与审计事件正确产生;
2. 错误密码返回模糊错误,计数递增;
3. 连续失败触发锁定,锁定期内正确密码也被拒,到期自动解锁;
4. reset 全流程:发起 → 邮件 token → 设置新密码 → 旧 token 失效;
5. 限流生效(并发请求被 429);
6. SSO-only 用户(`passwordHash = null`)走密码登录被拒;
7. `isSuspended` 用户被拒。

## 9. 发布、回滚与长期维护

- **功能开关**:整体由 `PASSWORD_AUTH_ENABLED` 环境变量包住,默认关闭;关掉即回到纯 SSO,无需回滚代码。
- **迁移可逆**:migration 写好 `down`;字段均为 nullable,新增不影响存量数据。
- **维护成本**:Outline 迭代快,auth 相关代码时有重构。本方案刻意把改动收敛在新增文件中——侵入式修改仅 `User.ts` 与登录页两处,每次 rebase 上游时冲突面可控。
- 建议在 fork 中以独立分支/patch 系列管理这组改动,便于跟随上游升级。

## 10. 工作量估算

| 模块 | 估时 |
|---|---|
| 数据层(migration + model) | 0.5 天 |
| 服务端 provider(3 端点 + 邮件模板) | 1.5 ~ 2 天 |
| 前端(登录页 + 设置页 + i18n) | 1 天 |
| 测试与安全打磨 | 1 ~ 2 天 |
| **合计** | **4 ~ 5.5 人日**(熟悉该代码库的前提下) |

---

*附:核心参考文件 — `server/routes/auth/providers/email.ts`(形态参照)、`server/utils/authentication.ts`(signIn)、`server/middlewares/rateLimiter.ts`、`server/emails/templates/SigninEmail.tsx`。*
