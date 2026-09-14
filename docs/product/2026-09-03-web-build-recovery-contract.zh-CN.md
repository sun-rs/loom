# Web 构建代际与旧页面自愈合同

日期：2026-09-03；恢复策略修订：2026-09-12

状态：`A`（本机正式 Web/daemon）；Raft 可见恢复流程已结构性移植，RAH OS 额外以本地
gateway 的构建代际响应头在后台检测版本变化。版本提示不阻断挂载或已成功的 API 响应。

## 1. 问题与 owner

正式服务重启后，已经打开的标签页仍可能运行旧 JavaScript。它随后向新 daemon 请求数据时，
旧 schema/parser 会把版本不兼容误报成 `JSON.parse`/Zod 错误；旧实现又把同一个 transport
错误投影进每条 Message，造成用户看到“每条回复后都出现错误”。

本合同固定单一职责：

- Vite product build 产生内容确定的 `webBuildId`，写入 `index.html` meta 与
  `.rah-web-build.json`；
- `snapshotWorkbenchAssets` 只冻结 identity 完整且相互匹配的 product build；
- loopback/LAN gateway 从冻结目录读取一次 identity，并为静态响应和 Client API 响应添加
  `x-rah-web-build-id`；
- Web bootstrap 独立挂载应用，并在后台比较当前 meta 与响应头；
- Service Worker 只管理 `rah-os-shell-*` / `rah-os-assets-*`，不删除同源其他产品 cache；
- Room/Message projection 不拥有、复制或渲染构建代际错误。

## 2. Raft 来源与采用范围

来源是 2026-08-31 已登录 `app.raft.build` 冻结发布 bundle：

- 文件：`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`；
- SHA-256：`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`；
- `vite:preloadError` 候选位于 byte offset `1,891,898`；
- 刷新/继续文案候选位于 offsets `1,521,040` / `1,521,237`；
- recovery owner（Service Worker update、`slock-assets-` cache 清理、`raft_recover` replace）
  位于 offsets `3,419,383` / `3,419,863`。

采用的 Raft 合同：识别动态 import 失败；在全页 modal 中明确要求刷新但允许 Human
暂时继续。按用户后续要求，RAH 不再显示横向 banner；立即刷新使用原生链接导航，
Service Worker 更新与产品 cache 清理尽力异步执行，不阻断导航。

RAH OS 没有复制 Raft 的中央发布服务。由于本机 gateway 同时拥有 frozen Web release 和 API
edge，增加确定性的 build header 检测。2026-09-12 撤回等待 Human 决策才返回 API 的
额外屏障：它会导致客户端读取超时、成员和消息看似消失；构建变化也不等于协议不兼容。
实际协议校验仍由 Client SDK 的版本与 schema 边界承担，不改变 Room/Task/Agent owner。

## 3. 不变量

1. `webBuildId` 由完整 emitted bytes（排除 metadata 本身、保留 meta placeholder）计算；相同
   输入连续构建必须得到相同 ID，避免每次 restart 生成新快照。
2. 正式 runner 对缺 metadata、格式错误、重复/缺失 meta、meta 与 manifest ID 不同的 build
   fail closed。
3. initial `HEAD`、15 秒、focus 与重新可见 probe 均为后台检测，限时 3 秒，不能阻止应用
   挂载。版本检测不承载业务 truth。
4. API fetch 的成功响应直接返回；mismatch 在后台用独立新鲜 HEAD 验证，同一时刻共享
   一次验证，避免缓存旧响应头误报与并发探测风暴。刷新 modal 不扣留 API 正文或消耗
   业务读取期限。
5. “仍然继续”只在当前标签页内忽略已观察到的 server ID；下一次新 server ID 或动态 import
   失败仍重新提示。
6. typed query/deep link 在 refresh 与 recovery nonce 清理后保持不变。
7. connectivity failure 本身不能证明 build stale；动态 import 失败显示“页面资源加载失败”，
   不宣称旧版本。若应用尚未挂载，不提供会留下白屏的“继续”；已挂载时允许关闭提示。
   重试继续失败时保留准确错误，网络恢复后的显式重新加载须保留原 deep link。
8. modal 默认焦点在 dialog 容器；desktop 横排、390×844 纵排且不溢出；键盘可达。

## 4. 明确不做

- 不自动刷新并静默丢弃 draft；Human 仍做最终决定。
- 不缓存 Client API 或用 Service Worker 建立第二套 timeline truth。
- 不把协议/schema 兼容全部等同于 Web build 相等；未来独立 daemon/UI 发行仍需要显式 API
  capability/version negotiation。
- 不在本批自动删除历史 `.workbench-web` 快照；先用确定性 ID停止重复增长，旧快照 GC 需独立
  retention/active-reference 合同。

## 5. 验收合同

- 单元：错误分类、URL 保持、产品 cache allowlist、metadata 解析、gateway root/API header、
  不完整构建拒绝；
- 构建：两次相同 product build ID 相同；
- 隔离 Chromium：强制 server/header mismatch，desktop 与 390×844 分别走 Continue 和 Immediate Refresh；检查焦点、typed URL、布局；
- 隔离浏览器：悬挂初始 probe 仍须挂载；mismatch 弹窗存在时已返回正文仍可读取；真实
  Core + 假 Provider 的成员和消息仍可恢复，断线重连不要求 token；
- 正式 Chrome：真实部署 A→B→确定性 C 两次代际切换，验证旧标签页 16 秒内出现提示，两个
  决策分支均回到原 typed Settings/Notifications deep link；
- 发布前：全仓 `check`、format、diff、production build 与状态备份后 graceful restart。

实现与实测结果见
[Web 构建代际恢复验证审计](../audits/2026-09-03-web-build-recovery-verification.zh-CN.md)。

2026-09-12 修订证据见 [非阻塞构建恢复审计](../audits/2026-09-12-nonblocking-build-recovery.zh-CN.md)。

## 2026-09-12 重复恢复修订

仅给 HTML URL 或入口脚本添加参数不足以通过 WebKit 连续模块失败后的恢复测试。
HTTP gateway 对带合法 `rah_recover` 时间 nonce 的 HTML，将入口 script 的 `/assets/`
地址改为 `/_rah/recover/<nonce>/assets/`。相对模块依赖自然保留本次前缀，由同一 gateway
映射回同一冻结资源；不改 Room/消息链接，不生成第二套构建，不执行自动刷新。

恢复资源仅允许 assets 下的普通路径，拒绝 traversal/编码路径/API 别名；响应 no-store。
不存在的脚本返回 404，不能用 HTML fallback 假装模块成功。该行为为 RAH 的 WebKit
失败恢复补强，已有 Raft 证据只支持其 nonce 导航，不宣称此模块图地址方案来自 Raft。

门禁先阻断 mount-app 模块，连续点击重载两次，再恢复资源；原生 nonce 链接方案在
WebKit 未挂载超时。更换整个相对模块图入口后，Chromium 与 WebKit 均通过。只换入口
脚本 query 或改成 location.reload 的对照实验仍失败。真机 iOS 网络现场尚待用户复验。
