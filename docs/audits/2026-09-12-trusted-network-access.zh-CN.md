# 停用 Tailnet 入口的浏览器 token 与 HTTPS 门槛

## 用户决定及实施边界

用户明确要求当前服务不要求 token 或 HTTPS，可保留代码但先停用功能。
此前 Tailnet HTTP 模式已取消 HTTPS/配对，但 LocalWorkbenchGateway 仍检查自动发放的
浏览器 session cookie，并可能返回 session_expired；前端重连按钮也会退回手填 token 页。
本批将这两个残留门槛停用。

- 唯一访问策略 owner 为 LocalWorkbenchGateway；新增可逆 `browserAccess: trusted-network`。
- Core 的 tailnet 模式明确启用该策略，不再创建、读取或验证浏览器 session token。
  静态页不发 session cookie；HTTP API 与服务状态端点不要求浏览器 token/cookie。
  已有旧 cookie 不影响访问，不产生过期/续期流程。
- 原 session 策略与 HTTPS/配对实现保留，默认 loopback 兼容行为不变。
  当前正式入口只使用显式 Tailnet HTTP 模式，不启动 HTTPS gateway。
- 同源重连保留可信代理模式，刷新页面恢复连接，不显示 token 表单。
- 精确 Tailnet IP 绑定、Host/Origin 防跨站校验及服务端到 daemon 的 Human 身份保持；
  Provider/Agent 内部执行凭证、Room ACL 和运行栅栏不属于浏览器登录门槛，不随之停用。

这项部署策略来自用户的单 Human Tailnet 范围决定，不声称是 Raft 中央认证的复刻。

## 测试与部署

测试先复现：无 sessionToken 的 gateway 构造被拒绝；生产 Web 的错误重连进入 token 表单。

- gateway/Core 生命周期 12 项测试通过。新增无 cookie/无 Authorization 的 API 请求、
  旧 cookie、同源 POST、服务状态、HTTP、无 Set-Cookie，以及跨站/错误 Host 拒绝断言。
- `scripts/test-trusted-reconnect-browser.mjs`：独立 Fake Provider 环境中注入 503，
  点击重连后恢复正式 Web 组件的聊天输入框，无 token 表单；不启动付费 Provider。

正式重启及最终检查结果追加于下方。

## 正式验收结果

2026-09-12 已通过空闲检查和备份校验，正式进程优雅退出并以冻结资源重新启动。
构建 `88ae01e944e9a5cbeb2c0bd3232afed74b92237786c11f2098e62144af2bb18c`。
精确 Tailnet HTTP 入口保持；历史、Agent 配置和私有文件均保留。

正式 HTTP API 在无 Authorization、无 cookie 下返回 200，不发放 session cookie。
全新 Chromium、WebKit 会话主动移除 API Authorization/cookie 后，成员页、Agent 详情及
刷新均通过，浏览器 cookie 集合为空，没有 token 表单及脚本异常，构建 ID 与部署一致。
HTTPS/配对实现和旧 session 实现仅保留代码，当前 Tailnet 实例不启用。

TypeScript、405 项 Web 单元测试、12 项代理/生命周期专项测试、错误重连浏览器通过；
正式 Web bundle 构建、格式和 diff 检查通过。`npm run check` 仍在两条既有图标校验失败处
停止（1560 项根测试，1541 通过、17 跳过、2 失败），与上一批相同，未修改断言掩盖失败。
