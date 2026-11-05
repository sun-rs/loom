# Herdr 运行时研究：免费执行结果

2026-11-05。结论：**保留现有 Loom 运行时，不把 Herdr 直接换成底层托管层。** 原生终端与聊天投影可以复用，但本批没有证明能够停用 Loom 的任何完整生命周期职责。没有修改、重启正式服务，没有付费调用，没有运行 Claude Code。

这是一轮研究筛选，不是完整产品验收。原始[实验清单](plan.json)保持不变；[结果](free-results.json)、[所有尝试](attempts.json)、[请求索引](request-index.json)和[来源](sources-executed.json)分别记录实际覆盖。

## 实际执行

| 路径                               | 结果                                         | 证明范围                                                                                           |
| ---------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Codex 0.166.0 原生工具预检         | 未通过：工具宿主协商超时，native turn failed | localhost 请求2次，没有成功工具读取回执，不绕过宿主、不进入付费阶段                                |
| A0：Pi 直接 print-JSON             | 通过                                         | 真实原生 CLI、read 工具读取随机文件内容、完整最终正文；不是完整 Loom Activation                    |
| B0：Herdr 承载同参数 Pi print-JSON | 通过                                         | shell 将原生输出重定向到文件，保持非 TTY；只证明简单输出可透传，不是双向 IPC 或产品 RuntimeAdapter |
| C：Herdr 中原生交互 Pi             | 基础路径通过                                 | 连续输入、真实工具回执、同 session、最终正文；不以 Herdr 状态证明执行完成                          |
| C：10个固定种子的观察／连续轮次    | 通过                                         | 同一 session，10次只读终端连接、不同视口、断开后继续；观察新增请求0，每个后续任务固定2次假模型请求 |
| C：人工控制与自动输入互斥          | **失败，停止候选**                           | 第二控制者被拒绝；第一控制者仍持有终端时，独立 agent.prompt 成功写入并触发2次请求                  |

前一轮 smoke 有8次 Pi 请求／4次实际文件读取；扩展轮有30次／15次，其中最后2次请求来自有意执行的接管负向测试。加上 Codex 失败预检，本批原生 CLI 共40次 localhost 假模型请求，真实 provider 调用0。假模型 token 数是固定夹具数据，不能用于声称效率倍率。

准备中还发生3个脚本错误：缺少配置子目录、将文字版 server status 当 JSON、没有结束 Pi 的 stdin 管道。最后一个导致启动等待，但没有 session／模型请求。错误和清理记录均保留在 attempts 中，不计作 CLI 正确性失败或成功。

## 接管失败的根因

Herdr 0.9.1 的终端控制流维护一个 controller，另一个 controller 收到 already has an attached client。但 agent.prompt 是独立自动化 API；queue_agent_prompt 检查 agent 身份、blocked 状态和启动就绪，不检查这个 terminal controller。

所以，**终端输入互斥不等于 Loom 的“Human 接管后暂停自动投递”**。这符合 Herdr 两条接口各自的用途，不是将上游 API 判为缺陷。若要接入，Loom 仍须将接管事实绑定执行租约，暂停自动写入、保留待投递消息并在交还后恢复。本批没有实现这层业务接线，不能宣称 Herdr 自动完成它。

证据见[takeover.json](takeover.json)及[真实 Pi 历史](native-pi-interactive.jsonl)。对应发布源码为 Herdr v0.9.1／065ef9d6a531c49fb8bee7e818ef837065b21ee9：src/client/terminal_sessions.rs、src/server/headless.rs 和 src/app/api/agents.rs::queue_agent_prompt。这是版本匹配，不是可复现编译后的二进制相等证明。

## 复用价值与职责账本

实际调用了固定 MIT Roamgate 的原始 projectAgentTrajectory，只走 Pi 分支，没有修改上游源码，也没有启动其他 CLI。它把本批13次交互输入／13次最终回复及工具轨迹投影成 GUI 数据，保留原 session ID。另一个两轮样本也通过。见[投影结果](roamgate-projection.json)。只读观察已经证明不需要新增 LLM 请求，但本批没有制作 Loom GUI，也没有证明其日常任务收益。

| 职责                               | Loom 现有 owner                         | 本批候选结果                                           |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Channel 投递、幂等、ACK、串行 lane | Kernel／AgentHost                       | 必须保留；未通过临时 Core 验证                         |
| 精确 session 绑定、恢复            | Host session store／各家 driver         | 精确 Pi 日志路径有用；崩溃恢复未验，不能停用原 owner   |
| 每轮输入、final、用量关联          | 原生 driver／WorkerFinalOutput          | 日志可展示；仍不能凭屏幕、idle 或退出码提交业务完成    |
| 停止、后代清理、孤儿回收           | Host process hygiene／instance pool     | 仅验证测试 server 退出及可见进程消失；后代完整静止未验 |
| 空闲回收、固定占用、恢复策略       | Host warm-runtime policy／instance pool | 未证明可替代；不改常驻策略                             |
| Human 接管、自动输入所有权         | 需要 Loom 业务接线                      | 原始 Herdr 控制权不足，负向测试失败                    |
| 终端帧、原生日志到聊天投影         | Herdr／Roamgate                         | 已验证可借用的展示能力；没有据此迁移执行路径           |

没有一项完整的 Host 生命周期职责得到等价替代证明，故不进入资源重复矩阵和付费质量／成本对照；未测项没有判为通过。

## 复现与限制

实验代码在 scripts/herdr-runtime-study/，不加入生产依赖。fixture.test.mjs 先失败，再实现环境隔离与 localhost 流式夹具，验证丢弃凭据／代理／继承目标及真实工具内容回执。free-probe.mjs --run-free --extended 是显式实验入口，预期在当前 Herdr 的接管负向测试处退出1，不可变成默认产品测试。

投影复现使用 Bun 及固定的 Roamgate checkout：

```sh
bun scripts/herdr-runtime-study/project-pi.ts /path/to/pinned-roamgate /path/to/native-pi.jsonl /tmp/projection.json
```

Herdr 的 Pi 集成只安装到本批 scratch 目录；所有控制显式使用新建命名会话和独立配置，不访问当前用户会话。[清理检查](cleanup.json)确认测试 socket 移除、server 退出且无命令行匹配的本批 CLI；这不是未执行的后代静止门禁。原始完整日志留在 [manifest](raw-manifest.json) 所列本机路径，Git 内保留关键原生历史、失败回执和索引。

未覆盖：完整 A/B/C 产品契约、临时 Core 交付、并行隔离、重复投递／未知结果、审批／中断、后代静止、三类重启、空闲回收、超长／部分／替换日志、资源矩阵和真实模型质量。原设计的全部10场景×10种子没有执行，只有上述观察／轮次切片用了10个种子。
