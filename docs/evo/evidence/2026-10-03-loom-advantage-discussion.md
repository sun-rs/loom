# P96：Loom 优势无人值守讨论

## 结论：流程与内容分别判断

**本次无人值守接力完成，但不是零额外开销，也不证明协作稳定性或效率达标。** Human 只发一次开场，无救场、无补跑、无提示词中途修改。三个实例发布四条回复，接力 Sol B → Astra → Sol A → Astra，总结后不再点名；空闲90秒自动结束。6个Run、6个Activation全部完成，各只执行一次，0自身Inbox、0用量缺口、0链上限拦截，结束后无排队或运行。没有达到12 Run或25分钟上限，未发SOS。

**讨论有价值，但不是优势的实证。** 初始“账本才是与Raft的差异”被Astra纠正：复用台账明确未获得Raft Server源码，不能推论对方没有同等事务保证。Sol A随后承认这个边界，指出最难补齐的是完成确认、因果写入、逐消息消费证明与安全去重，而非保存Markdown。最终结论：Loom潜在价值是减少长期、多次交接和故障恢复时的人工管理；短程有人协调时herdr+box可能更划算。判断正确性和跨provider本身不是独占优势，需要同质量下的人工介入、漏接/重做、完整成本来验证。

## 代码与配置

起始evo HEAD `b26054b`且工作树干净；产品构建未改。批准表和AGENTS同步增加Codex `gpt-6-sol/low`、`gpt-6-astra/low`，日期2026-10-03，不动禁止模型/强度规则。新增 `scripts/acceptance/loom-advantage-discussion.mjs`，先dry、再唯一一次paid。新建角色与实例的实际handle来自API，不猜名字；三个模型全量预检后再实例化。证据存在时拒绝再次付费，正式数据库只读取证；写业务数据仅经认证客户端。

只读目录是用途约束，不是OS沙箱：运行CLI仍为full-access。本次原生工具记录为读取资料与Worker发帖/确认，未观察到文件修改；未对整个reviews目录做前后哈希，不宣称强制只读隔离。

## 真实运行与逐轮用量

- 频道：`room_242c2d4a-1443-4555-b0f3-37ca6c0e4bea`，名称 `e2e-discuss-20261003t051608z`。
- 2026-10-03 13:16:08–13:19:23（Asia/Shanghai，含90秒结束观察）。最后回复13:17:51，约103秒从开场到结论。
- 2×Codex gpt-6-sol + 1×gpt-6-astra，全部low；原生CLI 0.158.0。6/6原生 `turn_context` 核对模型/effort，6/6原生用量与Kernel逐Run精确相等；3实例各保持自己的session（Sol A两轮、Sol B一轮、Astra三轮）。
- 合计 **23次模型生成，557,151累计输入，467,584缓存输入，89,567未缓存输入**。这是多次请求相加，不是单次上下文大小；没有原生/Raft/herdr同题对照，不计算效率倍率、美元估价或§6通过。

| RunAttempt                               | 实例 / 模型（全low） | 生成 |    输入 |    缓存 | 未缓存 |     秒 |
| ---------------------------------------- | -------------------- | ---: | ------: | ------: | -----: | -----: |
| run_7f95a7f4-6e66-4a15-a78a-81e6d3900b27 | astra / gpt-6-astra  |    6 | 137,793 | 107,520 | 30,273 | 72.162 |
| run_69e3b855-9f77-43be-8a16-018d303ea33c | solA / gpt-6-sol     |    7 | 161,430 | 132,736 | 28,694 | 46.758 |
| run_34c71dd2-f3aa-4c48-af8a-8af3b023a172 | solB / gpt-6-sol     |    4 |  75,793 |  51,456 | 24,337 | 29.787 |
| run_a004eed8-74a9-4b90-9917-c3d7eb262887 | astra / gpt-6-astra  |    2 |  60,794 |  59,392 |  1,402 |  8.599 |
| run_eb05afe7-9f13-473c-933a-f30f6370753d | solA / gpt-6-sol     |    3 |  90,358 |  86,016 |  4,342 | 17.739 |
| run_9dc132df-e103-46db-ad86-237e6b369d73 | astra / gpt-6-astra  |    1 |  30,983 |  30,464 |    519 | 15.777 |

## 未闭合的开销与行为

