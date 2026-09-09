# Raft Agent 面向命令面差异清册

日期：2026-09-09。**这是只读盘点，不是工单，也不是施工完成报告。**
盘点期间未修改任何源码、测试或行为，未跑门禁，未调用任何付费 CLI。

## 1. 口径

### 1.1 比较对象

只比较 **Agent 面向的表面**：Agent 在 Run 里能敲的命令名、参数名、输入方式（stdin/heredoc、
位置参数、选项）、目标寻址语法、是否被要求自带因果游标或幂等键，以及命令是否存在。
不比较服务端实现、存储结构、渲染、前端，也不比较 Agent 看不见的内部字段。

### 1.2 上游取证（授权提取）

- **U1**：Raft Computer `1.0.18` 完整 bundle
  `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`。
  SHA-256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，34,981,487 字节。
  CLI 命令定义集中在字节区间 `32,500,000`–`32,780,000`；本文以 `main.js@<字节偏移>` 引用。
  程序注册点在 `main.js@32760909`（`"src/main.ts"`），逐条 `program.command(...)` 与
  `registerCliCommand(...)` 可读。命令规格来自 `defineCommand({ name, description, arguments, options }, handler)`。
- **U2**：一方源码切片
  `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/packages/shared/src/agentApiContract.ts`。
  SHA-256 `ce9db68aff56f34e56186cc8332d9b1dae74196422f113353de0a288915cf4db`，2,092 行，
  `agentApiContract` 起于 1331 行，**75 条 `route({...})`**（其中 `integrationAppRotateSecret`
  在 1925–1940 行夹注释）。
- **U3**：预提取函数
  `/Users/sun/Code/reviews/rah_os/2026-09-09-raft-upstream-refresh/sea-functions/`，
  本文引用 `handleMessageSend-0.js`、`getConsumedSeq-0.js`、`recordConsumedRead-0.js`。

### 1.3 RAH 侧取证

- `packages/agent-host/src/worker-cli.ts`（1,503 行，`help()` 在 1425 行起，主 `switch` 在 601 行起）。
- 子解析器：`worker-read-cli.ts`、`worker-channel-attention-cli.ts`、
  `worker-self-profile-cli.ts`、`worker-task-management-cli.ts`、`agent-app-config-cli.ts`。
- `packages/application-service/src/worker-application-service.ts:196-238`（`WORKER_HTTP_ROUTE_PATHS`）
  与 `packages/application-service/src/worker-read-handler.ts:9-24`（`WORKER_READ_ROUTE_PATHS`）。
- `packages/daemon/src/standing-prompt-compiler.ts`（仅用于确认常驻提示实际教了哪些命令）。

### 1.4 Raft 命令族总数（纠正口径）

`main.js@32760909` 处实际注册的顶层入口共 **21 个**：
`version`（`registerVersionCommand(program)`）、`auth`、`agent`、`channel`、`thread`、`server`、
`user`、`manual`、`knowledge`（`manual` 的遗留别名）、`inbox`、`message`、`attachment`、`task`、
`mention`、`profile`、`integration`、`reminder`、`app`、`wiki`、`migrate`、`action`。
子命令共 **90 条**（含 `integration app` 与 `integration app prepare` 两级嵌套、
`agent login` 的 `start`/`wait`/`status`）。

### 1.5 判定定义

- `已对齐`：命令存在，名称语义等价，Agent 需要提供的参数集合与输入方式一致。
- `有理由偏离`：存在差异，且能指名本地强制约束（无中央 Server、本地授权、SQLite 账本、
  Activation 围栏、单机）。约束写在该行内。
- `无理由偏离`：存在差异但指不出上述强制约束。**包括 RAH 多出而 Raft 没有的 Agent 面向表面。**
- `缺失`：RAH 没有对应的 Agent 面向入口。属于已裁决延期范围的加标 `（已裁决延期）`。

---

## 2. 主表

### 2.1 `version` / `auth` / `agent`

| Raft 命令/路由 | Raft 参数与输入方式 | RAH 对应 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `raft version` | `--json`；同时报告 CLI、daemon、Computer 三个版本 | `rah worker version` | 无理由偏离 | main.js@32534054 → worker-cli.ts:273-279（只回 carrier 包版本，无 daemon/Computer，无 `--json`） |
| `raft auth whoami` | 无参数；打印 env 解析出的 Agent 上下文，token 打码 | `rah worker whoami` | 已对齐 | main.js@32532747 → worker-read-cli.ts:13-19 |
| `raft agent login` | `--server --agent --client-name --profile-slug --profile-dir`（device-code 授权换 `sk_agent_*`） | 无 | 有理由偏离 | main.js@32542515 → 本地无中央 Server；凭证由 daemon 在 Activation 围栏内下发到 `RAH_WORKER_CLI`，Agent 不自助登录 |
| `raft agent login start` | 打印浏览器交接后退出 | 无 | 有理由偏离 | main.js@32544240 → 同上（无中央 Server + 本地授权） |
| `raft agent login wait` | 轮询审批并落盘凭证 | 无 | 有理由偏离 | main.js@32545234 → 同上 |
| `raft agent login status` | 报告本地 profile 凭证可用/过期 | 无 | 有理由偏离 | main.js@32546459 → 同上；RAH 凭证生命周期由 Activation 授予与回收 |
| `raft agent list` | `--server --client-name`；列出可铸凭证的 Agent | 无 | 有理由偏离 | main.js@32537452 → 无中央 Server |
| `raft agent bridge` | 14 个选项的长驻 CommsCore 桥（`--wake-adapter`、`--wake-channel-endpoint` 等） | 无 | 有理由偏离 | main.js@32549824 → 单机 daemon 直接唤起 Run，不需要自托管运行时唤醒桥 |

### 2.2 `channel` / `thread`

