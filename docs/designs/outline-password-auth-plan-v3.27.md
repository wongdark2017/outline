# Outline 邮箱 + 密码登录功能 — 技术方案 v3.27

> 目标:在自托管的 Outline(fork)中新增"邮箱 + 密码"登录方式。
> 状态:设计稿 v3.27(二十九轮代码评审后)· 适用版本:outline/outline main 分支(2026 上半年)
> 前稿:`outline-password-auth-plan-v3.md`(v3 / v3.1)、`-v3.2.md` ~ `-v3.26.md`。本稿为独立全文,以本稿为准。

## 变更记录

**v3.26 → v3.27(本轮)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium) | 登录三键限流写在 `User.findOne` 之后,超限请求仍会打到用户表查询 | §5.1 调整顺序为:解析 team 后先 consume 正式三键限流,再 `{teamId, email}` 查询用户;§8 / §9 测试 7 同步,要求超限时不进入用户查询或密码验证 |
| 2(Medium) | `lockedUntil` / `user.isSuspended` 检查仍写在 `user === null` 分支之前,照顺序实现可能再次 null 解引用 | §5.1 把状态预检查拆清:team 状态可在 team 存在后检查;所有 `user.*` 状态检查必须位于 `user !== null` 分支内;§8 / §9 同步 |
| 3(Medium-Low) | team 解析失败或 provider 不可用发生在 team-scoped limiter 前,未知 hostname/custom domain 探测可绕过 password limiter | §5.1 / §5.2 在 team 解析前新增 IP-only 预限流(`password-preteam:ip`),专门覆盖 unknown team / provider unavailable 请求;正式三键限流仍在 team 解析成功后执行 |
| 4(Low) | reset 的"无论邮箱是否存在都返回成功"没有说明 team/provider/SMTP 失败是否也中性返回 | §5.2 明确防枚举仅覆盖"team 已解析、provider 与 SMTP 可用、未触发限流"后的邮箱存在性;team/provider/SMTP 失败分别走拒绝或 503 |
| 5(Low) | 测试 7 只写"三键限流",容易误写成旧的全局 `emailHmac` 口径 | §9 测试 7 明确登录限流三键必须是 `ip` / `teamId:emailHmac` / `ip:teamId:emailHmac`,并覆盖预 IP 限流;reset 端点继续由测试 25 覆盖 |

**v3.25 → v3.26(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium) | 登录失败分支对"用户不存在"仍写成会访问 `user.id`(`User.increment`),`User.findOne` 返回 null 时空指针崩溃 | §5.1 第 5 步拆成两条路径:`user === null` → 仅 `argon2.verify(DUMMY_HASH, password)` + 模糊失败 redirect,不递增计数/不写锁定;`user !== null` → `verifyPassword` + 原子递增/锁定;§9 测试 5 补断言"不存在用户不 500、不写失败计数" |
| 2(Medium-Low) | 登录/reset 的 email 限流 key 未带 team 维度,同邮箱多 workspace 时 A workspace 攻击会限流 B workspace | §5.1/§5.2 限流 key 改为 `ip` / `teamId:emailHmac` / `ip:teamId:emailHmac`(team 解析在限流前完成);全局 `ip` key 保留作总体防护;§9 测试 4 补"同邮箱不同 workspace 限流互不污染"子用例;§8 同步 |
| 3(Low) | §12 工作量估算只写"25 项",未提 8b 的 EXISTS 成本闸门/降级断言,容易漏看 | §12 测试描述改为"25 项,含 8b 的 EXISTS 成本闸门/降级断言" |

**v3.24 → v3.25(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Low-Medium) | EXISTS 成本闸门没有测试钉住:§9 只覆盖 GETDEL 后二次使用被拒,没有断言"不存在 key 时跳过 argon2" | §9 测试 8b 扩展两个子断言:stub/spy `User.hashPassword`,当 Redis key 不存在时请求直接 expired-token 且 `hashPassword` 未被调用;当 EXISTS=1 但事务内 GETDEL=null 时仍拒绝(证明 EXISTS 不是权威判定) |
| 2(Low) | `redis.exists` 在事务外、两区 catch 之外,Redis 短暂故障会穿透成 500,方案未说明是否接受 | §5.3 EXISTS 代码块加 try/catch 降级:EXISTS 抛错时视为"无法判断,继续执行 hash + 事务内 GETDEL"——成本优化不改变用户可见错误形态;叙述段 + §8 同步 |
| 3(Low) | 旧轮次变更记录仍保留 `setPassword` 模式描述,全文搜索可能误导实现者 | 变更记录区域顶部加"落地口径声明":旧轮次记录保留原始评审语境,实现以 §4/§5.3/§6/§8 正文为准;不逐条改写旧记录 |

**v3.23 → v3.24(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium-Low) | reset/update 路径在权威 GETDEL 前先做 argon2 hash,可能放大异常状态下的重放成本。v3.23 的 `User.hashPassword` 在事务前执行,但 reset token 的 Redis 一次性消费要到事务内 GETDEL 才判定;"GETDEL 已消费但事务回滚"后的重试会先消耗一次 argon2 | §5.3 reset 分支在 hash 前加便宜的 Redis `EXISTS` 存在性预检(`jtiKey`),仅作为成本闸门——不存在即 token 已消费,跳过 argon2 直接 redirect;事务内 GETDEL 仍是唯一权威判定不变;§8 同步 |
| 2(Low-Medium) | 多处旧文案仍把事务内操作写成 `setPassword`,与 v3.23 的预计算模式冲突 | §5.3 事务要求段、§7.2 重置页说明、§9 测试 9 统一改为:事务前 `User.hashPassword` 预计算,事务内 `lockedUser.passwordHash = newHash` + 清锁 + save + rotateJwtSecret + 写事件 |
| 3(Low) | `hashPassword` 和 `setPassword` 都调用 `argon2.hash`,但只有 `verifyPassword` 标了 `@throws`;项目规范要求适用时写 `@throws` | §4 两个方法补 `@throws if argon2 hashing encounters a runtime error.` |

> **落地口径声明(v3.25)**:以下旧轮次变更记录保留原始评审语境,部分描述(如"事务内 `setPassword`")已被后续版本替代。**实现以正文 §4/§5.3/§6/§8 为最终落地口径**——正文中的代码片段、事务骨架、安全清单已同步至最新模式(事务前 `User.hashPassword` 预计算 + 事务内 `lockedUser.passwordHash = newHash` 赋值)。全文搜索 `setPassword` 时请以正文段落为准,忽略旧记录中的过时写法。

**v3.22 → v3.23(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium) | `/auth/password/reset` 缺少明确限流,容易变成邮件轰炸入口。§5.1 只给登录写了三键限流;§5.2 找回密码会生成 token、写 Redis、发邮件,但没有同等级限流 | §5.2 明确 reset 端点使用 reset 专用 limiter,按 `ip` / `emailHmac` / `ip:emailHmac` 消费,在用户查找前对所有邮箱统一执行(防枚举);§8 / §9 同步(测试 25) |
| 2(Medium-Low) | CLI 的 `findByPk` 示例没有 null 处理,和服务端骨架不一致。服务端 update handler 已手动处理 `lockedUser === null`;但 CLI 段落直接 `findByPk` 后调用 `lockedUser.setPassword`,`findByPk` 返回类型是 `User \| null`,TS 缺口 + 运行时风险 | §6 CLI `findByPk` 后补 null check,输出受控错误并回滚事务(与 §5.3 口径一致) |
| 3(Low-Medium) | argon2 hash 放在行锁内,锁持有时间偏长。`SELECT ... FOR UPDATE` 后才执行 `await lockedUser.setPassword(password)`,argon2 是故意昂贵的操作,放在 DB 行锁内会放大并发等待 | §4 新增 `hashPassword` 静态 helper(事务外预计算);§5.3 / §6 骨架改为事务前预计算 hash、事务内仅赋值 `lockedUser.passwordHash = newHash`;§8 同步 |

**v3.21 → v3.22(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium) | `hasPassword` 的"仅当前用户可见"缺少现有 presenter 支撑。`presentUser` 只有 `includeDetails`/`includeEmail` options,没有 `isMe`;且 `includeDetails` 不只用于当前用户,团队管理员读他人详情也会为 true(`server/policies/user.ts:33`) | §7.3/§8/§9:`presentUser` 新增 `includePasswordState?: boolean`,默认 false,仅在 `auth.info` 调用时传 true;管理员 `users.info`/`users.list` 看他人用户不返回 `hasPassword`;§9 补测试断言 |
| 2(Low-Medium) | 测试 8h 方案 B(先 `user.destroy()` 后发 POST)不会覆盖目标分支:预验证 `User.findOne` 在事务前执行,用户已删除会在预验证阶段直接 redirect,不会测到事务内 `findByPk` 返回 null | §9 测试 8h 删除方案 B,只保留 stub/barrier:让预验证 `findOne` 返回用户,事务内带 `lock` 的 `findByPk` 返回 null |
| 3(Low) | 8a 的 Redis 一致性断言写在"正常消费"内,但消费成功后 GETDEL 已删除 key,断言时机不明 | §9 测试 8a 拆分断言时序:生成 reset token 后、POST 前断言 key/value/payload 一致;消费成功后断言 key 已不存在 |
| 4(Low) | 前端 `hasPassword` 字段应明确不加 `@Field`——`@Field` 会进入 `toAPI()` 并随保存请求发回服务端;`hasPassword` 是只读能力状态 | §7.3 明确 `@observable hasPassword?: boolean`,不加 `@Field` |
| 5(Low) | JSDoc 片段仍未完全满足项目规则:`setPassword` 有 `@param` 无 `@returns`;`verifyPassword` 未标 `@throws` | §4 片段改到最终可过 review 的 JSDoc 形态:补 `@returns` / `@throws` |

**v3.20 → v3.21(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium) | `getPasswordResetToken()` 的 jti 生成与 Redis 写入接口不闭合:方法内部生成 jti 但只返回 token,调用方要么再 decode 一次刚生成的 token,要么容易误生成第二个 jti | §4/§5.2 `getPasswordResetToken` 改为返回 `{ token, jti }`,调用方先拿到 `jti` 再写 Redis,无需 decode;§8 同步;§9 补测试 8a 断言 Redis key 与 JWT payload 的 jti 一致 |
| 2(Medium) | CLI 段落仍写成先 save、再 rotateJwtSecret、最后 `User.update` 清零,与服务端 update handler 在同一实例上设置密码 + 清零锁定状态后一次 `save({ hooks: false })` 的模式不一致 | §6 CLI 落库要求改为与 §5.3 同口径:事务内锁定目标用户行,在 `lockedUser` 上 `setPassword` + 清零 `failedSignInAttempts`/`lockedUntil` → 一次 `save({ transaction, hooks: false })` → `rotateJwtSecret({ transaction })` → 写审计事件 |
| 3(Medium-Low) | 设置页"修改密码"卡片对 SSO-only 用户(`passwordHash = null`)行为未定义:这类用户没有 current password,提交必然失败 | §4 presenter 新增 `hasPassword` 布尔字段(仅在 current user 详情中暴露,不含敏感信息);§7.3 设置页用 `hasPassword` 控制卡片可见性;§8/§9 同步 |
| 4(Low) | `setPassword` / `verifyPassword` / `getPasswordResetToken` 代码片段仍无 JSDoc,与 v3.20 的 prose 要求不一致,且未匹配 `User.ts` 现有 arrow property 方法风格(如 `rotateJwtSecret = (options) => ...`) | §4/§5.2 代码片段改为最终形态:arrow property 方法 + JSDoc;删除 v3.20 的独立 prose 段(已融入片段) |
| 5(Low) | 测试 8h"用户在预验证后被删除"依赖真实并发窗口,偶发不稳定 | §9 测试 8h 补充确定性模拟方式说明:stub `User.findByPk` 在事务内返回 null,或在进入事务前受控 `destroy` 后再触发事务 |

**v3.19 → v3.20(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium) | 改密成功后没有清理锁定状态:骨架只做 `setPassword` / `save` / `rotateJwtSecret` / 写事件,但登录失败锁定在 §5.1 会阻止后续登录;CLI 重置明确会清零 `failedSignInAttempts` / `lockedUntil`,服务端 reset/update 也应在同一事务内清零——否则用户通过邮件成功重置密码后,仍可能因旧锁定状态无法立即登录 | §5.3 骨架在 `setPassword` 后、`save` 前加 `lockedUser.failedSignInAttempts = 0; lockedUser.lockedUntil = null;`,`hooks: false` 注释更新为覆盖 passwordHash + 锁定状态清零;§5.3 叙述 / §8 / §9 测试 9 同步 |
| 2(Medium-Low) | 骨架使用 `addSeconds` / `addMonths` / `subMinutes` 但 import 段未展示 `date-fns` 导入 | §5.3 骨架 import 补 `import { addMonths, addSeconds, subMinutes } from "date-fns"` |
| 3(Low) | handler 内最好显式复核 XOR——v3.19 依赖 schema `.superRefine()` 保证 `resetToken` / `currentPassword` 只出现一个,但分支实际是 `resetToken` 优先;若未来 validate 中间件被改动或绕过,会静默选择 reset 分支 | §5.3 骨架在构建鉴权上下文前加显式 XOR guard:`if ((resetToken !== undefined) === (currentPassword !== undefined)) { throw ValidationError(...) }`;作为 schema 层之后的纵深防御 |
| 4(Low) | 测试 8 已塞进 Redis 坏值、payload 缺字段、非法日期、未来时间、用户被删除等多个边界,建议拆分为独立子用例,方便定位回归 | §9 测试 8 拆为 8a–8i 九个子用例 |
| 5(Low) | 新增 User 方法 `setPassword` / `verifyPassword` / `getPasswordResetToken` 属于公开模型方法,按项目规范应补 JSDoc | §4 新增方法段补 JSDoc 要求说明 |

**v3.18 → v3.19(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium-High) | `resetToken` 本身未被 TypeScript 收窄:zod `.superRefine()` XOR 是运行时校验,不产生类型 narrowing——`else` 分支内 `resetToken` 仍为 `string \| undefined`,`getJWTPayload(resetToken)` / `JWT.verify(resetToken, ...)` 类型不过;需显式 `if (resetToken !== undefined)` + `const token = resetToken` 收窄并固定 const 绑定 | §5.3 骨架分支改为 `if (resetToken !== undefined) { const token = resetToken; ... } else if (currentPassword !== undefined) { ... } else { throw ValidationError(...) }`;reset 分支内全部用 `const token`(const 绑定在闭包内保持 narrowing);else fallback throw 满足 TypeScript 穷尽检查 |
| 2(Medium) | `createdAt > new Date()` 未来时间检查在多实例/容器部署下过于严格:签发实例与验证实例时钟可能有数十秒偏差,正常签发的 token 会被误判为"未来时间" | §5.3 `createdAt > new Date()` 改为 `createdAt > addSeconds(new Date(), 60)`,允许 60 秒时钟偏差容忍窗口;§8 同步 |
| 3(Medium) | `rejectOnEmpty: true` 在 `User.findByPk` 上——若用户在预验证后、事务锁前被删除,`EmptyResultError` 不在 catch 的 `instanceof` 范围内,穿透为 500;reset 路径应降级为 redirect 而非 500 | §5.3 去掉 `rejectOnEmpty: true`,改为手动 null 检查:reset 路径 → `ResetTokenConsumedError`(redirect);login 路径 → `AuthenticationError`(401 JSON);§8 同步 |
| 4(Low) | 两区 catch 叙述写"登录态路径错误在两个 catch 之前抛出,不被捕获",但登录态的事务内 `verifyPassword` 抛出的 `ValidationError` 确实会经过区域二 catch——只是因为 `updateContext.kind === "login"` 直接 re-throw,不会被吞掉;描述应更精确 | §5.3 叙述 / §8 更新:登录态路径错误分两类——构建 `LoginContext` 阶段的错误在两区之前抛出;事务内 `verifyPassword` 的 `ValidationError` 经过区域二 catch 但因 `kind === "login"` 直接 re-throw,行为正确但不能说"不被捕获" |
| 5(Low) | `isPasswordResetPayload` 类型守卫用 `as Record<string, unknown>` 绕过类型检查——项目已广泛使用 zod,改用 `PasswordResetPayloadSchema.safeParse()` 风格一致且无需 `as` 断言 | §5.3 将 `PasswordResetPayload` 接口 + `isPasswordResetPayload()` 函数替换为 `PasswordResetPayloadSchema`(zod `.object()`)+ `safeParse()`;import 补 `z from "zod"`;§8 同步 |

**v3.17 → v3.18(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium-High) | `user` / `payload` / `jtiKey` 的类型收窄不够:事务闭包内直接用 `user.id`、`jtiKey`、`payload.id`,但这些变量只在 `isResetTokenPath` 分支赋值,TypeScript 无法从布尔推断它们已定义——实现者容易写出不可编译代码 | §5.3 骨架引入 discriminated union(`ResetContext \| LoginContext`),鉴权结果归一到 `updateContext` 对象,事务内用 `updateContext.kind === "reset"` 收窄,编译器保证字段存在;消除所有 `isResetTokenPath` / `isLoginStatePath` 布尔判断 |
| 2(Medium) | reset payload 缺少结构化校验:`payload.createdAt as string`、`payload.id as string` 依赖 `as` 断言,但 `JWT.JwtPayload` 的自定义字段本质上是 `unknown`(`@types/jsonwebtoken/index.d.ts:123`),缺 shape validation 则后续访问无类型保证 | §5.3 新增 `PasswordResetPayload` 接口 + `isPasswordResetPayload()` 类型守卫,decode 后立即校验 `id` / `teamId` / `type` / `createdAt` / `jti` 存在且为 string,失败归一化为 `ResetTokenConsumedError`;通过后类型收窄,后续访问不再需要 `as` 断言;§8 同步 |
| 3(Medium) | `createdAt` 校验对无效日期和未来时间不严:`new Date(undefined)` / `new Date("abc")` 产生 Invalid Date,与 `subMinutes(...)` 比较为 `false`,等于没有判过期;且未拒绝未来时间——时钟异常或篡改可将 token 有效期拉长至无限 | §5.3 `createdAt` 校验改为先 `new Date(rawPayload.createdAt)` 再 `Number.isFinite(getTime())` 防 Invalid Date,再拒绝未来时间(`createdAt > new Date()`),最后判 15 分钟过期;§8 同步 |
| 4(Medium) | Redis value 解析失败变 500:`JSON.parse(consumed)` 对坏值抛 `SyntaxError`,不在外层 catch 的 `instanceof` 范围内,穿透为 500;`{ userId, teamId }` shape 也未校验 | §5.3 事务内 `JSON.parse` 包裹 try/catch 转 `ResetTokenConsumedError`;shape 校验失败同理;§8 同步;§9 测试 8 补"Redis value 非 JSON / 字段缺失 → expired-token 不 500" |
| 5(Low) | `InternalError` guard 用了但 import 中未列出;`AuthenticationError` / `ValidationError` 同样在骨架中使用但无 import——照抄时编译缺口 | §5.3 骨架 import 补 `import { AuthenticationError, ValidationError, InternalError } from "@server/errors"` |

