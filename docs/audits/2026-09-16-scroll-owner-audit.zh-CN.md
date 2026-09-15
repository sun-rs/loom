# 滚动定位所有者排查与任务工具栏覆盖

## 范围与来源

从 apps/web 和 ui-web 中所有 scrollTop 写入、scrollTo/scrollIntoView、
ResizeObserver、虚拟列表及关闭时 focus 恢复调用反向排查。按 owner 去重，
不以 CSS overflow 声明数量计为独立实现数量。

任务锚点的 Raft 来源、版本/许可及有意修正仍见
[任务滚动修复](2026-09-16-task-scroll-and-toolbar-insets.zh-CN.md)与
[Task 虚拟窗口](../design/task-virtual-window.md)。本批沿用现有 MessageTimeline、
ThreadPane、AgentActivityPane 和焦点恢复 owner，不引入新滚动算法或业务状态。
同一授权发布证据与 Multica 适用性判断继续有效，不声称本批重新进行了实时 Raft
浏览器双边验收。

## 排查结果

| 场景                                                | 结论与处置                                                                                                               | 验证层次                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 全局/Room/DM 任务列表、看板                         | 共用 TaskVirtualLayout；上批修复覆盖三个入口                                                                             | 上批 Chrome/Firefox 虚拟化、原生触摸及本批源码调用检查                        |
| Room/DM 消息历史加载                                | 原锚点在网络等待期间仍代表旧阅读位置；等待期间的 scroll 更新锚点相对位置，完成后尊重最新位置                             | 慢请求 + 等待期间滚动，Chromium/WebKit                                        |
| 消息列历史加载                                      | 使用请求发起时的 previousTop；改为在等待期间跟踪当前 top，结束后移除监听                                                 | 同上，母消息/回复长内容                                                       |
| 消息列内搜索                                        | replies/root 更新重复 scrollIntoView；相同查询、结果序号、消息只定位一次，显式上一条/下一条仍重新定位                    | 刷新相同数据后保持阅读位置，Chromium/WebKit                                   |
| Agent 活动诊断                                      | 新记录在 scroll 事件前到达时 followLatest 仍为 true；记录已知 scrollTop，检测到独立滚动即释放尾随                        | 同一事件周期滚动与 append，Chromium/WebKit                                    |
| 关闭消息列/搜索预览                                 | focus() 会将已滚出视口的原按钮重新带回；改为 preventScroll:true                                                          | 焦点恢复保留 300px 滚动位置，Chromium/WebKit                                  |
| Task 审批对话初始滚动                               | 已由 useTaskInitialScroll 在触摸/滚轮/指针/键盘输入后释放，无需修改                                                      | 用户滚动后内容增高，位置保持                                                  |
| Room/DM 新消息尾随                                  | 原 scroll 事件尚未处理时 append 会读到过时的尾随标记；追加和 ResizeObserver 定位前检查实际 scrollTop，独立滚动后释放尾随 | 同一事件周期滚动与 append，Chromium/WebKit；10,050 条消息和 Markdown 刷新回归 |
| 文件目录/大纲/评论锚点                              | 普通列表原生滚动；大纲或评论锚点仅在明确点击后定位，无周期性位置写回                                                     | 源码调用检查，本批没有各文件类型实机验收                                      |
| 首页/成员/设置/动态/搜索/收藏/通知、文本复制/时间线 | 原生滚动容器，没有 TaskVirtualLayout 同类锚点回写；区分初次加载、筛选和显式焦点导航                                      | 源码检查，前批 viewport/复制门禁为既有证据                                    |
| Composer 自动增高与横向 tabs                        | 前者在文字区高度受限时保留自身 scrollTop；后者只滚动 tabs 自身，键盘使用 preventScroll                                   | 源码检查，未更改                                                              |

复现证据：消息列搜索刷新后回到结果；历史请求等待期间滚动 260px 后，原锚点
仍回退约 260px；Room/DM 新消息和活动诊断追加拉回末尾；两种关闭侧页的焦点恢复将 300px 改回 0。
均先增加失败用例再修正。测试使用隔离组件与假数据，不向正式 Room 发送内容。

## 工具栏尺寸

Raft 桌面已提取证据
`packages/ui-tokens/src/neo-brutalist/extracted/raft-official-tasks.css`（发布
`666bab60d8658d9e382e2c286ce1e423231e8f31`，Firefox computed style/DOMRect
与发布 utility classes）规定：上下 padding 各 12px，左右 16px；筛选按钮 32px，
底边框 2px，工具栏 58px。上下留白一致。

本批开始前的正式页面，390/430/1440px 分别测量三个入口：

| 入口          | PWA 上/下                 | 桌面上/下 |
| ------------- | ------------------------- | --------- |
| Room 任务 tab | 10/10px                   | 12/12px   |
| 私聊任务 tab  | 10/10px                   | 12/12px   |
| 任务大页      | 10/14px，遗漏最小高度覆盖 | 12/12px   |

本批补齐 PWA 任务大页 min-height:0，现在三个入口均为 10/10px；桌面保留
12/12px。间距按按钮边框到工具栏内缘计算，不将阴影当成 padding。桌面「新建」
按钮自身高 28px，垂直居中后其边框净空为 14/14px，仍然对称；32px 筛选按钮为
12/12px。PWA「新建任务」为 32px，因此同为 10/10px。

## 交付状态

- `test:web:scroll-ownership`：Chromium、WebKit，390x844/1440x844，全部新增滚动竞争回归通过。
- `test:web:message-timeline`：10,050 条逻辑消息、27 条 DOM 行、锚点偏差 0；20 次 Markdown 刷新及移动端原有回归通过。
- `test-task-filter-touch-browser.mjs`：PWA 任务大页 10/10px 断言先失败（10/14px），修复后通过。
- `npm run check`、`npm run format:check`、`git diff --check`、正式 Web 构建通过。
- 正式构建 `ee566a620d3af1f66d0613dd15f22a295b9f565d4d4a3d0e235a62dc0a668250`；空闲检查、完整状态备份校验后正常重启，未运行付费 CLI。
- 重启后真实数据页面在 390/430/1440px 验收；任务卡片原生触摸上下滚动后跨过 5.5 秒刷新窗口保持位置，标题栏不移动，reload 无页面错误。截图证据目录 `rah-task-scroll-formal-FHvqtv`。正式页面另测三入口的按钮矩形与工具栏内缘，PWA 10/10px、桌面筛选 12/12px，截图人工查看。

源码排查不意味着所有浏览器/内容组合均无抖动；真实 iPhone 惯性滚动和原生选区
仍须区分于桌面 WebKit 及触摸模拟。文件格式、弹窗内长内容未逐一做实机验收。