| Raft 命令/路由 | Raft 参数与输入方式 | RAH 对应 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `raft channel info <target>` | 位置参数 `<target>`；返回存在性、是否已加入、描述、可见成员数 | 无（`room-resolve`/`room-read` 只近似覆盖，无 joined/描述/成员数窄事实） | 缺失 | main.js@32569969 → worker-read-cli.ts:68-74 |
| `raft channel members <target>` | 位置参数 `<target>`；无幂等键 | `rah worker room-members [--target TARGET] [--limit] [--cursor]` | 无理由偏离 | main.js@32566196 → worker-read-cli.ts:153-162（位置参数改选项，目标可省略默认当前 Room） |
| `raft channel create` | `--name --description --private`（需 server admin 授权） | 无 | 缺失 | main.js@32571946 → worker-application-service.ts:196-238 无对应路由 |
| `raft channel update` | `--target --name --description --public --private` | 无 | 缺失 | main.js@32573923 → 同上 |
| `raft channel archive` | `--target` | 无 | 缺失 | main.js@32577799 → 同上 |
| `raft channel unarchive` | `--target` | 无 | 缺失 | main.js@32578236 → 同上 |
| `raft channel add-member` | `--target --user @handle --agent @handle` | 无 | 缺失 | main.js@32578925 → 同上 |
| `raft channel remove-member` | `--target --user @handle --agent @handle` | 无 | 缺失 | main.js@32582309 → 同上 |
| `raft channel join` | `--target`；加入可见公开 Channel | 无 | 缺失 | main.js@32585664 → 同上 |
| `raft channel leave` | `--target` | 无 | 缺失 | main.js@32567512 → 同上 |
| `raft channel mute` | 仅 `--target`；无因果游标、无幂等键 | `rah worker channel-mute --based-on-room-seq N --idempotency-key KEY [--target --context-receipt]` | 无理由偏离 | main.js@32587811（`makeChannelMuteCommand("mute")`，选项复用 `channel leave` 的 `--target`）→ worker-channel-attention-cli.ts:8-31（两个必填因果参数） |
| `raft channel unmute` | 仅 `--target` | `rah worker channel-unmute`（同上必填） | 无理由偏离 | main.js@32587811 → worker-channel-attention-cli.ts:8-31 |
| `raft thread unfollow` | `--target '#chan:threadId'` 或 `'dm:@a:threadId'`、`--reason`（写进 Thread 内的退订提示）、`--reviewer-isolation` | `rah worker thread-unfollow --thread-id ID --based-on-room-seq N --idempotency-key KEY` | 无理由偏离 | main.js@32614526 → worker-cli.ts:778-791（丢 `--reason`，Thread 不用 target 语法寻址，多两个必填因果参数） |

### 2.3 `server` / `user` / `profile`

| Raft 命令/路由 | Raft 参数与输入方式 | RAH 对应 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `raft server info` | `--full --channels --agents --humans --joined --query --limit --offset`；默认窄事实 | `rah worker server-info [--target] [--limit] [--cursor]` | 无理由偏离 | main.js@32588457 → worker-read-cli.ts:153-162（无分区选择、无 `--query`、`--offset` 变 `--cursor`） |
| `raft server update` | `--name --avatar-file --json`（需 server admin） | 无 | 缺失 | main.js@32598694 → worker-application-service.ts:196-238 |
| `raft user info <name>` | 位置参数 `<name>`、`--limit --offset`；人或 Agent 的窄事实与可见 Channel 成员关系 | `rah worker profile-show --target ID\|@HANDLE [--channel TARGET]` | 无理由偏离 | main.js@32602483 → worker-read-cli.ts:163-183（并入 profile-show，位置参数改选项，分页改 cursor） |
| `raft profile show [target]` | 位置参数可省略，`--json` | `rah worker profile-show [--target] [--channel] [--created-agents-limit] [--created-agents-cursor]` | 无理由偏离 | main.js@32680193 → worker-read-cli.ts:163-183（位置参数改选项，多出 created-agents 分页） |
| `raft profile update` | `--avatar-file <path> --avatar-url --display-name --description --json`；头像一步上传 | `rah worker profile-avatar-publish --path --mime-type` **加** `rah worker profile-update --control-room-id --control-room-seq --expected-revision-id [--display-name] [--description] [--avatar-key] [--avatar-upload-intent-id] --idempotency-key` | 无理由偏离 | main.js@32593960 → worker-self-profile-cli.ts:8-45、worker-cli.ts:1448-1450（拆成两步，且要求 Agent 自带控制 Room id/seq、expected-revision-id、幂等键） |

### 2.4 `manual` / `knowledge` / `inbox` / `message`

| Raft 命令/路由 | Raft 参数与输入方式 | RAH 对应 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `raft manual get <topic>` | 位置参数 `<topic>`；`--intent --reason` 必填（12–500 字符）、`--turn-id --trace-id` 诊断 | 无 | 缺失 | main.js@32606525 → 无对应路由；RAH 用常驻提示 + `worker help` 顶替（standing-prompt-compiler.ts:113） |
| `raft manual search <keywords>` | 位置参数；`--scope recipes --intent --reason --turn-id --trace-id` | 无 | 缺失 | main.js@32609326 → 同上 |
| `raft knowledge get` / `search` | `manual` 的遗留别名，同参 | 无 | 缺失 | main.js@32769049 附近（`knowledgeCmd`）→ 同上 |
| `raft inbox check` | 无参数；只看有待处理的目标，不排空、不读正文 | 无 | 缺失 | main.js@32612662 → worker-application-service.ts:196-238 无“只窥不排空”入口 |
| `raft message check` | 无参数；排空 Inbox 并在返回前 ACK 已投递 seq | `rah worker sync [--after-seq N]` 与 `rah worker acknowledge --through-seq N` 两条 | 有理由偏离 | main.js@32620763 → worker-cli.ts:602-616；Activation 围栏要求 ACK 显式收口一次 Activation，不能由读取隐式完成 |
| `raft message send` | 位置 `[content...]` 或 **stdin heredoc**（分隔符 `RAFTMSG`）；`--target`（`'#c'`/`'dm:@p'`/`'#c:threadId'`/`'dm:@p:threadId'`）、`--send-draft --anyway --target-confirmed --json --attachment-id`（可重复）、`--reviewer-isolation`；`--content` 被显式拒绝。**无 `--idempotency-key`、无因果游标参数**：`seenUpToSeq` 由 CLI 本地 consumed-seq 状态推导 | `rah worker message-post --target TARGET <<'RAHMSG'`；`--send-draft --anyway --json --top-level/--thread-id --attachment-ids ID,ID --body --context-receipt --held-draft-id --based-on-room-seq --idempotency-key --comment-attachment-id` | 无理由偏离 | main.js@32618469、handleMessageSend-0.js:103-115、getConsumedSeq-0.js → worker-cli.ts:645-773（核心 heredoc/`--send-draft`/`--anyway`/stdout 已对齐；仍缺 `--target-confirmed`、`--reviewer-isolation`，`--attachment-id` 可重复变逗号串，多出 `--body`/`--context-receipt`/`--held-draft-id`/两个因果参数） |
| `raft message read` | `--target`（`--channel` 遗留别名）、`--before --after --around --limit`（纯十进制值＝seq，8 字符＝短 id） | `rah worker message-read [--target] [--before\|--after\|--around] [--thread-id\|--top-level] [--limit] [--cursor]` | 无理由偏离 | main.js@32622165 → worker-read-cli.ts:111-142（多出 Thread 选择器与 `--cursor`） |
| `raft message search` | `--query --target --channel --sender --sort relevance\|recent --before --after --limit --offset` | `rah worker message-search [--query] [--target] [--sender] [--sender-id] [--after] [--before] [--sort] [--limit] [--cursor]` | 无理由偏离 | main.js@32625232 → worker-read-cli.ts:82-110（无 `--channel` 别名与 `--offset`，多出 `--sender-id`/`--cursor`） |
| `raft message resolve <id>` | 位置参数 `<id>` | `rah worker message-resolve --message-id ID [--target TARGET]` | 无理由偏离 | main.js@32628031 → worker-read-cli.ts:143-152 |
| `raft message react` | `--message-id --emoji --remove`（布尔开关取反）；无因果游标、无幂等键 | `rah worker message-react --message-id --emoji --active true\|false --based-on-room-seq N --idempotency-key KEY` | 无理由偏离 | main.js@32629637 → worker-cli.ts:617-636（取反开关变必填三态字符串，多两个必填因果参数） |

