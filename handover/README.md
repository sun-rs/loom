# 会话留存与交接简报

```sh
./handover/loom handover leader --project demo
./handover/loom handover auditor --project demo --to t123
```

`--project` 精确匹配会话索引中的项目名。绝对路径和 `./`、`../` 路径也用作项目目录。项目名形式从 `LOOM_PROJECT` 取目录，默认从当前目录向上寻找 `.project/`。索引沿用 `LOOM_INDEX_PATH`。本目录的 `loom` 入口将其余命令交给仓库现有入口。

命令输出一条 JSON，`brief` 字段为 Markdown。默认选最近启动的同项目角色会话。若接替地址已登记且 `parent` 指向同角色会话，取该前任。L1 默认取同角色 parent 链上最近三轮，优先展示较新的轮次。整份正文最多 1,500 个近似 token，中文每字计一个 token。`--to` 经现有 `loom send --mode queue` 投递并附回执，投递失败时在错误回执中保留 `brief`。

简报分别读取索引、原生会话记录、`.project/workers.md`、`.project/relay/state.json`、`.project/inbox/`、`.project/watch/events.jsonl`、`.project/evidence/` 和 `git status --short`。缺失或读取失败的栏目显示「不可用」。现有组件具备数据但没有匹配项时显示「无」。

## Daemon 接口

```js
import { generateBrief, recordLifecycle, retainedRecords } from './handover/index.mjs';

const result = await recordLifecycle(projectDir, indexedSession, event);
const checkpoints = await retainedRecords(projectDir, indexedSession);
const { brief } = await generateBrief({ role: 'leader', project, projectDir, turns: 3 });
```

Daemon 在确认结束、换班和压缩事件后将已绑定的索引记录传给 `recordLifecycle`。高级角色才会产生留存记录。生命周期输入接受 `session-end`、`shift`、`pre-compact` 和 `compact`，以及 Claude `SessionEnd`、`PreCompact`、`PostCompact`、原生 `compact_boundary` 和 Codex `compacted`、`contextCompaction`、OAR `compaction_started`、成功的 `compaction_ended`。采集端应传入稳定的 `eventId`，或保留原生 UUID、事件时刻与序列号供重试去重。收到 `unavailable` 时可在原生文件落稳后重放同一事件。换班事件由调度端在确认交接后发出。

`.project/handover/` 下的清单记录会话身份、parent、原生路径、字节数和 SHA‑256。稳定日志按路径登记，Codex 由适配器尝试重新定位已移入 `archived_sessions` 的 rollout。默认对有本地清理机制的 Claude 和按可能轮转处理的 agy 保存 `.project/archive/<sha256>.jsonl` 只读副本。同一份内容复用一份归档。运行时可按实际保留策略传入 `mayLoseTranscript`。简报在原生记录不可读时校验归档哈希后读取。 [Claude Code 本地清理设置](https://code.claude.com/docs/en/settings-reference#cleanupperioddays)

当前 agy ACP 接入能够接收已归属的标准化生命周期事件。现有运行时没有给出可验证的 `/compact` 完成事件，接入方应只传递有原生证据的压缩事件。

```sh
node --test handover/handover.test.mjs
```
