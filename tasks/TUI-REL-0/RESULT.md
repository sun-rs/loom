# TUI-REL-0 可靠性审计

适配器回放 67 帧，未把任何启动中、草稿、权限框、压缩中或错误帧判为可输入。真实投递入口的替身回放有 4 次误投递尝试。当前 `inbox/tui.mjs` 会把适配器的 `UNKNOWN` 按 hc 的 `idle` 提升为可写。该文件超出任务卡可写范围，因此端到端误投递数为零的验收未通过。

## 来源清单

固定基线为 Orca `b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea`。在本卡实验目录取只读快照，再与 exp-relay 实验源码和当前工作区对照。清单覆盖 Claude、Codex、agy、共用 TUI 模块及 `claude-tui`。 [Orca 固定提交](https://github.com/stablyai/orca/tree/b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea)

| 统计范围 | 文件数 | Orca 上游逐字 | Orca 改写 | 实验代码 | 自写 | 总行数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 生产源码 | 39 | 40 | 228 | 1,923 | 2,551 | 4,742 |
| 源码、测试、配置、文档和旧样本 | 92 | 40 | 239 | 2,568 | 4,630 | 7,477 |

按目标文件物理行计。逐字要求在可归源片段中与固定快照的原行相同，通用短行不能独立证明来源。改写涵盖去类型、不同缩进或标点、JSON 规则移植和已注明的摘录。实验代码由对应源码的连续匹配块及原样本归属确认。未能归源的行计入自写，因此逐字列采用保守口径。 [逐文件计数](provenance.tsv) · [行号和来源](provenance-lines.tsv)

## 替换和保留

| 机制 | 本次处理 | 保留原因及边界 |
| --- | --- | --- |
| Codex 就绪 | 移植 `codex-screen-predicates.ts` 的空输入行、邻接忙行和临时加载标题检测，以及 `codex.json` 的实施计划选择器阻断。再要求 0.171.0 的原生键提示。 | Orca 的 xterm 网格、输出计时器和空闲标题评分属于其终端运行时。hc 可见帧缺少同等输出时钟。可见提示消失时保持未知。 |
| agy 就绪 | 改用 `antigravity.json` 的空输入框、快捷提示行和后台任务行布局，删除此前单凭快捷提示或任意光标判空闲的路径。 | Orca 的自定义状态栏规则也可能接受形似模式的草稿。当前 hc 样本不足以辨认此情形，保留失败关闭。 |
| Claude 就绪 | 用完整规则框、空输入和已知页脚代替单个光标判空闲。HC 状态冲突及不完整帧返回未知。运行时结合 SessionStart、轮次、压缩及退出信号。 | Orca `claude.json` 使用原生标题作为空闲信号。实采表明 hc 的 `idle` 与同一输入框中的草稿可以共存，因此仍需可靠的屏幕证据。 |
| 信任和权限 | 移植 `startup-dialog-screen.ts` 的末尾选项和光标距离校验，补充唯一光标检查。Claude 分次发送方向键和确认键，帧未确认时最多对同一完整、稳定的界面尝试两次。根据实采识别工具权限和模型权限画面。 | agy 的实际信任菜单与 Orca 的 Claude/Codex 按键行不同，使用 1.5.16 的标题、两个选项和末行。保留已知启动选择器的处理，通用工具权限框不自动批准。 |
| 粘贴、回车、忙时输入 | Codex 保留已移植的 `agent-prompt-injection.ts` 括号粘贴常量及提交间隔。Claude 保留 hc 的粘贴和提交传输，忙时检查可写输入框及活动轮，等待与输入内容相符的新 hook 或 transcript 记录。 | Orca 的 `terminal-agent-prompt-resubmit.ts` 可从网格读回草稿后补 Enter。hc 的 `send` 合并粘贴及提交，无法证明滞留草稿属本次请求。超时报告 `UNCONFIRMED_INPUT`，保留对账，暂停重复输入。 |
| 中断和退出 | Claude 优先等待对应轮的原生取消或 transcript 中断记录。屏幕兜底要求中断提示新出现，且连续两次读到恢复后的输入框。使用 hc 的 `finished`、退出码和原因。 | Orca 的退出订阅和输入事件归因依赖其 PTY 进程及附着协议。轮次自然结束或取消确认超时均报告未确认。 |

## 实采与回放

macOS、hc 0.1.22、Claude Code 2.1.331、Codex CLI 0.171.0、agy 1.5.16。合集含 32 个新实采帧和 35 个原有帧。Codex 的 429 由本卡回环后端触发，界面为原生 Codex。Claude 和 agy 的原生进程使用已有登录，写入限制在本卡实验目录。样本导出时去掉了账号、UUID 和机器路径。 [实采清单](fixtures/manifest.json) · [回放程序](replay.mjs)

| 人工标签 | 实际分类及数量 |
| --- | --- |
| 启动中 | UNKNOWN 2 |
| 信任框 | trust-dialog 10 |
| 空闲 | idle 13，UNKNOWN 1 |
| 多行或单行草稿 | UNKNOWN 4 |
| 忙 | busy 11 |
| 权限 | permission 2 |
| 压缩中 | compacting 2 |
| 中断后 | idle 5 |
| 限流 | rate-limit 5 |
| 错误 | error 1，UNKNOWN 3 |
| 选择器 | picker 5 |
| 认证错误 | auth-fail 3 |

中断后样本已恢复输入框，分类为 `idle` 符合预期。空闲漏判来自 Claude 2.1.331 首轮的 `Try "…"` 占位和绕过权限页脚。该页脚在实采草稿中也存在。保守地保留 `UNKNOWN`。实采含 Claude 的工具授权、Codex 的权限设置和真实 429、Claude 与 agy 的压缩中。Codex 只截到压缩完成，agy 工具授权及 Claude、agy 的原生限流尚无当前版本样本。

适配器的错误放行数是 **0/67**。三种 CLI 的测试窗格留有草稿时，hc 实测仍返回 `idle`。用这些状态和 4 个对应草稿帧通过当前 `inbox` 回放，得到 **4/4** 模拟发键尝试。替身记录了调用，没有对真实草稿发键。 [端到端缺陷复现](replay-inbox.mjs) · [模拟发送日志](/Users/sun/Code/exp-relay/tui-rel-0/replay-inbox.log)

## 版本漂移

`startPane` 用启动时的命令、目录和 PATH 执行有时限的 `--version`。探测结果存入 hc 窗格标签，`loom spawn` 回执和 `loom state` 读取标签。已验证的原生交付基线为 Claude 2.1.322、Codex 0.171.0 和 agy 1.5.16。Claude 2.1.331 已采样，当前 runtime 启动仍未验证，因此启动时会提示版本漂移。不同版本及探测失败分别给出实际值或 `unknown`，警告码均为 `UNVERIFIED_VERSION`。使用报告为 Codex 0.0.1 的替身，在真实 hc 窗格验证了启动标签、回执及状态的组装。此前已存在且没有版本标签的窗格无法追溯当时的版本。 [版本告警实测](/Users/sun/Code/exp-relay/tui-rel-0/version-probe.log)

## 测试、并行冲突和遗留风险

- 适配器、Claude TUI runtime 及语料回放的定向测试 75 项全过。包含未知帧证据、权限键序列、结构化输入确认、中断确认、模拟 hc 接受后没有原生证据，以及同一输入不重复提交。 [定向测试日志](/Users/sun/Code/exp-relay/tui-rel-0/focused.log)
- 最后一轮全量 `npm test` 共 206 项，197 通过、8 失败、1 取消。三条 CLI 测试因 `projectFilter` 导入失败，另外的失败来自 daemon 集成测试。相同导入问题阻塞 `bin/loom --help` 和完整版本告警 CLI 实测。 [全量测试日志](/Users/sun/Code/exp-relay/tui-rel-0/full-tests-final.log) · [帮助命令错误](/Users/sun/Code/exp-relay/tui-rel-0/loom-help.log)
- CLEAN-0 在审计期间把收件箱的 transcript 解析导入迁移到 adapters。本卡未编辑 transcript 解析文件，来源表按迁移后的工作区生成。收件箱可写范围之外的问题仍在。并行 CLI 迁移使 `cli/loom.mjs` 引用 `cli/project.mjs` 已移除的 `projectFilter`。
- Claude 的原生 runtime 启动未端到端通过。绕过权限模式下的首轮提示无法凭 hc 纯文本与草稿区分。人工送出测试消息后虽然出现空输入框，沙箱拒绝在全局配置树建立 `session-env`，该会话没有发出 SessionStart。保留结构化启动前置条件。 [原生 runtime 试次](/Users/sun/Code/exp-relay/tui-rel-0/runtime-live-assisted.log)
- 未验证 hc 连续采样与实际发键之间的人为输入竞争，也没有 hc 的原子「按此帧写入」能力。优先依赖原生信号、有界确认及保留未确认记录可缩小误投递范围。现有 CLI 守护进程的收件箱仍需单独修复和复验。

本卡创建的 12 个 hc 窗格均已核对为 `finished`。回环后端已停止。 [清理日志](/Users/sun/Code/exp-relay/tui-rel-0/cleanup.log)

STATUS: blocked
