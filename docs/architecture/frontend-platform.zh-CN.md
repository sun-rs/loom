# 前端平台架构：Web/PWA 优先、共享状态内核与薄原生壳

2026-09-21：移动端底部大页入口先显示列表，不恢复成员详情；明确链接和已打开详情缩窄仍保留详情。见[入口合同修正](../audits/2026-09-21-mobile-root-entry.zh-CN.md)。

2026-09-20：大页导航偏好由 workspace-switcher-state 按 Human/Workspace/大页隔离保存；
聊天临时资料侧栏不覆盖成员大页选择。窄屏有选中内容展示右侧，无选中内容展示列表。
详见[选择记忆与响应式验收](../audits/2026-09-20-surface-selection-parity.zh-CN.md)。

2026-09-04 资源维护政策更新：[ADR 0028](../adr/0028-owned-neo-brutalist-ui-library.md)
和 [RAH Neo-Brutalist UI](../design/neo-brutalist-ui.md) 取代下文旧 snapshot→generated
采用描述。资源现在是内部可维护源码，通用展示组件位于 ui-web/src/neo-brutalist；
不存在外部工作树导入或产品覆盖生成器。旧分层中的协议/业务 owner 保持不变。

状态：Phase 4B Anchored Task。Raft UI snapshot→generated `ui-tokens`、覆盖全部现有 v3 route 的 typed `RahClient`、cold-reload-safe ordered client-core 与 Room/Chat/Thread/Task React recovery slice 已经建立；manifest + Service Worker 提供同 bundle PWA shell，正式 HTTPS LAN gate 已覆盖设备配对、Secure/HttpOnly session、Core restart、service worker ready 与 390x844。Room/Task/Agent 的自动真实 Chrome + daemon v4 gate 继续覆盖 Room 创建、成员收敛、双 Agent reply、Thread、Task 顶层 Message/连续编号/讨论 Thread、单 winner、Human complete 和 reload recovery；独立 Firefox 150 production gate 覆盖 desktop/mobile、Agent/Settings/Room drawer、标准 scrollbar declaration 和 strict-CSP 零错误，并由此将 Zod 固定为 bootstrap-first jitless。仍不允许用 mock page 或离线 cache 反向定义缺失的 Kernel 业务协议。

2026-09-14：资料页与 Room/Thread 共享区域按实测宽度分配，保留各面板状态并按剩余空间隐藏正文；参见[布局修复证据](../audits/2026-09-14-thread-inspector-search-parity.zh-CN.md)。

2026-09-14：搜索拥有一列结果和一个可替换预览，Room/DM/Thread/Task共用导航选择；离开搜索清空临时查询和预览，宽度复用共享分隔器。参见[搜索预览证据](../audits/2026-09-14-search-preview-layout.zh-CN.md)。

## 1. 目标与非目标

移动端 document 是固定的应用 viewport，标题、导航、composer 不随整页滚动；
消息和列表由内部滚动容器承担，安全区画布随根页/子页颜色变化。历史 prepend 补偿
必须有固定期限并让位给用户阅读手势；原生复制专页必须隔离普通消息长按菜单。
参见[2026-09-16 修复与验证](../audits/2026-09-16-pwa-scroll-and-native-copy.zh-CN.md)。

异步历史恢复必须尊重请求等待期间的新阅读位置；相同搜索结果不能随后台刷新重复
定位。关闭侧页恢复键盘焦点须使用 preventScroll，诊断尾随也必须让位于尚未派发
scroll 事件的原生滚动。参见[滚动所有者排查](../audits/2026-09-16-scroll-owner-audit.zh-CN.md)。

目标：

- 首先用同一套代码交付桌面 Web、响应式 Web 和安装式 PWA；
- 在不牺牲 Room-first owner 的前提下，为 Mac App 和可能的 iOS App 保留最大可复用面；
- 将 Raft 官方页面中可授权复用的视觉和交互证据变成可追溯规格；
- 对长 Room、多 Agent 状态和断线恢复建立可量化的性能与一致性门禁。

非目标：

