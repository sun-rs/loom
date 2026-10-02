# Phase 4 第二刀：Role 修订与频道设置

## 前置复核（2026-10-03）

开始 HEAD f098014，evo 工作树干净，服务 com.loom.evo / 4176 / ~/.loom/evo。
任务书第 1 节八项均已独立核实：RoleReviseRequestSchema 继承 configuration、
basedOnRoomSeq、idempotencyKey 并要求 roleId/expectedRoleRevisionId；Kernel revise
事务写 role.revised；SDK 注册与 HTTP 门面均存在；apps/web/src 无修订调用；
createRoom 漏三个设置字段；room.update 协议有两开关而前端未传；控制台已有目录解析。

room.create 的 strict schema 没有记忆默认值。按任务书 §2.2 明确例外，跳过创建时
记忆开关，不发明字段、不改 Kernel 或目标合同。控制台继续承担现有记忆配置能力。

## 设计

- Kernel 仍拥有 Role 修订、实例快照与频道设置。前端只持有表单和冻结写入意图。
- 修订复用 AgentCreateDialog 的配置控件，初值取当前展示的 Role Revision；保留
  未被表单编辑的配置字段。使用 RoleWrite 同键、同 payload、同 expectedRoleRevisionId
  核实未知结果。意图在 App 作用域持有，跨 SPA 页面仍可恢复；拒绝后允许重新加载修订。
  不改变 role.create/role.instantiate 行为，不自动更新既有实例。
- 创建频道增加固定附加目录、Steer 与自主 Task 开关。使用现有协议 schema 验证
  目录文本；文件系统有效性仍由后端检查。创建意图冻结直到确定成功或明确放弃；
  只在确定成功后导航，不因失去响应再次建频道。
- 频道设置显示 canonical 主目录/附加目录，只读；两开关通过 room.update 保存。
  复用现有对话框、共享控件和颜色，不做另一套设置页。

## 验证计划

先红测试：修订冻结键/序号/修订 ID、拒绝可编辑与并发；目录解析与设置请求；真实
Chromium 桌面及 390×844 指针测试修订、旧实例标记、响应丢失后同键核实、创建和
更新频道设置。临时数据库与 Fake CLI；不触发正式付费工作。

完成后完整 check、format、diff、build 与浏览器门禁；安全备份两库、优雅重启精确
服务、核验正式页面，独立记录代码/检查/浏览器/部署结果。fork/side/私聊整合、
记忆页、运行设置、控制台删除均不在范围。

## 实现文件与职责

- `apps/web/src/App.tsx`：接线修订入口；跨 SPA 保存修订/频道写入意图；创建、更新
  频道发送已存在的协议字段；未知结果只核实同键同请求。
- `components/agent-dialogs.tsx`：原配置表单增加修订初值与标题/按钮，保留未编辑的
  Role 配置；创建模式不变。
- `components/role-directory-pane.tsx`、`components/role-revision-editor.tsx`：详情入口、
  修订 ID 冻结、修订表单恢复及核实/显式放弃；既有实例仍展示后端 isCurrent。
- `components/room-dialogs.tsx`、`components/channel-policy-fields.tsx`：创建与设置
  控件、不可变工作区展示；使用共享现有 DialogLayer/样式，不增加本地行配色。
- `channel-settings-input.ts`：复用协议的附加目录格式校验；文件存在性/所有权仍归后端。
- `apps/web/test/phase4-slice2.test.ts`：目录约束、修订意图冻结/拒绝/并发回归。
- `apps/web/test/component-ownership.test.ts`：同一配置表单同时承担创建与修订的所有权断言，保留旧 Agent/Role 创建标题检查，增加修订标题。
- `scripts/test-phase4-slice2-browser.mjs`、`package.json`：本刀浏览器门禁入口。
- 本文与 `status.zh-CN.md`：范围、验证、当前部署和未覆盖项。

## 浏览器证据与局限

本刀门禁在临时真实 daemon/Kernel + Fake CLI 夹具上执行：1440×1000 与
390×844，默认 DPR=1 / zoom；真实 Chromium 指针点击保存/开关。服务端已提交后
主动丢弃 Role 修订、频道创建、设置更新响应，验证同键同 payload/basedOn 重发，
并逐请求比较。频道创建及修订还验证离开 SPA 页面后恢复原意图；每个创建结果仅一项。
修订后旧实例保持原 revision、显示“使用旧版本配置”。附加目录/两开关通过 API
回读核对，主目录与附加目录在设置页只读可见。上一刀 Role 创建/实例化/频道发言/
Fake CLI 回帖门禁再次通过。

