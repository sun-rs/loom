# 剩余缺口优先级与 Files 可恢复下载合同

日期：2026-09-03

## 决策结论

当前没有已知 P0。剩余工作不能继续按“页面上还能加什么”排序，而要按是否阻塞
本地多 Agent Room 工作闭环、是否已有可靠来源、失败后损害程度排序：

| 顺序 | 缺口                                                              | 必要性      | 本轮裁决                                                                                                                          |
| ---- | ----------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 设备通知真机横幅、点击回跳；daemon 1h/24h soak                    | P1 发布证据 | 必须完成，但属于设备/长期运行证据，不新增第二套产品状态                                                                           |
| 2    | Files 可恢复下载、Range/206/416                                   | P1 可靠性   | 有成熟 Multica 服务端来源，本轮施工                                                                                               |
| 3    | 头像孤儿 blob GC                                                  | P2 磁盘卫生 | 已完成：Raft 产品合同 + Multica 状态机 + 本地 SQLite/blob owner                                                                   |
| 4    | 大型/特殊 Artifact 预览、Git diff/build log viewer、Finder reveal | P2 深度     | Markdown/HTML/diff/CSV/文本已完成；媒体 capability URL 与自动冻结 Git/build 证据待独立合同；Room Artifact 的 Finder reveal 不适用 |
| 5    | Message 翻译、多选转发                                            | P2 交互深度 | 不阻塞核心；翻译还需要独立数据/Provider owner，不能放空按钮；Task stale-safe 五状态工作流已完成                                   |
| 6    | 结构化 InputRequest、dismiss/TTL                                  | P2 条件需求 | 当前 answer/cancel 与 Task 原子取消闭环完整；Raft/Multica 无可复制 typed 状态机                                                   |
| 7    | External Agent / OAuth Apps                                       | P3 扩展域   | 本机 Codex/Claude/Kimi/OpenCode 调用不依赖它；缺 credential/grant owner 时继续禁用                                                |
| 8    | 主包懒加载、主动 runtime catalog refresh                          | P3 优化     | 当前不是正确性缺口，以真实性能或发现延迟指标触发                                                                                  |

账号、套餐、Raft 中央应用商店、多 Computer 管理和跨 Computer 文件传输不属于
RAH OS 当前本地产品范围。

## 上游证据与复用边界

### Raft

- 来源：授权留存的 Raft Web build
  `666bab60d8658d9e382e2c286ce1e423231e8f31`；bundle
  `index-WTraJnrd.js`，SHA-256
  `fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`。
- 采用：文件由 Message 拥有；Room Files 是聚合投影；预览、下载和跳转原消息
  使用同一 Attachment 身份。
- 拒绝推断：Web bundle 不能证明 Raft Server 的 Range、存储事务或恢复策略。

### Multica

- 来源提交：`11861145abc59a0d39c8c8f24ad837d4584e664f`。
- 关键文件：`server/internal/handler/file.go` 的
  `proxyAttachmentDownload`、`serveProxyRange`、`parseSingleByteRange`；
  `server/internal/handler/file_test.go` 的 seekable/non-seekable Range matrix；
  `server/internal/handler/attachment_capability_test.go` 的 header preservation。
- 结构化采用：`Accept-Ranges: bytes`；无 Range 返回完整 `200`；可满足的单
  Range 返回 `206 + Content-Range + 精确 Content-Length`；open-ended、suffix、
  EOF clamp；越界/畸形返回 `416 + bytes */total`；不支持的 multi-range 被忽略
  并返回完整 `200`；原有下载安全头不丢失。
- 本地改造：RAH OS 只有 owner-private 本地 seekable blob，但仍通过既有
  `RoomFiles` fd owner 和二次 ACL 校验打开精确范围。HTTP 解析只在
  Application Service，Kernel 只接受已经解析的闭区间。
- 许可证边界：只移植协议/状态机结构，不复制 Multica UI 或 Go 实现文本。

## Single owner

```text
Raft Files 产品语义
  -> protocol Attachment / RoomFile identity（保持不变）
  -> Kernel RoomFiles：ACL、immutable size、O_NOFOLLOW fd、精确 byte span
  -> Application Service：HTTP Range 解析和 200/206/416 headers
  -> Local/LAN Gateway：白名单转发 Range 与 206 元数据，不转发任意浏览器头
  -> Client SDK：验证服务器确实返回所请求的 206 span
  -> Web：继续使用已有 preview/download；本批不伪装大型媒体 viewer
```

所有 Range 请求先通过 Human 认证和 Room membership。`416` 的 total size 不得
绕过 ACL 泄漏。范围 stream 打开时再次校验 membership；不把浏览器提供的路径、
MIME 或文件大小当成真值。

## 失败与恢复

- 服务端不支持 multi-range 时返回完整且正确标记的 `200`，不能返回伪 `206`。
- SDK 的 `downloadRange` 若收到 `200`、错误 `Content-Range` 或短 body，必须
  fail closed，避免续传客户端把完整/截断内容拼成损坏文件。
- Range 不改变 Attachment、Message、TaskSubmission 或 GC 状态；中断后没有
  数据库恢复工作，客户端可以用同一 Attachment ID 从确认偏移重试。
- HTML/SVG 仍以 `application/octet-stream + attachment + nosniff` 下载；Range
  不能把用户内容变成 app-origin 可执行预览。
- Local 与 LAN/PWA Gateway 必须在原有鉴权替换不变的前提下，仅白名单转发
  `Range` 请求头，并回传 `Accept-Ranges`、`Content-Range`、精确
  `Content-Length`；否则 Application Service 的正确实现会在正式入口被静默降级。

## 验收合同

1. 先写 HTTP/SDK 红测，证明旧实现把 Range 错答为完整 `200`。
2. 自动化覆盖 closed、suffix、越界和 multi-range，并保持认证、ACL、
   disposition、nosniff、no-store。
3. 真实 Chromium 经 Web 代理上传 Thread 附件，再在浏览器 execution context
   请求 `bytes=1-7`，验证 `206`、headers 和真实字节。
4. Local 和 LAN/PWA Gateway 各有代理红测，证明 Range/206 不能在边界被吞掉。
5. 全库、格式、diff、审计与正式 4173 重启后再交付；正式实例只做只读/下载
   复核，不改用户 Task 或 Agent。
