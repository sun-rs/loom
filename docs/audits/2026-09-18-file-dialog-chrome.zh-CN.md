# 文件引用窗口共享 Task 弹窗标准

## 范围与依据

按用户要求以当前产品彩色 Task 标识打开的审批弹窗为基准。
沿用 [TaskModalHead 源码证据](2026-09-14-chat-task-modal.zh-CN.md) 中的
Raft release/v1.12.0 来源、hash 与授权说明；此次不是重新提取最新 Raft。
标题栏从 Task 局部样式提升到 ui-tokens 的 `rah-dialog-header`，两处共同使用。
窗口宽高、文件树与 Task 业务行为不变。

## 根因与修改

文件窗口曾单独设置 18px 标题、12px 标题栏内边距、固定 32px 关闭按钮，
并以全窗口 SVG 和确认按钮选择器覆盖共享字体、图标及内边距。
移除这些覆盖，关闭使用 `PanelHeaderAction`，确认使用原有 `btn btn-pink`。
移动端共享关闭规则包含 portal 标题栏，避免文件窗口位于 body 下而漏掉响应式尺寸。
标题栏上下 8px、左右 16px，标题 14px；关闭按钮桌面 28px、移动端 32px。
Task 可选的频道副标题仍独立占行，标题栏随内容自然增高。

## 验证

- 新浏览器回归先在旧实现失败：实际 12px 四向内边距与 Task 的 8px/16px 不同。
- 修改后 Chromium、WebKit 均通过 1440px/390px 实际计算样式比较，包括标题、
  分隔线、关闭按钮及图标、确认按钮共享样式，以及 Escape/焦点返回/重复关闭。
- 文件树专项 Chromium 回归通过，覆盖目录、Home、引用、取消选中及错误恢复。
- Task 审批浏览器回归通过；`npm run check`、`npm run format:check`、
  `git diff --check`、`npm run build:web:workbench` 通过。
- 没有运行付费 CLI；浏览器移动模拟不等于 iPhone 真机验收。

## 部署阻塞

冻结构建 `d33a1e1ea307bc64546368417db270f0913e41604610a031a38bc96720de1afe`
已生成。正式重启脚本在 inspect 阶段拒绝停止：Agent Council 存在一条 queued
Activation，创建于 `2026-09-18T04:52:28.953Z`，未发生运行尝试。
它不是先前已终止且无租约的隔离项。保留该执行与当前服务，不强杀、不删除排队工作。
因此本次不能宣称正式部署或正式入口验收完成；隔离浏览器证据仅证明冻结前源代码的效果。

本次浏览器证据：Chromium `rah-file-dialog-chrome-AMVz2w`，
WebKit `rah-file-dialog-chrome-z0eC8R`，文件流程 `rah-composer-controls-1QjgLt`，
Task 回归 `rah-chat-approval-eSGzKu`，位于系统临时目录。
重启拒绝记录为 `/tmp/rah-file-dialog-restart.log`。

## 续批：整体尺寸与目录闪烁

用户进一步要求窗口各项尺寸对齐 Task 审批，并将 Home 缩小为运行时配置刷新按钮式样。
将 Task 外框参数提取为共享 `rah-dialog-frame`，文件窗口改用同一宽高、视口上限、
边框及阴影。Home 与 `rah-runtime-model-refresh` 共用无边框样式：24px 控件、12px 图标。

切换目录原先 `setListing(undefined)` 同时抹去主机名和绝对路径。现在保留已确认的
Computer 信息，目标路径直接采用返回条目中的绝对路径，独立 loading 状态禁用引用；
成功后替换列表，失败可返回上级，取消请求保持原有 abort 围栏。
移动端自适应窗口还因加载提示比文件行矮而发生 8px 顶部位移，新增测试复现后修复：
文件树使用共享 preferred-height，列表内部滚动；Task 紧凑审批仍按内容收缩。

新测试首先分别证明旧窗口为 640x620 而 Task 为 960x725.828（1440x844 视口），
以及请求途中绝对路径退化为相对路径。后续测试还比较慢请求前后的标题栏矩形、
主机文字、加载期间禁用引用、Home 取消旧请求和迟到响应不覆盖新路径。
续批 Chromium/WebKit 的 1440px/390px 窗口及目录切换门禁通过；文件树完整流程与
Task 审批回归通过。已检查两种宽度截图。`npm run check`、`npm run format:check`、
`git diff --check`、`npm run build:web:workbench` 通过。
冻结构建为 `760396be792bef08bdca3c449e0548d292131373cb13b9879961119b7cbd22f2`。
正式重启仍在 inspect 阶段被同一条 Agent Council queued Activation 阻止，
记录于 `/tmp/rah-file-navigation-restart.log`。未停止现役服务，未删除待处理执行；
本续批仍未完成正式部署和真机验收。