### 2.5 `attachment`

| Raft 命令/路由 | Raft 参数与输入方式 | RAH 对应 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `raft attachment upload` | `--path --target --channel --mime-type`；**无幂等键**（`clientRequestId` 由 CLI 自己 `randomUUID()` 生成，main.js@32636930） | `rah worker attachment-publish --path [--target --context-receipt] [--filename] [--mime-type] --idempotency-key KEY` | 无理由偏离 | main.js@32632917 → worker-cli.ts:172-260、1469（幂等键与 `--context-receipt` 上抬给 Agent） |
| `raft attachment view [attachmentId]` | 位置参数优先，`--id` 为过渡别名，`--output` | `rah worker attachment-download --attachment-id ID --output FILE` | 无理由偏离 | main.js@32639716 → worker-cli.ts:467-539 |
| `raft attachment comments` | `--id --limit`（默认 200） | `rah worker attachment-comments --attachment-id ID [--limit N] [--before-room-seq N]` | 无理由偏离 | main.js@32641909 → worker-read-cli.ts:25-45 |

### 2.6 `task`

Raft 的 Task 统一用「Channel + 任务号」寻址（`--target '#channel' --number N`），乐观并发键是
`--expected-revision`，assignee 一律 `@handle`；**没有任何 Task 命令要求 Agent 提供因果游标或幂等键**。
RAH 一律用 `--task-id ID` 寻址，并对每条变更强制 `--based-on-room-seq` 与 `--idempotency-key`。

| Raft 命令/路由 | Raft 参数与输入方式 | RAH 对应 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `raft task list` | `--target --channel --mine --status all\|todo\|in_progress\|in_review\|done\|closed` | `rah worker task-list [--target] [--mine] [--status ...] [--limit] [--cursor]` | 已对齐 | main.js@32644760 → worker-read-cli.ts:184-197 |
| `raft task create` | `--target --channel --title`（**可重复，批量创建**）`--assignee @handle --creates-resource` | `rah worker task-create --title TEXT [--assignee PARTICIPANT_ID] --based-on-room-seq N --idempotency-key KEY` | 无理由偏离 | main.js@32646909 → worker-cli.ts:813-832（无批量、无 `--target`、无 `--creates-resource`、assignee 用内部 participant id 而非 `@handle`、多两个必填因果参数） |
| `raft task claim` | `--target --channel --number`（可重复）`--message-id`（可重复）`--reviewer-isolation` | `rah worker task-claim --task-id ID --based-on-room-seq N --idempotency-key KEY` | 无理由偏离 | main.js@32650444 → worker-cli.ts:849-850 |
| `raft task unclaim` | `--target --channel --number` | `rah worker task-release --task-id ID --based-on-room-seq N --idempotency-key KEY` | 无理由偏离 | main.js@32659612 → worker-cli.ts:853-854（命名与寻址都变） |
| `raft task assign` | `--target --channel --number --assignee @who --expected-revision N` | `rah worker task-assign --task-id ID (--assignee AGENT_ID \| --unassign) --based-on-room-seq N --idempotency-key KEY` | 无理由偏离 | main.js@32655245 → worker-task-management-cli.ts:66-110（assignee 用内部 id；乐观并发键从 `--expected-revision` 换成 `--based-on-room-seq`） |
| `raft task unassign` | 独立命令，`--target --channel --number --expected-revision` | 并入 `task-assign --unassign` | 无理由偏离 | main.js@32657475 → worker-task-management-cli.ts:66-110 |
| `raft task update` | `--target --channel --number --status <5 态之一> --reviewer-isolation`；单一状态置位 | 无单一状态命令；改为 `task-start` / `task-progress` / `task-block` / `task-unblock` / `task-request-input` / `task-submit` / `task-review` 一组固定流程命令 | 无理由偏离 | main.js@32661493 → worker-cli.ts:851-886、worker-task-management-cli.ts:91-98 |
| `raft task receipt` | `--target --channel --number --object --purpose --teardown-owner @agent --security-privacy --expiry ISO --runbook --tracking` | 无 | 缺失 | main.js@32664866 → worker-application-service.ts:196-238 |
| `raft task delete` | `--target --channel --number` | `rah worker task-delete --room-id ID --task-id ID --based-on-room-seq N --idempotency-key KEY` | 无理由偏离 | main.js@32669514 → worker-task-management-cli.ts:14-34（额外强制 `--room-id`） |
| `raft task convert` | `--target --channel --message-id` | `rah worker task-convert --message-id ID --based-on-room-seq N --idempotency-key KEY` | 无理由偏离 | main.js@32671600 → worker-task-management-cli.ts:99-110 |
| `raft task amend` | `--target --channel --number --title --description --clear-description --reviewer-isolation` | `rah worker task-amend --task-id ID [--title] [--description \| --clear-description] --based-on-room-seq N --idempotency-key KEY` | 无理由偏离 | main.js@32673468 → worker-task-management-cli.ts:35-65（字段语义一致，只多两个必填因果参数与寻址差异） |
| `raft task history` | `--target --channel --number` | `rah worker task-history --task-id ID [--target] [--limit] [--cursor]` | 无理由偏离 | main.js@32676771 → worker-read-cli.ts:198-215 |

### 2.7 `mention` / `action`

