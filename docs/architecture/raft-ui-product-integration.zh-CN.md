# Raft UI 产品集成边界

状态：**Phase 4A implemented / Room-Chat-Thread-Task-Agent recovery slice**（2026-08-27）。

## 1. 决策

独立 `/Users/sun/Code/repos/raft-ui` 继续作为授权视觉、DOM、交互和浏览器回归母版，不改造成 RAH OS 产品仓库。RAH OS 通过显式导入器吸收一份版本化快照：

```text
raft-ui reference repository（保持原样）
  -> allowlist importer
  -> @rah-os/raft-ui-snapshot
       reference HTML/JS/CSS   evidence-only
       protocol inventory      comparison input
             |
             v build-time allowlist generator
       @rah-os/ui-tokens
       CSS/fonts/icons only

RahClient -> client-core -> @rah-os/ui-web -> apps/web React composition
                                      ^
                                      └── 只消费 product-owned ui-tokens，不消费 snapshot/fixture 状态机
```

这比三种替代方案更安全：

- 不让生产程序在运行时依赖 sibling `raft-ui` 路径，否则安装位置与源工作树会成为隐式配置；
- 不直接把整个静态 HTML 塞进 React 或 iframe，否则 reference adapter、fixture state 和真实 Room state 会形成双 owner；
- 不从零重做一套视觉系统，否则已经校准的 Raft 几何、字体、图标和状态会快速漂移。

## 2. 快照身份

`scripts/import-raft-ui-snapshot.mjs` 只接受明确目录和扩展名：

- 12 个参考页面及其本地 CSS/JS；
- generated CSS/JSON/SVG；
- UI protocol/runtime evidence；
- 官方 CSS manifest、CSS 和本地字体；
- 不导入 `.git`、私密 references、截图、测试结果、Python 环境或官方业务 JS bundle。

`snapshot-manifest.json` 对每个文件记录 path、bytes 和 SHA-256，同时记录源 Git HEAD 与 dirty 状态。当前源工作树含未提交的 UI 校准成果，因此 HEAD 不是充分身份；逐文件 digest 才是精确证据。

Reference HTML 永远加载 `raft-ui-reference-adapter.js`，不得加载产品 adapter。`scripts/generate-ui-tokens.mjs` 只把七个 CSS/font/icon 输入投影到独立 `@rah-os/ui-tokens`，记录来源和输出 SHA-256；产品代码不得直接导入 snapshot。source-boundary test 阻止 snapshot、HTML、reference adapter 和 sibling path 进入产品 bundle。

## 3. 产品 owner

| Owner              | 当前职责                                                                                                               | 禁止职责                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `client-sdk`       | typed operation、HTTP/Fake transport、schema validation、structured error                                              | Room projection、React、token persistence                       |
| `client-core`      | ordered sync、bounded catch-up、causal mutation barrier、duplicate replay、gap/divergence fail-closed、ack-after-apply | HTTP path、DOM、业务 authority                                  |
| `ui-tokens`        | snapshot allowlist 生成的 CSS/font/icon 与 provenance                                                                  | reference HTML/JS、业务状态、手工分叉来源                       |
| `ui-web`           | provider-independent Room view model、Raft column mapping                                                              | fetch、daemon lifecycle、fixture success                        |
| `apps/web`         | React composition、draft、tab/selection、same-origin connection                                                        | canonical Task/Room state、Provider parser、Local Storage token |
| `raft-ui-snapshot` | immutable reference evidence、生成输入与对照基线                                                                       | product runtime dependency、live business state、credential     |

手工连接模式的 Human PAT 只存在于页面内存。Vite development server 用 `RAH_DAEMON_URL` 做 same-origin proxy；真实浏览器 gate 可额外设置只由测试代理读取的 `RAH_DEV_ACCESS_TOKEN`，代理覆盖浏览器的无权限占位 header，PAT 不进入页面、URL、Local Storage 或测试输出。默认 gate 仍绑定 loopback；显式 `dev:web:multi-agent-fixture:lan` 只为可信局域网的 iOS 实机测试临时绑定 `0.0.0.0`，daemon 继续绑定 loopback，并明确把测试期间的 Human authority 暴露风险归给临时 Web origin。ADR-0017 的 production local workbench 则使用正式 build 与 loopback static gateway：PAT 只在 server side，浏览器持有随机 HttpOnly Strict session，mutation 还受 exact Origin 约束。该 gateway 刻意不支持 LAN；远端入口必须另做 pairing/TLS，而不是放宽 CORS。

