# Web 配置到实际子进程：贯通验收

本批继续[五项实施方案](../product/mainline-implementation-plan.zh-CN.md)第一项。
检查结果：当前配置→执行链未复现产品缺陷；本次补齐贯通回归证据，没有修改生产调度、
Runtime adapter、Agent identity、私有记忆或 Web 业务代码。测试原实现通过，不制造虚假的 RED。

## 测试方法与实际边界

新增 `npm run test:web:agent-runtime-continuity`，沿用既有隔离多 Agent fixture、真实 daemon
与 Chrome。只在显式测试环境启用子进程观察文件和有界 release barrier；默认 fixture 路径不变。
观察记录原子发布，等待超时必须失败，不允许静默释放伪装并发验证。

1. Human 发送显式消息，真实 OS 子进程启动；记录实际 argv、cwd、Agent context、memory directory。
2. 在第一子进程保持活动期间，从真实 Web runtime 编辑器切换另一 runtime，选择 Fixture Beta / High 并保存。
3. 检查配置已形成新 revision，但没有额外替换第一子进程；其已接收配置保持不变。
4. 在隔离 Agent notes 写入测试 marker，释放第一子进程，再发下一条显式消息。
5. 第二 OS 子进程确实获得新 Agent revision、新 runtime profile、fixture-beta / high 参数；
   participantId、cwd 与私有 memory directory 保持；新子进程从同目录读回 marker，且 memory directory 不等于 cwd。
6. 刷新 Web 后检查编辑入口，保存截图和观察回执；执行前后校验来源快照未变化。

Kernel 的 `durable-placement.test.ts` 独立验证 canonical 历史 Run 引用旧 revision，
本批子进程观察补齐接线证据，不能替代该 Kernel 不变量。测试 marker 由测试写入，
不是模型主动记忆；模型名为明确的 Fixture，未使用付费 CLI。
本次未修改 cwd 配置，只证明 runtime 切换不会意外改变现有执行 cwd。
这里只执行 Chrome 桌面贯通；上批 runtime 编辑双浏览器与移动端证据仍独立保留。

## 来源与复用

沿用[Agent 配置来源合同](../design/agent-configuration-command.md)的 Raft/Multica 比较，
本批没有新增 UI 参数或移植未知服务端算法。调度复用 Kernel Placement 与 AgentHost launch；
观察钩子只在 `scripts/run-multi-agent-web-fixture.mjs` 的 fake CLI wrapper 中，不进入产品 bundle。

本批日志目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-runtime-continuity`。

## 尚未收口

第一项仍剩启动/停止/重置的 busy、offline、失败恢复与实际调度结果对应矩阵。
真实 Provider 的配置应用、记忆质量与跨 Provider 会话行为属于独立 opt-in 验收，不能由此测试替代。
第一项整体仍保持进行中，后续四项没有被提前标记完成。多人功能继续延期。

当前最终贯通回执与截图：
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-runtime-continuity-f6pG23`。
已检查截图及实际参数：旧进程为 profile-a，新进程为 profile-b，收到
`--model fixture-beta --config model_reasoning_effort=high`。
额外的 continued 文件由原 OS 子进程在配置保存后通过 release barrier 写出，
证明它继续执行，而非仅保留了一个过时的启动记录。

扩充测试时有一次观察脚本缺少 existsSync 导入而失败，已修正并保留失败日志；
这是测试代码错误，不是产品缺陷。最终贯通 gate 已重新通过。
完整 `npm run check` 通过；正式 bundle 构建成功且 build ID 保持
`ce7dd8607815c6e30fe444f918b9b3b979b1b5eb4962a387d8e670b7f06d72fb`。

最终现有 `test:web:browser`、format 检查与 diff 检查通过。
按交付要求对相同冻结 bundle 做正式 idle 检查、验证备份、安全重启和新页面验收；
`test:web:formal-discovery` 通过。备份目录：
`/Users/sun/.rah/backups/pre-restart-49523dd5-d3d3-4afa-95c3-48487b484828`。
交付时正式监听进程为 52184，地址 <http://127.0.0.1:4173>。
重启前后持久快照完全相同：6 Rooms、43 messages、2 Tasks、378 events、4 Agents、
35 configuration revisions、37 memory files。没有操作正式 Agent 的模型或记忆。
