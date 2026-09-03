# 转发附件与移动回归验收

日期：2026-09-04。范围：P2.3 单机、同 Workspace 的普通消息附件转发，以及全浏览器回归发现的移动入口问题。

## 结论与来源

普通消息的附件已能随 canonical forwarded bundle 转发。目标 Room 使用独立附件身份与 ACL，
源/目标 Room 任一删除不会回收另一方仍使用的数据。前端复用既有文件预览组件；不把源附件 URL
直接嵌入目标会话，也不由浏览器提交可信附件快照。

Raft 授权生产 bundle `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`：

- 约 `3225000`：`attachmentSnapshots`、`attachmentPolicy: "projected"`、`provenanceState: "available"`。
- 约 `3229800`：发送 source IDs、destination IDs、requestId、note；服务端生成可信快照。
- 约 `2907900`：只有 projected 附件可交互，复用图片预览/文件 chip。

这些是前端发布物的行为事实。Raft 中央 blob/数据库后端不在现有源码中；本批的目标附件 ID、
SQLite 事务和 POSIX hard link 是适应 RAH OS 单机结构的本地实现，不能声称逐字复制 Raft 后端。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 没有对应转发 owner；只继续复用此前已引入的
durable GC receipt/reconciler 经验，没有引入 PostgreSQL 或另一套 GC。

## 所有权与审查

- `MessageForwardingService`：认证来源成员、冻结快照、目标 ACL、逐目标事务、幂等 replay。
- `RoomFiles`：目标附件 ID、源元数据/普通文件验证、hard link、失败回滚、启动孤儿回收。
- Protocol/Application Service/SDK：typed projected bundle 和传输；旧纯文本 schema 46 数据仍可读。
- `ForwardedMessageBundleView`：仅渲染 canonical projected 附件，使用共享 `MessageAttachments`。

审查确认目标 ID 不同、inode 相同；每个目标有自己的 `room_files` consumed 行并绑定目标消息。
源 SHA-256 与冻结元数据核对，不在每次转发全量重哈希文件。投影失败回滚本目标的消息、文件行和已建 link；
文件系统写入后/数据库提交前崩溃留下的孤儿在启动回收，或被确定性重试核对 inode 后接管。
已提交 replay 不依赖重新读取源字节；永久删除源 Room 会删除源请求回执，但不删除目标 bundle。

性能边界：不会按目标数量复制文件数据块，也不新增常驻计时器；每个目标仍增加目录项/DB 行。
启动孤儿检查目前扫描本机文件目录与引用 ID，不代表已完成海量文件规模的性能验收。

## 自动与真实浏览器证据

定向测试覆盖目标身份/ACL、双目标共享 inode、目标 Files 列表与下载字节、请求幂等、源/目标删除 GC、
多附件中途失败回滚、启动孤儿恢复、Protocol projected 形状、Application Service 上传→发消息→转发→读取。
测试状态先建立失败，再实现转绿；没有使用付费 Provider。

真实 Chrome 的完整 `npm run test:web:browser` 已通过，附件链路包括：

1. 在 Design Lab 上传文本附件并发布消息，通过消息选择→转发 dialog 发到 Agent Council。
2. 核对目标附件 ID/Room ID 不同于源；转发卡可打开共享预览，展示真实文件内容；Escape 关闭。
3. 刷新后卡片仍存在；390×844 下附件卡不越界且 `scrollWidth=390`。
4. 查看原消息跳回 Design Lab 并聚焦源消息。

返回标识：`RAH_REAL_BROWSER_GATE`，Chrome 应用路径
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，最终 viewport `390x844`。
附件内容验证使用隔离状态和真实浏览器 DOM/API，不代表操作系统下载面板验收。

另外两条完整门禁通过：

- `npm run test:web:firefox`：Firefox 150.0.2，1440×1000、390×844、persistent。
- `npm run test:web:workbench`：Chrome production build、真实 fake child reply、provider session resume、
  persistent restart、seamless browser restart、390×844。

Firefox 全链路额外发现并修复了两个产品回归：Computer 详情返回列表后根导航没有恢复；
移动 Home 只显示静态 Workspace 名称，隐藏 rail 后无法切换空间。后者对照 Raft 约 `2779369`
的 `mobile-server-switcher-menu`，共享 `WorkspaceIdentity`，而非另造移动菜单；390px 下宽 374px，
Escape 返回 trigger。组件合同失败→修复通过；Firefox 实际 pointer 验证菜单开关与几何。

正式截图人工复核还发现移动 Home 图标缺失：按钮引用了不存在的 `home` symbol。已从 Raft
`y3e/x3e`（约 `1834029`）逐字引入 `house` 的两条 SVG path，并补共享 Icon 映射、先失败的来源
合同测试与四项导航图标 `getBBox()` 非零的浏览器断言。不是新画图标，也不以按钮可点击代替视觉验收。

