# Raft 对齐工程：从逐个抓缺陷改为机械可检的收敛

批次日期：2026-09-09。覆盖提交 `30f41fb` 至 `ec796fc`。

## 缘起

用户裁决：**第一步复刻，第二步在使用中再改，第一步不许自建逻辑。** Raft 是已发布的付费产品，提取源码就在磁盘上，
行为应当照着读，而不是从官网推断再用提示词补。此前一周的缺陷全部来自后者，而且只能靠付费真实模型运行才发现，
成本高、发现慢、且永远不知道还剩多少。

## 做法：先造尺子，再改东西

三份只读盘点对着授权提取物逐条比对 Agent 面：
`docs/product/raft-parity-cli-surface.zh-CN.md`（90 个子命令、75 条路由）、
`raft-parity-prompt-sections.zh-CN.md`（29 段 prompt、53 段 RAH 自研文字）、
`raft-parity-output-errors.zh-CN.md`（输出流、错误码、默认格式）。

随后把三份文档变成构建时的仪器 `scripts/raft-parity-registry.mjs` + `docs/product/raft-parity-registry.json`，
接进 `npm run check`。它强制四件事：

1. **覆盖**：worker 的每个 CLI 子命令与每条 HTTP 路由都必须登记，凭空多一个命令就构建失败。
2. **判定纪律**：判"有理由偏离"必须从封闭枚举里点名本地约束（无中心 Server、本地凭据、SQLite 账本、Activation 围栏、
   单机、已裁决延期），写散文不通过。
3. **证据分级**：每行标注 `client-contract` / `cli-behavior` / `server-inferred`。**我们手上只有 raft-computer，没有 Server**，
   所以依赖 Server 行为的断言既不能判 RAH 有罪也不能替它开脱，必须落入 `undecidable`。
4. **流向规则**：上游自己的约定是"渲染结果走 stdout，抛出的错误走 stderr"。任何一行声称已对齐却两侧流不一致，构建失败。
   这条专门针对本周最严重的缺陷类别。

棘轮只降不升，改法与仓库既有的源码规模棘轮一致。

## 已完成的对齐批次

| 批次 | 内容 | 棘轮 |
|---|---|---|
| `74faff8` | 15 个 Task 命令的游标与幂等键改为服务端派生；返工轮次的键陷阱从 prompt 移入内核 | 104 → 100 |
| `7441f55` | 任务按 `--target '#channel' --number N` 寻址；`[task #N status=…]` 后缀进入 Agent 读到的所有投影 | 100 → 98 |
| `00723e3` | 证据分级与 `undecidable` 判定（纯记账，零移动） | 98 → 98 |
| `1905be9` | 其余 8 类命令的协议负担；`room-read` 分页的签名回执改为服务端冻结窗口；`profile-update` 的乐观并发改为服务端解析 | 98 → 80 |
| `277bd23` | 错误码体系与四条危险输出路径 | 80 → 80 |
| `273f462` | 补登记输出面 139 行并加流向规则（记账，债务显性化） | 80 → **168** |
| `976d3fd` | 读命令家族改为 Raft 的文本渲染 | 168 → 155 |
| `d28363e` | 补 7 段缺失的上游 prompt；删净 12 条自研判断规则 | 155 → 143 |
| `ec796fc` | Agent 可发起私聊 | 143 → 142 |

判断段落棘轮已钉在 **0**：以后再出现一条替模型做判断的自研规则，构建立即失败。

## 三个值得记住的判定

**数字变大不等于退步。** 补登记输出面让无理由偏离从 80 涨到 168。那 88 条债一直存在，只是闸看不见——而本周最严重的缺陷
（hold 写在 stderr 而 Raft 写 stdout，导致真实模型丢掉自己的回复）正在那一面。加了独立子棘轮，防止新债藏进总数。

**重新判定必须拿证据，不能为了好看。** 用户提出"本地一体架构逼出来的差异该判有理由"，这个假设合理，但逐行核对后
**零行移动**：登记表比较的是 Agent 面（命令名、参数名、输入方式、寻址、谁扛游标），这一面由客户端合同与 CLI 钉死，不依赖 Server。
看着像架构约束的行都被逐条否掉，例如 `room-read` 的回执其实是 Raft 的 CLI 本地状态被推给了 Agent，而 `d38e3f9` 已经证明
同一份状态可以放进 RAH 自己的 daemon。

**能力问题去 Raft 取证，不是产品决定。** 私聊那条我一度想推给用户裁决，被纠正。三层证据一致：合同里 `resolveChannel`
的 capability 是 `send` 且描述为"为 agent 凭据解析可写的频道、DM 或 Thread 目标"；出厂 prompt 两个变体都写着
`Start a NEW DM`；冻结的官网 bundle 有 `message.forwardComposer.newDm`。所以 RAH 那句"只有 Human 能开私聊"是自研限制。
补齐时 ACL 也是复用既有规则（与 Agent 同处一个 Room 的成员，正是 `@mention` 解析在用的那条），不新发明。

## 核心链现状

Room 会话、@mention、Thread、任务寻址与生命周期、Agent 配置与角色、记忆均已对齐并有确定性回归；私聊的读、发、发起本轮补齐。
三条确定性链每批都跑三次：`agent-task-split-chain`、`busy-hold-recovery-chain`、`presented-context-second-activation`。

## 正式实例

Web build `b8bca7607027af17d453679e0af95160f46b839167f78abf19de7da05cc074d5`，备份
`~/.rah/backups/pre-restart-aad3a816-8e87-4b94-8814-588d753f8829` 已验证，后继 6 秒上线（pid 29526）。
6 Rooms、43 Messages、2 Tasks、4 Agent 定义、210 个记忆文件**完全不变，且未产生任何新事件**——
以往重启会写入 `agent.revised` 把新 prompt 冻结进 Agent 定义，自 `48c5c57` 起 prompt 每次启动编译投递，这类写入已消失。
三张新表 `worker_target_read_positions`、`worker_target_context_windows`、`worker_self_profile_observations` 均已建立。

## 剩余

无理由偏离 142、非延期缺失 63、输出面 75。主要构成：格式翻转还有 46 条（任务变更类命令、attachment/artifact 家族、
reminder 六件、profile、message-search）、20 条错误码缺恢复指引、若干命令签名的机械差异。这些已不是行为风险，是一致性工作。

按 Runtime 区分的忙时投递（Raft：Claude gated、Codex/Kimi direct、OpenCode none）与 Raft 的长驻会话加 inbox 进程模型
仍未对齐，是剩下唯一的架构级项目，建议核心链干净且有真实使用数据后再单独立项。
