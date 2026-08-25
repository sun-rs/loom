# ADR-0010：Web/PWA 共享 UI、可移植 Client Core 与薄原生壳

状态：**Accepted for Phase 4 / implementation deferred**（2026-08-26）。本文冻结前端边界，但不授权在 Phase 4 前绕过尚未稳定的 Kernel owner、command 或 sync protocol 编写生产 UI。

## 背景

RAH OS 的早期交付目标是桌面浏览器和安装式 PWA，后续可能增加 Mac App 与 iOS App。与此同时，已获授权的 Raft Web UI 可以提供视觉、组件状态和交互证据，但它不是 RAH OS 的业务状态机，也不能成为第二套 daemon contract。

如果仅以页面为单位复刻，Web、PWA、desktop shell 和原生端会逐渐产生不同的组件、状态、command 和离线逻辑。反过来，承诺所有 DOM/React 代码都能直接进入 SwiftUI，也会掩盖平台能力和渲染模型的真实差异。

## 决策

1. Phase 4 使用 React、TypeScript 和 Vite 构建唯一的响应式 Web UI。普通浏览器、桌面 PWA、iOS Home Screen PWA 与未来 Mac desktop shell 运行同一套 React/DOM 组件和 route composition，不维护第二套 PWA 页面。

2. 前端按可复用程度拆成五层：
   - protocol/schema/identity：所有客户端共享；
   - browser-safe `RahClient` 与 transport contract：所有客户端共享；
   - 无 React/DOM 的 ordered sync、projection、command orchestration 和 view model：Web/PWA/desktop 共享，未来非 Web 客户端可按语言移植并用同一 conformance fixture 验证；
   - semantic token、icon source、component state protocol 和 interaction scenario：跨渲染器共享规格，Web 生成 CSS，原生端如有需要生成平台 binding；
   - React/DOM component：Web、PWA、Electron/Tauri/WKWebView wrapper 直接共享，不承诺 SwiftUI 原样复用。

3. Room/Task/Inbox/Review 的 canonical owner 仍是 Kernel。客户端只保存内存中的 snapshot/delta projection、明确的临时草稿和视图偏好。Service Worker 不缓存业务 API、Room ledger、message 或 Task truth；断线和 reload 统一通过 durable sync 恢复。

4. `RahClient` 是 UI 唯一业务入口。`HttpRahClient`、未来 `DesktopRahClient` 和 `FakeRahClient` 只适配 transport；不得复制 command handler、projection 或授权判断。React component 不直接请求 daemon endpoint，不读取 SQLite，不解析 Provider transcript。

5. 长列表、Markdown/diff 和高频 delta 从一开始采用有界渲染：Room ledger 虚拟化，projection selector 精确订阅，重计算可转移到 Worker，route/component 按需加载。性能以 Phase 4 的固定 fixture 和参考硬件预算验收，不以框架名称代替证据。

6. RaftUI 是授权来源的 evidence/specification 仓库，不是 RAH OS runtime dependency。官方 live DOM、computed style、CSS/icon asset 和真实交互生成版本化 token、state protocol 与 conformance fixture，再由 RAH OS 的 `ui-web` 消费。禁止把官方 bundle 的业务 JavaScript、网络请求或应用状态机直接嵌入 RAH OS。

7. Mac desktop shell 保持薄层：窗口、菜单栏、通知、Keychain、文件选择、daemon 安装/升级/连接。renderer 仍是纯浏览器代码，默认没有 Node 权限；原生能力通过窄 `DesktopBridge` 暴露。Electron 是基于当前 Node daemon 与代码复用目标的首选评估对象，但最终 Electron/Tauri 决策必须由启动耗时、常驻内存、签名、公证、更新和 daemon control conformance 作出。

8. iOS 先交付同 bundle 的 PWA。只有 push/background、Share Extension、MDM、深度文件/相机/语音或可访问性等实测缺口成立时才建立原生 App ADR。若 WebView wrapper 足够，优先保持 React 组件复用；若必须 SwiftUI，则复用 protocol、fixtures、tokens 和 interaction contract，而不是复制 DOM。

9. Phase 4 的推荐代码 owner 是：`client-sdk`、`client-core`、`ui-tokens`、`ui-web`、`web-app` 与后置的 `desktop-shell`。准确目录可随 workspace 布局调整，但 owner 边界不得合并回 route/page。

## 后果

正面：

- Web 与 PWA 的组件和行为可直接 100% 共享；
- desktop shell 不产生第二套业务协议；
- 原生 App 的复用承诺落在可兑现的协议、状态和规格层；
- Raft 视觉证据可以持续更新，而不会把第三方业务实现变成 RAH truth；
- 性能问题可在共享 projection 和渲染边界解决一次。

代价：

- Phase 4 前必须先完成 `RahClient` command/sync 能力和 fake fixtures；
- token/spec generation 与多浏览器视觉门禁需要持续维护；
- SwiftUI 等真正原生 renderer 仍需要独立组件实现；
- desktop shell 框架选择被有意推迟到 daemon control 与打包条件可实测时。

详细 owner、数据流、建议包结构、性能预算和测试矩阵见[前端平台架构](../architecture/frontend-platform.zh-CN.md)。

## 声明边界

- 本 ADR 是 Phase 4 的输入，不表示生产 UI 已开始或完成；
- RaftUI 的像素与交互一致性是 reference conformance，不证明 RAH command 已接入；
- PWA cache、desktop IPC、native notification 和 push 都不是 canonical data owner；
- 未来框架替换不能改变 `RahClient`、ordered sync、command identity 或 Room truth；
- 不因追求代码复用而把 daemon、PTY、filesystem 或 secret 放入 renderer。
