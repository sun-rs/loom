# 已退休端点门禁迁移（2026-10-04）

依据任务书及负责人修订 1–3。起始 evo `1287ea2`，工作树干净。仅改门禁、夹具与登记文档；不改产品、协议、端点或目标合同。

## 断言处理清单

| 脚本                                                      | 保留／迁移                                                                                                                                        | 无当前产品对应，登记放弃                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| test-agent-first-run-browser → test-role-activity-browser | 通过真实临时 Role 创建实例；模拟 presence 帧依次验证初始化／启动／工作中的活动条、头像无状态点与独立状态点恰好一个                                | persona 在 #all 自动问候、agent.first_run_requested 恰好一次、自动问候无 Task、无报到开关。这些不是 Role 首次执行行为；新测试仅证明 UI 投影，不证明实际调度状态经历这三个阶段 |
| test-agent-recreate-browser                               | 同 Role 重新实例化产生不同身份、handle、私聊；保留显示名、历史灰度／不可用／刷新、桌面与窄屏、精确幂等重放                                        | 使用 provision 再创建 persona 的前提改为同 Role 在频道创建新实例                                                                                                              |
| run-agent-task-parity-browser-gate                        | Role 实例启停／重试幂等／删除确认与取消，任务创建默认角色为空，PNG manifest；另建独立临时频道验证实例删除                                         | 无房间 Agent 生命周期前提不存在；启动已为直接操作而非确认弹窗；删除按钮不再因 enabled 而禁用，Kernel 删除请求会先停用再走安全终止，旧“先停止”禁用文案断言无对应               |
| test-room-add-members-browser                             | 选择 Role 与频道；响应丢失／503 后完整请求含 basis 与幂等键不变、实际实例恰好一个、成员可见、Role 可复用；禁止 provision/onboard/members.add 请求 | 旧多选、chips、创建成功从候选移除与旧创建后 onboard 流程。合同允许同 Role 在同频道多次实例化                                                                                  |
| test-agent-account-browser                                | 创建 Role 请求 configuration.handle 保留大小写、409 顶部错误位置、关闭、1440/390                                                                  | 旧添加 Agent 菜单与 provision 请求                                                                                                                                            |
| test-custom-model-picker-browser                          | Role revise/create 请求 configuration.modelIntent 的自定义 ID、reasoning、显式绑定排除及菜单样式                                                  | 旧目录 Agent 配置入口改为 Role 配置入口；mock 不是真实 CLI 能力验收                                                                                                           |

npm 入口：退休 `test:web:agent-first-run`，新增 `test:web:role-activity` 承接 UI 活动条断言；`test:web:room-add-members` 名称保留、语义迁为 Role 实例化。A 类另两个脚本无 npm 入口，直接 node 运行。D 类两个脚本的退休端点反向断言不改。

## 红测试与事实更正

全部六个旧脚本在修改前直接运行，均退出 1：

- first-run：provision 返回 404（符合原任务书的端点失败预期）。
- recreate：旧 persona 不再调度，等待 Agent 回复头像超时，未走到 provision。
- task-parity：旧生命周期入口的“启动 Agent”提交按钮超时，未走到 provision。
- room-add-members：频道“添加成员”按钮禁用，未走到 provision。
- account：旧“添加 Agent”按钮不存在。
- custom-model：旧 Agent 目录行不存在。

日志 `/private/tmp/loom-retired-<脚本名>-red.log`。不能将后五项声称为端点 404；本刀按修订迁移其现存产品对应行为。原任务书 B 有两处而非一处断言，C 的 mock 是活断言数据源，A 只有两个非 npm 脚本。负责人已逐项更正。

## 新发现的旧断言差异

Task-parity 还引用了旧启动确认弹窗、旧删除禁用文案和旧重启标题：当前启动为直接操作，验证实际 enabled；删除确认可取消，验证取消后身份仍 enabled，再对独立临时频道实例执行停止及删除；重启标题为“重新启动”。这些按修订 3 迁移并登记，不改产品。见 `agent-directory-pane.tsx` 的 requestStartStop、`agent-state-dialog.tsx` 和 `kernel/src/agent-deletion.ts:76`。窄屏 header 动作用现有 overflow 菜单，而不是点击隐藏的桌面按钮。

## 检查与部署

浏览器门禁均完成（Fake CLI）：

