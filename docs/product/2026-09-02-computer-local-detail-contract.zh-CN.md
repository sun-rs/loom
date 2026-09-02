# P6.6 本机 Computer 详情 Raft-first 合同

状态：`C/A/L/D` 完成；整库源码门禁被并发出现的非本批未完成文件阻塞  
日期：2026-09-02

## 1. 产品边界

本批只把 Raft 已公开、且能由 RAH 本机 daemon 真实支撑的 Computer 详情合同映射到本地：

1. Computer 独立侧栏宽度、拖动、键盘和选择状态；
2. 检测到的 Runtime 徽章及其本机探测详情浮层；
3. 这台 Computer 上的 Agent 列表、官方头像／实时状态和资料跳转；
4. 本机状态、Runtime 与 Agent 绑定的可复制诊断摘要；
5. 非在线状态的恢复说明，但只展示 RAH 真实存在的本地命令或只读证据。

多 Computer 注册、中央 relay、跨机迁移／文件传输、Raft 账号配额、远程升级和替用户安装／登录 Provider CLI 仍明确排除。RAH 页面不得把 `runtime.available` 当作 Computer 在线，也不得把 Raft 的 `raft-computer` 命令改名后冒充本地已实现命令。

## 2. 上游证据

冻结发布物：

- `docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js`
- SHA-256：`5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8`
- 正式 DOM/getComputedStyle 令牌：`packages/ui-tokens/generated/generated/raft-official-computers.css`
- SHA-256：`7a147667163c29b599ab290de8d377d71bbe34ab39f7abe78f602590ba6654e0`

可直接复刻的合同：

- Computer 二级侧栏默认 `320px`、边界 `240..520px`、拖线 `8px`；它不是聊天侧栏的尺寸协议；
- 详情头、hero、信息段、Runtime chips 和 Agent 行使用已生成的官方尺寸／间距令牌；
- Runtime chip 只有已检测且当前 Human 有权读取时可交互；`ga` 使用 hover `200ms` 打开、`160ms` 关闭，focus 立即打开，click pin，外点／Escape 关闭；desktop 浮层最大 `390px`，窄屏为 sheet；
- Runtime 浮层从独立 endpoint 读取并可 refresh。RAH 不具备 Raft 中央 account-usage owner，所以只结构化复刻触发、浮层、关闭和 loading/error 形态，正文映射现有 `host.runtime.list` 的本机可执行文件、版本、Profile、Offer、模型证据与 Agent bindings。现有 reconciler 每 5 秒和窗口重新聚焦时刷新，同一浮层不再额外放一个会制造第二读取状态的手动刷新按钮；
- Agent 行来自该 Computer 的 canonical assignment，点击进入 Agent 资料；头像和状态使用全站共享 Agent owner；
- Raft 非在线恢复卡展示 restart/status/doctor 及安装／setup 的展开分支。RAH 只可显示项目真实存在的 `npm run doctor:local-core` 诊断入口；服务启动／重启继续由操作员和既有安装 owner 负责，本批不从浏览器执行 shell。

当前 Raft 直达 `/computers` 在无 tab-memory 时可为空态，不会一律自动选择第一台；RAH 本批只有一个本机 Computer，保留显式的 local-first 默认选择，并把这项标记为 deliberate difference，不冒充 byte-exact。

## 3. 单一所有者

- `host.runtime.list`：daemon 读取 Host heartbeat、探测本机 CLI，并返回严格、裁剪后的 inventory；
- `ComputerRuntimePane`：只投影 inventory、控制 selection／浮层／复制反馈和导航，不扫描文件系统、不执行命令、不推导账号用量；
- `computer-sidebar-resize`：独立拥有 `320 / 240..520`、storage、pointer 与 keyboard 计算；
- `AgentAvatar`：继续拥有官方头像、上传图片与 presence dot；Computer 页面不得生成首字母头像；
- `App`：只拥有跨 surface 的 Agent typed navigation；Computer 行不直接拼接 URL；
- Clipboard：仅由用户手势写入裁剪后的本机诊断摘要或明确命令，失败给独立可见错误，不改变业务状态。

