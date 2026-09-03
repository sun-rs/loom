# Files Range 与剩余优先级验收审计

日期：2026-09-03

## 结论

本轮按“阻塞核心闭环的程度 × 失败损害 × 上游成熟度”重排剩余项。当前没有已知
P0；最适合立即施工的 P1 产品缺口是 Files 可恢复下载。Raft 提供了文件属于消息、
Room Files 聚合、下载/预览/回跳共享 Attachment 身份的产品合同；Multica 提供了更
完整的服务端 HTTP Range 状态机和测试矩阵。RAH OS 已完成本地、ACL-safe、
seekable blob 版本，并保持 Kernel 是文件身份、授权和 fd 的唯一 owner。

设备通知真机横幅/点击回跳和 daemon 1h/24h soak 仍是发布前 P1 证据，但不是再造
产品状态机；头像孤儿 GC 后续已先关闭上传/保存竞态，再按 Raft 产品合同、Multica 状态机与
RAH OS 本地 owner 完成，见 `2026-09-03-profile-image-intent-gc-verification.zh-CN.md`。

## 上游复核

| 来源              | 固定版本                                                                                                                                                                             | 可可靠复用的内容                                                                                         | 没有据此声称的内容                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Raft Web 授权快照 | repo `286c3c5d99b56d8be5e3339510de310b4b7fe727`；build `666bab60d8658d9e382e2c286ce1e423231e8f31`；bundle SHA-256 `fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725` | Attachment/Message/Room Files/preview/download/permalink 的前端产品合同                                  | Raft 中央 Server 的 Range、存储事务和 GC 实现 |
| Multica           | `11861145abc59a0d39c8c8f24ad837d4584e664f`                                                                                                                                           | `proxyAttachmentDownload`、`serveProxyRange`、`parseSingleByteRange` 以及 seekable/non-seekable 测试矩阵 | 直接复制 Go 文本、云对象存储和公开下载 URL    |

Multica 的关键语义已结构化移植：完整读取为 `200`，单一 closed/open-ended/suffix
Range 为 `206`，EOF clamp，越界或畸形为 `416 + bytes */total`，multi-range 不
伪装支持而退回完整 `200`，所有分支保留安全下载头。

## 实现审计

```text
HTTP Range header
  -> Local/LAN Gateway（严格白名单转发 Range，回传 206 元数据）
  -> Application Service（解析、200/206/416 和 response headers）
  -> HumanApplicationPort（传递已解析闭区间）
  -> Kernel RoomFiles（Human/Room ACL、immutable size、O_NOFOLLOW、范围 fd stream）
  -> Client SDK（要求真实 206，校验 Content-Range 和 body 长度）
```

- Range 解析不进入 Web 页面或 provider adapter，不产生第二套文件状态。
- 正式入口的 Local 与 LAN/PWA Gateway 保持服务端 Human token 替换和浏览器头
  白名单；只新增 `Range`、`Accept-Ranges`、`Content-Range`，没有把任意请求头
  透传给 daemon。
- 未授权请求在读取文件大小之前失败；`416` 不绕过 Room membership 泄漏大小。
- Kernel 拒绝负数、反向、越界和非 safe-integer 范围，并在打开 fd 前后复核文件。
- SDK 不能把服务器错误返回的完整 `200`、错误 span 或短 body 拼接成损坏文件。
- HTML/SVG 仍为 `application/octet-stream + attachment + nosniff + private,
no-store`，Range 不扩大主动内容执行面。
- 中断不改变 Attachment/Message/TaskSubmission/GC 状态；客户端使用同一
  Attachment ID 和已确认偏移重试即可。

## TDD 与浏览器证据

失败优先证据：

1. 新 HTTP Range 测试在旧实现上得到 `200`，预期 `206`；
2. 加入 SDK 调用后旧 SDK 报 `downloadRange is not a function`；
3. 首次浏览器扩展测试因测试自身固定了旧 Room 而报 `file-not-found`，改为从 typed
   Room URL 读取当前 Room；未修改服务端规避失败。
