## 1. 首次安装管理员设密

- [x] 1.1 扩展 `server/routes/api/installation/schema.ts`，为 `installation.create` 增加管理员密码与确认密码字段校验。
- [x] 1.2 修改 `app/scenes/Login/components/WorkspaceSetup.tsx`，在首次安装表单中收集管理员密码与确认密码，并提供基础前端校验反馈。
- [x] 1.3 修改 `server/routes/api/installation/installation.ts`，在创建首个管理员时写入密码哈希而不是创建无密码账号。
- [x] 1.4 调整首次安装后的登录建立逻辑，确保创建成功后管理员直接进入已登录状态。

## 2. 邀请成员首次设密码激活

- [x] 2.1 在 password 插件中新增 invite activation token 的 payload、签名与一次性存储约定，并与 reset token 显式区分。
- [x] 2.2 扩展邀请发送链路，在 password auth 启用的 team 中为 invite shell user 生成 activation token。
- [x] 2.3 新增或调整邀请邮件模板，使受邀成员在 password auth 场景下收到“设置密码激活账号”的落地链接。
- [x] 2.4 修改 `/auth/password/update` schema 与 handler，支持 `activationToken` 路径，并在事务内校验 invite shell user 的待激活状态。
- [x] 2.5 为首次设密码激活补充专属审计语义与幂等控制，避免重复激活或重复副作用。

## 3. 前端激活与文案收口

- [x] 3.1 复用或扩展 `app/scenes/Login/ResetPassword.tsx`，使其能够根据 token 类型展示“重置密码”与“首次设置密码”两类文案。
- [x] 3.2 调整 password update 的成功/失败反馈，使激活 token 的结果与 reset token、登录态改密结果区分清楚。
- [x] 3.3 保持 `/create` 页面不暴露公开 password 注册入口，并在相关文案中继续强调这不是公开自助注册能力。

## 4. 测试与回归验证

- [x] 4.1 为首次安装管理员设密补充后端测试，覆盖成功创建、密码缺失/不匹配、已有 team 时拒绝安装。
- [x] 4.2 为 invite activation 补充后端测试，覆盖 token 生成、首次激活成功、重复消费、已激活用户复用 token、未启用 password auth 团队邀请。
- [x] 4.3 为安装页和激活页补充前端测试，覆盖密码表单、文案分支和提交流程。
- [x] 4.4 运行与 password auth、installation、invite 相关的针对性测试，确认现有登录、reset、CLI 设密和邀请行为未回归。
