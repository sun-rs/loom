# 接手施工：通知中心 hover / focus

本轮从已停止写入的“复刻raft”任务接手，仅修改 rah_os。交接候选及旧证据缺口见仓库外接手审查目录 `/Users/sun/Code/reviews/rah_os/2026-09-06-execution-workflow/takeover-review`。

## 来源与边界

Raft 授权冻结源码 `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`：`Hoe` 的 desktop Trigger 使用 openOnHover / delay 0 / closeDelay 120；mobile 是点击入口；`bQe` 仅 keyboard 初始聚焦，right/bottom、align end、sideOffset 8。

交叉比较 Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `packages/ui/components/ui/popover.tsx`：复用 Base UI 而非再实现 hover bridge/焦点状态机。RAH 固定 `@base-ui/react@1.3.0`（MIT，依赖锁与原始许可证保留，正式 bundle 随附 `public/legal/interactive-popover-notices.txt`）。官方 API 参考：https://base-ui.com/react/components/popover 。共享 wrapper 是 RAH glue，Raft 参数是结构化移植，不是 byte-exact 复制，更不是 Raft Server 源码。

`packages/ui-web` 的 interactive-popover 是交互 owner，ui-tokens 是浮层层级样式 owner。通知列表、忽略、InputRequest、typed navigation 的业务 owner 保持既有接口；打开/查看/关闭不产生 dismiss 或 resolve。回答窗口继续使用现有模态 dialog owner，并阻止父浮层因指针离开或焦点转移而卸载。

## 验证范围

新完整 App 浏览器测试先在旧实现稳定失败于“hover 后 2500ms 仍没有通知面板”，然后实施。测试包含桌面 hover 不夺走 draft 焦点、跨间隙进入、离开关闭、键盘打开、Escape 焦点返回、外部点击焦点、390×844 点击入口与视口边界、程序化通知链接及嵌套回答窗口。嵌套 pending InputRequest 明确使用合成只读响应，未提交回答；不冒充业务接受证明或真实 Provider 执行。

完整门禁、最终源码收据与受保护正式重启均已完成，见下方出口记录。B070 仍保留 needs-verification：尚未完成同条件官方非空通知双边验证。OS/iOS 投递仍由 B063/B069 跟踪；未执行付费 Provider，也不将本批等同全 Raft 复刻完成。

本次截图检查另复现移动 Home 的叠层遮挡：旧 popup z=50 低于 sidebar/navigation 的 60/70。新增 `elementFromPoint` 断言先失败，随后共享 popover 层级调整为 75，保留模态层 100 以上。仅 DOM visible 不再构成此场景通过条件。

补跑上一批矩阵时，原“服务端已接受但响应丢失”检查暴露竞态：第一条接受已显示 1/2，第二条仍未完成，测试就读取其 Task ID。现在等待实际注入的 `text/plain` 丢失响应后，再执行 canonical Task 与唯一事件断言；没有删除业务检查。登记测试也不再要求队列永远存在一个 needs-fix 项，改为验证每个合法状态及 B070 当前仍待双边验收。

最终门禁追查还修复两个基础设施问题：按 registry 的 runner 字段分别核对 foundations 14 个场景与独立 Firefox `workspace-switcher-full-app`，后者仍必须单独运行；不能要求每个 runner 都运行其他 runner 的场景。Firefox 在两个不同导航位置复现 `networkidle` 超时，因此页面族导航采用 load，再由既有 locator、界面状态和 canonical 断言判断就绪，不等待有轮询/SSE 的应用全局网络静默。参见 [Playwright 的等待说明](https://playwright.dev/docs/api/class-page#page-goto)。这些调整不缩小业务覆盖。

后续回归定位了旧消息场景的实体选择错误：按相同文字取 `.last()` 会选到稍后引用人类消息的 Fake Agent 回复，导致错误寻找长消息展开按钮。测试现以接受回执的 canonical Message ID 定位；不改变消息业务。异步数据与定位检查也先确认输入框可编辑且已聚焦、菜单资料已加载、程序化浮层具有可命中的有效边界；样式读取避免采样已被替换的 DOM 节点。

Firefox 的一次运行在切换场景前等待旧页面 `document.fonts.ready` 停滞。仅向该次隔离 Firefox 进程发送 SIGTERM 后，堆栈精确落在此等待，正式进程未被触碰。门禁已移除导航前/场景后的无用途字体等待；基页字体检查改为有 30 秒上限的可观察状态，所有受控页面/上下文也设置操作与导航期限，并记录场景开始/通过。截屏与尺寸的实际字体验证仍保留。

## 最终出口（2026-09-06）

- `npm run check`、`npm run format:check`、`git diff --check` 通过。末次完整检查后仅继续调整浏览器门禁脚本的等待/定位；这些脚本随后在完整矩阵实际执行。
- `npm run test:web:browser` 通过，隔离真实 Kernel / fake provider；没有执行付费 Provider。
- `npm run test:web:firefox` 通过：Firefox 150.0.2，含 production App `workspace-switcher-full-app`、1440×1000 和 390×844。
- 最终 foundations：Chrome 14/14、Firefox 14/14。收据分别为 `rah-ui-foundations-bZFfaW/receipt.json` 与 `rah-ui-foundations-qGjZm9/receipt.json`（完整路径见仓库外接手目录的 `final-receipt-verification.json`）。两份输入清单完全相同；各自 984 项文件 SHA-256 均匹配当前源码，零过期输入。不是沿用旧 q5L8qJ 收据。
- `npm run build:web:workbench` 通过，冻结 Web build `73a048f2395261da10005d82a3896eb21d6f2b149a80c8f82b2f98b8e915559d`。
- 正式实例经 idle 检查、完整状态备份/数据库校验、旧进程 SIGTERM 后启动新进程 PID 67230；没有强杀正式实例。备份为 `/Users/sun/.rah/backups/pre-restart-31fc9e51-23b8-4f82-8eca-6a570ed5cecc`，86 个文件的哈希和数据库再次复核一致。
- 正式 Discovery 双引擎收据：`rah-discovery-formal-mUTmo9/receipt.json`；Settings 双引擎收据：`rah-settings-formal-4YU6Kj/receipt.json`。副本与完整路径保存在接手目录；两者均通过，构建身份一致。
- 本任务另使用 CUA 新开正式页面，实际点击通知、检查截图、按 Escape 关闭并确认焦点回到通知按钮；DOM 构建身份与冻结值一致，临时验收页已关闭。
- 重启及正式验收后仍为 6 principals、6 Rooms、43 Messages、2 Tasks、378 Room events；逐 Room 最大序号不变。只读 cursor 可正常推进。未 commit、push 或 publish。

正式工作台：http://127.0.0.1:4173 。这份记录是接手者对本批实现的自测与发布证据，不冒充本批第三方审计；全产品 Raft 双边验收仍未完成。