4. 首次正式 4173 下载请求得到完整 `200`，而非隔离浏览器中的 `206`。追踪到
   Local Gateway 丢弃 `Range`；同构 LAN Gateway 也有相同缺口。为两条网关先加
   代理红测，旧实现均稳定复现 `200 !== 206`。

通过证据：

- `node --test packages/application-service/test/client-files.test.ts`：1/1；覆盖认证、
  完整下载、closed、open-ended、suffix、invalid-unit、越界、multi-range、SDK
  字节校验和安全 headers。
- `npm run typecheck`：通过。
- `npm run build:web:workbench`：通过。
- `node scripts/run-real-browser-gate.mjs`：真实 Chrome 通过，先桌面后
  `390x844`；在浏览器 execution context 上传 Thread 文件并读取
  `bytes=1-7`，得到 `206`、`Accept-Ranges: bytes`、`Content-Range:
bytes 1-7/38`、`Content-Length: 7` 和精确字节 `AH OS T`。
- `node --test packages/daemon/test/local-workbench-gateway.test.ts
packages/daemon/test/lan-workbench-gateway.test.ts`：4/4；Local 与 LAN/PWA 均
  证明请求 Range、206 状态、三个范围响应头和字节体完整穿越 Gateway。
- 并行 Task 工作流批次完成后重跑 `npm run check`：全库通过；两个真实付费
  Provider opt-in 用例按约定跳过，其余协议、Kernel、Application Service、SDK、
  daemon、Web unit 与 34 项 parity callback regression 均无失败。
- `npm run build:web:workbench`：3033 modules transformed；`npm run
format:check`、`git diff --check` 全部通过；`npm audit --omit=dev` 为 0
  vulnerability。
- `node scripts/run-real-browser-gate.mjs`：完整真实 Chrome 门禁再次通过，终态
  `390x844`；不是只运行 Range 的定向脚本。

## 正式 4173 发布复核

重启前只读确认正式库 schema 44、Room/Registry `quick_check=ok`，30 个
Activation 全部 completed、30 个 RunAttempt 全部 exited、30 个 RuntimeProcess
全部 terminated；没有 queued/leased/quarantined 执行、改派或 Computer operation。
唯一 Task 为 durable `submitted/in_review`，没有活动 Runtime。Room、Runtime
Registry 和 Web Push 三份 SQLite 的在线一致性备份位于
`/Users/sun/.rah/backups/formal-pre-range-restart-20260903-180252`，三份备份再次
`quick_check=ok`。

精确旧进程收到 `SIGTERM` 后正常退出，新正式进程监听 `127.0.0.1:4173`，health
为 online，schema 与全部执行计数保持。使用正式 Room 现有 3921-byte 文件只读请求
`bytes=0-0`，实得 `206`、`Accept-Ranges: bytes`、`Content-Range:
bytes 0-0/3921`、`Content-Length: 1` 和一个字节；这关闭了隔离门禁通过、正式
Gateway 仍降级成 `200` 的集成缺口。

随后用真实 Chrome 新标签冷开正式 Room：历史、聊天控件与状态恢复，切换“文件”
显示现有文件及操作菜单；页面不存在 `JSON.parse`、`NetworkError`、`Failed to
fetch`、`RAH Client request failed` 或 `Human access token` 错误标记。没有向正式
Room 发消息、调用 Provider 或修改 Task。

## 剩余顺序

1. 完成正式 macOS/iOS 通知横幅与 typed deep-link 回跳的设备证据，并跑 1h/24h
   daemon soak；这是发布证据，不引入新状态 owner。
2. 头像上传 receipt 与引用安全 GC 已完成；仅在有明确用户场景和成熟来源时补大型
   Artifact viewer、Git diff/build log、
   Finder reveal。
3. translate/multi-forward、structured InputRequest、External Agent/OAuth Apps、主包
   lazy loading 保持 P2/P3；不以空按钮或前端假状态冒充完成。
