# 跨目标能力与附件评论前端：实施和验收

后续核实：[四项剩余行为的官网实操](./2026-09-08-raft-remaining-live-confirmation.zh-CN.md)。本文为施工时的证据边界；移动项应称按钮折叠行为，分页是本地待验，运行器用量已有官网展示和上游采集来源。

本批承接用户对剩余项的明确授权，不重做上一批已验证能力。
Task 删除的前端入口已由用户列入未来待实现；保留删除后端，不添加猜测按钮。

## 当前施工边界

- 跨频道静音：沿唯一 Agent×Room 偏好 owner，目标参数与完整上下文验证；HTTP/真实 Node CLI 定向测试通过。
- 跨 Room 附件与草稿恢复：由既有 RoomFiles、target context、held draft owner 接线，已实现并通过专项和独立回归。草稿恢复属于 RAH 本地并发一致性，不宣称 Raft 的独立产品功能。
- Worker 公开资料：复用当前 Computer/Agent/runtime/presence owner，补可信字段与子 Agent 分页，已通过专项及独立审查；不添加第二份配置或推测可用性。
- 附件评论前端：依据 Raft Lw/Q8e 的评论按钮、锚点滚动/闪亮和视频定位，复用原预览器、评论服务及 Thread，双浏览器专项通过。评论 API 已增加经鉴权的原文件 Room/Message 地址，以及独立的真实 Thread 根消息，避免空列表、转发或附件位于回复时从当前页面猜归属。

## 来源和验证

Raft Computer 1.0.18 发布合同和 Web 1.12.0 冻结 bundle 为已验证来源。
未重复要求官网全量实验；没有源码证明的入口/语义不编造。
当前定向证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-remaining-parity-implementation/`。

整批检查、最终前端复核、正式构建、浏览器与备份重启已完成，分层结果如下。
未提交/推送 Git，未运行付费 Provider。

## 专项证据

- 跨频道静音与目标权限：本证据目录 `mute/final-green.log` 9 项；目标 seq 不进入原消息或 ACK 权限。
- 跨目标附件：[作者收口报告](/Users/sun/Code/reviews/rah_os/2026-09-08-backend-remaining-closure/target-attachments/closure.zh-CN.md)；92 项关联回归及本目录 `independent-target-regression.log` 27 项独立组合复跑。
- 公开资料：[作者及独立证据](/Users/sun/Code/reviews/rah_os/2026-09-08-profile-field-completion/closure.zh-CN.md)；32 项专项与独立撤权/目标分页/Host owner 复核。
- 评论界面：`/Users/sun/Code/reviews/rah_os/2026-09-08-attachment-comments-ui/`。真实字节上传、指针选行与定位、CSV/Markdown/diff/video 锚点、PNG/PDF/WAV/HTML 整文件评论；幂等重试、IME、Agent mention 对应的真实 Inbox。独立 Chrome 同 SPA 无 reload 迟到响应复验亦通过，见该目录 independent/review.zh-CN.md。
- 评论位置样式来自冻结官方 CSS：stone `#c0b9b1`（UTF-8 offset 4894），flash 1.6s ease-out（offset 656173），评论栏 320px；通过唯一 tokens owner 维护，不保留近似 cream 色映射。

## 明确剩余与范围

- Task 删除 Web 入口为用户指定的未来待实现，不是本批阻塞。
- HTML 区域级位置尚未接入现 sandbox；HTML 可整文件评论。PDF/image/audio 不宣称有位置锚点。
- Provider usage-limit 原因/resetAt 与未知默认 model 无可信 typed 来源，不编造；已有真实 availability、Computer/runtime 资料和分页已接线。
- 草稿续发为本地并发一致性，未宣称 Raft 独立产品功能；中央云直传、多 Human、远程 Computer、大文件流式没有进入本批。

## 根集成验收与正式交付

- `npm run check` exit 0：后端 1138 项中 1133 通过、5 项付费 gate 跳过；Web 386、历史合同 34、正式请求策略 13、截图证据规则 3 项通过，类型/仓库身份/UI 合同通过。
- 整批检查与最后 UI 小批并行；`check-phase-diff.json` 记录此间只有评论界面、token 和浏览器测试支持文件变化，后端冻结未变。对最终代码另跑全仓类型、Web 全部 386 项、UI library/contract、新 token 和正式请求策略测试，全部通过；`frozen-source.json` 记录最终 1290 个源码/配置/测试文件校验值。
- `npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。正式 Web build：`11e028868d2c84e075aab14d3a6503e46680bc2b89c0ec09dcd595bea75d65a3`。既有大 chunk 提示仍在，未据本批宣称性能全面达标。
- 根在最终构建后复跑两个 Chrome/Firefox gate：文本行/CSV/Markdown/diff/video 点击位置、其余类型整文件评论、真实 Thread 跳转、刷新、失败重试不重复、Agent mention 的真实 Inbox 和 IME/草稿保留均通过；查看了桌面与390截图。独立 Chrome 另证明同一 SPA、无 reload 的跨文件迟到响应隔离。
- 正式空闲检查、备份校验后，旧 PID 94789 优雅退出，新 PID 33920 在 `http://127.0.0.1:4173` 提供冻结资产。备份：`/Users/sun/.rah/backups/pre-restart-3efc66de-ae41-436f-b56d-787a41c740a2`。
- 重启前后 Room/Principal/Membership/Message/Task/Agent revision、runtime 配置、工作台配置和37个私有记忆文件数量/SHA-256一致，未改写用户历史。
- 正式新页面 Firefox 1440×900、390×844、DPR2 的 Computer、Task详情/历史/重载、Search 通过，实际读取 build ID 一致，无页面错误或被拒请求。正式检查为只读；新评论写流程使用隔离真实 daemon，不向用户历史灌入测试消息。
- 未运行付费 Provider，未提交或推送 Git；本批未进行官网同条件双边实操。源码依据、本地浏览器、正式部署是不同证据层级。

前端详细边界见[评论前端报告](./2026-09-08-attachment-comments-ui-closure.zh-CN.md)：HTML区域定位、移动收起手势仍未对齐；超过50评论的后端分页已测，但UI翻页实操与任意上游Markdown headingId导入没有在本批验收，不将其记为通过。
