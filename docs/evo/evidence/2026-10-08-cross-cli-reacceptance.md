# 2026-10-07—08 多 CLI、多模型重新验收

**当前不能宣布 Loom 整体验收或整体效率达标。** 本批已取得跨 CLI 的不同结果：Haiku 在固定事实短答的连续会话中接近原生；OpenCode 两个绑定仍有持续的额外生成。Codex 认证阻断、Kimi 用量缺口和 Sonnet 重试归属证据缺口分别记录，不能由其他模型代验。

用户已授权本轮多 CLI、多模型付费验收，无须逐次询问。测试只用批准组合及临时状态，未更改账户、正式数据或产品行为。产品源码仍为 `630ca56`；门禁先后为 `8884f2b`、`cdc2ef9`。旧失败和全部已知消耗保留，未知成本不记零。正式服务未重启，本文不是新部署凭据。

## 持续会话配对结果

三实例各保持一个原生 session，每人十二轮，单臂共三十六阶段；共同固定材料首次提供，以后只传增量与实际同伴答复。原生官方自动记忆按已验证机制关闭，正常会话历史保留。双方模型/effort相同。v2四组均产品先运行，属于每绑定一组观察，存在顺序、缓存和模型随机性限制。

| CLI / 批准绑定                              | 正确答案，原生 / Loom             | 生成数，原生 / Loom | 累计 input，Loom / 原生 | uncached input，Loom / 原生 | 当前结论                                                                 |
| ------------------------------------------- | --------------------------------- | ------------------- | ----------------------- | --------------------------- | ------------------------------------------------------------------------ |
| Claude haiku / 无 effort                    | 36/36 / 36/36                     | 36 / 37             | 1.097                   | 1.426                       | A 首轮恢复使该实例合同超预算，B/C 在样本内通过；不能判整批全部通过       |
| OpenCode deepseek/deepseek-flash / low      | 36/36 / 36/36                     | 36 / 73             | 2.866                   | 3.064                       | 三实例均超预算                                                           |
| OpenCode aihubmix/deepseek-v4.1-flash / low | 36/36 / 36/36                     | 36 / 73             | 2.885                   | 2.997                       | 三实例均超预算；两个 OpenCode 绑定不等于两个独立模型家族                 |
| Claude sonnet / low                         | 原生未启动 / 首阶段恢复后正确发表 | 未运行 / 2          | 未建立                  | 未建立                      | 两次 cold Run 无逐 Run 原生输入标识，门禁停止；完整已知 input 44042 保留 |

这些是 token 指标，**不是账单倍率**。output也完整保存：Haiku 原生2107/Loom5869，DeepSeek1941/5828，aihubmix2026/7093；包含 provider 报告的推理部分，不能用可见答案字数替代。合同判断复用现有 §6 比较器，未调整预算。

三个完整配对的全部已报告用量已逐条与原生记录及持久账本核对，缺口为零；每批产品三十六条唯一消息、对应成功发布和同 consumer ACK 已独立检查，每臂三个 session 连续。正确性是十二道固定源码事实题的预注册答案，参与者能看到实际同伴回答；不证明独立审查价值、复杂开发质量、多日可靠性或通用模型胜负。

## 额外消耗发生在哪里

OpenCode 两绑定均实际使用 Worker CLI 发帖。每次成功发帖后都有一次新生成，分别消耗702812和708295 input，约占各自产品累计输入的一半。各另有一次首轮未发帖/未ACK导致的恢复。没有额外业务文件读取；不能把这些生成归因于不断重新读取文献首段，也不能仅凭它们断言所有后续生成理论上不可消除。

Haiku 实际使用 MCP。唯一额外生成用于修正首次调用缺少 `basedOnRoomSeq`：系统明确拒绝、未写入，模型在同一 Run 内修正成功。其余轮没有额外已报告生成；没有证据支持“所有 CLI 都需要每轮重复学习 MCP”。同时不能用没有额外 usage 证明上游绝未启动请求或费用为零。

