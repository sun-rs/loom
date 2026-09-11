# 双边续验与多轮多 Agent 验收

基线：`ac0f486`，正式Web构建 `6bc8922e90b07dbb09e9897cecb7f1d2d8cf4fb8525f30c9fad733fad9f80ef1`。本轮仅增加验收工具，不修改产品调度、prompt或持久协议。

## 先纠正覆盖口径

[核心链第二次真实运行](2026-09-10-core-chain-acceptance-run-2.zh-CN.md)明确未重跑场景一。`real-agent-split-chain-gate.test.ts`包含Human验收后催促恢复父任务，`real-role-contrast-gate.test.ts`验证角色表现，均不能代替一次Human指派后连续多轮、目标达成后停止的证明。

新增 `packages/daemon/test/real-multiround-dialogue-gate.test.ts`：Human在频道临时指派Kimi执行、OpenCode审计；不预设永久角色，不给产品添加特殊调度。三轮计算三角数，执行者每轮提及审计者，审计者PASS后提及执行者继续。验证真实持久消息的发送者、唯一标记、数值与Room序号交替顺序；第三轮后目标终态，观察20秒无新增消息且队列不再活动。只发一次Human消息，测试不补催促。隔离状态始终保留，默认跳过付费运行。

这是用户要求的验收目标，尚不是Raft已通过的事实。它不证明长时间稳定性、强制返工或消息追加组合。对Raft应提交同一业务指令，仅替换实际handle，记录实际消息及其可见结果；不得把本地SQLite证据要求强加给闭源服务端。

## 串行验收顺序

| 项目                          | 判据                                                         | 本轮起始状态                 |
| ----------------------------- | ------------------------------------------------------------ | ---------------------------- |
| 创建/重置、Settings、Reminder | 相同视口/DPR/缩放/状态，源码参数、截图、实际关闭与键盘、刷新 | 本地回归通过；官网新实操待验 |
| 多轮基线                      | A执行/B审计至少三轮；无Human催促；目标后停止                 | 本地单次真实通过；官网待验   |
| 多轮返工与忙时追加            | 审计指出具体错误后A修正再审；追加纠正不丢原请求              | 待验；不能由基线PASS代替     |
| 多Thread及跨Room              | 两条独立对话标记；部分Agent加入Room B；目标/上下文无串线     | 复用旧门禁并补同构建联合验收 |
| DM与记忆                      | 同Agent跨Room/DM新会话召回、更正旧事实；另一Agent负向对照    | 有旧真实证据，本构建待验     |
| 配置与故障                    | 实际CLI/model/effort生效、其他Agent持续工作、断线重启恢复    | 有旧真实证据，本构建待验     |
| Task/Search/附件与其他页面    | 先官方操作确定业务结果，再本地操作及刷新                     | 后续串行，不提前宣称缺陷     |

每项分别记录：实现、自动回归、正式页面、真实模型、同条件官网对照。重复样本不以自动重试隐藏失败；至少再换一次角色/Provider组合才能增强连续协作证据。正常目标停止与测试超时强制终止必须区分。

## 本轮现场

Chrome浏览器扩展连接返回request-header policy加载失败；原生接口可用，但Chrome仅见无痕窗口，Firefox保留Raft/RAH分屏且检测到用户操作。未操作用户的其他网页，未将旧截图登记为新的同条件验收。

`test-agent-parity-controls-browser.mjs` 10组通过，`check-settings-visual-fixture.mjs` 桌面与390宽度通过。测试环境明确为fixture，非正式业务数据；正式实例未重启、未执行Agent重置。

## 本次真实结果

门禁一次运行通过，耗时214秒。精确绑定 Kimi `kimi-code/k3 / high`、OpenCode `deepseek/deepseek-v4-flash / low`，不允许fallback。持久消息为Human一条、三条PROPOSE、三条REVIEW、一条GOAL；三轮结果1、3、6，Room序号依次16/21、32/37、48/53、64。Human中途催促数0；终态后20秒消息数不变。9个Activation全部completed，9个RunAttempt为exited，9个Runtime进程terminated。

完整输出保存在 `/Users/sun/Code/reviews/rah_os/2026-09-10-multiround-bilateral/real-dialogue.log`，隔离库仍保留在日志声明的路径。没有修改正式Agent、角色、记忆或Room，没有重启正式服务。

这是单样本基础协作通过，不涵盖REWORK分支、忙时追加、多Thread、跨Room/DM、故障恢复或Raft同条件运行。后续先注入一个可验证的错误检验返工，再添加忙时纠正；不拿此结果宣布完整核心链通过。

官网补充：通过原生Chrome另开普通窗口，已有登录会话仍可使用；实际入口的AX返回重置三项，但截图与AX状态不一致、关闭元素随后返回elementHasNoFrame。该现场不能形成可靠双边签收，保存的图不作为通过证据。

交付检查：`npm run check`、`npm run format:check`、`git diff --check` 通过；默认全量检查不会启动付费门禁，本次真实结果来自单独设置 `RAH_REAL_DIALOGUE_GATE=1` 的运行。仅测试与文档变更，不重建或重启未变的正式产品；本轮未提交、未推送。