| Raft 命令/路由 | Raft 参数与输入方式 | RAH 对应 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `raft mention pending` | `--json`；列出发送侧待处理的 mention 动作 | 无 | 缺失 | main.js@32678741 → 常驻提示明确写“没有单独的 mention 命令”（standing-prompt-compiler.ts:144） |
| `raft mention notify` | `buildMentionExecuteCommand("notify")`；执行发送侧 mention 解析动作 | 无 | 缺失 | main.js `registerMentionExecuteCommands` → 同上 |
| `raft mention add` | `buildMentionExecuteCommand("add")` | 无 | 缺失 | 同上 |
| `raft action prepare` | `--target`（与 `message send` 同寻址语法）+ **stdin heredoc**（分隔符 `RAFTACTION`）；给 Human 提交的行动卡 | 无 | 缺失 | main.js@32562967、@32563266 → worker-application-service.ts:196-238 无 `prepare-action` |

### 2.8 `reminder` / `app`

| Raft 命令/路由 | Raft 参数与输入方式 | RAH 对应 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `raft reminder schedule` | `--title --delay-seconds --fire-at --repeat --tz --channel --message-id`（`--msg-id` 遗留别名）；无因果游标 | `rah reminder schedule --title (--delay-seconds\|--fire-at\|--repeat) --message-id --based-on-room-seq N [--channel] [--tz]` | 无理由偏离 | main.js@32734968 → worker-cli.ts:900-968（多一个必填 `--based-on-room-seq`；无 `--msg-id` 别名） |
| `raft reminder list` | `--all --status scheduled,fired,canceled` | `rah reminder list [--status ...\|--all]` | 已对齐 | main.js@32737578 → worker-cli.ts:969-985 |
| `raft reminder cancel` | `--id`（完整 uuid 或 8 字符前缀） | `rah reminder cancel --id ID` | 已对齐 | main.js@32739703 → worker-cli.ts:996-1005 |
| `raft reminder snooze` | `--id --by 30m` | `rah reminder snooze --id ID --by 30m` | 已对齐 | main.js@32741344 → worker-cli.ts:1006-1016 |
| `raft reminder update` | `--id --fire-at --in --cadence --title` | `rah reminder update --id ID (--in\|--fire-at\|--cadence\|--title) [--tz IANA]` | 无理由偏离 | main.js@32743311 → worker-cli.ts:1017-1056（多出 `--tz`） |
| `raft reminder log` | `--id` | `rah reminder log --id ID` | 已对齐 | main.js@32747217 → worker-cli.ts:986-995 |
| `raft reminder ack` | `--id --revision`；确认一条已触发的 reminder Inbox 项 | `rah agent inbox ack --item-id ID --version N`（通用 App Inbox ack，不限 reminder） | 无理由偏离 | main.js@32746448、`reminderAckOptions` → worker-cli.ts:544-570 |
| `raft reminder dismiss` | `--id --revision` | 无 | 缺失 | main.js@32746698 → worker-cli.ts:544-570 只有 `check`/`recheck`/`ack` |
| `raft app config` | `--app <app-id> --set key=value`（可重复）`--unset key`（可重复） | `rah app config --app system.cleaner [--set key=value] [--unset key]` | 已对齐 | main.js@32748701 → agent-app-config-cli.ts、worker-cli.ts:1425 |

### 2.9 `integration`（已裁决延期：Marketplace / Integration）

顶层 20 条子命令全部无 RAH 对应（`worker-application-service.ts:196-238` 无任何 `integrations` 路由）。

| Raft 命令 | Raft 参数与输入方式 | RAH 对应 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `raft integration list` | `--json` | 无 | 缺失（已裁决延期） | main.js@32681782 |
| `raft integration marketplace [query]` | 位置 `[query]`、`--limit --json` | 无 | 缺失（已裁决延期） | main.js@32682913 |
| `raft integration login` | `--service --scope`（可重复/逗号）`--target --json` | 无 | 缺失（已裁决延期） | main.js@32688548 |
| `raft integration env` | `--service --json` | 无 | 缺失（已裁决延期） | main.js@32691986 |
| `raft integration invoke [service]` | `--service --action --list-actions --preflight --param key=value`（可重复，支持 `key=@file` / `key=@-` 读 stdin）`--data-json --data-file`（`-` 读 stdin）`--scope --target --retry-invocation <uuid>`（**显式逻辑幂等重放键**）`--output --json` | 无 | 缺失（已裁决延期） | main.js@32704395 |
| `raft integration app prepare register` | 准备第三方 App 注册提交卡 | 无 | 缺失（已裁决延期） | main.js@32734147 |
| `raft integration app prepare recover-owner` | `--client --to-agent --target --scope --scopes --json` | 无 | 缺失（已裁决延期） | main.js@32731677 |
| `raft integration app rotate-secret` | `--client --output <新私有路径> --json` | 无 | 缺失（已裁决延期） | main.js@32724033 |
| `raft integration app transfer-owner` | `--client --to-agent --json` | 无 | 缺失（已裁决延期） | main.js@32724696 |
| `raft integration app update` | `--client --name --description --category --homepage-url --redirect-url --agent-manifest-url --scope --clear-scopes --unsafe-demo-url-override --json` | 无 | 缺失（已裁决延期） | main.js@32725271 |
| `raft integration app logo` | `--client --file --json` | 无 | 缺失（已裁决延期） | main.js@32728403 |
| `raft integration app clear-logo` | `integrationAppClearLogoCommand` | 无 | 缺失（已裁决延期） | `registerIntegrationAppCommands`（main.js） |
| `raft integration app share-link create` | `integrationAppShareLinkCreateCommand` | 无 | 缺失（已裁决延期） | 同上 |
| `raft integration app share-link status` | `integrationAppShareLinkStatusCommand` | 无 | 缺失（已裁决延期） | 同上 |
| `raft integration app share-link revoke` | `integrationAppShareLinkRevokeCommand` | 无 | 缺失（已裁决延期） | 同上 |
| `raft integration app request-publish` | `integrationAppRequestPublishCommand` | 无 | 缺失（已裁决延期） | 同上 |
| `raft integration app request-unpublish` | `integrationAppRequestUnpublishCommand` | 无 | 缺失（已裁决延期） | 同上 |
| `raft integration app delete` | `integrationAppDeleteCommand` | 无 | 缺失（已裁决延期） | 同上 |
| `raft integration app list` | `--json` | 无 | 缺失（已裁决延期） | main.js@32730709 |
| `raft integration app status` | `--card <message-id> --client --json` | 无 | 缺失（已裁决延期） | main.js@32731081 |

### 2.10 `wiki` / `migrate`（已裁决延期：Wiki / Migration / 远程 Computer）

