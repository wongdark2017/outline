# 开发环境 TikZ 加载失败检查

## 结论

默认模板因开发代理的响应头错误而失败。修复限定于 `server/middlewares/vite.ts` 和对应测试。当前服务通过原有监听自动生效。

## 修复

1. 当前版本 Worker 主脚本设置独立严格 CSP；只允许同源脚本、同源连接和 WebAssembly。
2. 当前版本的 core、WASM 和宏包 gzip 输入保留原始压缩字节，不作为 HTTP gzip 编码。
3. 对这些 gzip 输入移除上游条件校验，防止 304 保留旧错误编码元数据。普通资产缓存、HMR、认证信息隔离和生产旁路保持原有行为。
4. 使用固定 CSP 响应字符串，避免使用当前 koa-helmet 类型定义未公开的 `useDefaults` 选项。

## 证据

- [开发服务修复前](validation/dev-engine-before.json)：默认模板返回 engine `-3`。
- [当前开发服务修复后](validation/dev-engine-after.json)：默认模板成功，SVG 长度 20,782；资源长度及 gzip 魔数正确，错误事件为 0。
- [缓存恢复修复前](validation/dev-cache-before.json)：同一浏览器仍失败，wasm 的 304 保留了旧编码。
- [缓存恢复修复后](validation/dev-cache-after.json)：同一浏览器由失败恢复成功，错误事件为 0。
- [修复后的实际 HTTP 记录](validation/dev-cache-after-http.jsonl)：Worker 304、gzip 200；客户端仍携带旧校验头，代理向上游请求完整实体。

## 检查

`yarn test server/middlewares/vite.test.ts server/middlewares/csp.test.ts app/editor/lib/tikz/renderTikz.test.ts --maxWorkers=2`：3 个文件，44 项通过。

`yarn tsc`、`yarn lint` 和两份改动文件的 `yarn oxfmt --check` 通过。完整功能此前的 153 项检查继续作为原范围证据，不把两轮重叠的测试计数相加。

实现代理完成初始修复。额度中断后，主会话接续类型兼容修正、缓存恢复修复和最终运行检查。检查代理随后恢复并完成最终独立代码与热缓存证据复核：没有必须修复项。44 项测试、类型和 lint 由主会话实际执行，不归为代理重复执行。
