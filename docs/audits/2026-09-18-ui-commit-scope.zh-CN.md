# rc.1 后 UI 改造提交边界

基线：`v1.0.0-rc.1` / `98dc095`。用户要求将此后 UI 改造合为一次提交，后台调度及 Composer Stop 留在工作区，不推送。

## 纳入范围

- 外观隐藏空分区；手动展开/折叠跨刷新保存、Host 实例变化后恢复默认。
- 移动 Agent 动态悬浮条、iOS 安全区随可见标题背景延伸。
- Composer 单一 Plus 文件引用入口和移动端原生设备上传。
- 文件树共享 Task 弹窗规格、两行标题、Home、稳定目录导航、多选文件及路径插入。
- Agent 工作区收缩、移除独立记忆 UI、成员头像与共享样式修复。
- 前端错误边界、对应自动化和来源证据。

文件引用必须包含 Protocol、SDK、应用服务和 AgentHost 的鉴权与有界目录元数据读取。这些是上述 UI 的功能配套，不包含文件正文读取、调度或停止执行。

## 排除范围

不纳入 Stop 按钮/状态轮询/协议、执行调度、Provider transport、隔离恢复、数据库迁移、Agent 删除诊断、发布身份和 CI 审计补强。共享文件按内容拆分；原工作区内容保留。

## 独立验证

使用 rc.1 的独立 worktree，仅加入拟提交内容并通过 `npm ci --ignore-scripts` 安装锁文件依赖，确认不依赖未提交后台代码。

- `npm run check`、`npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。核心测试 1613 项，其中 1596 通过、17 个付费门禁跳过；Web 单元测试 445 项通过。
- 文件窗口共享尺寸、两行标题、多选与目录延迟响应：Chromium/WebKit 的 1440px、390px 通过；已检查实际截图。
- 原生上传连续触摸/取消、同文件重选：Chromium/WebKit 通过。拖放及 Room/Thread 草稿隔离：Chrome/Firefox 的桌面和移动视口通过。
- 侧栏偏好、实例变化恢复默认、动态浮条层级：Chromium 通过；WebKit 首次出现一次 presence 请求访问错误，未放宽断言，原门禁重跑通过。该次波动保留为测试稳定性风险。
- 侧栏几何、移动安全区颜色/边框、WebKit 移动导航、Agent 工作区、成员头像及错误边界浏览器门禁通过。
- UI 规格重新捕获提交候选的 CSS 摘要；sidebar fixture 仅将独立 worktree 的资源 URL 前缀还原为原仓库路径，并逐字比较其余 DOM 一致，未改样式测量值。对应目录页面已重新生成。

侧栏浏览器测试改用 rc.1 已有 `rooms/sync` 读取 Room 序号，移除对未提交 `rooms/sos/read` 的测试依赖。文件引用测试保留鉴权拒绝、路径边界及无正文返回断言。

本次任务只整理和提交代码，不推送、不运行付费 CLI，也不把提交成功等同于正式部署或 iPhone 实机验收。