续批尺寸截图：Chromium `rah-file-dialog-chrome-A1A5Xf`、WebKit
`rah-file-dialog-chrome-YiRw1b`；Task 回归 `rah-chat-approval-irtJjZ`，
文件流程 `rah-composer-controls-zF4AMw`，均位于系统临时目录。

## 续批：标题中的会话上下文

文件引用窗口按用户要求采用 Task 审批的两行结构：第一行是所属频道或私聊名称，
第二行是“引用文件或文件夹”。Chat/Thread 的既有 roomName/roomKind 经
`conversationTarget` 生成 `#频道` / `@私聊`，传入共享文件窗口；不从文件目录、
浏览器 URL 或异步请求推断会话。继续使用同一标题栏 CSS、关闭按钮和分隔线。

新增断言先在原实现失败（缺少 `#Task Matrix` 第一行），修改后 Chromium/WebKit
1440px/390px 均通过，比较两行字号和标题栏整体高度，并验证频道、消息列及私聊入口。
目录切换门禁通过，桌面和移动截图已检查。证据目录为
`rah-file-dialog-chrome-9Gk4b9`（Chromium）和 `rah-file-dialog-chrome-WhbXxk`（WebKit）。

`npm run check`、`npm run format:check`、`git diff --check` 与
`npm run build:web:workbench` 通过；冻结 Web build 为
`fbade8934f6dde28d03251a75139b8ea925083f3444b810baf40aa6890c295c7`。
正式重启再次在 inspect 阶段因 queued Activation 被拒，记录为
`/tmp/rah-file-context-restart.log`；现役服务未停止，正式部署与真机验收仍未完成。

## 续批：多文件选择与关闭按钮焦点

本批开始时正式 health 仍为 `builtAt=2026-09-18T04:48:28.680Z`，未包含前两批
标题、Home 及尺寸修复；不能把本地浏览器通过当作用户入口已生效。
另外文件窗口原先默认聚焦第一个控件（X），Task 审批聚焦容器，可能额外触发
Close 的键盘焦点轮廓。新测试先证明这一差异，再让文件窗口采用相同容器焦点，
保留 Tab 操作的可见焦点提示；没有删掉共享按钮的无障碍样式。

文件选择从单路径改为当前目录内的路径数组，再次点击取消单项；右侧使用共享 check
图标。目录跳转仍清空当前选择，无选择时仍引用当前目录。确认一次性插入所有选中
文件的带引号绝对路径，不循环调用光标插入、不上传或读取文件正文。
颜色采用现有 `ChoiceRow/property-option`，悬停和选中均为黄 30%；选中映射 current，
无页面自定义行色。该用户要求的文件选择适配沿用创建者菜单的组件与既有来源证据，
不是声称 Raft 存在同一文件树。

新增测试先复现点击第二个文件取消第一个，再验证两项同时选中、右侧对勾、取消单项、
精确引用文本和无上传草稿；复用原标题/X/Home、频道/私聊/消息列门禁。
Chromium/WebKit 1440px/390px 通过，目录延迟/错误/旧响应门禁和完整文件引用流程通过。
已检查移动多选截图：`rah-file-dialog-chrome-tGEFPp/390-selected-files.png`；
WebKit 证据 `rah-file-dialog-chrome-acjd89`，文件流程 `rah-composer-controls-PEW9qR`，
均位于系统临时目录。`npm run check`、`npm run format:check`、`git diff --check`
及 `npm run build:web:workbench` 通过；共享组件 CSS 匹配证据和 catalog 已重新生成。
冻结 Web build 为 `cbfdea7b6a6851985568fe28c37d798746091c1eba70b933010c26388b5b6519`。
正式重启再次因同一 queued Activation 在 inspect 阶段被拒，日志为
`/tmp/rah-files-multi-restart.log`。未停止现役服务；已向用户询问是否允许通过正常
停止流程取消这条从未启动的执行，等待答复。正式部署和真机验收尚未完成，未 commit/push。
