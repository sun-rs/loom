# Computer 服务重启恢复专项收口

范围：当前单 Human、本机工作台。只修服务重启的状态恢复、旧页面回执语义和后继启动失败处理；不变更 Agent Task/执行 owner，不放宽忙碌、孤儿、quarantine 或独占操作围栏。

## 来源与本地适配

Raft 冻结来源：`docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js`，SHA-256 `5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8`。`computer/restart` 动作等待操作状态完成，超时不能当成功；恢复指南是独立的原页展开入口。此前实操与来源登记见 [2026-09-07 服务重启审计](./2026-09-07-service-restart.zh-CN.md)。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `apps/desktop/src/main/daemon-manager.ts` 保留 idle-before-restart；其 Electron 版本管理与恢复器并非 RAH 本地 Web 的必要依赖。本批是 RAH 本地适配，复用既有 Core 启动回滚、同源认证及 launcher，不声明字节复用或 Raft 服务端实现已知。

## 逐项结果

| 行为                          | 原缺陷                                       | 本批结果                                                                                                                        |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 首次状态请求临时 503          | 异常被吞，页面永久禁用，并误称不支持重启     | 明确区分读取中、暂时失败和服务明确不提供能力；失败显示“重试连接”，只重新读取状态，不提交重启                                    |
| 第二页面使用旧 generation     | 服务端正确拒绝，页面却显示自己的重启成功     | 页面重新读取当前状态，明确“服务已由其他请求重启”；不会以新 generation 自动再提交 mutation                                       |
| POST 回执丢失                 | 需要继续保留既有恢复性质                     | 仍以新 generation + online 确认实际恢复，连接断开不撤销 launcher 已接受的动作                                                   |
| 后继首次启动失败              | 启动器只记录错误，此后一直无服务             | 原实例 stop 完成后，startup 失败必须先完成既有 rollback；重新检查持久围栏，等待 1 秒后再检查，最多再尝试启动一次                |
| 后继持续失败                  | 网关与数据库已关闭，调用方仍无限等待退出信号 | launcher 发出 terminal failure；项目 loopback、LAN、安装版入口等待该结果，进入既有 finally 清理并非零退出，本机可排障后重新启动 |
| 恢复期间出现孤儿或 quarantine | 不可为恢复可用性清掉业务事实                 | 重试前后均拒绝继续启动；停止信号到达后不再启动迟到后继                                                                          |

单一 owner：`restartable-local-workbench.ts` 负责上述 bounded recovery 与 terminal failure；`local-core-workbench.ts` 继续负责每次 startup/rollback。三个入口只等待 launcher 结果并清理，Web 只发请求与读取状态。没有新控制服务器、后台重试队列或业务状态机。

## 验证证据

外部证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-computer-recovery`。

- `browser-red.log`：首次 503 的预期错误状态/恢复入口不存在；复现原页面缺陷。
- `successor-red.log`：失败后只启动一次，没有恢复尝试。
- `fatal-red.log`：持续失败没有通知外层，安装入口继续等待信号。
- `final-tests.log`：12 项专项测试通过，覆盖真实本地 Core 同地址重启与 Host instance 换代、认证/跨 Origin 拒绝、忙碌围栏、LAN 共享 handler、一次恢复成功、持续失败有界、孤儿/quarantine 阻断、停止取消、安装入口 finally，以及实际隔离子进程非零退出。
- `browser-green.log`：Chrome / Firefox，1440×900 与 390×844 四组合通过，覆盖状态 503 → 用户重试、第二页面旧 generation、重启完成、回执丢失、刷新、Room/Message/Task/Event/Principal 全行快照保持一致。receipt：`rah-service-restart-fixture-P2RBxb`。已打开检查桌面与 390px 截图。
- 故障注入页显式阻止 Service Worker，确保 Playwright 注入确实到达状态请求；原先未阻止时被 Service Worker 抢先请求，失败日志保留于 `browser-debug.log`，不当成产品失败或通过。PWA 离线/通知并非此门禁的验证范围。
- Web 构建成功，所测 build `1b3937c163814b3e5fb84039eca38949317f3a01b1ebf167d9a32562c0dfc48f`。最终集成构建/全仓门禁由主任务统一执行，不能由本批专项通过推定。

## 明确限制

短暂启动故障可由同一 launcher 自动恢复一次；持续配置、端口或文件错误仍需本机排障和重新启动。页面不是在已关闭服务之外另起的救援服务，不能承诺服务永久故障后仍从网页启动后台。停止失败、孤儿或 quarantine 需要现有 owner 的诊断和恢复，禁止强杀/改数据库绕过。

本批没有向正式 Room 写测试数据，没有重启正式服务、付费 CLI、Git 提交或推送。正式服务部署与冻结版本验收由主任务统一完成；未新增官网破坏性重启测试，不宣称全 Computer 页面或同条件 Raft 双边完成。