| 实际命令                                              | 结果与边界                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run test:web:role-activity`                      | 通过，真实 Role 身份 + 3 个模拟 presence 状态；不是 scheduler 时序证明             |
| `npm run test:web:room-add-members`                   | 通过，1440/390：响应丢失/503 两路径，完整请求重放，实例数均 1，Role 仍可选         |
| `npm run test:web:roles`                              | 通过，1440/390 的真实临时 Kernel + Fake CLI 保存、实例化、发言回复                 |
| `npm run test:web:phase4-slice2`                      | 通过，1440/390 Role 修订、频道创建设置与未知结果核实                               |
| `node scripts/test-agent-recreate-browser.mjs`        | 通过，1440/390，旧身份历史与新实例私聊分离                                         |
| `node scripts/run-agent-task-parity-browser-gate.mjs` | 通过，Chrome/Firefox 各 1440/390 + 各一次独立实例删除，共 6 条结果                 |
| `node scripts/test-agent-account-browser.mjs`         | 通过，1440/390，模拟 409 捕获 Role 配置与错误展示                                  |
| `node scripts/test-custom-model-picker-browser.mjs`   | 通过，Claude/Codex 模拟目录的配置捕获，Claude effort 菜单 1440/390；不启动这些 CLI |

`npm run build:web:workbench` 通过，有既有大 chunk 警告。`npm run check` 完整退出 0：packages 2780 项，2758 通过、22 跳过、0 失败；Web 487、console 59、CLI efficiency 单测 236 通过。其余子套件：repository 4、CI 8、release 19、workbench 20、component spec 40、Raft 34、regression 34、browser policy 15、bilateral 3 均通过；类型及 UI 合同检查通过。`npm run format:check` 与 `git diff --check` 通过。跳过项不是通过项。没有付费 CLI 调用；全部浏览器业务夹具使用临时数据库、Fake CLI。正式页面只读核验不等于真实 CLI 验收。

门禁证据在 `/private/tmp/loom-retired-*.log`；task-parity 的 result.json 与截图在 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-agent-task-parity-TX0Xd9`。这些是本机临时证据，不当作永久仓库资产。

## 未覆盖与遗留风险

- 仅本刀列出的脚本迁移；不宣称全仓所有历史浏览器门禁已清理。
- 活动条短暂状态用模拟 projection 验证，不证明普通实例真实经历初始化状态；真实普通回复由 roles 门禁覆盖。
- 自定义模型 mock 与配置提交成功不是真实模型支持证明；本批未做付费、效率或原生 CLI 验收。
- 远端 Role 与 onboard 遗留门面仅在 status §4 登记，不扩展远端协议、不删除端点。
- 已退休的自动问候、旧成员多选/chips/候选消失、无房间 Agent 与旧启停弹窗前提按修订登记，不造产品、不改协议。

## 部署与正式页面

本机实际部署时间 2026-10-03（任务书命名 2026-10-04）。正式 launchd `com.loom.evo` 从 PID35927 优雅停止，启动 PID79909，端口 `127.0.0.1:4176`。源代码基线1287ea2加本批门禁／文档改动，产品源码未改；部署 sourceManifest 已校验与测试后工作树一致，提交号以本报告所属提交为准。

- 备份：`/Users/sun/.loom/evo/backups/pre-restart-retired-gates-e112e4ff-19af-41c8-a8e3-68cd20dd7422`；完整 state 备份核验，并额外以 sqlite `.backup` 得到 `room.db.sqlite-backup`、`runtime-registry.db.sqlite-backup`，两者 `quick_check=ok`。
- 使用本批 `build:web:workbench` 的验证构建快照 `.workbench-web/81a62895296d8aa0bd4e2b05e1a6e81b27c2e961d189cc7a4a120611a655f7fb`；buildId `f764c691ccd13c1b`。
- 重启前 restartable 检查通过：4 条 queued 为 SOS 暂停、2 条 quarantined 无租约，没有在途执行；不取消、不重发这些业务工作。
- 重启后 schema81、quick_check 与 foreign_key_check 通过；11 类业务表逐行哈希未变；4 条历史 persona Inbox/Activation 均 0。
- 正式 Chrome 刷新后读取 Role 列表，打开 P95 Codex A 的模型／effort／参与频道，再打开 p95-task-continuation-20261002 验证真实历史消息与 Task 对话可见。未发消息、未新增正式 Role 或实例、未调用付费 CLI。
- 本机部署操作证据：`/private/tmp/loom-retired-deploy.json`、`/private/tmp/loom-retired-postdeploy.json`。HTTP 首页只是辅助检查，不替代上述真实页面验证。
