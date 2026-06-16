## 上下文

Outline 现有认证入口由插件注册的 auth provider 驱动，服务端 `/auth` 路由统一挂载 provider router，前端登录页通过 `auth.config` 返回的 provider 列表决定展示分支。当前上游 intentionally 不提供密码登录，因此本仓库若要支持邮箱加密码，必须以 fork 级能力接入，并且尽量复用既有的 `signIn`、cookie、JWT secret 轮转、审计事件、CSRF 中间件和登录页框架，避免在核心认证链路上发散出第二套机制。

该变更跨越插件、数据库、用户模型、auth presenter、前端登录/设置页和无 SMTP 运维路径，同时包含新的原生依赖、账户爆破防护、一次性 token 消费和 cloud/self-host 能力边界，属于需要完整技术设计的改动。

## 目标 / 非目标

**目标：**

- 以 `plugins/password` provider 的形式为自托管部署提供邮箱加密码登录。
- 保证所有密码相关查找都在 team 作用域内完成，避免同邮箱多 workspace 串账号。
- 为登录、找回和改密提供可测试的安全边界：CSRF、防枚举、team 维度限流、失败锁定、reset token 一次性消费、会话轮转和审计。
- 在无 SMTP 时保留可操作的密码初始化与重置能力。
- 保持功能默认关闭，并保证 cloud-hosted 环境即使误配开关也不会暴露端点或 UI。

**非目标：**

- 不尝试让该能力 upstreamable，也不改变 Outline 官方“默认只委托外部 Provider”的产品策略。
- 不在首版引入 team 级 password 开关、MFA、密码强度评分、HIBP 泄露检查或管理后台一次性 set-password 链接。
- 不在 reset 成功后自动登录用户。
- 不修改 `/auth` 全局 optional auth 对有效 query token 的既有 activeAt 副作用。

## 决策

### 决策 1：password 以插件 provider 形式接入，并通过条件注册控制可达性

服务端 `/auth` 路由是基于 `PluginManager` 注册的全量 provider 动态挂载的。password 应该沿用这一机制，在 `plugins/password/server/index.ts` 注册 `Hook.AuthProvider` 与 `Hook.EmailTemplate`，而不是在核心 auth router 中硬编码新分支。真正的能力边界由“是否注册 hook”决定，而不是只靠前端隐藏。

备选方案是在 core auth router 或 `providersForTeam` 中加特判。该方案会扩大核心侵入面，而且即使隐藏前端，只要 provider 已注册，`/auth/password` 仍然可达，因此不采用。

### 决策 2：密码状态存储在 `users` 表，并在 `User` 模型中显式建模

密码相关状态必须进入 `User` 模型，而不是插件私表或 preferences，因为登录、会话轮转、审计和团队作用域都围绕现有 `User` 运行。新增字段为 `passwordHash`、`failedSignInAttempts` 和 `lockedUntil`；其中失败计数必须是 `NOT NULL DEFAULT 0`，以保证 SQL 原子递增语义。

备选方案是把密码状态拆到独立表。该方案会让登录路径多一次 join/查询，并把已有 `jwtSecret`、锁定状态和 presenter 能力拆散，收益不足，因此不采用。

### 决策 3：所有密码身份识别都先解析 team，再执行正式三键限流和用户查询

Outline 的 `users.email` 在系统内不是全局唯一，所有密码路径都必须以 `{ teamId, email }` 为查找键。登录和 reset 端点都先按 hostname 解析 team，然后执行基于 `ip`、`teamId:emailHmac`、`ip:teamId:emailHmac` 的正式限流，最后才查询用户。为了覆盖 team 不存在或 provider 不可用的探测流量，再额外加一个更宽松的 pre-team IP-only 限流。

备选方案是沿用全局 email 查找或只按 IP 限流。前者会串 workspace，后者无法阻断对单邮箱或单 team 的针对性攻击，因此不采用。

