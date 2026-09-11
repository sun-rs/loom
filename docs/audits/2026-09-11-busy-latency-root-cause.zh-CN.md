# 忙时追加 191.764 秒的分段根因

## 结论

同模型/effort并不保证同样的投递路径。本次主要延迟已定位到**运行中追加只能排队等当前运行退出**，不是CLI启动耗时。该次旧运行实际上在发送hold中看见了追加，但留待下一Activation；期间仍在确认游标和整理记忆。下一运行又对已经sync输出的PASS做hold，增加了恢复耗时。但新官网反例及源码复核表明，收件箱check与目标read是两种合同；后者不能仅凭重复出现正文就判为Raft差距。

这是现有样本的因果分段，不声称所有模型或每次运行都固定慢同样秒数；不把所有模型思考时间都归因于平台。原任务与追加最终通过，只证明不丢，不能视为响应体验已对齐。

## 本地实际时间

证据是保留临时SQLite的RunAttempt/trajectory、消息createdAt，以及Kimi原生wire工具调用和结果。时间均为2026-09-10 UTC。

| 区间                                          |      秒 | 证据解释                                    |
| --------------------------------------------- | ------: | ------------------------------------------- |
| 18:50:13.018追加接受 → 18:52:25.463旧运行退出 | 132.445 | follow-up在唯一执行lane后等待；不是启动耗时 |
| 旧运行退出 → 下次RunAttempt开始               |   0.007 | Host几乎立即领取                            |
| 下次RunAttempt开始 → 模型请求开始             |   0.765 | 包含本次进程启动/恢复；不是百秒级           |
| 模型请求开始 → sync工具返回                   |  26.247 | 先读memory/environment，再sync              |
| sync返回 → 首次NOTE发送hold                   |  17.654 | 模型执行及一次发送尝试                      |
| hold返回 → NOTE最终落账                       |  14.646 | 原消息存草稿后重发                          |
| 合计追加 → NOTE                               | 191.764 | 持久消息时间，非测试总时长                  |

旧运行18:51:23.507已经发出REPAIR，仍到18:52:25.463才退出，额外61.956秒。原生工具记录显示其后acknowledge、Edit MEMORY失败、Read MEMORY、再次Edit及结束。错误明确为“先Read再写”；shell cat虽然取过文件，却没有满足该Provider文件工具自己的读取追踪。不是RAH权限拒绝，不能靠关闭权限或删记忆需求解决。Raft原始Compaction safety也要求完成后更新记忆，不能把记忆收尾本身宣布为自研缺陷。

## 已测得的再次新鲜度检查：撤回直接判为缺陷

后续运行18:52:52.482的sync输出已经完整包含seq37 AUDIT:PASS。18:53:10.136第一次NOTE发送却又以同一seq37为新消息，返回SEND_HELD_AS_DRAFT；18:53:24.782才重发成功。

对应本地实现：`packages/kernel/src/room-kernel.ts`的`syncWorker`返回事件和presentedContext，但不更新按目标的读取位置；`worker-presented-context.ts`明确仅查询。`worker-target-read-position.ts`的位置由message-read/room-read及hold路径推进。独立最小复现证明了这一行为，**不能单独证明其违反Raft合同**。

本轮后续官网反例推翻了最初的修复判断：Raft B的`message check`已返回本条Human提问，发送PRIVATE:UNKNOWN仍hold同一提问，再send-draft成功。Raft源码729502–729516的check调用677012–677035 drainInbox，只通过events.get累计收件箱输出，不写recordConsumedRead/Seqs；729582–729595的目标history read才记录实际返回的最大seq，676906的hold另行记录consumed位置。RAH worker sync是Activation交付，不能直接与Raft目标message read等同。 Raft proxy737976/738121还会以agent_api_events_local/server记录精确已交付message IDs，供重复投递过滤；但744712只允许verified_contiguous_content_consumption/thread_join_context_rendered推进连续边界。因此不能把“没有CLI consumed seq”误说成“check完全不记录消费”，消息ID去重与连续新鲜度边界需要分开。

