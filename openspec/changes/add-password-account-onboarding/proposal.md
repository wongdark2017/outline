## 为什么

当前 password auth 只补齐了“已有账号如何用密码登录”，没有补齐“账号如何拿到第一个密码”。这导致自托管实例虽然能切换到账号密码登录，但首次安装创建的管理员账号没有密码，受邀成员也没有一条原生的首次设密激活路径，实际可用性仍然不完整。

## 变更内容

- 在首次安装流程中为管理员账号增加密码设置字段，并在 `installation.create` 时直接写入密码哈希后完成登录。
- 为受邀成员增加“首次设密码激活”能力，使 shell invite user 可以通过一次性激活 token 设置密码并完成账号激活。
- 扩展 password auth 流程和相关页面，使登录、邀请、激活、改密四条路径在同一套 team 作用域和审计模型下闭环。
- 明确排除公开自助注册；根登录页和 `/create` 仍不提供面向任意访客的 password 注册入口。

## 功能 (Capabilities)

### 新增功能
- `password-account-onboarding`: 为自托管 password auth 提供首装管理员设密与受邀成员首次设密激活能力。

### 修改功能
- `password-auth`: 将现有 password provider 的能力边界从“登录与重置”扩展到“账号初始化与激活”，并补充新的 token 类型、状态校验与前端入口约束。

## 影响

- 后端：`installation.create` schema/handler、invite 发送链路、password 插件 token 与 update 逻辑、用户激活与审计事件。
- 前端：首装 WorkspaceSetup、邀请落地页或 reset-password 页分支、登录页 `/create` 行为与相关 notice。
- 数据与安全：新增一次性激活 token 语义，要求区分 reset token 与 invite activation token，并保证 invite shell user 只能完成一次首次设密激活。
- 产品边界：继续沿用 team/invite 模型，不引入公开注册、公开加入 workspace 或默认初始账号/默认密码策略。
