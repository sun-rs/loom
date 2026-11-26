# ROT-TUNE-1 验收记录

在 `infra/rot-tune` 独立工作树实现研究定稿 A–H，并合入 t17w、t17g、t13n 三份审计的修订。默认仍由角色或 Super 主动换班。设置 `rotation.mode: "v2"` 后开启新机制。显式策略模式保留 `maxContextTokens`、`rotateAt: "gate"`、`maxContextFraction` 与 `minRemainingAfterCompaction`。最后一项要求已有一次成功压缩，且其后新的读数显示剩余比例再次低于配置值。

## v2 政策和交接

- **A。** 配置 `rotation.protectedRefs` 后，loomd 在启动观察时记住受保护分支的初始 SHA。分支移动必须对应一条已获 Auditor 批准、对同一完整候选 SHA 预先登记的授权。未授权移动和非快进移动冻结执行责任角色并启动紧急接任。Super 或另一方也可附原件登记越权或造假。紧急简报要求核对完整裁决账本。
- **B。** 项目工作目录或 Git 根、显式阶段或目标、Super 的角色或授权裁决、工作切换以及连续三次退回各有结构化记录。普通门禁不递增阶段。切换密度只计原生压缩，文档与账本路径不计子系统。回放后选择可配置的 OR 策略，单主线与单子系统仍放宽卡数阈值。
- **C。** 证据支持的首个错误触发逐项核对原件。加严后新增已核实错误在干净边界建议换班。本人可附原件自报，同一原件和结论会去重。Auditor 可以门禁投递 ID 记录有错与无错的抽查。
- **D、E。** Claude、Codex、agy 各有可调的绝对高水位。高水位转只读核对，干净边界提示换班。用户纠正累计单独提示。轮数、运行时长、等待唤醒、上下文剩余比例用于观测。Auditor 唤醒超出门禁预算仍只发流程通知。
- **F。** 前任在核查期间保持在线和只读。继任首报逐项核对 HEAD、分支、基线 SHA、WIP 与裁决编号。发现不符时写 `MISMATCH` 并结束，loomd 回退前任、暂停同阶段再换并通知 Super。独立的 30 分钟核实时限从首报就绪起算，超时升级 Super，交接继续待定。另一方核实通过后，loomd 先送达「接管生效」和执行 Next action 的指令，再释放改投工作。原地址的可安全重投消息沿用投递 ID，有过投递尝试且无法安全重投的消息标为作废。回执保留实际处置。loomd 执行阶段防抖、交错换班、必填模板和继任当日的规则锁。
- **G、H。** 原生弹窗或额度卡住超过 30 分钟、模型或 CLI 版本变化分别登记。相应接任记录为被动换班。与用户直接对话的 Super 不接收针对自己的自动换班提示。

CLI 和配置见 [组织文档](../../docs/ORG.md#高级角色换班-v2)，七项标题及首报格式见 [Loom 交班模板](../../skills/loom/SKILL.md#换班与收尾)。当前事实卡附在压缩后、换班时或长等后的首次托管投递。直接在原生界面输入的回合没有托管投递附件。使用旧版固定钩子的已运行无头 CLI 在重新启动运行时时取得新工具限制，升级后的 loomd 会即时拒绝相关角色的受管写 RPC。

## 窗口及状态数据

- Codex 优先使用 rollout 的 `model_context_window`，管道 app-server 也保留其原生用量窗口。Claude 托管 TUI 使用状态栏的上下文 JSON，记录经过会话 ID 校验的数值。Claude 和 agy 的无头路径采用已经上报到 Loom 的原生用量。agy 的 ACP `usage_update` 提供已用量与窗口。旧转录缺少实际窗口时，按原生模型名称查回退表。未知模型且无测量时保留空值。
- Antigravity 官方文档给 Gemini 4 Neon 的产品上限为 512K，回放使用 512,000。Claude Sonnet 5.5 的回退值为 1,000,000。Codex GPT-6.2 Sol 的 475,000 来自仓库所存原生 rollout。回退值会标注为 `model-table`。 [Antigravity 模型](https://antigravity.google/docs/models?app=antigravity) · [Claude Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) · [Claude 状态栏字段](https://code.claude.com/docs/en/statusline#context-window-fields) · [Codex rollout](../../adapters/codex/fixtures/experiment/codex.jsonl)
- `loom status` 显示当前角色的轮次、会话时长、转录字节数、上下文百分比与窗口来源、压缩次数及其后的第一个可用读数，并按本机日期统计已接任的次数。`--json` 也保留历史会话的数值、换班原因和缺测值。`loom cost` 通过投递 ID 或原生轮次匹配接任简报，单列该轮已观测的输入、输出和原始合计 token。

## pilot-2 只读回放

用 [replay.mjs](replay.mjs) 只读检查 2026-11-26 00:00 至 2026-11-27 00:15（北京时间）的原生轮次、派卡与门禁记录。延伸到零点后是为了覆盖卡面最后一位 Auditor 的接任。密度候选按历史会话计算，未模拟替换后的新轨迹，也未把历史活动推定为可执行换班。

| 角色 | 原生轮次 | 历史接任 | 默认显式模式建议 | v2 密度 OR 候选 | v2 密度 AND 候选 | 绝对高水位候选 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Leader | 96 | 3 | 0 | 1 | 0 | 0 |
| Auditor | 38 | 3 | 0 | 0 | 0 | 0 |

触发 OR 的 Leader 历史会话经手 23 张卡，观测到零次原生压缩。Leader 最高单次输入 372,075，Auditor 最高 275,681。范围内有两条项目完成事件、零条结构化门禁完成事件和零条可证实的三连退回。历史记录没有 v2 的人工裁决和事故标签。

Auditor `d173a83a` 有一次原生压缩边界，其后第一条可计算的读数为 4.77%。回放仅输出计数、会话短地址和数值，未向 pilot-2 daemon 或窗格发送操作。

## 验证

- `npm ci` 在该工作树安装成功。隔离项目使用真实 Unix socket 确认只读查询成功，伪造 Super 地址无法登记政策或停止 daemon。
- 交接测试检查前任只读、首报核验权限、接管信封先于改投工作、当日规则确认、核实超时独立升级、`MISMATCH` 回退并锁阶段及普通门禁不推进阶段。其他测试覆盖固定候选授权、未授权 ref 移动、错误与抽查分母、三连退回、用户纠正、高水位和长等事实卡。
- 最终在隔离的 `HOME` 运行全量 `npm test`，737 通过，0 失败，0 跳过。`git diff --check` 通过。变更保留在 `infra/rot-tune`，未暂存、未提交。

STATUS: done