- 不把 Raft 官方前端 bundle 当成 RAH OS application runtime；
- 不在 React store、Service Worker、desktop shell 或原生端创建第二套 Room/Task truth；
- 不承诺 React DOM component 可以无成本转成 SwiftUI；
- 不在 Phase 4 前用静态页面填补尚未存在的 daemon command。

当前搜索、动态和聊天采用[共享导航与折叠合同](../product/shared-conversation-navigation.zh-CN.md)：
`conversation-panels` 选择真实来源和最新目标，最多两个内容槽加一个列表，逻辑路径可以更深。
`conversation-layout` 仅依赖可用宽度；列表仍在时最右层显示 X，独占内容区时显示返回。
隐藏不关闭，关闭只退出当前层，保留页面的草稿和测量继续归原组件 owner。
Room 设置抽屉和 Task 详情模态是独立容器，不套用主内容的按钮互斥规则。

## 2. 单向依赖与数据流

```text
Raft live evidence
DOM / computed style / CSS / icons / real interaction
             |
             v
      RaftUI source extractor
             |
       generated, versioned
 token + icon + state + visual fixture
             |
             v
         ui-tokens ------> ui-web React primitives/routes
                                  |
                                  v
Kernel API <-> RahClient <-> client-core projection/selectors
    ^                             |
    |                             v
canonical Room truth       web-app / PWA bundle
                                  |
                           optional thin shell
```

依赖只能向图中下游流动。`ui-web` 可以发出 typed intent，但不知道 HTTP path、IPC channel 或 SQLite。`client-core` 可以投影 Room 数据，但不知道 CSS、DOM 和 native window。desktop shell 可以提供 transport 和平台能力，但不能解释业务事件。

## 3. 五层复用模型

| 层          | 唯一 owner                                                    | Web/PWA/Mac shell | 未来真正原生 App                   |
| ----------- | ------------------------------------------------------------- | ----------------- | ---------------------------------- |
| Protocol    | schema、ID、command、snapshot/delta、capability               | 直接共享          | 生成/移植并跑同一 fixture          |
| Client SDK  | `RahClient`、transport、version negotiation                   | 直接共享          | 对应语言 adapter                   |
| Client Core | ordered reduce、projection、command orchestration、view model | 直接共享          | 可共享 JS runtime，或移植算法      |
| UI Protocol | semantic token、icon、state machine、interaction scenario     | 直接消费          | 生成平台 token，复跑场景           |
| Renderer    | React/DOM route/component                                     | 直接共享          | WebView 可共享；SwiftUI 不共享实现 |

“充分复用”因此不是让每个平台都运行同一个组件文件，而是让业务 identity、state transition、视觉 token 和行为场景只有一个权威来源。Web/PWA/desktop wrapper 可达到最高直接复用；真正原生 renderer 的合理目标是协议与行为一致，而不是 DOM 代码一致。

## 4. 推荐技术栈与 owner

Phase 4 默认技术栈：

- React + TypeScript + Vite：唯一 Web/PWA renderer 与 build；
- React Router：URL、深链和 browser history；
- Base UI 类的 headless primitive：dialog、popover、listbox、tooltip 和 focus management；外观由 RAH token/CSS 控制，不引入带主题的第二套 design system；
- CSS layers + component stylesheet/CSS module：generated token 是输入，页面不散落复制常量；
- `useSyncExternalStore` compatible store：让 Room projection 以精确 selector 订阅 React；
- Web Worker：仅处理足够重的 Markdown、diff、search/index 或批量 projection，不能成为 truth owner；
- Service Worker：只缓存带内容 hash 的 app shell/静态资源和明确可再验证的只读资源。

建议的 Phase 4 package owner：

| Owner                  | 职责                                                                       | 禁止                                     |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| `packages/client-sdk`  | `RahClient` interface、HTTP/desktop/fake transport、版本与 capability 协商 | React、route、业务事件解释               |
| `packages/client-core` | sync engine、内存 projection、selector、optimistic command lifecycle       | DOM、网络 path、持久业务 cache           |
| `packages/ui-tokens`   | 生成后的颜色、字号、间距、边框、icon、motion/state metadata                | 页面逻辑、手工分叉 token                 |
| `packages/ui-web`      | React primitive、复合组件、Room/Task/Inbox/Review view                     | daemon endpoint、Provider parser         |
| `apps/web`             | route composition、PWA manifest、service worker、environment injection     | 第二套 component/store                   |
| `apps/desktop`         | 后置 desktop shell、`DesktopBridge`、安装/升级/通知/Keychain               | Room reducer、command handler、PTY truth |

