# Web 构建代际与旧页面自愈合同

日期：2026-09-03

状态：`A`（本机正式 Web/daemon）；Raft 可见恢复流程已结构性移植，RAH OS 额外以本地
gateway 的构建代际响应头在 API 解码前阻断新旧混用。

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
- Web bootstrap 在挂载应用和解析业务响应前比较当前 meta 与响应头；
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
暂时继续；继续后保留可见的新版本 banner；刷新前更新同源 Service Worker、清理产品自己
的旧 asset cache，并用 replace 导航，不污染历史。

RAH OS 没有复制 Raft 的中央发布服务。由于本机 gateway 同时拥有 frozen Web release 和 API
edge，增加确定性的 build header fence：它能在旧 parser 读取正文之前发现不匹配。这个增益不
改变 Room/Task/Agent 业务 owner，也不增加模型上下文。

## 3. 不变量

1. `webBuildId` 由完整 emitted bytes（排除 metadata 本身、保留 meta placeholder）计算；相同
   输入连续构建必须得到相同 ID，避免每次 restart 生成新快照。
2. 正式 runner 对缺 metadata、格式错误、重复/缺失 meta、meta 与 manifest ID 不同的 build
   fail closed。
3. initial `HEAD` build probe 是 bootstrap causal fence；15 秒、focus 与重新可见 probe 只负责
   发现后来部署的新代际，不承载业务 truth。
4. API fetch 的 mismatch 必须等待 Human 决策后才把响应交给调用者；错误不能进入任何
   Message/Thread/Task row。
5. “仍然继续”只在当前标签页内忽略已观察到的 server ID；下一次新 server ID 或动态 import
   失败仍重新提示。
6. typed query/deep link 在 refresh 与 recovery nonce 清理后保持不变。
7. connectivity failure 本身不能证明 build stale；网络错误仍由既有连接恢复 UI 处理。
8. modal 默认焦点在“立即刷新”；desktop 横排、390×844 纵排且不溢出；键盘可达。

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
- 隔离 Chromium：强制 server/header mismatch，desktop 与 390×844 分别走 Continue、banner
  Refresh 和 Immediate Refresh；检查焦点、typed URL、布局与零 console error；
- 正式 Chrome：真实部署 A→B→确定性 C 两次代际切换，验证旧标签页 16 秒内出现提示，两个
  决策分支均回到原 typed Settings/Notifications deep link；
- 发布前：全仓 `check`、format、diff、production build 与状态备份后 graceful restart。

实现与实测结果见
[Web 构建代际恢复验证审计](../audits/2026-09-03-web-build-recovery-verification.zh-CN.md)。
