# 会话索引

索引使用 Node 内置 SQLite。建议使用仓库 OAR 运行时要求的 Node 24.2 或更新版本。默认数据库位于 `$XDG_STATE_HOME/loom/index.sqlite`，未设置 `XDG_STATE_HOME` 时使用 `~/.local/state/loom/index.sqlite`。通过 `LOOM_INDEX_PATH` 或 `openIndex(path)` 指定文件。只读查询在数据库尚未建立时返回空数组。

```js
import index from './index/index.mjs';

index.register({
  project: 'P', role: 'leader', addr: 't21', parent: 't18',
  backend: 'tui', runtimeId: 'claude-tui', cli: 'claude',
  cwd: '/work/P', baseCommit: 'abc123', startedAt: Date.now(),
});
index.update('t21', { sessionId: 'native-id', transcriptPath: '/work/P/leader.jsonl' });
const [session] = index.query({ addr: 't21' });
const leaders = index.query({ project: 'P', role: 'leader' });
```

`addr` 在索引内唯一。完全相同的 `register` 可重试。`update` 接受部分字段，未知地址返回 `null`。更新已知的 `sessionId` 时请同时给出 `transcriptPath`，否则清除旧绑定。`query` 支持任意已登记字段的等值组合以及 `null`，结果以启动时间和地址排序。未知字段值返回 `null`，`account` 预留为 `null`。时间使用 Unix 毫秒。SQLite 写事务同一时刻仅允许一个写入者。

```js
await index.importRelay('/work/P', { project: 'P' });
```

导入器读取项目的 `.project/workers.md`、`.project/relay/events` 和 OAR 会话元数据。省略 `project` 时使用项目绝对路径。重复导入补齐索引中的空字段，尊重已有会话绑定。事件里只有完轮证据时，`endedAt` 保持未知。续作、换班或压缩后另开会话时，由登记者用 `parent` 指向同项目、同角色的上一会话。Worker 的续作链还须匹配任务。

```sh
bin/loom ls --project P
bin/loom state t21
bin/loom hist t21 --turns 3 --json
bin/loom hist --role leader --project P --since 2026-11-24T08:00:00+08:00
bin/loom hist --role leader --project P --since 'turn:t18#2' --level L2 --json
```

`hist <target>` 从精确地址或唯一角色／任务匹配开始，包含该会话的同角色前序。`hist --role ROLE --project P` 列出项目内该角色的会话时间线。`--since` 的下界含本轮，接受 ISO 日期或带时区的时间、从 1 起的时间线轮号（`7` 或 `turn:7`）、会话地址与本地轮号（`turn:t18#2`）。按时间过滤时优先使用开轮时间，缺失时使用完轮时间，无日期的轮次不进入结果。

省略 `--since` 时返回最近 N 轮，使用 `--since` 时从下界向后取 N 轮。L1 默认取 5 轮，带下界时默认返回所有匹配轮次。L2 默认取 1 轮。L1 每轮摘要正文的 UTF‑8 字节数至多 400。原生记录缺失时用 `missing` 标注受影响的会话。一个原生文件被链中多个地址绑定时，只展示一份轮次。

`ls` 和 `state` 输出 JSON。已登记关闭的会话显示 `exited`。活动 TUI 的状态由 `hc read` 的屏幕快照归类，活动无头状态返回 `unsupported`。

在线升级期间，索引的查询、插入和更新使用显式列清单。新增会话列应可空或提供适合旧版插入行为的默认值，新数据也可使用独立旁表。旧 writer 更新已知字段时保留未知列。迁移在项目写锁下以事务提交，`PRAGMA user_version` 标记格式，两版在回滚窗口内都应支持该版本。兼容窗口关闭后再删除旧字段和约束。参阅 [在线升级与回滚](../docs/PROTOCOL-v2.md#5-在线升级与回滚)。
