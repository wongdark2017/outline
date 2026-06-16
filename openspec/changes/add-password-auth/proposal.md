## 为什么

Outline 当前只支持外部认证提供方，不提供原生邮箱加密码登录。这在自托管环境里会留下明显缺口：没有统一 IdP 的团队无法使用密码登录，无 SMTP 的部署也缺少可操作的账号初始化和找回路径。该变更为自托管 fork 增加一套受开关控制的 password provider，在尽量复用现有登录、会话、审计和插件机制的前提下补齐这条认证路径。

## 变更内容

- 新增 `plugins/password` 认证插件，向 `/auth/password`、`/auth/password/reset`、`/auth/password/update` 提供登录、找回和改密能力。
- 在 `users` 表和 `User` 模型中新增密码哈希、失败计数和锁定截止时间字段，并补充密码相关 helper。
- 增加基于 team 作用域的密码登录和找回流程，包括 team 解析、三键限流、账号锁定、一次性 reset token、会话轮转和审计事件。
- 为无 SMTP 部署新增 CLI 设密/重置密码脚本，并在无邮件能力时禁用前端忘记密码入口。
- 扩展前端登录页、公开 reset-password 页面和个人设置页，使 password provider 能完成登录、发起找回和登录态修改密码。
- 保持该能力默认关闭，仅在 `PASSWORD_AUTH_ENABLED && !isCloudHosted` 时注册并可达。

## 功能 (Capabilities)

### 新增功能

- `password-auth`: 提供受环境开关控制的邮箱加密码登录、找回密码、重置密码和登录态修改密码能力，并保证 team 作用域、CSRF、防枚举、限流、会话轮转和无 SMTP 运维路径完整可用。

### 修改功能

无。

## 影响

- 后端：新增 password 插件、本地 env、邮件模板、路由 schema、密码脚本、数据库迁移、`User` 模型字段和方法、`auth.info` / presenter 对接以及测试。
- 前端：新增 password 登录分支、忘记密码子状态、`/reset-password` 公开页面、设置页修改密码卡片和相关 notice。
- 依赖：新增 `argon2` 原生依赖并更新 `yarn.lock`。
- 安全与运维：新增密码哈希、team 维度限流、账号锁定、一次性 token 和 CLI 管理路径；该能力不会在 cloud-hosted 环境暴露。