初次测试先在缺少目录解析实现、缺少编辑入口和附加目录控件时失败；设置未知
结果门禁在缺少核实入口时失败。实现后通过。中间浏览器失败包括精确 label 包含
字符计数、手机详情页隐藏列表/导航按钮，修正了测试定位/导航，未删功能断言。
手机 Role 页以直接 URL 进入；跨 SPA 恢复在桌面验证，不声称验证了手机全局导航。

截图：`/private/tmp/loom-slice2-role-{1440,390}.png` 与
`/private/tmp/loom-slice2-channel-{1440,390}.png`（临时 Fake 夹具，不是正式实例）。

未覆盖：本批不执行付费 CLI、不重新判定原生效率；不覆盖刷新/关闭浏览器后恢复
未决意图（离开时有 beforeunload 提醒）；Role 修订冲突及并发提交有确定性单测，
没有多浏览器并发写入验收；不宣称强文件系统隔离。无新增 Kernel/协议语义。

同一 JS 时刻的双提交竞态探针复现了首次成功后未导航的问题：第二次回调在被写入
意图拒绝之前推进了 navigation generation。增加同步提交锁及回调忙态前置检查后，
只发一个创建请求、只有一个频道，并正常关闭表单导航。该探针为合成 submit 事件，
与前面的真实指针路径分开；最终本刀浏览器门禁再次通过。

历史导航夹具 `docs/audits/fixtures/2026-08-31-real-callback-regressions.mjs`
同步注入真实 RoleWrite、同步 head 和 room.create 响应；保留“完成后仍对账，但不能
抢走后来 Settings 导航”的原断言。第二次完整检查在这里因缺依赖抛 ReferenceError；
不是业务断言失败，也没有删掉此用例。修正后 parity 34 项与剩余检查链通过；最终
完整命令结果在交付记录中单列。第一次完整检查的唯一失败为上面的旧标题源码断言。

## 最终检查与部署

- `npm run check` 最终完整退出 0：后端 2755 通过、22 跳过；Web 487、控制台 59、历史回归 34、正式浏览器策略 15、双边截图策略 3、CLI 门禁单测 236 均通过；其余类型、仓库边界与发布策略检查通过。日志 `/private/tmp/loom-slice2-check-complete.log`。
- `npm run format:check`、`git diff --check`、`npm run check:ui-library`、`npm run build:web:workbench` 通过；构建有已有大 chunk 提示，不是失败。
- `npm run test:web:phase4-slice2` 与 `npm run test:web:roles` 通过。前者同时覆盖桌面和 390×844 设置/修订流程，后者覆盖原有创建/实例化/Fake CLI 回帖；均为免费临时环境，不能当真实模型验收。
- 部署前无活动执行；4 条排队被 SOS 保留，未恢复运行。完整状态备份、校验、副本预检后，对 room.db 与 runtime-registry.db 分别执行 sqlite `.backup`，两副本 quick_check 均为 ok。
- 备份：`/Users/sun/.loom/evo/backups/pre-restart-phase4-slice2-44f4b758-69a4-4fe8-99e6-9479c4e594d8`。优雅停止旧 PID 29869 后启动新 PID 5231，未强杀。数据路径不变。
- 已验证前端快照 `.workbench-web/966281209e40414924d3e35b97bb11672416bf30efb0f91ab90cff9d08a0225f`，buildId `30db8e5d1da11648`；健康信息与快照一致。schema 81、数据库 quick_check／外键检查通过；九类业务／session／事件表哈希前后相同。
- 正式 Chrome 新加载 `http://127.0.0.1:4176/?surface=agents`，打开 P95 Codex A 的编辑配置，核对既有名称、instructions、Codex/GPT-6-Luna/Low 回填后取消；进入既有频道，核对主目录、附加目录、Steer 开启与自主 Task 关闭、未修改时保存禁用。正式页未执行写入、没有启动 CLI。
- 按任务书先部署后提交：部署来自 `f098014` 加本刀工作树；构建到部署期间前端源文件哈希一致，提交后仅补记产品提交号，不改变已运行源码。对应产品提交 `440cabd`；本段提交号补记只改文档。推送状态以最终交付时核验为准。
