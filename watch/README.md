# TUI 卡死检测

Watcher 从 loom 索引筛选活跃 TUI 会话，用 `hc get` 核对窗格存活，用 `hc read --lines 0` 和各 CLI 适配器分类可见帧。轮次依据来自观察型 hook。巡检只调用本地工具，定时续作通过 loom 的 `queue` 接管。

```sh
./bin/loom-node watch/cli.mjs --index-db /path/to/index.sqlite \
  --events /path/to/watch.jsonl \
  --hooks-dir /path/to/project/.project/relay/events \
  --project /path/to/project
```

`--index` 接受 JSON 数组或 `loom ls` 的 `{sessions: [...]}` 快照，适合回放。`--hooks-dir` 读取 `<addr>.jsonl`，`--hooks-file` 读取按 `addr` 匹配的共享事件文件。支持带 `receivedAt` 的原生 hook（含 `payload` 包装）和带 `at` 的归一事件。输入应包含根轮的开始和结束证据。`--once` 输出当次状态。常驻轮询默认每 5 秒采样，`--idle-ms` 和 `--busy-ms` 分别默认 30 秒和 45 秒。

| 观测结果 | 处理 |
| --- | --- |
| 目录信任 | `--trust-cwd` 可重复传入绝对路径。索引、窗格和弹窗中的目录须匹配，重读确认选项后提交一次按键。按键报错或弹窗持续 15 秒时发出 `needs-you`。默认信任目录为空。 |
| 选择器、认证失败和限额 | 首次出现时记录 `stuck`，面向操作者的状态为 `needs-you`。 |
| `idle-without-stop` | 可见帧持续空闲，匹配的根轮仍缺结束 hook。启动后的空闲需要先有轮次开始证据才会启用计时。 |
| `busy-without-output` | 屏幕持续忙碌且无可见输出或 hook 进展。常见 spinner 与计时动画从输出比对中剔除。 |
| 限额重置 | 支持 `Retry-After`、Unix 时间戳、带时区的日期时间、相对时长和 CLI 的时钟格式。第一个可解析的重置时间随事件保存，到点经 `loom send <addr> --mode queue "继续"` 提交一次。空闲恢复可保留定时提交。新轮开始、恢复工作、换绑、退出或后续阻塞会取消尚未提交的续作。 |

事件以 JSONL 追加，`incidentId` 关联告警、自动操作和恢复。可验证的恢复写 `recovered`，退出、换绑和阻塞原因变化按 `closed` 结案。`--super <addr>` 将需要处理的告警及其恢复通过 `hc send` 投递，缺省只写文件。告警和自动操作尝试先落盘，重启从事件文件去重。动作结果在相邻事件中记录，队列回执中的投递 ID 可用于核对。送达和原生收件由 inbox 跟踪。

loomd 可以直接调用 `createWatcher({ listSessions, readHooks, eventFile, trustedCwds, superAddr, enqueue })`。`listSessions()` 返回索引记录数组，`readHooks(session)` 返回该窗格截至本次采样的 hook 记录。`enqueue` 接收 `{addr, cwd, project, mode, message, resetAt, eventId}`，默认调用本工作区的 `bin/loom`。按项目组织的队列可以指定 `--project`，缺省从会话工作目录定位。每个事件文件由一个 watcher 实例持有，同一实例的并发 `poll()` 共用一次采样。

```sh
./bin/loom-node test-support/run.mjs watch/watch.test.mjs
```
