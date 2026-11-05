# Loom 文档入口

当前产品分支是 **main**；`docs/evo` 是保留的文档路径，不是仍在开发的分支。`chatbox` 是独立产品分支，不是 Loom 的前端依赖。

## 先读当前合同和状态

- [工程约定与代码归属](../AGENTS.md)：修改边界、官方 UI 复用、验证和部署规则。
- [目标合同](evo/target-contract.zh-CN.md)：Role / Instance / Session / Channel 的唯一目标合同。
- [当前状态、部署记录和限制](evo/status.zh-CN.md)：当前结论入口，不以旧施工清单代替。
- [分支晋升与独立 Chatbox](evo/branch-promotion.zh-CN.md)。

## 前端维护

- [完整官方源码基线](design/full-official-frontend-baseline.zh-CN.md)：当前owner要求Web1.21.40＋UI0.52.2整版依赖；完整发布代码已提取并隔离启动，业务适配尚未完成。
- [官方 UI 升级工作流](design/official-ui-upgrade-workflow.zh-CN.md)：版本确认、上游 diff、影响范围、适配和验证。
- [依赖边界与迁移合同](design/official-dependency-migration.zh-CN.md)：组件包、不可变选定源码、生成呈现、兼容移植与 Loom 接线分开记录。
- [Web 1.21.35 指定页面刷新与空态核对](evo/evidence/2026-10-28-ui-refresh/README.md)：当前批次的发布资源、原始源码差距、变化与验证边界。
- [Web 1.21.34 逐页核对清单](evo/raft-1.21.34-closeout.zh-CN.md)：固定版本覆盖；不是官网永远最新的承诺。
- [通知设计](design/local-notifications.zh-CN.md)：页面内本地通知与关闭页面后的后台推送边界。
- 移动端和触屏布局的最新证据从[当前状态](evo/status.zh-CN.md#2-当前状态)进入；Loom 授权例外不冒称官方原样源码。

## 后端归属与验证

以下架构文件是基线参考；有冲突时以目标合同及后继裁定为准。

- [Room-first](architecture/room-first-core.zh-CN.md)、[Core/SDK 边界](architecture/core-sdk-boundary.zh-CN.md)。
- [投递与激活](architecture/delivery-and-activation.zh-CN.md)、[运行时与观测](architecture/runtime-adapter-and-observation.zh-CN.md)。
- [客户端、daemon 与部署](architecture/client-daemon-and-deployment.zh-CN.md)。
- [Fork / Side 能力边界](evo/session-branches.zh-CN.md)；AGY 的后继限制见当前状态。
- [原生最终回复默认、升级和回滚](evo/native-final-defaults.zh-CN.md)：源码部署的支持矩阵、显式覆盖与基准隔离。
- [效率验收方法](design/cli-efficiency-gate.zh-CN.md)、[真实 CLI 与付费台账](evo/paid-runs.zh-CN.md)。失败、未知计量和人工介入不能删去。
- [任务验收离线汇总](evo/task-outcome-report.zh-CN.md)：交付、人工介入、交接证据及失败用量；目前支持两种已归档格式。
- [运行记录离线诊断](evo/runtime-diagnostics.zh-CN.md)：同次压缩观测、原生重试信号与缺失数据；不自动干预运行时。
- [文章与 Cindy 的研究及候选顺序](evo/article-cindy-adoption-review.zh-CN.md)：研究建议，不代表已实现或已测得收益。
- [Herdr 托管运行时实验](design/herdr-runtime-evaluation.zh-CN.md)：免费 Pi 路径及观察投影通过，原始接管不能暂停自动输入，候选停止；保留现有运行时，排除 Claude Code。[执行证据](evo/evidence/2026-11-05-herdr-runtime-study/README.md)。

## 历史与追溯

历史材料保留当时版本、失败和决策。它们的“当前”“待办”“下一步”仅指写作时点，不自动恢复为今天的施工任务。

- [截至 2026-10-27 的原文档索引](history-index-2026-10-27.md)：原索引逐字保留，包含旧路径和旧阶段描述。
- [截至 2026-10-27 的原状态全文](evo/status-history-through-2026-10-27.zh-CN.md)：原文逐字保留，不是当前状态入口。
- [2026-09 状态第一至六十五节](evo/log/status-history-2026-09.zh-CN.md)：旧文中的“status §N”指此日志。
- [旧实施路线](roadmap.zh-CN.md)：历史阶段计划，不是当前发布待办。
- [本次整理范围与保留项](audits/2026-10-27-repository-cleanup.zh-CN.md)。

后续维护：当前状态只保留现状、限制和证据链接；逐轮试验与施工过程写入带日期的证据记录。不再向本索引堆叠每个微小 UI 改动。
