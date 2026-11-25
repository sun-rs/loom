# OAR 无头 worker

使用本机已有的 Codex 或 Antigravity CLI。Node.js 需为 24.2 或更新版本，OAR 版本锁定为 0.130.1。[npm 发布记录](https://registry.npmjs.org/@botiverse%2foar/0.130.1)

```sh
npm --prefix runtimes/oar ci --omit=optional --ignore-scripts
node --test runtimes/oar
```

```js
import { spawnHeadless } from './runtimes/oar/index.mjs';

const worker = await spawnHeadless({
  cli: 'codex', model: 'gpt-6.2-sol', effort: 'high',
  cwd: '/work/demo/t1', prompt: '完成 T1', project: 'demo', task: 'T1', wave: 'W1',
}, { projectDir: '/work/demo', parent: 't42' });

await worker.firstTurn;
await worker.send('补充边界测试');
await worker.close();
```

`spawnHeadless` 打开独占 OAR Session 并提交首轮。传给 agy 的 `model` 和 `effort` 使用 AGY 原生标识。两项省略时采用该入口的原生默认值。`firstTurn` 和 `send` 返回 OAR 的轮次结果。`interrupt()` 调用 OAR `Session.abort()`，中断后可等待当前轮结束并在同一 Session 发送新一轮。关闭会话后可通过索引里的原生会话 ID 接手。

## 索引和投递

索引写入 `<projectDir>/.project/relay/oar/<addr>.json`，`worker.index` 返回当前快照。若省略 `projectDir`，使用绝对路径形式的 `project` 或 worker 的 `cwd`。原生记录可读后，索引会补齐 `transcriptPath`。关闭或观测到进程退出时记录 `endedAt`。[loom 本地协议](../../docs/PROTOCOL.md)

使用 `index.importRelay(projectDir)` 把记录导入会话索引后，`loom hist <addr> --level L2 --json` 可按原生记录读取历史。使用项目内的 SQLite 索引时，将 `LOOM_INDEX_PATH` 指向同一文件。

协议事件写入 `<projectDir>/.project/relay/events/<addr>.jsonl`，包含 `turn-start`、`turn-end`、`usage` 及 `stuck`。agy ACP 以首个原生活动作为开轮证据。OAR 的 `quota` 和 `rate_limited` 对应协议的 `stuck/rate-limit`。用量采用 OAR 已上报的计数，模型调用次数从原生记录计量。

启动方在 relay 的 `.project/workers.md` 一次写入整波成员。OAR 地址用 `worker.index.addr`，与 TUI 地址同表登记。relay 按原有波次规则归档和投递。

```text
T1 | oar-14ef8403-3958-45ad-b214-967b6be2ecb7 | codex | dispatched | | wave=W1
T3 | t101 | agy | dispatched | | wave=W1
```

## Codex 人工接手

停掉无头 worker 后，在索引的 `cwd` 中用 `sessionId` 打开 TUI。下面的启动参数仅对这次进程生效。

```sh
cd "$cwd"
trust=$(node -p '`projects.${JSON.stringify(process.cwd())}.trust_level="trusted"`')
codex --no-daemon --disable memories -c check_for_update_on_startup=false -c "$trust" resume "$sessionId"
```
