---
name: loom
description: 在 Loom 中启动、指挥、复核或接手项目。按 Super、Auditor、Leader 或 Worker 的身份执行。
---

# Loom

受 Loom 管理的会话使用启动消息所附角色核心。外部操作者先读 [共用规则](roles/common.md)，再读当前角色的核心。

- [Super](roles/super.md) 设定授权、启动项目并裁决升级。
- [Auditor](roles/auditor.md) 维护章程、裁决和验收。
- [Leader](roles/leader.md) 拆卡、指挥 Worker 并交付门禁。
- [Worker](roles/worker.md) 在卡面授权范围内执行。

收到 Loom 事件时执行随附步骤。名称为 `references/` 的文件从此技能目录解析，按角色所列触发条件读取。
