# 轮末证据卡

loomd 在收到 worker 的 OAR `turn-end` 或 TUI 轮末时采集证据。JSON 和文本卡写入 `.project/evidence/<task>-<turn>.{json,txt}`，轮次键取自归档回复。搬运消息附上最多 300 个近似 token 的文本卡，含换行。中文每字计一个 token。重复事件复用已落盘的观测。采集故障由 relay 记录，回复照常投递。

## 项目配置

`.project/evidence.json` 配置保护路径、可写范围和测试文件。`testPaths` 在常见测试文件和目录的规则上追加 glob。`tasks` 可以为单张任务卡覆盖项目规则。直接调用 API 时也可传入 `baseCommit`，用于读取传统任务基线。

```json
{
  "baseCommit": "<git commit>",
  "protectedPaths": ["fixtures/**", "src/contracts/**"],
  "allowedPaths": ["src/**", "test/**"],
  "testPaths": ["checks/**/*.mjs"],
  "tasks": { "T1": { "allowedPaths": ["src/parser.mjs", "test/parser.test.mjs"] } },
  "mergeRef": "refs/heads/main"
}
```

## API

```js
import { evidence } from './evidence/index.mjs';

const { path, textPath, card, data } = await evidence.forTurn({
  project, cwd, task: 'T1', turn: 1, provider: 'codex',
  baseCommit, transcript, nativeTurnId, endedAt, finalReply,
});
```

`transcript` 接收已绑定的原生 JSONL 文本。用 `nativeTurnId`、从 1 开始的 `nativeTurnIndex` 或轮末时间 `endedAt` 选轮。API 仅在有唯一匹配时使用无时间证据的单轮转录。`finalReply` 省略时从选中的轮次取正文，`null` 表示该轮没有可用正文。

托管输入发出前，loomd 记录 `HEAD` 及已存在的脏路径、未跟踪路径和 Git blob 哈希。轮末用 `git status` 和 `git diff --numstat` 对比工作树快照，记录每个文件的增删、净行数、保护路径、越界路径、删改断言及新增 `skip`、`only`。重命名检查新旧路径。凭据路径和 loomd 生成的文件排除在快照外。临时索引独立于实际索引，Git 对象保留到常规 GC。共享工作树必须由调度方隔离，因为轮间快照记录的是目录变化。

`loom hist` 默认显示轮次活动摘要。`--diff` 显示完整轮次 Git 数据。`--level L2` 显示工具序号、时间和验证详情，`--with-calls` 展开逐请求用量，`--only-failed` 筛选失败工具。旧轮次若未记录工作树边界，摘要会标记 `missing-boundary`。在观察到原生提交边界的旧轮次，`--diff` 还可读取提交间差异。

`verification.commands` 记录可从当前轮归属的验证命令和原生退出码。`sandboxed` 为 `true`、`false` 或 `null`，取原生结果、工具参数或明确的启动参数。每条命令的 `tailSha256` 对统一换行后的最后五行计算，`tail` 保留限长摘录。复合命令保存外层退出码。测试总数或通过数取自识别到的摘要，无法归属通过数时显示 `count unrecognised`。

`claims` 保存简单规则提取的声称、`MATCH`、`MISMATCH` 或 `UNVERIFIED`，以及原因。全绿比较同轮每条命令的最后一次执行并检查跳测信号。通过数用单次可识别的测试摘要核对。合入检查配置的本地 `mergeRef` 是否含工作提交，以及工作树是否仍有待合入改动。