`RoomSession.snapshot` 是冷启动基线，不是独立维护的 mutable membership projection。Room 成员窗口必须用 `room.member.list` 判断当前成员；Workspace Agent 目录、旧浏览器内存或 Computer/CLI inventory 都不能单独证明“已加入”。`principal.me` 提供 server-owned 当前 Human 身份，UI 再把它与 Room/control Room 的 canonical membership role 结合：只有 owner/admin 才显示可用的成员管理或 Room 创建动作，capability 本身不等于 authority。加入/移除使用 `client-core` ensure command：mutation 冲突后重新读取 canonical membership，只有目标状态已成立才收敛为成功，否则保留原错误。所有 Room/control Room 写操作通过 `runRoomMutationAtLatest` 先追平 `RoomSession`，并只对结构化 `409 stale_context` 做有界重试；permission/validation 错误不重试，后端始终是并发裁决者。

## 4. 首条切片

已接入：

- Human PAT 内存连接；
- Workspace 和 channel Room discovery；
- channel Room 创建，并通过 Workspace control Room 的最新 sequence 保持 causal freshness；
- durable Room sync、validated projection、receipt ack；
- 同一 tab 重载稳定的非 secret consumer ID，以及 durable cursor 领先时从零分页 bootstrap；
- Message/Thread 使用独立可续页 `MessageSession`，单次有界预算耗尽后从已验证 cursor 继续，超过 5,000/2,000 条时不会每轮退回 sequence 0；
- `RahClient` 覆盖现有 Human API v3 operation，包括 Room Agent activity；
- canonical Message list/post；
- canonical Thread list/create/reply，并把 reply 从主消息流投影中分离到右侧 Thread；
- canonical Task list/create；
- 当前 Workspace 的 Agent 长期身份目录与 daemon-owned Computer/CLI Runtime inventory 分离；Agent list 必须带该 Workspace 的 control Room scope，跨 Workspace onboard 在 Kernel fail closed；RuntimeProfile/Offer/AgentDefinition binding 只读展示，不从 Computer 页修改 Room；
- Workspace owner/admin 可从 Raft 形态创建窗口提交显示名称、handle、头像 key、角色、描述、指令、RuntimeOffer、推理强度与 session policy；单个 `agent.provision` command 在 Kernel 原子创建长期身份、Definition/Policy 与 Host grant，重载和 daemon restart 后仍存在；
- 同一 Agent 设置窗口读取 canonical current Definition/Policy，并用 `agent.manage` 原子保存新 revision；启用、停用与删除均为真实 Kernel 状态，删除会清理 memberships 和 Host scope，活动工作存在时 fail closed；
- Placement launch claim 固化 AgentDefinition revision，AgentHost 把它注入实际 child process 的 `RAH_AGENT_CONTEXT_JSON`；页面表单不是运行时真相，Runtime credential 也不会进入该变量；
- 从 Room 标题栏/聊天区成员窗口把 Workspace Agent 加入或移出当前 Room；当前状态来自 canonical membership list，重复/并发操作会重新对账；
- 与 Raft channel 一致，Room membership 同时定义普通 Message 的默认投递范围；composer 不提供逐消息收件人复选框，`@Handle` 只把对应成员的 activation reason 提升为 mention，不过滤其他 Room Agent；
- Room Agent chip 展示由 canonical Activation/RunAttempt 推导的空闲、唤醒中、工作中或异常，不读取 CLI stdout/JSONL；
- Task v1 目标保持真实协议边界：选择一个 Agent 时定向指派，选择全部 Room Agents 时创建开放任务；不伪造任意 Agent 子集竞争；
- submitted Task 显示 Agent winner、progress 与 submission summary，并允许 creator 显式 complete；
- 当前 Room 进入 `?room=<roomId>` reload-safe URL projection；重载恢复同一 Room，而不是回退到列表首项；
- Raft 形态 dialog 共用 Escape、Tab/Shift+Tab focus trap、提交期间禁止关闭和关闭后焦点返回协议，不复制第二套视觉样式；
- 请求完成后才调度下一轮的有界 reconciliation：未追平 250ms、正常前台 5s、后台 15s，失败指数退避到 30s；页面重新可见时立即恢复；
- required recovery capability fail-closed，Message/Task/Thread 等可选 capability 独立降级；错误保留当前 projection，并提供显式重新连接；
- Raft `64px rail + 320px sidebar + fluid channel`；
- Chat/Task/Files tabs、composer 的“作为任务”；
- 390px 无横向溢出的响应式壳、底部主导航、可关闭的 Room 抽屉，以及占满可用 viewport 的移动端 Thread；
- Files capability 缺失时明确不可用，不加载 fixture。