| Raft 命令 | Raft 参数与输入方式 | RAH 对应 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `raft wiki manifest` | 无参数；返回清单与 ETag | 无 | 缺失（已裁决延期） | main.js@32757567 |
| `raft wiki read <artifactId>` | 位置参数 `<artifactId>` | 无 | 缺失（已裁决延期） | main.js@32758164 |
| `raft wiki publish` | `--input <path>`（JSON 文件含 `expectedEtag`/`manifest`/`revisionBodies`；条件发布＝ETag 幂等） | 无 | 缺失（已裁决延期） | main.js@32759258 |
| `raft migrate export` | 已弃用；`--mode --target --target-machine-id --target-computer --to --prep/transfer/arrival-deadline-ms` | 无 | 缺失（已裁决延期） | main.js@32751428 |
| `raft migrate import` | `--target-machine-id --to --prep/transfer/arrival-deadline-ms` | 无 | 缺失（已裁决延期） | main.js@32752823 |
| `raft migrate status` | 无参数 | 无 | 缺失（已裁决延期） | main.js@32753887 |
| `raft migrate ready` | `--manifest --manifest-sha256` | 无 | 缺失（已裁决延期） | main.js@32754548 |
| `raft migrate arrived` | `--report --report-sha256` | 无 | 缺失（已裁决延期） | main.js@32755862 |

### 2.11 Agent API 75 条路由逐条核对

CLI 表已覆盖的路由在此只标结论，不重复参数。RAH 列给出 `worker-application-service.ts:196-238`
或 `worker-read-handler.ts:9-24` 中的对应路径。

| # | Raft 路由（agentApiContract.ts 行） | RAH 对应 | 判定 |
| --- | --- | --- | --- |
| 1 | `POST /feedback-locators`（1334） | 无 | 缺失 |
| 2 | `GET /feedback-locators`（1344） | 无 | 缺失 |
| 3 | `GET /events`（1354） | `/v1/worker/sync` | 有理由偏离（Activation 围栏：投递范围由 Activation 决定） |
| 4 | `GET /history`（1364） | `/v1/worker/messages/history` | 无理由偏离（选择器差异，见 2.4） |
| 5 | `GET /knowledge`（1374） | 无 | 缺失 |
| 6 | `GET /knowledge/search`（1384） | 无 | 缺失 |
| 7 | `GET /wiki/manifest`（1394） | 无 | 缺失（已裁决延期） |
| 8 | `GET /wiki/artifacts/:artifactId`（1404） | 无 | 缺失（已裁决延期） |
| 9 | `POST /wiki/publish`（1414） | 无 | 缺失（已裁决延期） |
| 10 | `GET /mcp/tools`（1424） | 无 | 缺失（已裁决延期，Managed MCP 目录） |
| 11 | `POST /mcp/call`（1434） | 无 | 缺失（已裁决延期，Managed MCP 目录） |
| 12 | `POST /send`（1444） | `/v1/worker/messages/post` | 无理由偏离（见 2.4） |
| 13 | `GET /messages/:msgId/resolve`（1454） | `/v1/worker/messages/resolve` | 无理由偏离（寻址） |
| 14 | `GET /search`（1464） | `/v1/worker/messages/search` | 无理由偏离 |
| 15 | `POST /messages/:msgId/reactions`（1474） | `/v1/worker/messages/react`（`--active true`） | 无理由偏离 |
| 16 | `DELETE /messages/:msgId/reactions`（1484） | `/v1/worker/messages/react`（`--active false`） | 无理由偏离 |
| 17 | `POST /channels/:channelId/join`（1494） | 无 | 缺失 |
| 18 | `POST /channels/:channelId/leave`（1504） | 无 | 缺失 |
| 19 | `POST /channels/:channelId/mute`（1514） | `/v1/worker/channels/mute` | 无理由偏离（多必填因果参数） |
| 20 | `POST /channels/:channelId/unmute`（1524） | `/v1/worker/channels/unmute` | 无理由偏离 |
| 21 | `POST /channels/archive`（1534） | 无 | 缺失 |
| 22 | `POST /channels/unarchive`（1544） | 无 | 缺失 |
| 23 | `GET /channel-members`（1554） | `/v1/worker/room/members` | 无理由偏离（寻址） |
| 24 | `POST /resolve-channel`（1564） | `/v1/worker/rooms/resolve` | 无理由偏离（Raft 无对应 CLI 命令，RAH 暴露给 Agent） |
| 25 | `POST /threads/unfollow`（1574） | `/v1/worker/threads/unfollow` | 无理由偏离（丢 `--reason`，多因果参数） |
| 26 | `GET /server`（1584） | `/v1/worker/server/info` | 无理由偏离 |
| 27 | `GET /mention-actions/pending`（1594） | 无 | 缺失 |
| 28 | `POST /mention-actions/execute`（1604） | 无 | 缺失 |
| 29 | `POST /tasks/claim`（1614） | `/v1/worker/tasks/claim` | 无理由偏离 |
| 30 | `GET /tasks`（1624） | `/v1/worker/tasks/list` | 已对齐 |
| 31 | `POST /tasks`（1634） | `/v1/worker/tasks/create` | 无理由偏离（无批量、assignee 语义不同） |
| 32 | `POST /tasks/unclaim`（1644） | `/v1/worker/tasks/release` | 无理由偏离 |
| 33 | `POST /tasks/assign`（1654，`assignee: null` 即取消指派） | `/v1/worker/tasks/assign` | 无理由偏离 |
| 34 | `POST /tasks/update-status`（1664） | 无单一状态路由；拆成 start/progress/block/unblock/submit/review | 无理由偏离 |
| 35 | `POST /tasks/resource-receipt`（1674） | 无 | 缺失 |
| 36 | `POST /tasks/delete`（1684） | `/v1/worker/tasks/delete` | 无理由偏离（多 `--room-id`） |
| 37 | `POST /tasks/convert`（1694） | `/v1/worker/tasks/convert` | 无理由偏离 |
| 38 | `POST /tasks/amend`（1704） | `/v1/worker/tasks/amend` | 无理由偏离 |
| 39 | `GET /tasks/history`（1714） | `/v1/worker/tasks/history` | 无理由偏离 |
| 40 | `POST /migrations`（1724） | 无 | 缺失（已裁决延期） |
| 41 | `GET /migrations/current`（1734） | 无 | 缺失（已裁决延期） |
| 42 | `POST /migrations/ready`（1744） | 无 | 缺失（已裁决延期） |
| 43 | `POST /migrations/arrived`（1754） | 无 | 缺失（已裁决延期） |
| 44 | `GET /reminders`（1764） | `/v1/worker/reminders/list` | 已对齐 |
| 45 | `POST /reminders`（1774） | `/v1/worker/reminders/schedule` | 无理由偏离（多 `--based-on-room-seq`） |
| 46 | `DELETE /reminders/:reminderId`（1784） | `/v1/worker/reminders/cancel` | 已对齐 |
| 47 | `POST /reminders/:reminderId/snooze`（1794） | `/v1/worker/reminders/snooze` | 已对齐 |
| 48 | `PATCH /reminders/:reminderId`（1804） | `/v1/worker/reminders/update` | 无理由偏离（多 `--tz`） |
| 49 | `POST /app-sources/ack`（1814） | `/v1/agent-inbox/ack` | 无理由偏离（无 dismiss） |
| 50 | `GET /reminders/:reminderId/log`（1824） | `/v1/worker/reminders/log` | 已对齐 |
| 51 | `GET /apps/:appId/config`（1834） | `rah app config`（读） | 已对齐 |
| 52 | `PATCH /apps/:appId/config`（1844） | `rah app config --set/--unset` | 已对齐 |
| 53 | `GET /profile`（1854） | `/v1/worker/profiles/get`、`/v1/worker/profile/self/get` | 无理由偏离（拆成两条） |
| 54 | `POST /profile`（1864） | `/v1/worker/profile/self/update` | 无理由偏离（多 3 个必填写上下文参数） |
| 55 | `POST /profile/avatar`（1874，multipart 一步） | `rah worker profile-avatar-publish` + `--avatar-key/--avatar-upload-intent-id` 两步 | 无理由偏离 |
| 56 | `GET /integrations`（1884） | 无 | 缺失（已裁决延期） |
| 57 | `GET /integrations/marketplace`（1894） | 无 | 缺失（已裁决延期） |
| 58 | `POST /integrations/login`（1904） | 无 | 缺失（已裁决延期） |
| 59 | `POST /integrations/app/prepare`（1914） | 无 | 缺失（已裁决延期） |
| 60 | `POST /integrations/app/rotate-secret`（1924） | 无 | 缺失（已裁决延期） |
| 61 | `POST /integrations/app/transfer-owner`（1940） | 无 | 缺失（已裁决延期） |
| 62 | `POST /integrations/app/update`（1950） | 无 | 缺失（已裁决延期） |
| 63 | `POST /integrations/app/manage`（1960） | 无 | 缺失（已裁决延期） |
| 64 | `POST /integrations/app/logo`（1970） | 无 | 缺失（已裁决延期） |
| 65 | `GET /integrations/app`（1980） | 无 | 缺失（已裁决延期） |
| 66 | `GET /integrations/app/status`（1990） | 无 | 缺失（已裁决延期） |
| 67 | `POST /prepare-action`（2000） | 无 | 缺失 |
| 68 | `POST /upload`（2010） | `/v1/worker/attachments/prepare` | 无理由偏离（多幂等键与 context receipt） |
| 69 | `GET /attachment-upload-capabilities`（2020） | `/v1/worker/attachments/capabilities`（RAH 另开 `attachment-capabilities` 命令，Raft 无对应 CLI） | 无理由偏离 |
| 70 | `POST /attachment-upload-sessions`（2030） | `/v1/worker/attachments/prepare` 内部完成 | 已对齐 |
| 71 | `POST /attachment-upload-sessions/:uploadId/complete`（2040） | 同上，CLI 内部完成 | 已对齐 |
| 72 | `DELETE /attachment-upload-sessions/:uploadId`（2050） | `/v1/worker/attachments/cancel`（RAH 另开 `attachment-cancel` 命令，Raft 无对应 CLI） | 无理由偏离 |
| 73 | `GET /attachment-upload-sessions/:uploadId`（2060） | 无独立命令 | 已对齐 |
| 74 | `GET /attachments/:attachmentId`（2070） | `/v1/worker/attachments/:id`、`rah worker attachment-download` | 无理由偏离（寻址） |
| 75 | `GET /attachments/:attachmentId/comments`（2080） | `/v1/worker/attachments/comments` | 无理由偏离 |

