# IDLE-ALARM-1 验收记录

- loomd 以未完成工作和最近有效活动判定项目停滞。工作来源包括在途或排队的卡片、未确认投递、待 Super 决定，以及章程目标。活动来源包括角色的回合、工具和原生事件、实际投递变化，以及已绑定会话的子进程出现和 CPU 累计变化。子进程每 15 秒采样一次。
- 默认 30 分钟分别提醒 Auditor 和 Super，2 小时升级给 Super，并走可用桌面通道。阈值和重提醒间隔由 `policy.json` 中的 `idleAlarm` 设置。项目已收口、Super 暂停、相关工作在等待已知额度重置，或执行角色都在等用户且 Super 刚收到相关通知时，状态页展示原因。
- 待决事项独立计时，默认每 30 分钟再次提醒。`--take` 保留待决状态。Super 可回复单事项通知，或用 `loom notifications --resolve-decision ID --reason TEXT` 登记。合并通知或其它渠道的裁决用事项 ID 登记。
- `loom tui --all`、项目 Status 首页和 `loom status --json` 共享 loomd 健康快照。项目行显示上次进展、停滞时长、待决数、最长等待和告警数。角色行显示状态、CLI、模型、卡片和最近活动。告警按严重度排列，可单击展开详情和建议动作。断线时可以查看持久化的进展和待决。

## 验证

- 先写假时钟测试，首次运行在实现缺失时失败。随后覆盖 30 分钟和 2 小时边界、额度重置、等待用户宽限、暂停、领取后仍待决、独立重提醒和精确关联回复。日志 `/private/tmp/loom-idle-alarm-red.log`。
- 使用 Node 26.13.1 安装依赖。`npm ci` 和 `npm run lint` 通过，lint 检查 364 个文件。告警、状态板、通知和进程定向测试 31 项通过，含假时钟桌面路由、同源快照以及全局 TUI 鼠标详情。日志 `/private/tmp/loom-idle-alarm-ci.log`、`/private/tmp/loom-idle-alarm-lint.log` 和 `/private/tmp/loom-idle-alarm-targeted-final.log`。
- 独立临时项目实际启动 loomd，经 CLI 创建待决、暂停、用 JSON 和 TUI 核对状态、登记裁决并解除暂停。浏览全局视图和桌面通知使用测试替身。
- 首轮全量在源码仍有改动时出现一次热升级摘要自检失败。固定源码后，热升级定向复测 4/4 通过。第二次全量 `npm test -- --test-concurrency=4` **1131/1131 通过**，0 失败、0 跳过、0 取消，退出码 0。复测前后的 release 源码摘要相同。日志 `/private/tmp/loom-idle-alarm-upgrade.log` 和 `/private/tmp/loom-idle-alarm-full-final.log`。

STATUS: done