目录名称在 Phase 4 建仓时可以适配现有 workspace，但每个职责必须只有一个 owner。尤其禁止在 route component 中再实现一次 sync merge、command retry 或 listbox keyboard protocol。

## 5. Client Core 状态协议

### 5.1 canonical 与 ephemeral 分离

客户端状态分成三类：

1. **canonical projection**：来自 server snapshot + ordered delta，仅在内存中维护；
2. **command lifecycle**：`idle -> optimistic -> accepted/rejected -> reconciled`，以 idempotency key、actor 和 `basedOnRoomSeq` 关联；
3. **ephemeral view state**：选中 tab、panel width、scroll anchor、未提交 draft、dialog disclosure。

第三类可以在明确范围内持久化。第一类不得写入 localStorage、IndexedDB 或 Service Worker cache 来冒充 reload truth。草稿若持久化，必须按 actor + Room + surface 隔离，并有大小/过期上限；它不进入 Room timeline，直到 command 被 Kernel 接受。

### 5.2 连接恢复

```text
read capabilities/version
  -> sync(last acknowledged continuation)
  -> validate and reduce ordered snapshot/delta
  -> publish one coherent projection
  -> acknowledge durable receipt
  -> subscribe to content-free hints
  -> each hint triggers bounded sync
```

WebSocket、push 和 desktop notification 全是 hint。UI 不把“socket 当前在线”当成 ledger 已完整，也不直接把 hint payload 写入 timeline。

### 5.3 optimistic update

只对可逆、identity 明确的 command 做 optimistic projection。每次 mutation 必须有稳定 command/idempotency identity；失败恢复该 command 自己的临时投影，不覆盖随后收到的较新 canonical delta。Task 完成、Review 接受、InputRequest resolve 等涉及 authority 的状态以 server event 为最终证据。

所有携带 Room causal sequence 的 UI mutation 先通过 `client-core` 的单一写入屏障追赶到最新 canonical projection，再提交稳定 idempotency key。若提交与并发事件竞速，只有结构化的 `409 stale_context` 可以触发再次追赶与有界重试；permission、validation 和其他失败必须原样返回。不得在 route/component 中复制 retry，也不得把后端的 sequence 校验放宽为 last-write-wins。

## 6. RaftUI 到生产 UI 的边界

RaftUI 保持独立仓库并承担四件事：

1. 从授权的官方 live DOM、computed style、CSS bundle 和 icon asset 提取来源数据；
2. 为 default、hover、active/pressed、focus-visible、expanded、selected、validation failure、submitting、disabled 和 closed 建立交互矩阵；
3. 输出带官方 build SHA、source URL、selector/property provenance 和 hash 的 token/fixture；
4. 在固定 viewport 的 Chromium 与 Firefox 执行视觉和交互回归。

生产 `ui-tokens` 只接受 generated artifact，不接受截图目测后在业务页面散写 magic number。不能稳定提取的差异必须标为 approximation；不能把近似值宣称为官方 CSS。

Agents surface 的官方 Members computed-style token 与像素 avatar pack 也必须经过同一 allowlist/generator 进入 `ui-tokens`。产品组件只读取 generated CSS/JSON 和 canonical `AgentDefinition.avatarKey`，不得在 React 页面复制 palette、网格数据或另建一套响应式 avatar 实现。

Raft 官方 bundle 中的网络/store/权限状态机只用作行为证据，不进入生产。
可清晰分离的展示组件、图标、宽度算法允许固定来源后提取移植；无需一律重写。
采用方式、片段位置、本地差异必须进入 [机器登记](../product/ui-behavior-registry.json)。
生产回调继续连接 typed `RahClient` intent，因为：

