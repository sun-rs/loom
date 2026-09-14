# 2026-09-12：构建探测阻塞白屏与数据读取修复

## 根因与边界

用户报告 Tailnet HTTP 可访问但页面间歇空白，或看不到本机 Agent 和对话。正式浏览器旧标签页
出现刷新提示及成员读取超时；原生刷新后四个原有 Agent 恢复。持久状态未被迁移或清空。

源码确认两个独立阻塞：`main.tsx` 等待没有期限的初始 HEAD 完成后才挂载；
`web-build-recovery.ts` 在响应头版本不同后等待 Human 关闭 modal 才返回已经成功的 API
响应，消耗业务读取期限。二者均用冻结正式 bundle 的隔离 Chromium 回归先复现失败。
这证明上述失败路径存在，不声称已采集 iOS 现场网络日志或排除了所有网络中断。

## 单一 owner 与实现

沿用 Web 的构建恢复 owner、现有刷新 dialog 和原生刷新链接，不增加业务队列或存储。

- 应用挂载与版本检查并行。
- 所有 HEAD 探测限时 3 秒；失败由既有连接恢复处理。
- 成功 fetch 立即交给客户端；不同版本头在后台共享一次新鲜 HEAD 验证，防止缓存旧头
  误报，确认后才显示提示。
- Human 的继续/刷新决定不再扣留业务响应。仍不自动刷新或丢弃草稿。
- HTTP、无浏览器 token/cookie 的 trusted-network 配置保持不变；内部身份与协议校验保留。

这是修正 RAH 自加的构建屏障。Raft 动态 import 错误恢复来源及采用范围仍见
[构建恢复合同](../product/2026-09-03-web-build-recovery-contract.zh-CN.md)，未宣称双边实测。

## 验证

- `scripts/run-web-build-recovery-browser-gate.mjs`：新增挂住 HEAD 仍须挂载、已接受 JSON
  不被 modal 扣留。修复前两项分别以挂载超时、正文返回 blocked 失败；修复后通过。
  既有桌面/390×844、继续、缓存清理挂住仍可立即刷新、历史响应头不误报也通过。
- `scripts/test-trusted-reconnect-browser.mjs`：真实 Core、临时数据库、假 Provider；验证
  503 后重连不索取 token、挂住初始 HEAD 仍显示消息、版本提示期间成员及消息仍加载。
  Chromium 与 WebKit 均通过。
- 未运行付费 Provider；未执行真机 iOS 安装式 PWA 验收。

## 正式部署结果

已通过空闲检查、完整状态备份和 graceful restart，继续使用原 `~/.rah/state`。
正式冻结构建为 `8408ff18191e2238b503b67726a94c2b3787e094932c51bc8fdc8d9d37840895`。
正式 Tailnet HTTP 页面经 Chromium 与 WebKit 的 390×844 新上下文验证，均显示原四个 Agent、
原有 Agent 配置、非空历史消息、可用 composer 与固定底部导航；连续两次刷新后仍有历史消息。
检查了 WebKit 正式消息页面截图。实际用户标签页的原生“立即刷新”也加载了该构建。

正式新上下文无 cookie；SDK 部分请求携带公开占位串 `trusted-proxy-auth`，它不提供认证能力。
无 Authorization 的独立 health 请求也成功。首次使用浏览器请求拦截器删除该占位头，在
WebKit 连续导航时报告一次 access-control 请求错误；正常浏览路径不拦截请求时两引擎均
无 pageerror。导航取消旧请求会产生 cancelled/ERR_ABORTED，刷新后的消息恢复通过。

证据目录：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-build-recovery-formal-bzabtN`。
状态备份：`~/.rah/backups/pre-restart-fb4727c3-19fe-43bd-aa31-08cb82b53df4`。

## 全仓检查边界

Web 单元 405 项、类型检查、格式检查、diff 检查、正式构建、恢复浏览器门禁通过。
`npm run check` 的根测试集为 1560 项：1541 通过、17 跳过、2 失败。失败仍为此前既有的
`ui-tokens.test.ts` interaction sprite hash 和 `icon-semantics.test.ts` 图标列表顺序断言，
相关文件本批未改。随后独立执行的 Web 单元、parity regression、formal-browser-policy、
bilateral-captures 检查通过；后者是证据合同校验，不等于新的 Raft 双边实测。

未提交 commit。

## 后续复发：网络模块加载失败被误报为旧构建

2026-09-12 后续调查确认正式运行版本仍把动态 import 网络失败显示为“刷新 RAH OS 以继续”。
即使客户端与服务器 build ID 一致也会出现，因此旧版本文案不能用来推断发生过部署切换。
本批沿用既有恢复 owner，区分已确认的 build mismatch 与资源加载失败，并移除未挂载时的继续按钮。

隔离浏览器先阻断 mount-app 模块请求，旧实现以文案断言失败（期望资源加载失败，实际为旧版本）；
修正后追加连续两次断网重试、恢复资源后再重试的流程。此证据仅覆盖模块请求失败，不能证明
每次 iOS 现场的刷新无效都由这一原因造成。正式 HTTP Tailnet 不提供 Service Worker 安全上下文，
不能直接把它归因于 PWA Service Worker 缓存。

此前 WebKit 正式浏览器报告中的“无 pageerror”仅对应当次运行；后续不带拦截器的快速刷新
也曾出现 messages/social access-control 异常。不能断定只是测试拦截器造成，该边界仍待排查。

本批补测状态：Chromium 连续断网重试后恢复通过；WebKit 在相同拦截流程下恢复资源后仍未
挂载，出现 `Cannot destructure property 'mountRahApp' from null or undefined value`。
将断开请求改为 HTTP 503 也出现相同失败。尚未证明该失败与真机 iOS 现场等价，未将本批
修改部署到正式实例；不能将本批记为刷新问题已收口。现有正式实例保持运行。

### 后续修正（取代前述“仍未挂载”的当前实现状态）

仅更换入口脚本 query、改成 location.reload 的对照仍失败；将恢复入口放在新的
`/_rah/recover/<nonce>/assets/` 下，使相对模块图整体换地址后，重复失败及恢复门禁在
WebKit/Chromium 都通过。正式 gateway 单测验证 HTML 改写、冻结资源别名、no-store、
拒绝 API 别名和缺失脚本 404。实现位于 `web-recovery-assets.ts`，不是浏览器夹具专用补丁。
这证明原失败场景的修正，不推断所有 iOS 5G 不可达都由模块缓存导致。

正式发布该恢复修正后，WebKit 在真实 Tailnet HTTP 页面连续两次模块请求失败、恢复网络
请求、再次点击重载，成功显示原四个 Agent，dialog 消失；测试没有创建或修改业务数据。
发布前备份保留原状态。此次发布的 build 为
`1268ec0994e7bbd561f4de576194ea70a6510732fa19a78edc3a38a82c88c8ac`。