产品材料在正常续轮没有重新注入。两个 OpenCode 样本各在首次未交付后的重试中多投一次材料，全部消耗保留；不能把它隐藏为首轮固定成本。历史、工具调用和回执仍属于原生 session 上下文；不重复从 box 取旧材料，不等于后续生成不携带已有上下文。

本批不是压缩前/后的同模型配对消融，不能断言“减少 prompt 导致费用增加”。它证明当前实际路径有明显 provider 差异，字节缩减不能替代真实生成数、完整用量和质量验收。

## 基础矩阵与漂移

已尝试四家 CLI、八个批准组合。版本为 Codex0.160.1、Claude2.1.287、Kimi0.39.1、OpenCode1.18.32。Codex gpt-6-luna/low 与 gpt-5.6-luna/low 均在原生首轮认证刷新失败；不是模型业务失败，也未改账号。Claude 两个全局别名原本指向 Kimi，预检在付费前拒绝；仅在测试进程隔离别名、保持既有连接后运行。

三轮同题代码审查的原生/冷/热 input 比：Haiku 1.270/1.805，Sonnet 0.979/0.977，OpenCode DeepSeek 1.487/1.181，aihubmix 2.269/2.319。全部旧综合门禁仍超预算；各臂工作路径和回答质量并不相同，不能作为等质费用结论。独立复核保留48份回答，区分真实事实错误、条件不足与建议未来加固；不把事后人工分类当预注册统计评分。

Kimi k3-256k/low 与 k3/high 的三轮产品回答已送达，但分别有8次请求/5份usage、7次请求/4份usage：各三次取消请求费用未知。继续功能验收，但不能发布完整成本比，也不为重新证明已知缺口追加长成本测试。

OpenCode 两绑定各十二轮漂移：各八次应回复均发表并ACK，四次应静默均静默，附加文件读取及强制压缩被观测到；各有两次字数违规、一次retry、零实际final marker。原报告 `finalPosts=8` 是待检查数量，不能解释成八次final成功。自然交付成立不代表旧显式final门禁通过。

## 未被替换的失败与方法修正

第一批 natural-v1 四组未完成：Claude 冷会话证据错误依赖 warm runtime 行；OpenCode 原生 CLI 自动转义 positional argv，破坏逐字材料比较；另一个 OpenCode 样本发生恢复而 v1 不接受多次执行归属。旧结果及费用原样保留。v2 明确更换实验身份：冷会话使用权威绑定，OpenCode 原生显式stdin传入原文，多次执行用真实 native turn/工具回执关联，并保留每次重投与费用。严格旧门禁和 natural-v1 语义不变。

v2 Sonnet 仍缺少 Claude 重试时精确原生输入到 Run 的关联支持；实际第二 Run 已发表正确答案及可信marker/ACK，但不能追认为完整长对照。没有凭时间窗猜测后继续，也没有追加付费重跑来挑成功样本。

## 当前功能、页面与合同偏离

本轮实际完成三家私聊交付；Claude 忙时私聊排队、同 session 延续成立，Kimi/OpenCode 读取另一实例私聊均实际返回404且未披露正文。OpenCode 原始门禁停在合法 `dm:@owner` 参数解析，离线回执/唯一消息/ACK核对确认已交付，原失败不改。Claude 显式共享记忆创建与修订成功，Kimi真实读取 revision2 正文并回复；Kimi首次错用参数后纠正，最终表述有矛盾，不判完整质量通过。服务器中断后的续验复用原临时数据和session、单独记录执行时间，未重复写入。OpenCode 自动更新到1.18.35，版本守卫正确阻断，因此拒读/恢复未验证，不能将旧版验证移植到新版。Claude随后预检也已更新至2.1.293，未绕过2.1.287的审计边界。后续独立业务功能转用两个Kimi实例，不称跨CLI证据。已经保留的混合频道样本证明三家初始 Run 并行重叠6.953秒，所有五个 Run 的消费ACK成立。模型擅加 `@all` 导致额外两次激活，不是平台凭空重复消费；这次不算指令遵循通过。另一接力夹具在 Human 题面同时提及两实例，按合同直接唤醒两者，无法证明串行接力，失败保留。

