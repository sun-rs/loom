# 侧栏偏好、移动动态浮条与文件引用入口

日期：2026-09-18。按用户本轮要求更新 Web/PWA 共享展示逻辑；不改变消息、上传、文件授权或执行队列的业务所有权。

## 上游依据与有意差异

Raft Web 1.16.0 / `ba2a1db`，发布包 `web-index.js` SHA-256：
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
不可变来源与授权/许可边界见 [manifest](../evidence/raft-release-20260916/manifest.json)。原始发布包仅供分析，不是生产依赖。

- `hideEmptySidebarSectionsTitle` 控件位于字符偏移 3313371，使用共享 `Uc` checkbox；侧栏条件位于 3512337，包含空内容和编辑状态判断。RAH 使用维护的 Toggle，并按用户要求默认关闭；开启时隐藏整个空分组包装层，包括自定义空分组。不声称复制上游所有编辑态例外。
- `liveAgentActivityDescription` 明确描述桌面侧栏底部、移动标签栏上方两个位置。RAH 的移动悬浮 pill 是用户指定的本地组合，34px 高，距 50px 导航栏 8px，随安全区调整；不声称这些尺寸来自 Raft 原生 iOS 源码。
- 文件按钮使用现有 Raft 26px 控件、14px 图标与 8px 间距。Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `packages/views/chat/components/chat-add-menu.tsx` 提供 unrestricted multiple input 的结构参考。没有复制新的 React 源码；完整来源及当前交互见 [Composer owner](../design/composer-controls.md)。

## 单一所有者与行为

1. `settings-preferences.ts` 保存设备级隐藏空分组偏好，默认 false。隐藏不删除分组或条目，内容出现时恢复可见。
2. `use-sidebar-disclosure.ts` 持有当前页面的手动展开/折叠覆盖，`sidebar-disclosure.ts` 管理 sessionStorage。键按 Workspace/Human 隔离，内容按现有 `host.runtime.list` 返回的 `computer.instanceId` 校验；Host 重启产生新 instanceId，旧覆盖失效。默认状态仍由实际条目数决定，手动状态不因占用数量变化而被覆盖。刷新保留同标签页选择；浏览器拒绝存储时退化为当前页面内保存。
3. App 已有 inventory 查询负责提供实例身份，不新增启动 ID、轮询器或后端状态。冷启动 inventory 返回前的用户点击合并到该次启动状态。
4. 移动首页活动浮条复用既有活动投影、开关及超时逻辑，固定在导航上方；列表拥有滚动，浮条和导航在上层。仅浮条出现时增加对应底部滚动余量；桌面原布局保留。
5. Plus 在所有设备/地址直接打开 Computer 文件树。移动断点内额外显示回形针，调用当前终端的原生文件选择器。旧加号模式偏好不再读取，无地址或主机名推断分支。
6. Home 使用现有授权列表接口返回起始目录。目录整行进入下一级；文件单选且可取消。唯一“引用所选”操作引用文件或当前目录，不读取正文、不上传路径引用。原有拒绝访问、取消请求、错误重试及目录边界保留。

## 验证与限制

- TDD：新增 disclosure 存储/实例隔离测试和浏览器 hide-empty、文件引用流程断言，先确认旧实现失败后实现。
- `apps/web/test/sidebar-disclosure.test.ts`：默认关闭、设备偏好保存、刷新读取、实例变更、损坏/不可用存储。
- `test-sidebar-preferences-browser.mjs`：桌面/390px，手动状态跨刷新、隐藏及恢复、实例变更恢复默认、移动浮条位置/滚动/开关。
- `test-sidebar-geometry-browser.mjs`：条目数量变化不得覆盖明确选择，原字号/间距/排序与新增按钮几何。
- `test-composer-controls-browser.mjs`：直接 Plus、旧偏好无效、Home、文件取消选中、目录引用、访问拒绝恢复、原生 chooser 参数、光标位置与 Room/Thread/DM 控件。
- `run-composer-drop-browser-gate.mjs`：Chromium/Firefox，设备上传取消、同文件重选、多个文件、任务模式禁用、失败恢复、实际字节下载和 Room/Thread 草稿隔离。
- 浏览器文件 chooser 验证不等于真实 iPhone 原生相册/拍摄菜单验收；本轮未运行付费 CLI，也未声称最新官方站点同条件双边验收。

