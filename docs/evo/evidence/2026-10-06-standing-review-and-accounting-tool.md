# 常驻说明审查与免费分账工具收口

已把完整请求分账保存为 annotated tag `milestone-evo-request-accounting-2026-10-06`，指向 `488527c4f90a0835795702cb29bcb5dc28eef932`，远端 tag 及 peeled commit 均核验。这个里程碑保存测量证据，不代表 P122 的质量或效率通过。

## 常驻说明：停止小幅改写路线

Owner 要求“注意保存里程碑，继续”后，进一步检查 `standing-prompt-compiler`、`standing-protocol`、delivery、lease 及 session protocol upgrade。约 6.5 KB 固定增量不能全部视作重复文案：其中包括身份、运行范围、权限、Task、记忆和恢复语义。

只读候选保持 Task、权限、credential hygiene、reminder、style 与 formatting 原文，合并 Worker 操作与 startup 措辞。两段原计 2983 UTF-8 字节，候选 2748，仅少 235；候选 SHA-256 为 `4dda5b6b5cb3c58e9664144081a2b68875067d702b88603fc0517dc9846687df`，原文已保存于私有 review `2026-10-06-standing-review/candidate.private.json`。这是文本比较及人工语义审查，未证明模型行为等价，未应用到生产。

未采用按 MCP readiness 分成两套常驻协议：目前 daemon 是 prompt 唯一编译者，协议版本来自共享 sections；运行时 MCP readiness 与新建/恢复、warm/cold/CLI fallback 的时点不同。为了裁剪少量 CLI 用法再引入 profile/lease/help/版本一致性状态，尚无足够收益证据。

旧 session 也不会因新文案发布就删除历史。`SessionProtocolUpgrade` 保留原生 session，并通过携带更新提示的已完成 Run 推进版本记录；提示要求读取 `worker help protocol`，不证明模型确实读取或旧 system prompt 已替换。实际模型若读取，新卡会增加历史；不能把新 session 的字节减少宣传为旧 session 的即刻收益。自动轮换或改写 session 仍禁止。

[P112](2026-10-05-context-compaction-p112.md) 的小幅提示压缩失败和整体回撤继续保留，不能据该单样本断言某句改写导致偏离；也不能将当时未验收的 subset 重新标成优化。本轮不发起提示词付费批次，不修改生产提示、MCP 回执或调度。

## 已实现：可复用离线分账

原本只在私有探针中的分账，现在由 `scripts/cli-efficiency/request-accounting.mjs` 提供纯函数和 manifest CLI，说明见[效率门禁的离线工具段落](../../design/cli-efficiency-gate.zh-CN.md#免费完整请求分账离线工具不是效率门禁)。这是测量工具，不是新的产品状态 owner、provider 代理或通过判定器。

- 逐份紧凑 JSON 按 UTF-8 计数，固定项、当轮 wake、先前 wake、调用、结果、中断提示及原生答案分别记录；保留原始 body SHA。
- 独立比较固定 input 和既有历史是否原样保留；未知类型仍计入总字节，但明确分类不完整。没有前件时标 null。
- 不输出原文、metadata、路径或模型用量；没有 token/价格/付费调用数/效率通过推测。session 标签和请求序号来自清单，不能替代真实身份及捕获完整性审计。
- 严格读取 UTF-8。审查发现普通 `readFileSync(..., 'utf8')` 会用替代字符吞掉损坏字节，造成 SHA/长度与原文件不符；新增实际 CLI 反例先复现误通过，再用 fatal 解码修正，BOM 同样拒绝。

[已有的 72 份捕获由正式工具离线重算](2026-10-06-accounting-tool-replay.json)，全部类别、input/body 字节和 SHA 与先前 Python 分账一致；未启动新 CLI 或 provider，先前独立审计继续按原范围有效。工具测试覆盖中文/emoji、多层 JSON 不重复计数、历史改写、未知项、错误布局、分组顺序及 CLI 编码/脱敏。合成 usage 不进入分账。

验证通过：先新增测试确认模块缺失失败；编码反例确认错误接受损坏文件，再修正为拒绝；最终7项工具测试通过。完整 `npm run check` 通过（后端2916通过/22跳过、Web487、console59、效率脚本442，及其余前置/契约检查）；`npm run format:check`、链接及 `git diff --check` 通过。产品能力、P122 质量失败/效率未验收及部署状态均不变；本批仅工具和文档，无需替换正式服务进程。