### 2.12 RAH 多出而 Raft 没有的 Agent 面向表面

| RAH 命令 | 说明 | Raft 侧事实 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| `rah worker sync` / `rah worker acknowledge` | 拉取 Activation 投递并显式 ACK | Raft 用一条 `message check` 排空并自动 ACK | 有理由偏离（Activation 围栏） | worker-cli.ts:602-616 ← main.js@32620763 |
| `rah worker room-read --target --context-receipt` | 发送到别的目标前必须先取一次完整目标读取，拿 receipt 回填 | Raft CLI 自己维护 consumed-seq 本地状态，Agent 不感知 | 无理由偏离（把 Raft 的 CLI 本地状态上抬到 Agent 手上） | worker-read-cli.ts:46-60、standing-prompt-compiler.ts:115 ← handleMessageSend-0.js:103-115、recordConsumedRead-0.js |
| `rah worker room-list` | 列出已加入目标 | Raft 用 `server info --channels --joined` | 无理由偏离 | worker-read-cli.ts:61-67 ← main.js@32588457 |
| `rah worker room-resolve` | 显式解析目标为 Room | Raft 有 `/resolve-channel` 路由但**不暴露 CLI 命令** | 无理由偏离 | worker-read-cli.ts:68-74 ← agentApiContract.ts:1564 |
| `rah worker attachment-capabilities` | 显式查上传上限 | Raft 有路由无 CLI 命令 | 无理由偏离 | worker-read-cli.ts:75-81 ← agentApiContract.ts:2020 |
| `rah worker attachment-cancel` | 显式取消上传会话 | Raft 有路由无 CLI 命令 | 无理由偏离 | worker-cli.ts:637-644 ← agentApiContract.ts:2050 |
| `rah worker artifact-publish` / `artifact-download` | Task 交付物独立通道 | Raft 用 attachment 上传 + Task 提交 | 无理由偏离 | worker-cli.ts:172-260、467-539 |
| `rah worker task-get` / `task-submission` / `task-input-status` | 单 Task 详情、冻结提交、输入请求状态 | Raft 用 `task list` / `task history` + Thread 消息 | 无理由偏离 | worker-cli.ts:792-812 |
| `rah worker task-trajectory` | 读取 Task 关联 Run 的命令与文件编辑证据 | Raft 无对应 | 有理由偏离（单机 + 本地 SQLite 账本才可能记录本机 Run 轨迹） | worker-cli.ts:794-808、standing-prompt-compiler.ts:144 |
| `rah worker task-start` / `task-progress` / `task-block` / `task-unblock` / `task-request-input` / `task-submit` / `task-review` | 固定生命周期命令组 | Raft 只有 `task update --status` 一条 | 无理由偏离 | worker-cli.ts:851-886、worker-task-management-cli.ts:91-98 ← main.js@32661493 |
| `rah worker task-claim-message` | 由消息原子创建并认领 Task | Raft `task claim --message-id` 是认领**已存在**的 Task | 无理由偏离 | worker-cli.ts:833-848 ← main.js@32650444 |
| `rah worker profile-self-get` | 只读自身档案 | Raft 用 `profile show`（省略 target） | 无理由偏离 | worker-self-profile-cli.ts:24 ← main.js@32680193 |
| `rah agent inbox check` / `recheck` | App Inbox 检查/重查 | Raft 用 `inbox check` + `reminder ack/dismiss` | 无理由偏离 | worker-cli.ts:544-570 |
| 全局：`--based-on-room-seq` + `--idempotency-key` 出现在 20 条以上变更命令的必填位 | Agent 必须自己算出因果游标与稳定键 | Raft **没有一条 CLI 命令**要求 Agent 提供这两者；`seenUpToSeq` 由 CLI 本地状态推导，`idempotencyKey` 在 send 路径上 CLI 根本不设置 | 无理由偏离 | worker-cli.ts:1452-1489（help 全文）← handleMessageSend-0.js:103-115、getConsumedSeq-0.js、agentApiContract.ts:241-253 |