新 Channel 的实例仍可显式配置 `existing_mount`，绕过合同 §2a 的频道 home。旧 main 文档不能作为例外授权；默认 home 通过也不能覆盖此分支。当前只登记偏离，未迁移既有 cwd/session 或修改产品。

全量 `npm run check`、格式和diff检查已通过，v2源树与独立检查工作树完全相同；浏览器构建、桌面/手机 Role、Role活动及console浏览器门禁通过，使用临时状态和Fake CLI。正式服务新页面HTTP200、无pageerror，检查为只读，未把它当全部交互验收。前端和产品源码未改，正式部署保持原版本。

最后的双 Kimi 独立批次仅第一实例实际运行，第二实例没有执行，不能称两实例协作通过。实际完成 Task 认领、开始、进度和提交，以及唯一普通最终回复。夹具只排除了自动提交消息，漏排自动进度消息，误判重复而停止。保留原失败；1 Run 已知 input180388/cached171520/output709，Kimi缺1份usage，完整费用未知。Human完成、跨实例附件下载、本轮重启后恢复未执行。免费API已经覆盖Task与附件状态，但不能替代真实模型路径。两实例初始化曾因重复cliId在进程启动前失败；零Run的准备失败亦保留。

此次重新验收的不足也包括验收工具自身：连续几次合法业务行为触发过窄断言，导致独立功能被提前截断。因此不能宣称“全部当前能力重新验收完成”；能给出的是已核实结果、真实缺口与明确未覆盖清单。没有通过重复成功样本抵消失败，也没有把未执行算通过。

## 证据索引

- [基础八组合与漂移审计](2026-10-08-cross-cli-reacceptance/base-and-drift-audit.json)
- [Haiku长期](2026-10-08-cross-cli-reacceptance/haiku-long-audit.json)、[OpenCode DeepSeek长期](2026-10-08-cross-cli-reacceptance/opencode-deepseek-long-audit.json)、[OpenCode aihubmix长期](2026-10-08-cross-cli-reacceptance/opencode-aihubmix-long-audit.json)、[Sonnet未完成](2026-10-08-cross-cli-reacceptance/sonnet-incomplete-audit.json)
- [第一版长测原失败及成本](2026-10-08-cross-cli-reacceptance/long-v1-incomplete-attempts.json)、[原始结果哈希](2026-10-08-cross-cli-reacceptance/long-result-hashes.json)、[原生证据保全清单](2026-10-08-cross-cli-reacceptance/long-preservation-manifest.json)
- [早期功能样本](2026-10-08-cross-cli-reacceptance/early-functional-attempts.json)、[私聊](2026-10-08-cross-cli-reacceptance/private-box-audit.json)、[共享记忆续验](2026-10-08-cross-cli-reacceptance/memory-recovery-audit.json)、[最后Task样本](2026-10-08-cross-cli-reacceptance/task-audit.json)
- [确定性检查与页面边界](2026-10-08-cross-cli-reacceptance/checks.json)、[方法限制](2026-10-08-cross-cli-reacceptance/methodology.json)、[功能夹具哈希](2026-10-08-cross-cli-reacceptance/functional-fixture-hashes.json)

## 收口判断

不能宣布整体完成，也不应继续以减少字节代替成本收口。先修正功能验收对合法业务事件的分类，避免继续浪费付费样本；产品侧优先处理有实证的 OpenCode 发帖后生成路径、Kimi 用量缺口和新频道目录合同偏离；Codex 认证恢复后才有当前版本付费结论，Sonnet需要精确重试证据支持。已有安全屏障和明确Room写入不可为了省一次生成而放松。

本批保存代码、原始失败、来源哈希和限定范围。后续若测实现改动，需新的预注册同模型对照；不改写本批，不凭个别好运气宣布长期稳定。