- 官方网络 endpoint、store 和权限模型不是 RAH OS 的；
- minified route code 的更新和授权 provenance 难以成为稳定 runtime dependency；
- 直接嵌入会把第三方状态机变成第二个业务 owner；
- 无障碍语义、错误恢复和跨客户端 conformance 需要由 RAH OS 自己负责。

### 6.1 当前预生产隔离线

截至 2026-08-26，独立 `raft-ui` 仓库已将两条运行路径物理分开：

- reference surface 只加载 runtime 与显式 reference fixture adapter，不加载 RAH integration，不发出 HTTP/WebSocket 请求；
- `integrations/rah-os` 只定义由宿主注入的 adapter 和 fake client，不拥有 DOM、CSS、route、endpoint、token 或 transport；
- runtime 没有 adapter 时 fail closed，不再以本地 mock 伪造 command 成功；
- UI intent 需先通过 capability inventory，再由 Phase 4 的单一 mapper 转换为 typed command。

RAH OS 不得在运行时通过相对路径依赖 sibling `raft-ui` 工作树。Phase 4 的交付边界必须是带 source build SHA 和 hash 的 generated artifact，通过 package、copy/generate step 或等价的版本化流程进入 `ui-tokens`/`ui-web`。这样参考页仍可与官方页单独做 1:1 比较，生产适配层也不能反向修改证据基线。

## 7. 布局、交互与组件协议

### 7.1 全局 shell

全局 grid 明确拥有 rail、sidebar、content、inspector 和 overlay root。边框由相邻区域中的一个 owner 绘制，不允许 rail item 或 route page 临时补线。可拖分隔条是独立 `Splitter` primitive，使用 pointer capture、keyboard step、min/max constraint 和持久化 panel width；缩放时由 CSS grid/flex constraint 重新计算，不用页面绝对坐标硬撑。

B1 已将聊天边栏、Thread 和 Agent inspector 的事件处理收敛为
`apps/web/src/components/panel-resizer.tsx`；各 `*-resize.ts` 继续拥有宽度策略，
各 hook 继续拥有持久化。`panel-foundations.css` 拥有共享手柄几何与标题按钮尺寸；
`interaction-state.css` 仍是颜色/状态语法 owner。`product-styles.ts` 是生产与组件矩阵
共用的唯一样式装配入口。页面只保留位置、层级与响应式可见性，不重复定义迁移控件。
B2 首段将 Room / Agent / Thread 标题接入 `PanelHeader`，共享 shell 的 `--head-h`
轨道与单一底边；`panel-layout.css` 接收官方 Panel slots 的结构性移植。
旧 `.channel-head` / `.thread-head` / `.tabs` 选择器不再用于迁移过的生产组件，
冻结 reference 文件不改；页面重复高度/边框覆盖删除。Agent 移动端既有76px组合
保留为显式变体，不强行套桌面轨道。Room / Agent 共用 `PanelTabs` 的循环焦点、
Home/End、禁用项跳过及自身横向滚动；选中值和 capability 仍由原页面传入。
实际应用的 Kernel/daemon 隔离矩阵与组件矩阵使用同一生产入口/样式，测试没有
另造模拟业务状态机。Settings / Computer / 全局发现及完整 Shell 仍按计划迁移，
不把 B1/B2 首段当成全站完成。

### 7.2 overlay

Dialog、popover、listbox、tooltip 和 drawer 使用统一 overlay root 与 stacking token。协议至少包含：

- open/close trigger 与 ARIA relation；
- focus trap/return；
- Escape、outside press 和 nested overlay；
- collision/flip、viewport padding 和 scroll lock；
- loading/disabled/validation/failed 状态；
- reduced motion 和 keyboard-only focus-visible。

表单 disclosure 必须参与正常布局或由明确 overlay primitive 承担；不得通过绝对定位覆盖后续内容。视觉相同不等于交互完成，state scenario 是组件验收的一部分。

### 7.3 intent mapping

RaftUI 的 `intent.*` 是展示层 vocabulary。进入 RAH OS 后由单一 mapper 转为 typed `RoomCommand`：

```text
user interaction
  -> semantic UI intent
  -> capability/permission-aware command builder
  -> RahClient.execute(command)
  -> command lifecycle projection
  -> canonical delta reconciliation
```

