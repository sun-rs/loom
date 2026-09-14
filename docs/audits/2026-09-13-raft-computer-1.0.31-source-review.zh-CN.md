# Raft Computer 1.0.31 更新取证

## 版本身份

2026-09-13读取官方 https://cdn.raft.build/computer/manifest.json，稳定版本为1.0.31。
官网本机Computer仍显示已安装1.0.18，并提示可升级1.0.31。因此这是Computer可用更新，不能推断当前机器已经升级，更不能推断中央Server的全部代码变化。

本轮仅下载并静态提取，不安装、不执行新版，也未点击官网升级。
官方版本文件为 https://cdn.raft.build/computer/1.0.31/raft-computer-darwin-arm64.gz。
压缩文件及解压二进制均对官方SHA256校验通过：

- gz：6672748cf03296aea4e195819d6fc0787b262079ddfffdd6055240ef36a20279
- binary：d9a8558230e9374092c9dabb9590e4015b6b83fe89a6dd8934ade1bd6466c71f
- 提取main.js：d971d8f23b3178b008ce409964082f1dacb1d638a8965f11d19fef274331aeca

方法沿用extract_node_sea.py及split_esbuild_bundle.py。196个第一方模块切片保存在
`/Users/sun/Code/reviews/rah_os/2026-09-13-raft-1.0.31`。
对照旧1.0.18的source-slices，新增25个模块路径；路径变化与编译器变量重命名不等于25个新功能。comparison.json及diffs/保存原始差异。
这是1.0.18→1.0.31累计比较，不是1.0.30→1.0.31单版changelog，也不是全模块语义审计。

## 已确认的实质变化

1. **Claude忙时通知策略变化。** 旧ClaudeDriver为persistent/gated/queue，新为persistent/direct/steer，busyDeliveryMode由gated改direct，新增 acceptsStdinDuringCompaction=true 声明。新版源码解释：Claude原生stream-json queued-command路径拥有同轮输入顺序，daemon不再重复维护tool-boundary timing gate。新建会话liveSessionReadyAt仍为turn_end。位置：新main.js:834282起；旧同名ClaudeDriver。不能再无版本限定地说“Raft Claude必须gated”。本轮不自动移植此策略到RAH，需连带阅读投递、compaction、通知去重及CLI版本约束后另做行为验证。
2. **日志增加大小轮转。** `slices/packages/computer/src/logRotation.ts`新增64MiB阈值，跨日或超过大小即轮转；同日多次归档加序号，避免重名。14天保留策略仍在。旧版主要按日期轮转。
3. **升级收据与实际运行版本核验加强。** 新`kOperationAcknowledgement.ts`先核操作终态、K锁释放、stable版本及文件摘要，并双读服务证明确认稳定；不满足则拒绝消费收据。`serviceUpgradeStart.ts`集中处理SEA/local/remote来源与请求ID约束。不能把升级请求被接受等同于新版本已运行。
4. **macOS登录恢复入口。** 新`macosLoginCarrier.ts`生成按home标识的LaunchAgent，指向稳定dispatcher；拒绝无稳定入口证明的K slot路径持久化。配套`kHostLifecycleRefresh.ts`负责生命周期入口刷新。
5. **消息协议拆分与发送V2。** 共享契约新增独立agentApiMessageContract/agentApiMessageClient/agentApiPaths模块，显式sendV2及结构化mentions；部分能力此前已在独立npm Agent CLI可见，因此不将其全部算本版新功能。外部消息新增不可冒充的authority字段约束。中央Server是否执行所有对应规则，单靠客户端包无法验证。

Codex/Kimi仍为direct/steer，OpenCode仍为per_turn/none、忙时合并pending；这一观察只针对上述driver描述符，未声称实现全文未变化。

所有源码仅作授权分析证据，不成为产品依赖，不覆盖既有上游快照。本轮交付UI修复；运行时协议升级留作独立、有测试的后续变更。

## 本次复核与 RAH OS 可提取项

2026-09-13 再次读取官方 manifest，仍为 1.0.31（Node 24.15.0）。同时重新计算两版提取 main.js 摘要：1.0.18 为 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，1.0.31 与上文一致。旧切片位于 `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices`，daemon 文件为 `chunk-ZHWD6VKE.js`；新文件为 `chunk-5Y2HSDGS.js`。这些是累计源码差异，不是官方逐版发布日志。

进一步核对两版 Driver 定义：12 个 Driver 类名完全相同，Kimi SDK、Pi、BuiltIn 等已在 1.0.18 存在，不能列为新增。剔除编译器标识符编号差异后，OpenCodeDriver 定义无差异；Codex/Kimi 的 Driver 投递模式没有切换。Claude/Codex/Kimi/Kimi SDK 的 `buildSystemPrompt` 调用移除了各自重复的忙时通知配置/备注；这只证明调用层简化，不证明最终提示词不再包含通信要求。KimiSdkDriver 的 probe 新增 host 版本回报。Claude 的已知坏版本 2.1.59 / 已验证版本 2.1.220 说明在旧版已经存在，不能算新版新增兼容性修复。

