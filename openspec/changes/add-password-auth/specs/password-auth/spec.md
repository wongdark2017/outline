## 新增需求

### 需求:系统必须在自托管环境提供受开关控制的 password provider
系统必须仅在 `PASSWORD_AUTH_ENABLED` 为 true 且实例不是 cloud-hosted 时注册并暴露 password provider；当任一条件不满足时，password 认证端点和登录入口必须不可用。

#### 场景:自托管且开关开启时注册 provider
- **当** 部署为 self-hosted 且 `PASSWORD_AUTH_ENABLED` 为 true
- **那么** 系统注册 password auth provider、暴露 `/auth/password*` 端点，并在登录配置中返回 `password` provider

#### 场景:开关关闭时不可达
- **当** `PASSWORD_AUTH_ENABLED` 为 false
- **那么** 系统不得注册 password provider，`/auth/password`、`/auth/password/reset` 和 `/auth/password/update` 必须返回 404

#### 场景:cloud-hosted 时不可达
- **当** 实例被判定为 cloud-hosted，即使 `PASSWORD_AUTH_ENABLED` 为 true
- **那么** 系统也不得注册 password provider，登录页不得展示 password 入口

### 需求:系统必须按 team 作用域完成密码登录
系统必须在 `/auth/password` 登录流程中先解析 team，再执行 team 维度正式限流和 `{ teamId, email }` 用户查询；系统必须对用户不存在、密码错误、账号锁定、用户停用和团队停用给出正确且安全的响应。

#### 场景:存在用户且密码正确时登录成功
- **当** 用户从有效 team 域名提交正确的邮箱、密码和 client
- **那么** 系统必须在正式限流通过后按 `{ teamId, email }` 查询用户，并通过现有 `signIn` 流程建立会话、写入审计事件并完成重定向

#### 场景:用户不存在时返回模糊失败
- **当** 指定 team 下不存在该邮箱用户
- **那么** 系统必须执行 dummy password verify 并重定向到 `password-auth-failed`，且不得递增任何用户失败计数或写入审计事件

#### 场景:密码错误达到阈值后临时锁定
- **当** team 作用域内用户连续多次提交错误密码
- **那么** 系统必须原子递增 `failedSignInAttempts`，并在达到阈值时写入 `lockedUntil` 后返回 `password-locked`

#### 场景:团队停用时回跳正确域名
- **当** 请求命中的 team 处于 suspended 状态
- **那么** 系统必须在调用 `signIn` 前拒绝登录，并重定向到该 team 对应域名下的 `team-suspended` notice

### 需求:系统必须对密码登录和找回执行分层限流
系统必须在登录与找回端点同时执行 pre-team IP-only 预限流和 team 维度正式三键限流。正式限流 key 必须由 `ip`、`teamId:emailHmac`、`ip:teamId:emailHmac` 组成，且必须发生在用户查询之前。

#### 场景:未知 team 流量触发预限流
- **当** 同一 IP 连续访问未知 hostname、无效 custom domain 或 provider 不可用的 password 端点
- **那么** 系统必须基于 pre-team IP-only key 对请求限流，并在超限后返回 429

#### 场景:不同 workspace 的同邮箱互不污染
- **当** 相同邮箱分别存在于两个不同 team，且攻击流量只针对其中一个 team
- **那么** 系统必须只增加该 team 的 `teamId:emailHmac` 与 `ip:teamId:emailHmac` 计数，另一个 team 的同邮箱登录或 reset 不得被连带限流

#### 场景:正式限流在用户查询前生效
- **当** 某个登录或 reset 请求命中正式三键限流阈值
- **那么** 系统必须直接返回 429，且不得继续执行用户查询、真实或 dummy 密码验证、reset token 生成、Redis 写入或邮件发送

### 需求:系统必须提供防枚举的找回密码流程
系统必须在 `/auth/password/reset` 中按 team 作用域解析请求，并在 SMTP 可用、provider 可用且未触发限流时，对存在与不存在的邮箱统一返回成功语义；当 SMTP 不可用时，系统必须返回 503。

#### 场景:存在邮箱时生成 reset token 并发送邮件
- **当** 请求命中有效 team、SMTP 可用、provider 可用且正式限流未触发，且该 team 下存在对应邮箱用户
- **那么** 系统必须生成包含 `id`、`teamId`、`type`、`createdAt` 和 `jti` 的 reset token，将 `{ userId, teamId }` 写入 Redis，并发送指向 `/reset-password?token=...` 的邮件

