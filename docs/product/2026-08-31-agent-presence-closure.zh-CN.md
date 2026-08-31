# Agent 头像实时状态：复用、边界与顺序施工

日期：2026-08-31。先设计后施工；本文件的计划不等于验收结果。

本轮实施结果见[施工复核](../audits/2026-08-31-agent-presence-closure-review.zh-CN.md)：P1/P2已实施、桌面P3用例已观察；真实Provider完整序列、有效390px验证与external仍未通过准入，不因此关闭P4全站合同工作。

## 基线与复用裁决

官方当前冻结 index-BoAC7nSE.js 的 `Uze/fp/ip` 定义四种 managed 状态颜色和 external 青色覆盖；`mne/sM/t4e/yne` 分离当前状态、历史轨迹、顺序校验和生命周期回退。Computer 1.0.18 的 `trajectoryActivityProjection/runtimeEventEndsThinking/broadcastActivity` 在文本聚合前上报活动转换，并用运行身份、单调序号和事实心跳保护当前状态。官方 Lifecycle 文档明确：没有驻留进程的健康休眠 Agent 也可能灰色。

直接结构化移植颜色/脉冲选择与 entry→activity 的纯映射，记录原函数、文件哈希、差异；不重新设计颜色语义。不把整份带 socket/store 依赖的 Web bundle 导入产品。官方发布代码不是其完整服务端源码。

RAH 适配仅用于已有身份/协议：launchId 对应 RunAttempt + runtimeRunId，旧生产者消息按 producerSequence 排序；Host generation、Activation lease、RuntimeProcess 终止事实优先于历史诊断。观察状态不改变 Task、Room、Inbox、Activation 的业务状态。已结束 Run 的历史 thinking 永远不能点亮当前头像。

## 单一 owner 与接口

1. Provider normalizer/trajectory writer：采集开始、结束及终止事件；文本原有合并保留，状态转换不等待文本 debounce。Codex 只处理 reasoning 开始/结束和公开 summary，不读取 raw reasoning。
2. Kernel 新增只读 presence projection：复用 Agent catalog ACL、现有 RunAttempt/RuntimeProcess/Host/trajectory；不新建持久队列或状态表。按 Agent 跨 Room 读取，仅输出 content-free activity/reason，不泄露私有 Room、命令、路径、模型内部文本。无当前进程=休眠；失败=异常；暂停/失联/未知单独标注。
3. Human Port/SDK 增加 capability-gated `agent.presence.list`，与较重的配置 catalog 分开。每次读取完整当前快照，网页隐藏时降频，回到前台立即核对；请求超时需真正释放单飞锁，忽略旧结果。暂沿现有 pull transport，不为了圆点新建 WebSocket 系统。
4. Web 单一共享 StatusDot/label，供头像、摘要、资料、私聊和列表消费。只显示小而安全的原因；状态 API 不可用时显示未知，不能用 Host 在线伪造 Agent 在线。旧服务 capability 未开放时不发新请求。

当前产品没有 Raft external Agent 身份接入合同；青色 external 的共享渲染可移植并测试，但不将本机 Claude/Kimi/OpenCode/Codex 冒充 external，也不为凑色卡增加外部 Agent 生命周期。

## 开发顺序与放行

| 批次 | 工作                                      | 必须证明                                                                                                 |
| ---- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P1   | 官方纯映射来源 + 协议 + Kernel projection | 休眠/开始/思考/工具/异常/结束；乱序、旧 Run、Host 过期；跨 Room 但无私密内容泄露                         |
| P2   | Provider 状态边界 + Human/SDK + 共享圆点  | 状态先于聚合文本；所有头像同源；未知不伪绿；重试/导航不回退状态                                          |
| P3   | 实际浏览器与回归审查                      | 隔离真实 Kernel/Host/进程产生活动；桌面与390px；悬停标签、颜色、脉冲、刷新；明确 fake/真实模型的证据等级 |
| P4   | 行为合同继续追踪                          | 先更新已追踪/未追踪清单，再 Agent 各 tab/权限、文件偏好与预览、导航/触控反例；不把1836候选当完成率       |

二次设计自审：不用每秒读取全量轨迹、逐头像请求、历史最大 timestamp 或最后一条 thinking；不因为工具失败就改 Task 状态；不复制官方曾用超时猜 online 的降级；不重启用户正式服务。相同事件序列的映射测试与真实生命周期故障测试分开记录；全绿测试不等于全站1:1。
