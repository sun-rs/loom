# PWA 加载等待与统一加载状态

## 设计与所有权

Web/PWA 共用数据读取路径。本批不缓存业务数据到 Service Worker，不放宽权限、
Room receipt 或成员资格验证，不运行付费 CLI。

- `useDiscoveryQuery`：一个 scope/client 仅一个读取；完成后再安排下一轮。焦点刷新
  合并进行中的请求，换 scope/卸载中止旧请求；15 秒超时可见失败并继续恢复。
- `App`：Room 定时读取只更新自身 tick，不再触发全局 reload；非会话大页暂停隐藏
  Room 读取。身份目录在读取结束时取最新资料，其定时刷新不再取消会话读取。
- `useReconciledQuery`：相同投影保持对象身份；Room Agent 活动诊断另行读取，不能
  阻塞正文。Room 同步、成员与任务/消息列事实、引用读取状态仍保留原一致性边界。
- Human Inbox：收起时 15 秒、展开时 5 秒，打开/回到前台立即读取。仍按频道读取，
  未增加聚合业务 API；数量是最后成功读取的持久状态投影，不伪造即时正确性。
- 两种正式 gateway 共用 `static-file-response.ts`，对大于等于 1 KiB 的文本静态资源
  协商 gzip，设置 Vary，保留 identity/q=0/HEAD 行为。API、文件下载和动态恢复壳不
  进入这条压缩路径，不对持久资源作改写。
- `ui-web/LoadingState` 和 ui-tokens/loading.css 是加载提示的单一组件与样式 owner。
  初始 HTML 与应用启动阶段使用浅奶黄色；进入系统后局部加载使用透明背景，
  沿用所在页面的白色等原底色，避免每次切页闪奶黄色。已建立标题栏只替换未就绪内容区。
  后台轮询保留已有内容，历史分页只用行内提示；错误保持错误与重试，提交状态不替换。

## 来源与明确差异

核对 Raft release/v1.17.3，commit `2bbf8731d8e09505123179bad139dcea4b772791`。
发布源码 `https://app.raft.build/assets/index-CyTLLjYb.js`，SHA-256
`0799a867d1d1fd706b9fb9068ebec05002acc39261ae3ab3ed706e239fd8ca9f`；CSS
`https://app.raft.build/assets/index-DLWPJCiz.css`，SHA-256
`79f48ab187ec19bde8876c356a71ea13d13fffe8e65c4ed1ab475dfe7c62f187`。
应用启动/服务器等待使用 bg-brutal-cream，色值 #FFFAEF，复用已维护的 --cream。
Raft 仍混用白底、纯文字和骨架；全页首读统一转圈是用户授权的 RAH 差异，非逐字复制。
发布 bundle 仅为分析证据；没有导入上游运行时代码或新增许可来源。
Multica 不提供 RAH 的 Room receipt/本地 gateway 所有权，本批在现有 owner 内修复，
未引入其他项目算法。Spinner 的尺寸和动画为本地统一参数，不声称源码逐像素移植。

## 可复现证据

原版正式页面移动视口停留任务页约 11 秒完成 125 次 API 请求，含 42 次按频道 Inbox
查询；主程序实际未压缩传输约 1.83 MB。模拟任务请求 6.5 秒时，每 5 秒被取消。
这些是桌面浏览器模拟与本机测量，不是手机真机/Tailscale 网络测速。

新增 `test-discovery-slow-loading-browser.mjs` 先复现超时取消、隐藏 Room 读取、
收起 Inbox 过频与缺少重试入口，再验证慢读取、焦点合并、后台保留内容和错误恢复。
`test-room-nonblocking-activity-browser.mjs` 先复现诊断阻塞正文、目录刷新取消慢成员
读取，再验证这两种 6.5 秒延迟。静态传输单元测试覆盖 gzip/identity/q=0/HEAD；
原 local/LAN gateway 的身份、路径、缓存、代理测试一并运行。

## 最终验收与限制

最终正式 build `af493dcf41cef569d40572938878e77add154dbac410213452a5e2be0fa52ba3`，
安全守卫验证备份后重启；新浏览器已核验真实任务中删除/Human/有效 Claude 资料、
返回、桌面关闭整个审批、重新打开根页。中途正式验收发现隐藏 Room 条件漏掉审批
讨论，定向回归复现后补上 taskModalOpen；最终 Chromium/WebKit 任务回归通过。
因此“暂停隐藏 Room”明确不包含已打开的任务审批。

[前后测量数据](../evidence/2026-09-21-pwa-loading-performance.json)：同一正式地址、
390×844 冷上下文、禁用 SW、只读请求守卫、约 11 秒单次样本，完成 API 125→52，
Inbox 42→14，任务列表页 Room sync 为 0。主程序实际传输 1,834,748→610,140 字节，
解压后仍约 1.83 MB；本批没有声称完成拆包或消除所有手机端主线程开销。最终正式
6.5 秒延迟读取在 6,507ms 完成；下一轮在约 11.7 秒开始，没有 5 秒取消循环。

通过：Chromium/WebKit 慢任务、焦点合并、后台内容保留、503 重试；慢诊断与慢成员
读取；初始化 15 秒超时和重试；共享三页嵌套导航；历史搜索线程轮询、草稿、缩放与
关闭（尺寸断言改为等待响应式布局稳定，阈值未放宽）；正式任务导航；类型检查、
正式构建、12 项静态传输/页面合同单测、本批格式和 diff 检查。

未全绿：全仓 check 仍在 `/v1/worker/message-present` 未登记处停止；全仓格式检查
有 12 个本批未改动文件告警。Web 单测 467 通过、11 个源码契约断言失败，涉及先前
头像/侧栏/任务等接线或格式与源文本断言不一致，未将该套件标为通过。Human membership
浏览器门禁被其请求白名单缺少既有 runtime-guide/read 阻塞；未扩大权限白名单来掩盖。
不声称 Raft 当前线上双边验收、安装 PWA 真机网络/滚动性能验收。未提交或推送 Git。

## 加载底色范围修订

用户进一步限定浅奶黄色仅用于整页刷新后的系统启动；局部任务、Room、Thread、
资料加载不再覆盖容器底色。共享样式删除内容区的奶黄色覆盖，转圈与文字保留。
浏览器回归先复现任务加载区仍呈奶黄色，再验证透明局部加载及奶黄色启动容器。

本次底色修订验证：Chromium/WebKit 慢任务读取通过，启动超时/重试及奶黄色容器
检查通过；正式构建、diff 检查通过。更新 CSS 匹配证据后，全仓检查仍停在既有
`/v1/worker/message-present` 登记缺失；全仓格式检查仍有 12 个既有文件告警。
已备份持久状态并安全重启正式工作台；新构建
`d430fcbd0dcc584758e4cae2886e047d6f5d01f77589afd348dcb2b24266d982`
在 390px/1440px 新浏览器页面验证局部加载与真实任务显示，截图确认白色底色。
未运行付费 CLI，未提交代码。