component 不自行推断 ACL，不用按钮颜色代替 capability，也不因后端暂缺就伪造成功。

## 8. PWA 与离线策略

PWA 的“可安装”和“离线拥有业务真相”是两回事。初版策略：

- cache-first：带 hash 的 JS/CSS/font/icon；
- network-first：version/capability 和明确可再验证的只读 metadata；
- network-only：Room sync、command、Task/Inbox/Review、artifact mutation；
- 不由 Service Worker 后台重放高风险 command；
- offline 时允许查看当前内存 projection、编辑有界 draft，并明确显示非实时状态；
- reconnect 后先 sync，再决定是否允许提交旧 draft。

iOS PWA 被系统回收不影响 AgentHost。恢复页面后重新执行完整 sync，不从 push payload 或本地 timeline cache 重建 truth。

当前 `apps/web/public/sw.js` 已把该策略落实为第一段可执行门禁：`/v*/...` 和 `/_rah/...` 直接 network-only；navigation 只以最后成功的 app shell 作为离线 fallback；hashed script/style/font/image 才 cache-first。它没有 command outbox、Background Sync、IndexedDB timeline 或 API response cache。真实 iOS Home Screen 生命周期和 WebKit gate 尚未完成。

Web 发布还必须处理“旧标签页 + 新 gateway”窗口。product build 把内容确定的 generation 同时
嵌入 HTML 和发布 metadata；gateway 为所有静态/API 响应返回该 generation。bootstrap 首次
HEAD probe 与全局 fetch fence 在应用挂载/业务 JSON 解码前阻断 mismatch；运行中的标签页在
focus、visibility 和 15 秒有界 HEAD probe 上继续检测。可见行为结构性复用 Raft：全页
刷新/继续 modal、继续后的新版本 banner、同源 Service Worker update、仅清 RAH 自有 cache、
replace 刷新并保持 typed navigation。动态 import failure 走同一 owner；不允许由页面或消息
renderer 各自捕获并展示。完整合同见
[Web 构建代际与旧页面自愈](../product/2026-09-03-web-build-recovery-contract.zh-CN.md)。

## 9. Mac 与未来 iOS

### 9.1 Mac desktop shell

默认先评估 Electron，原因是当前 daemon 与工具链是 TypeScript/Node，Web bundle 可直接复用，打包和 native bridge 路径最短。这不是无条件选择：Phase 4 后置 spike 必须同时量化 Electron/Tauri 在以下项目的差异：

- cold start 与 idle/RSS；
- 签名、公证、自动更新和 rollback；
- daemon install、launchd、version negotiation 与 drain；
- Keychain、文件选择、通知、菜单栏；
- context isolation、CSP、navigation 和 permission hardening。

无论选哪一个，renderer 都通过 injected `DesktopRahClient`/`DesktopBridge` 工作；shell 不暴露任意 filesystem、shell command 或 raw IPC。

### 9.2 iOS

路线固定为：responsive Web -> Home Screen PWA -> 缺口测量 -> 独立 ADR。若只缺 push、share sheet、camera/file picker，可评估 Capacitor/WKWebView wrapper 并继续共享 React UI；若必须使用 SwiftUI，则以 generated schema/client、tokens、golden fixtures 和 interaction scenarios 共享协议，不复制 JSX。

Raft 的 iOS 源码可以用于研究信息架构、native interaction 和 token 对照，但不能反向成为 RAH 的 Room/Task owner，也不能据此提前建立第二套 iOS business core。

## 10. 性能预算

下列是 Phase 4 的初始验收目标，必须在固定参考硬件、浏览器版本和 fixture 下记录实测值。10,000 条 Room Message 的有界 DOM/锚点目标已有独立 Chrome 证据；其余预算仍不得在没有测量时宣称达到：

