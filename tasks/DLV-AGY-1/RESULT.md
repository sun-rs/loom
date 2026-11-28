# DLV-AGY-1 验收记录

## 现场诊断

基线为 `8d3d296f`。只读核对 pilot-2、pilot-cell 的 `.project/loomd/sessions`、`notifications.json`、`.project/inbox/state.json`、holder 写入回执及绑定的 agy 原生 transcript 用户输入。五条投递均有 `payload-mismatch` 通知，turn-heads 均记录开轮。两种 transcript 的对应用户正文相同。

| 项目 / Leader | 投递 | 原生 step | 预留 → 原生正文（字节） | 缺失的换行位置 |
| --- | --- | ---: | ---: | --- |
| pilot-2 / `loom-43233343` | `b6ca3c78` | 466 | 1685 → 1683 | `senior-recovery`、`gate-pack` 之前各一个 |
| pilot-2 / `loom-43233343` | `3937d5cd` | 486 | 624 → 623 | `senior-recovery` 之前一个 |
| pilot-2 / `loom-43233343` | `c2ef0c79` | 495 | 620 → 619 | `senior-recovery` 之前一个 |
| pilot-2 / `loom-43233343` | `3a38a2df` | 507 | 1108 → 1106 | `senior-recovery`、`gate-pack` 之前各一个 |
| pilot-cell / `loom-f1f61a04` | `dc89eb38` | 2420 | 598 → 597 | `senior-recovery` 之前一个 |

预留的 `wireBody` 与 inbox 的期望 SHA-256 一致。剥离 agy 的 `<USER_REQUEST>` 封装和 Loom 投递标记后，各条原生正文的 SHA-256 均复现原告警记录的 observed 值。差异限于上表的分隔换行，消息及附加模块正文的其余字节全部一致。

五条 holder 写入回执的摘要、长度和 stdin 偏移均匹配旧版每六个换行分段的粘贴序列及最后的 Enter。每个缺失换行都落在旧版将相邻两个 `LF` 分到不同括号粘贴段的位置。agy 在这些段交界处少保留一个 `LF`。输入框读回会折叠空白，因此放行了 Enter，原生回执按字节比较时随即报错。

## 修复

- agy 粘贴分段把连续换行留在同一段。holder 持久化此次使用的分段方式，恢复挂起草稿时按原方式验证写入回执及续写偏移。
- 旧 holder 的兼容核验只接受已冻结 `wireBody` 中、由该投递记录的技能模块头之前各少一个 `LF` 的精确摘要。纠正历史回执仍要求原生会话及回执时刻吻合。新 holder 的技能模块分隔符按原始字节核验，消息正文和模块正文发生改写或截断仍报 `CORRUPTED`。

## 验证

- 回归夹具取自 `3a38a2df`，缩写了回执文件路径和 Worker 摘要行，保留原生封装、换行和双模块边界。修复前复现误报及分段丢空行。修复后通过单、双边界差异，历史回执，正文改字、丢空行，模块截断，新 holder 的严格校验，以及按正确分段恢复旧、新写入回执。 [RED](/private/tmp/loom-dlv-agy-red.log) · [GREEN](/private/tmp/loom-dlv-agy-green.log)
- 用五条现场 inbox 记录、holder 摘要及原生用户输入独立回放，全部从 `corrupted` 纠正为 `received` 且 `payloadVerified=true`。回放期间没有重投。 [回放日志](/private/tmp/loom-dlv-agy-replay.log)
- 使用 `PATH=/Users/sun/.loom-cell/runtime/node-26.13.1/bin:$PATH` 固定 Node 26.13.1。`npm ci`、`npm run lint` 和 `git diff --check` 通过。全量 `npm test` 通过 1,174 项，失败、取消、跳过均为 0。 [安装日志](/private/tmp/loom-dlv-agy-npm-ci.log) · [Lint 日志](/private/tmp/loom-dlv-agy-lint.log) · [全量测试日志](/private/tmp/loom-dlv-agy-npm-test.log)

两套 pilot 的现场操作限于只读。修复部署后的实时投递及既有通知状态尚未现场验证。

STATUS: done
