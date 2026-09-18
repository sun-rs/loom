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
6. Home 使用现有授权列表接口返回起始目录。目录整行进入下一级；文件支持多选且可取消。唯一“引用所选”操作引用所选文件或当前目录，不读取正文、不上传路径引用。原有拒绝访问、取消请求、错误重试及目录边界保留。

## 验证与限制

- TDD：新增 disclosure 存储/实例隔离测试和浏览器 hide-empty、文件引用流程断言，先确认旧实现失败后实现。
- `apps/web/test/sidebar-disclosure.test.ts`：默认关闭、设备偏好保存、刷新读取、实例变更、损坏/不可用存储。
- `test-sidebar-preferences-browser.mjs`：桌面/390px，手动状态跨刷新、隐藏及恢复、实例变更恢复默认、移动浮条位置/滚动/开关。
- `test-sidebar-geometry-browser.mjs`：条目数量变化不得覆盖明确选择，原字号/间距/排序与新增按钮几何。
- `test-composer-controls-browser.mjs`：直接 Plus、旧偏好无效、Home、文件取消选中、目录引用、访问拒绝恢复、原生 chooser 参数、光标位置与 Room/Thread/DM 控件。
- `run-composer-drop-browser-gate.mjs`：Chromium/Firefox，设备上传取消、同文件重选、多个文件、任务模式禁用、失败恢复、实际字节下载和 Room/Thread 草稿隔离。
- 浏览器文件 chooser 验证不等于真实 iPhone 原生相册/拍摄菜单验收；本轮未运行付费 CLI，也未声称最新官方站点同条件双边验收。

## 提交边界

本次 UI 提交包含侧栏偏好、动态浮条、文件引用入口及必要的鉴权/目录读取配套。
停止执行、隔离记录与重启预检修正属于独立后台工作，不包含在此提交中。
本次独立提交的验证结果见 [UI 提交验证](2026-09-18-ui-commit-scope.zh-CN.md)。
