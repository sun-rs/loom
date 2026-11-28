- rotate 交接单超过 60 行时 loomd 只报 rotation-note-required，应明确报超长与当前行数（pilot-cell 2026-11-27 实测）
- pre-tool 守卫把命令参数里的 `--cli codex` 误判为裸原生 CLI 调用并拒绝（pilot-2 T120，2026-11-27，见 loom-pilot2/.project/eval-g9/blocked-t120-pre-tool-hook.md）；应只检查可执行位置的 argv[0]
- loom recover 把早已收口、被正常 stop 的旧会话（pilot-2 共 66 个，含目标 1 时期的 worker）都列为"待恢复"；应只列异常中断或卡未收口的会话，正常结束/已收口的默认隐藏（--all 才显示）（2026-11-27 实测 e97556ae）

## 2026-11-28 DLV-CCP-1（优先）：投给经 CCP 恢复的 Claude Auditor 的消息卡在 waiting-writable
- pilot-2：2c0fc285 → auditor loom-3f4df1ff（t3rc，用 CCP resume 恢复）从 2026-11-27T21:30Z 起 waiting-writable 36614s，status 同时显示 "Hook gaps · auditor … hook-gap transcript"。窗口实际空闲可输入。
- 疑点：CCP-ROUTE-1 不用 hooks、靠 transcript 判状态；resume 后 transcript 路径/会话 id 变化，loomd 没跟上，判为不可写。
- Super 已手工救援投递一次。需修根因并补测试；停滞告警（IDLE-ALARM-1）上线后此类应自动报给 Super。
