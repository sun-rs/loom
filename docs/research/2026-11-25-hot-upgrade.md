# 热升级：不打断运行中的会话（2026-11-25）

> 调研日期 2026-11-25；现状以 main `8f4ef4e5` 为准。外部产品的行为来自它们的公开文档和本机观察，以后可能有变化。

## 1. 外部产品怎么做

- **hc / Herdr Core（hc 0.1.22）**：`hc update` 替换 core 时会保留终端。实机进程链是 `core → holder → loom-pty → CLI`。持有 `/dev/ptmx` 的是 holder：core 和桌面 app 可以各自更新，holder 保持不动。依据：HOTSWAP-0 RESULT、https://herdr.dev/core/ 。
- **Orca**：PTY 由独立的终端 daemon 持有。桌面更新时前端断开，新版 app 再接回。协议换代时 `daemon-vN` 并存，新 app 用兼容层继续驱动旧 daemon，等旧会话退役后回收。依据：https://orca.dev/docs/model/session-restore ，issue #9138。
- **共同原则**：真正持有 PTY 或子进程句柄的那一层要做到极小、几乎不改；逻辑全部放在可替换、可重连的外层；协议多版本并存。

## 2. loom 现状（如实）

| 层 | 能否热升级 | 说明 |
|---|---|---|
| hc core / Herdr app | 能 | 第三方能力，loom 不修改 |
| loomd | **能，已实测** | `loom upgrade --to <release>`。pilot-1 里在 5 个会话运行中切换了 4 次，会话都没断；排队中的投递按原生证据对账后接着送 |
| 无头会话 host（session-host + OAR） | 部分 | host 是脱离 loomd 的独立进程，loomd 换代时 host 和会话都不受影响。但 **host 自身的代码不会更新**，直到会话结束 |
| TUI 的 loom-pty | **不能** | 它在 holder 和 CLI 之间，持有内层 PTY，CLI 依赖它才能活着。它同时还承担了画面解析、草稿核验、弹窗处理等判断，所以 FIX-1 到 FIX-4 的修复进不了已在运行的会话。pilot-1 为此被迫让 Auditor 换了 2 次班 |
| 协议 | 能并存 | v0、v1、v2 并存，新 loomd 可以驱动旧 wrapper |

结论：**loomd 层已经做到热升级；TUI 和无头会话里那一层"持有者"还没有做到。**

## 3. 计划（HOTSWAP-2）

1. **loom-pty 瘦身成 holder**：只保留 PTY fd、原始字节环形缓冲、写入、调整尺寸，以及一个稳定的最小协议。xterm 网格、画面识别、草稿核验、弹窗和信任框处理全部移到 loomd：由 loomd 从字节流重建画面，并通过最小协议发出按键。这样以后的修复都只需热升级 loomd。
2. **持有者原地交接**，用于极少数确实要改 holder 的情况：旧 holder 启动新版本，经 stdio 继承把 PTY master fd（无头场景是 CLI 子进程的管道）交给新进程，然后自己退出。CLI 子进程不受影响。node-pty 需要能拿到 fd，否则就要一个很小的原生辅助程序。这一项需要先做可行性验证。
3. **测试矩阵**：Claude、Codex、agy、OpenCode 在忙态和空闲态下，分别做 loomd 升级、holder 交接、回滚。断言三点：原生会话 ID 不变；已确认的输入计数连续；零人工干预。
