# Channel mute 的可选 attention 响应与渲染

2026-09-11。本批只补说明投影和输出结构；没有改变静音投递算法、Room/Task 状态、ACK 或执行围栏。

## Raft 证据与采用边界

Raft Computer 1.0.18：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

- 17204–17218：mute response 的 attention 对象及九个字段均为可选。
- 675385–675401：`formatChannelMuteResult` 总是输出三行状态，其后依次条件输出 ordinaryActivity、stillArrives、threadBoundary、catchUp、unmuteCommand/unmuteApi、muteCommand/muteApi；不打印 state。
- 675404 起：mute/unmute 面向 regular Channel，Thread 和 DM 不作为该命令目标。

采用性质：响应字段与渲染顺序的结构移植，RAH 字段限制和 Worker 命令是本地适配；说明文字依据本地已测试的语义撰写，**不是复制未知服务端文案**。没有声称 Raft 服务器每次返回全部九字段，也没有推断其 catch-up 内部算法。

## 实现与单一 owner

`packages/protocol/src/worker-channel-attention.ts` 增加可选 attention，九个子字段继续可选并有界。旧响应没有 attention 仍合法。

`AgentChannelAttentionService` 继续拥有 canonical 静音状态；只在返回时调用同属 Kernel 的无状态 `agent-channel-attention-guidance.ts`，没有第二个投递队列或偏好存储。新提交按当前状态生成；幂等回执按**当前**静音状态生成，避免旧 mute 回执在已 unmute 后说反。

当前确证并输出：state、ordinaryActivity、stillArrives、threadBoundary、catchUp，以及与当前状态相反的 Worker command（mute 或 unmute）。其中说明：普通未来频道动态被抑制；现有排队工作不变；个人提及、已跟随 Thread 的回复、直接分配 Task 仍投递；Thread 跟随独立；取消静音不补发抑制期间的动态，可主动读取历史。

只列出了已验证的 stillArrives 子集，不将该列表声称为所有特例。`muteApi`/`unmuteApi` 本批不生成：模型已能执行真实的反向 CLI 命令，无须杜撰包含凭据/请求体不完整的 API 用法。Schema 和渲染器接受合法的可选字段，但生产结果不假填。

`worker-read-render.ts` 移植上游条件顺序；对旧响应保留原先三行，缺字段不显示 undefined，也不生成空 API 提示。

## TDD 与实际行为证明

新增 renderer 测试先因没有条件文本失败，新增真实 service/SQLite 测试先因没有 attention.state 失败（`/tmp/mute-attention-red.log`）。实现后 renderer 与 service 三个完整测试文件共 72 项通过（`/tmp/mute-guidance-final-green.log`）。

真实 Kernel/服务测试覆盖：

- 普通频道事件抑制，其他 Agent 不受影响；个人提及正常投递。
- 静音后已跟随 Thread 正常投递，取消跟随后普通回复不投递，个人提及仍可唤醒；直接分配 Task 仍投递。
- 静音不删除此前已排队的 Inbox；取消静音只恢复未来动态，不重建被抑制事件的 Inbox，消息历史仍可读。
- 新增结果与上述事实相符；幂等重试返回一致说明，CLI 实际收到并渲染说明。
- 原有跨 Room 权限、Thread/DM 拒绝、凭据撤销、Kernel 关闭重开、事件/投影回滚继续通过。

本批未跑付费 CLI、未做在线 Raft 双边实验、未重启或提交。父任务负责全量检查和正式实例交付。未填的两个 API 指引字段是可选省略；Raft 服务器实际说明文字及 catch-up 行为仍属在线证据边界，不据此宣称全面行为对齐。

## 主审补强：可执行指引安全性与输出边界

主审确认 Room slug 并无 shell 安全保证；本批初版 JSON.stringify 不能用于 shell 引用。已用受控无害 marker（printf）在 `/bin/sh` 回归复现变量/反引号替换，修为 POSIX 单引号与内嵌单引号标准拼接；入口改为 `"$RAH_WORKER_CLI"`，不依赖 provider PATH。目标按原样成为一个 argv，覆盖 `$()`、反引号、单引号、双引号和空格（`/tmp/mute-guidance-quote-red.log`）。

另确认无限长 slug 可令已提交 mute 的新响应超出 command 2048 字符限制。真实服务测试先复现失败，现对超出目标 500 字符或转义后 command 2048 字符的可选指引省略，既有响应限制不变；长 slug 可通过真实 Room ID 静音并幂等重试成功，避免成功变更返回 500（`/tmp/mute-guidance-long-red.log`）。去重分支读取一次当前 attention 状态后复用。
