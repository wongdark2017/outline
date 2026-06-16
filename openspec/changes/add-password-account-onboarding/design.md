## 上下文

当前仓库已经通过 `add-password-auth` 为自托管部署接入了 `password` provider，补齐了登录、忘记密码、重置密码、登录态改密和 CLI 设密路径。但这套能力默认假设用户已经存在且已拥有密码哈希，而现有 Outline 用户进入模型并不满足这一前提：

- 首次安装时，[`installation.create`](/root/outline/server/routes/api/installation/installation.ts:18) 只创建 team 和管理员用户，不设置密码。
- 受邀成员目前通过 shell user + email magic link 或 SSO 首登激活，[`userInviter`](/root/outline/server/commands/userInviter.ts:61) 不生成 password onboarding 信息。
- `/create` 页面上的 provider 选择器会显式隐藏 email/password 分支，[`AuthenticationProvider.tsx`](/root/outline/app/scenes/Login/components/AuthenticationProvider.tsx:214) / [249](/root/outline/app/scenes/Login/components/AuthenticationProvider.tsx:249)，说明现有产品模型并不支持公开 password 注册。

因此，真正缺的不是“再做一个注册页”，而是把 password auth 补齐到当前已经存在的两条账号创建路径：首次安装管理员创建、受邀成员激活。

## 目标 / 非目标

**目标：**

- 在首次安装流程中允许管理员在创建 workspace 时直接设置密码，并在成功后立即进入已登录状态。
- 为受邀成员提供一次性“首次设密码激活”能力，使 invite shell user 可以在不依赖 SSO 的情况下完成账号激活。
- 保持所有 password onboarding 都在 team 作用域下完成，并复用现有 password 插件的审计、限流、JWT secret 轮转和事务模型。
- 明确区分“password reset”和“invite activation”两类 token，避免语义混淆和越权使用。
- 保持公开产品边界不变：不引入面向任意访客的 password 自助注册，不允许通过根登录页直接注册加入已有 workspace。

**非目标：**

- 不提供默认初始账号或默认密码。
- 不实现公开注册、公开加入 workspace、基于 password 的新 workspace 自助创建。
- 不改变 `inviteRequired`、`allowedDomains`、SSO 首登等既有组织准入规则。
- 不在首版引入管理员批量发一次性设密链接、注册审批、验证码或 MFA。

## 决策

### 决策 1：首次安装直接收集管理员密码，而不是创建后再引导设密

首装场景已经有一条明确的“没有 team 时创建管理员”的同步流程：`WorkspaceSetup -> installation.create -> signIn`。最小改法是在这条链路上新增 `password` / `passwordConfirmation` 字段，由 `installation.create` 在创建 `User` 前直接写入 `passwordHash`。

这样做的理由：
- 首装是唯一确定“这就是该 workspace 第一个管理员”的时刻，不需要额外 token 往返。
- 成功创建后可直接沿用当前 `signIn(ctx, "password", ...)` 或兼容的本地登录态建立方式，不需要再跳一次激活页面。
- 这比“先创建无密码管理员，再发激活邮件/落到 reset-password 页”更短、更稳，也更适配无 SMTP 自托管场景。

备选方案是继续保持安装页只收 email/name，然后提示管理员用 CLI 设密或补一个“创建后立即激活”的二段流。该方案会把自托管首装重新推回运维路径，无法真正闭环，因此不采用。

### 决策 2：受邀成员首次设密激活沿用 invite 模型，不做公开注册

现有成员加入模型是“管理员邀请 -> 生成 shell user -> 用户首次激活”。password onboarding 应顺着这条模型走：如果一个用户是 `isInvited` 且没有密码，那么管理员邀请后，系统应提供一枚一次性 activation token，让用户设置密码并完成激活。

这样做的理由：
- 与现有 `userInviter` / `userProvisioner` 的组织准入边界一致，不需要重新定义“哪些陌生人可以注册进哪个 workspace”。
- 可以复用 shell user 记录、角色、`invitedById`、invite accepted 通知等既有机制。
- 避免把 password auth 扩张成“全局账号注册系统”，减少与 `inviteRequired`、`allowedDomains`、subdomain/custom domain 解析之间的交叉复杂性。

备选方案是增加一个公开 `/auth/password/register` 或 `/create` 上的 password provider，使任何人都能通过 email+password 建 workspace 或加入 workspace。该方案会直接引入组织归属、滥用防护和产品策略变更，不属于本次迭代，因此不采用。

### 决策 3：新增 invite-activation token 类型，与 password-reset token 分离

虽然“邀请后设密码激活”和“忘记密码重置”都通向“设置新密码”，但它们的授权语义不同：

- reset：用户已经是活跃账号，只是重置凭据。
- activation：用户是 shell invite user，首次把一个未激活账号变成活跃账号。

因此需要新增独立 token 类型，例如 `password-activation`，并在 payload/Redis key/handler 分支上与 `password-reset` 明确区分。两者可以共用同一页面组件与部分 update handler 逻辑，但不能复用同一 token type。