### 决策 4：reset token 使用 `user.jwtSecret` 签名，并以 Redis `GETDEL` 作为一次性消费权威

找回密码 token 采用 JWT，payload 固定为 `{ id, teamId, type, createdAt, jti }`，由 `user.jwtSecret` 签名，并在 Redis 中以 `password-reset:jti:<jti>` 记录一次性状态和值 `{ userId, teamId }`。update handler 在事务中锁定用户行后重新验签，再执行 `GETDEL` 进行权威消费，并核对 Redis value 与 payload。

备选方案是仅依赖 JWT 过期时间或先 GET 再 GETDEL。仅依赖 JWT 无法做到一次性消费；GET + GETDEL 在并发下会产生双重通过窗口，因此不采用。

### 决策 5：改密流程显式使用事务，argon2 hash 在事务外预计算

密码更新涉及密码哈希赋值、清零锁定状态、`rotateJwtSecret` 和审计事件，必须在显式事务中完成。为了缩短行锁持有时间，argon2 hash 通过 `User.hashPassword` 在事务前预计算，事务内只在 `SELECT ... FOR UPDATE` 后重新验证凭据并赋值 `passwordHash`。

备选方案是沿用实例 `setPassword` 在锁内直接 hash。该方案会显著放大并发等待和锁竞争，因此不采用。

### 决策 6：reset 成功后不自动登录；登录态改密通过重签 cookie 保留当前会话

邮件 reset 成功后统一跳回登录页 `?notice=password-updated`，要求用户重新走完整登录流程。登录态改密则在事务内基于轮转后的 `jwtSecret` 生成新的 session token，并在事务提交后写回 cookie，返回 JSON `{ success: true }`。

备选方案是 reset 后自动登录。该方案会把“邮箱被访问”扩大成“应用会话建立”，还要求 update 路径复刻完整登录分支的 suspended 检查、Desktop client 分支与相关审计，因此不采用。

## 风险 / 权衡

- 并发 reset / 改密竞争 -> 用行级锁、锁内重新验签和 Redis `GETDEL` 保证同一用户或同一 token 只能有一个成功路径。
- Redis 短暂故障影响成本防护 -> pre-team 限流和 EXISTS 成本闸门采用 fail-open；正式安全判定仍由正式限流、验签和事务内逻辑承担。
- `passwordHash` 泄露到 changeset 或 API 响应 -> 三个新增字段统一 `@SkipChangeset`，presenter 不暴露 hash，只新增当前用户可见的 `hasPassword` 布尔值。
- 前端 transport/CSRF 回退风险 -> `resetToken` 字段名、body `.strict()` 和空 query strict 共同钉死禁止把 `token` 放进 `/auth/password/*` 的 body 或 query。
- cloud/self-host 边界被未来重构打穿 -> 除条件注册外，三个 handler 入口再做一次 `PASSWORD_AUTH_ENABLED && !isCloudHosted` 兜底检查。
- 无 SMTP 环境可用性不足 -> 首版必须同时交付 CLI 设密脚本，不能只依赖邮箱找回。

## 迁移计划

1. 引入 `argon2` 依赖并更新 lockfile。
2. 添加 `users` 表迁移和 `User` 模型字段/方法。
3. 实现 password 插件 env、provider、邮件模板和三条 `/auth/password/*` 路由。
4. 对接 `auth.info`、`NON_SSO_SERVICES`、`presentUser` 和 `hasPassword` 前后端模型。
5. 实现 CLI `set-password` 脚本。
6. 扩展登录页、reset 页面、设置页和 notice。
7. 运行后端、前端、类型检查和相关测试。

回滚时关闭 `PASSWORD_AUTH_ENABLED` 即可让 provider、端点和前端入口自然消失。若需要彻底回退，再回滚迁移删除密码相关字段。关闭功能后 `/reset-password` 页面残留但提交会 404，不影响系统稳定性。

## 待确认问题

无。当前按 `docs/designs/outline-password-auth-plan-v3.28.md` 作为执行基线。