---

## 3. 无理由偏离与缺失清单（按核心链影响排序）

核心链＝Room 聊天 → DM → Thread → Task → Agent 配置 → 记忆。

### 3.1 `S1` 全局：变更命令强制 Agent 自带 `--based-on-room-seq` 与 `--idempotency-key`｜规模 `L`

- **Raft 做法**：`message send`、`message react`、`channel mute`、`thread unfollow`、
  `task claim/assign/update/amend/delete/convert`、`reminder schedule` 全部**没有**这两个参数。
  发送路径的 `seenUpToSeq` 由 CLI 从本机 consumed-seq 状态读出
  （`handleMessageSend-0.js:103-104` → `getConsumedSeq-0.js`，写入在 `recordConsumedRead-0.js`），
  `idempotencyKey` 在 `agentApiSendBodySchema`（agentApiContract.ts:241-253）里是可选字段，
  CLI 在 send 上根本不设置它。
- **RAH 做法**：worker-cli.ts:1452-1489 的 help 里，除 `message-post` 外几乎每条变更命令
  都把这两项列为必填（worker-channel-attention-cli.ts:8-31、
  worker-task-management-cli.ts:14-110、worker-cli.ts:617-636、778-791、813-848）。
- **用户可见风险**：模型必须在提示里被反复教怎么推导游标与稳定键；推导错就静默去重或撞并发冲突，
  返工轮次里键复用会把新事件当重放丢弃。这正是本周多次“用提示规则补 Agent 行为”的根因面。
- **规模**：`L`（涉及 20+ 命令与其请求 schema）。

### 3.2 `S2` Task 寻址从「Channel + 任务号」改成 `--task-id ID`｜规模 `L`

- **Raft 做法**：全部 12 条 task 子命令统一 `--target '#channel'`（`--channel` 遗留别名）
  加 `--number N`，`--number` 在 claim 上还可重复（main.js@32644760–32676771）。
- **RAH 做法**：统一 `--task-id ID`，`task-delete` 还额外要 `--room-id`
  （worker-task-management-cli.ts:14-34）。
- **用户可见风险**：Agent 拿不到人类在界面上看到的任务号，必须先跑 `task-list` 拿 UUID，
  多一轮往返；人机之间无法用同一个称呼指同一个 Task。
- **规模**：`L`。

### 3.3 `S3` 缺 `raft channel join / leave / info` 与全部 Channel 管理命令｜规模 `L`

- **Raft 做法**：`channel info <target>`（存在性/已加入/描述/成员数）、`channel join --target`、
  `channel leave --target` 是普通成员能力；`create/update/archive/unarchive/add-member/remove-member`
  另需 server admin 授权（main.js@32569969–32585664）。
- **RAH 做法**：`worker-application-service.ts:196-238` 里没有任何 Channel 生命周期或成员路由。
- **用户可见风险**：Agent 无法自助进入一个可见公开 Room，也无法退出；Room 归属完全依赖 Human
  在界面上操作，多 Agent 协作的 Room 组织成本落回人身上。
- **规模**：`L`（`info/join/leave` 可先做，管理类另计）。

### 3.4 `S4` 跨目标发送要求 Agent 手工携带 `room-read` 的 `--context-receipt`｜规模 `M`

- **Raft 做法**：`message send --target` 单独就能寻址；新鲜度由 CLI 用本地 consumed-seq
  与保存的草稿状态自己处理，Agent 只在被 hold 时看到提示。
- **RAH 做法**：standing-prompt-compiler.ts:115 教 Agent 先 `room-read --target` 取完整上下文，
  拿回 `--context-receipt` 再用于 `attachment-publish` 和 `channel-mute`；receipt 一小时过期。
- **用户可见风险**：把 Raft 藏在 CLI 里的本地状态变成模型必须记住的多步协议；
  receipt 过期或漏传会让附件与静音操作失败，且失败面对 Agent 不自解释。
- **规模**：`M`。

### 3.5 `S5` `raft message send --target-confirmed` 缺失｜规模 `S`

- **Raft 做法**：当最近一次本地读上下文是 Thread、而 `--target` 指向顶层时，
  send 会拒绝并要求 `--target-confirmed`（main.js@32618469，选项描述见 U1 提取）。
- **RAH 做法**：worker-cli.ts:645-773 只有 `--thread-id` / `--top-level` 互斥校验，
  没有「读的是 Thread、发的是顶层」这条确认闸。
- **用户可见风险**：Agent 在 Thread 里读完后误发到 Room 顶层，把 Thread 内的讨论泄漏到全 Room。
- **规模**：`S`。

### 3.6 `S6` `raft thread unfollow --reason` 缺失｜规模 `S`

- **Raft 做法**：`--reason` 会写进 Thread 内的退订提示（main.js@32614526），默认
  `"no longer following"`。
- **RAH 做法**：worker-cli.ts:778-791 只有 `--thread-id` 与两个因果参数。
- **用户可见风险**：Thread 里其他成员看不到某 Agent 为什么不再跟进，协作断点无痕。
- **规模**：`S`。

### 3.7 `S7` `raft task create` 无批量、assignee 语义不同、无 `--creates-resource`｜规模 `M`

- **Raft 做法**：`--title` 可重复（一次原子建多条）、`--assignee @handle`
  （原子指派给所有新建任务）、`--creates-resource` 要求后续补结构化资源回执
  （main.js@32646909，配套 `raft task receipt` main.js@32664866）。
- **RAH 做法**：worker-cli.ts:813-832 单条 `--title`，`--assignee` 收内部 participant id，
  无 `--creates-resource`，也没有 `task receipt`。
- **用户可见风险**：拆解一次需求要发 N 次命令、N 个幂等键；Agent 必须先查出 participant id
  才能指派，无法用 Room 里人人可见的 `@handle`；创建外部资源的任务没有强制回执与到期跟进。
