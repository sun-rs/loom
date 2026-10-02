# Phase 4 第一条纵向路径

2026-10-02，负责人授权开始前端对接。保留 main 的大页布局与实例侧栏，先接通
Role 列表 → 保存配置 → 在指定频道创建独立实例 → 打开频道。

## 所有权与边界

- Role/Revision、实例身份及频道成员关系仍由 Kernel 的 role.* 命令管理。
  前端不把 Role ID 当 Agent ID，不把已有实例再次加入另一频道。
- 成员大页改为 Role 管理；已有实例的资料侧栏继续使用 agent.get 等只读投影。
  创建对话框复用现有 Runtime/模型控件，但保存 Role 不配置实例环境变量。
- 创建与实例化各有独立、冻结的写入意图；结果未知时只允许同键同请求核实，
  不因再次点击换键重建。成功创建 Role、实例化失败时保留 Role，重试实例化。
- 新频道先创建空成员，再由 Role 管理创建实例。旧“把已有 Agent 加入频道”
  的入口不得提交旧人格或跨频道复用实例。
- 不调用付费 CLI 验收。浏览器使用明确标记的临时 Fake CLI；正式页面只读核验。

## 本刀不扩展

Role 修订、频道工作区/记忆/Steer 完整创建表单、私聊第三栏整合、平台记忆大页、
运行设置仍需后续前端切片。控制台暂时保留，直到这些操作均有产品 UI 替代。
fork 和 side 不在本刀实现；Task 继续复用已实现的后端与现有展示。

## 验收

测试先证明 Role 创建与实例化不调用 agent.provision/room.member.add；未知结果
重试保留键、payload 与 basedOn；第一请求明确拒绝可修改，核实请求拒绝不丢原意图。
浏览器在桌面与 390×844 验证创建 Role、选择频道、生成实例、导航至频道，并检查
现有消息布局。完成后记录实际执行的检查、部署与未覆盖项。

## 已执行的验证与范围

- `role-write.test.ts` 从缺少实现的红测试开始：未知结果复核保留原 payload、
  basedOn 与键；后续 403 不误判原写入未发生；跨 SPA 页面保留待核实请求；明确的首次 4xx 允许重新编辑；
  并发点击只发送一次。
- `npm run test:web:roles`：真实 Chromium，1440×1000、390×844，同 DPR=1、
  默认 zoom；指针点击保存和实例化，Human Enter 发消息，Fake CLI 的真实 Worker
  回帖可见。故意在服务端已经提交后丢失 Role 创建、实例化响应，再核实，数据库
  投影各只有一个 Role／实例。无 `agent.provision` 或跨频道 `members/add` 请求。
- 旧 shell fixture 在 Kernel 尚无工作区分配器时种下的频道只有 `channel_home`
  元数据、没有 `primaryDirectory` 回执，导致新实例排队但不运行。本门禁通过运行中
  daemon 的正式 `rooms/create` 创建频道，取得回执后完整通过；没有修改产品围栏，
  没有把缺回执的夹具判为执行成功。
- CSS 只增加本地布局，ChoiceRow/RuntimePicker/DialogLayer/PanelHeader 保留共享
  展示所有权。sidebar-row、sq-btn 浏览器规则证据与 UI catalog 按新 CSS 重新生成。
- 首次完整检查：后端 2755 通过／22 跳过；Web 有一项仍要求旧 `agent.provision`
  接线，已改为要求 `role.create`、`role.instantiate` 并禁止旧调用。不是放宽相同
  行为的断言；本批有明确的产品合同变化。第二轮完整检查后端仍为 2755 通过／22 跳过，
  Web 剩余一条目录错误边界名称仍写“成员目录”，已改为“Role 管理”，错误边界本身保留。
  最终 Web 全套及后续控制台／parity／浏览器策略／双边捕获／效率门禁单测均分段通过；
  最终前端 tsc、工作台 build、format:check、diff 检查通过。不声称完整 check 首次或
  最后一次单命令全绿；失败均为此次改名／接口替换的旧断言。部署见 status 当前记录。
- 本批没有付费调用；Fake CLI 不证明原生 session 或效率。后端真实连续性与 Task
  对话证据仍分别引用 P86/P95，不从本前端门禁推导。

## fork / side / Task 状态

- **fork（S4）：未实现产品路径。** 没有“复制本频道实例上下文生成新成员”的可用入口；
  session 尚在时有限 fork 接替故障实例也未实现。现有安全行为为停止／隔离，由 Human
  显式 reset 决定新开会话，绝不把它称为保留原上下文的 fork。
- **side（S5）：未实现。** 没有隔离临时 session 的创建、消息箱、凭据、销毁链路；
  记忆只读的判定点不等于 side 已可用。现有私聊是同实例同 session 的排队私有 box，
  会影响后续上下文，不能充当 side。
- **Task：核心业务与对话范围已实现。** Human 创建／历史消息转 Task；默认禁止实例
  自主创建，可按频道开启；领取／启动／进度／提交／Human 验收；完成后仍可在消息列
  讨论，不以 Task 年龄使对话失效。自动唤醒按关注／定向目标，频道与消息列各自计算
  差额，未关注实例不会因普通 Task 追问被唤醒或自动收到其正文。
  P95 两个 Codex 各两轮通过 Task 续聊、频道续聊、范围与 session 连续性。
  P94 同 Activation 过期恢复修复只有确定性回归；Task 同题原生效率对照未完成，
  不宣称所有 CLI、故障和性能分支全部验收。
