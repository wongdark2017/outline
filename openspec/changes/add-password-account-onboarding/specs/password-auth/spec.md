## 新增需求

无。

## 修改需求

### 需求:系统必须通过一次性 reset token 安全更新密码
系统必须支持三种互斥的密码更新语义：通过 reset token 重置密码、通过登录态 current password 修改密码，以及通过 invite activation token 首次设置密码。所有更新路径都必须使用显式事务、行级锁、事务内重新验证和 `rotateJwtSecret`；各类一次性 token 的消费必须以 Redis 原子消费或等效的单次判定为唯一权威。

#### 场景:reset token 路径成功更新密码
- **当** 用户提交合法的 `resetToken` 和满足策略的新密码，且 token payload、team、签名、Redis jti 状态都匹配
- **那么** 系统必须在事务内锁定目标用户、消费 jti、写入新密码哈希、清零锁定状态、轮转 `jwtSecret`、写入密码修改审计事件，并重定向到 `password-updated`

#### 场景:activation token 路径成功首次设密
- **当** 受邀成员提交合法的 activation token 和满足策略的新密码，且 token payload、team、签名、一次性状态和用户当前仍处于待激活状态都匹配
- **那么** 系统必须在事务内完成首次设密、账号激活、锁定状态清理和审计记录，并将该 token 视为已消费

#### 场景:reset 或 activation token 已消费或失效
- **当** reset token 或 activation token 已过期、已被消费、payload 不合法、签名不匹配、一次性状态损坏或目标用户不存在
- **那么** 系统必须拒绝密码更新并统一落到无效 token 结果，且不得返回 500

#### 场景:登录态修改密码成功后保留当前会话
- **当** 已登录用户通过 cookie transport 提交正确的 `currentPassword` 和满足策略的新密码
- **那么** 系统必须在事务内完成密码更新和 `jwtSecret` 轮转，并在事务提交后用新的 session token 重签 `accessToken` cookie，返回 JSON `{ success: true }`

#### 场景:登录态路径认证来源不合法
- **当** 请求使用 header、body 或 query 传入 session token，而不是 cookie transport
- **那么** 系统必须拒绝使用 `currentPassword` 路径更新密码，并返回 401 JSON 错误

### 需求:系统必须阻止 `/auth/password/*` 端点的 token transport 污染
系统必须禁止 `/auth/password/*` 请求体和 query string 出现名为 `token` 的字段，并通过严格 schema 约束 body 与 query 的合法字段集合。`/auth/password/update` 的 `resetToken`、`activationToken` 与 `currentPassword` 必须满足明确互斥关系。

#### 场景:请求体包含非法 `token` 字段
- **当** 客户端向任一 `/auth/password/*` 端点提交包含 `token` 或其他未声明字段的 body
- **那么** 系统必须在 validation 阶段返回 400，并且 password handler 不得执行状态变更

#### 场景:query string 非空
- **当** 客户端向任一 `/auth/password/*` 端点提交任何 query 参数，包括 `?token=...`
- **那么** 系统必须在 validation 阶段返回 400，并且 password handler 不得执行状态变更

#### 场景:update 提交多个鉴权字段
- **当** 客户端在 `/auth/password/update` 请求体中同时提交 `resetToken`、`activationToken`、`currentPassword` 中的多个字段
- **那么** 系统必须返回 400，并拒绝进入任一密码更新路径

#### 场景:update 缺少全部鉴权字段
- **当** 客户端在 `/auth/password/update` 请求体中没有提交 `resetToken`、`activationToken` 或 `currentPassword`
- **那么** 系统必须返回 400，并拒绝进入密码更新逻辑

### 需求:系统必须向当前用户安全暴露密码能力状态并提供无 SMTP 运维路径
系统必须仅向当前用户返回 `hasPassword` 布尔状态，用于控制设置页是否展示修改密码卡片；在无 SMTP 环境下，系统必须提供 CLI 设密/重置密码路径，并执行与服务端相同的密码更新语义。对于 invite shell user，系统必须能区分“无密码但待激活”和“普通无密码用户”。

#### 场景:当前用户读取到 `hasPassword`
- **当** 当前登录用户请求 `auth.info`
- **那么** 系统必须返回 `hasPassword` 布尔值，表示该用户是否已有密码哈希

#### 场景:管理员读取其他用户信息
- **当** 管理员通过 `users.info` 或 `users.list` 读取其他用户
- **那么** 系统不得在响应中暴露 `hasPassword` 字段

#### 场景:无 SMTP 时通过 CLI 重置密码
- **当** 管理员在无 SMTP 部署中运行 CLI 设密脚本
- **那么** 系统必须按 `{ teamId, email }` 定位用户，在事务中写入新密码哈希、清零锁定状态、轮转 `jwtSecret`，并写入标识为 CLI 来源的审计事件

## 移除需求

无。