- **规模**：`M`。

### 3.8 `S8` `raft profile update` 被拆成两步并要求 Agent 自带写上下文｜规模 `M`

- **Raft 做法**：一条 `profile update --avatar-file <path> --display-name --description --json`
  即可（main.js@32593960）。
- **RAH 做法**：`profile-avatar-publish` 拿 key，再 `profile-update --control-room-id
  --control-room-seq --expected-revision-id ... --idempotency-key`
  （worker-self-profile-cli.ts:8-45，worker-cli.ts:1448-1450）。
- **用户可见风险**：Agent 改自己的显示名或头像需要先知道「控制 Room」是什么、它的 seq 是多少、
  当前 revision id 是什么——这些都不是它在对话里能自然得到的事实，失败率高。
- **规模**：`M`。

### 3.9 `S9` `raft manual get` / `raft manual search` 缺失｜规模 `M`

- **Raft 做法**：Agent 用 `manual get <topic> --intent --reason` 与
  `manual search <keywords> --scope recipes --intent --reason` 自助查操作手册与配方，
  `--intent`/`--reason` 必填 12–500 字符并落 knowledge 事件（main.js@32606525、@32609326）。
- **RAH 做法**：无对应命令；能力说明全部压在常驻提示里（standing-prompt-compiler.ts:113-170）。
- **用户可见风险**：提示越写越长且无法按需检索；Agent 遇到没教过的场景只能猜，
  这正是本周多次“凭行为猜测重造 Agent 面”的另一个入口。
- **规模**：`M`。

### 3.10 `S10` `raft message react --remove` 被改成必填 `--active true|false`｜规模 `S`

- **Raft 做法**：加表情是默认，删是 `--remove` 开关（main.js@32629637），
  对应两条不同路由（agentApiContract.ts:1474、1484）。
- **RAH 做法**：worker-cli.ts:617-636 要求显式 `--active true|false`，
  再加 `--based-on-room-seq` 与 `--idempotency-key`。
- **用户可见风险**：最轻量的一次交互被拉成四个必填参数，模型经常整条放弃使用反应。
- **规模**：`S`。

### 3.11 其余（影响递减，逐条列出不展开）

| 编号 | 项 | 判定 | 规模 |
| --- | --- | --- | --- |
| S11 | `raft inbox check`（只窥不排空）缺失 | 缺失 | `S` |
| S12 | `raft message send --attachment-id` 可重复 → RAH `--attachment-ids ID,ID` 逗号串 | 无理由偏离 | `S` |
| S13 | `--reviewer-isolation`（send/claim/update/amend 共享选项，盲审席位）整体缺失 | 缺失 | `M` |
| S14 | `raft task assign --expected-revision` 乐观并发键 → RAH 用 `--based-on-room-seq` | 无理由偏离 | `S` |
| S15 | `raft task update --status` 单一状态置位 → RAH 七条固定流程命令 | 无理由偏离 | `L` |
| S16 | `raft task receipt` 结构化资源回执整体缺失 | 缺失 | `M` |
| S17 | `raft server info --channels/--agents/--humans/--joined/--query/--offset` 分区与过滤缺失 | 无理由偏离 | `M` |
| S18 | `raft action prepare`（`RAFTACTION` heredoc 行动卡）缺失 | 缺失 | `M` |
| S19 | `raft mention pending` / `notify` / `add` 缺失 | 缺失 | `M` |
| S20 | 位置参数系统性改成选项：`channel members`/`channel info`/`user info`/`profile show`/`message resolve`/`attachment view`/`manual get`/`manual search`/`wiki read`/`integration marketplace`/`integration invoke` | 无理由偏离 | `M` |
| S21 | `raft reminder dismiss` 缺失；`reminder ack` 的 `--revision` 变 `--version`、命令并入通用 App Inbox | 无理由偏离 | `S` |
| S22 | `raft version` 不报 daemon/Computer 版本、无 `--json` | 无理由偏离 | `S` |
| S23 | `raft message search --channel` 别名与 `--offset` 缺失 | 无理由偏离 | `S` |
| S24 | `raft message read --channel` 别名缺失（RAH 仅 `--target`；`task-list`/`task-history` 侧接受 `--channel`） | 无理由偏离 | `S` |
| S25 | `raft reminder update` RAH 多出 `--tz`；`reminder schedule` 无 `--msg-id` 遗留别名 | 无理由偏离 | `S` |
| S26 | RAH 多出 `room-list`/`room-resolve`/`attachment-capabilities`/`attachment-cancel`：Raft 有路由但不给 Agent CLI 入口 | 无理由偏离 | `S` |
| S27 | RAH 多出 `artifact-publish`/`artifact-download` 独立于 attachment 的交付物通道 | 无理由偏离 | `M` |
| S28 | RAH 多出 `task-get`/`task-submission`/`task-input-status`/`task-claim-message` | 无理由偏离 | `M` |
| S29 | `raft channel info` 缺失（S3 的可先行子集） | 缺失 | `S` |
| S30 | `raft server update`（server admin 改工作区名与头像）缺失 | 缺失 | `S` |

### 3.12 已裁决延期（列出但不排优先级）

`integration`（20 条子命令 / 11 条路由）、`wiki`（3 / 3）、`migrate`（5 / 4）、
Managed MCP（`/mcp/tools`、`/mcp/call`）、`feedback-locators`（2 条路由，Raft 内部反馈索引，
无 CLI 入口）。这些全部标 `缺失（已裁决延期）`，不进第 3 节排序，但不得从清册里删除。

---

## 4. 判定计数

| 判定 | CLI 子命令（90） | Agent API 路由（75） |
| --- | --- | --- |
| `已对齐` | 8 | 11 |
| `有理由偏离` | 7 | 1 |
| `无理由偏离` | 29 | 27 |
| `缺失`（其中已裁决延期） | 46（28） | 36（22） |

RAH 多出的 Agent 面向表面另计 14 项（2.12），其中 `有理由偏离` 2 项、`无理由偏离` 12 项。

---

## 5. 不要修改

本文件是**清册**，不是工单。它只记录 2026-09-09 当天两侧字节的对照结果，
不指定修复顺序、不给设计方案、不授权任何改动。

- 任何一行的 `无理由偏离` 或 `缺失` 都不构成“现在就改”的许可。
- 修复按批次单独立项，每批关闭一条完整行为链后再推进下一条；批次计划另文承载。
- 修复时以本表的 Raft 位置为准重新读上游字节，不得以本文件的中文转述替代取证。
- 本文件不随修复自动作废；改动落地后应在对应批次文档中标注，而不是在此就地改判。