## 4. failure-first 与验收

必须先固定以下反例：

- Computer 错误复用了聊天侧栏 `240 / 180..320`；
- Agent 行是首字母块且不可点击，未复用官方头像和 typed route；
- Runtime chip 是无交互 `span`，没有 hover/focus/click/Escape/outside/mobile 合同；
- 诊断详情泄露未裁剪的环境、凭据或 Provider 账号信息；
- Runtime 浮层打开后切换 Computer/surface 仍残留；
- 390×844 出现横向溢出或浮层跑出 viewport。

发布门禁：定向 unit/DOM 测试、全量 `npm run check`、格式／diff／build／audit、Chrome 或 Firefox desktop 与 `390×844` 真实 pointer/hover/keyboard/focus/copy、正式 active-work 审计、离线一致性备份、4173 单实例优雅重启和正式页面只读复验。

## 5. 施工与验收记录（2026-09-02）

- failure-first：定向测试先暴露了 Computer 错用聊天侧栏尺寸、Runtime chip 无触发状态机、诊断摘要混入无关 Agent、浮层关闭后焦点恢复会立即重新打开，以及 pointerup 把上一帧宽度写入 storage 等反例；实现只修正对应 owner。
- `C`：新增独立 `computer-sidebar-resize` owner；Runtime inspector 复刻 `200/160 ms` hover、focus、pin、Escape、外点与 mobile sheet；Computer Agent 行复用 `AgentAvatar` 和 typed Agent navigation；诊断仅序列化当前 Runtime binding 的裁剪证据。
- `A`：Computer 定向 owner/模型/交互测试 `9/9` 通过；Web typecheck、产品构建、精确格式、diff 和依赖审计通过。全量 `npm run check` 的第一轮只发现并修正旧的 Computer 根节点静态正则；重跑随后被本轮外新出现、尚无实现的 `MessageReferenceSchema` 测试阻塞。正式停机后的重建又发现同一批外部改动删除了被 `message-markdown.tsx` 导入的未跟踪 `message-rich-text.ts`。因此不能把整库门禁或当前源码重建记为通过，也没有擅自重造这两个非本批 owner。
- `L`：真实 Chrome 门禁在 desktop 与 `390×844` 完成 pointer drag、Home/End、storage 恢复、Runtime hover/focus/click/Escape/outside、clipboard 裁剪、Agent 资料往返与 viewport 检查；Firefox 150 同样完成 desktop/`390×844`，均 `PASS`。没有调用真实或付费 Provider。
- `R`：冻结 Raft 发布物和正式 DOM 已证明本合同列出的前端行为；Raft Computer 在相同账号前置下仍离线，故没有把 RAH 本机非空 Runtime/Agent 数据写成同前置双边数据成功。
- `D`：正式审计确认 28 个 Activation、RunAttempt、RuntimeProcess 全部终态，pending InputRequest、Reminder、SOS、改派、取消和 exclusive lease 为零；一条 `submitted` Task 原样保留。离线备份 `/Users/sun/.rah/backups/pre-p66-computer-offline-20260902Tc5HJpC`（852 MiB）的三份 SQLite 均 `quick_check=ok` 且无外键异常。因当前源码被上述并发删除破坏，4173 使用本轮 Chrome/Firefox 门禁后生成的不可变发布物 `.workbench-web/8c734f3af65c07a0fa58e6b5e26220873684df29662132b1f1f216bf8c6d5109` 恢复，而没有读取失败构建目录。正式 Firefox 新标签实际确认 320 侧栏、4 个 Runtime、4 个 Agent、Runtime 详情、typed Agent 资料往返和返回状态；服务 online、单监听，重启后三库完整性和 28/28/28 终态保持。该部署证据不消除源码门禁阻塞。

## 6. 后续而非本批

Computer 显示名称／描述编辑需要一个独立 durable profile owner，不能塞进 Host heartbeat 行；创建者／创建时间也必须来自不可变 canonical identity。安装产品的 status/doctor/restart CLI 在存在、签名并通过安全审计前，页面不能提前显示假按钮。这些项目在本批交互闭环后另立 schema／protocol 设计。
