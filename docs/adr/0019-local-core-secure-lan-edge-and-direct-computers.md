# ADR-0019：本机 Core、正式 LAN Edge 与直连 Computer

状态：Accepted（HTTPS LAN edge、一次性设备配对、可撤销持久会话、设备管理 UI、PWA shell 与真实 Chrome gate，2026-08-28）

## 背景

RAH OS 的首个正式产品不是中央账号服务，而是一台由用户拥有的 Mac。该 Mac 同时承载 Room Kernel、Human application service、本机 AgentHost、真实 Agent CLI、Managed MCP executor 和 Web/PWA。现有 ADR-0017 已证明 production bundle、持久状态和 loopback 浏览器会话，但它不能被简单绑定到 `0.0.0.0`：那会让局域网中的任意设备获得本机 Human authority。

未来仍要支持外部 Computer。外部 Computer 应主动连接用户的 Core，发布 RuntimeOffer 并执行该机器上的 Agent CLI；Room、Task、Inbox、Activation、RunAttempt 和历史仍由 Core 持有。是否使用 VPN、反向隧道或无业务状态的 relay 只是可选网络路径，不能成为系统成立的前提。

## 决策

### 1. 一台 Mac 是完整的 Core authority

```text
Mac RAH Core
  Room Kernel + Human API + local AgentHost + MCP + Web/PWA
       |                         |
       | HTTPS Human edge       | future Computer control/Worker edge
       v                         v
LAN browser / iOS PWA      external Computer + its Agent CLIs
```

- daemon 的 Human API 继续只绑定 `127.0.0.1`；不得为 LAN 放宽 CORS 或把 PAT 下发给浏览器。
- 独立 LAN edge 只拥有 TLS、设备身份、浏览器会话、Host/Origin 校验、配对限流和静态 bundle；它不拥有 Room/Task 状态机。
- 本地 AgentHost 与未来远程 Computer 复用同一 Placement、Activation、Worker credential 和 terminal-proof owner，不建立“远程专用 Task 状态机”。

### 2. 正式 LAN 只能是 HTTPS + 配对

`npm run start:lan-workbench` 要求调用者显式提供：

- 精确 `https` public origin；
- 显式 bind host，默认 `0.0.0.0`。

默认由 Core 在 owner-private `RAH_OS_HOME/tls` 下创建一个持久本地 CA，并按 public origin 的精确 hostname/IP 生成独立叶证书；同名有效证书复用，剩余不足 30 天时续签叶证书，不更换 CA。CA private key 永不输出内容或发给浏览器。`npm run provision:lan-tls` 只输出证书路径、SHA-256 fingerprint 和有效期，macOS/iOS 信任安装仍是显式用户动作。调用者也可以同时提供 `RAH_LAN_CERT_PATH` 与 `RAH_LAN_KEY_PATH` 覆盖 managed identity；只提供一项会失败。

LAN edge 在构造时校验证书有效期、SAN/hostname 和公私钥匹配。浏览器首次访问未配对 navigation 时跳转 `/_rah/pair`。本机终端每次启动生成一个 10 分钟一次性配对码；失败尝试按来源地址限制为 5 次/5 分钟。

配对成功后：

- 浏览器只得到随机 `HttpOnly; Secure; SameSite=Strict` session；
- server-side gateway 覆盖任何浏览器 Authorization，并注入 Human PAT；
- mutation 要求精确 Origin；某些浏览器在证书测试环境发送 `Origin: null` 时，只接受不可由页面脚本伪造的 `Sec-Fetch-Site: same-origin` fallback；显式错误 Origin 永远拒绝；
- 设备、配对码和 session 落盘只保存 domain-separated SHA-256 digest；原始码、session 和 PAT 不进入状态文件；
- state 采用 strict schema、`0600/0700`、同目录临时文件、file/directory fsync 和 atomic rename；
- 撤销设备会原子删除该设备全部 session，下一次 API 请求立即失败。

配对管理路径为 LAN edge 的 transport-admin surface：`/_rah/session`、`/_rah/devices`、`/_rah/pairing-codes`、`/_rah/devices/:id/revoke`。这些路径不进入 Human/Room protocol。真实 Web Settings 中的“局域网设备”页面只消费这些 edge endpoints：它展示当前/已撤销设备、签发额外的一次性配对码并在确认后撤销设备；本机 loopback gateway 对 `/_rah/*` 明确返回 404，所以页面可可靠地 feature-detect 部署边界，设备状态不会复制进 Kernel 或普通 Human API。

