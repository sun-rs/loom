# Worker 自身资料及头像闭环

日期：2026-09-08。范围是本机已激活 Agent 修改自己的公开资料，不扩展 Agent 身份、角色、runtime、model、Human 权限或记忆所有权。

## 来源与本地差异

依据授权提取的 `raft-computer@1.0.18`，`packages/shared/src/agentApiContract.ts:464–470,1853–1882`。该文件 SHA-256 为 `ce9db68aff56f34e56186cc8332d9b1dae74196422f113353de0a288915cf4db`，本机来源位于 `raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/`。Raft 合同将 profile update 与 avatar update 明确绑定到当前 Agent，提供 displayName、description、avatarUrl 和图片上传。这是发布包合同证据，不能证明未公开 server 的内部实现。

本批采用该行为，属于 RAH glue，未宣称 byte-exact 复用或重写 Raft server 源码。上游原件和来源标记保持在取证目录；不把原始 bundle 作为运行依赖。本地有意复用既有 revision、image store、upload intent 和 GC，将图片上传与显式 CAS 保存分开，不导入任意远程 avatar URL。

## 单一 owner 与权限

- protocol：`worker-self-profile.ts` 的严格请求/响应，禁止 target、handle、role、model 等扩大权限字段。
- Kernel：`WorkerSelfProfileService` 验证当前本人 execution、enabled 状态和 Room membership，返回明确 control Room 上下文；`workspace-agent-profile` 的单一 writer 原子生成多字段 revision 和一条 event。
- 图片：`ProfileImageStore` 保留已有内容类型校验、5 MiB 上限、内容寻址和字节存储；`ProfileImageLifecycleService` 只允许 Worker 绑定本人的上传 intent，事务失败回滚 intent 消费。旧 Human 接口的既有语义保持回归。
- Worker HTTP/CLI：只作认证 facade，`profile-self-get` → 显式 `profile-update`；`profile-avatar-publish` 返回 image key/intent 后再显式绑定。头像读写各阶段重新检查 live execution 与 bearer，daemon 与 Human 原图片接口使用同一个存储路径和 GC。

读取没有新的 grant 读取槽、ACK 或工作 Room cursor。已知的等价 control Room 上下文仍可使用，不声称强制模型先读懂元数据。原 Run 使用原冻结资料并保持有效；下一 Run 采用新 revision，私有 memory identity 不变。资料事件标注本人 actor、`metadataOnly`、来源工作 Room 与 Run。

## 分层证据

原始复现日志位于 `/Users/sun/Code/reviews/rah_os/2026-09-08-collaboration-closure/self-profile/`，对应测试进入正式 test suite。

| 层次                  | 证据及结论                                                                                                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol / Kernel RED | 缺少 schema/service 的正式失败；随后严格参数、单 revision/event、跨 Room 拒绝、幂等冲突和 Human CAS 回归通过。                                                                                                                                                                                                                    |
| Worker HTTP RED       | `/profile/self/get` 原 404；真实 managed Workspace/Placement/Run fixture 在接线后通过。头像 PUT 原 405，接线后实际图片上传绑定通过。                                                                                                                                                                                              |
| 权限与失败            | 当前本人图片可复用；其他人的公开图片 key、他人 intent 拒绝；event 故障回滚头像 intent；流中 Run 终止拒绝；真实 HTTP 图片完成后 bearer 撤销返回 401；失效上传由原 GC 回收。                                                                                                                                                        |
| Runtime 生命周期      | 资料修改后原 Run 和冻结上下文保持不变，原工作 cursor 仍可发消息和 ACK；原 Run 终止后旧凭据拒绝，下一 Run 使用新名称并保留同一 memory identity。                                                                                                                                                                                   |
| Daemon / 真实子进程   | `worker-self-profile-chain.test.ts` 从真正 DaemonApplication 启动 GenericProcess 子进程，经实际 Worker CLI 读取资料、修改名称与描述、上传 PNG、绑定自己头像、发 canonical 消息并 ACK；Activation completed、Run exited、无自动 Task。Human 原 image GET 与磁盘原 bytes 都相同。此层是上层回归，没有回退共享产品源码制造额外 RED。 |

上述是确定性 fake provider 的真实进程/HTTP/字节链，不是付费模型测试，不是官网同条件截图验收，也不是正式实例部署声明。CLI/parser、完整受影响 package 回归和跨 Agent 审计由本轮集成日志共同记录，不将其他批次的旧通过数挪用为本批结果。

## 独立审计修复

独立 Agent 的实际分块 HTTP 反例发现，原 Worker JSON 路由在等候请求正文前缓存了 grant。正文未结束时撤销 bearer，Kernel 的 Run 仍有效，导致旧 grant 能提交资料修改。正式回归以 HTTP `100-continue` 确认正文等待窗口，复现预期 401、实际 200 且资料已修改；没有依赖固定延时猜测。

修复放在所有 Worker JSON 路由共同的服务入口：保留读取正文前认证，在 `readJsonObject` 完成后再次认证，后续 handler 只接收新验证的 grant。头像 binary 路径原已在存储前、intent 记录和返回前重验，独立流中撤销测试验证零 bytes/intent。此项是服务凭据生命周期修复，没有增加 Kernel 身份、cursor 或第二授权状态机。

随后对相邻普通附件和 Task Artifact 的 PUT 做同一反例，发现这两条旧上传路径也能在 bearer 撤销后返回 200/completed；已重新打开此前附件「已完成」结论中的这条权限边界。修复沿 `RoomFiles` 的原 `owner()` 检查点注入应用服务动态授权回调，在 I/O 前、同步关闭后、最终 rename 后且写 completed 之前，同时检查 facade bearer 与原 Kernel execution/ownership。失败仍由原 owner 标记 failed、移除 part 和最终 bytes。正式回归既覆盖 HTTP 两条上传的 200→401，也直接验证最后 rename 后第三次授权失败，不接受「仅最后响应拒绝但数据库已经 completed」的修复。

最终本批定向回归 33 项通过，覆盖上述新路径、原 Agent profile/avatar/image GC、真实 daemon 子进程、普通附件子进程及模块规模门禁，见 `rah-worker-profile-upload-closed-regression.log`。独立审计九项通过，证据在 `/Users/sun/Code/reviews/rah_os/2026-09-08-worker-self-profile-independent/review-all-closed.log`，包括跨字段权限/CAS/原回执、三类上传中途撤销及 active Run 不变。整仓最终 checks 由主任务在全体模块冻结后集中执行。

## 验收边界

本批结束后 Worker 自身 displayName、description、上传头像具有真实本地后端链；不增加 UI 页面或生产按钮。未知 Raft server 内部行为、远程头像 URL 导入、付费模型主动调用该工具和官网自身头像交互的同条件对照仍不能由本批自动化结果推断。正式服务重启与最终产品验收由主工作任务统一完成。
