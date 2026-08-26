# RAH OS 文档

这里仅保存能约束代码和验收的长期文档。阶段性讨论、旧 RAH 的 Session/UI 细节和 provider transcript 适配经验不迁入本仓库。

阅读顺序：

1. [Runtime Placement 与下一阶段独立审计](./audits/2026-08-26-runtime-placement-independent-audit.zh-CN.md)
2. [独立架构审计](./audits/2026-08-25-independent-architecture-audit.zh-CN.md)
3. [进程监督器独立复审](./audits/2026-08-25-process-supervisor-follow-up-audit.zh-CN.md)
4. [Host 认证与 Daemon 生命周期独立审计](./audits/2026-08-25-host-daemon-lifecycle-audit.zh-CN.md)
5. [Core SDK 边界](./architecture/core-sdk-boundary.zh-CN.md)
6. [Room-first 核心架构](./architecture/room-first-core.zh-CN.md)
7. [Inbox、Activation 与 AgentHost](./architecture/delivery-and-activation.zh-CN.md)
8. [Daemon Core 运行架构](./architecture/daemon-core.zh-CN.md)
9. [Client、Daemon 与部署边界](./architecture/client-daemon-and-deployment.zh-CN.md)
10. [前端平台架构](./architecture/frontend-platform.zh-CN.md)
11. [Runtime Adapter 与观察平面](./architecture/runtime-adapter-and-observation.zh-CN.md)
12. [Worker Application Service](./architecture/worker-application-service.zh-CN.md)
13. [Runtime Registry 与多 Lane 调度架构](./architecture/runtime-registry-and-multi-lane-scheduling.zh-CN.md)
14. [Memory 与 Context Fabric](./architecture/memory-and-context.zh-CN.md)
15. [架构优势对照基准](./experiments/competitive-benchmark.zh-CN.md)
16. [ADR-0001：建立独立 Room-first 仓库](./adr/0001-room-first-repository.md)
17. [ADR-0002：Daemon-first、多客户端单一协议](./adr/0002-daemon-first-multi-client.md)
18. [ADR-0003：身份安全的 POSIX 进程监督器](./adr/0003-identity-safe-process-supervisor.md)
19. [ADR-0004：认证 Host 与本机 Daemon 生命周期](./adr/0004-authenticated-host-and-daemon-lifecycle.md)
20. [ADR-0005：Daemon composition、Worker delegation 与 durable wake](./adr/0005-daemon-composition-worker-delegation-and-wake.md)
21. [ADR-0006：Task 业务协议与 causal Worker command](./adr/0006-task-business-protocol-and-causal-worker-commands.md)
22. [ADR-0007：Durable InputRequest 与无 listening 等待](./adr/0007-durable-input-request-and-no-listen-waiting.md)
23. [ADR-0008：版本化 Human Client Application Service](./adr/0008-versioned-human-client-application-service.md)
24. [ADR-0009：不可变 Runtime Placement 与 Multi-Lane AgentHost](./adr/0009-immutable-runtime-placement-and-multi-lane-host.md)
25. [ADR-0010：Web/PWA 共享 UI、可移植 Client Core 与薄原生壳](./adr/0010-web-pwa-shared-ui-and-native-shell.md)
26. [ADR-0011：Task Coordination v1](./adr/0011-task-coordination-v1.md)
27. [Phase 1 实验证据](./experiments/phase-1-evidence.zh-CN.md)
28. [Daemon 配置示例](./examples/daemon.config.example.json)
29. [实施路线与门禁](./roadmap.zh-CN.md)

维护规则：

- ADR 记录已作出的不可逆或高成本决策。
- Architecture 记录长期 owner、不变量和对象关系。
- Experiments 记录可复现证据，不把一次成功伪装成生产保证。
- Audits 独立区分 E0 设计、E1 Kernel、E2 系统和 E3 对照证据。
- Roadmap 只列当前阶段和退出条件，不保存易过期的日期承诺。
- 删除已被新文档完全取代的内容；不要维护两个相互竞争的架构真相。
