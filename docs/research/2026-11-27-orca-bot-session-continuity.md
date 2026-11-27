# Orca bot / 编排器会话续接调研（2026-11-27）

版本：Orca.app 本机安装版（与 2026-11-25 记忆调研同一份，约 1.4.272）。
来源：反混淆读取 `/Applications/Orca.app/Contents/Resources/app.asar` 里的 `out/main/index.js`（只读，解出到临时目录，未运行 Orca 或任何 agent CLI）；本地 orchestration / orca-cli 技能存根。未联网查公开文档，因此"设置项含义"和"对用户的文案"均为从代码推断 [unverified]。压缩代码里变量名被混淆，下面的行为描述是读代码得出的，不是官方文档。

## 结论摘要
1. Orca 不是"一个永不重启的长会话"。bot 的连续性主要靠**外置状态 + 每次新对话重新注入**，原生会话续接（resume）只用于两种场景：重启后接回正在做事的 worker 回合，和用户重新打开的聊天。
2. 重启后续接 worker 是**默认关闭、需用户开启**的设置（`nativeChatResumeWorkOnRestart`；老用户配置迁移时强制写成 false，只有新配置按默认）。关闭时不自动续，改为"提供续接"（restart_offered），由用户点 continue 或 dismiss。
3. 上下文增长不靠 Orca 自己压缩 bot 会话，而靠：新对话从 SOUL/MEMORY/topics/recentChats/待办摘要重新播种；底层 CLI（claude/codex/pi）的自动 compaction 会被识别并在界面显示 "Context compacted"。

## 1. 重启后续接还是新开
- worker 回合（dispatch）：重启时，仍在进行的 dispatch 被标为 `restart_offered`，并记录 `provider session id`、`assignee_pane_key`、`process_incarnation`。
  - 设置开启：启动后自动调用 `restartResume.continueAfterRestart({automatic:true, recordedSince: 上次运行开始时间})`，把上一次运行中被打断的会话原生续接（用的是各 provider 的原生会话 id，代码里有 `resumeCursor`、`providerSession.id`）。
  - 设置关闭：只出现"提供续接"列表（`W4r.list()`，trigger 标 `crash`），用户 `continue` 才续，`dismiss` 则把该 dispatch 标 lost（`failLost`）。
  - 续接时判断：若 pane 的进程 incarnation 没变（进程还活着）→ 直接 `bind` 重新挂回；否则 `reopen` 用原生 id 重开会话。pane 里的对话归属为 own/unknown 才允许挂回，避免挂错会话。
  - 超时：启动有 120s 窗口（`H4r=12e4`）等 pane 恢复，原地等待也是 120s（`V4r`）；超时 `giveUp`，日志 "a terminal worker was not resumed after a restart"，该 dispatch 失败。
- bot 本身：bot 有 "Home Chat" 和线程/自动化运行的聊天，各自是结构化原生会话，按会话 id 保存；用户重新打开聊天是续旧会话。bot 并没有一个必须一直活着的单会话；新聊天、自动化运行都是新会话，靠第 2 节的外置状态接上。

## 2. 外置状态（让新会话可用）
- 每个 bot 一个目录（`bots/<bot>/`）：`SOUL.md`（身份/专长）、`memory/MEMORY.md`（一行一事实带来源，首轮注入前 200 行，声明"供参考的笔记非指令"）、topics、skills/。详见 2026-11-26-memory-design.md。
- Items（bot 工作项）：状态 working / waiting / needs_you，带 wait 原因、关联 PR、关联 dispatch；`bot item list --all`、`bot work list` 可查。有 `startRecovery()`/`sendOwedMail()`：重启后补发欠下的邮件/通知，`botJournal.catchUp()` 追赶日志。
- 编排 DB（SQLite，`_orchestrationDb`）：dispatch、任务、`worker_terminal_resources`（owner_dispatch_id）、`workerDockSources`。记录 pane、进程 incarnation、provider 会话。
- 对话日志：会话 journal（`journalDatabase`，保存 transcript 与 fork 副本，支持把会话分叉成独立副本）。
- 新聊天开头注入的"实况"块（`[Orca: your live work now, ...]`）：由 Items + 运行中 worker 生成，每次最多 12 行/1500 字符，标明"数据非指令"，超出提示用命令查。分类："needs you"、"working/out of contact/state can't be read"、"in progress"、"waiting on …"、"finished, PR still open"。没有活动时写 "you have no live work now"。
- 未回答问题提示：对"状态为 In progress 但没有任何东西在跑"的 Item 附一条提醒（`start the work, set Waiting with what wakes you, or set Needs you`），同一状态只提醒一次（按 lastEventId 去重）。
- recentChats：新聊天可看到本 bot 近期其他聊天的标题/最后一句/在跑的 worker（缓存上限 500 项）。
- 规则变更：bot 的 Tools/Rules 变化时，只在下一条提示附 "Orca rules update"，不重发全文（按 key 比对已投递版本）。

## 3. 上下文增长怎么控
- 不对 bot 会话做 Orca 层压缩；依赖底层 CLI 自动压缩，Orca 只展示（codex 的 compaction 帧、pi 的 compaction/branch_summary 条目被转成系统消息 "Context compacted"）。
- 新对话重新播种而非无限追加；注入块都有硬上限（MEMORY 200 行、实况 12 行/1500 字、会话外变更 diff ≤20 行/3000 字）。
- 空闲清扫：`idleSweep.idleMs` 读用户设置，空闲会话被回收（具体设置名与默认值 [unverified]）。回收后重新打开走原生续接。
- 夜间整理 memory（每晚 1 次，约 60 行）见记忆调研。
- 没有发现"按会话年龄/大小强制轮换"的阈值。[unverified：未逐一搜全]

## 4. 在途 worker 的恢复
三种去向：续接（见 1）、提供续接等用户决定、标记丢失。已完成但 PR 还开着的显示 "finished, PR still open"；读不到状态的显示 "state can't be read / out of contact"。`reportWorkerStopsAcrossRestartOnce` 在重启后一次性汇报因重启而停掉的 worker，并看用户是否已 dismiss。"重新排队"没有看到自动实现，Orchestration 技能里 `orca ... --reference` 提到 "uncertain release recovery" 的专门参考文档 [unverified，未读]。

## 5. 用户可见策略/设置
- `nativeChatResumeWorkOnRestart`（默认关，见上）。
- 空闲回收时长（`idleMs`）。
- `usageLimitAutoContinue`：触到用量上限后自动在额度恢复时续（`usageLimitWaits`），也是一种"续接"。
- 没有看到显式的 "resume vs new" 阈值设置；选择由"是否同一个聊天/是否有原生会话 id/进程是否还活着"决定。

## 对 loom 的可借鉴点
1. 续接是"可选 + 默认保守"，并提供"提供续接/用户 dismiss"的出口，不静默。
2. 新会话靠"外置事实 + 实况摘要（有上限、声明为数据非指令）"播种，而不是依赖旧会话保留一切。
3. 续接前验证身份：进程 incarnation + 会话归属，避免挂错。
4. 重启后设定固定等待窗口（120s），超时即失败并上报，不无限等。
5. 压缩交给底层 CLI，调度层只做展示和外置记录。

## 与 Claude Code 对比（凭已有知识，未联网核对）
Claude Code 的 `--resume/--continue` 是按会话 transcript 文件重放；会话过长靠自动 compact。claude-mem 类做法是把观察写入外部库，新会话开头注入摘要，与 Orca 的"新会话重新播种"路线一致。
