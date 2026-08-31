# Agent 记忆体系收口审计（2026-08-30）

> 阶段性报告说明：本文冻结于 RunAttempt receipt、Human Memory control 与 production safe reset 接线之前；当前状态与 Multica PK 以 [后续收口审计](./2026-08-30-agent-memory-closure-and-multica-pk.zh-CN.md) 为准。

结论：**基础读写连续性已达到 E2，cleaner 的下一次真实 Activation 投递已达到 E2；整个记忆产品尚未收口。** 当前没有发现会把 Agent memory 写入错误 Room 或共享给另一个 Agent 的已知路径，但仍有两个 P0 产品缺口和多个 P1 质量/运维缺口。standing prompt 已再次按 Raft 1.0.18 的源码语义核对：启动先读 index、按需读 notes、显著学习后主动更新、长任务前后维护 Active Context；RAH 额外要求记录可变事实的引用/时间、保留冲突，并禁止把凭据或不可信指令写入长期记忆。

## 已真实证明

| 能力             | 证据                                                                                                                | 结论                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 稳定 Agent owner | 同一 child 写入，重建 daemon-side registry，再由另一 Room/Profile/model child 读取                                  | 通过                           |
| Agent 隔离       | 第二 Agent 获得不同 opaque workspace 且读不到 marker/note                                                           | 通过（逻辑隔离）               |
| Raft 文件协议    | `MEMORY.md` seed-once，`notes/` 持久，默认 64 KiB                                                                   | 通过                           |
| cleaner          | revision fence、interval/threshold bounds、stable upsert、under-threshold drop                                      | 通过                           |
| typed App Inbox  | 无 sender/Room/message/cursor；第二次真实 Runtime child 收到 `system.cleaner/memory_size_hint`                      | 通过                           |
| 环境完整性       | static/父环境伪造的未租赁 App Inbox value 被清除                                                                    | 通过                           |
| 并发写入边界     | placement scheduler 以稳定 participant 建全局 lane，普通 canonical Activation 不允许同一 Agent 并发                 | 通过（Room 无关）              |
| reset core       | Kernel 全局 fence；Memory 与 Provider continuity 按 Agent 双 quarantine；receipt 前失败双向回滚；回滚失败保留 fence | 通过（本机 core/control only） |

## 未收口问题

### P0

1. **无 autonomous maintenance lane。** cleaner timer 可以 mint hint，但当前生产 `wake` 有意返回 false；Agent 只有在下一次 canonical Room Activation 才会整理。不能宣称等同 Raft 的 idle restart/active notice。
2. **reset 尚无完整生产 transport。** Kernel schema v18、本机 AgentHost control 与 reset coordinator 已接全局 fence；但远程 Computer control、durable Human operation/recovery、Human API 和 UI 尚未接线，因此按钮保持禁用是正确行为。

正常 Room Activation 已由 Kernel 的 per-participant lane 防止同一 Agent 跨 Room 并发写 memory；未完成的风险在 maintenance/reset 还没有接入同一条 lane。后续绝不能只在某一台 Computer 内加 mutex，因为同一 Agent 的 pending placement 可能位于另一台 Computer。

### P1

1. App Inbox 目前仅有 cleaner 这一种 transient item，尚无通用 registry、durable persistence、scoped check/ack CLI 和 UI。
2. Provider continuity store 已与本机 Kernel/AgentHost exclusive fence 组合；远程 Computer transport、orphan recovery 与 Human operation 尚未组合，因此 reset 仍不能直接接 UI。
3. ContextManifest 冻结的是 `memoryPolicyRef`，不是本次实际读取的 `MEMORY.md` digest/notes refs；尚不能回答“该回答实际使用了哪一版 memory”。
4. 没有 Memory index/notes 的浏览器查看、编辑、导出、备份、恢复、损坏诊断和 quota UI。
5. 没有真实长对话的召回正确率、错误记忆、冲突事实、删除请求和提示注入质量门禁。
6. `notes/` 不会自动注入；依赖 Agent 从 index按需读取。尚无受 ACL/版本治理的检索 index。
7. 本机最高自治 Runtime 同 UID 执行。0700/0600 防止偶然泄漏，但不能阻止恶意同 UID process扫描其他 Agent state；这不是强 sandbox。
8. Agent 更换 Computer 时没有 memory migration/sync/冲突协议。当前语义是“memory 跟随实际 Computer copy”，尚不能宣称全球唯一副本。
9. 目前“主动形成记忆”仍由 Runtime standing prompt 驱动，没有结构化写入 receipt、内容审查或对话结束钩子；因此已证明 Agent **能**跨 Run 读写，不等于每次重要互动都一定被正确归档。
10. 每次 Run 尚未产生 Computer-owned memory materialization receipt。ContextManifest 的 `memoryPolicyRef` 不能回答启动时 `MEMORY.md` 的 digest/bytes/mtime；未来 receipt 必须与 RunAttempt 关联且明确只证明 materialization，不谎称模型实际阅读。

## 没有采用的错误收口方式

- 不把 cleaner hint 变成 `system` Room Message。
- 不以 wake hint、spawn、exit 0 或 Provider prose作为整理完成证据。
- 不让 Web 直接读取本机/远程绝对路径。
- 不照抄 Raft 无 terminal fence 的 recursive delete。
- 不把 Provider session transcript、Claude/Codex memory或旧 RAH session当 Agent 的长期 memory owner。

## 推荐顺序

1. 在已完成的 Kernel 全局 fence 上实现 maintenance job owner；完成 active notice/idle start/source recheck，不能降级为单机 mutex。
2. 将已完成的本机 reset fence + Provider continuity quarantine 扩展到远程 Computer durable operation/recovery，再开放 Human API/UI。
3. App Inbox registry/scoped CLI；Human Inbox/InputRequest 已独立完成 Web/PWA E2，两者可共享视觉组件但必须保持不同 owner/API。
4. 给每次 Run 写入 Computer-owned memory materialization receipt（index digest/bytes/mtime + RunAttempt）；再做 notes检索与长对话质量门禁。该 receipt 只证明启动时提供的内容，不冒充 Provider 已实际阅读。
5. 最后定义跨 Computer export/import 或单 writer migration；未定义前禁止自动双向同步 Markdown。