### 3. PWA 共享同一 Web bundle

`apps/web` 现在提供 manifest、图标和 Service Worker：

- hashed JS/CSS/font/icon 可 cache-first；
- navigation 仅缓存 app shell 作为离线 fallback；
- `/v*/...` 与 `/_rah/...` 始终 network-only；
- Room、Message、Task、Inbox、Review、credential 和 command 不写入 Cache Storage、IndexedDB 或 Local Storage；
- 从离线恢复后仍必须走既有 capability/sync/ack/reconciliation。

安装成 PWA 不创建第二套前端或第二套业务协议。

### 4. 不要求中央服务器

单机与同一 LAN 内的正式产品不需要中央服务器。跨公网部署可选：

1. 用户管理的 VPN/mesh；
2. 用户管理的 HTTPS reverse tunnel；
3. 后置的内容不可知 relay。

无论哪一种，relay 都不得持有 Human PAT、Room ledger、Task truth、Provider credential 或 Computer 长期控制权。若未来引入账号目录/推送服务，它只能提供 discovery/hint/relay，Core 断开后不能重建或修改业务状态。

## 已有证据

- access-store unit gate：一次性/过期配对、摘要落盘、owner-private 权限、重启恢复、设备撤销；
- gateway unit gate：TLS、证书 hostname/key 校验、Host/Origin、配对限流边界、Secure/HttpOnly cookie、server-side PAT、管理端点；
- certificate-provisioning gate：持久私有 CA、精确 IP/DNS SAN、签发链、公私钥、权限、幂等复用与多 hostname 隔离；
- macOS source-bound Core LaunchAgent gate：固定且无 secret 的 plist、runner digest、Web/Workspace preflight、原子 staging、显式 loaded/staged replacement、shell-free launchctl registration、独立 `/_rah/health` readiness，以及默认保留数据/显式 purge 的幂等卸载；LAN readiness 可只 pin 本地 CA，不修改系统 trust；
- `npm run test:web:lan-workbench`：production bundle + fake CLI + 临时可信测试边界 + 真实 Chrome，覆盖首次配对、PWA service worker、Core 重启后免重新配对、设备列表、额外配对码、撤销确认的 Escape/focus 协议和 390×844 无横向溢出；
- `npm run test:web:firefox`：Playwright Firefox 150 + production bundle + persistent Core + fake CLI，覆盖 1440×1000、Agent/Settings、390×844 Room drawer、无横向溢出和零 console/page error；该门禁实际发现并修复了 Zod `Function("")` CSP probe，Web 在导入 protocol schema 前固定 `jitless`，没有放宽 `script-src`；headless Firefox 强制 overlay scrollbar 为 `none`，门禁另行证明 authored 标准规则仍为 `thin`；
- 测试只使用临时状态、临时证书和 fake CLI，不启动用户的 live daemon，不调用付费 Provider。

## 仍未完成

本 ADR 不把下列缺口伪装成已完成：

- 系统与 iOS CA trust 安装、CA 轮换和到期告警；叶证书自动签发/复用/续签已经实现；
- 不依赖源码 checkout 的 Core artifact、Keychain secret、签名/公证安装、login/reboot/power-loss gate；source-bound LaunchAgent staging/activation 已有，但不能冒充不可变发行物；
- 真实 iOS Home Screen PWA gate 与 push/hint；Firefox production gate 已有，但不替代实体 iOS 验收；
- 跨机器 Computer control/Worker HTTPS endpoint、Computer pairing 和 Web 中的“添加 Computer”；
- 通用 API/session 速率预算、审计导出和 operator recovery；公开 uninstall/purge 已实现，但不替代不可变发行物、登录后自启动和断电恢复证据。

因此当前证据意味着“安全 LAN/PWA 产品边界及设备管理已经落地并可运行”，不等于“完整正式 Mac 产品已收口”。后续顺序固定为：证书/常驻运维 -> 本机 Agent/Room/Task/MCP 正式产品门禁 -> 外部 Computer 直连。