## 本轮交付结果

- `npm run check`、`npm run format:check`、`git diff --check` 通过；Web 正式资产构建通过。默认套件的付费 CLI 门禁仍跳过。
- 侧栏偏好及活动浮条：Chromium/WebKit 桌面 1440x900、移动 390x844 通过。用 24 个额外真实夹具频道验证实际溢出滚动和浮条命中层级，而非只检查 `position: fixed`。
- 侧栏几何回归、完整 Composer 频道/消息列/私聊与停止/修正回归通过。文件树额外复现了 hover 覆盖按压黄底，限定 hover 不匹配 active 后通过。
- 原生上传及拖放：Chromium/Firefox 桌面与移动测试通过；文件引用专项也在 WebKit 通过。已检查桌面引用窗口、移动引用窗口及移动长列表浮条截图。
- 首次交付时正式部署 **阻塞**：只读预检发现 Agent Council 有一条 `quarantined` Activation，错误为 `runtime timed out after 1800000ms`。没有 running/starting/orphaned RunAttempt，但当时 `assertWorkbenchIdle` 仍明确禁止带隔离执行重启。该次未改变业务状态或终止正式进程；后续修正与完成部署见下文。
- 未提交或推送 Git；未运行付费 CLI；真实 iPhone 原生菜单仍待设备验收。

## 隔离记录与重启预检修正

用户随后明确授权重启。只读核实这条隔离 Activation 的三次 RunAttempt 都为 timed_out 且有 finished_at，RuntimeProcess 均已终止、Placement 已释放，没有 queued/leased Activation 或独占操作租约。原 operator 重启预检把全部 quarantined 记录计入活动工作，混淆了持久失败记录与正在运行的执行。

修正仅在 daemon 的重启预检 owner：新增 `assertWorkbenchRestartable`，共用既有执行状态检查，但允许无租约的隔离记录原样保留。严格空闲/恢复检查不变；不更新生产数据库状态、不清除故障历史、不重试 Agent，不改变 Task 状态。新增回归逐个覆盖活动 owner 与隔离残留租约的拒绝，并确认严格恢复检查仍拒绝隔离状态。此为 RAH operator 部署条件修正，没有移植上游执行状态机。

### 正式重启完成

用户授权后，定向重启/升级/恢复回归 24 项通过；重新运行 `npm run check`、`format:check`、`git diff --check` 与 Web 构建通过。重启工具校验冻结资产、SQLite 在线备份、文件摘要及候选 Kernel 副本预检，然后正常 SIGTERM 旧实例并启动新实例。

- 备份：`~/.rah/backups/pre-restart-38825f2d-5f3a-4f6a-86f5-53068fc6441b`。
- Web build：`d04873d5436dbd3b7565b628cbc1bb850d7c5afd280a199212c496c3d5333885`。health 的完整 buildIdentity 与构建元数据一致。
- 新旧启动收据的本机、LAN、Tailnet 监听集合一致。消息、Task、Agent 定义、Activation 和 RunAttempt 与备份逐行比较一致；隔离记录仍原样保留，重启没有自动产生执行。
- 新 Chromium 正式页面：本机入口 1440x900/390x844 文件引用、Home、上级目录至 `/`、移动上传入口通过；LAN 入口同尺寸验证外观开关、隐藏空分组和折叠状态跨刷新保留，无页面异常。仅容许既有读取及已读状态请求，没有发消息、创建任务或启动 CLI。
- 本次只读检查与重启证明的是故障记录不会误拦截部署，不声称修复造成原来 30 分钟超时的 Provider 问题。
