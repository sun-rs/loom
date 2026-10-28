# 协作失败路径定向复现与工具终态排空

本轮只读核对固定三对协作批的原始证据，使用假 Codex app-server 复现；没有付费重跑、替换失败样本或给清空后的正式产品重新填测试频道。

## 新发现与可证明的缺陷

原生 rollout SHA256 与归档一致。pair3 的实施回合 `task_complete` 在 18:57:27.513，未闭合 `rg` 对应 `item_completed` 在 18:57:27.531，晚18ms，状态 failed、exit -1。此前产品归一化轨迹中没有它，故不能仅凭该轨迹断言原生工具永远没有终态。

这不是原始 app-server WebSocket 捕获，且终态失败可能是原生收尾或Host停止的后果，不能证明历史故障全部由 Loom 导致。我们把“先 turn/completed、25ms 后匹配 item/completed”输入真实 warm driver 的假服务器，稳定复现错误终止：修复前返回 `warm turn left tools in flight; runtime stopped`，未发布最终答复。

修复仅在回合结束时仍有已知工具未关闭的情况下，等待匹配 thread/turn/item 的真实终态，最多500ms；有界等待不产生模型请求或工具重试。所有工具实际结束后才排空轨迹、提交最终结果、释放本轮授权。始终没有终态、或只有其他 thread 的终态，仍不发布、仍按原有流程终止并验证退出。没有把 `turn/completed`、时间经过或工具输出文本当作退出证明。

新增三条真实 driver/Host/Kernel 集成测试：晚到终态成功且下一回合复用同一运行时；无终态拒绝；外部 thread 终态拒绝。先失败后通过。旧句柄、隔离、取消、崩溃恢复、busy steer、native-final 等原有定向集成检查继续运行。

## 其他失败路径的判定

- pair2 旧 Worker 句柄在下一回合已无权限，拒绝是正确行为；现有错误已指示读取最新 wake，历史模型没有遵循。没有证据需要提供旧凭据或放宽检查。
- native-final 指令已明确要求新协作请求包含实际 `@handle` 并结束回合；普通角色名称不能替代定向收件人。未显式发起请求不能判成调度器漏唤醒。
- pair3 后续 held 草稿仍保留：工具终态修复减少不必要的运行时退出，但不会抹掉已发生的上下文变化或自动提交历史held内容。没有证明该因果围栏有错。
- **原固定批仍未通过完整协作闭环**。免费复现证明特定时序缺陷已修，不能代替真实多模型任务的独立评审和成本验收。

## 默认回复传输核查

实际安装选择来自当前 plist；通用库及 daemon composition 仍显式 opt-in：

| 运行路径 | 当前正式服务 | 无显式开关的新安装 |
|---|---|---|
| Codex warm | native-final | Worker路径 |
| Kimi ACP | native-final | Worker路径 |
| Claude warm | native-final | 默认不启用该warm采用路径 |
| OpenCode warm | native-final | 原有Worker路径 |
| Codex exec / Pi | 未启用native-final | 未启用native-final |
| AGY print JSON | adapter既定native-final | 同左 |

7项组合/开关/实验隔离检查通过。实验runner总是显式清零全部无关开关再选择单一回复路径，避免继承本机配置。考虑当前协作批仍未通过，本轮不把一个时序修复直接扩大为全新安装的默认切换：保留本机验证配置、明确缺省差异；正式推广默认升级仍待后续闭环验收。不是遗漏修改，也不冒称这项发布门禁已经通过。

最终定向结果：Codex warm runtime＋Worker turn handle 共64项全部通过（含新增3项）；另7项部署选择检查通过，根类型检查通过。没有运行无关全仓测试或付费模型。
