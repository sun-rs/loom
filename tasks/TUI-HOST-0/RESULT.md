# TUI-HOST-0 实测结果

**采用 hc + loom-pty 作为顶层角色 TUI 的原型。** hc 继续负责可见窗格、附着、原生 agent 状态及退出管理。loom-pty 拥有内层 PTY、网格、输入事务和 Unix 控制套接字。三家 CLI 在该方案上各连续收到 20 条带 ID 的输入，每条均有原生确认。人工在自动粘贴后抢占输入时，原型保留草稿并停止发送 Enter。原生 hc 在本次串行试验中也完成了 60 条投递，其公开接口仍无法原子地保护帧读取与人工输入之间的竞争。hc 是第三方产品，下面的原语只适合作为上游功能请求。Orca 在最终方案中只提供源码参考。

## 测试环境与判定

macOS arm64、Node 25.9.0、hc 0.1.22、Claude Code 2.1.331、Codex 0.171.0、agy 1.5.16。每组使用真实原生 CLI 进程和新的目录。Claude、Codex 和 agy 分别走回环 Messages、Responses、Enterprise Gateway 接口。模型回复、长轮、HTTP 429 和 HTTP 400 由本卡控制。三家使用隔离主目录，Claude 与 agy 放入隔离的已完成 onboarding fixture，再在新工作目录触发原生信任框。本卡未使用真实模型账号。忙碌试次等待回环服务收到慢请求，再在同一轮拒绝立即发送并等待一条延后投递。用 `hc ls --label` 按本卡窗格标签核对实际 `agent` 和 `status`。

最终矩阵通过 54/54 项。每个普通单元是一条独立试次，括号为从动作开始到验证完成的毫秒数，草稿和忙碌项的误发均为 0。连续投递单元是 20 条，延迟从提交请求到原生确认回执，包含等待可写、宿主传输和轮询。每个 ID 按原生记录对账后，再校验同 ID 重试只返回既有回执。Claude 和 agy 的 40 条各自同时有 hook 和转录佐证。Codex 的 40 条用 `UserPromptSubmit` 确认。Claude 与 Codex 的中断得到转录取消记录，agy 取得新出现的中断提示和连续两次空输入框，随后新一条输入获得原生确认。

| 宿主 / CLI | 冷启动及信任 | 空闲 | 保留草稿 | 忙时拒绝及延后送达 | 连续送达 / 丢失 / 重复 | 中断及续作 | 自然退出 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hc · Claude | 1/1（732） | 1/1（442） | 1/1（731） | 1/1（10,942） | 20/20 / 0 / 0 | 1/1（1,200） | 1/1（508） |
| hc · Codex | 1/1（676） | 1/1（432） | 1/1（728） | 1/1（10,818） | 20/20 / 0 / 0 | 1/1（1,173） | 1/1（6,436） |
| hc · agy | 1/1（937） | 1/1（446） | 1/1（720） | 1/1（10,759） | 20/20 / 0 / 0 | 1/1（980） | 1/1（464） |
| hc + loom-pty · Claude | 1/1（2,473） | 1/1（1,198） | 1/1（678） | 1/1（9,818） | 20/20 / 0 / 0 | 1/1（697） | 1/1（2,473） |
| hc + loom-pty · Codex | 1/1（1,812） | 1/1（402） | 1/1（680） | 1/1（9,909） | 20/20 / 0 / 0 | 1/1（794） | 1/1（7,735） |
| hc + loom-pty · agy | 1/1（2,306） | 1/1（400） | 1/1（677） | 1/1（10,016） | 20/20 / 0 / 0 | 1/1（701） | 1/1（433） |

同一矩阵的诊断试次在新会话中注入错误。所有试次后续自动投递的误发数为 0。429 项要求明确识别为限流。仅显示客户端正在重试时，按忙碌阻断。agy 在最初的 90 秒窗口只显示 `Model unavailable`，延长到 160 秒后两组均采到明确的 `code 429`。回环服务各收到 12 个 429 请求。

| 宿主 / CLI | 429 分类及延迟 | 400 分类及延迟 |
| --- | --- | --- |
| hc · Claude | 1/1（5,687 ms） | 1/1（2,439 ms） |
| hc · Codex | 1/1（8,941 ms） | 1/1（9,409 ms） |
| hc · agy | 1/1（152,178 ms） | 1/1（1,194 ms） |
| hc + loom-pty · Claude | 1/1（7,312 ms） | 1/1（3,897 ms） |
| hc + loom-pty · Codex | 1/1（7,775 ms） | 1/1（7,451 ms） |
| hc + loom-pty · agy | 1/1（132,062 ms） | 1/1（247 ms） |