**v3.16 → v3.17(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(High) | `import JWT from "@server/utils/jwt"` 不成立:`server/utils/jwt.ts` 没有 default export(`server/utils/jwt.ts:8`),只导出 `getJWTPayload` / `getUserForJWT` 等具名函数;`JWT.verify` / `JWT.sign` 是 `jsonwebtoken` 原生方法,`server/utils/jwt.ts:2` 内部 `import JWT from "jsonwebtoken"` 但不重新导出 | §5.3 骨架 import 改为 `import JWT, { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken"` + `import { getJWTPayload } from "@server/utils/jwt"`;全文删除"Outline 封装用 `JWT`(`@server/utils/jwt`)"说法;§8 / 参考文件清单同步 |
| 2(Medium) | 骨架 `try` 块内 reset token 事务前预验证只有注释,未展示 `payload` / `team` / `user` / `jtiKey` 如何生成;实现者容易把部分逻辑写到 `try` 外,重新暴露 500;且 `getJWTPayload` 抛出的是 `AuthenticationError`(`httpErrors` 工厂函数返回值,不是 class),外层 catch 的 `instanceof` 不匹配——变 401 JSON 而非 redirect | §5.3 骨架在 `try` 块内补全 reset 预验证的可执行代码:decode → type → createdAt → team 核对 → user lookup → 首次验签;所有预验证失败归一化为 `ResetTokenConsumedError`(内层 try/catch 包裹 `getJWTPayload` 和 `JWT.verify`),外层 catch 统一 redirect;叙述 / §7.2 / §8 同步 |
| 3(Medium-Low) | `newAccessToken` 事务回调返回 `string \| null`,但登录态路径 `ctx.cookies.set` 直接使用——TypeScript 未必能证明非 null | §5.3 骨架在非 reset 分支设置 cookie 前加 `if (!newAccessToken) throw InternalError(...)` guard |
| 4(Low) | 测试 24 写"最终密码是第一个成功事务设置的那个",但并发下"第一个"顺序不稳定,无测试屏障控制 | §9 测试 24 改为"最终密码匹配唯一成功响应对应的新密码" |
| 5(Low) | 测试 21 / 23g 只断言 400(非 401),未断言前端不触发 `stores.auth.logout()`——这是 401→400 改动的真实回归风险点 | §9 测试 21 / 23g 补充"前端收到 400 不触发 logout"断言 |

**v3.15 → v3.16(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(High) | `AuthenticationType.APP` 不等于 cookie/session:`parseAuthentication` 先读 header/body/query 再读 cookie(`:84`),非 API/OAuth 的 JWT 全部落入 `else` 分支赋值 `APP`(`:242`);只检查 `type === APP` 仍放过 `Authorization: Bearer <session JWT>` | §5.3 登录态路径改为检查 `parseAuthentication(ctx).transport === "cookie"`(当前 `ctx.state.auth` 不含 `transport`,`server/types.ts:57`);§8 安全清单同步;§9 测试 23d 补"有效 APP session JWT 走 header 时必须拒绝" |
| 2(High) | 只覆盖了"同一 reset token 并发",没覆盖"同一用户多个不同 reset token 并发":两个不同 token 可同时在事务外用旧 `jwtSecret` 验签通过,各自 GETDEL 成功,最后一次提交覆盖前一次密码——打破 `rotateJwtSecret` 使其余 token 失效的承诺 | §5.3 事务骨架:进入事务后先 `SELECT ... FOR UPDATE` 锁定用户行,锁内重新验签 reset token / verifyPassword,再执行 `setPassword` + `rotateJwtSecret`;补 §9 测试 24 |
| 3(Medium) | 登录态 cookie 重签显式设了 `domain`,但现有非 cloud `signIn` 设置 accessToken 时不带 `domain`(`server/utils/authentication.ts:137`);password 首版 self-host only,显式 `Domain=localhost` 或 IP 场景可能被浏览器拒收 | §5.3 骨架删掉 `domain`,复刻现有 self-host accessToken cookie 参数:`sameSite: "lax"` + `expires` |
| 4(Medium) | reset token 失败路径:事务内 `throw new Error("Reset token already consumed")` 按常规变 500;但 §7.2 要求失败 redirect 到 `?notice=expired-token` | §5.3 使用自定义领域错误 `ResetTokenConsumedError`,事务外 reset 分支统一 catch → redirect `?notice=expired-token`;骨架补 try/catch 结构 |
| 5(Medium) | 设置页 `currentPassword` 失败响应未写清楚:成功 JSON 已有,但密码错误/非 cookie auth/未登录等失败也必须返回 JSON HTTP error,不能走 302/HTML(否则 `ApiClient` 解析失败) | §5.3 补登录态失败路径:错误当前密码 → 401 JSON;非 cookie transport → 401 JSON;未登录 → 401 JSON;§9 测试 23 补充 |
| 6(Low) | §12 估算表写"21 项",但 §9 已到 24 项 | 同步测试项数 |

**v3.13 → v3.14(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(High) | reset token 的 GET + 后续 GETDEL 存在并发绕过:两个并发请求都可能先通过 GET,第二个请求的 GETDEL 返回 null 后仍继续改密 | 去掉验证阶段的 GET;改为事务内**只做一次 GETDEL**,以其返回值作为权威判定——返回 null 立即拒绝;返回 value 再核对 `{ userId, teamId }`;补 §9 测试 22 并发双提交 |
| 2(Medium) | 登录态改密路径只说"当前 session",但 optional auth 会接受 OAuth header、API key、APP JWT 等多种认证来源;改密应只接受 APP session | §5.3 / §7.3 写死:`currentPassword` 路径必须 `ctx.state.auth.user` 存在且 `ctx.state.auth.type === AuthenticationType.APP`;补 §9 测试 23 |
| 3(Medium) | `ServiceUnavailableError` 的服务端定义不成立——`server/errors.ts` 没有这个 helper;客户端侧 `ApiClient` 对 503 会映射为 `ServiceUnavailableError` | §5.2 / §9 改为"服务端返回 HTTP 503 JSON 错误",实现方式为新增 `server/errors.ts` 的 `ServiceUnavailableError` helper(或直接 `httpErrors(503, ...)`) |
| 4(Medium) | `resignSession(ctx, user)` 过于抽象;`signIn` 会 `updateSignedIn`、写 `users.signin` 事件并 redirect,不能直接复用 | §5.3 骨架将 `resignSession` 替换为具体实现:生成 `user.getSessionToken(expires, "password")` → 设置 `accessToken` cookie(sameSite lax,3 个月过期)→ 不写 `users.signin` 事件、不 redirect;§9 测试 21 补断言 |
| 5(Low) | §7.1 写"防枚举恒返回 success"与 §5.2 SMTP unavailable 返回错误矛盾 | 改为"SMTP 可用时恒返回 success(防枚举);SMTP 不可用时返回 503" |
| 6(Low) | 文档版本标签残留(如 CLI 标题仍写 v3.12) | 统一清理版本标签 |

**v3.12 → v3.13(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1 | §11 仍写"3 个字段全部 nullable",与 §4 的 `failedSignInAttempts INTEGER NOT NULL DEFAULT 0` 冲突 | §11 改为"passwordHash / lockedUntil nullable,failedSignInAttempts NOT NULL DEFAULT 0" |
| 2 | §7.3 设置页只说 RPC POST,没有规定成功响应形态。`ApiClient` 对 2xx 会 `response.json()`(`app/utils/ApiClient.ts:182`),如果 update handler 对登录态路径也复用 302/HTML,设置页会解析失败 | §5.3 / §7.3 明确:登录态路径(`currentPassword`)成功返回 JSON `{ success: true }` + 重签 cookie,不做 302;只有 `resetToken` native form 路径使用 302;§9 补测试 21 |
| 3 | §5.3 验证链第 5 步 jti GETDEL 位置读起来像"鉴权阶段即消费",与后文"放在事务内"有顺序歧义 | §5.3 验证链第 5 步改为"校验 jti 存在性(GET,不消费);GETDEL 统一在事务块内执行",消除歧义 |
| 4 | §9 测试 12 只覆盖 `EMAIL_ENABLED = false`,未覆盖 `EMAIL_ENABLED = true` 但 `SMTP_FROM_EMAIL` 缺失 | §9 测试 12 拆成 12a / 12b 两个子用例 |
| 5 | §5.3 reset 路径 `Event.create` 绕开 context 后缺少显式 `authType` | reset 路径 `Event.create` 补 `authType: null`(匿名重置,无认证类型) |
| 6 | §5.3 `hooks: false` 注释应限定作用域,防止维护者把更多字段塞进同一次 save | 注释补"仅允许用于只保存 passwordHash 的这一次 save;不要把 failedSignInAttempts / lockedUntil / jwtSecret 合并进这次 save" |

**v3.11 → v3.12(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(High) | §4 写"3 个字段均 nullable",但 `failedSignInAttempts` 后续依赖 SQL 原子 `increment`。若列允许 NULL,`NULL + 1` 仍可能是 NULL,锁定策略失效 | §4 migration 与模型声明改为 `failedSignInAttempts INTEGER NOT NULL DEFAULT 0`(模型加 `@AllowNull(false)`);只有 `passwordHash` / `lockedUntil` nullable;§4 总览行文同步 |
| 2(High) | §5.3 reset 改密审计会被已有 cookie 污染。`/auth` provider 前置 `authMiddleware({ optional: true })`,`Event.createFromContext` 会优先用 `ctx.state.auth.user` 覆盖传入的 `defaultAttributes`(`:184`)。用户带 A 账号会话打开 B 的 reset 链接时,事件记成 A actor/team | §5.3 事务骨架改为:reset token 路径在写事件前显式隔离 auth context(`ctx.state.auth = {}`)或改用 `Event.create` 绕过 context 解析;补 §9 测试 19"已登录为另一个用户时消费 reset token,事件归属 token 目标用户" |
| 3(Medium) | §5.3 Redis jti 原子消费与 DB transaction 的一致性边界未说明。先 GETDEL 后事务回滚会导致"链接已失效但密码未改" | §5.3 补"jti 消费时序"段:GETDEL 放在事务内、事务提交后生效(或接受"回滚后 token 已消耗,用户需重新发起 reset"的 tradeoff 并写明) |
| 4(Medium) | §5.2 用 `env.EMAIL_ENABLED` 判断 reset 邮件可用不够精确。`BaseEmail.schedule()` 在 `SMTP_FROM_EMAIL` 缺失时直接 no-op(`:58`),而 `EMAIL_ENABLED` 只看 `SMTP_HOST \|\| SMTP_SERVICE \|\| development` | §5.2 服务端 reset 可用性改为 `env.EMAIL_ENABLED && !!env.SMTP_FROM_EMAIL`;前端仍只读 `EMAIL_ENABLED`(无法读非 @Public 的 `SMTP_FROM_EMAIL`),但 §5.2 端点在条件不满足时返回明确错误,前端准备 unavailable 展示 |
| 5(Medium) | §5.3 事务骨架的 `user.save({ hooks: false })` 应解释清楚——它不只跳过 changeset,也跳过所有 User update hooks 和 validation;且 `rotateJwtSecret` 不应使用 `hooks: false` | §5.3 骨架注释改为明确说明 `hooks: false` 的意图与边界;`rotateJwtSecret({ transaction })` 调用不带 `hooks: false`(其内部 `this.save(options)` 走正常 hooks) |
| 6(Medium) | §6 CLI 初始化/重置路径缺少落库语义——是否走 `rotateJwtSecret`、事务、审计事件未明确;无 SMTP 场景管理员重置密码后旧会话可能继续有效 | §6 补 CLI 落库要求:必须使用 `setPassword` + `rotateJwtSecret` + 事务 + 清零 `failedSignInAttempts`/`lockedUntil`;是否写审计事件明确为"写 `users.update` 事件,`actorId` 为执行者(管理员)或 null(脚本上下文无 ctx)" |
| 7(Low) | §3 说 email/passkeys"没有 authUrl"不准确——`providerConfig.ts:4` 对所有 provider 都返回 `authUrl` | 改为"email / passkeys 虽有 `authUrl`,但前端按 `id` 走硬编码特殊分支" |
| 8(Low) | §5.1 `emailHash` 建议明确为带密钥 HMAC;裸 SHA 邮箱仍可字典枚举 | 改为 `emailHmac`(HMAC-SHA256,密钥取 `SECRET_KEY`) |
| 9(Low) | §5.5 端点兜底写"404/403",但 §9 测试 2 期望 404 | 统一为 404 |

**v3.10 → v3.11(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium) | §5.3 的 `Event.createFromContext` 事务参数位置写错:示例把 `{ transaction }` 作为第 3 个参数,但真实签名是 `createFromContext(ctx, attributes, defaultAttributes, options)`,事务 options 是第 4 个参数(`server/models/Event.ts:172`);且 reset token 路径通常是匿名请求,`ctx.state.auth.user` 为空,应显式传 `actorId/teamId` 默认值 | §5.3 事务骨架改为 4 参数形式:`Event.createFromContext(ctx, { name, userId, data }, { actorId: user.id, teamId: user.teamId }, { transaction })`;§8 安全清单同步 |
| 2(Medium) | §9 测试 18 并发错误密码断言过强:要求 `N ≥ 阈值` 时 `failedSignInAttempts` 精确等于 N,但 §5.1 流程先检查 `lockedUntil`,一旦部分请求先设置锁定,后续请求可能直接走 locked 分支不再递增,精确等于 N 会和锁定策略互相打架 | §9 测试 18 拆成两个子用例:18a `N < 阈值` 并发时断言计数精确等于 N(钉死原子 increment);18b `N ≥ 阈值` 断言 `lockedUntil` 被设置、计数至少达到阈值且不低于阈值前的增量(允许锁定后部分请求走 locked 分支不再递增) |
| 3(Low) | §5.0 `activeAt` 元数据说明少了闭合括号/加粗边界 | 修正为 `activeAt 类活跃元数据（\`lastActiveAt\`、\`lastActiveIp\`、客户端标记）` |

**v3.9 → v3.10(上轮,已收口)**

| # | 评审意见 | 处理 |
|---|---|---|
| 1(Medium) | §5.5 注册条件只有 `env.PASSWORD_AUTH_ENABLED`,未包含 `!env.isCloudHosted`;cloud-hosted 误开时端点可达,且 `providersForTeam` 在无 team 上下文时返回全部非 email/passkeys provider(`server/models/helpers/AuthenticationHelper.ts:65`),root 登录页会展示 password | §5.5 注册条件与端点兜底都改为 `env.PASSWORD_AUTH_ENABLED && !coreEnv.isCloudHosted`;env 骨架补 `import coreEnv from "@server/env"`;§5.4 补 `providersForTeam` 无 team 分支说明;§8 / §9 同步 |
| 2(Medium) | §5.3 的 `setPassword` → `rotateJwtSecret` → 写事件需要事务保证;`/auth` app 不像 `/api` 有 `transaction()` 中间件;`User.rotateJwtSecret` 真实签名是 `(options: SaveOptions)` 不是无参 | §5.3 补"handler 内必须 `sequelize.transaction()`"段,给出 update handler 的事务骨架(含 `{ transaction }` 传参);修正全文对 `rotateJwtSecret` 的调用写法;§8 / §9 同步 |
| 3(Medium) | §5.1 失败计数写 `failedSignInAttempts += 1` 是读-改-写,并发错误登录会丢增量 | §5.1 改为 `User.increment('failedSignInAttempts', { where: { id: user.id } })`(Sequelize 原子 `UPDATE … SET … = … + 1`;先例 `View.incrementOrCreate`,`server/models/View.ts:74`);锁定检查改从 `increment` 返回的最新值判断(或 `RETURNING` 取当前值);清零同样用 `User.update({ failedSignInAttempts: 0 }, { where })`(幂等);§9 补测试 18 并发失败计数 |
| 低风险 | §5.0"activeAt 类活跃时间戳"不完整:`user.updateActiveAt` 还写 `lastActiveIp` 与客户端标记 | 改为"activeAt 类活跃元数据(`lastActiveAt`、`lastActiveIp`、客户端标记)" |
| 文案 | §7.2 CSRF 说明中"现有 email 登录 native form"不准确——初始 email 登录走 `ApiClient` RPC POST,只有 passkeys 与部分 callback 场景有 client-side POST/跳转 | 改为"现有 passkeys native form POST 的安全姿态一致" |

**v3.8 → v3.9(上轮,已收口)**:`?token=` 断言收窄——`/auth` provider router 前置 `authMiddleware({ optional: true })`(`:26`),有效 query token 会先刷新 activeAt 类活跃元数据再被 strict schema 400;测试 14e 断言改为"password handler 未执行 + 密码/失败计数/password 相关 events 未变化",不断言全局无状态变更;"`/auth` 全局层拦截 query token"列入 §10。

**v3.7 → v3.8(更早,已收口)**:`token` 字段红线从 body 扩展到 query——`parseAuthentication` 取 token 顺序 body → query → cookie(`server/middlewares/authentication.ts:105` / `:114`),`?token=` 同样污染 transport 使 CSRF 被跳过;三个 schema 加 `query: z.object({}).strict()`;update schema 以 `.superRefine()` 实现 `resetToken` / `currentPassword` 的 XOR + `.min(1)` 防空串;`/reset-password?token=` 页面 URL 保留(SPA GET 路由,不在红线范围)。

**v3.6 → v3.7(更早,已收口)**:`/auth/password/*` 的 body schema 必须 `.strict()` 并枚举全部合法字段(含 `_csrf`、`client`);同时明确中间件执行顺序——`verifyCSRFToken` 先于 route validation,schema 拒绝只是纵深,不能替代 body 字段改名对 CSRF 的修复。

**v3.5 → v3.6(更早,已收口)**:reset token 请求体字段改名 `resetToken`(High——body `token` 会被 `parseAuthentication` 当认证 token,CSRF 失效)。

**v3.4 → v3.5(更早,已收口)**:前端 RPC 调 `/auth` 必须显式 `{ baseUrl: "/auth" }`;reset 不自动登录;`ResetPassword.tsx` 复用 Login 视觉体系。

**v3.3 → v3.4(更早,已收口)**:3 密码字段全部 `@SkipChangeset`;审计改显式事件 `data`;补前端 reset 闭环。

**v3.2 → v3.3(更早,已收口)**:reset token payload 写死并 `user.jwtSecret` 签名;`User` 模型补 `@Column`;`providersForTeam` 零修改;插件 env 完整骨架。

**v3.1 → v3.2(更早,已收口)**:条件注册;team 作用域;`isNewUser: false`;`PASSWORD_AUTH_ENABLED` 插件本地 env;`yarn add argon2`。

**v3 → v3.1(更早,已收口)**:`signIn` 签名修正;CSRF hidden input;suspended 预检查;notice 文案。

**v2 → v3(更早,已收口)**:路径风格路由;`Hook.EmailTemplate`;CLI 脚本;删 `passwordChangedAt`;team 级开关移 §10。

**v1 → v2(最早,已收口)**:插件机制;async 方法;无 SMTP 路径;专用限流;`rotateJwtSecret()`。

---

## 1. 背景与前提

Outline 官方刻意不提供密码登录,认证完全委托给外部 Provider,这是出于安全考虑的产品决策。由此:

1. **该功能上游不会合并**,属于 fork 级改动,需要长期自己维护(BSL 1.1 允许自托管修改,无合规问题)。
2. 密码体系的"找回/首次设密"默认依赖邮件。**无 SMTP 部署必须实现 §6 的非邮件初始化路径,并禁用"忘记密码"入口**。

## 2. 零代码替代方案(建议先评估)

| 方案 | 说明 | 适用场景 |
|---|---|---|
| SMTP 魔法链接 | 内置邮箱登录:输入邮箱 → 收一次性登录链接 | 有 SMTP、能接受无密码流程 |
| 前置 IdP(推荐) | Keycloak / Authentik 走 OIDC,密码、MFA、找回全套都有 | 愿意多维护一个轻量服务 |

确认都不满足(典型:内网无 SMTP 且不想加服务)再实施本方案,并按 §6 选定密码初始化方式。

## 3. 总体设计

**核心原则:以 `plugins/password` 插件的身份加入 Provider 体系,复用 `signIn`、cookie、审计与登录页配置。**

当前代码中 auth provider 是插件注册制:

```
plugins/<name>/plugin.json                  ← 插件声明
plugins/<name>/server/index.ts              ← PluginManager.add([{ type: Hook.AuthProvider, … },
                                                                  { type: Hook.EmailTemplate, … }])
server/routes/auth/index.ts                 ← 遍历 AuthenticationHelper.providers(全量已注册 hook),
                                               动态挂载到 /auth/<id>
```

> **注意**:路由挂载读的是 `AuthenticationHelper.providers`——即 `PluginManager.getHooks(Hook.AuthProvider)` 全量列表(`server/models/helpers/AuthenticationHelper.ts:16`);`providersForTeam` 只用于 `auth.config` 的登录页展示过滤。**"注册了就可达"**,因此开关必须控制注册本身,见 §5.5。另外每个 provider router 挂载时都统一套了一层 **`authMiddleware({ optional: true })`**(`server/routes/auth/index.ts:26`)——password 路由进入 handler 前,请求中携带的任何有效凭据都已被解析进 `ctx.state.auth`,这对 §5.0 的 query 向量分析有影响。

前端取数:`app/stores/AuthStore.ts` 调用 **`client.post("/auth.config")`**(RPC 风格,均为 POST),服务端经 `server/presenters/providerConfig.ts` 返回 `{ id, name, authUrl }`。email 与 passkeys 虽有 `authUrl`,但前端在 `app/scenes/Login/components/AuthenticationProvider.tsx` 中按 `id` 走**硬编码的特殊分支**——password 照此模式做第三个分支。

### 改动文件总览

```
plugins/password/plugin.json                          ★ 插件声明
plugins/password/server/index.ts                      ★ 条件注册 Hook.AuthProvider + Hook.EmailTemplate
                                                        (参照 oidc;条件含 !coreEnv.isCloudHosted,§5.5)
plugins/password/server/env.ts                        ★ 插件本地 env:PASSWORD_AUTH_ENABLED(完整骨架见 §5.5)
plugins/password/server/auth/password.ts              ★ 路由:登录 / reset / update(update 需显式事务,§5.3)
plugins/password/server/auth/schema.ts                ★ zod 校验 schema(body .strict() + 字段枚举,
                                                        query 空 strict,update 加 XOR,§5.0)
plugins/password/server/auth/password.test.ts         ★ 集成测试
plugins/password/server/email/PasswordResetEmail.tsx  ★ 找回邮件模板(经 Hook 注册)
server/migrations/XXXX-add-user-password.js           ★ 数据库迁移(3 字段)
server/models/User.ts                                 ✎ 3 个 @Column 字段声明(全部 @SkipChangeset)+
                                                        setPassword / verifyPassword /
                                                        getPasswordResetToken 方法(§4、§5.2)
server/routes/api/auth/auth.ts                        ✎ NON_SSO_SERVICES 加入 "password"
server/presenters/user.ts                             ✎ 新增 includePasswordState option + hasPassword 字段(§7.3,fix v3.21/v3.22)
server/scripts/set-password.ts                        ★ 无 SMTP 初始化路径(§6)
package.json                                          ✎ 新增 argon2 依赖 + yarn script(yarn 安装,更新 yarn.lock)
app/routes/index.tsx                                  ✎ 新增公开路由 /reset-password(§7.2)
app/scenes/Login/ResetPassword.tsx                    ★ 重置密码公开页面,复用 Login 视觉体系(§7.2)
app/scenes/Login/components/AuthenticationProvider.tsx ✎ id === "password" 分支(含"忘记密码"子状态)
app/scenes/Login/components/Notices.tsx               ✎ 新增 password-auth-failed / password-locked /
                                                        password-updated 文案
app/scenes/Settings/(个人 Profile/Preferences)        ★ 修改密码卡片
server/models/helpers/AuthenticationHelper.ts         ✎(可选)providersForTeam 排序微调,见 §5.4——非必需,
                                                        默认分支已天然兼容
```

> 侵入式修改集中在 7 个现有文件(`package.json` 与可选的 `AuthenticationHelper.ts` 之外,含 `server/presenters/user.ts` fix v3.21),其余均在 `plugins/password/`、新场景文件与独立脚本——rebase 上游时冲突面小且位置固定。`server/env.ts` **不修改**:`PASSWORD_AUTH_ENABLED` 按 OIDC 先例放插件本地 env(§5.5)。

## 4. 数据层

**新增依赖**:当前 `package.json` / `yarn.lock` 没有 `argon2`,实现第一步:

```bash
yarn add argon2   # 原生模块,确认构建镜像有 prebuilt 二进制或编译工具链;装完提交 package.json + yarn.lock
```

migration 在 `users` 表上新增 **3 个字段**(`passwordHash` / `lockedUntil` nullable,`failedSignInAttempts` NOT NULL 带默认值,不影响存量数据):

| 字段 | 类型 | 用途 |
|---|---|---|
| `passwordHash` | TEXT, nullable | 为 null 表示该用户仅可走 SSO |
| `failedSignInAttempts` | INTEGER, NOT NULL, default 0 | 连续失败计数(NOT NULL 保证 SQL 原子 `+1` 不会因 NULL 算术产生 NULL) |
| `lockedUntil` | TIMESTAMP, nullable | 账号锁定截止时间 |

**模型字段声明(必须与 migration 配套)**:`User` 模型是 `sequelize-typescript` 声明式 + `InferAttributes<User>` 类型推导(`server/models/User.ts:137`),只加 migration 不加模型属性,`this.passwordHash` 等访问处过不了类型检查,运行时也没有列映射。在 `server/models/User.ts` 字段区(对照现有 `lastSigninEmailSentAt` 等写法)新增:

```ts
@Column(DataType.TEXT)
@SkipChangeset
passwordHash: string | null;

@AllowNull(false)
@Default(0)
@Column(DataType.INTEGER)
@SkipChangeset
failedSignInAttempts: number;

@IsDate
@Column
@SkipChangeset
lockedUntil: Date | null;
```

> **3 个字段全部标 `@SkipChangeset`**:`Model.insertEvent` 会把 `model.previousChangeset` 整体写入 `events.changes`(`server/models/base/Model.ts:320`),若 `passwordHash` 进 changeset,**每次改密都会把新旧 hash 持久化到 events 表**——哪怕是 argon2 哈希也不允许落入审计数据。"密码已修改"的审计语义改由 §5.3 的显式事件 `data` 承担(`data: { passwordChanged: true }` 这类布尔标记),changeset 与 hash 彻底隔离。`failedSignInAttempts` / `lockedUntil` 跳过 changeset 同时也避免登录失败计数刷事件噪音。此外 presenter 序列化必须排除 `passwordHash`,确保 hash 同样不出现在 API 响应(§8)。

> **v3 变更**:删除 v2 的 `passwordChangedAt`。会话吊销由 `rotateJwtSecret()` 承担,reset token 一次性由 jti + Redis 承担,该字段职责已空心化;若未来需要"上次修改密码时间"的审计展示,再以纯展示字段加回,不参与任何鉴权(见 §10)。
>
> **历史提醒**:仓库历史上存在过密码字段——`passwordDigest` 由 `server/migrations/20160911234928-user-password.js` 添加、`20180707231201-remove-passwords.js` 删除。新字段命名为 `passwordHash`,**不要复用旧字段名**,写迁移时也确认与这两个历史 migration 无相互影响。

`server/models/User.ts` 增加 arrow property 方法(匹配 `rotateJwtSecret`/`getEmailSigninToken` 的风格,`server/models/User.ts:590`):

```ts
/**
 * Set the user's password by hashing the provided plaintext with argon2id.
 *
 * @param plain plaintext password to hash.
 * @returns promise that resolves when the hash is computed and assigned.
 * @throws if argon2 hashing encounters a runtime error.
 */
setPassword = async (plain: string) => {
  this.passwordHash = await argon2.hash(plain, { type: argon2.argon2id });
};

/**
 * Verify the user's password against the stored hash. For users without
 * a password (SSO-only), a dummy hash is verified to prevent timing
 * side-channel enumeration.
 *
 * @param plain plaintext password to verify.
 * @returns whether the password matches.
 * @throws if argon2 verification encounters a runtime error.
 */
verifyPassword = async (plain: string): Promise<boolean> => {
  if (!this.passwordHash) {
    await argon2.verify(DUMMY_HASH, plain);
    return false;
  }
  return argon2.verify(this.passwordHash, plain);
};
```

`DUMMY_HASH` 为模块级常量(对固定随机串预计算的 argon2 哈希),保证"用户不存在 / 无密码"与"密码错误"两条路径耗时一致。

另增一个**静态 helper**(fix v3.23:事务外预计算 hash,缩短行锁持有时间——argon2 是故意昂贵的操作,放在 `SELECT ... FOR UPDATE` 锁内会放大并发等待;详见 §5.3 / §6):

```ts
/**
 * Hash a plaintext password with argon2id without mutating any instance.
 * Use this to pre-compute the hash outside a database transaction, then
 * assign the result to `user.passwordHash` inside the lock.
 *
 * @param plain plaintext password to hash.
 * @returns the argon2id hash string.
 * @throws if argon2 hashing encounters a runtime error.
 */
static hashPassword = async (plain: string): Promise<string> => {
  return argon2.hash(plain, { type: argon2.argon2id });
};
```

> **`setPassword` 保留**:`setPassword` 仍用于不涉及行级锁的简单场景(如未来可能的初始密码设置路径),但 §5.3 update handler 和 §6 CLI 脚本**改用 `User.hashPassword` 在事务前预计算 + 事务内赋值**——安全语义不变(凭据重新验证在赋值前),锁持有时间从 argon2 hash 耗时(~100ms–300ms)缩短到纯内存赋值。

## 5. 服务端(plugins/password)

### 5.0 路由命名与请求字段约定

三个端点采用**路径风格**,不沿用 auth router 里的点号 RPC 风格:

```
POST /auth/password           登录
POST /auth/password/reset     发起找回
POST /auth/password/update    设置 / 重置密码
```

理由:`email.callback` 那类点号命名是单一路径下 callback 的特例;密码生命周期是一组接口,路径风格更稳定,也避免把 API 层的 RPC 风格混进 auth router。另外 `shared/utils/domains.ts` 已将 `"password"` 列为保留词,命名无冲突。

> **`token` 字段红线(body 与 query)**:**任何 `/auth/password/*` 端点的请求体和 query string 中都禁止出现名为 `token` 的字段**。`parseAuthentication` 在没有 Authorization header 时,按 **body → query → cookie** 的顺序取认证 token(`server/middlewares/authentication.ts:105` body 分支、`:114` query 分支):body 里的 `token` 字段返回 `transport: "body"`,query 里的 `?token=` 返回 `transport: "query"`——**两者都排在 cookie 之前**;而 `verifyCSRFToken` 的 `shouldProtectRequest` 对非 cookie transport **直接跳过 CSRF 校验**(`server/middlewares/csrf.ts:51`)。即:无论 `token` 出现在 body 还是 query,都会在"浏览器已有 accessToken cookie"的场景下**整体关闭该请求的 CSRF 双提交校验**。两个向量的封堵方式**不对称**:
>
> - **body 向量**:合法请求确实需要在 body 里传 reset token,所以修复是**字段改名 `resetToken`**(§5.3、§7.2)——让合法请求保持 cookie transport,CSRF 校验恢复生效;`.strict()` 是钉死改名的纵深(见下)。
> - **query 向量**:三个端点的**合法请求根本不带任何 query 参数**(登录表单与 update 表单的 action 固定为不含 query 的路径,reset 走 RPC body),而 CSRF 攻击里 query 拼在攻击者页面的 form action URL 上、完全由攻击者控制——"改名"对它无从谈起。封堵方式是 **`query: z.object({}).strict()`**(见下):虽然这个 400 同样发生在 CSRF 中间件跳过之后,但发生在 route handler 之前,**password 端点的状态变更不会执行**(密码不会被改、失败计数不会动、不会写 password 相关事件),伪造请求在密码功能层面整体落空。这是该向量在 route 层唯一可落地的拒绝点。
>
> **query 向量防线的精确边界(断言勿写过强)**:空 query strict **不等于"该请求全局零状态变更"**。`/auth` 的每个 provider router 都挂载在 **`authMiddleware({ optional: true })`** 之后(`server/routes/auth/index.ts:26`),它先于 route 内的 `validate()` 运行:若 `?token=` 携带的是**有效**凭据,optional auth 会成功解析并产生副作用——`user.updateActiveAt(ctx)` / `user.team?.updateActiveAt()`(`server/middlewares/authentication.ts:43`),API key 还会 `apiKey.updateActiveAt()`(`:241`);随机/无效值则解析抛错被 optional 吞掉、无副作用。补充核对:OAuth access token 被强制要求 header transport(`:157`),经 query 传入会被拒绝,**能触发副作用的是有效 JWT 与 API key 两类**。对此的定性:
>
> 1. 这是 `/auth` 下**所有 provider 路由的既有行为**(email、oidc 等同样适用),不是 password 插件引入的,本方案不改它;
> 2. 被刷新的是 **activeAt 类活跃元数据（`lastActiveAt`、`lastActiveIp`、客户端标记）**——`user.updateActiveAt` 除了写时间戳还记录 `lastActiveIp` 和 Desktop/DesktopWeb/MobileWeb 标记,`server/models/User.ts:556`),不是安全敏感状态(不产生会话、不改凭据、不写审计事件);
> 3. 因此 §9 测试 14e 的断言**收窄为"password handler 未执行 + 密码/失败计数/password 相关 events 未变化"**,不断言全局无状态变化;
> 4. 若要彻底阻止 query token 进入 optional auth,需要在 `/auth` 全局层、provider mount 之前加专门拦截——这会影响现有 auth callback 设计(部分 provider 的回调依赖 query 传递),超出本方案范围,列入 §10 单独评审。
>
> `/reset-password?token=…` 的**页面 URL 不受此红线约束**:它是前端 SPA 的 GET 公开路由(§7.2),query 只被前端读取,不是 `/auth/password/*` 的 POST 端点,不进入这三个 schema 的校验范围。

> **schema 必须 `.strict()`(body 枚举 + 空 query,落地方式)**:上一条"出现 `token` 即 400"**不会自动成立**——`validate()` 中间件只是 `schema.parse(ctx.request)`(`server/middlewares/validate.ts:14`),而 Zod object **默认剥离未知字段、不报错**,`BaseSchema` 也没有全局 strict(`server/routes/api/schema.ts:9`,`body` / `query` 都是 `z.unknown()`)。只写 `z.object({ resetToken: z.string() })` 时,带 `token` 的请求会被**静默剥掉后照常通过校验**;不声明 `query` 则 `?token=x` 完全不被检查。因此 `plugins/password/server/auth/schema.ts` 的三个 schema **body 必须显式 `.strict()` 并枚举全部合法字段,且同时声明 `query: z.object({}).strict()`**。注意三点,否则会引入新问题:
>
> 1. **native form 会合法提交 `_csrf`(`CSRF.fieldName`)与 `client` 字段**(§7.1/§7.2 的 hidden input),`.strict()` 时必须把它们列入 body schema,漏列会把正常表单提交也 400 掉。
> 2. **update 的两条鉴权路径必须且只能其一**:`resetToken` 与 `currentPassword` 在类型上都是 optional,XOR 用 `.superRefine()` 钉死——两者都缺失或同时出现都 400;两字段加 `.min(1)`,防止空字符串被当作"已提供"。完整示例:
>
>    ```ts
>    // plugins/password/server/auth/schema.ts(以 update 为例)
>    export const PasswordUpdateSchema = BaseSchema.extend({
>      body: z
>        .object({
>          resetToken: z.string().min(1).optional(),      // reset token 路径
>          currentPassword: z.string().min(1).optional(), // 登录态路径
>          password: z.string().min(12),
>          [CSRF.fieldName]: z.string().optional(),       // "_csrf",native form 双提交字段
>        })
>        .strict()
>        .superRefine((body, ctx) => {
>          const hasReset = body.resetToken !== undefined;
>          const hasCurrent = body.currentPassword !== undefined;
>          if (hasReset === hasCurrent) {
>            ctx.addIssue({
>              code: z.ZodIssueCode.custom,
>              message: "Provide exactly one of resetToken or currentPassword",
>            });
>          }
>        }),
>      query: z.object({}).strict(),   // 合法请求不带 query;?token= 等一律 400
>    });
>    // 登录 schema:body { email, password, client, _csrf? }.strict() + query: z.object({}).strict()
>    // reset  schema:body { email, _csrf? }.strict()                 + query: z.object({}).strict()
>    ```
>
>    (`.superRefine()` 的 custom issue 会被 `validate()` 取 `issues[0]` 转成 `ValidationError`,报错信息可控;不用两个 strict 分支的 union——单一枚举 + XOR 比 union 的报错与维护都更直接。Koa 对无 query 的 POST 给出空对象 `{}`,空 query strict 不会误伤三条合法路径。)
> 3. **执行顺序决定了 `.strict()` 在 body 向量上只是纵深,在 query 向量上是 route 层唯一拒绝点**:`/auth` app 的中间件链是 bodyParser → `verifyCSRFToken()` → router(provider 路由先过 `authMiddleware({ optional: true })`,再到 route 内的 `validate()`,`server/routes/auth/index.ts:26` / `:92`)。带 `token` 的恶意请求**先**经过 CSRF 中间件(此时已因 transport 非 cookie 被跳过)与 optional auth(有效凭据会产生 activeAt 副作用,见上),**后**才被 strict schema 400。所以:body 向量的真正修复是**字段改名 `resetToken`**(合法请求恢复 cookie transport,CSRF 校验重新生效),`.strict()` 负责让任何"把字段叫回 `token`"的回退在测试里立刻爆炸;query 向量没有改名可言,**空 query strict 的 400 就是 route 层防线本身**——它挡不住 CSRF 中间件被跳过和 optional auth 的 activeAt 刷新,但保证伪造请求到不了 handler、password 端点的状态变更不执行。

### 5.1 `POST /auth/password` — 登录

1. `schema.ts` 中的 zod schema 校验 `email` / `password` / `client`(邮箱小写归一;`client` 取值 `Client.Web` / `Client.Desktop`,由表单 hidden input 提交,见 §7;schema 按 §5.0 body `.strict()` 枚举含 `_csrf` 在内的全部字段 + 空 query strict)。
2. **team 解析前 IP-only 预限流(fix v3.27)**:正式三键限流需要 `teamId`,但 team 解析失败 / password provider 不可用的请求也不能完全绕过 password 端点限流。先 consume 一个轻量 IP-only key(如 `password-login-preteam:ip:${ip}`),只用于覆盖未知 hostname/custom domain/provider unavailable 的探测与日志放大;阈值应宽于正式登录 IP key,避免正常多 workspace 登录被过早挡住。解析 team 成功后仍继续执行第 4 步正式三键限流;预限流不是正式爆破防线的替代。
3. **解析 team(正式限流和用户查找都依赖 team,必须先于两者执行)**:Outline 的 `users.email` 自 `20170712055148-non-unique-email.js` 起**不是全局唯一**,同一邮箱可存在于多个 workspace。照搬现有 email 登录的解析逻辑(`plugins/email/server/auth/email.ts:31`):
   - self-host(`!env.isCloudHosted`)→ `Team.findOne()`(单租户);
   - 自定义域名(`domain.custom`)→ 按 `domain` 查;
   - 子域名(`domain.teamSubdomain`)→ 按 `subdomain` 查;
   - team 不存在或 password provider 对该 team 不可用 → 拒绝(已被第 2 步预 IP 限流覆盖,但不进入正式三键限流,因为没有可用 `teamId`)。
   解析出 team 后可先检查 `team.isSuspended`;`signIn` 内部对 `team.isSuspended` 是硬编码 `ctx.redirect("/?notice=…")` 根路径(`server/utils/authentication.ts:38`),在子域名 / 自定义域名入口会把用户踢回错误域名。因此 password 路由在调用 `signIn` **之前**自行检查 team 状态,命中时按 §7 的域名推导规则回跳 `?notice=team-suspended`(复用 `Notices.tsx` 已有文案),确保 `signIn` 内部分支不会被触发。
4. **正式专用限流器(fix v3.26 / v3.27:key 带 team 维度,且先于用户查询)**(现有 `rateLimiter` 只支持按已登录用户或 IP 单键):基于同一套 RateLimiterRedis 新建 password 专用 limiter,**分别 consume `ip`、`teamId:emailHmac`、`ip:teamId:emailHmac` 三个 key**,任一超限即 429。`emailHmac` = HMAC-SHA256(email, `SECRET_KEY`)——避免把明文邮箱写进 Redis key,同时比裸 SHA 抵抗字典枚举(`SECRET_KEY` 泄露才能反查)。**key 必须包含 `teamId`**(fix v3.26):同一邮箱可存在于多个 workspace(`20170712055148-non-unique-email.js`),无 team 维度的 `emailHmac` / `ip:emailHmac` 会导致 A workspace 的暴力攻击限流 B workspace 同邮箱的正常用户;team 解析(第 3 步)在正式限流前完成,保证 `teamId` 可用。全局 `ip` key 不带 team 维度,保留作跨 workspace 总体防护(单 IP 无论攻击哪个 workspace 都受总限额约束)。**正式三键限流必须在 `User.findOne` 之前执行**(fix v3.27):超限请求不得继续打用户表、不得执行 dummy/真实 argon2 验证。
5. **用户查询**:**`User.findOne({ where: { teamId: team.id, email } })`**,禁止只按 email 全局查询。此查询只能发生在第 4 步正式三键限流通过之后。
6. **密码验证与用户状态检查(fix v3.26 / v3.27:拆分 user null / non-null 两条路径)**:
   - **`user === null`(用户不存在)**:仅执行 `await argon2.verify(DUMMY_HASH, password)` 消耗与真实验证等量的时间(防计时侧信道),然后 **redirect 回登录页 `?notice=password-auth-failed`**——**不递增任何账号的 `failedSignInAttempts`、不写 `lockedUntil`、不写审计事件**(无目标用户可写;v3.25 的 `User.increment(... { id: user.id })` 在 user 为 null 时空指针崩溃);前端展示模糊文案「邮箱或密码不正确」,与真实用户密码错误时的响应不可区分。
   - **`user !== null`** → 先检查用户级状态,再 `user.verifyPassword(password)`:
     - `user.isSuspended` 命中时按 §7 的域名推导规则回跳 `?notice=user-suspended`;**这一步必须在 `user !== null` 分支内**(fix v3.27),禁止在 null 用户上访问 `user.isSuspended`。
     - `user.lockedUntil` 未过期 → redirect `?notice=password-locked`;**这一步同样必须在 `user !== null` 分支内**(fix v3.27),禁止在 null 用户上访问 `lockedUntil`。
     - 失败 → **原子递增**失败计数:**`User.increment('failedSignInAttempts', { where: { id: user.id } })`**(Sequelize 生成 `UPDATE users SET "failedSignInAttempts" = "failedSignInAttempts" + 1 WHERE id = ?`,单条 SQL 无并发丢增量;先例:`View.incrementOrCreate` 的 `this.increment("count", { where })`,`server/models/View.ts:74`)。从返回结果取递增后的值(Sequelize `increment` 返回受影响行及最新值,或紧随一次 `user.reload({ attributes: ['failedSignInAttempts', 'lockedUntil'] })` 拿最新值),达到阈值(如 5 次)则 `User.update({ lockedUntil: now + 15min }, { where: { id: user.id } })`;**不要用 `user.failedSignInAttempts += 1; user.save()` 的读-改-写模式——并发错误登录会丢增量,削弱锁定策略**。成功登录后清零同样用 `User.update({ failedSignInAttempts: 0, lockedUntil: null }, { where: { id: user.id } })`(幂等写入,不依赖内存状态)。**redirect 回登录页 `?notice=password-auth-failed`**(锁定中为 `?notice=password-locked`),前端展示模糊文案「邮箱或密码不正确」,不区分"无密码/密码错"。native form POST 场景下用 redirect 而非 JSON 错误,与 §7 的回跳域名推导配合。
     - 成功 → 清零计数(如上),调用 **`signIn(ctx, "password", { user, team, client, isNewTeam: false, isNewUser: false })`**——注意三点:实际签名是 `signIn(ctx, service, result)`,`service` 是独立的第二参数;`AuthenticationResult = AccountProvisionerResult & { client }`,其中 `user` / `team` / `isNewTeam` / `isNewUser` **四个字段全部必填**(`server/commands/accountProvisioner.ts:80`、`server/types.ts:53`),缺 `isNewUser` 过不了编译;`client` 决定 Desktop 场景的 `desktop-redirect` 分支(`server/utils/authentication.ts:31`)。由其完成 cookie、`users.signin` 审计事件与重定向。

### 5.2 `POST /auth/password/reset` — 发起找回(依赖 SMTP)

- **team 解析前 IP-only 预限流(fix v3.27)**:与登录端点同理,reset 的正式 key 需要 `teamId`,但未知 hostname/custom domain/provider unavailable 请求也不能无限制打到解析与错误日志。先 consume 一个轻量 IP-only key(如 `password-reset-preteam:ip:${ip}`),阈值宽于正式 reset IP key;team 解析成功后仍继续执行正式三键限流。
- **team 作用域(必须先于正式限流和用户查找)**:与 §5.1 第 3 步同样先按 hostname 解析 team;否则同邮箱多 workspace 场景会把 A workspace 的 reset 发给 B workspace 的同名账号,造成串账号。team 不存在或 password provider 对该 team 不可用 → 拒绝(已被预 IP 限流覆盖,但不进入正式三键限流);SMTP 不可用按本节末尾返回 503。
- **专用限流器(fix v3.23 / v3.26 / v3.27:key 带 team 维度,且先于用户查询)**:reset 端点会生成 token、写 Redis、发邮件,不加限流容易变成邮件轰炸入口。与 §5.1 登录端点同模式,使用 **reset 专用 RateLimiterRedis**,按 **`ip` / `teamId:emailHmac` / `ip:teamId:emailHmac` 三个 key** 消费,任一超限即 429。`emailHmac` 同 §5.1 口径(HMAC-SHA256,密钥取 `SECRET_KEY`)。**key 包含 `teamId`**(fix v3.26,与 §5.1 同口径):team 解析在正式限流前完成,保证 `teamId` 可用;全局 `ip` key 保留作跨 workspace 总体防护。**限流在用户查找之前执行**——对所有邮箱(含不存在的)统一消费,避免攻击者通过限流响应差异枚举邮箱是否存在。限流阈值应**严于登录端点**(reset 会触发邮件发送,成本更高;例如同一 `ip:teamId:emailHmac` 每小时不超过 5 次,同一 `ip` 每小时不超过 20 次——具体值可在实现时调整,关键是必须存在且足够严格)。超限时即使邮箱存在也不生成 token、不写 Redis、不发邮件,直接返回 429。
- **防枚举成功语义的边界(fix v3.27)**:在 team 已解析、password provider 可用、SMTP 可用且未触发限流之后,**无论邮箱是否存在都返回成功**(防用户枚举)。这句话不覆盖 team 不存在、provider 不可用、SMTP 不可用或限流超限:这些情况分别按上文拒绝、503 或 429 处理,避免把配置错误/不可达状态伪装成邮件已发送。
- **token 形态(写死,实现勿自创)**:照搬现有 `User.getEmailSigninToken` 的形态(`server/models/User.ts:665`——payload 含 `id` + `type` + `createdAt`,用 **`user.jwtSecret`** 签名),在 `User` 上新增 `getPasswordResetToken()`,返回 `{ token, jti }` 让调用方直接拿到 `jti` 写 Redis,无需 decode(fix v3.21):

  ```ts
  // server/models/User.ts
  /**
   * Generate a one-time password reset token. Returns both the signed JWT
   * and the jti so the caller can write the jti to Redis without decoding
   * the token.
   *
   * @returns the signed token string and its jti.
   */
  getPasswordResetToken = (): { token: string; jti: string } => {
    const jti = crypto.randomUUID();
    const token = JWT.sign(
      {
        id: this.id,            // 目标 userId —— 消费端"给谁设密"的唯一来源
        teamId: this.teamId,    // 与请求 hostname 解析出的 team 核对
        type: "password-reset",
        createdAt: new Date().toISOString(),
        jti,
      },
      this.jwtSecret
    );
    return { token, jti };
  };
  ```

  调用方从返回值解构 `{ token, jti }`,用 `jti` 组装 Redis key(`password-reset:jti:${jti}`)并 SET **value `{ userId, teamId }`**、15 分钟 TTL:键的存在性提供一次性消费,value 提供与 token 声明的交叉核对。用 `user.jwtSecret` 签名的额外收益:§5.3 改密成功后 `rotateJwtSecret()` 会让同一用户所有未消费的 reset token 一并失效。
- 调用 `const { token, jti } = user.getPasswordResetToken()`,用 `jti` 组装 Redis key `password-reset:jti:${jti}` 并 `SET` value `JSON.stringify({ userId: user.id, teamId: user.teamId })`、`EX 900`(15 分钟 TTL)。经现有 mailer 队列发送 `PasswordResetEmail`,**链接指向 `${team.url}/reset-password?token=…`**(§7.2 的公开页面;域名用 `team.url` 拼,不用根域。页面 URL 的 query 参数名可保留 `token`——它只被前端 SPA 读取,不会进入 `/auth/password/*` 的请求体或 query;进入 POST 请求体时必须改名 `resetToken`,POST 的 query 则一律为空,见 §5.0 红线)。**注意**:模板文件在插件目录内,要走 `.schedule()` 队列链路就必须在 `plugins/password/server/index.ts` 注册 **`Hook.EmailTemplate`**(参照 `plugins/passkeys/server/index.ts`)——`EmailTask` 是按模板名从注册表(`server/emails/templates/index.ts`)取类的,不注册则队列侧找不到模板。
- 未配置 SMTP 时:端点返回 **HTTP 503 JSON 错误**,前端隐藏"忘记密码"入口,改走 §6。**服务端实现**:当前 `server/errors.ts` 没有 503 helper,需新增 `ServiceUnavailableError`(参照现有 `InternalError` 的 `httpErrors(500, ...)` 形态,改为 `httpErrors(503, "Email service unavailable", { id: "service_unavailable" })`;或直接 `ctx.throw(503, ...)`)。客户端 `ApiClient` 已有 503 → `ServiceUnavailableError` 的映射(`app/utils/ApiClient.ts:266`),无需前端改动。**服务端判断口径**:`env.EMAIL_ENABLED && !!env.SMTP_FROM_EMAIL`——`EMAIL_ENABLED` 只检查 `SMTP_HOST || SMTP_SERVICE || development`(`server/env.ts:401`),但 `BaseEmail.schedule()` 在 `SMTP_FROM_EMAIL` 缺失时直接 no-op(`server/emails/templates/BaseEmail.tsx:58`),即 SMTP 连接可用但无发件人时邮件静默不发。服务端必须同时检查两者,任一缺失即返回 503。**前端判断口径**:前端只能读 `@Public` 的 `EMAIL_ENABLED`(无法读 `SMTP_FROM_EMAIL`),因此"忘记密码"入口可见性仍用 `env.EMAIL_ENABLED`;若 `SMTP_FROM_EMAIL` 缺失导致服务端 503,前端"忘记密码"子状态展示错误提示(不能假定恒 success)。

### 5.3 `POST /auth/password/update` — 设置 / 重置密码

- 鉴权**必须且只能其一**(schema 层 `.superRefine()` 强制 XOR,两者都缺失或同时出现都在 validation 阶段 400,见 §5.0):
  1. **reset token 路径(消费顺序写死)**:请求体字段为 **`resetToken`**(理由见 §5.0 红线;schema 按 §5.0 `.strict()` 枚举,`token` 等未知字段在 validation 阶段 400)。验证参照 `getUserForEmailSigninToken` 的形态(`server/utils/jwt.ts:99`):
     1. `getJWTPayload(resetToken)` 解出 payload,校验 `type === "password-reset"` 与 `createdAt` 未超 15 分钟;
     2. 按 hostname 解析当前 team(§5.1 第 3 步同口径),校验 `payload.teamId === team.id`;
     3. **`User.findOne({ where: { id: payload.id, teamId: team.id } })` 取目标用户**——目标用户来源只能是 token 的 `id` 声明,请求体不传、也不接受 email 参数;
     4. `JWT.verify(resetToken, user.jwtSecret)` 验签;
     5. **jti 消费与核对统一在事务块内执行**(见下文事务骨架),此步不做任何 Redis 操作——验签通过即进入事务。
  2. **登录态路径**:必须满足 `ctx.state.auth.user` 存在**且** `parseAuthentication(ctx).transport === "cookie"`。**为什么不能只检查 `ctx.state.auth.type === AuthenticationType.APP`**:`parseAuthentication` 按 header → body → query → cookie 的顺序取 token(`server/middlewares/authentication.ts:84`),非 OAuth / 非 API-key 的 JWT 全部落入 `else` 分支赋值 `AuthenticationType.APP`(`:242`)——即 `Authorization: Bearer <valid session JWT>` 也会得到 `type = APP`。只检查 `type === APP` 无法区分 header 传入的 JWT 与 cookie 传入的 JWT,仍会放过非 cookie transport。`transport` 当前不在 `ctx.state.auth` 中(`server/types.ts:57`,`Authentication` 类型只含 `{ user, token, type, service, scope }`),handler 需**直接调用 `parseAuthentication(ctx)` 取 transport**(该函数已导出)。改密操作只接受 cookie transport,其他 transport(header/body/query)一律 401 JSON。校验通过后再 `verifyPassword(currentPassword)`,通过才允许改。
- 密码策略:最少 12 位。

- **事务要求(v3.10 / v3.24 修正)**:update handler 的落库操作涉及多步写入(事务前 `User.hashPassword` 预计算 hash(fix v3.23);事务内赋值 `lockedUser.passwordHash = newHash` → 清零锁定状态 → `save` → `rotateJwtSecret` → 写事件),必须在同一事务内完成——半截失败(如 `rotateJwtSecret` 成功但事件写入失败)会导致状态不一致。`/auth` app **不像 `/api` 有全局 `transaction()` 中间件**(`server/routes/auth/index.ts` 的链路只有 bodyParser → coalesceBody → verifyCSRFToken → router),handler 内部必须**显式使用 `sequelize.transaction()`**。同时注意 **`User.rotateJwtSecret` 的真实签名是 `(options: SaveOptions)`**(内部 `this.save(options)`,`server/models/User.ts:598`),不是无参调用——必须传 `{ transaction }`。参照 `auth.delete` 端点的做法(`server/routes/api/auth/auth.ts:188`:该端点通过 `transaction()` 中间件获取事务,再 `user.rotateJwtSecret({ transaction })`)。update handler 骨架:

  ```ts
  // plugins/password/server/auth/password.ts — update handler 内部
  import { sequelize } from "@server/storage/database";
  import { parseAuthentication } from "@server/middlewares/authentication";
  import JWT, { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
  import { getJWTPayload } from "@server/utils/jwt";
  import { z } from "zod";
  import {
    AuthenticationError,
    ValidationError,
    InternalError,
  } from "@server/errors";
  import { addMonths, addSeconds, subMinutes } from "date-fns";

  // ── 自定义领域错误(不暴露 500) ──
  class ResetTokenConsumedError extends Error {
    constructor(message = "Reset token already consumed") { super(message); }
  }

  // ── reset payload 结构化校验(fix v3.18 / v3.19:改用 zod safeParse) ──
  // JWT.JwtPayload 的自定义字段本质上是 [key: string]: any(@types/jsonwebtoken
  // index.d.ts:123),decode 后无类型保证。用 zod safeParse 做 shape validation,
  // 与方案中其他 schema(§5.0)风格一致,且无需 as 断言。
  const PasswordResetPayloadSchema = z.object({
    id: z.string(),
    teamId: z.string(),
    type: z.literal("password-reset"),
    createdAt: z.string(),
    jti: z.string(),
  });

  type PasswordResetPayload = z.infer<typeof PasswordResetPayloadSchema>;

  // ── 鉴权结果 discriminated union(fix v3.18) ──
  // TypeScript 按 kind 收窄:事务闭包内 updateContext.kind === "reset" 时
  // 编译器保证 .payload / .jtiKey / .resetToken 存在且类型正确;
  // kind === "login" 时保证 .currentPassword / .expires 存在。
  // 不再依赖 isResetTokenPath 布尔推断外部 let 变量已赋值——
  // 那种模式在闭包捕获时 TypeScript 无法收窄,实现者被迫加 ! 断言。
  interface ResetContext {
    kind: "reset";
    user: User;
    payload: PasswordResetPayload;
    jtiKey: string;
    resetToken: string;
  }

  interface LoginContext {
    kind: "login";
    user: User;
    currentPassword: string;
    expires: Date;
  }

  type PasswordUpdateContext = ResetContext | LoginContext;

  // ── handler 级 XOR 防御(fix v3.20) ──
  // schema 的 .superRefine() 在 validate 中间件中已保证 XOR,但 handler 内
  // 再做一次显式复核:若未来 validate 被改动或绕过,不会静默选择 reset 分支。
  if ((resetToken !== undefined) === (currentPassword !== undefined)) {
    throw ValidationError("Provide exactly one of resetToken or currentPassword");
  }

  // ── 构建鉴权上下文(事务前,两条路径各自校验后归一到 updateContext) ──
  // 分支以 resetToken / currentPassword 的 undefined 判断驱动(fix v3.19):
  // schema 的 XOR .superRefine() + handler 级 XOR guard(fix v3.20)双重保证
  // 运行时只有一个存在;TypeScript 无法从 runtime validation 推断——
  // 必须显式 if 收窄,否则 resetToken 在 else 分支仍是 string | undefined,
  // getJWTPayload / JWT.verify 类型不过。
  let updateContext: PasswordUpdateContext;

  if (resetToken !== undefined) {
    // ── reset 路径:预验证 + 构建 ResetContext ──
    // const 绑定(fix v3.19):resetToken 来自 schema 解构(可能是 let 或
    // 可变绑定),const 保证闭包内 narrowing 不丢失。
    const token = resetToken;

    // 所有预验证失败归一化为 ResetTokenConsumedError(fix v3.17):
    // getJWTPayload 抛出 AuthenticationError(httpErrors 工厂返回值,非 class),
    // 外层 instanceof 不匹配;内层 try/catch 归一化后统一 redirect。
    try {
      let rawPayload: JWT.JwtPayload;
      try {
        rawPayload = getJWTPayload(token);
      } catch {
        throw new ResetTokenConsumedError("Invalid reset token");
      }

      // zod safeParse(fix v3.19):无 as 断言,与 §5.0 schema 风格一致。
      const parsed = PasswordResetPayloadSchema.safeParse(rawPayload);
      if (!parsed.success) {
        throw new ResetTokenConsumedError("Invalid reset token payload");
      }
      const payload = parsed.data;

      // createdAt 校验(fix v3.18 / v3.19:加 60 秒时钟偏差容忍窗口)。
      // new Date("abc").getTime() 是 NaN,Number.isFinite(NaN) 为 false;
      // addSeconds(new Date(), 60) 容忍多实例/容器间的时钟偏差——签发实例
      // 与验证实例可能有数十秒差异,不加 leeway 正常签发的 token 会被误拒。
      const createdAt = new Date(payload.createdAt);
      if (
        !Number.isFinite(createdAt.getTime()) ||
        createdAt > addSeconds(new Date(), 60) ||
        createdAt < subMinutes(new Date(), 15)
      ) {
        throw new ResetTokenConsumedError("Reset token expired");
      }

      // team 从 hostname 解析(与 §5.1 第 3 步同口径),在此之前已完成
      if (payload.teamId !== team.id) {
        throw new ResetTokenConsumedError("Team mismatch");
      }
      const resetUser = await User.findOne({
        where: { id: payload.id, teamId: team.id },
      });
      if (!resetUser) {
        throw new ResetTokenConsumedError("User not found");
      }
      // 首次验签(事务内会用 lockedUser.jwtSecret 重新验签)
      try {
        JWT.verify(token, resetUser.jwtSecret);
      } catch {
        throw new ResetTokenConsumedError("Invalid token signature");
      }

      updateContext = {
        kind: "reset",
        user: resetUser,
        payload,
        jtiKey: `password-reset:jti:${payload.jti}`,
        resetToken: token,
      };
    } catch (err) {
      // 预验证失败:ResetTokenConsumedError → redirect;其他错误 re-throw
      if (err instanceof ResetTokenConsumedError) {
        ctx.redirect(`${team.url}/?notice=expired-token`);
        return;
      }
      throw err;
    }
  } else if (currentPassword !== undefined) {
    // ── 登录态路径:事务前校验 transport(fix v3.15) ──
    if (!ctx.state.auth?.user) {
      throw AuthenticationError("Authentication required");     // 401
    }
    const { transport } = parseAuthentication(ctx);
    if (transport !== "cookie") {
      throw AuthenticationError("Cookie authentication required"); // 401
    }
    const verified = await ctx.state.auth.user.verifyPassword(currentPassword);
    if (!verified) {
      // 用 ValidationError(400)而非 AuthenticationError(401)(fix v3.16):
      // ApiClient 对 401 触发 stores.auth.logout()(app/utils/ApiClient.ts:186),
      // 设置页输错密码会导致前端自动登出——用户只是密码输错,不应丢会话。
      throw ValidationError("Current password is incorrect");   // 400
    }
    updateContext = {
      kind: "login",
      user: ctx.state.auth.user,
      currentPassword,
      expires: addMonths(new Date(), 3),
    };
  } else {
    // XOR .superRefine() 保证运行时不会到达此处,
    // 但 TypeScript 无法从 runtime validation 推断——显式 throw 满足穷尽检查。
    throw ValidationError("Provide exactly one of resetToken or currentPassword");
  }

  // ── reset 分支:hash 前 Redis 存在性预检(fix v3.24:成本闸门) ──
  // argon2 hash 在事务前执行(v3.23),但 reset token 的权威消费(GETDEL)在
  // 事务内。"GETDEL 已消费但事务回滚"后的重试请求会在 GETDEL 判定前先消耗
  // 一次 argon2——虽然最终被拒,但放大了异常/重放场景下的计算成本。
  // 便宜的 Redis EXISTS 预检:不存在 → token 已消费,跳过 argon2 直接 redirect。
  // ⚠️ EXISTS 仅是成本闸门,不是权威判定:EXISTS 返回 1 只说明 key 此刻存在,
  // 不保证事务内 GETDEL 时仍存在(并发消费窗口);权威判定仍是事务内 GETDEL。
  // ⚠️ EXISTS 失败降级(fix v3.25):Redis 短暂故障时 EXISTS 抛错不应改变用户
  // 可见错误形态——降级为继续执行 hash + 事务内 GETDEL(后者同样依赖 Redis,
  // 若 Redis 仍不可用会在事务内抛错,由区域二 catch 或全局错误处理兜底)。
  if (updateContext.kind === "reset") {
    try {
      const exists = await redis.exists(updateContext.jtiKey);
      if (!exists) {
        ctx.redirect(`${team.url}/?notice=expired-token`);
        return;
      }
    } catch {
      // EXISTS 是成本优化,不是功能要求;失败时降级为跳过预检,
      // 继续 hash + 事务内 GETDEL——保持与无 EXISTS 时相同的行为。
    }
  }

  // ── 事务前预计算 hash(fix v3.23:缩短行锁持有时间) ──
  // argon2 hash 是故意昂贵的操作(~100ms–300ms),放在 SELECT ... FOR UPDATE
  // 行锁内会放大并发等待;预计算不改变安全语义——事务内的凭据重新验证
  // (锁内验签 / verifyPassword)在赋值前执行,保证 hash 只在凭据有效时使用。
  const newHash = await User.hashPassword(password);

  // ── 事务(使用已收窄的 updateContext,kind 判断提供完整类型保证) ──
  try {
    const newAccessToken = await sequelize.transaction(async (transaction) => {
      // ── 行级锁(防同一用户多 token 并发攻击,fix v3.15 / v3.19:去掉 rejectOnEmpty) ──
      // updateContext.user.id 在两条路径上均为已校验的 User 实例,无需 !
      const lockedUser = await User.findByPk(updateContext.user.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      // 手动 null 检查(fix v3.19):rejectOnEmpty 的 EmptyResultError 不在
      // catch 的 instanceof 范围内,穿透为 500。用户可能在预验证后被删除——
      // reset 路径降级为 redirect(安全方向),login 路径返回 401 JSON。
      if (!lockedUser) {
        if (updateContext.kind === "reset") {
          throw new ResetTokenConsumedError("User no longer exists");
        }
        throw AuthenticationError("User not found");
      }

      // ── 锁内重新验证 + jti 消费(关键:事务外的验证结果不可信) ──
      if (updateContext.kind === "reset") {
        // jwtSecret 可能已被并发事务轮转,重新验签
        JWT.verify(updateContext.resetToken, lockedUser.jwtSecret);

        // ── jti 原子消费(fix v3.16:GETDEL 在 DB 变更前) ──
        // GETDEL 是唯一的一次性消费操作,返回值为权威判定:
        // - 非 null → 首次消费成功,再核对 value 中的 { userId, teamId }
        // - null → 已被并发请求消费或从未生成,立即拒绝
        const consumed = await redis.getdel(updateContext.jtiKey);
        if (!consumed) {
          throw new ResetTokenConsumedError();
        }
        // Redis value 解析 + shape 校验(fix v3.18):
        // 坏值(非 JSON / 字段缺失)不应穿透为 500。
        let jtiData: Record<string, unknown>;
        try {
          jtiData = JSON.parse(consumed);
        } catch {
          throw new ResetTokenConsumedError("Corrupted reset token state");
        }
        if (
          typeof jtiData.userId !== "string" ||
          typeof jtiData.teamId !== "string" ||
          jtiData.userId !== updateContext.payload.id ||
          jtiData.teamId !== updateContext.payload.teamId
        ) {
          throw new ResetTokenConsumedError("Reset token payload mismatch");
        }
      } else {
        // 登录态:密码可能已被并发改密修改,重新校验
        const stillValid = await lockedUser.verifyPassword(updateContext.currentPassword);
        if (!stillValid) {
          throw ValidationError("Current password is incorrect"); // 400
        }
      }

      // ── 赋值预计算的 hash(fix v3.23:不在锁内调 setPassword/argon2) ──
      lockedUser.passwordHash = newHash;
      // ── 清零锁定状态(fix v3.20):改密成功即解除锁定,否则用户通过
      // 邮件重置密码后仍可能因旧 failedSignInAttempts / lockedUntil 无法登录。
      // 与 §6 CLI 脚本的清零逻辑保持一致。
      lockedUser.failedSignInAttempts = 0;
      lockedUser.lockedUntil = null;
      // hooks: false 是有意为之:此处只改了 passwordHash 与锁定状态,
      // 不走 changeset/通知 hooks。
      // ⚠️ 仅允许用于保存 passwordHash + failedSignInAttempts + lockedUntil
      // 的这一次 save;不要把 jwtSecret 合并进来。
      await lockedUser.save({ transaction, hooks: false });
      await lockedUser.rotateJwtSecret({ transaction });

      // ── 写审计事件(reset token 路径必须隔离 auth context) ──
      // createFromContext 会优先用 ctx.state.auth.user 覆盖 defaultAttributes,
      // 带 A 账号会话打开 B 的 reset 链接时事件会误归 A。
      if (updateContext.kind === "reset") {
        await Event.create(
          {
            name: "users.update",
            userId: lockedUser.id,
            actorId: lockedUser.id,
            teamId: lockedUser.teamId,
            ip: ctx.request.ip,
            authType: null,
            data: { passwordChanged: true },
          },
          { transaction }
        );
      } else {
        await Event.createFromContext(
          ctx,
          { name: "users.update", userId: lockedUser.id, data: { passwordChanged: true } },
          { actorId: lockedUser.id, teamId: lockedUser.teamId },
          { transaction }
        );
      }

      // ── 登录态路径:在事务内用 lockedUser 生成新 token(fix v3.16) ──
      // 必须用 lockedUser:rotateJwtSecret 修改了其 jwtSecret。
      if (updateContext.kind === "login") {
        return lockedUser.getSessionToken(updateContext.expires, "password");
      }
      return null;
    });

    // ── 事务提交后的响应 ──
    if (updateContext.kind === "reset") {
      ctx.redirect(`${team.url}/?notice=password-updated`);
    } else {
      // 登录态 RPC:设置 cookie + JSON。cookie 参数复刻 signIn,不传 domain。
      if (!newAccessToken) {
        throw InternalError("Failed to generate session token");
      }
      ctx.cookies.set("accessToken", newAccessToken, {
        sameSite: "lax",
        expires: updateContext.expires,
      });
      ctx.body = { success: true };
    }
  } catch (err) {
    // ── reset 路径:事务内错误统一 redirect(fix v3.16 / v3.17 / v3.19) ──
    // 事务内可能抛出:锁内重新验签的 JsonWebTokenError / TokenExpiredError,
    // GETDEL 返回 null 的 ResetTokenConsumedError,Redis 坏值的 ResetTokenConsumedError,
    // 用户已删除的 ResetTokenConsumedError(fix v3.19)。
    // 登录态路径:构建 LoginContext 阶段的错误(AuthenticationError / ValidationError)
    // 在两个 catch 之前抛出,不经过此处;但事务内 verifyPassword 抛出的 ValidationError
    // 会经过此 catch——因 updateContext.kind === "login" 直接 re-throw,行为正确(fix v3.19)。
    if (updateContext.kind === "reset") {
      if (
        err instanceof ResetTokenConsumedError ||
        err instanceof JsonWebTokenError ||
        err instanceof TokenExpiredError
      ) {
        ctx.redirect(`${team.url}/?notice=expired-token`);
        return;
      }
    }
    throw err;
  }
  ```

  > **行级锁与重新验证(v3.15)**:事务进入后第一步是 `SELECT ... FOR UPDATE` 锁定用户行,再重新验证凭据(reset token 重新验签 / 登录态重新 `verifyPassword`)。这解决了两个并发攻击面:(1)**同一用户多个不同 reset token 并发**——两个 token 都能在事务外用旧 `jwtSecret` 验签通过,各自 GETDEL 各自成功,最后一次提交覆盖前一次密码,打破"rotateJwtSecret 使其余 token 失效"的承诺;行级锁让第二个事务阻塞直到第一个提交,第一个的 `rotateJwtSecret` 改了 `jwtSecret`,第二个拿到锁后重新验签必然失败;(2)**登录态并发改密**——行级锁序列化写入,重新 `verifyPassword` 保证第二个事务看到的 passwordHash 是最新的。
  >
  > **jti 消费时序(v3.14 / v3.16 / v3.20 / v3.23 修正)**:Redis `GETDEL` 是**唯一的一次性消费操作**,放在事务内、**DB 变更(`save` / `rotateJwtSecret`)之前**。事务内执行顺序:锁定用户行 → 锁内重新验证 → **GETDEL** → 赋值 `lockedUser.passwordHash = newHash`(hash 已在事务前由 `User.hashPassword` 预计算,fix v3.23)→ 清零 `failedSignInAttempts` / `lockedUntil`(fix v3.20)→ `save({ hooks: false })` → `rotateJwtSecret` → 写事件。GETDEL 放在 DB 变更**之前**的原因:若放在之后,`rotateJwtSecret` 抛错时 GETDEL 根本未执行——token 未消耗,§9 测试 19b 的"回滚后 token 已消耗"语义不成立。不再先 GET 后 GETDEL——两阶段方案存在并发绕过(两个请求都通过 GET 后,第二个 GETDEL 返回 null 但若不检查返回值仍会继续改密)。单次 GETDEL 以返回值为权威判定:非 null 即首次消费成功,null 即拒绝。
  >
  > **回滚 tradeoff**:若事务回滚(如 `rotateJwtSecret` 或事件写入抛错),token 已被 GETDEL 消耗、密码未改——用户需重新发起 reset。这是**更安全的方向**(宁可让合法用户多发一次 reset,也不让已消费的 token 在回滚后"复活"被重放)。§9 测试 19b 覆盖此场景。
  >
  > **Hash 预计算(v3.23)**:argon2 hash 是故意昂贵的操作(~100ms–300ms),v3.22 的 `await lockedUser.setPassword(password)` 放在 `SELECT ... FOR UPDATE` 行锁内,意味着持锁期间包含完整的 argon2 计算——并发改密(如多 reset token 同时到达)时后续事务在行锁上的等待时间被放大。v3.23 改为**事务前调用 `User.hashPassword(password)` 预计算 hash**(`const newHash = await User.hashPassword(password)`),事务内仅做 `lockedUser.passwordHash = newHash`(纯内存赋值,微秒级)。安全语义不变:凭据重新验证(锁内验签 / `verifyPassword`)发生在 hash 赋值**之前**,确保只有凭据有效时才使用预计算的 hash;即使攻击者并发到达,锁内验证仍序列化执行。`setPassword` 实例方法保留,用于不涉及行级锁的简单场景(如未来可能的初始密码设置路径)。§6 CLI 脚本同步改为预计算模式。
  >
  > **Reset 分支 Redis EXISTS 成本闸门(v3.24 / v3.25 降级)**:v3.23 的 `User.hashPassword` 在事务前执行,但 reset token 的权威消费(GETDEL)要到事务内才判定。在"GETDEL 已消费但事务回滚"的异常状态下,后续重试请求会先完成一次 argon2 hash(~100ms–300ms),然后才被事务内 GETDEL 返回 null 拒绝——虽然安全语义正确(重试被拒),但放大了异常/重放场景下的计算成本。v3.24 在 **hash 前**加便宜的 Redis `EXISTS`(`updateContext.jtiKey`):不存在(0)即 token 已被消费或从未生成,直接 redirect `?notice=expired-token`,跳过 argon2;存在(1)才继续 hash。**`EXISTS` 仅是成本闸门,不是权威判定**:`EXISTS` 返回 1 只说明 key 此刻存在,不保证事务内 GETDEL 时仍存在(并发消费窗口),事务内 GETDEL 仍是唯一权威判定,不变。login 分支不做 EXISTS(无 jti key)。**EXISTS 失败降级(fix v3.25)**:`redis.exists` 在事务外、两区 catch 之外;Redis 短暂故障时 EXISTS 抛错不应将正常的 redirect 降级为 500——EXISTS 外包 try/catch,catch 内静默降级为跳过预检、继续执行 hash + 事务内 GETDEL(后者同样依赖 Redis,若 Redis 仍不可用会在事务内抛错,由区域二 catch 或全局错误处理兜底,与无 EXISTS 时的行为一致)。成本优化不改变用户可见错误形态。
  >
  > **reset 路径两区错误处理(v3.15 / v3.16 / v3.17 / v3.18 / v3.19 修正)**:错误处理分为两个 try/catch 区域。**区域一(预验证)**:构建 `ResetContext` 的 try/catch,捕获 `ResetTokenConsumedError` 后立即 redirect `?notice=expired-token` 并 return——预验证失败不进入事务。所有预验证失败仍归一化为 `ResetTokenConsumedError`(v3.17):关键原因是 `getJWTPayload`(`server/utils/jwt.ts:8`)抛出 `AuthenticationError`——`httpErrors(401, ...)` 工厂返回值,**不是 class**,`instanceof` 不匹配;payload shape 校验失败、createdAt 无效/未来/过期、team 不匹配、user 不存在、首次验签失败均归一化。**区域二(事务)**:包裹 `sequelize.transaction()` 的 try/catch,捕获事务内的 `ResetTokenConsumedError`(GETDEL 返回 null / Redis 坏值 / 用户已删除)、`JsonWebTokenError`(锁内重新验签失败)、`TokenExpiredError`,统一 redirect——**不暴露 500**。**登录态路径的错误分两类**(fix v3.19):构建 `LoginContext` 阶段的错误(`AuthenticationError` / `ValidationError`)在**两个 try/catch 之前**抛出,不经过任何 catch;但事务内 `verifyPassword` 抛出的 `ValidationError` **会经过区域二 catch**——因 `updateContext.kind === "login"`,catch 的 `if (updateContext.kind === "reset")` 条件不满足,直接 re-throw,行为正确,不会被 reset 分支吞掉。
  >
  > **Discriminated union 与类型收窄(v3.18 / v3.19 / v3.20)**:鉴权结果归一到 `PasswordUpdateContext = ResetContext | LoginContext`,以 `kind` 字段区分。事务闭包内 `updateContext.kind === "reset"` 时编译器保证 `.payload`(已收窄为 `PasswordResetPayload`)、`.jtiKey`、`.resetToken` 存在且类型正确;`kind === "login"` 时保证 `.currentPassword`、`.expires` 存在。取代了 v3.17 的 `let payload: JWT.JwtPayload | undefined` + `let jtiKey: string | undefined` + `isResetTokenPath` 布尔推断模式——后者在闭包捕获场景下 TypeScript 无法收窄,实现者被迫加 `!` 非空断言或 `as` 类型断言,丢失编译期安全性。`updateContext.user.id` 在两条路径上均来自已校验的 `User` 实例,`findByPk` 不再需要断言。**v3.19 进一步收窄 `resetToken` 本身**:zod `.superRefine()` XOR 是 runtime 校验,不产生 TypeScript narrowing——v3.18 的 `if (currentPassword !== undefined) ... else ...` 结构中,`else` 分支内 `resetToken` 仍为 `string | undefined`,`getJWTPayload(resetToken)` / `JWT.verify(resetToken, ...)` 类型不过。v3.19 改为 `if (resetToken !== undefined) { const token = resetToken; ... } else if (currentPassword !== undefined) { ... } else { throw ... }`:显式 `if` 收窄 `resetToken` 为 `string`,`const token` 固定 const 绑定(const 在闭包内保持 narrowing,let 不保证);`else` 的 fallback `throw` 满足 TypeScript 对 `updateContext` 的穷尽赋值检查。**v3.20 在分支前加了 handler 级 XOR guard**:`if ((resetToken !== undefined) === (currentPassword !== undefined)) throw ValidationError(...)`——作为 schema `.superRefine()` 之后的纵深防御,防止 validate 中间件被改动或绕过时静默选择 reset 分支。
  >
  > **Reset payload 结构化校验(v3.18 / v3.19)**:`getJWTPayload` 返回 `JWT.JwtPayload`,其自定义字段本质上是 `[key: string]: any`(`@types/jsonwebtoken/index.d.ts:123`)——v3.17 用 `payload.createdAt as string`、`payload.id as string` 绕过类型检查,运行时若 payload 被篡改或签名算法降级导致字段缺失/类型错误,`as` 断言不会拦截。v3.18 引入 `isPasswordResetPayload()` 类型守卫做 shape validation;v3.19 改用 `PasswordResetPayloadSchema`(zod `.object()`)+ `safeParse()`,与 §5.0 的 zod schema 风格一致,且消除了 `as Record<string, unknown>` 断言——`safeParse` 直接接受 `unknown` 输入,返回的 `.data` 已类型为 `PasswordResetPayload`;校验 `id` / `teamId` / `type`(literal `"password-reset"`)/ `createdAt` / `jti` 全部存在且为 `string`,失败归一化为 `ResetTokenConsumedError`。
  >
  > **createdAt 校验加固(v3.18 / v3.19)**:`new Date(undefined)` 和 `new Date("abc")` 均产生 Invalid Date,其 `getTime()` 返回 `NaN`;`NaN < subMinutes(...)` 为 `false`,等于没有判过期——任何非法 `createdAt` 值都能绕过时间窗口检查。v3.18 先 `Number.isFinite(createdAt.getTime())` 拒绝 Invalid Date,再拒绝未来时间(防止时钟异常或 payload 篡改将有效期拉长),最后判 15 分钟过期。v3.19 将未来时间判断从 `createdAt > new Date()` 改为 `createdAt > addSeconds(new Date(), 60)`,允许 60 秒时钟偏差容忍窗口——多实例/容器部署中,签发实例与验证实例的时钟可能有数十秒偏差(NTP 同步间隔、容器启动 skew),不加 leeway 正常签发的 token 会被误拒为"未来时间"。60 秒在安全与可用性之间取平衡:足以覆盖常见 NTP skew,但不足以被攻击者利用(配合 15 分钟 TTL,最多把有效窗口拉长到 16 分钟)。
  >
  > **Redis value 解析安全(v3.18)**:v3.17 直接 `JSON.parse(consumed)`,若 Redis 中存入坏值(corruption / 手动修改 / 编码错误),抛出的 `SyntaxError` 不在外层 catch 的 `instanceof ResetTokenConsumedError | JsonWebTokenError | TokenExpiredError` 范围内,穿透为 500。v3.18 在 try/catch 内解析,`SyntaxError` 转为 `ResetTokenConsumedError`;解析成功后再做 shape 校验(`typeof userId === "string" && typeof teamId === "string"`),字段缺失或类型错误同样转 `ResetTokenConsumedError`——安全方向:坏状态等同于"已消费",redirect `?notice=expired-token`。
  >
  > **行级锁 findByPk 去掉 rejectOnEmpty(v3.19)**:v3.18 的 `User.findByPk(updateContext.user.id, { rejectOnEmpty: true })` 在用户被删除时抛出 `EmptyResultError`(Sequelize 内部错误类),不在 catch 的 `instanceof ResetTokenConsumedError | JsonWebTokenError | TokenExpiredError` 范围内,穿透为 500。虽然预验证已确认用户存在,但在预验证与事务锁之间存在时间窗口(管理员删除用户、并发操作等)。v3.19 去掉 `rejectOnEmpty`,改为手动 null 检查:reset 路径抛出 `ResetTokenConsumedError`(被区域二 catch 捕获,redirect);login 路径抛出 `AuthenticationError`(401 JSON)。
  >
  > **锁定状态清零(v3.20)**:事务内赋值 `lockedUser.passwordHash = newHash`(hash 已在事务前预计算,fix v3.23)后、`save` 前,显式设置 `lockedUser.failedSignInAttempts = 0; lockedUser.lockedUntil = null;`。两条路径(reset / login)均执行:reset 路径——用户可能因被爆破而锁定,通过邮件重置密码后应立即可登录;login 路径——用户知道旧密码主动改密,锁定状态已无意义。与 §6 CLI 脚本的清零逻辑保持一致。`hooks: false` 的 `save` 同时覆盖 `passwordHash` 与这两个锁定字段,注释明确列出允许的字段范围。
  >
  > **登录态 cookie 重签使用事务返回值(v3.16)**:事务内用 `lockedUser.getSessionToken(updateContext.expires, "password")` 生成新 token 并作为事务回调的返回值,事务提交后用返回的 `newAccessToken` 设置 cookie。**不能用 `updateContext.user`**(`updateContext.user` 是事务外查到的实例,`rotateJwtSecret` 只修改了 `lockedUser.jwtSecret`)。`expires` 存储在 `updateContext` 中(纯日期计算,不涉及 DB),事务内外共用。
  >
  > **JWT / date-fns import 约定(v3.16 / v3.17 / v3.18 / v3.19 / v3.20 修正)**:`server/utils/jwt.ts` **没有 default export**(`server/utils/jwt.ts:8`),只导出 `getJWTPayload` / `getUserForJWT` 等具名函数;其内部 `import JWT from "jsonwebtoken"`(`:2`)但不重新导出。因此 password 插件的 import 分五组:`import JWT, { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken"` + `import { getJWTPayload } from "@server/utils/jwt"` + `import { z } from "zod"`(v3.19:payload shape validation 改用 zod safeParse)+ `import { AuthenticationError, ValidationError, InternalError } from "@server/errors"`(v3.18:骨架中使用的全部 error helper 显式列出,消除照抄时的编译缺口)+ `import { addMonths, addSeconds, subMinutes } from "date-fns"`(v3.20:骨架使用 `addSeconds`/`addMonths`/`subMinutes`,此前遗漏导入)。

  > 登录态路径的 cookie 设置与 JSON 响应都在事务提交**后**进行(设置 cookie 是 HTTP 响应操作,不是 DB 写入;token 在事务**内**由 `lockedUser` 生成并返回——见上文"cookie 重签使用事务返回值";不调用 `signIn`——`signIn` 会 `updateSignedIn`、写 `users.signin` 事件并 redirect,这里只需要 cookie)。reset 路径只做 302 redirect,无需 cookie 操作。cookie 参数**不传 `domain`**,复刻现有 self-host `signIn`(`server/utils/authentication.ts:137`)。

- **改密成功后的会话处理(保守路径)**:事务前 `User.hashPassword(password)` 预计算 hash(fix v3.23);事务内赋值 `lockedUser.passwordHash = newHash` + 清零 `failedSignInAttempts`/`lockedUntil`(fix v3.20)+ `save({ hooks: false })` + `rotateJwtSecret({ transaction })` 后:
  - **reset token 路径:不自动登录**。redirect 到登录页 **`${team.url}/?notice=password-updated`**,要求用户用新密码完整走一遍 §5.1 登录。理由:重置链接来自邮件,持有链接 ≠ 应直接获得会话——自动登录会把"邮箱被短暂访问"放大成"应用会话被建立",且绕过登录路径的 suspended 预检查、`client` 分支与限流;保守路径下这些检查天然由随后的真实登录承担,无需在 update 端点复刻。tradeoff 与备选(自动登录)已显式记入 §10。
  - **登录态路径**(`updateContext.kind === "login"`): `rotateJwtSecret()` 会使当前会话同样失效——事务**内**用 `lockedUser.getSessionToken(updateContext.expires, "password")` 生成新 token(必须用 `lockedUser`:它持有轮转后的 `jwtSecret`;`updateContext.user` 仍持有旧 secret,签出的 token 在事务提交后立即无效),作为事务返回值;事务提交后设置 `accessToken` cookie(sameSite lax,`expires` 来自 `updateContext.expires`)→ 返回 JSON `{ success: true }`。cookie 参数**完全复刻现有 self-host `signIn` 的写法**(`server/utils/authentication.ts:137`——只传 `sameSite: "lax"` + `expires`,**不传 `domain`**)。**不调用 `signIn`**(`signIn` 会 `updateSignedIn`、写 `users.signin` 事件并 redirect,`server/utils/authentication.ts:70-137`,改密不应产生这些副作用);不产生 `users.signin` 审计事件。**认证边界**:`currentPassword` 路径只接受 cookie transport(`parseAuthentication(ctx).transport === "cookie"`,§5.3 构建 `LoginContext` 时校验),header/body/query transport 一律 401 JSON。**失败响应(登录态路径)**:未登录 → 401 JSON;非 cookie transport → 401 JSON;当前密码错误 → **400 JSON**(`ValidationError("Current password is incorrect")`,无 cookie 重签、无密码变更)——**不用 401**:是因为 `ApiClient` 对 401 触发 `stores.auth.logout()`(`app/utils/ApiClient.ts:186`),设置页输错密码会导致前端自动登出;400 不触发 logout,前端原地展示错误;所有失败均返回 JSON HTTP error,**不走 302/HTML**——设置页经 `ApiClient` RPC 调用,`ApiClient` 对非 2xx 按 status code 映射 error 类(`app/utils/ApiClient.ts:186-278`),302/HTML 会导致解析失败。登录态路径的错误分两类(fix v3.19):构建 `LoginContext` 阶段的错误(`AuthenticationError` / `ValidationError`)在两个 catch 区域之前抛出,不经过任何 catch;事务内 `verifyPassword` 抛出的 `ValidationError` 会经过区域二 catch,但因 `updateContext.kind === "login"` 直接 re-throw,不会被 reset 分支吞掉。
- **审计**:在事务内写 `users.update` 事件,"密码已修改"由**显式事件 `data` 标记**(`data: { passwordChanged: true }`)表达——3 个密码字段都标了 `@SkipChangeset`(§4),changeset 里不会、也不允许出现 hash。有 SMTP 时给用户发"密码已修改"通知邮件(邮件发送在事务外,通过 mailer 队列异步)。

### 5.4 与现有认证体系的对接(易漏,必须做)

1. **`server/routes/api/auth/auth.ts` 的 `NON_SSO_SERVICES`**:加入 `"password"`,否则 `auth.info` 会把密码登录的 session 当作 SSO session 处理。
2. **`AuthenticationHelper.providersForTeam`——core 零修改**:password 的可见性**完全由 §5.5 的条件注册决定**,core 不读插件 env(避免 core → 插件的反向依赖)。已核对 `providersForTeam` 现有默认分支(`server/models/helpers/AuthenticationHelper.ts:70`):对非 email / passkeys 的 provider,self-host 下条件是 `!isCloudHosted && authProvider?.enabled !== false`——password 没有对应的 `team.authenticationProviders` 记录,`authProvider` 为 `undefined`,`undefined !== false` 为 true,**注册即天然可见,无需任何特判**(cloud-hosted 下同理天然隐藏,与"首版严格 self-host"一致)。**注意无 team 上下文分支**(`:65`):当 `!team` 时(如 root 登录页),`providersForTeam` 返回**全部非 email/passkeys 的已注册 provider**——这正是 §5.5 必须在注册条件里加 `!coreEnv.isCloudHosted` 的原因:若 cloud-hosted 误注册了 password,root 登录页会无条件展示它。唯一可选项:现有 sort 把 email / passkeys 排在末尾,password 若想挨着 email 展示可在 sort 中加一行——纯展示微调,不做也不影响功能。
3. **`plugins/password/server/index.ts` 注册 `Hook.EmailTemplate`**(见 §5.2)。

### 5.5 开关策略

`PASSWORD_AUTH_ENABLED`,**默认 false**;首版严格 self-host、env-only。**"严格 self-host"必须由代码保证**,不能只靠文档约束——cloud-hosted 环境误开 env 变量时端点不能变为可达。两处落点:

1. **env 定义——插件本地,不动 `server/env.ts`**:参照 OIDC 先例(`plugins/oidc/server/env.ts`),新增 `plugins/password/server/env.ts`。**完整文件骨架(照此实现,勿漏尾部实例导出)**:

   ```ts
   import { IsBoolean } from "class-validator";
   import { Environment } from "@server/env";
   import environment from "@server/utils/environment";

   class PasswordPluginEnvironment extends Environment {
     /**
      * Enables email + password authentication. Self-hosted only.
      */
     @IsBoolean()
     public PASSWORD_AUTH_ENABLED = this.toBoolean(
       environment.PASSWORD_AUTH_ENABLED ?? "false"
     );
   }

   export default new PasswordPluginEnvironment();
   ```

   类型化定义、默认 false、布尔校验、实例导出四者齐备,插件内 `import env from "./env"` 后 `env.PASSWORD_AUTH_ENABLED` 编译可过;不标 `@Public`(前端不读它,见下)。
2. **条件注册——开关 + cloud guard 双重控制可达性(关键)**:`/auth` 路由挂载遍历的是 `AuthenticationHelper.providers` 全量 hook(`server/routes/auth/index.ts:23` → `PluginManager.getHooks(Hook.AuthProvider)`),与 `providersForTeam` 无关——**只要注册了 `Hook.AuthProvider`,`/auth/password` 就可达**;另外 `providersForTeam` 在无 team 上下文时返回全部非 email/passkeys provider(`server/models/helpers/AuthenticationHelper.ts:65`),root 登录页会无条件展示。因此照搬 OIDC 的形态(`plugins/oidc/server/index.ts`:配置不满足则整个 `PluginManager.add` 不执行),**并在条件中加入 `!coreEnv.isCloudHosted`**:

   ```ts
   import coreEnv from "@server/env";
   import env from "./env";

   if (env.PASSWORD_AUTH_ENABLED && !coreEnv.isCloudHosted) {
     PluginManager.add([
       { ...config, type: Hook.AuthProvider, value: { router, id: config.id } },
       { type: Hook.EmailTemplate, value: PasswordResetEmail },
     ]);
   }
   ```

   > `coreEnv.isCloudHosted` 是 core `Environment` 的 getter(`server/env.ts:857`),按 URL 硬编码判断——在 cloud-hosted 下为 `true`,self-hosted 部署下为 `false`。插件 env 类继承自 `Environment` 因此也可以访问 `this.isCloudHosted`,但此处从 core env 实例导入更清晰,避免继承链上的歧义。

   关闭时或 cloud-hosted 时路由根本不挂载(POST 得 404),`providersForTeam` 也自然看不到它,登录页与端点一致;开启且 self-hosted 时按 §5.4 第 2 条,core 无需任何配合修改。
3. **端点入口兜底**:三个端点处理器开头再各加一次 `env.PASSWORD_AUTH_ENABLED && !coreEnv.isCloudHosted` 检查(false 即 404)。正常情况下不会走到(未注册即不可达),作为防御纵深保留,防止未来重构改变注册时机后开关失效。

前端不直接读取该变量——provider 可见性由条件注册经 `providersForTeam` / `auth.config` 自然传导到登录页(`/reset-password` 页面的可用性同理:开关关闭时 update 端点 404,页面提交自然失败,无需前端读开关)。env 是进程启动时读取的,改开关需重启,这与现有 OIDC 等插件行为一致。team 级开关整体移入 §10 后续演进,主路径不保留相关表述。

## 6. 无 SMTP 环境的密码初始化与找回

| 路径 | 形态 | 说明 |
|---|---|---|
| A. 服务器 CLI(v1 推荐) | `server/scripts/set-password.ts`,package.json 增加 yarn script,构建产物为 `build/server/scripts/set-password.js` | 管理员在服务器为用户设密/重置;半天实现,覆盖初始化与找回(现有脚本如 `server/scripts/reset-encrypted-data.ts` 即此形态)。多 workspace 场景下脚本参数需含 team 标识(子域名或 teamId),按 `{teamId, email}` 定位用户(§5.1 同口径) |
| B. 管理后台一次性链接 | 用户管理页生成 set-password 链接(复用 §5.2 的 jti token,落到 §7.2 的 `/reset-password` 页面) | 体验更好,需新增管理 UI 与权限;+1–2 天,列入 §10 |
| C. Bootstrap token | 环境变量注入一次性 token | 只解决首个管理员冷启动 |

v1 落地:**实现 A + 无 SMTP 时禁用忘记密码 UI**。

> **CLI 落库要求(fix v3.21 / v3.23:与 §5.3 update handler 同口径)**:CLI 脚本使用与服务端**完全一致的预计算-赋值-单次-save 模式**,不使用单独的 `User.update`:
>
> 0. **事务前预计算 hash(fix v3.23)**:`const newHash = await User.hashPassword(plain)`——与 §5.3 同口径,argon2 计算在行锁外完成,缩短锁持有时间;
> 1. **`SELECT ... FOR UPDATE` 锁定目标用户行**:`const lockedUser = await User.findByPk(user.id, { transaction, lock: transaction.LOCK.UPDATE })`——与 §5.3 事务骨架同口径;
> 2. **null 检查(fix v3.23)**:若 `lockedUser === null`,输出受控错误消息(如 `User not found or was deleted`)并让事务回滚(直接 throw 或 return,Sequelize 事务回调抛错即回滚)——`findByPk` 返回类型是 `User | null`,不做 null check 会有 TS 编译缺口,且目标用户可能被并发删除;与 §5.3 的手动 null 检查口径一致;
> 3. **在 `lockedUser` 实例上赋值全部字段**:`lockedUser.passwordHash = newHash`(fix v3.23:不在锁内调 `setPassword`/argon2)+ `lockedUser.failedSignInAttempts = 0` + `lockedUser.lockedUntil = null`——管理员重置密码即意味着解除锁定;
> 4. **一次 `save`**:`await lockedUser.save({ transaction, hooks: false })`——与 §5.3 同口径,`hooks: false` 跳过 changeset/通知;
> 5. `await lockedUser.rotateJwtSecret({ transaction })`——吊销该用户所有旧会话与未消费的 reset token,**必须做**;否则管理员重置密码后旧会话继续有效;
> 6. 写审计事件:`Event.create({ name: "users.update", userId: lockedUser.id, actorId: adminUserId ?? null, teamId: lockedUser.teamId, data: { passwordChanged: true, viaCliScript: true } }, { transaction })`——脚本上下文无 HTTP `ctx`,用 `Event.create` 而非 `createFromContext`;`actorId` 为执行脚本的管理员 userId(若脚本参数指定)或 null(无法确定时)。

## 7. 前端

### 7.1 登录页(password 分支 + 忘记密码入口)

- 在 `AuthenticationProvider.tsx` 新增 `id === "password"` 硬编码分支(与 email / passkeys 同构):邮箱 + 密码输入框,**native form POST 到 `/auth/password`**(参照 passkeys),让 `signIn` 的 302 + Set-Cookie 行为最自然。**form action 固定为不含 query string 的路径**(§5.0:三个端点的 query 是空 strict,任何 query 参数都会 400)。
- **CSRF 与 client 字段(必须做)**:`/auth` app 在 router 之前全局挂了 `verifyCSRFToken()`(`server/routes/auth/index.ts:94`),passkeys 的 native form 提交前会注入 `[CSRF.fieldName]: getCookie(CSRF.cookieName)` hidden input(`AuthenticationProvider.tsx:117`)。password 表单**同样必须带这个 CSRF hidden input**,否则已有 CSRF cookie 的场景下 POST 会 403。同时带 `client` hidden input(`Desktop.isElectron() ? Client.Desktop : Client.Web`,passkeys 同款逻辑),供服务端传入 `signIn` 的 `AuthenticationResult`。(这两个字段都已列入 §5.0 的 `.strict()` schema 枚举,前后端字段集合保持一一对应——前端加新 hidden input 时 schema 必须同步,否则 strict 校验会拒掉。)
- **"忘记密码"子状态**:password 分支内部增加一个轻量子状态(参照 email 分支现有的 `authState: "initial" | "email"` 状态机写法):点击密码输入框下方的"忘记密码?"链接 → 切到"输入邮箱发送重置链接"形态 → 发起 RPC 请求(JSON 即可,无需 native form——SMTP 可用时端点防枚举恒返回 success,无 redirect 语义;SMTP 不可用时返回 503,前端展示错误提示):

  ```ts
  await client.post("/password/reset", { email }, { baseUrl: "/auth" });
  ```

  **注意 baseUrl**:`ApiClient` 默认 `baseUrl` 是 `/api`(`app/utils/ApiClient.ts:55`,拼接逻辑 `:112`),不传 `baseUrl` 会请求到 `/api/auth/password/reset` 而 404。必须像 passkeys 调 `/auth` 下端点那样显式传 **`{ baseUrl: "/auth" }`**(先例:`AuthenticationProvider.tsx:81`)。`ApiClient` 自动带 CSRF header,`verifyCSRFToken` 同时接受 header 与 body 字段(`server/middlewares/csrf.ts:88`)。成功(2xx)后原地显示「如果该邮箱存在,我们已发送重置链接」,不跳转;503 时展示「邮件服务不可用」错误提示。"忘记密码?"链接仅在 `env.EMAIL_ENABLED` 为 true 时渲染(见 §7.3)。

### 7.2 重置密码公开页面(邮件链接落点)

邮件里的 `${team.url}/reset-password?token=…` 需要一个**无需登录**的页面承接。当前公开路由只有 `/`、`/create`、`/logout`、`/desktop-redirect`、`/oauth/authorize`、`/s/:shareId`(`app/routes/index.tsx:64`),没有可复用的入口,**新增**:

- **路由**:`app/routes/index.tsx` 公开区新增一行,与现有写法同构(lazy + exact):

  ```tsx
  const ResetPassword = lazy(() => import("~/scenes/Login/ResetPassword"));
  // …
  <Route exact path="/reset-password" component={ResetPassword} />
  ```

- **场景组件**:`app/scenes/Login/ResetPassword.tsx`。**视觉体系**:不自建布局,照搬同目录 `OAuthAuthorize.tsx` 的组合方式——复用 Login 体系现有组件:`Background`(`./components/Background`)+ `Centered`(`./components/Centered`)包裹,标题用 `Heading`、正文 `Text`、按钮 `ButtonLarge`、输入框 `InputLarge`,加 `PageTitle` 与 `ChangeLanguage`(`detectLanguage()`),与登录页观感一致。行为:
  - 从 query string 读 `token`(**页面 URL** 的参数,仅前端消费——这是 SPA GET 路由,不在 §5.0 红线范围内);无 token 时直接展示"链接无效"并引导回登录页;
  - 表单:新密码 + 确认新密码(前端校验一致性与最少 12 位,与 §5.3 服务端策略同口径);
  - 提交:**native form POST 到 `/auth/password/update`**(action 不带 query string,§5.0),hidden input 携带 **`resetToken`(严禁命名为 `token`)** 与 CSRF 字段(与 §7.1 登录表单同款注入逻辑;此路径不自动登录,无需 `client` 字段)。**改名原因(High,§5.0 红线)**:body 里名为 `token` 的字段会被 `parseAuthentication` 当认证 token(`transport: "body"`,`server/middlewares/authentication.ts:105`),`verifyCSRFToken` 对非 cookie transport 直接放行(`server/middlewares/csrf.ts:51`)——即"带会话 cookie 的用户访问重置页"这一场景下 CSRF 双提交校验会被整体绕过(query 向量同理由空 query strict 封堵,边界见 §5.0)。服务端验证通过即在事务前 `User.hashPassword` 预计算 hash,事务内赋值 `lockedUser.passwordHash = newHash` + `rotateJwtSecret({ transaction })` + 写事件(§5.3),**redirect 到登录页 `?notice=password-updated`**(§5.3 保守路径),用户用新密码登录;
  - 失败(token 过期/已消费/payload 畸形/不匹配/锁内验签失败/事务前验签失败/Redis 坏值):服务端在**两个 catch 区域**中统一 redirect 回登录页 `?notice=expired-token`(§5.3:预验证失败在区域一 redirect,事务内失败在区域二 redirect),**不暴露 500**——复用 `Notices.tsx` 已有的 expired-token 文案(「该链接已失效,请重新发起」语义吻合),不必新增 case;用户从登录页的"忘记密码"重新发起。
- **CSRF 覆盖范围说明(实现者须知)**:现有 CSRF 模型(`shouldProtectRequest`)只保护 **cookie transport** 的请求——`resetToken` 改名恢复的是"浏览器已有 accessToken cookie"场景下的双提交校验,空 query strict 封死的是 `?token=` 这条 transport 污染路径(route 层防线,边界见 §5.0);**完全匿名的 POST(无任何会话 cookie,transport 为 undefined)本就不在现有模型覆盖内**,这与现有 **passkeys native form POST** 的安全姿态一致(匿名登录类表单的 CSRF 价值有限:攻击者无法借受害者身份获益,且端点已有三键限流 + 防枚举)。首版接受此姿态;若要对未登录 reset 表单强制 CSRF,需要 route-level 校验或调整 middleware,列入 §10。
- **页面可用性**:不读 `PASSWORD_AUTH_ENABLED`(前端拿不到也不需要)——开关关闭时 update 端点本身 404(§5.5),页面提交自然落到失败分支。

### 7.3 通用约定

- **失败回跳**:登录页 notice 机制是 query-string 驱动的,但登录入口存在三种形态——team 子域名、自定义域名、self-host 根域。后端失败重定向**禁止硬编码根路径**,目标 URL 必须由**当前 team.url / 请求 hostname 推导**后再拼 `?notice=…`,否则会把用户踢回错误域名(`signIn` 内部的 suspended 根路径重定向即反例,已由 §5.1 预检查绕开)。
- **Notices 文案**:`app/scenes/Login/components/Notices.tsx` 的 `Message` switch 当前没有 password 相关 case,未注册的 notice 会落到默认的 "unknown error"。需新增三个 case:
  - `password-auth-failed` → 「邮箱或密码不正确。」(模糊文案,不区分用户不存在/密码错)
  - `password-locked` → 「登录失败次数过多,账号已临时锁定,请稍后再试。」
  - `password-updated` → 「密码已更新,请使用新密码登录。」(§5.3 保守路径的落点;`Notices` 组件目前统一渲染 warning 图标,该条是成功提示——实现时接受 warning 样式,或给该 case 单独换图标/样式,二选一,不阻塞)
  - (reset 链接失效复用已有 `expired-token`,不新增。)
- **"忘记密码"入口可见性**:仅在 SMTP 可用时渲染,前端判断用 **`env.EMAIL_ENABLED`**(`server/env.ts:401`,已标 `@Public`,前端经 public env 可读);服务端 §5.2 的可用性判断更严格(`env.EMAIL_ENABLED && !!env.SMTP_FROM_EMAIL`),两者存在缝隙时由服务端 unavailable 错误兜底,前端"忘记密码"子状态需准备错误展示(§7.1)。
- **设置页**:修改密码卡片放**个人 Profile / Preferences**,不放团队 Security;走登录态路径(当前密码 + 新密码,POST `/auth/password/update`,RPC 调用同样注意 `{ baseUrl: "/auth" }`;字段名遵守 §5.0 红线与 `.strict()` 枚举——只传 `currentPassword` + `password`,不传 `resetToken`,XOR 校验才能通过;不出现 `token`,URL 不带 query)。**成功响应形态**:登录态路径返回 JSON `{ success: true }` + 重签 cookie(§5.3),不做 302——`ApiClient` 对 2xx 会 `response.json()`(`app/utils/ApiClient.ts:182`),302/HTML 会导致解析失败;只有 `resetToken` native form 路径使用 302。**失败响应形态**:未登录/非 cookie transport → 401 JSON;当前密码错误 → 400 JSON(`ValidationError`,不用 401——`ApiClient` 对 401 触发 logout,见 §5.3);前端经 `ApiClient` 的 error 映射正常处理,在设置页原地展示错误提示。**认证要求**:设置页 RPC 经 `ApiClient` 发送时自动走 cookie transport,天然满足 §5.3 的 `parseAuthentication(ctx).transport === "cookie"` 认证边界要求。
- **SSO-only 用户的卡片可见性(fix v3.21 / v3.22)**:`passwordHash = null` 的 SSO-only 用户没有 current password,提交修改密码表单必然失败(§5.3 `verifyPassword` → false → 400)。解决方案:
  - **presenter 层(fix v3.22:用 `includePasswordState` 而非 `isMe`)**:`presentUser` 当前只有 `includeDetails`/`includeEmail` options(`server/presenters/user.ts:9`),**没有 `isMe`**;且 `includeDetails` 不只用于当前用户——团队管理员读他人详情时 `includeDetails` 也为 true(`server/policies/user.ts:33`),因此不能把 `hasPassword` 挂在 `includeDetails` 下。新增 **`includePasswordState?: boolean`** option,默认 false,**仅在 `auth.info` 返回当前用户时传 `true`**(`presentUser(user, { includeDetails: true, includePasswordState: true })`)。`includePasswordState` 为 true 时输出 `hasPassword: !!user.passwordHash`——仅暴露布尔值(不含 hash 本身)。管理员经 `users.info`/`users.list` 读他人用户时 `includePasswordState` 保持默认 false,响应中**不出现** `hasPassword` 字段。
  - **前端**:设置页读 `currentUser.hasPassword`:为 `true` 时渲染"修改密码"卡片(当前密码 + 新密码);为 `false` 时**不渲染该卡片**(SSO-only 用户不应看到无法使用的表单)。首版不提供"设置初始密码"路径(那需要绕过 current password 校验,安全面更大);SSO-only 用户若需设密码,走 §5.2 邮件重置或 §6 CLI。
  - **前端类型(fix v3.22)**:在 `app/models/User.ts` 补充 **`@observable hasPassword?: boolean`**,**不加 `@Field`**——`@Field` 会使该属性进入 `toAPI()` 并随保存请求发回服务端(`app/models/decorators/Field.ts:8`、`app/models/base/Model.ts:199`);`hasPassword` 是服务端下发的只读能力状态,不应回传。
- **i18n**:代码中只写 `t("…")` / `<Trans>`,locale 文件由工具自动提取,不要手改。

## 8. 安全清单(实现时逐条对照)

- [ ] 哈希用 argon2id(`argon2` 包,**先 `yarn add argon2` 更新 lockfile**),禁止自拼 crypto 原语。
- [ ] **登录失败路径 user null 安全(fix v3.26 / v3.27)**:`User.findOne` 返回 null 时仅执行 `argon2.verify(DUMMY_HASH, password)` + 模糊失败 redirect,**不访问 `user.id` / `user.isSuspended` / `user.lockedUntil`、不递增 `failedSignInAttempts`、不写 `lockedUntil`、不写审计事件**;`user !== null` 时才检查用户级 suspended/locked 状态、执行 `verifyPassword` + 原子递增/锁定。两条路径响应与耗时形态一致(dummy hash 抹平时序枚举)。
- [ ] **team 解析前 IP-only 预限流(fix v3.27)**:登录与 reset 都先 consume 轻量 IP-only key(`password-login-preteam:ip` / `password-reset-preteam:ip`),覆盖 team 不存在、custom domain 探测、provider unavailable 等没有 `teamId` 的失败路径;阈值宽于正式 IP key。team 解析成功后仍必须执行正式三键限流,预限流不得替代正式爆破/邮件轰炸防线。
- [ ] **登录端点专用限流器(fix v3.26 / v3.27:key 带 team 维度,且先于用户查询)**:三键 consume(`ip` / `teamId:emailHmac` / `ip:teamId:emailHmac`,HMAC-SHA256 用 `SECRET_KEY`)+ 账号锁定,双层防爆破。**key 必须包含 `teamId`**:同一邮箱可存在于多个 workspace,无 team 维度的 key 会导致 A workspace 的攻击限流 B workspace 同邮箱的正常用户;team 解析在正式限流前完成;全局 `ip` key 不带 team 维度,保留作跨 workspace 总体防护。正式三键限流必须在 `User.findOne` 前执行,超限时不查用户、不跑 dummy/真实 argon2。
- [ ] **reset 端点专用限流器(fix v3.23 / v3.26 / v3.27:key 带 team 维度,且先于用户查询)**:同样三键 consume(`ip` / `teamId:emailHmac` / `ip:teamId:emailHmac`),**在用户查找前对所有邮箱统一执行**(防枚举);阈值严于登录端点(reset 触发邮件发送,成本更高);超限时不生成 token、不写 Redis、不发邮件,直接返回 429。key 带 team 维度口径与登录端点一致。
- [ ] **失败计数用原子 `User.increment`**(`UPDATE … SET … = … + 1`,不是读-改-写),并发安全;**`failedSignInAttempts` 列必须 `NOT NULL DEFAULT 0`**(NULL + 1 = NULL 会使锁定策略失效);清零用 `User.update({ failedSignInAttempts: 0 }, { where })`(幂等);先例 `View.incrementOrCreate`(`server/models/View.ts:74`)。
- [ ] **用户查询必须 team 作用域且排在正式限流之后**:先按 hostname 解析 team,正式三键限流通过后再 `{teamId, email}` 查;登录、reset、update、CLI 脚本四处同口径,杜绝同邮箱跨 workspace 串账号。登录/reset 的超限请求不得继续打用户表。
- [ ] **CLI 脚本落库语义与服务端完全一致(fix v3.21 / v3.23,§6)**:事务前 `User.hashPassword(plain)` 预计算 hash(fix v3.23)→ 事务内 `SELECT ... FOR UPDATE` 锁定目标用户行 → **null 检查**(fix v3.23:`findByPk` 返回 `User | null`,null 时输出受控错误并回滚)→ 赋值 `lockedUser.passwordHash = newHash` + 清零 `failedSignInAttempts`/`lockedUntil` → 一次 `save({ transaction, hooks: false })` → `rotateJwtSecret({ transaction })` → 写审计事件;**不使用单独的 `User.update` 清零锁定状态**——与 §5.3 update handler 预计算-赋值-单次-save 模式同口径;脚本不能只改 `passwordHash` 而留旧 `jwtSecret`。
- [ ] reset token:payload `{ id(userId), teamId, type: "password-reset", createdAt, jti }`,`user.jwtSecret` 签名,15 分钟;**`getPasswordResetToken()` 返回 `{ token, jti }`(fix v3.21)**——调用方用返回的 `jti` 写 Redis,无需 decode token;jti 入 Redis、value 存 `{ userId, teamId }`、原子一次性消费并交叉核对;**目标用户只能来自 token 的 `id` 声明**,update 请求体不接受 email/userId 参数。
- [ ] **`token` 字段红线(body 与 query)**:`/auth/password/*` 的请求体**和 query string** 中都禁止出现名为 `token` 的字段——`parseAuthentication` 按 body → query → cookie 取认证 token(`server/middlewares/authentication.ts:105` / `:114`),两者都会污染 transport 使 `verifyCSRFToken` 整体跳过(`server/middlewares/csrf.ts:51`)。body 侧修复 = 字段改名 `resetToken`;query 侧修复 = 空 query strict(合法请求本就不带 query,改名无从谈起)。
- [ ] **三个 schema:body 全部 `.strict()` 并枚举合法字段(含 `_csrf` / `client`)+ `query: z.object({}).strict()` + update 的 XOR**:Zod 默认剥离未知字段不报错(`server/middlewares/validate.ts:14`、`server/routes/api/schema.ts:9`),不加 `.strict()` 则"出现 `token` 即 400"不成立;`resetToken` / `currentPassword` 必须且只能其一(`.superRefine()`,§5.0);同时牢记 strict 拒绝发生在 route validation 阶段、晚于全局 CSRF 中间件与 optional auth——body 向量上它是钉死改名红线的纵深、**不能替代 `resetToken` 改名**,query 向量上它是 route 层唯一拒绝点(400 先于 handler,**password 端点的状态变更不执行**;但有效 query token 仍会触发 optional auth 的 activeAt 元数据刷新,边界与定性见 §5.0)。
- [ ] **reset token 消费成功后不自动登录**:redirect `?notice=password-updated`,会话只能经 §5.1 完整登录路径建立(suspended 预检查、限流、审计天然复用)。
- [ ] **登录态改密路径只接受 cookie transport**:`currentPassword` 路径必须 `ctx.state.auth.user` 存在**且** `parseAuthentication(ctx).transport === "cookie"`——不能只检查 `type === AuthenticationType.APP`,因为 header 传入的 session JWT 同样得到 `type = APP`(`:242`);API key / OAuth token / **header/body/query 传入的 session JWT** 一律 401 JSON。失败响应必须是 JSON HTTP error(设置页经 `ApiClient` 调用,302/HTML 会解析失败)。
- [ ] **update handler 的落库操作必须在显式 `sequelize.transaction()` 内完成**(赋值 `lockedUser.passwordHash = newHash`(hash 已在事务前由 `User.hashPassword` 预计算,fix v3.23)+ 清零 `failedSignInAttempts`/`lockedUntil` + `save({ transaction, hooks: false })` + `rotateJwtSecret({ transaction })` + 写审计事件);`/auth` app 无全局 transaction 中间件(§5.3)。`save({ hooks: false })` 是有意为之(只改 passwordHash 与锁定状态,跳过 changeset/通知 hooks);`rotateJwtSecret` 的 `save` 不带 `hooks: false`。
- [ ] **改密成功后清零锁定状态(fix v3.20)**:事务内赋值 `lockedUser.passwordHash = newHash` 后(hash 已在事务前预计算,fix v3.23)、`save` 前设置 `lockedUser.failedSignInAttempts = 0; lockedUser.lockedUntil = null;`,与 §6 CLI 脚本同口径——否则用户通过邮件重置密码后仍可能因旧锁定状态无法立即登录。
- [ ] **reset token 路径写审计事件必须绕开 `createFromContext`**(§5.3):用 `Event.create` 直接传 `actorId: user.id, teamId: user.teamId`,避免 `ctx.state.auth.user`(来自 optional auth)覆盖 defaultAttributes 导致事件归属错误用户。登录态路径可继续用 `createFromContext`。
- [ ] **Redis jti 消费使用单次 GETDEL 作为权威判定**(§5.3):不先 GET 后 GETDEL——两阶段方案存在并发绕过;GETDEL 返回 null 立即拒绝,返回 value 再核对 `{ userId, teamId }`;GETDEL 放在事务内,接受回滚后 token 已消耗的 tradeoff。
- [ ] **事务内 `SELECT ... FOR UPDATE` 锁定用户行 + 锁内重新验证**(§5.3):防止同一用户多个不同 reset token 并发绕过 `rotateJwtSecret` 失效机制——两个 token 都在事务外验签通过、各自 GETDEL 成功、最后一次覆盖前一次密码;行级锁序列化写入,锁内重新验签/verifyPassword 保证凭据仍有效。
- [ ] **`findByPk` 不使用 `rejectOnEmpty`(fix v3.19)**:手动 null 检查替代——reset 路径抛 `ResetTokenConsumedError`(被区域二 catch redirect,不 500);login 路径抛 `AuthenticationError`(401 JSON)。`EmptyResultError`(Sequelize 内部类)不在 catch 的 `instanceof` 范围内,使用 `rejectOnEmpty` 会穿透为 500。
- [ ] **reset 路径所有 token 失败统一 redirect `?notice=expired-token`(两区 catch)**:预验证失败(decode / payload shape / createdAt / team / user / 首次验签)归一化为 `ResetTokenConsumedError`,在**区域一 catch** redirect;事务内失败(锁内验签 `JsonWebTokenError` / GETDEL `ResetTokenConsumedError` / Redis 坏值 `ResetTokenConsumedError` / **用户已删除 `ResetTokenConsumedError`(fix v3.19)**)在**区域二 catch** redirect——**不暴露 500**;登录态路径:构建 `LoginContext` 阶段的错误在两区之前抛出;事务内 `verifyPassword` 的 `ValidationError` 经过区域二 catch 但因 `kind === "login"` 直接 re-throw(fix v3.19 描述修正),行为正确。
- [ ] **登录态路径所有失败返回 JSON HTTP error**:未登录 → 401;非 cookie transport → 401;当前密码错误 → **400**(`ValidationError`,**不用 401**——`ApiClient` 对 401 触发 `stores.auth.logout()`,`app/utils/ApiClient.ts:186`,设置页输错密码不应导致前端登出);**不走 302/HTML**(`ApiClient` 对 302/HTML 解析失败)。
- [ ] 改密成功调用 `rotateJwtSecret({ transaction })` 吊销全部旧会话(含未消费的 reset token);登录态路径事务**内**用 `lockedUser.getSessionToken()` 生成新 token(**不能用事务外的 `user` 实例**——`rotateJwtSecret` 只修改了 `lockedUser.jwtSecret`,旧实例签的 token 立即无效),事务提交后用返回值设置 cookie(cookie 参数复刻现有 `signIn`,不传 `domain`);**设置 cookie 前显式 guard `if (!newAccessToken)`**(事务回调类型为 `string | null`,TypeScript 无法证明登录态路径一定非 null)。
- [ ] **GETDEL 在 DB 变更(hash 赋值 / `save` / `rotateJwtSecret`)之前执行**(§5.3):若放在之后,`rotateJwtSecret` 抛错时 GETDEL 未执行、token 未消耗,§9 测试 19b 的回滚 tradeoff 语义不成立。
- [ ] **argon2 hash 在事务外预计算(fix v3.23)**:事务前调用 `const newHash = await User.hashPassword(password)`,事务内仅 `lockedUser.passwordHash = newHash`(纯赋值);不在 `SELECT ... FOR UPDATE` 行锁内调用 `setPassword`/argon2——argon2 是故意昂贵的操作,放在锁内会放大并发等待;安全语义不变(凭据重新验证在赋值前);§6 CLI 同口径。
- [ ] **reset 分支 hash 前 Redis EXISTS 成本闸门(fix v3.24 / v3.25)**:`updateContext.kind === "reset"` 时,在 `User.hashPassword` 前调用 `redis.exists(updateContext.jtiKey)`:返回 0(key 不存在,token 已消费或从未生成)直接 redirect `?notice=expired-token`,跳过 argon2;返回 1 才继续 hash。`EXISTS` 仅是成本闸门,不是权威判定——事务内 GETDEL 仍是唯一权威判定不变;login 分支不做 EXISTS(无 jti key)。**EXISTS 失败降级(fix v3.25)**:`redis.exists` 外包 try/catch,抛错时降级为跳过预检、继续 hash + 事务内 GETDEL——成本优化不改变用户可见错误形态;§9 测试 8b 子断言 1/2/3 钉住。
- [ ] **reset token 验证链分两区 catch(fix v3.18 / v3.19)**:预验证(构建 `ResetContext`)有独立 try/catch,失败 redirect 后 return,不进入事务;事务(锁内验签 + GETDEL + Redis 解析 + 用户已删除)有独立 try/catch,失败 redirect。两区都只在 `updateContext.kind === "reset"` 时捕获 `ResetTokenConsumedError` / `JsonWebTokenError` / `TokenExpiredError`,其他错误 re-throw。登录态路径:构建 `LoginContext` 阶段的错误在两区之前抛出;事务内 `verifyPassword` 的 `ValidationError` 经过区域二 catch,但因 `kind === "login"` 直接 re-throw,不被吞掉(fix v3.19 描述修正)。
- [ ] **JWT / zod / date-fns import 正确**:`server/utils/jwt.ts` 无 default export;`JWT` / `JsonWebTokenError` / `TokenExpiredError` 全部从 `jsonwebtoken` 导入;`getJWTPayload` 从 `@server/utils/jwt` 具名导入;`z` 从 `zod` 导入(fix v3.19:payload shape validation 改用 zod safeParse);**`AuthenticationError` / `ValidationError` / `InternalError` 从 `@server/errors` 导入**(fix v3.18:骨架中使用的全部 error helper 显式列出);**`addMonths` / `addSeconds` / `subMinutes` 从 `date-fns` 导入**(fix v3.20:骨架中使用但此前遗漏)——与 `User.ts:3` 和 `server/utils/jwt.ts:2` 的写法一致。
- [ ] **reset payload 结构化校验(fix v3.18 / v3.19)**:`getJWTPayload` 返回 `JWT.JwtPayload`(自定义字段为 `any`),decode 后必须经 `PasswordResetPayloadSchema.safeParse()` 校验 `id` / `teamId` / `type`(literal `"password-reset"`)/ `createdAt` / `jti` 全部存在且为 `string`;失败归一化为 `ResetTokenConsumedError`;`safeParse().data` 已类型为 `PasswordResetPayload`,后续访问不需要 `as` 断言——使用 zod 而非手写类型守卫,消除 `as Record<string, unknown>`,与 §5.0 schema 风格一致。
- [ ] **createdAt 校验防御 Invalid Date 和未来时间(fix v3.18 / v3.19)**:`new Date(payload.createdAt)` 后先 `Number.isFinite(getTime())` 拒绝 Invalid Date(否则 `NaN < subMinutes(...)` 为 `false`,等于没有判过期),再 `createdAt > addSeconds(new Date(), 60)` 拒绝未来时间(防时钟异常 / payload 篡改拉长有效期,60 秒 leeway 容忍多实例/容器间的时钟偏差——fix v3.19),最后判 15 分钟过期。
- [ ] **Redis jti value 解析安全(fix v3.18)**:`JSON.parse(consumed)` 必须在 try/catch 内,`SyntaxError` 转 `ResetTokenConsumedError`;解析成功后 shape 校验 `typeof userId === "string" && typeof teamId === "string"`,字段缺失或类型错误同转 `ResetTokenConsumedError`——坏状态等同于已消费,redirect `?notice=expired-token`,不暴露 500。
- [ ] **鉴权结果使用 discriminated union(fix v3.18 / v3.19)**:`PasswordUpdateContext = ResetContext | LoginContext`,以 `kind` 字段区分;事务闭包内用 `updateContext.kind === "reset"` 收窄,编译器保证字段存在;不再使用 `isResetTokenPath` 布尔推断外部 `let` 变量已赋值(闭包捕获场景下 TypeScript 无法收窄)。**分支以 `resetToken !== undefined` 驱动(fix v3.19)**:显式 `if` 收窄 `resetToken` 为 `string`,`const token = resetToken` 固定 const 绑定(闭包安全);`else if (currentPassword !== undefined)` 收窄 login 路径;fallback `else throw` 满足穷尽检查——zod XOR `.superRefine()` 是 runtime 校验,不产生 TS narrowing。**handler 级 XOR guard(fix v3.20)**:分支前显式 `if ((resetToken !== undefined) === (currentPassword !== undefined)) throw ValidationError(...)`,作为 schema 层之后的纵深防御。
- [ ] 改密成功发邮件通知(SMTP 可用时,事务外异步)。
- [ ] **3 个密码字段全部 `@SkipChangeset`**:`Model.insertEvent` 把 `previousChangeset` 写入 `events.changes`(`server/models/base/Model.ts:320`),hash 不允许经 changeset 落入 events 表;"密码已修改"用显式事件 `data` 布尔标记表达。
- [ ] 密码明文永不进入日志与 events payload;`passwordHash` 不进任何 presenter 序列化输出。
- [ ] **presenter `hasPassword` 字段(fix v3.21 / v3.22)**:`presentUser` 新增 `includePasswordState?: boolean` option(默认 false),为 true 时输出 `hasPassword: !!user.passwordHash`——仅暴露布尔值(不含 hash 本身)。**仅 `auth.info` 返回当前用户时传 `includePasswordState: true`**;管理员 `users.info`/`users.list` 读他人用户时保持 false,响应中不出现 `hasPassword`。前端 `app/models/User.ts` 用 `@observable hasPassword?: boolean`(**不加 `@Field`**——`@Field` 会进入 `toAPI()` 回传服务端,`hasPassword` 是只读能力状态)。
- [ ] `"password"` 加入 `NON_SSO_SERVICES`,避免被当作 SSO session。
- [ ] **`PASSWORD_AUTH_ENABLED=false` 或 `isCloudHosted` 时 `Hook.AuthProvider` 不注册,`POST /auth/password` 不可达(404)**;端点内再做同条件兜底检查(同样 404),双层防护。
- [ ] `providersForTeam` **零修改**(core 不读插件 env),可见性由条件注册传导;可选排序微调不引入开关逻辑。
- [ ] `passwordHash` 为 null 的 SSO 用户走密码登录 → 拒绝,且耗时与密码错误一致。
- [ ] 失败回跳目标由 team.url / 请求 hostname 推导,覆盖子域名 / 自定义域名 / 根域三种入口。
- [ ] suspended(team / user)在调用 `signIn` 前预检查并按推导域名回跳,绕开 `signIn` 内部的根路径硬编码重定向。team 级检查在 team 解析后执行;user 级检查必须在 `user !== null` 分支内执行。
- [ ] native form 提交(登录表单、`/reset-password` 表单)携带 CSRF hidden input(`CSRF.fieldName` ← `CSRF.cookieName`),action 为不含 query 的端点路径,在 **cookie transport 场景**下通过 `/auth` app 全局 `verifyCSRFToken()`(匿名场景的覆盖范围限制见 §7.2 说明);"忘记密码"等 RPC 请求经 `ApiClient` 自动带 CSRF header,且必须显式传 `{ baseUrl: "/auth" }`。
- [ ] `/reset-password` 页面不在 URL 之外暴露 token(不写 localStorage、不进日志)。
- [ ] **新增 User 方法补 JSDoc(fix v3.20 / v3.21 / v3.22 / v3.23)**:`setPassword` / `verifyPassword` / `getPasswordResetToken` / `hashPassword`(static,fix v3.23)为新增公开模型方法,§4/§5.2 代码片段已包含 JSDoc + arrow property 最终形态(匹配 `rotateJwtSecret`/`getEmailSigninToken` 风格);每个方法均含 `@param`、`@returns`(start lowercase, end with period),`verifyPassword` / `setPassword` / `hashPassword` 均标注 `@throws`(fix v3.24:项目规范要求适用时写 `@throws`,三个方法都调用 `argon2.hash` 或 `argon2.verify`,运行时可能抛错);实现时照搬片段即可,禁止省略 JSDoc。

## 9. 测试(plugins/password/server/auth/password.test.ts)

1. `auth.config` 在开关开/关时正确暴露/隐藏 password provider;
2. **`PASSWORD_AUTH_ENABLED=false` 时 `POST /auth/password` 不可达**(路由未注册,404);**`isCloudHosted` 环境下即使 `PASSWORD_AUTH_ENABLED=true` 也不可达**(404);仅 self-hosted + 开启时可达;
3. 正确密码登录成功,cookie 与 `users.signin` 审计事件正确(`signIn(ctx, "password", …)` 形参与 `client` 传递正确,Web / Desktop 两种 client 的重定向分支);
4. **同邮箱多 workspace 隔离(fix v3.26:含限流隔离)**:两个 team 各有同邮箱用户、密码不同,从 A 入口用 B 的密码登录被拒,从各自入口用各自密码登录成功且会话归属正确;reset 流程同样只命中当前 team 的用户;**限流互不污染**:对 A workspace 的同邮箱连续发起接近阈值的错误登录/reset,B workspace 同邮箱的正常登录/reset 不受限流影响(限流 key 含 `teamId`,A 的 `teamId:emailHmac` 消耗不影响 B 的同名 key);team 解析前 IP-only 预限流阈值足够宽,不得在此正常跨 workspace 场景中先于正式 key 误伤。
5. **错误密码与用户不存在(fix v3.26 / v3.27:拆分断言)**:错误密码 → redirect 到 `?notice=password-auth-failed` + 计数递增;**用户不存在 → 同样 redirect `?notice=password-auth-failed`,响应与耗时形态一致,且 `failedSignInAttempts` 未被递增(无目标用户)、不访问 `user.isSuspended` / `user.lockedUntil`、不 500**;
6. 连续失败触发锁定(redirect `?notice=password-locked`),锁定期内正确密码也被拒,到期解锁;
7. **登录端点限流(fix v3.27:具体 key 与执行顺序)**:
    a. **正式三键任一超限返回 429**:分别覆盖 `ip`、`teamId:emailHmac`、`ip:teamId:emailHmac` 三个 key,禁止写成旧口径的全局 `emailHmac` / `ip:emailHmac`;
    b. **正式限流先于用户查询**:stub/spy `User.findOne` 与 `User.verifyPassword`,当任一正式 key 已超限时,请求返回 429,`User.findOne` / dummy argon2 / `verifyPassword` 均未被调用;
    c. **team 解析前 IP-only 预限流**:未知 hostname/custom domain 或 password provider unavailable 连续请求超过预限流阈值 → 429;该场景没有 `teamId`,不得写入 `teamId:emailHmac` key;正常解析成功的请求仍继续走正式三键限流。
8. **(v3.20 拆分为独立子用例)reset token 消费与边界校验**:
    a. **正常消费(含 jti 一致性断言)**:字段名 `resetToken`,分两阶段断言(fix v3.22)——**阶段一(生成后、POST 前)**:调用 `getPasswordResetToken()` 取 `{ token, jti }`,写入 Redis 后、发起 POST **之前**,断言 Redis key `password-reset:jti:${jti}` 存在,其 value 解析后 `userId`/`teamId` 与 JWT payload(decode token)中的同名声明一致(钉死返回值 `{ token, jti }` 与 Redis 写入的一致性,fix v3.21);**阶段二(消费后)**:POST 成功,改的是 token `id` 声明的那个用户,redirect `?notice=password-updated` 且响应不携带会话 cookie;Redis key 已不存在(被 GETDEL 消费);`failedSignInAttempts` 清零、`lockedUntil` 清空(fix v3.20);
    b. **二次使用被拒(含 EXISTS 成本闸门断言,fix v3.25)**:同一 reset token 二次使用 → redirect `?notice=expired-token`(jti 已被 GETDEL 消费)。**子断言 1(EXISTS 拦截跳过 argon2)**:spy `User.hashPassword`,第二次请求时 Redis key 已不存在(被首次 GETDEL 消费),EXISTS 返回 0 直接 redirect,`User.hashPassword` **未被调用**——钉死成本闸门生效。**子断言 2(EXISTS=1 但 GETDEL=null 仍拒绝,证明 EXISTS 不是权威判定)**:stub `redis.exists` 始终返回 1(模拟 EXISTS 与 GETDEL 之间的并发窗口),第二次请求通过 EXISTS 进入 hash + 事务,但事务内 GETDEL 返回 null → redirect `?notice=expired-token`,密码未改——证明即使 EXISTS 被绕过/误判,GETDEL 仍是唯一权威判定。**子断言 3(EXISTS 抛错降级,fix v3.25)**:stub `redis.exists` 抛出 `Error("REDIS CONN")`(模拟 Redis 短暂故障),第二次请求不 500——EXISTS catch 降级为跳过预检,继续 hash + 事务内 GETDEL(GETDEL 返回 null → redirect `?notice=expired-token`),用户可见行为与无 EXISTS 时一致;
    c. **过期被拒**:`createdAt` 超过 15 分钟的 reset token → redirect `?notice=expired-token`;
    d. **team 不匹配**:`teamId` 不匹配当前请求解析出的 team → redirect `?notice=expired-token`;
    e. **Redis value 异常**:Redis value 与 payload 不一致被拒;Redis value 非 JSON(如手动写入坏值)或字段缺失(如 `{ userId: 123 }` 非 string)→ redirect `?notice=expired-token`,不 500(fix v3.18:钉死 Redis parse + shape 校验);
    f. **payload 缺字段**:payload 缺少必需字段(如无 `jti` / `createdAt`)→ redirect,不 500(fix v3.18/v3.19:钉死 `PasswordResetPayloadSchema.safeParse` 校验);
    g. **非法日期与未来时间**:`createdAt` 为非法日期字符串(如 `"abc"`)→ redirect,不 500(fix v3.18:钉死 Invalid Date 校验);`createdAt` 为未来时间(超过 60 秒)→ redirect,不 500;`createdAt` 为未来时间(60 秒内)→ 通过(fix v3.19:60 秒时钟偏差容忍窗口);
    h. **用户被删除(确定性模拟)**:用户在预验证后被删除 → redirect `?notice=expired-token`,不 500(fix v3.19:钉死 `findByPk` 去掉 `rejectOnEmpty` 后的手动 null 检查)。**模拟方式(fix v3.21 / v3.22)**:真实并发窗口不可控且偶发不稳定;**仅使用 stub/barrier 方案**:stub `User.findByPk` 使其在事务内(即 options 含 `lock: transaction.LOCK.UPDATE` 时)返回 `null`,同时保持预验证阶段的 `User.findOne` 正常返回用户——这样预验证通过(构建 `ResetContext` 成功),但事务内 `findByPk` 返回 null 触发 `ResetTokenConsumedError` redirect。**不要用"先 `user.destroy()` 后发 POST"**(fix v3.22):预验证的 `User.findOne`(`§5.3:525`)在事务前执行,用户已删除会直接在预验证阶段 redirect,根本不会进入事务,无法覆盖事务内 `findByPk` 返回 null 的目标分支;
    i. **strict schema 拒绝额外参数**:update 请求体附带的 email/userId 参数被拒(strict schema 400);
9. 改密后旧 cookie 全部失效(`rotateJwtSecret` 生效),该用户其余未消费 reset token 同时失效,用新密码经 §5.1 登录正常;**改密成功后 `failedSignInAttempts` 清零、`lockedUntil` 清空**(fix v3.20:与 §6 CLI 脚本同口径——此前被锁定的用户通过 reset 改密后必须能立即登录);**update handler 的事务前 `User.hashPassword` 预计算 hash、事务内 `lockedUser.passwordHash = newHash` 赋值 / 锁定状态清零 / `rotateJwtSecret` / 事件写入在同一事务内**(模拟中间步骤失败时应全部回滚);
10. SSO-only 用户(`passwordHash = null`)被拒;**设置页 `hasPassword` presenter 字段(fix v3.21 / v3.22)**:`auth.info` 返回当前用户时 `passwordHash = null` 的用户 `hasPassword === false`,`passwordHash` 非 null 的用户 `hasPassword === true`;**管理员经 `users.info`/`users.list` 读他人用户时响应中不出现 `hasPassword` 字段**(fix v3.22:钉死 `includePasswordState` 仅在 `auth.info` 打开);
11. suspended:`user.isSuspended` / `team.isSuspended` 均在 `signIn` 前被拒,且回跳到发起请求的正确域名(不落到根路径);
12. **SMTP 不可用时 reset 端点拒绝(两个子用例)**:
    a. `EMAIL_ENABLED = false` 时 `/auth/password/reset` 返回 unavailable,前端"忘记密码"入口隐藏;
    b. `EMAIL_ENABLED = true` 但 `SMTP_FROM_EMAIL` 缺失时,`/auth/password/reset` 返回 HTTP 503 JSON 错误(服务端 `ServiceUnavailableError` 或 `httpErrors(503, ...)`);前端"忘记密码"子状态展示错误提示(入口可见但提交失败,因为前端只能读 `EMAIL_ENABLED`;`ApiClient` 对 503 映射为 `ServiceUnavailableError`,`app/utils/ApiClient.ts:266`);
13. 登录失败时重定向到发起请求的正确域名(子域名 / 自定义域名 / 根域三种入口);
14. **CSRF 与 schema(六子项)**:
    a. 携带 accessToken cookie 但缺少 / 错误 CSRF 字段的表单 POST 被 `verifyCSRFToken()` 拒绝;携带正确 hidden input 的提交通过——**此用例同时隐式验证 `.strict()` 枚举了 `_csrf` / `client`:若漏列,合法提交会在 validation 阶段被误拒,用例直接失败**;
    b. **update 请求 body 用 `resetToken` 字段名时,携带 accessToken cookie 的请求仍走 cookie transport、CSRF 校验生效**(对照组:故意把字段命名为 `token` 时 transport 变为 body、CSRF 被跳过——该对照用例用于钉死 §5.0 红线,防止未来改名回退;注意对照请求会在 validation 阶段被 strict schema 400,断言点是 CSRF 中间件的跳过行为发生在 400 之前,而非最终状态码);
    c. **strict body schema 拒绝未知字段**:请求体中出现 `token` 字段 → 400(`ValidationError`);出现其他任意未声明字段 → 同样 400——注意 Zod 默认剥离未知字段不报错,此用例只有在 schema 带 `.strict()` 时才会通过,用于钉死 §5.0 的 schema 要求;
    d. 三个端点的 body schema 各自枚举的合法字段集合与前端实际提交字段一一对应(登录:`email`/`password`/`client`/`_csrf`;reset:`email`/`_csrf`;update:`resetToken` 或 `currentPassword` + `password`/`_csrf`),合法组合全部通过;
    e. **query `?token=` 被拒(断言口径见 §5.0,勿写过强)**:三个端点各发一次带 `?token=x` 的 POST(其余字段合法、且可携带 accessToken cookie)→ 全部 400(空 query strict),断言**password handler 未执行**——密码未改、`failedSignInAttempts` 未动、无 password 相关事件(`users.signin` / `users.update`);**不要断言"全局无任何状态变更"**:若 `?token=` 是有效 JWT / API key,前置的 `authMiddleware({ optional: true })` 会先刷新 user / team 的 activeAt 元数据(API key 还有自身 activeAt)——这是 `/auth` 全部 provider 路由的既有行为,不在本插件断言范围内。同时断言该请求在 CSRF 中间件处因 `transport: "query"` 被跳过(与 14b 同款"跳过先于 400"的断言口径);另发一次带任意其他 query 参数(如 `?foo=1`)的 POST 同样 400,验证 strict 是全量的而非只针对 `token`;
    f. **update XOR**:`resetToken` 与 `currentPassword` 都缺失 → 400;两者同时出现(即便各自值都有效)→ 400;只带 `resetToken`(+ `password`)与只带 `currentPassword`(+ `password`)两条合法路径分别通过 validation 进入各自鉴权分支;空字符串 `resetToken: ""` / `currentPassword: ""` 被 `.min(1)` 拒绝,不被当作"已提供";
15. 前端 `Notices.tsx`:`password-auth-failed` / `password-locked` / `password-updated` 渲染对应文案,不落入 unknown error 默认分支;
16. **审计与 changeset**:`users.update` 事件的 `data` 含 `passwordChanged: true`;`events.changes` 中**不出现** `passwordHash` 新旧值;API 响应与 events payload 中不出现 `passwordHash`(presenter 排除生效);
17. **`/reset-password` 页面流**(前端测试):带有效 token 渲染表单,无 token 渲染无效提示;两次密码不一致 / 少于 12 位前端拦截;提交成功跟随 302 落到登录页并显示 `password-updated` notice;
18. **(v3.10/v3.11)并发错误密码(两个子用例)**:
    a. **N < 阈值**:同一用户同时发起 N 次错误密码请求(N 严格小于锁定阈值),所有请求完成后 `failedSignInAttempts` 精确等于 N(不允许丢增量),且 `lockedUntil` 未被设置。此用例用于钉死原子 `increment` 要求——若实现者误用读-改-写,用例会因计数 < N 而失败。
    b. **N ≥ 阈值**:同一用户同时发起 N 次错误密码请求(N ≥ 锁定阈值),所有请求完成后断言:`lockedUntil` 被设置;`failedSignInAttempts` 至少达到阈值(允许略大于阈值但不要求精确等于 N——一旦部分请求先触发锁定,后续请求可能直接走 locked 分支不再递增);后续请求被拒(返回 `?notice=password-locked`)。
19. **reset token 审计事件归属与 auth context 隔离**:
    a. **已登录为另一个用户时消费 reset token**:用户 A 已登录(accessToken cookie 存在),携带用户 B 的 reset token POST `/auth/password/update` → 密码改的是 B(token `id` 声明的用户);`users.update` 事件的 `actorId` 与 `teamId` 归属 B(不是 A)——验证 §5.3 的 auth context 隔离生效;
    b. **事务回滚后 token 已消耗**:模拟事务内 `rotateJwtSecret` 或后续步骤抛错导致回滚,密码未改;同一 reset token 再次使用被拒(jti 已被 GETDEL 消耗——GETDEL 在 DB 变更之前执行,此时 token 已消耗,回滚只影响 DB 不影响 Redis);用户需重新发起 reset;
20. **CLI set-password 落库完整性**:CLI 脚本重置密码后,旧 cookie 失效(`jwtSecret` 已轮转);`failedSignInAttempts` 清零;`lockedUntil` 清空;`users.update` 审计事件存在且 `data.viaCliScript === true`;用新密码登录正常。
21. **(v3.13/v3.14/v3.16/v3.17)设置页改密 RPC 响应形态**:登录态路径 POST `/auth/password/update`(带 `currentPassword` + `password`,RPC 经 `ApiClient`)成功时返回 JSON `{ success: true }` + 重签 cookie(**cookie 不含 `domain`,复刻现有 `signIn`;cookie 内的 token 由事务内 `lockedUser.getSessionToken()` 生成,使用轮转后的 `jwtSecret`——不是事务外的旧 `user` 实例**),**不返回 302/HTML**;前端无跳转,在设置页原地提示成功;旧 cookie 失效,新 cookie 可用;**不产生 `users.signin` 审计事件**(改密不是登录);reset token native form 路径仍返回 302(§5.3);两条路径的响应形态不能混淆。**失败响应(均为 JSON HTTP error)**:当前密码错误 → **400 JSON**(`ValidationError`,**不用 401**——`ApiClient` 对 401 触发 logout,设置页输错密码不应导致前端登出;无 cookie 重签、无密码变更;**断言前端收到 400 时不触发 `stores.auth.logout()`**,这是 401→400 改动的真实回归风险点——若误回退为 401,本断言立即失败);非 cookie transport → 401 JSON;未登录 → 401 JSON。
22. **(v3.14/v3.16)reset token 并发双提交**:同一 reset token 同时发起两次 POST `/auth/password/update`,断言:**一个成功改密,一个 redirect `?notice=expired-token`;不允许两次都成功;不允许 500**。**不绑定第二个请求的具体失败点**(可能是 GETDEL 返回 null、锁内重新验签失败、或行级锁阻塞后拿到已轮转的 `jwtSecret`——取决于并发时序,均为合法拒绝路径);此用例用于钉死"同一 token 只能成功消费一次"的不变量。
23. **(v3.14/v3.15)登录态改密认证边界(transport 校验)**:
    a. 无 auth(匿名)POST `/auth/password/update` 带 `currentPassword` → 401 JSON;
    b. API key(`AuthenticationType.API`)POST 带 `currentPassword` → 401 JSON;
    c. OAuth token(`AuthenticationType.OAUTH`)POST 带 `currentPassword` → 401 JSON;
    d. **(v3.15)有效 session JWT 走 `Authorization: Bearer` header**(解析为 `type = APP` 但 `transport = "header"`)POST 带 `currentPassword` → 401 JSON——此用例钉死 transport 校验:若实现者只检查 `type === APP`,此用例会通过(type 确实是 APP),用例失败才说明 transport 校验缺失;
    e. header/body/query 传 token(非 cookie)POST 带 `currentPassword` → 401 或 400(§5.0 红线);
    f. 仅 cookie transport + 正确 `currentPassword` → 成功(200 JSON);
    g. cookie transport + **错误** `currentPassword` → **400 JSON**(`ValidationError`,**不是 401**——401 会触发 `ApiClient` 的 `stores.auth.logout()`,设置页输错密码不应导致前端登出;无 cookie 重签、无密码变更、无事件;**断言前端收到 400 时不触发 `stores.auth.logout()`**——这是 401→400 改动的回归风险点,用例需模拟 `ApiClient` 对响应的分派逻辑)。
24. **(v3.15/v3.17)同一用户多个不同 reset token 并发**:为同一用户生成两个不同的 reset token(两次调用 `getPasswordResetToken`,各自返回 `{ token, jti }`,两个不同的 jti 均写入 Redis),同时发起两次 POST `/auth/password/update`(各自携带不同 token + 不同新密码)。断言:只有一个成功改密,另一个被拒(锁内重新验签失败,因 `jwtSecret` 已被另一个事务轮转);**最终密码匹配唯一成功响应对应的新密码**(并发下先后顺序不稳定,不绑定"第一个");不允许两次都成功——此用例钉死 `SELECT ... FOR UPDATE` + 锁内重新验签;若实现者省略行级锁,两个事务各自用旧 `jwtSecret` 验签通过、各自 GETDEL 成功、最后一次覆盖前一次密码。
25. **(v3.23 / v3.26 / v3.27:key 带 team 维度 + 预限流)reset 端点限流**:
    a. **单 IP 超限**:同一 IP 对不同邮箱连续发起超过阈值次 `POST /auth/password/reset` → 429;超限后即使邮箱存在也不生成 token、不写 Redis、不发邮件;
    b. **单邮箱超限(team 维度)**:不同 IP 对同一 team 的同一邮箱(`teamId:emailHmac`)连续发起超过阈值次 → 429;
    c. **组合键超限(team 维度)**:同一 `ip:teamId:emailHmac` 超限 → 429;
    d. **限流不泄露邮箱存在性**:对存在的邮箱与不存在的邮箱发起相同次数的 reset 请求,两者被限流的时机和响应一致(限流在用户查找前执行);
    e. **限流窗口内恢复**:等待限流窗口过期后,同一 IP/邮箱可以再次正常发起 reset;
    f. **(fix v3.26)跨 workspace 限流隔离**:同邮箱存在于 A、B 两个 workspace,对 A workspace 发起接近阈值次 reset → A 的 `teamId:emailHmac` 接近限额;此时从 B workspace 对同邮箱发起 reset → 不受限流(B 的 `teamId:emailHmac` 为独立 key,计数为零);
    g. **(fix v3.27)team 解析前 IP-only 预限流**:未知 hostname/custom domain 或 password provider unavailable 连续请求超过预限流阈值 → 429;该场景没有 `teamId`,不得写入 `teamId:emailHmac` key;team 解析成功后仍会继续执行正式三键限流;
    h. **(fix v3.27)防枚举成功语义边界**:team 已解析、password provider 可用、SMTP 可用且未触发限流时,存在邮箱与不存在邮箱均返回 success;team 不存在/provider 不可用不伪装成邮件已发送,SMTP 不可用返回 503,限流超限返回 429。

> 测试 1 / 2 涉及 env 开关与模块级条件注册,注意 `PluginManager.add` 发生在模块加载时——用例需通过隔离模块加载或测试专用 env 注入实现两种状态,参照现有插件测试对 env 的 mock 方式。测试 2 的 cloud guard 用例需 mock `coreEnv.isCloudHosted` 为 `true`。

## 10. 后续演进(明确不在首版)

- **team 级开关**:待确有多团队差异化需求时再做,届时评估写入 Team 字段还是 preferences,避免首版过度抽象。
- **路径 B:管理后台一次性 set-password 链接**(+1–2 天,落点复用 `/reset-password` 页面)。
- **reset 成功后自动登录(显式 tradeoff)**:体验更顺(改完密码直接进应用),但意味着"持有邮件链接 → 直接获得会话",放大邮箱被短暂访问的影响面;且 update 端点必须复刻登录路径的 suspended 预检查、`client` hidden input 与 Desktop 分支、限流口径,维护两份一致性。若未来采纳:逐项对齐 §5.1 的检查清单后,把 §5.3 reset 路径的 redirect 换成 `signIn(ctx, "password", …)`。首版不做。
- **匿名请求的 route-level CSRF**:现有 `verifyCSRFToken` 只覆盖 cookie transport,完全匿名的 POST 不校验(§7.2 说明)。若要对未登录的 reset/update 表单强制 CSRF,需新写 route-level 校验(无视 transport,直接比对 cookie 与 body 字段)或调整全局 middleware 的 `shouldProtectRequest` 策略——后者影响所有 auth 端点,需单独评审。首版沿用现有模型。
- **`/auth` 全局层拦截 query token**:空 query strict 只能在 route 层拒绝,挡不住前置 `authMiddleware({ optional: true })` 对有效 query token 的解析与 activeAt 元数据副作用(§5.0)。若要彻底阻止,需在 `/auth` app 层、provider mount 之前加专门拦截(如对特定路径剥离/拒绝 query `token`)——但 optional auth 是所有 provider 路由共享的,部分 provider 的 OAuth callback 本身依赖 query 传参,改动影响现有 auth callback 设计,需单独评审。首版接受 activeAt 元数据刷新这一非安全敏感副作用。
- **`passwordChangedAt` 审计展示字段**:纯展示用途,不参与鉴权。
- 密码强度增强:zxcvbn / HIBP 泄露库比对。

## 11. 发布、回滚与长期维护

- 功能由 `PASSWORD_AUTH_ENABLED && !isCloudHosted` 包住,默认关闭;关闭时或 cloud-hosted 时插件不注册、路由不可达,即回到纯 SSO,无需回滚代码(`/reset-password` 页面残留无害:提交落 404 失败分支)。
- migration 写好 `down`,`passwordHash` / `lockedUntil` nullable、`failedSignInAttempts` NOT NULL DEFAULT 0,不影响存量数据。
- 改动集中在 `plugins/password/` 独立目录、新场景文件与 `server/scripts/`,侵入式修改仅 7 个现有文件——rebase 上游冲突面小且位置固定。
- 建议以独立分支 / patch 系列管理,跟随上游升级。

## 12. 工作量估算

| 模块 | 估时 |
|---|---|
| 数据层(argon2 依赖 + migration + 模型字段 + User 方法 + dummy hash) | 0.5 – 1 天 |
| 服务端插件(本地 env + cloud guard + 条件注册 ×2 Hook + 3 端点 + team 作用域 + reset token 消费链 + strict schema/XOR + 显式事务 + 原子计数 + 专用限流 + 对接) | 3 – 4 天 |
| CLI 脚本 + yarn script | 0.5 天 |
| 前端(登录分支 native form + 忘记密码子状态 + `/reset-password` 公开页 + 回跳域名推导 + 个人设置卡片) | 1.5 – 2 天 |
| 测试(25 项,含 8b 的 EXISTS 成本闸门/降级断言、CSRF/schema 六子项、并发计数、auth context 隔离、RPC 响应形态、transport 校验、多 token 并发、cloud guard、登录限流顺序断言、预 IP 限流、reset 限流与跨 workspace 限流隔离)与安全打磨 | 2 – 3 天 |
| 联调、评审与 rebase 演练 | 0.5 – 1 天 |
| **合计** | **8 – 11.5 人日** |
| (后续)路径 B:管理后台一次性链接 | +1 – 2 天 |

---

*核心参考文件:`plugins/email/server/index.ts` · `plugins/email/server/auth/email.ts`(hostname → team 三分支解析 + `{teamId, email}` 查询)· `plugins/passkeys/server/index.ts`(Hook.EmailTemplate 注册形态)· `plugins/oidc/server/index.ts` / `plugins/oidc/server/env.ts`(条件注册 + 插件本地 Environment 子类与 `export default new …()` 先例)· `server/routes/auth/index.ts`(provider 经 `AuthenticationHelper.providers` 全量动态挂载、**每个 provider router 前置 `authMiddleware({ optional: true })` `:26`**、全局 `verifyCSRFToken()` 先于 router;**无 `transaction()` 中间件**)· `server/models/helpers/AuthenticationHelper.ts`(providers vs providersForTeam 职责差异、self-host 默认分支、**无 team 时返回全部非 email/passkeys provider `:65`**)· `server/middlewares/authentication.ts`(`parseAuthentication` 已导出,返回 `{ token, transport }`;token 解析优先级:header → **body `:105`** → **query `:114`** → cookie——§5.0 红线两个向量的依据;**非 OAuth/API-key 的 JWT 全部赋值 `AuthenticationType.APP` `:242`**——`type === APP` 不等于 cookie transport,§5.3 登录态路径必须检查 `transport === "cookie"`;`transport` 不在 `ctx.state.auth` 中(`server/types.ts:57`),handler 需直接调用 `parseAuthentication`;optional auth 成功时的 `updateActiveAt` 副作用 `:43`、API key `:241`、OAuth 强制 header transport `:157`)· `server/middlewares/csrf.ts`(`shouldProtectRequest` 仅保护 cookie transport、header 与 body 字段双通道)· `server/middlewares/validate.ts` / `server/routes/api/schema.ts`(`validate()` 仅 `schema.parse`、`BaseSchema` 的 `body`/`query` 均为 `z.unknown()` 无全局 strict)· `server/middlewares/transaction.ts`(transaction 中间件,`/api` 使用、`/auth` 不使用)· `shared/constants.ts`(`CSRF.fieldName = "_csrf"`)· `server/utils/authentication.ts` / `server/types.ts` / `server/commands/accountProvisioner.ts`(`signIn(ctx, service, result)` 签名、`AuthenticationResult` 四必填字段 + `client`、suspended 根路径重定向;**非 cloud `signIn` 设置 accessToken cookie 时不传 `domain` `:137`**——password 登录态 cookie 重签必须复刻此行为)· `server/models/User.ts`(`@Column` 字段声明形态、`getEmailSigninToken` payload 先例、**`rotateJwtSecret(options: SaveOptions)` `:598`**——不是无参调用、`updateActiveAt` 写 lastActiveAt + lastActiveIp + 客户端标记 `:556`)· `server/models/View.ts`(`incrementOrCreate` 使用 `this.increment("count", { where })` `:74`——原子 increment 先例)· `server/models/base/Model.ts`(`insertEvent` 将 `previousChangeset` 写入 `events.changes`)· `server/models/decorators/Changeset.ts`(`@SkipChangeset`)· `server/utils/jwt.ts`(**无 default export**;导出 `getJWTPayload` / `getUserForJWT` / `getUserForEmailSigninToken` 等具名函数;内部 `import JWT from "jsonwebtoken"` `:2` 但不重新导出——password 插件需直接 `import JWT from "jsonwebtoken"`,不能 `import JWT from "@server/utils/jwt"`;`getJWTPayload` 抛出 `AuthenticationError`(http-errors 工厂),reset 预验证需归一化)· `server/env.ts`(`isCloudHosted` getter `:857`——按 URL 硬编码判断;`EMAIL_ENABLED` @Public)· `server/routes/api/auth/auth.ts`(`auth.delete` 端点:transaction 中间件 + `rotateJwtSecret({ transaction })` `:188`——事务用法先例)· `server/storage/database.ts`(`sequelize` 实例导出)· `app/utils/ApiClient.ts`(默认 baseUrl `/api` 与 options.baseUrl 覆盖)· `app/routes/index.tsx`(公开路由清单与 lazy 写法)· `app/scenes/Login/OAuthAuthorize.tsx`(Login 目录下独立路由组件 + Background/Centered 视觉复用先例)· `app/scenes/Login/components/AuthenticationProvider.tsx`(passkeys native form 的 CSRF / client hidden input 形态、email 分支 authState 状态机、`baseUrl: "/auth"` RPC 先例)· `app/scenes/Login/components/Notices.tsx`(notice switch、已有 expired-token 文案)· `server/emails/templates/index.ts` / `server/queues/tasks/EmailTask.ts`(模板注册表与队列取类)· `app/stores/AuthStore.ts` / `server/presenters/providerConfig.ts` · `server/middlewares/rateLimiter.ts` · `server/scripts/reset-encrypted-data.ts`(脚本形态)· `shared/utils/domains.ts`(parseDomain / 保留词)· `server/migrations/20170712055148-non-unique-email.js`(email 非全局唯一)· `server/migrations/20160911234928` / `20180707231201`(passwordDigest 历史)。*