备选方案是把 invite 激活混进 `password-reset`。该方案会把“已激活账号重置”和“未激活账号首登”混淆在一起，审计、幂等与安全语义都不清楚，因此不采用。

### 决策 4：invite 激活页优先复用现有 `/reset-password` 页面外壳

前端已经有公开的 [`/reset-password`](/root/outline/app/scenes/Login/ResetPassword.tsx) 页面和对应的 `/auth/password/update` 提交流。对用户来说，“设置你的密码”与“重置你的密码”在交互结构上非常接近，差异主要在文案和成功后的跳转语义。

因此建议：
- 前端复用同一公开页面组件，通过 query token 解析出 token kind，展示 “Set password” 或 “Reset password” 文案。
- 后端复用 `/auth/password/update` 端点，但在 schema 和 handler 中接受两类 token，并在事务内根据 token kind 执行不同校验：
  - reset token 仅允许现有用户重设密码
  - activation token 仅允许 `isInvited` 用户首次设密激活

备选方案是再做一个单独的 `/activate-password` 页面和 `/auth/password/activate` 端点。该方案会复制大量前后端逻辑，收益不足，因此不采用。

### 决策 5：邀请邮件链路根据当前团队能力选择激活落地方式

现有 invite 主要围绕 email magic link。引入 password onboarding 后，受邀成员的落地方式至少有两种：

- 如果 workspace 启用了 password auth，邀请邮件应能把成员带到“设置密码激活”路径。
- 如果 workspace 没启用 password auth，现有 invite/email/SSO 行为应保持不变。

因此 invite 发送链路需要感知 team 当前可用 provider，并在 password auth 可用时生成 activation token 与相应链接。邮件模板可以是：
- 修改现有 InviteEmail，使其 CTA 指向 activation URL
- 或新增专用 PasswordInviteEmail/InviteActivationEmail

这里更推荐新增专用模板，原因是文案语义已从“受邀加入”扩展到“设置密码以激活账号”，拆开更清晰，且不强迫 SSO-only 团队继承 password 文案。

### 决策 6：首次设密激活应视为一次真实账号激活并记录专属审计事件

activation 不能只算一次普通密码修改。它实际上把 shell invite user 转为可用账号，因此需要明确的状态转换和审计：

- token 成功消费后，用户应具备 `hasPassword=true`
- `lastActiveAt` / `lastActiveIp` 应更新为首登时间
- 需要记录类似 `users.activate` 或带 `via: "password-activation"` 元数据的审计事件
- inviter 的 “Invite accepted” 通知逻辑应与首次激活保持一致，且不得重复触发

备选方案是复用现有 `users.update` 密码修改事件。该方案会丢掉“这是账号首次激活而非普通改密”的业务语义，因此不采用。

## 风险 / 权衡

- 邀请激活与重置密码共享页面和端点，分支过多 → 用明确 token kind、独立 validator 分支和独立审计事件收口。
- invite shell user 可能已经通过其他方式激活，再次使用 activation token 会出现双重激活竞争 → token 消费需一次性，事务内再次校验用户仍处于 invited/未设密状态。
- 首装时新增密码字段后，安装页校验复杂度提高 → 前端只做长度/确认密码基本校验，最终一致性由服务端 schema 保证。
- 邀请邮件在不同 provider 组合下需要不同 CTA → 先只覆盖 password auth 启用团队，其他团队保持旧路径，避免一次性重写全部邀请语义。
- 复用 `/reset-password` 可能让文案语义略混杂 → 通过 token kind 驱动标题、说明文案和成功提示，保持用户理解清晰。

## 迁移计划

1. 扩展首装 schema 与前端安装页，允许提交管理员密码。
2. 在安装 handler 中为首个管理员直接写入密码哈希，并验证安装后登录链路仍成立。
3. 为 password 插件新增 activation token 生成/消费逻辑和相应 validator 分支。
4. 扩展 invite 发送链路和邮件模板，在 password auth 启用时发放 activation 链接。
5. 复用或扩展 reset-password 页面，支持 activation token 文案与成功流。
6. 增加针对首装设密、invite 激活、重复消费、激活后再次使用 token、未启用 password auth 团队邀请等测试。

回滚策略：
- 若只回滚 onboarding 扩展，可保留既有 password auth 登录/重置能力，停发 activation token，并把安装页恢复为无密码字段。
- 已通过 onboarding 创建的密码哈希无需回滚删除；关闭 onboarding 只影响后续账号创建路径。

## Open Questions

- invite 激活成功后是否直接登录用户，还是只跳回登录页并提示“密码已设置，请登录”？我倾向于直接登录，因为这是首次账号激活，成功后进入 workspace 的期望更强。
- 受邀成员邮件模板是否复用现有 `InviteEmail`，还是新增专用 password activation 模板？我倾向于新增专用模板，避免混淆。
