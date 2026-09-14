# 移动端常驻导航、任务默认视图与行内引用

## 根因及所有者

用户要求所有移动页面（含 iOS 浏览器/PWA 的详情页）保留底部主导航。
原 App 的路由条件会在 Room、Computer 详情及带 Agent ID 的成员页取消渲染导航；
Agent CSS 又单独在详情页隐藏导航。二者与成员列表的局部展开状态不同步时，列表也会失去导航。

唯一布局所有者仍为 Web shell：MobileNavigation 无条件挂载，桌面通过原有媒体规则隐藏；
767px 以下由 shell 的 `100dvh` 减去导航及安全区高度，内容不再逐页重复补底部留白。
固定定位的 Agent inspector 同样避开该空间。导航切换清理旧 inspector/Thread，避免返回后残留。
模态表单的焦点锁定保持原有语义，不把主导航提升至对话框上方。

Room TaskPane 原本把状态初始化为 board，全局 Tasks 也硬编码 board。
新共享 `useResponsiveTaskView` 只拥有展示默认值，以 ResizeObserver 测量实际容器宽度：
小于 768px 默认列表，其余默认看板。此阈值是本批用户要求下的 RAH 响应式规则，
不是声称从 Raft 提取的阈值。已有显式选择（Room 局部状态、全局 URL）优先，
resize 不重写选择，也不改变任务业务状态、分页或过滤条件。

行内彩色引用原为 inline-block + overflow:hidden + vertical-align:bottom，
其文本基线受盒底对齐影响；改为 inline-flex + baseline，使引用内容参与同行基线对齐。
保留字体、颜色、边框、截断及点击目标。只改变排版，不改变引用解析。

## 上游证据与采用边界

本批检查已有授权 Raft bundle `vendor/raft/index-WTraJnrd.js`，
SHA-256 `fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`。
`pL` 引用组件使用 inline-flex、items-center；任务 badge 存在 theme/variant 不同的
baseline/bottom/middle 规则。本地采用 flex 文本基线来修复用户报告的下沉，未复制原始 bundle，
也未宣称三项已完成同条件 Raft 双边验收。常驻导航是用户明确指定的本地行为。

## 验证

`scripts/test-mobile-layout-browser.mjs` 使用独立临时 Core、真实 Web bundle、Fake Provider，
不启动付费 CLI，不修改正式 Room 内容。

- 修复前复现五类路由导航不可见、两处窄屏默认 board、行内引用偏移。
- 390×844：成员列表/详情及 reload、Computer、Settings、Activity、Search、Room、Thread；
  导航底缘与视口对齐，聊天和 Thread composer 不与导航重叠，无根页面横向溢出。
- 全局/频道任务：390 默认 list，1440 默认 board，600px 容器在宽视口仍默认 list；
  手动选择在后续 resize 保留；桌面底栏隐藏。
- 同字号文本基线探针验证彩色引用与同行文本的差异不超过 0.5px。
- Chromium 与 WebKit 的隔离浏览器验收通过，并人工查看 Agent 详情与 Thread 截图。

WebKit 桌面自动化不等同于真机 iOS 安装式 PWA、软键盘及系统安全区验收。
正式部署状态在下方单独记录。

## Tailnet HTTP 兼容补充

按用户先前要求，正式重启同时切换到精确 Tailnet IPv4 的 HTTP 入口，移除该入口的配对流程。
启动模式及代理边界见 [部署 owner](../architecture/client-daemon-and-deployment.zh-CN.md)。
HTTP 浏览器不提供 `crypto.randomUUID`：将残留的界面命令 ID、构建探测和预览 channel ID
统一为已有 `opaqueIdFromBytes` + `crypto.getRandomValues`，不使用时间或 Math.random 回退。
新增不含 randomUUID 的随机源测试；此修复不依赖 Service Worker。

## 正式部署与检查结果

2026-09-12 完成正式实例空闲检查、持久状态完整备份、SIGTERM 退出及冻结资源重启。
正式构建 `786cba2974cf767a6d291a838497a7c6c4a6826ee60de55fb7461f64c9a7d5d7`。
监听精确 Tailnet IPv4 的 4173 端口，HTTP 入口无需 HTTPS/配对，未绑定所有网卡。
重启守卫核验备份与 Room sequence 保持一致，保留 Room 历史、Agent 配置及私有文件。

新 Chromium、WebKit 会话均在正式 HTTP origin 通过：成员详情及 reload、全局任务、
频道聊天输入框、频道任务、390→1440 布局切换；没有浏览器脚本错误，读取到相同构建 ID。
这是真实正式服务浏览器验收，不是 Fake Provider 页面，也未发送消息或执行付费 CLI。
真机 iOS 安装及软键盘仍未宣称通过。

- TypeScript、405 项 Web 单元测试、移动端双引擎浏览器、既有消息列响应式浏览器通过。
- Tailnet/代理 7 项、Core 生命周期 7 项测试通过；格式与 diff 检查通过。
- 组件 sidebar-row/sq-btn 浏览器规格通过，已刷新 CSS 匹配报告并重建目录。
- 后续 parity regression、formal-browser-policy、bilateral-captures 测试通过。
- `npm run check` **未全绿**：根测试 1559 项中 1540 通过、17 跳过，2 条既有图标测试失败。
  `ui-tokens.test.ts` 的 sprite 哈希和 `icon-semantics.test.ts` 的固定数组前缀断言不匹配。
  相关四个源码/测试文件与 HEAD 完全一致，本批不修改其断言或冒充全量通过。