| 场景                    | 初始目标                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ |
| 10,000 条 Room item     | DOM 节点数量有界，不随总历史线性增长；保留可见 scroll anchor                         |
| 高频 delta              | 每批只更新受影响 selector，禁止全应用 deep clone/re-render                           |
| 输入与 command feedback | 常态下一帧可见；交互期间避免超过 50ms 的主线程 long task                             |
| route load              | route-level code split；初始 shell 与各 route chunk 建立 gzip budget 并由 CI ratchet |
| Markdown/diff/search    | 超过基准阈值后移至 Worker 或分片执行，滚动与输入不被阻塞                             |
| reconnect               | continuation 增量恢复；不得因短暂断线无条件下载全历史                                |
| 390x844 PWA             | 无横向页面溢出；关键 command、composer 与状态持续可达                                |
| Agents desktop/PWA      | 320px 可调 Members sidebar、七标签顺序一致；PWA list/detail/back 不复制第二套状态机  |

具体 KiB、耗时和内存数字在 Phase 4 基准机可用后写入 generated budget，不在没有测量前伪造精度。CI ratchet 只允许在附带证据和 ADR 更新时放宽。

## 11. 测试与发布门禁

### 11.1 分层测试

- protocol：schema golden/invalid fixture、版本兼容、identity；
- client SDK：`HttpRahClient`、`DesktopRahClient`、`FakeRahClient` 跑同一 contract suite；
- client core：snapshot/delta replay、duplicate/reorder/gap、command race、property/fuzz；
- component：keyboard、pointer、focus return、validation、loading、disabled、screen-reader semantics；
- visual：官方 build SHA 对应的 Chromium/Firefox fixed viewport baseline；
- product E2E：真实浏览器的 desktop 与 390x844，另加 WebKit/PWA lifecycle；
- desktop：关闭窗口后 daemon 继续、版本不匹配、upgrade drain、bridge permission；
- performance：10k ledger、burst delta、large Markdown/diff、route bundle budget。

### 11.2 Phase 4 入口条件

开始生产 UI 编码前至少需要：

- `RahClient` 拥有 UI 首批页面所需的真实 read/command/capability contract；
- snapshot/delta continuation 与 error model 稳定；
- fake client fixtures 可以完成 Room、Task、Inbox/Review 的核心 scenario；
- RaftUI source provenance、state matrix 和 browser gate 可重复执行；
- CORS/origin、token storage、CSRF 与 renderer security 边界已有明确方案。

### 11.3 Phase 4 退出条件

- 同一 Web bundle 在普通浏览器、桌面 PWA 和选定 desktop shell 中通过 contract suite；
- desktop 与 390x844 的关键 route 在真实浏览器完成 keyboard/pointer/resize/reconnect 验收；
- 关闭所有 UI 不影响 daemon 中的 Activation；
- UI 不解析 Provider output 作为 Room truth；
- 无业务 API 被 Service Worker 或 local persistence 变成第二套 canonical cache；
- 视觉差异、行为差异和暂未实现 capability 都能由自动报告明确区分。

## 12. 当前阶段继续做什么

Phase 4A foundation 已开始。当前 Room slice 已实现有界 snapshot/delta catch-up、ack-after-apply、可跨轮次续页的 Message/Thread projection、Thread create/reply、可见性驱动 reconciliation、失败退避、capability-aware degradation、本机 Runtime inventory、Workspace-scoped Agent 目录与当前 Room 成员管理、membership-driven Message delivery、mention attention、Agent current status、server-owned 当前 Human + canonical role 权限投影、reload-safe `?room=`，以及 390px Room 抽屉和底部主导航。Message 时间线保留 Raft Chat 的 50 条分页、稳定 Message ID 与 1.2 秒动态测量锚点协议，并用独立虚拟化 owner 约束 Mounted DOM；真实 1440×1000 Chrome fixture 在 10,000 条变高 Message 加载、再向前增加 50 条后保持不超过 80 个 Message DOM 和 2px 锚点预算。Agents 已切换为单一 owner 的 Raft Members 结构：官方头像 preset、320px 可调边栏、七标签、共享组件的 390px list/detail/back、typed `agent.room.list` 聊天目录，以及由 Codex/Kimi/OpenCode/Claude 结构化事件驱动的 typed `agent.trajectory.list` 动态页都进入 protocol/fake gate；关系图、Agent-to-Agent 私信创建、提醒、工作区与应用仍显示明确不可用态。Raft 形态 dialog 复用同一 Escape/焦点闭环协议，不新增视觉分支。Room membership 定义普通聊天的默认投递范围，`@mention` 只提高注意力；只有 Task 模式才提供单一 assignee 或全部成员开放竞争的目标选择。下一批工作是：

