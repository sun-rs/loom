# Agent 重启语义及弹窗修复

来源：Raft v1.16.0 `https://app.raft.build/assets/index-CKeqacxz.js`，
SHA-256 `7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
只读分析原始 bundle，沿既有授权 reuse ledger，不执行或引入生产依赖。

`Qgt` 使用 `zs` 的 max-w-md、p-6，选项 border-2/p-4/space-y-3，
标题 uppercase，确认文案取选中项。`resetAgent` POST reset(mode) 成功后
将 Agent 设为 active；restart 保留 session，session/full 清 session。
本地弹窗原先被 `.rah-dialog form:not(...)` 覆盖：出现额外 18px 内边距，
gap 从 20px 变成 16px、footer gap 从 12px 变成 9px。现提高专用规则优先级，
并对齐“重新启动”“完全重置并重启”及标题大小写。

| 操作           | RAH 语义                                                         |
| -------------- | ---------------------------------------------------------------- |
| 停止           | disabled，停止接收执行；不删除会话或工作区                       |
| 启动           | enabled，恢复调度；不清会话或工作区，无确认弹窗                  |
| 重新启动       | 终止当前执行后恢复 enabled，保留 Provider continuity 与工作区    |
| 重置会话并重启 | 重启并隔离旧 Provider continuity，保留工作区                     |
| 完全重置并重启 | 同上，并清理 Agent-owned 工作区；不清用户项目和 Room/Task ledger |

本地 Runtime 按 Activation 启动，启用且无待办时保持空闲，不伪造常驻 LLM。
旧 daemon 逻辑无条件 disable，遇到已停止 Agent 在 Host 操作前报错。
现依据已有管理投影跳过重复 disable，成功仍在 Host fence 内 enable；
失败不意外启用原本停止的 Agent。其他终止证明、回滚和收据规则沿用既有 owner。

TDD：三个模式的 stopped case 与失败保留 disabled 先失败，再通过；
daemon administration 与 Host coordinator 共 15 项通过，覆盖 continuity、
workspace 回滚、terminal proof、幂等及重放。浏览器先复现 padding 18px，
再验证 Chromium/WebKit 1440/390px 的布局、文案、选项切换和 Escape。
没有运行真实付费 CLI 或在正式环境删除工作区。正式部署仍受全仓后台接口
登记门禁和其他后台文件格式问题阻断，不宣称正式重启或 iPhone 实机通过。