1. **额外只读运行确认存在**：Astra首轮已在hold异常中读到Sol B的#21，修订并发布#28；随后#21对应排队Activation仍领取 `run_a004eed8…`，仅message-check，2生成/60,794输入/1,402未缓存，无新帖。这不是同Activation重试，也不是自唤醒；是不同Activation的重复信息确认。是否可由现有精确取消条件安全消除，需要另刀诊断，本轮不改Kernel。
2. **held不是两条都补发成功**：Astra旧稿修改后发布#28；中间误把`--final`与`--revise-draft`并用，收到`INVALID_ARG`后自行去掉覆盖参数。Sol A首轮hold后check并结束，旧稿未发；之后收到Astra的#28，再发#43，替换并丢弃旧稿。账本两条draft最终replaced/revised不等于两条原稿都送达。没有遗留held，但不能据此证明任何held都会自动恢复。
3. **命令使用开销**：Sol A先尝试不带turn的`message-post --help`，被`TURN_HANDLE_REQUIRED`拒绝，之后改用help。Astra另有上述修订参数错误。未见轮内反复轮询等同伴：两次check分别为hold后确认和后续重复通知确认。
4. **300字约束未严格满足**：按Unicode字符（含引用、标点、handle）四帖407/304/300/310，三条超过300；去掉@handle仍有354/251/247/310，两条超过。仅汉字数均低于300，因此报告计数口径，不把汉字计数当作完整遵守。

## 内容审阅与证据边界

- 核实了引用的AGENTS因果链及不变量、目标合同§3和复用台账:19（未取得Raft Server源码）。`2026-10-03-backend-closeout-task-brief.md:94`确实撤回删除防护的要求，支持“herdr协调下也能纠错”，不证明哪种平台必然判断更准。
- P65旧对照512,918/112,764的数字引用准确，但属于历史失败样本，不能冒充当前版本成本倍率。三方最终承认未测协调者成本。
- 讨论主要围绕Loom与herdr，Multica没有深入的当前行为逐项对比；没有核实最新Raft/Multica线上功能。偏重文档合同，未独立复现所有声称的可靠性保证。共享相同材料和厂商可能形成同源偏见。
- 接力没有断裂；但“无人值守本次完成”不等于三个实例充分辩论或全部接受共识。Sol B仅发一帖，最终由Astra归纳，不能称三方逐一签字。

## 部署与数据

本轮只改测试/批准配置/证据文档，没有改产品代码、重启或迁移。正式4176新增1频道、3 Role、3实例、1 Human消息和4实例消息、6 Run；保留为验收历史，没有清理用户数据或更改其他频道。频道自然空闲，后续若用户发言仍可唤醒（本批授权已结束，驱动不会补跑）。

## 与任务书不符的事实、未覆盖

- 任务书称本机不存在gpt-6.1-sol：执行时本机Codex缓存已包含它，但正式host.runtime.list仍未发布。遵照任务书只用gpt-6-sol，不扩大授权。
- reviews 下同时有 brief.md 与 revise*-prompt.txt，材料目录按要求提供；原生记录显示实例使用搜索和截断读取，并非逐份精读全部15份材料，不宣称全面覆盖。
- 未跑效率门禁、浏览器门禁、故障/重启恢复、其他CLI、长期讨论或对照组；未证明Raft/Multica缺少同等能力。本次无需部署重启。
- 上限由2秒只读轮询发现后发SOS，存在并发采样竞态；本次6/12未触顶，未验证硬上限/超时分支。不是Kernel原子预算。

## 原始发言（Room账本）

### #8 Human

@disc-sol-a-20261003t051608z-a8c849dbb9dd2c278569c9b5 @disc-sol-b-20261003t051608z-4f6247acbdf82a2e5f921231 @disc-astra-20261003t051608z-0de84be7ac282e00fc8f7a1d 请讨论：Loom 的优势究竟是什么？与 Raft、Multica 等跨 provider 多 Agent 项目，以及 herdr 互传、herdr + 简易 box 相比，增量价值是什么、代价是什么？
材料：/Users/sun/Code/repos/rah_os/AGENTS.md、docs/evo/target-contract.zh-CN.md、docs/evo/status.zh-CN.md、docs/evo/herdr-loom-value-2026-09-30.zh-CN.md、docs/evo/token-root-cause-raft-dm-2026-09-30.zh-CN.md、docs/audits/ 下 Raft/Multica 复用台账；/Users/sun/.loom/reviews 下负责人用 herdr 中枢驱动 Codex 的任务书和修订稿，可作为实际协作成本的一手材料。
每次发言只 @ 下一位应回应者；要所有人回答用 @all；达成结论时给出结论且不再 @ 任何人。Human 只发本次开场，之后旁观。只读，不修改任何文件；每次发言不超过300字，用中文。给文件与行号依据，区分确认与推测。

### #21 solB

@disc-astra-20261003t051608z-0de84be7ac282e00fc8f7a1d 我认为增量价值是“可恢复的协作账本”：Room→Inbox→Activation→RunAttempt→显式动作是权威链，原生 session 只作执行上下文（AGENTS.md:65-73）；定向唤醒、私聊隔离和共享记忆有明确合同（target-contract:39-49,74）。Raft/Multica 的驱动能力已有可复用部分，账本才是差异（复用台账:19,33-35,50-51）。但价值尚未兑现：一次双 Codex 对照中 Loom 未完成预定接力，累计输入 512918 对 herdr 112764，且协调者时间未计（herdr-loom-value:14-16,23-30,38-42）。推测：简易 box 若补足可靠收件、结束与恢复，可能覆盖多数日常场景；需用同题端到端介入时间验证。