1. 完成系统/iOS CA trust 安装、CA 轮换/告警与正式安装入口；本地 CA/叶证书 provision、allowed-origin、设备 pairing、server-side token、CSRF/Fetch-Metadata 和 renderer 边界已经由 ADR-0019 落地；
2. 增加 content-free SSE/WebSocket hint；当前 polling 只是可靠性 backstop，不能成为实时语义 owner；
3. Human Inbox/InputRequest 与 Activity 已开放并完成 desktop/390x844 真浏览器闭环；下一步增加通用 Notifications、content-free hint 与 typed global deep link；
4. Raft Admin 及其余已授权 route 的 source extraction、状态矩阵和浏览器 regression；
5. 扩展 clean-release provenance、responsive、keyboard、a11y 与 performance gate；
6. Artifact/Review 形成 Kernel owner 与 typed contract 后再接入 Files/Review。

当前 `raft-ui` 的 RAH capability inventory 是后端就绪度清单，不是 endpoint 设计或隐式 API 承诺。标记为 blocked/provisional 的 intent 必须等 Kernel owner 与 typed contract 成立后再接入；不得为了让静态 UI “能点”而在 adapter 内发明业务语义。

这些工作会让 Phase 4 不再从静态 mock 重写一遍，但不会提前夺走 daemon/core 尚未完成的 owner。

## Computer 手动扫描与批量状态操作

`agent.workspace.summary` 由 protocol 定义、AgentHost 读取，application-service 在 I/O 前后
验证 Agent manager；请求只接受 Agent ID，不接受路径。摘要复用现有 root-scoped reader，
最多 128 目录，返回 absent/ready 和 truncated，不建立持久文件索引。
ComputerWorkspaceSummary 只保存当前手动扫描结果；离开范围取消并丢弃晚响应。
ComputerAgentControls 只组织选择和串行调用既有 agent.manage set_state；失败重试保留同一
幂等键，成功项以 canonical Agent 状态跳过。启用/停用不代表进程直接启动/终止。
来源、自动及真实验证边界见[本批审计](../audits/2026-09-07-real-cli-and-computer-closure.zh-CN.md)。

Computer 的批量 restart/session/full 同样复用现有 AgentExecutionResetDialog 和 daemon
`agent.execution.reset`。当前确认窗口冻结选择与每项幂等键，只缓存已确认成功项；不建立
持久批量队列。换范围取消后续项，已接受命令由原管理 fence 完成，详见
[批量重置审计](../audits/2026-09-07-computer-bulk-reset-closure.zh-CN.md)。

## Room 与 Thread 自适应列

单一呈现测量 owner `use-conversation-layout` 沿 Raft 的可用容器宽度与横竖屏条件选择并排、替换正文、全屏；不以固定1280px抽屉覆盖部分正文。sidebar拖动参与可用宽度计算，切换仅影响布局，不卸载已有消息、草稿与scroll owner。来源与边界见 [响应式修复](../audits/2026-09-11-conversation-responsive-parity.zh-CN.md)。

Search 首页的常用项按搜索打开的实体排序，历史查询与实体使用偏好分离；消息列搜索标题消费 Kernel 有界根消息摘要。来源与验证见 [Search 修复](../audits/2026-09-12-search-home-result-parity.zh-CN.md)。

## 2026-09-12 移动导航布局修正

该历史底栏决策已被用户于 2026-09-14 的[移动端主导航抽屉](../audits/2026-09-14-mobile-navigation-drawer.zh-CN.md)决策替代：所有移动页面保留固定左上角入口，导航覆盖滑出，正文不再为底栏预留空间；桌面和移动端共用 Rail 目的地。任务默认视图按实际容器宽度选择，手动选择优先。共享组件与业务 owner 不变；[实现与验证](../audits/2026-09-12-mobile-navigation-and-task-layout.zh-CN.md)。

## 2026-09-12：构建探测不得阻塞客户端恢复

