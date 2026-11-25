# HANDOVER-0 结果

`handover/` 已实现 Leader、Auditor 和 Super 的会话留存及机械交接简报。`recordLifecycle` 处理结束、确认换班和压缩事件，登记原生路径、字节数及 SHA‑256。Claude 与按可能轮转处理的 agy 生成按内容去重的只读归档，Codex 默认登记原生路径。 [模块及接口](../../handover/README.md)

```sh
./handover/loom handover leader --project P
./handover/loom handover auditor --project P --to t123
```

简报覆盖角色、项目、parent 链、最近三轮适配器 L1、在途 worker、relay 波次、收件箱待投和未回复消息、卡死告警、证据卡 MISMATCH 和未提交改动。正文最多 1,500 个 UTF‑8 字节。缺失组件按栏目显示「不可用」。`--to` 调用现有收件箱的 queue 模式并返回投递回执。

## 验收

在 `/Users/sun/Code/exp-relay/handover-0/` 自建两轮 relay 测试。每轮启动真实 Claude Leader 和 Auditor，向 relay 输入受控 worker 轮末事件。真实窗格收到 W1 或 W2，并在原生会话写入相应的最终回复。逐份核对简报的轮号、回复、parent 链和项目状态。

| 实验 | 角色 | 窗格及 parent 链 | 简报字节数 |
| --- | --- | --- | ---: |
| W1 | Leader | `t308` | 925 |
| W1 | Auditor | `t309` | 827 |
| W2 | Leader | `t30b ← t308` | 938 |
| W2 | Auditor | `t30c ← t309` | 981 |

- 核对 W1/W2 已关闭、W3 在途、Auditor 待投、本卡的卡死事件、`T-EVID#1` MISMATCH 和 `git status --short` 的 `ship.txt`。
- `t308` 的真实 `compact_boundary` 归档成功。`t309` 的原生 `PreCompact`、`PostCompact` 分别归档 48,674 和 49,421 字节，SHA‑256 不同。四个角色会话均有结束登记，两名首轮角色均有换班登记。逐份验证了归档 SHA‑256 和 `0400` 权限。
- `--to t30b` 选择 `t308` 作为前任，收件箱先回执 `queued`，随后在 `t30b` 的原生输入中确认相同 `deliveryId` 并进入 `received`。
- 本卡六个测试窗格均执行过 `hc kill`，复查为 `finished`。实测使用进程沙箱限制写入测试目录和本卡原生会话桶。
- `node --test handover/handover.test.mjs` 通过 7 项。`node --test` 通过 164 项，无失败或跳过。

## 验收范围与问题

- 任务卡引用的既有 exp-relay 两轮会话超出本卡可读范围，验收采用上述两轮新建实验。Worker 轮末和卡死告警是受控输入，Leader、Auditor 的会话及队列收件是原生结果。
- 现有 agy ACP 缺少可验证的压缩完成事件。agy 压缩通过标准化事件回放覆盖。仓库总入口和生产 loomd 订阅接线位于本卡写入范围外，本卡提供 `handover/loom` 和供 daemon 调用的 `recordLifecycle`。
- 前置检查执行了一次 `claude --help`，随后确认当时的 PATH 命中了 CCP 包装器。全部实测窗格直接使用 Claude Code 原生二进制 `2.1.322`。

STATUS: done
