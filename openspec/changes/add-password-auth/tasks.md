## 1. 数据层与依赖

- [x] 1.1 向 `package.json` 添加 `argon2` 依赖并更新 `yarn.lock`。
- [x] 1.2 创建 `users` 表迁移，新增 `passwordHash`、`failedSignInAttempts` 和 `lockedUntil` 三个字段，并补齐回滚逻辑。
- [x] 1.3 在 `server/models/User.ts` 增加密码字段声明、`@SkipChangeset` 配置、`DUMMY_HASH`、`setPassword`、`verifyPassword`、`hashPassword` 和 `getPasswordResetToken`。

## 2. Password 插件与后端路由

- [x] 2.1 创建 `plugins/password/server/env.ts`、`plugin.json` 和 `server/index.ts`，实现 `PASSWORD_AUTH_ENABLED && !isCloudHosted` 的条件注册与 `Hook.EmailTemplate` 注册。
- [x] 2.2 实现 `plugins/password/server/auth/schema.ts`，为登录、reset、update 三个端点定义 body `.strict()`、空 query strict 和 update XOR 校验。
- [x] 2.3 实现 `POST /auth/password`，包含 team 解析、pre-team IP 限流、正式三键限流、team 作用域用户查询、dummy verify、失败计数原子递增、锁定逻辑和 `signIn` 调用。
- [x] 2.4 实现 `POST /auth/password/reset`，包含 SMTP 可用性检查、team 解析、预限流、正式三键限流、防枚举返回、reset token 生成、Redis 写入和邮件发送。
- [x] 2.5 实现 `POST /auth/password/update`，包含 reset token 与登录态双路径鉴权、事务内行锁、Redis `GETDEL`、密码更新、`rotateJwtSecret`、审计事件和响应分流。
- [x] 2.6 创建 `plugins/password/server/email/PasswordResetEmail.tsx`，输出 reset 链接邮件模板。

## 3. 现有认证链路对接

- [x] 3.1 在 `server/routes/api/auth/auth.ts` 将 `"password"` 加入 `NON_SSO_SERVICES`。
- [x] 3.2 在 `server/presenters/user.ts` 增加 `includePasswordState` 选项和 `hasPassword` 字段，仅在 `auth.info` 场景输出。
- [x] 3.3 在服务端需要的位置补充 password provider 404 兜底、SMTP 503 错误 helper 和相关对接代码。

## 4. 无 SMTP 运维路径

- [x] 4.1 新建 `server/scripts/set-password.ts`，按 `{ teamId, email }` 或等效 team 标识定位用户并在事务中重置密码。
- [x] 4.2 在 `package.json` 增加对应 yarn script，并确保脚本会清零锁定状态、轮转 `jwtSecret` 和写入 CLI 审计事件。

## 5. 前端登录与重置流程

- [x] 5.1 在 `app/scenes/Login/components/AuthenticationProvider.tsx` 增加 `id === "password"` 分支，提交 native form 到 `/auth/password`，并注入 `_csrf` 与 `client` hidden input。
- [x] 5.2 在登录页 password 分支增加“忘记密码”子状态，通过 `client.post("/password/reset", ..., { baseUrl: "/auth" })` 发起 reset 请求，并处理 2xx 与 503 反馈。
- [x] 5.3 在 `app/routes/index.tsx` 新增公开路由 `/reset-password`，并实现 `app/scenes/Login/ResetPassword.tsx` 页面，读取 URL `token`、以 hidden `resetToken` 提交到 `/auth/password/update`。
- [x] 5.4 在 `app/scenes/Login/components/Notices.tsx` 增加 `password-auth-failed`、`password-locked` 和 `password-updated` notice。

## 6. 前端设置页与模型

- [x] 6.1 在前端 `User` 模型中增加只读 `hasPassword` 字段且不使用 `@Field`。
- [x] 6.2 在 `auth.info` 消费链路中接入 `hasPassword`，并在个人设置页仅对 `hasPassword === true` 的用户展示“修改密码”卡片。
- [x] 6.3 实现设置页通过 `/auth/password/update` 的登录态改密调用，处理成功的 JSON 响应与错误提示。

## 7. 测试与验证

- [x] 7.1 编写后端测试，覆盖开关与 cloud guard、team 作用域登录、team 维度限流、账号锁定、防枚举 reset、reset token 并发消费、transport 校验和 CLI 落库语义。
- [x] 7.2 编写前端测试，覆盖 password 登录分支、忘记密码交互、`/reset-password` 页面流、notice 渲染、设置页 `hasPassword` 可见性和改密错误处理。
- [x] 7.3 运行针对性测试、`yarn tsc`、`yarn lint` 和必要的格式化，确认 password auth 变更可进入实现阶段。