### #28 astra

同意，但“有账本”不能推成“优于 Raft”：复用台账:19 明说未取得 Raft Server 源码，无法断言对方缺少事务保证。
确认：herdr 已有有效纠错，Codex 实验促使负责人撤回删除防护的要求（/Users/sun/.loom/reviews/2026-10-03-backend-closeout-task-brief.md:94）。判断质量不是 Loom 独占价值。
推测：增量是把接手、去重、恢复从协调者记忆变成可检查状态；代价是协议与维护成本。@disc-sol-a-20261003t051608z-a8c849dbb9dd2c278569c9b5 简易 box 最难补齐哪项保证？

### #43 solA

最难补的是“何时可确认完成并安全去重”，不是存消息。确认：Loom 要求原子写事件/投递、按因果游标拦截过期回复；唤醒或进程退出不算已读，Activation、Inbox、Task 各自结算（AGENTS.md:226-235）。重复通知仅凭同实例同 session 的逐条读取及成功发帖等证据取消（target-contract.zh-CN.md:47）。简易 box 若没有这些状态，崩溃或忙时交错后易靠人工判定漏接、重做；这是推测，尚无同条件实测。Raft 是否已有同等保证不能据此否定。@disc-astra-20261003t051608z-0de84be7ac282e00fc8f7a1d

### #51 astra

结论：Loom 的可核实增量，是将投递、接手、完成与恢复纳入统一且可追责的状态，而非跨 provider 本身（AGENTS.md:65-73；target-contract.zh-CN.md:47）。这也不能证明 Raft/Multica 缺少同等能力。
代价是协议选择、额外模型请求及维护负担；已有对照未证明更省心，协调者成本还未计入（herdr-loom-value:5-16）。
推测：短程、有人看管的协作，herdr+简易 box 可能更划算；长程、多次交接和故障恢复才可能体现 Loom 收益。是否继续投入，应以同题、同质量下人工介入时间、漏接/重做次数和完整成本验证，不能只看 Agent 数量或接力成功。

逐Run、原生核账、Activation、草稿、事件与诊断见[JSON证据](2026-10-03-loom-advantage-discussion.json)。自动检查见下节。

## 自动检查（不能合并为“全部通过”）

- `node --test scripts/cli-efficiency/approved-models.test.mjs`：先确认新批准组合被拒绝的红测试（1失败/2通过），更新双表后3/3通过。
- `node --test scripts/acceptance/loom-advantage-discussion.test.mjs scripts/cli-efficiency/approved-models.test.mjs`：5/5通过。
- 第一次 `npm run check`：**退出1**。packages 2780项（2758通过、22跳过），Web487、console59均通过；最后CLI门禁236项有3失败，原因是drift-config/efficiency-config/guarded-shim旧负例仍用本次获准的gpt-6-sol/low。只将这3个负例换成仍未批准的gpt-6.1-sol/low，保留全部拒绝断言和守卫实现。
- `npm run test:cli:efficiency:unit`：修正后236/236通过。
- 第二次完整 `npm run check`：**退出1**。packages 2780项（2757通过、1失败、22跳过），后续Web等阶段因串行命令失败未再次执行。失败为 `packages/agent-host/test/instance-prewarm.test.ts:1009`：“a real start waiting on a prewarm slower than its lease keeps the lease renewed and takes the runtime over”，结果failed而非completed，原因文本为lease maintenance failed / does not own a valid lease。该代码本批未修改，第一次全量通过，第二次失败。
- `node --test --test-name-pattern='a real start waiting on a prewarm slower than its lease' packages/agent-host/test/instance-prewarm.test.ts`：单独1/1通过。夹具lease400ms、续租50ms、等待1200ms；表现具有时序相关性，**根因未定位，不能以单测通过覆盖全量失败，也不宣称已修复**。本刀不改Kernel/Host，不为凑绿放宽断言。
- 报告链接、JSON核账一致性、单Human/无重试/无自身Inbox及凭据模式扫描通过。
- `npm run format:check` 与 `git diff --check`：通过（退出0）。本报告最后更新另经Prettier复核。

**遗留风险：本批没有一次完整check全绿，预热续租测试仍需另行定位。** 这不改变本次正式服务讨论的账本结果，但禁止将本批标记为“全部自动检查通过”。正式服务预热仍关闭，本批未更改该设置。未运行浏览器验证，也未部署新产品代码。
