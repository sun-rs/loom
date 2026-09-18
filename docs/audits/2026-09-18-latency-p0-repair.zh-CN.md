# 延迟 P0 第一批修复与真实验收

日期：2026-09-18。范围：按 Raft Computer 1.0.32 复核启动、长期规则、停止后恢复与 Provider 错误传播。保留当前 Agent、Room 历史、Provider session 和原始文件记忆；不以清空旧上下文制造性能改善。

**结论：下面四项已实现，但整个延迟 P0 尚未闭合。** 真实门禁证明 Claude/Kimi/OpenCode 仍能完成普通聊天与任务流程，且 Kimi 后续回合没有再次追加全量规则；同时暴露了 Kimi 模型等待/收尾仍长，以及 Codex 当前服务不支持授权模型的阻塞。不能把功能门禁通过写成性能问题全部解决。

## 源码依据与纠正

固定来源：[Raft Computer 1.0.32 原制品](https://cdn.raft.build/computer/1.0.32/raft-computer-darwin-arm64)，提取 `main.js` SHA-256 `531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`。来源与分析许可边界见[证据清单](../evidence/raft-release-20260916/manifest.json)。本次只分析发布材料，没有把 bundle 作为生产依赖或执行它。

- `main.js:836149` 是携带正文的 `formatConcreteMessagesRuntimeInput`；`:836169` 同时存在明确不带正文的 inbox notice。`:844175`、`:848258`、`:848348` 区分首次唤醒、busy notice、Thread join 与恢复追赶。因此“Raft 每次都直接附正文、一次模型调用就能回复”不是成立的通用前提。
- `:820569`、`:839424`：Raft Kimi 使用 SDK `roleAdditional`，挂在原生 system 层，并支持 persistent/direct/steer。
- `:836632`、`:837278`、`:839488`：Claude/Codex 常驻，OpenCode 是 per-turn；四者都不等于“每轮丢弃 Provider 历史”。
- Multica 的 `server/pkg/agent/kimi.go` ACP 实现也使用 session prompt，不能提供当前安装版缺失的原生 system 通道。没有把任意 `_meta` 字段冒充已生效的 system 配置。
- 本机 Kimi `@moonshot-ai/kimi-code@0.39.1` 的 ACP `session/new/resume` 与配置选项未暴露 Raft 所用的 `roleAdditional`。Raft 使用的 `@botiverse/kimi-code-sdk@0.34.0-botiverse.0` 与本机 v2 session 持久格式不同。本次只检查其包源码，没有替换用户 CLI、接管账号或盲目迁移历史。

下述启动聚合是 RAH glue，停止围栏是 RAH Kernel 修复，Kimi 去重是受当前安装版约束的兼容方案；都不宣称逐字复制 Raft。

## 已实现

### 1. 合并启动必读内容

单一 owner 是 AgentHost Worker CLI。新增 `worker message-check --startup`，在同一次工具结果里输出本轮冻结的 Agent/context manifest、完整原始 `MEMORY.md` 与既有 canonical message-check 结果。四个 driver 共用 `providerActivationInput()`，避免让模型分别决定读取环境、读取索引、拉取消息。

索引通过现有安全文件 reader 完整读取，保留 BOM/CRLF，不摘要、选择、截断或遍历 notes。路径必须匹配当前 participant；启动读取或输出失败不会继续 ACK。消息分页、先输出后确认、范围与 target read-position 仍由原 Worker/Application/Kernel owner 执行。此结果不证明模型理解，也不完成 Task。

新唤醒提示要求当前工作处理完后结束，不为等待未来同伴消息维持执行；同时明确发布进度不等于可以中断尚未完成的授权工作。该引导不是强制终止机制，真实模型仍可能继续收尾。

### 2. Kimi 停止重复追加全量规则

同一 standing-prompt digest 的 session 成功恢复后，只追加有界唤醒输入；新 session、原生不支持恢复或 session-not-found 降级仍发送完整规则。每 Run 提供一个私有完整规则文件作为压缩后恢复入口，目录 `0700`、文件 `0600`，正常退出与取消时清理。

已有 session、历史和记忆不删除；不改跨 Room continuity key。真实三轮 `turn.prompt.input` 的 JSON 序列化长度是 **50,058 / 1,355 / 1,355 字符**，后两轮不含重复的完整规则。这些数字不是 input token，也不等于上下文已经缩小到 1,355 字符。

**仍有边界：这不是原生 system 挂载。** 压缩后规则恢复仍依赖提示与读取文件，尚无真实 compaction 验收。下一步需要在支持现有 session 的原生通道中补齐 system/role 与 steer，不能把本兼容方案当作 Raft 原生对齐完成。

### 3. 修复停止后旧范围抢先执行

精确复现得到的根因是 `placement-candidate-projection.ts` 没有排除 `room_agent_sos_holds`。旧执行已终止、新纠正消息尚未到达时，Placement scheduler 可以先预留旧 queued Activation，冻结旧范围；随后新输入只能进入 follow-up。

这修正了[原根因分析](./2026-09-17-latency-root-causes.zh-CN.md)将主要修复点放在 cancellation 合并过程的判断：旧 legacy lease 路径已有 SOS hold 围栏，现有 queued 合并在未被提前预留时也能正确包含纠正消息。现在 Placement 候选查询使用同一持久 hold 围栏。

回归覆盖纠正消息在 terminal proof 前、后两种顺序，验证 hold 期间不能预留，首次恢复范围包含纠正消息，且仍只允许一个执行 lane。没有取消终止证明、并发保护或消息幂等性。

### 4. Codex 具体失败不能退化为通用重试

真实门禁发现当前服务返回 `404`，授权模型 `gpt-5.6-luna` 不被任何配置账户支持。driver 原来丢弃 `turn/completed.turn.error.message`，只上报 `Codex turn ended with status failed`，导致已存在的 model-configuration 策略失效，连续三次无效尝试。

现在核对 turn/thread 身份后保留有界原生错误信息，继续走既有脱敏、分类和 quarantine owner。fake 原生协议回归先复现 `RuntimeError`，修复后得到 `ModelConfigError/sticky_terminal`。没有静默替换授权模型或更改 Provider 配置。

## 验证与实测

- 启动聚合先复现不支持 `--startup` 的失败，再验证完整索引、身份与输出失败不 ACK。
- Kimi 原生协议 fake 先复现恢复后重复规则，再验证 fresh/resume/fallback、取消和私有临时文件清理。
- Placement 回归先复现 after-terminal 仍被预留；修复后停止与 Placement 定向测试 59 项通过。
- Codex fake 原生协议先复现错误分类丢失；修复后正常恢复、fallback、取消与具体失败分类通过。
- `npm run check`、格式、diff 和部署最终结果见本文末尾，未运行的门禁不算通过。

真实门禁使用临时状态、Agent 与工作区，精确授权模型：Claude `sonnet/low`、Kimi `kimi-code/k3/high`、OpenCode `deepseek/deepseek-v4-flash/low`；普通消息不创建 Task，后续持久工作只能有一个 Task owner，并产生 canonical Thread 证据，功能断言通过。

一次三 Agent 频道样本，以 Human message 落库到首条正式回复计时：

| Provider |  首条回复 | 首次 Run 结束 | 说明                                                                              |
| -------- | --------: | ------------: | --------------------------------------------------------------------------------- |
| OpenCode |  5.869 秒 |      8.761 秒 | 首个工具为 startup check，然后正式发帖                                            |
| Claude   | 11.688 秒 |     13.895 秒 | startup check 后遇到新鲜度 hold，再发；UTC 日期答案错误，功能门禁不验证答案正确性 |
| Kimi     | 76.824 秒 |    153.832 秒 | startup check 后首发被 hold，调用 date 后修正；回复后仍读写记忆，收尾很长         |

Kimi 第一轮工具序列为 startup check、post held、`date -u`、post、再次 check、读取/写入/修正记忆路径；第二轮继续读取并整理记忆。工具时间远小于工具间模型等待。这是尚未解决的实测长尾，不删除 Raft 记忆维护规则、不在任意 post 后杀进程来掩盖它。

本轮没有与修复前相同会话、缓存、模型状态的受控 A/B，也没有 Raft 双边同条件计时，以上不能计算性能提升比例。四家联合门禁因 Codex 模型服务拒绝失败；随后三家联合门禁通过，不是“四家全部通过”。

脱敏原始证据摘要见[本批证据](../evidence/2026-09-18-latency-p0-repair.json)。不存私有记忆、思考正文或凭据。

## 未闭合项

1. Kimi 原生 system/role、compaction 后一致性、busy steer。
2. Codex/Claude/Kimi 常驻实例与单次执行身份/工具授权的生命周期分离；不能直接删除当前进程终止围栏。
3. Kimi 等 Provider 的长收尾与同伴消费成本；新提示的效果并不构成强制保证。
4. 保留已有真实上下文的原生压缩验收，以及 fresh/resumed/停止纠正/DM/频道同条件性能对照。
5. Codex 授权模型服务可用后的真实验收。模型未被支持不是 RAH 可以靠改上下文解决的问题。

## 发布状态

- 最终 `npm run check` 通过：2,300 项通过、0 失败、17 项默认付费 skip；`npm run format:check`、`git diff --check` 通过。正式 `build:web:workbench` 通过，只有既有大 chunk 提示。
- 重启前没有 active Run；已验证备份 `/Users/sun/.rah/backups/pre-restart-58087656-bf90-4201-b07f-4b42a551caa2`。旧 pid 9170 正常退出，新 pid 47807；不强杀、不重置数据。原 loopback、Tailnet、LAN 三地址的 4173 监听保留。
- 冻结 Web build `26895d5530698f71eaca23a13058c898546b3ae189973fb4460c5e96aa34a7cf`；运行 build identity `d083172804e526f9`，三地址 health 与构建元数据一致。
- 新开实际 Chromium 页面完成 1440×900 与 390×844 浏览器门禁：频道正文、composer、文件引用窗口、关闭及重载正常，截图已检查；无 page error，前后 canonical Room event 序号不变。结果目录 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-composer-formal-rrGSWf`。这是正式服务浏览器验收，不是 iPhone 实机或修复后正式 Agent 性能验收。
- 已部署本批修复；未提交、未推送。未闭合项仍按上一节保留。