因此撤回此前“sync出现正文就必须推进target read position”的方案。接下来应逐条核对sync/check、message-read、hold三种位置的合同；只有证明相同目标已经由正式read/hold消费、没有新相关事实，却仍被再次拦截，才能判为对齐缺陷。不能为省14秒把收件箱交付擅自升级为目标阅读，更不能连带ACK Inbox或完成Task。

## Raft来源与对照

Raft Computer 1.0.18，授权提取的`main.js` SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

- 760313–760331：Kimi persistent/direct；760861–760909：本次实际运行的kimi-sdk原生RuntimeSession。
- 736630–736730：freshness计划逐条区分model-seen与unconsumed；已呈现pending走forward/consume-visible，而不是再把同一消息当新内容hold。
- 729577–729596：message read输出正文后按实际返回行的最大seq记录consumed read；676905–676906：hold呈现正文后也记录consumed seq。
- 769113起：sendStdinNotification含忙时能力、会话就绪、去重、错误退避及重排。不可只移植stdin.write。

官网本次原任务期间实际出现turn.steer（上海02:58:17.237），NOTE成功回执02:58:36.057，先于REPAIR。追加创建仅有秒级02:58:13，故约22–23秒是消息创建到CLI成功回执的描述值，和本地两端canonical时间精度不同；仍足以提示应优先调查，而不是用测量差异搪塞百秒差距。

## 修复优先级与边界

1. 优先补齐Raft对应的Runtime忙时投递通道，这是本次132秒排队的明确结构差异。Kernel持久follow-up仍保留作恢复依据，不能因steer成功就ACK或完成。Kimi/Codex direct、Claude gated、OpenCode per-turn/none分别处理；先验证失败、重复、回合切换和重启，再做真实验收。
2. 在改新鲜度记账之前，先完成check/sync与目标read/hold的精确映射。当前不修改sync使其自动免hold，最小复现仅保留为行为证据。
3. 再比较恢复时完整standing prompt重送、记忆读写及工具额外轮次。它们是实测开销来源，但当前未用受控消融量化，不能直接删prompt/记忆规则凑速度。

原始白名单分段证据：`/Users/sun/Code/reviews/rah_os/2026-09-11-busy-latency/local-timeline.json`。本批仍在验证其他组合；此文是根因审计与修复顺序，不是修复已部署声明。

补充不计费复现：临时真实Kernel和Worker HTTP服务，sync返回唯一Human消息Work，期间没有任何新消息，target read position仍为空；紧接着minimal send返回held，heldMessages正是刚返回的同一seq3。白名单结果与复现脚本保存在同一busy-latency目录的`sync-hold-reproduction.json`和`reproduce-sync-hold.ts`。这排除了模型随机性、网络队列和新消息竞态作为该次再次hold的原因，但不证明收件箱同步本应推进目标read边界。

## Kimi传输层的进一步确认

Raft的`KimiSdkRuntimeSession.send`在760605–760635直接把busy输入送入`session.steer`，idle才launchPrompt；原生standing prompt经roleAdditional挂到system侧（760861起），不是每轮完整再发一次。RAH本次三个turn.prompt均重新携带约46k字符的standing文本，但尚未量化它对延迟的独立贡献。

本机Kimi Code源码`/opt/homebrew/lib/node_modules/@moonshot-ai/kimi-code/dist/main.mjs`，SHA256 `ed24f532d07e5d00777ae20b42ed18437e116b050bbcfc6ae0f3bc90affca337`，363459–363479的ACP `assertNoActiveTurn`明确拒绝运行中第二次prompt（TURN_AGENT_BUSY）；不能把保持ACP进程常驻或再发一次session/prompt等同于Raft SDK steer。需要复用Raft对应native session通道或经验证支持steer的接口，不能造一个错误重试循环。该代码依据进一步解释了当前不能直接沿用ACP prompt接口注入追加，未改变已冻结运行。
