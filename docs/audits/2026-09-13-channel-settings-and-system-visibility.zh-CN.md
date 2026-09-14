# 频道设置抽屉、成员导航与系统频道隐藏

本批是 Raft 前端结构移植与 RAH Kernel 接线，不是上游字节复制。
来源是公开发布的 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
分析副本为 `/Users/sun/Code/reviews/rah_os/2026-09-13-dialog-audit/`；生产构建不依赖该目录。
原始 bundle 只作分析证据，不加入生产包；此批没有新增上游图片、字体或二进制资源，既有资源沿用原 provenance/notice。

## 前端来源与规则

- `Sy`（pretty 49865）：覆盖抽屉进入 240ms，退出 180ms，曲线
  `cubic-bezier(.32,.72,0,1)`；遮罩进入 200ms、退出 150ms；支持 reduced motion。
  仅频道覆盖抽屉采用此生命周期，聊天并排 Agent/Human inspector 保持立即布局。
- `uct`（152348）、频道标题（155454）：宽上限 34rem，标题 16/20px bold，
  描述 12/16px mono，标题与可见性徽标间距 8px，徽标 11px、1.5px 边框。
  真实 Raft 页面在 1098×1172、DPR2 下测得标题 y=12、高20，描述 y=32、高16，抽屉宽544。
- `wct`（155181）：成员 heading 16/24px，count 12/16px bold、14px chevron；
  heading/count 点击区无背景 hover，头像入口与成员行均打开成员管理。
- 成员 disclosure 的真实 DOM：title 12/16px bold、黑色、tracking1.2px；
  count 12/16px mono、weight500、black/70。不能用通用 SectionLabel 的 black/60 覆盖此处。
- `zD`（139350）：移除标签按钮高28、12/16px、横 padding8；红色 `#f97264`
  透明度默认20%、hover60%，直接叠加行底色。
- `ia`（151450）：添加候选区 flex1，提交按钮固定在底部；hover soft-signal
  即 `#ffd440`。搜索占位按用户明确要求统一为“搜索成员...”。
- 成员行进入既有 Agent/Human 资料组件，保持同一544px覆盖容器；返回回到成员管理，
  X关闭整个抽屉。弹窗通过独立 portal 置于页面中央，避免被抽屉 transform 限制。

## #all 单一状态所有者

Kernel `system-channel-visibility.ts` 持有工作空间级策略，`rooms.system_hidden`
是持久投影（schema56）。Human control Room manager 才可更改。事务内检查
control Room 因果序号与幂等键，更新投影并追加
`workspace.system_channel_visibility_changed` control Room event。
恢复入口始终位于未隐藏的 control Room 权限范围内。

隐藏保持 Room ID、成员与历史不变，但阻断 Human/Agent Room 读写、列表、搜索、
动态、Agent 聊天列表与 Worker 目标解析。启动补建逻辑识别隐藏，不重新创建或恢复。
Web 的频道设置确认与 设置→管理→系统频道 共用同一 typed API；错误不会伪装成功。

Raft 前端的 `hideAllChannel`/`restoreAllChannel` 调用（99255）与 Settings 的系统频道
保存入口（`SettingsPanel-Ce-jc2IN.js.pretty.js` 7516）提供接口/交互证据；本次没有取得
Raft 服务器内部实现，不能声称其内部事务或连带取消行为已经逐项核实。
RAH 保留现有执行围栏：有活动工作时拒绝隐藏，而不取消或遗失在途执行。

## 验证范围

- Kernel 回归：非Human拒绝、因果过期拒绝、幂等冲突拒绝/重复成功、隐藏后Human与Agent读写拒绝、
  Agent频道列表过滤、数据库重新打开后仍隐藏、恢复后原历史不变。
- daemon 回归：隐藏状态不会被启动补建覆盖。
- 隔离真实浏览器：动画时长、Human/Agent原位资料返回、移除hover与错误重试、添加底部按钮、
  390×844布局、隐藏确认取消/确认、接口拒绝读取、Settings恢复及刷新；没有调用付费CLI。
- 源码与真实Raft读取用于核对参数；并未在Raft生产空间执行隐藏、移除成员等破坏性操作。
  因此这不是所有后端连带行为的双边验收，也不宣称所有内容条件下整页像素完全相同。

## 本批检查记录

`npm run check`、`npm run format:check`、`git diff --check` 通过；正式 Web bundle 构建通过。
三个专项浏览器脚本 `test-channel-settings-browser.mjs`、`test-room-member-layout-browser.mjs`、
`test-all-channel-members-browser.mjs` 通过；标题测量使用与 Raft 相同的1098×1172、DPR2。

额外执行的 `run-local-workbench-gate.mjs` 没有通过，不能计为持久化总验收成功。
第一次在手动 onboard 固定成员 #all 时409；脚本改为断言自动成员后，假 Codex
因只接受旧 `app-server --listen stdio://` 参数退出64，等待回复超时。
当前驱动包含已有的 memory policy `-c` 参数。此结果不代表付费 CLI 测试，
也不替代本次 Kernel 持久隐藏/恢复回归和正式页面验证。

正式交付：完成活动执行检查、持久状态校验备份、旧进程 SIGTERM、冻结资产启动；
新进程由 launchd 持有。已在 loopback、LAN、Tailnet 三个正式入口以新浏览器页面
核对构建身份、同尺寸 Human/Agent 资料切换、X 关闭、居中隐藏确认/取消以及刷新。
正式验收没有隐藏真实 #all、移除成员或触发付费 Agent。当前 Web build 为
`ae8e909ec82747aa363953692c62cefb0112a60dafc09eaf707af8b2d4aec5a5`。