| 优先级       | 可提取内容                                                     | RAH 已有 owner / 建议边界                                                                                                                                                  | 尚需验证                                                                                                 |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 高           | 升级完成必须核对实际进程、稳定版本和文件摘要，拒绝提前消费收据 | `packages/agent-host` 的升级协调器、`packages/k-carrier` 与现有服务核验；从 `kOperationAcknowledgement` 移植缺失断言及失败案例，不复制中央服务器拓扑                       | 旧进程存活、锁未释放、目标摘要不匹配、连续两次服务身份变化、失败回滚的收据行为                           |
| 高           | 日志按大小及日期轮转，同日归档加序号                           | daemon 的进程日志生命周期；先盘点正式服务 stdout/stderr 的持有者，再复用 `logRotation` 的命名/保留算法。当前未完成所有日志路径的覆盖审计                                   | 打开文件描述符是否继续写旧文件、并发轮转、磁盘满、归档重名；64MiB 是轮转检查阈值，不是绝对文件大小上限   |
| 中           | macOS 登录恢复使用稳定 dispatcher，避免指向临时升级 slot       | 现有 `macos-computer-installer` / Core 安装 owner；RAH 已有 LaunchAgent 与 stable slot，优先补入口稳定性与迁移测试                                                         | 升级后重新登录、路径变化、旧 plist、旧服务接管；不要新装第二套守护服务                                   |
| 中，单独验收 | Claude 改 direct/steer，并接受 compaction 时 stdin             | `packages/agent-host/src/claude-busy-input.js` 目前明确移植 1.0.18 gated 行为。新版依赖 Claude 原生 queued-command，需保持 Kernel Inbox/Activation 和消费 ACK 的唯一所有权 | 首次会话未就绪、压缩中追加、重复通知、进程退出、失联重连、同轮输出顺序；未经测试不直接把 gated 改 direct |
| 中低         | 消息 V2 的结构化 mention 与外部 authority 限制                 | protocol/application-service 的既有 typed mention、身份及命令校验；按缺失的不变量评估。保留 RAH 的单 Human 与 Room-first 规则                                              | 客户端 schema 不证明 Raft 中央 Server 全部执行；Slack 桥接与多人权限不进入当前范围                       |
| 低           | 重复运行时提示配置收敛与 Kimi SDK host 版本诊断                | 现有 Worker prompt/运行时发现 owner，先比较最终生成内容；RAH 当前用 Kimi ACP，host 版本能力不适用当前接法                                                                  | 不能因此删除必要投递协议，不启用新的 SDK runtime 或改写 Agent 记忆                                       |

推荐先做升级结果核验和日志生命周期审计，再进行有界的 Claude direct 投递实验。本次只交付研究及 UI 字体修正；没有升级官方 Computer、替换 RAH Driver、导入发布 bundle 或运行付费 Provider。授权分析文件沿用原取证目录的来源与许可边界，不将闭源发布物当作可任意再分发的开源代码。

## 环境变量编辑器字体修正

Raft 当前前端 `index-BVfbaScj.js`（来源与哈希见[环境变量收口](./2026-09-13-agent-environment-only.zh-CN.md)）的高级入口为 `text-sm text-black/60 hover:text-black`；`AVe` 使用 `size=sm, variant=ghost`，按钮尺寸规则为 `h-7 … text-xs`。RAH 此前 summary 继承正文黑色，添加按钮使用 14px。现改为 summary 14px / 60% 黑色 / hover 黑色，添加按钮 12px，小于环境变量标题，保留 28px 命中高度。

浏览器测试先复现 summary 为正文黑色的失败，再验证计算颜色、字号、保存重读及 390px。最终全量检查、正式构建和重启验收在本次交付完成后补录。

最终交付：相关环境变量浏览器脚本通过，桌面和 390px 截图已检查；共享按钮/侧栏匹配规则报告重新由浏览器生成，未放宽门槛。`npm run check` 首次遇到既有任务链测试的 `DaemonAlreadyRunningError`（同名 `agent-task-split-host` 实例锁冲突），单独重跑与随后完整 `npm run check` 均通过。格式检查、diff 检查及正式构建通过。空闲确认、状态备份与优雅重启后，冻结构建 `db876927fef9f2c70008daf19cc75bb93cd5b79289e2ab18e047585261ae2056` 的 loopback / LAN / Tailnet 新 Chromium 页面均确认字号与颜色、Settings 默认展开和 Guide，以及原有四个 Agent。正式页面只读检查，没有配置写入或付费模型调用；没有提交 commit。
