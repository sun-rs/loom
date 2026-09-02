# Agent 资料颜色、密度与滚动验收

## 结论

本轮修复了颜色变量失效、操作区额外间距、缺失图标、窄屏资料增高与长内容溢出风险。
正式 4173 已备份后安全重启。**不宣称 Agent 资料所有功能与 Raft 一致。**

设计及源码出处：[本轮合同](../product/2026-09-01-agent-profile-layout-contract.zh-CN.md)。
来源是授权 Raft 页面及冻结的 `AgentDetailPanel-DKwoNvgK.js`，没有引入其他框架。
SVG 几何直接取自官方 DOM，CSS/JSX 为源合同驱动的结构移植与本地适配，不是整页源码原样复制。

## 实际问题与处理

- 官方操作区属于普通滚动内容，不是 sticky footer。1440×1000 / DPR1 下，
  官方 Alice 的第一个按钮 y=895，删除按钮仍需滚动；截图不能证明永远首屏可见。
- 本地原来操作标题后 margin-top 29px、删除前额外 24px，均已移除。
  正式同一个 Claude 页面首个按钮由 y=893.69 到 y=844.37，
  删除按钮由 y=1109.69 到 y=1036.37；操作 section 从 334px 降至 293px，
  与官方 section 293px 一致。五按钮均 40px、间隔 8px。
- 本地模型、成员等使用未定义的 `--purple`，实际白底；统一改用生成的
  `--lavender`（#bbafe6），同时修复其他 authored CSS 的同一个错误引用。
- 报告问题原底色正确，但 disabled 的全局 opacity .45 把整个按钮洗白。
  现在只对“能力尚未提供”保留橙色 #f8a16f / 黑边，并用灰字和可见“暂不可用”
  表达禁用，仍是 native disabled 且无 handler。删除底色 #f97264。
  这是有意的本地 unavailable 呈现，不等价于官方可执行的报告按钮。
- 补官方 pencil / rotate-ccw / bug / trash-2 图标；保留真实管理与动态入口。
  图标资源 SHA-256：`ea98eacd45f6e7ad41cf10433c5eb4056abf87164d31cc8e03ca3853618fd060`。
- 名称与状态同行，handle 下一行；取消窄屏 136px 强制 hero 和创建元数据强制单列。
  不隐藏完整描述，不修改 Agent 身份、记忆、模型或运行时配置。
- 移除误把 role 文本称为人设指令的额外 summary，真实配置编辑保持可达；
  没有创建者关系投影时，移除假 0，明确显示暂不支持。

## 实测矩阵

| 环境                                | 验证结果                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 官方 / 正式本地，均 1440×1000、DPR1 | 实测正常资料滚动、源颜色、字段间距、40px 按钮与 8px 栈；官方 Alice 和本地 Claude 的资料不同，不据此声称整页像素一致                   |
| 隔离 4198 实际产品 UI               | 管理打开现有配置，Escape 关闭并返回“管理 Agent”焦点；查看活动诊断切到动态并加载跨 Room 历史；没有发送 Fake CLI 消息                   |
| 隔离 390×844                        | 实际 hero 104px；document 390/390、资料区 clientWidth/scrollWidth 379/379；创建者和时间在能容纳时同行；滚动到底五按钮全部可见，各40px |
| 正式 Codex DM 的 380px 右栏         | 点击消息头像仍默认动态；资料切换成功；长名称、长 host 标识、运行时标签没有横向溢出（367/367）；滚动到底五按钮可见                     |
| 正式键盘与命中                      | 五按钮中心 elementFromPoint 均命中自身；Tab 从管理跳过 disabled restart 到诊断，再跳过报告到删除                                      |
| 正式既有业务                        | 既有 Codex 私聊与两条消息仍可见；未调用任何付费 CLI，未执行启动/停止/删除/配置保存                                                    |

浏览器截图已在本次操作中逐张查看；没有以 DOM 报告代替视觉检查。
没有运行新的 Firefox 或真实付费多 CLI gate，这次不能作为它们的新验收。

## 自动化与部署

- 新增 4 项回归先全部失败，再全部通过。
- `npm run check`：685 package（683通过、2跳过）+100 web+33 callback；
  共818项，816通过、2跳过，TypeScript通过。
- `npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。
  构建仍有原有的大 chunk 提醒，不是零告警构建。
- 旧正式 PID 12382 已收到 SIGTERM 并退出，新正式 PID 22937 已验证监听4173。
  重启前仅有 completed Activation / exited RunAttempt / terminated RuntimeProcess，
  没有任务或在途执行。
- 备份：`/Users/sun/Library/Application Support/RAH OS/backup-before-profile-O3dht1`。
  重启前后2 Workspace、6 Room、16 Membership、2 Message、4 AgentDefinition、8 Revision。
  Room/Membership/Message/AgentDefinition/Revision 的全部行内容摘要一致；
  排除 SQLite WAL/SHM 辅助文件后，8个私有配置/记忆文件逐字节摘要一致。
- 冻结资产：`.workbench-web/ed50f2444e107b1b92517ce80ce369760198b84a7791c5dc778bbc2612ec863f`；
  新浏览器确认加载 `index-C-ExaeeK.js`。不是4198测试环境。
- 本轮未提交、未推送；保留上一轮未提交修改。

## 明确保留的差距

管理不是 Raft 的直接启动/停止；安全 restart/reset 和本地报告问题流程未接入；
“查看活动诊断”仍先进入动态页再使用已有元数据导出，未冒充直接复制按钮。
删除仍进入现有管理和安全前置检查。创建者/计算机链接、完整技能/创建关系投影、
Raft 的逐字段编辑与本地统一配置窗口等差异仍在行为指南中登记。
本轮修复是资料布局与呈现，不是生命周期或 Agent 页全量收口。