尚未接入：

- Human Inbox/Activity；
- Artifact/Review/Files；
- Search、完整 Members detail、Agent skill/memory artifact 与运行中 drain 管理、Computer control/placement、Admin、Settings、Billing；
- hint subscription、生产 token pairing、PWA/desktop packaging。

这些缺口按 capability 逐个打开，不以“让按钮看起来能点”为理由在 UI adapter 中发明后端语义。

## 5. 验收

- snapshot integrity：80 个文件逐一 SHA-256 校验；
- ui-tokens generation：七个 allowlisted CSS/font/icon 输出逐一与 snapshot digest 对照，产品 source/bundle 不含 raw snapshot 路径；
- client SDK：Fake/HTTP 共用 typed schemas，GET/auth/path/error 有 contract test；
- client core：cold reload、backward paginated replay、stable consumer、bounded catch-up、no-progress fence、gap、divergence、apply-before-ack 有确定性测试；
- view model：Message canonical order 与 Task 五列映射有确定性测试；
- browser：`npm run test:web:browser` 自动启动隔离 daemon、两个 Fake CLI runtime、same-origin Vite proxy 与系统 Chrome/Chromium，通过原生 CDP 验证 Workspace Agent 创建、配置 revision、停用、删除与重载持久化、Computer inventory、Room 创建、dialog focus/Escape、成员加入/移除、双 Agent reply、membership-driven delivery、Thread create/reply/count、Task claim/start/progress/submit/Human complete、reload-safe URL，以及 390x844 无横向 overflow 和 Room 抽屉；Human PAT 不进入浏览器，且不启动付费 Provider；
- CI：pull request 和 `main` push 必须执行同一 `npm run test:web:browser`，不能只用 typed/Fake 测试代替真实 Chrome 业务门禁；
- no-token browser regression：`apps/web/test/room-agent-membership.html` 通过注入 typed `FakeRahClient`，覆盖互斥移动导航、drawer、Message post/render、成员 Agent 自动回复、Thread create/reply、Task create、mention attention、stale snapshot、正常 join/remove/rejoin、并发 join 409、Room sequence catch-up 与 reload recovery；fixture 不读取 PAT、不启动 CLI，也不进入 production Vite bundle；完整控件—反馈矩阵见 `apps/web/test/README.md`，新启用的控件没有 typed handler 和浏览器断言时不得交付；
- exploratory multi-Agent sequence：`npm run dev:web:multi-agent-fixture` 仍只负责启动真实 daemon config v4、测试代理和两个 Fake CLI，供人工检查与浏览器 DevTools 使用；自动验收使用独立的 `npm run test:web:browser`。浏览器无须接触 PAT；`dev:web:multi-agent-fixture:lan` 另提供明确、临时的 iOS 实机入口；
- installed local CLI sequence：`npm run dev:web:local-cli-fixture` 把探测到的 Codex/Kimi/OpenCode/Claude AgentDefinition 建在产品 Workspace 的 control Room，并同时启动 same-origin Web 入口；fixture 输出、页面、URL 与 Local Storage 都不含 Human PAT。`:lan` 变体只用于可信局域网，启动只做 executable probe，真正给 Agent 投递工作才可能消耗 provider 额度；
- production build：Vite build 必须独立通过，且不需要 sibling `raft-ui`。
- persistent production workbench：`npm run test:web:workbench` 使用 owner-private 临时 state、production bundle、loopback gateway、fake Codex 与真实 Chrome，证明 canonical Agent reply、进程重启后的同一 Workspace/Room/Agent/Message 恢复、无 token 输入页，以及 390×844 无横向 overflow。