#### 场景:不存在邮箱时仍返回成功
- **当** 请求命中有效 team、SMTP 可用、provider 可用且正式限流未触发，但该 team 下不存在对应邮箱用户
- **那么** 系统必须返回与存在邮箱相同的成功语义，且不得泄露邮箱是否存在

#### 场景:SMTP 不可用时返回服务不可用
- **当** `EMAIL_ENABLED` 为 false 或 `SMTP_FROM_EMAIL` 缺失
- **那么** 系统必须拒绝 reset 请求并返回 503 服务不可用错误

### 需求:系统必须通过一次性 reset token 安全更新密码
系统必须支持通过 reset token 或登录态 current password 两种互斥路径更新密码。更新密码时必须使用显式事务、行级锁、事务内重新验证和 `rotateJwtSecret`；reset token 消费必须以 Redis `GETDEL` 作为唯一权威判定。

#### 场景:reset token 路径成功更新密码
- **当** 用户提交合法的 `resetToken` 和满足策略的新密码，且 token payload、team、签名、Redis jti 状态都匹配
- **那么** 系统必须在事务内锁定目标用户、消费 jti、写入新密码哈希、清零锁定状态、轮转 `jwtSecret`、写入密码修改审计事件，并重定向到 `password-updated`

#### 场景:reset token 已消费或失效
- **当** reset token 已过期、已被消费、payload 不合法、签名不匹配、Redis value 损坏或目标用户不存在
- **那么** 系统必须拒绝密码更新并统一重定向到 `expired-token`，且不得返回 500

#### 场景:登录态修改密码成功后保留当前会话
- **当** 已登录用户通过 cookie transport 提交正确的 `currentPassword` 和满足策略的新密码
- **那么** 系统必须在事务内完成密码更新和 `jwtSecret` 轮转，并在事务提交后用新的 session token 重签 `accessToken` cookie，返回 JSON `{ success: true }`

#### 场景:登录态路径认证来源不合法
- **当** 请求使用 header、body 或 query 传入 session token，而不是 cookie transport
- **那么** 系统必须拒绝使用 `currentPassword` 路径更新密码，并返回 401 JSON 错误

### 需求:系统必须阻止 `/auth/password/*` 端点的 token transport 污染
系统必须禁止 `/auth/password/*` 请求体和 query string 出现名为 `token` 的字段，并通过严格 schema 约束 body 与 query 的合法字段集合。`/auth/password/update` 的 `resetToken` 与 `currentPassword` 必须且只能存在一个。

#### 场景:请求体包含非法 `token` 字段
- **当** 客户端向任一 `/auth/password/*` 端点提交包含 `token` 或其他未声明字段的 body
- **那么** 系统必须在 validation 阶段返回 400，并且 password handler 不得执行状态变更

#### 场景:query string 非空
- **当** 客户端向任一 `/auth/password/*` 端点提交任何 query 参数，包括 `?token=...`
- **那么** 系统必须在 validation 阶段返回 400，并且 password handler 不得执行状态变更

#### 场景:update 两种鉴权字段同时存在
- **当** 客户端在 `/auth/password/update` 请求体中同时提交 `resetToken` 与 `currentPassword`，或两者都缺失
- **那么** 系统必须返回 400，并拒绝进入任一密码更新路径

### 需求:系统必须向当前用户安全暴露密码能力状态并提供无 SMTP 运维路径
系统必须仅向当前用户返回 `hasPassword` 布尔状态，用于控制设置页是否展示修改密码卡片；在无 SMTP 环境下，系统必须提供 CLI 设密/重置密码路径，并执行与服务端相同的密码更新语义。

#### 场景:当前用户读取到 `hasPassword`
- **当** 当前登录用户请求 `auth.info`
- **那么** 系统必须返回 `hasPassword` 布尔值，表示该用户是否已有密码哈希

#### 场景:管理员读取其他用户信息
- **当** 管理员通过 `users.info` 或 `users.list` 读取其他用户
- **那么** 系统不得在响应中暴露 `hasPassword` 字段

#### 场景:无 SMTP 时通过 CLI 重置密码
- **当** 管理员在无 SMTP 部署中运行 CLI 设密脚本
- **那么** 系统必须按 `{ teamId, email }` 定位用户，在事务中写入新密码哈希、清零锁定状态、轮转 `jwtSecret`，并写入标识为 CLI 来源的审计事件

## 修改需求

无。

## 移除需求

无。
