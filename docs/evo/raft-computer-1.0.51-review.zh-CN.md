# Raft Computer 1.0.51 与 Loom 创建入口边界

核查日期：2026-10-22。此处区分发布说明、可见源码与 Loom 实现，不把二进制版本当完整服务端版本。

## 发布证据

官方发布接口：<https://hands.build/public/v2/apps/raft-computer-cli/latest?channel=main>，stable 1.0.51，build id `fef56927-35b6-48f0-9b44-8865c6037519`。接口由官方 `packages/shared/src/computerReleaseNotes.ts` 指定。响应含临时签名下载地址，不存储完整响应。

公开仓库 <https://github.com/botiverse/raft-source> 的 HEAD `db5e399f017d584e49597e3a28757645d6807893` 中 `packages/computer/package.json` 仍为 1.0.49。没有取得1.0.51完整源码，也没有取得1.0.32至1.0.51全部逐版差异；以下是最新发布说明，不宣称累计19版变更清单。Computer是本机执行端，不等于Web或中央server。

| 1.0.51 发布说明                                | 对 Loom 的价值与边界                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Built-in/Pi 未指定超时的shell命令默认10分钟    | 可参考单工具超时；不可据此给整个原生CLI会话加10分钟强杀                                      |
| Windows启动不再污染PowerShell环境/累加NO_PROXY | 当前Mac主线低优先级                                                                          |
| 确认实际无进程后恢复残留running状态            | 可参考进程存活校验；不能照搬静默换会话，保留Loom lease/generation及清理栅栏                  |
| 额度耗尽等待provider重置，期间新消息不反复唤醒 | 最值得定向比较；Loom已有分类退避，但不代表已实现相同重置时间语义；尚未复现实例，不改冻结后端 |
| Kimi后台刷新不再丢失更新凭据                   | 源码有kimiCredentialLock/tokenRefresh；Loom让用户CLI管理认证，不引入另一套账号管理器         |
| 升级下载网络重试/更清楚报错                    | 可供未来发布器参考；远程控制本期冻结                                                         |
| integration manifest 64KiB扩至1MiB             | Loom排除托管第三方MCP管理，不恢复此子系统                                                    |

这些发布记录没有证明上下文拼装或多模型成本下降，也不能替代同模型长任务对照。

## 本批计算机列表

官方来源：上述锁定源码 `MachineDetailPanel.tsx::MachineAgentList`、`MachineAgentRow.tsx`、`ShowMoreToggle.tsx`。沿用已有官方ListRow/AvatarListRow/SectionHeader/按钮/确认弹窗。批量工具条为结构移植，保留native参数；Loom绑定实例ID和既有ManagementClient，不引入上游store。遵循仓库adoption记录的许可/来源；没有改动原始官方文件。

- 显示实例真实执行策略绑定模型，非Role最新修订模型；目录找不到显示实际binding id，未知不伪造。
- 默认6行；展开/收起；进入选择展示全部，支持全选/取消及明确计数。
- 启用、停止、重启/重置均二次确认。确认集合固定；跨Role只保留各实例当前配置，不提供一个公共Role修订覆盖选项。
- 复用已有逐实例操作与结果未知核对；首个非成功即停止，已成功不回滚，不自动重试剩余。
- 已启用/已停止是调度配置状态，不冒充在线presence。未新增后端接口/付费模型测试。

## 创建入口（owner已确认；本批落地范围）

1. 两页复用同一创建Role弹窗，计算机页仅预选能力来源计算机；名称/随机名/原生间距等复用官方组合。名称首先，CLI叫运行时。
2. Role不自动生成会话或私聊。默认仅保存配置；显式后续“添加到频道”或“开始单聊”才创建实例。创建实例失败保留已保存Role，不重复创建Role。
3. 计算机选择表达模型目录来源，不把Role概念永久绑定机器。但当前runtimeOfferId/model binding确实来自具体Host，尚不是可任意跨机运行的抽象；未来实例选机要重新校验能力，禁止静默换模型。
4. 计算机页新增入口称“新建角色”才能准确说明保存效果。若要立即增加本列表实例，应走“添加实例”→选Role和频道。不要用同一个“创建Agent”掩盖两种结果。
5. 弹窗底部提供默认关闭的“保存后添加到频道”。保存成功后明确显示角色已保存，再确认添加实例；两次独立提交、分别展示失败，添加失败可重试，不重复创建Role。本批不新增隐式会话。
6. 环境变量不是现有Role配置字段；RuntimeGuide的environment不是Role冻结快照。不能把Role表单接到全局运行设置。快速模式也不能只凭CLI名称显示：Codex执行器当前拒绝未经验证的非默认serviceTier。应先完成能力与启动链路验证，再开放输入。

官方依赖化可以省去原生尺寸、样式与交互的重复实现，但Loom的Role/Instance边界仍需适配。若这部分语义由前端假装等同上游，更新时仍会持续返工。

## 删除角色的真实行为

`packages/kernel/src/role-catalog.ts::delete`验证Human管理权限、expectedRoleRevisionId和因果基线后，只设置role_templates.deleted_at并追加role.deleted事件。不更改instance/agent定义、运行进程、Inbox、会话、历史或冻结修订。

- 运行中的实例继续运行；已有实例仍可后续收发消息，删除配置不等于停止调度。
- 原Role不能再修订或新增实例；原实例可经频道入口/计算机批量操作继续管理。保留当前配置的重置仍受运行中/清理栅栏约束。
- 同名新建是全新的Role ID，旧实例不会自动归属新Role。
- 删除是逻辑删除，保留历史修订以支持实例快照；不是物理清空或隐私擦除。
- 补充定向Kernel验证：在真实fixture RunAttempt运行中删除Role，实例、冻结修订、定义、会话、运行/进程、Inbox及消息表逐行不变，原run仍可正常结束。未修改后端实现。

本批同时按owner要求把选择态取消按钮改为outline；计算机正文使用stable scrollbar gutter避免展开时宽度变化；运行时标签移除重复“可用”，仍保留“不可用”。这是有记录的Loom布局稳定性适配，并非声称上游源码原本使用该样式。