### 延迟、可见性与抢占

| CLI | 原生 hc，中位 / 最大（ms） | hc + loom-pty，中位 / 最大（ms） | 中位差（ms） | wrapper 贴入至确认草稿的中位（ms） |
| --- | ---: | ---: | ---: | ---: |
| Claude | 522 / 664 | 450 / 456 | −72 | 37 |
| Codex | 528 / 706 | 449 / 553 | −79 | 37 |
| agy | 541 / 684 | 449 / 552 | −92 | 37 |

这组实测中，包裹模式的首次就绪慢 1.14–1.74 秒。启动附加等待包含 800 ms 的外层 stdin 暂停窗，终端自动应答也会触发此窗。稳态回读在 35–38 ms 完成。稳态端到端差异包含 hc 原生 send 的等待策略及本地 socket 的差异。

- 六组 `hc ls` 均报告正确的 `claude-code`、`codex`、`antigravity`，观察到 `idle → working`。包裹模式透传原生 CLI 的标题和 OSC 字节，由 hc 继续识别。
- 真实 `hc attach` 首次以 101×35 附着，随后改到 117×31。内层进程在 113 ms 内报告新尺寸。通过附着窗格输入的 UTF-8 括号粘贴按字节回显，4 ms 内由 hc 读到。Ctrl‑C 以原始 `03` 字节传入，内层退出码 7 在 90 ms 内由 hc 观察到。
- 竞争试次在内层收到自动粘贴、尚未重画草稿时用 hc 键入 `x`。控制套接字回执为 `unconfirmed`，屏幕保留人工字符，内层从未收到 Enter。后一条自动请求保持阻断。 [附着、I/O 及竞争日志](/Users/sun/Code/exp-relay/tui-host-0/verify-io-delivery.log)

### 证据与复跑

- Claude [hc 主矩阵](/Users/sun/Code/exp-relay/tui-host-0/matrix-hc-claude-verified.jsonl) · [包裹主矩阵](/Users/sun/Code/exp-relay/tui-host-0/matrix-wrapped-claude-verified.jsonl) · [hc 429](/Users/sun/Code/exp-relay/tui-host-0/matrix-hc-claude-delivery-rate.jsonl) · [hc 400](/Users/sun/Code/exp-relay/tui-host-0/matrix-hc-claude-delivery-error.jsonl) · [包裹 429](/Users/sun/Code/exp-relay/tui-host-0/matrix-wrapped-claude-delivery-rate.jsonl) · [包裹 400](/Users/sun/Code/exp-relay/tui-host-0/matrix-wrapped-claude-delivery-error.jsonl)
- Codex [hc 主矩阵](/Users/sun/Code/exp-relay/tui-host-0/matrix-hc-codex-verified.jsonl) · [包裹主矩阵](/Users/sun/Code/exp-relay/tui-host-0/matrix-wrapped-codex-verified.jsonl) · [hc 429](/Users/sun/Code/exp-relay/tui-host-0/matrix-hc-codex-delivery-rate.jsonl) · [hc 400](/Users/sun/Code/exp-relay/tui-host-0/matrix-hc-codex-delivery-error.jsonl) · [包裹 429](/Users/sun/Code/exp-relay/tui-host-0/matrix-wrapped-codex-delivery-rate.jsonl) · [包裹 400](/Users/sun/Code/exp-relay/tui-host-0/matrix-wrapped-codex-delivery-error.jsonl)
- agy [hc 主矩阵](/Users/sun/Code/exp-relay/tui-host-0/matrix-hc-agy-verified.jsonl) · [包裹主矩阵](/Users/sun/Code/exp-relay/tui-host-0/matrix-wrapped-agy-verified.jsonl) · [hc 429](/Users/sun/Code/exp-relay/tui-host-0/matrix-hc-agy-extended.jsonl) · [hc 400](/Users/sun/Code/exp-relay/tui-host-0/matrix-hc-agy-delivery-error.jsonl) · [包裹 429](/Users/sun/Code/exp-relay/tui-host-0/matrix-wrapped-agy-extended.jsonl) · [包裹 400](/Users/sun/Code/exp-relay/tui-host-0/matrix-wrapped-agy-delivery-error.jsonl)

运行 `MATRIX_SUFFIX=-local node tasks/TUI-HOST-0/matrix.mjs <hc|wrapped> <claude|codex|agy>`。每个普通试次只有一个样本，不能从 1/1 推断生产成功率。分组各自有 20 条独立带 ID 的输入。更换目录或并发跑时用不同的 `MATRIX_SUFFIX`。可用 `MATRIX_ONLY=main|rate|error` 单独复跑。依赖安装和 wrapper 启动见 [tui/README.md](../../tui/README.md)。

