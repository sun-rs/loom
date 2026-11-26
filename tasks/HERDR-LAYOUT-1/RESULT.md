# HERDR-LAYOUT-1 结果

实现和验证已留在 main 工作树，最终验收时 HEAD 为 6c29a0bb。改动未暂存、提交或部署。试跑只使用自建 Herdr 空间和本地模拟服务。pilot-2 的迁移命令留给 Super 执行。

## 布局、轮换与状态

- `loom up` 和首次 spawn 创建 `Loom <project-name>` 空间，按 Leader、Auditor、Status 的顺序放置标签页，创建时保持原焦点。loomd 原子保存 `.project/loomd/layout.json`，后续操作复用现有 ID，并重建已删除的空间或标签页。`loom status` 显示空间、标签页、当前终端地址和实际 hc 名称。
- Leader 和 Auditor 的继任者在同一标签页临时并排。首个原生回合确认交接简报后，loomd 发布继任者并结束前任。待接任期间，按角色发来的投递保持排队。确认后，loomd 通过会话记录和已核验的终端身份重定向，连同重试也沿用原投递 ID。回归覆盖继任者仍在启动、前任已退出、按角色发起的中断请求降为排队，以及 Auditor 的确认边界。
- Status 只读连接 loomd socket，每五秒刷新并自动重连，消耗零模型调用。它展示角色、投递分类与最老待送时长、无窗格 Worker 及卡片和波次、门禁结论、Super 待处理通知、消耗金字塔和发布路径。历史及记忆搜索在本地分页器打开。Worker 的 OAR 无头启动保持无 Herdr 标签和窗格。
- `loom super --terminal HC_ADDRESS` 由操作者显式创建或复用独立的 `Loom` 空间，并加入全项目 Status。pilot-2 可用 `loom layout adopt --project /Users/sun/Code/loom-pilot2 --leader LEADER_HC_ADDRESS --auditor AUDITOR_HC_ADDRESS`，按会话记录中的角色填入 t3fn 和 t3fw。loomd 检查本项目的活体会话、角色和终端身份后加标签，地址、PID 和创建时间保持原值。Herdr 放置窗格时会开启 core keep，Loom 随后关闭 keep 并复核同一进程。关闭窗格、标签页或空间会结束其中的终端。[操作文档](../../docs/HERDR.md)

## OSC 7501 交叉信号

用隔离 HOME、原生绝对路径和回环模拟模型运行启动、一次完整对话和选择器。能力握手回复取自独立的 hc 0.1.22 探针。下表是该路径观测到的状态。

| CLI | 版本 | 实测 |
| --- | --- | --- |
| Claude Code | 2.1.331 | 查询能力，收到回复后发出 idle、working、done |
| Codex | 0.171.0 | 直接发出 idle、working、done |
| Antigravity | 1.5.17 | 查询能力，收到回复后发出 idle、working、done |
| OpenCode mini | 2.3.0 | 观测到能力查询，本次对话未观测到生命周期状态 |

loomd 复用已有的 hc get 快照。应用和时间须匹配，permission/question 仅补强已有的对应原生或屏幕提示，auth 仅补强独立发现的鉴权故障。working 可补强已有的静默挂起判断。补充信号不建立提示或故障，不推进进度计时，也不授权写入。匹配、过期和单信号的边界有合成回归。[原生版本探针](/private/tmp/loom-layout.TILtsv/osc-negotiated.log)

## 验收与待裁决

`npm test` 全量 697 项通过，失败、取消和跳过均为 0。通过假 herdr-app/hc 测试、投递交接回归和 `git diff --check`。实机创建并清理了自建空间，验证三页顺序、焦点、keep 关闭、删除 Status 后单独重建，以及真实 `loom upgrade` 提交后原 Status PID 保持并显示新发布路径。[全量测试](/private/tmp/loom-layout.TILtsv/final-npm-test.log) · [实机热升级](/private/tmp/loom-layout.TILtsv/upgrade-probe.log)

唯一待裁决项是换班后沿用同一个原生 hc 名称。hc 0.1.22 的 CLI 和 RPC 无活体重命名或别名转移接口，实机验证设置 name 标签不会让 hc get 解析别名。Status 保持固定 hc 名称。Leader 和 Auditor 同时存活时使用各自的 hc 名称，`loom layout get leader|auditor` 提供固定查询入口，返回已确认的当前终端地址。待 Super 确认该入口可替代原生名称转移，或提供支持名称转移的 Core。

STATUS: done（Super 2026-11-26 裁决：接受 `loom layout get leader|auditor` 作为固定查询入口，hc 名称转移待 Core 支持）
