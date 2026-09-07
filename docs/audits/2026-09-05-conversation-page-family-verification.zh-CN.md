# Conversation / Search 页面族验收

日期：2026-09-05

状态：实现、累计门禁、双浏览器验收与正式工作台重启通过。

## 审计边界

本报告验证 Raft 冻结源码所能证明的消息菜单顺序与条件、Search 异步
状态，以及 RAH 本地 canonical 副作用。它不把内部截图回归当成官方双边
像素证明，也不把 Raft 中央搜索质量或未知后端语义写成 RAH 能力。

## 设计裁决

- UI 标签、条件和顺序来自冻结 Raft bundle。
- Thread follow、Task workflow、Message post 与 Room ledger 仍由 typed SDK
  和 Kernel 拥有。
- `completed` 不可重开是 RAH 对冻结交付证据的明确差异；`cancelled` 才能
  经过停止证明重开。
- Raft 普通消息菜单没有 edit/delete；本批不补虚构动作。

## 实现与 TDD 结果

- `conversation-page-family-contract.test.ts` 先因缺少 Task 菜单状态 owner
  失败，再实现至 3/3 通过；它固定 Raft 菜单顺序、Search 五卡 skeleton/
  retry owner，以及 RAH 的 Task 权限与生命周期分支。
- Search 在 composition 期间不请求，200 ms 稳定输入后才检索；loading
  使用内部共享的五卡 skeleton，schema/read 失败保留在 Search 舞台并可重试。
- 真实 Thread 的关注项只在消息菜单打开时读取，写入走
  `activity.follow`；无 Thread 的消息不触发该读取。
- 关联 Task 的菜单复用 Task 看板同一个 typed transition；todo 因缺少
  Review 证据而禁用，submitted 可完成，cancelled 可重开，completed 的
  冻结交付证据不会被 UI 破坏。

全量 `npm run check`、`npm run format:check`、`git diff --check`、UI registry/
library/CSS 合同及正式 `build:web:workbench` 均退出 0。Vite 仍报告既有大
chunk 警告；本批没有把它隐藏或误记为失败。

## 真实浏览器与业务结果

最终累计收据：
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-hAvS9r/receipt.json`。

- 970 个生产、内部 UI、fixture、脚本与登记输入被内容哈希固定。
- Chrome `152.0.7977.77` 13/13、Firefox `150.0.2` 13/13，共 26/26
  场景通过；覆盖 1440×900 和 390×844。
- Search 使用原生 composition/input 事件验证不误请求；五张 pending 卡、
  schema-error、重试和空历史均实操并截图。
- Message 实操回应、收藏、右键菜单、创建 Thread、取消/恢复关注、关闭后
  焦点返回、长消息展开/收起和 composer 发送。
- 浏览器不只读取 DOM：验收独立回读 follower read model、Room ledger，
  并确认关联 todo Task 的完成动作因 Review 缺失而保持禁用。
- 两个引擎的 `blockedRequests=[]`、`rejectedRequests=[]`；新增写入仅开放
  fixture 明示的本地 typed Thread、follow、Message 和 Task 接口。

人工检查两引擎的 Search loading/error、消息 Thread 关注菜单和 Task 保护
菜单截图，没有发现新增横向溢出、边框错位或动作顺序漂移。

## 门禁自身发现与修正

第一次累计运行在 Firefox 的消息 hover 处超时；失败截图已显示操作条，说明
产品行为正确，脚本却用消息 ID 重新拼选择器。改用 DOM handle 后，第二次运行
仍暴露虚拟列表会重挂载节点：等待已命中当前 hover 行，下一断言却重新取动态
`.first()`。最终脚本绑定 hover 行的 canonical message ID，并在重挂载后重新
定位同一消息。Firefox 单跑和最终 Chrome→Firefox 累计运行均通过。

该过程保留为验收可靠性证据：不把失败称为偶发，也没有为让门禁变绿而放宽
产品行为或 HTTP 请求边界。

## 未扩张的结论

- 本批是冻结 Raft bundle 所证明的菜单/Search 状态对齐，不等于当前官网同
  前置条件的全页像素双边证明。
- Translation 没有本地 owner，普通消息 edit/delete 不在该 Raft 菜单中，
  均未自编。
- 通知设备送达、完整 Human/ACL、Computer 管理和其余权限/失败组合仍需各自
  专项验收。

## 正式重启

- 重启前确认 PID `9927` 精确持有 `/Users/sun/.rah/state/room.db`、仓库
  cwd 和 `127.0.0.1:4173`；guard 对 active work 进行空闲检查。
- 新 Web build ID：
  `deedc72ad943eb0e5bf42faf2e96ef1122b08b0de0f8a7c5fc9ea5366f789de1`。
- 校验后的在线 SQLite/状态备份：
  `/Users/sun/.rah/backups/pre-restart-ff721292-9f18-4203-862f-fb8a2042da60`。
- 新 PID `31098` 继续持有同一个 canonical state 与 4173；health 返回
  online，HTML meta 返回精确 build ID，入口资产为
  `/assets/index-BMFOS6Dg.js`。
- 正式 Firefox 旧标签先正确进入代际恢复页；点击“立即刷新”后，现有两个
  canonical Task 仍显示在待确认列。真实点击 Search 后 URL 为 typed
  `surface=search`，搜索框、发送者/范围/频道/时间/排序控制及
  “搜索所有内容”空态正常，没有重启 JSON/fetch 错误横幅。

因此本批正式发布已完成；以上不把 fixture 的 26/26 扩张为官网全产品一致，
也不把 Firefox 页面加载扩张为通知设备横幅送达证明。