## 实现及 Orca 复用

- [loom-pty](../../tui/loom-pty) 负责可执行入口、外部 TTY raw 模式、SIGWINCH 和终止信号。[thin.mjs](../../tui/thin.mjs)、[pty-grid.mjs](../../tui/pty-grid.mjs)、[pty-control.mjs](../../tui/pty-control.mjs) 共同处理双向字节、静默时钟、版本检查、草稿回读和本地控制。四文件约 340 物理行，另有约 65 行 hc+wrapper 接入及约 450 行两宿主共享的会话和 provider 逻辑。Node ESM。两个试验依赖只安装在实验目录，仓库根依赖清单未改。
- [index.mjs](../../tui/index.mjs) 定义统一接口。复用现有 hc runtime 的启动、发送和 JSONL tail，以及三家 adapters 的启动、分类、hook 及对话框逻辑。native 证据优先，然后是宿主和屏幕。当前画面的忙碌、权限、错误、草稿与人工活动均可阻断输入。控制通道已可供 loomd 接入，daemon 目录在本卡范围外。
- Orca 固定基线为 `b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea`。网格移植了光标附近行、dim 字符、宽字占位及软折行处理思路。输入处理借用了先验证草稿归属再补 Enter 的规则，静默计时和版本更新在 Node 进程中实现。保留上游 MIT 声明。 [网格游标](https://github.com/stablyai/orca/blob/b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea/src/shared/terminal/input/terminal-grid-cursor-line-context.ts) · [草稿识别](https://github.com/stablyai/orca/blob/b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea/src/shared/terminal/input/terminal-composer-draft.ts) · [输出世代](https://github.com/stablyai/orca/blob/b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea/src/main/runtime/terminal/output/terminal-output-generation.ts) · [粘贴后补 Enter](https://github.com/stablyai/orca/blob/b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea/src/main/runtime/terminal/input/terminal-agent-prompt-resubmit.ts) · [MIT 许可证](../../tui/LICENSE.orca)
- 单机实现已在 macOS 验证。若把它作为长期驻留的 macOS/Linux 宿主，估计再需要约 500–900 行实现包分发、会话恢复、持久投递簿及诊断，另需对应压力和恢复测试。估算未含 daemon 集成路径和 Windows 支持。

## 可提交给 hc 上游的最小接口草案

```ts
interface Frame {
  incarnation: string
  revision: string
  idleForMs: number
  state: "working" | "idle" | "blocked" | "exited" | "unknown"
  composer: { kind: "empty" | "draft" | "unknown"; text?: string }
  lastHumanInputAtMs?: number
}
readFrame(terminal): Frame
writeIf(terminal, { incarnation, revision, requireComposer: "empty", input, requestId }):
  { kind: "accepted" | "frame-changed" | "human-active" | "blocked"; requestId: string }
submitDraftIf(terminal, { incarnation, revision, expectedDraft, requestId }):
  { kind: "accepted" | "frame-changed" | "draft-mismatch" | "human-active"; requestId: string }
```

`revision` 要覆盖网格输出、resize、人工键入及其他写入。`writeIf` 的校验和写入须在同一 PTY 串行入口。`submitDraftIf` 支持比对已粘贴的完整输入，并有界确认或返回可对账的请求标识。当前 hc 的 `send --if idle` 只保护宿主状态，而且不能表达 `done`。本卡原生后端在 `done` 先复读帧，再用现有默认发送保护。这一复读仍有竞争窗口。原生 hook/转录仍负责证明 CLI 收到对应的消息。

## 遗留风险及验证

- 人机竞争的核对点是 wrapper 已收到的外层 stdin 和已解析的内层输出。尚在外层驱动或内核队列中的字节无法提前观测。实测覆盖键入发生在粘贴与 Enter 之间。折叠、多屏草稿和长文本缺少完整回读时显式保留待确认。
- 请求簿与控制套接字随 wrapper 进程存活。进程丢失后的对账、超时草稿的人工处置接口、持久恢复及并行人工会话压力测试留给下一步。回环协议实测未覆盖真实账号登录及服务端配额差异。
- `npm test` 共 231 项通过，0 失败。 [最终测试日志](/Users/sun/Code/exp-relay/tui-host-0/npm-delivery.log)
- 98 个本卡 hc 窗格均已核对为 `finished`。更改方向前用于探测的两个隔离 Orca 实例及其窗格均已关闭。 [hc 清理日志](/Users/sun/Code/exp-relay/tui-host-0/cleanup.log)

STATUS: done