附件截图还暴露共享 FilePreview 的既有遮罩问题：消息行 `contain: layout` 成为 fixed containing block，
使遮罩只覆盖一条消息。保留消息性能隔离，将预览层通过已有 `createPortal` 挂到 `document.body`，
继续复用 `useDialogProtocol` 的 Escape/focus trap/focus return。新增失败→通过的组件测试和浏览器
全视口 bounds 断言；不能以“预览文字能读到”替代遮罩几何验证。
Portal 同时纳入既有共享 button reset/按钮交互作用域，避免脱离 Shell 后退回浏览器原生按钮边框。
预览下载按钮的 computed border 也加入真实浏览器断言。

## 最终质量门禁与正式部署

最终冻结生产代码后，串行执行以下门禁，均 exit 0：

| 门禁                                        | 结果                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run check`                             | TypeScript 通过；核心 862 通过 / 2 个 opt-in 跳过；Web 263 通过；parity regression 34 通过 |
| `npm run test:web:firefox`                  | Firefox 150.0.2，桌面与 390×844、持久化链路通过                                            |
| `npm run test:web:browser`                  | Chrome 完整业务回归及本批附件/遮罩断言通过                                                 |
| `npm run test:web:workbench`                | 生产构建、隔离 fake child 回复、resume、持久化重启、浏览器无缝重连通过                     |
| `npm run format:check` / `git diff --check` | 通过                                                                                       |
| `npm audit --omit=dev`                      | 0 vulnerabilities                                                                          |

日志为 `/tmp/rah-os-p23-release-{check,firefox,chrome,workbench}.log`。
隔离附件截图位于 `/tmp/rah-p23-forward-visual-WxXEFT/`：桌面转发卡、全视口预览和移动转发卡均已人工查看。
Chrome/Firefox 测试均运行真实浏览器引擎的 headless 模式；没有据此宣称手动操作官网或 OS 下载面板通过。

正式环境交付复核：

- 停机前确认全部 30 Activation completed、30 RunAttempt exited、30 runtime process terminated；
  Placement/独占操作 lease 均已释放，无待处理取消、Computer operation、Workspace lease 或 InputRequest。
- 私有备份 `/Users/sun/.rah/backups/pre-p23-final-20260904-WfxU89`，约 48 MB；SQLite `.backup` 的
  `quick_check` 与 `foreign_key_check` 通过；配置、附件和 Agent memory 已备份，未输出凭据。
- 对原 PID `73557` 发 TERM，确认退出和端口释放后启动正式持久化实例，新 PID `82767`。
  地址仍为 `http://127.0.0.1:4173`，`/_rah/health` 返回 online。
- 实际提供资源 `/assets/index-CKdw_xMV.js`，build ID
  `237ee955eb67a8a94b7411a6b1c4c682afe4e09ea95a2d38bb8ab384add217b6`。
- 重启后仍为 6 Room、40 Message、4 Agent、1 Task、0 转发测试请求；memory 与备份目录逐文件相同。
  正式环境未发送测试消息、未调用付费 Provider。
- 新建 Chrome/Firefox 页面都完成 1440×1000 与 390×844 验证：消息刷新、菜单点击、Escape 后焦点恢复、
  当前空间选择返回 Home、四个导航 SVG 几何非空。桌面菜单宽 256px；移动菜单 x=8、宽374px，页面无横溢。
  页面异常与可见 NetworkError/JSON.parse/Failed to fetch 均为 0。焦点验证等待既有 RAF 恢复完成，
  不把菜单卸载的瞬间当作焦点返回完成。
- 正式截图目录：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-p23-formal-final-yiUiFK/`。
  已查看 Chrome 桌面 Room/移动菜单与 Firefox 桌面菜单/移动 Home，确认本次修复的图标、布局与边界。

证据等级是代码审查、自动检查、本地真实浏览器及正式部署验证；本报告由实施代理复核，
不是独立第三方审计。没有官方同前置双边附件验收，不据此提升为全量 Raft parity。

## 未覆盖与下一顺序

1. **P2.4 转发历史正文搜索**：现有 Search 索引外层附言，未索引 bundle 内正文；应先从 Raft 明确结果
   呈现和目标/源 ACL 语义，再增加单一索引 owner。
2. **P3 其他 Chat 交互**：消息编辑/删除、完整 emoji picker、回应者浮层，仍依各自行为合同处理。
3. nested forwarded bundle、system/action 来源继续显式拒绝；没有静默遗漏内容。
4. 跨 Workspace/跨 Computer 不属于本批；本机 hard link 不是远程文件传输。
5. 本批没有执行同前置官方 Raft 附件转发，也没有真实 Provider 测试。证据是代码/自动/本地真实浏览器，
   不能由此宣布所有页面与 Raft 100% 一致。
