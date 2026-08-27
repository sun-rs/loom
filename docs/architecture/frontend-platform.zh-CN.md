# 前端平台架构：Web/PWA 优先、共享状态内核与薄原生壳

状态：Phase 4A Foundation。Raft UI snapshot→generated `ui-tokens`、覆盖全部现有 v3 route 的 typed `RahClient`、cold-reload-safe ordered client-core 与 Room/Chat/Thread/Task React recovery slice 已经建立；自动真实 Chrome + daemon v4 browser gate 已完成 Room 创建、成员收敛、双 Agent reply、Thread、Task 单 winner、Human complete、reload recovery 与 390x844 验收，仍不允许用 mock page 反向定义缺失的 Kernel 业务协议。

## 1. 目标与非目标

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

Raft 官方 bundle 中的 application code 只用作行为证据和协议理解。RAH OS 重写 component logic 并连接 typed `RahClient` intent，因为：

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

下列是 Phase 4 的初始验收目标，必须在固定参考硬件、浏览器版本和 fixture 下记录实测值；当前文档不宣称已经达到：

| 场景                    | 初始目标                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ |
| 10,000 条 Room item     | DOM 节点数量有界，不随总历史线性增长；保留可见 scroll anchor                         |
| 高频 delta              | 每批只更新受影响 selector，禁止全应用 deep clone/re-render                           |
| 输入与 command feedback | 常态下一帧可见；交互期间避免超过 50ms 的主线程 long task                             |
| route load              | route-level code split；初始 shell 与各 route chunk 建立 gzip budget 并由 CI ratchet |
| Markdown/diff/search    | 超过基准阈值后移至 Worker 或分片执行，滚动与输入不被阻塞                             |
| reconnect               | continuation 增量恢复；不得因短暂断线无条件下载全历史                                |
| 390x844 PWA             | 无横向页面溢出；关键 command、composer 与状态持续可达                                |

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

Phase 4A foundation 已开始。当前 Room slice 已实现有界 snapshot/delta catch-up、ack-after-apply、可跨轮次续页的 Message/Thread projection、Thread create/reply、可见性驱动 reconciliation、失败退避、capability-aware degradation、本机 Runtime inventory、Workspace-scoped Agent 目录与当前 Room 成员管理、membership-driven Message delivery、mention attention、Agent activity、server-owned 当前 Human + canonical role 权限投影、reload-safe `?room=`，以及 390px Room 抽屉和底部主导航。Raft 形态 dialog 复用同一 Escape/焦点闭环协议，不新增视觉分支。Room membership 定义普通聊天的默认投递范围，`@mention` 只提高注意力；只有 Task 模式才提供单一 assignee 或全部成员开放竞争的目标选择。下一批工作是：

1. 为生产浏览器完成明确 allowed-origin、pairing/token storage、CSRF 与 renderer security；
2. 增加 content-free SSE/WebSocket hint；当前 polling 只是可靠性 backstop，不能成为实时语义 owner；
3. 完成 Human Inbox/Activity 与 Task discussion anchor 后再开放对应页面；
4. Raft Admin 及其余已授权 route 的 source extraction、状态矩阵和浏览器 regression；
5. 扩展 clean-release provenance、responsive、keyboard、a11y 与 performance gate；
6. Artifact/Review 形成 Kernel owner 与 typed contract 后再接入 Files/Review。

当前 `raft-ui` 的 RAH capability inventory 是后端就绪度清单，不是 endpoint 设计或隐式 API 承诺。标记为 blocked/provisional 的 intent 必须等 Kernel owner 与 typed contract 成立后再接入；不得为了让静态 UI “能点”而在 adapter 内发明业务语义。

这些工作会让 Phase 4 不再从静态 mock 重写一遍，但不会提前夺走 daemon/core 尚未完成的 owner。