Web bootstrap 与版本 HEAD 探测并行；成功 API 响应不等待刷新 modal 决策。探测限时 3 秒，
不同响应报告的版本变化在后台共享一次新鲜 HEAD 验证。连接、Agent 与 Room 数据恢复仍归
现有 Client SDK/App owner；不增加业务缓存或第二套状态。参见
[恢复审计](../audits/2026-09-12-nonblocking-build-recovery.zh-CN.md)。

频道设置与成员子页的标题区域遵循共享 --head-h；portal 在短窗口中使用同一高度分支。用户要求的标题/描述规格与 Raft 实景差异见 [截图 UI 收口](../audits/2026-09-12-screenshot-ui-closure.zh-CN.md)。Markdown/HTML 预览沿用 room-files 的单一视口外壳，文档大纲属于现有安全渲染层，不建立第二条附件读取或消息导航路径。

2026-09-12：侧栏上下文菜单复用 Base UI ContextMenu，分区/隐藏 DM 由 HumanSidebar
持久保存；重新打开 DM 由 canonical open 命令同事务恢复显示。标为未读由 HumanActivity
显式操作处理，前端仅暂停当前页面的自动读取直到重新进入，不建立第二份未读计数。
[后端规则与证据](../audits/2026-09-12-sidebar-context-menu-parity.zh-CN.md)。

## 2026-09-13：Agent 目录读取恢复

Agent 与 Human 目录复用 `useReconciledQuery` 的可见性轮询、超时及 scope/client 隔离。网络错误不等于空目录，首次失败可自动恢复；不使用持久缓存替代后台真值。见[复现和修复证据](../audits/2026-09-13-agent-directory-network-recovery.zh-CN.md)。

2026-09-14：聊天侧栏的分组顺序由 HumanSidebar 的 `sectionOrder` 保存，旧偏好默认补齐系统组。分组与会话共享 sortable 交互，移动清除旧位置，删除自定义分区恢复默认归属；系统分区不可改名或删除。见[侧栏分组证据](../audits/2026-09-14-sidebar-groups.zh-CN.md)。

搜索结果列表的关键词标黄只由当前搜索词派生，不能复用正文定位的点击清除状态。列表在跳转、点击和滚动后保留关键词，正文定位仍独立清除；离开搜索统一清空结果。

侧栏拖动的短暂布局快照属于 SidebarDrag 呈现层，拖动 over 只调整预览；鼠标释放通过 HumanSidebar 提交一次版本栅栏 patch。保存期间保留预览，失败/取消恢复已确认投影，不引入第二份持久会话归属。

2026-09-14 移动主页细化：主页覆盖聊天时不标记后台聊天选中，搜索/动态统一从导航抽屉进入；主页与抽屉共用同位置工作区标题。触摸上下文菜单由共享 owner 锁定背景滚动并区分滑动与外部点击。见[实现与验证](../audits/2026-09-14-mobile-home-context-menu-stability.zh-CN.md)。

2026-09-14 最新移动导航决策：[iOS 风格根导航](../audits/2026-09-14-mobile-ios-tab-navigation.zh-CN.md)替代上文左侧抽屉。首页/任务/成员/设置共享底部浮层导航，详情隐藏并使用原有逐层返回；搜索、动态、铃铛回到首页。屏幕内可编辑搜索控件采用移动 16px 字号并保留手动缩放。业务状态及导航动作 owner 不变。

2026-09-20 [会话未读统一合同](../audits/2026-09-20-conversation-unread-rule.zh-CN.md)：HumanActivity 合并普通消息与正文系统通知，sidebar bold/badge 共用 summary；列表点击统一确认当前会话边界，不新增浏览器计数。

2026-09-20：首次初始化排队状态由 Kernel 从现有 Activation/first-run event 投影为
presence 的 initializing 原因，底栏显示“等待初始化”；真实工作仍依赖 RunAttempt/轨迹。
[初始化和动态栏证据](../audits/2026-09-20-agent-first-run-greeting.zh-CN.md)。

初始加载与轮询遵循[统一加载状态和等待修复](../audits/2026-09-21-pwa-loading-performance.zh-CN.md)：同一读取不被定时刷新取消，后台读取保留现有内容，Room 诊断不阻塞正文。
