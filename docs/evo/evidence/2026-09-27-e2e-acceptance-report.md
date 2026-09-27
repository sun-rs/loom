# 正式服务真实贯通验收报告（20260927T094812Z）

- 服务：http://127.0.0.1:4176；部署提交：6018f47；判定只依据 room.db 与 Human API。
- 模型：codex local:codex-cli/v1:gpt-6-luna / low；claude local:claude-cli/v1:haiku / 无 effort。
- 频道：e2e-accept-20260927t094812z（room_d128678d-2365-4f62-9c2a-44a3ee8c01ec）；项目：~/.loom/acceptance/e2e-project（HEAD a6fb645f43d98c1dcbacd7feaca27391e1c75d83）。
- 调用规模：RunAttempt 20（上限 40），模型生成 55。
- 总判定：失败。

“通过”只表示账本与 API 事实满足判定规则，不表示回答正确；“未覆盖”表示该路径本次没有被触发。

## 各步判定

| 步骤                    | 判定 | 耗时      | RunAttempt | 生成 | 问题                                                                                                        |
| ----------------------- | ---- | --------- | ---------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| 4. a. 顶层分工审查      | 通过 | 129.6 s   | 2          | 6    | —                                                                                                           |
| 5. b. 多轮互相引用      | 通过 | 66.7 s    | 3          | 7    | —                                                                                                           |
| 6. c. 私聊排队与隔离    | 失败 | 168.4 s   | 5          | 21   | 交付: codex@频道: 2 条回复（重复）；ACK: activation_07565974-2f48-4810-b8e9-420798f478f4: state=quarantined |
| 7. d. 记忆写入与读回    | 失败 | 10380.4 s | 6          | 12   | 交付: codex@频道: 3 条回复（重复）                                                                          |
| 8. e. 读开关拒绝        | 失败 | 36.4 s    | 2          | 4    | 交付: 1 条不在预期房间/实例的回复                                                                           |
| 9. f. daemon 重启后续聊 | 通过 | 46.5 s    | 2          | 5    | —                                                                                                           |
| 10. g. 控制台           | 通过 | 0.1 s     | 0          | 0    | —                                                                                                           |

## 4. a. 顶层分工审查

- 交付：通过
- ACK：通过
- session：通过
- 模型：通过
- 预算：通过
- Human #6（频道）：@e2e-codex-1e23439ab0d1b769c2f97d1a @e2e-claude-0d484e96bf36d0fd6c53aed4 请只读审查本频道附加目录中的小项目（不要修改任何文件）。分工：@e2e-codex-1e23439ab0d1b769c2f97d1a 审查 scripts/workbench-launch-receipt.mjs 中 receipt 的写入与 PID 校验逻辑；@e2e-claude-0d484e96bf36d0fd6c53aed4 审查 scripts/workbench-launch-receipt.test.mjs 对这些逻辑的测试覆盖。各自在频道回复一段结论（不超过 200 字，附行号依据）。

| RunAttempt                               | 实例   | 房间 | 状态   | 模式 | 开始 → 结束                                         | 生成 | 输入/缓存/输出   | 压缩 |
| ---------------------------------------- | ------ | ---- | ------ | ---- | --------------------------------------------------- | ---- | ---------------- | ---- |
| run_0ff2b562-8929-4cf5-9d2c-49f22c3c8ad2 | claude | 频道 | exited | —    | 2026-09-27T09:48:42.970Z → 2026-09-27T09:49:18.835Z | 3    | 70137/41874/2504 | 0    |
| run_f2968175-d098-4834-acec-601bc7cd76b8 | codex  | 频道 | exited | cold | 2026-09-27T09:48:42.985Z → 2026-09-27T09:49:05.360Z | 3    | 33722/19968/477  | 0    |

**回复 #15（codex，频道，延迟 52.6 s）— 质量待人工核对：**

> 审查结论：写入前先校验 mode 与正整数 PID，使用随机临时名、`wx` 独占创建和 0600 权限，再 rename 原子替换正式 receipt，并在 finally 清理临时文件（scripts/workbench-launch-receipt.mjs:85-101）。读取仅将 ENOENT 视为无 receipt（:79-84）。重启要求 schemaVersion=1 且 receipt.pid 严格等于 incumbentPid，再清理继承环境中的网络键并按记录 mode 重建（:66-77）。注意 PID 只做整数/相等校验，未探测进程身份或 PID 复用；原子替换也未显式 fsync。

**回复 #19（claude，频道，延迟 65.1 s）— 质量待人工核对：**

> **测试覆盖审查**（scripts/workbench-launch-receipt.test.mjs）
>
> **PID 校验覆盖良好：**
>
> - ✓ receipt 缺失：第48行测试，断言包含 /receipt/i
> - ✓ PID 不匹配：第49-57行测试 pid:41 vs incumbentPid:42，断言包含 /incumbent/i
> - ✓ 有效 PID 传递：第14-27行等多个测试验证 pid:42 匹配情况
>
> **Receipt 写入覆盖充分：**
>
> - ✓ 文件权限校验：第88-89行验证 0o600 模式
> - ✓ 内容完整性：第92-94行验证 PID 更新、mode 字段
> - ✓ 敏感信息保护：第95-99行验证无 TOKEN 泄露
> - ✓ 失败时不持久化：第196行验证无效 mode 下 readLaunchReceipt 返回 undefined
>
> **缺陷：**
>
> - pid 参数校验（第113行 Number.isInteger && > 0）未测试边界值（非整数、≤0、undefined）
> - 文件系统原子性（tmpfile→rename）逻辑未单独验证

## 5. b. 多轮互相引用

- 交付：通过
- ACK：通过
- session：通过
- 模型：通过
- 预算：通过
- Human #23（频道）：@e2e-codex-1e23439ab0d1b769c2f97d1a @e2e-claude-0d484e96bf36d0fd6c53aed4 追问：请阅读对方刚才在本频道的结论，用一句话引用对方的一个具体发现（注明出自谁），并说明它与你自己的结论是互补还是冲突。不需要再读文件，只回复一段。

| RunAttempt                               | 实例   | 房间 | 状态   | 模式 | 开始 → 结束                                         | 生成 | 输入/缓存/输出   | 压缩 |
| ---------------------------------------- | ------ | ---- | ------ | ---- | --------------------------------------------------- | ---- | ---------------- | ---- |
| run_1a86a3e6-952a-4b45-804a-87a3e61e4826 | codex  | 频道 | exited | warm | 2026-09-27T09:50:22.591Z → 2026-09-27T09:50:33.146Z | 2    | 26594/23040/345  | 0    |
| run_75f737fa-d465-4b20-921f-98067c428c71 | claude | 频道 | exited | —    | 2026-09-27T09:50:22.593Z → 2026-09-27T09:50:44.400Z | 2    | 56099/53871/1398 | 0    |
| run_3843e15b-1d2b-4318-9d41-4845ad20dc3a | claude | 频道 | exited | —    | 2026-09-27T09:50:44.419Z → 2026-09-27T09:51:08.188Z | 3    | 90071/88297/642  | 0    |

**回复 #32（codex，频道，延迟 10.8 s）— 质量待人工核对：**

> @e2e-claude-0d484e96bf36d0fd6c53aed4 指出“pid 参数校验的非整数、≤0 等边界值未测试”；这与我关于实现只检查正整数及 receipt PID 与 incumbent 相等、但不验证进程身份的结论互补。

**回复 #36（claude，频道，延迟 19.4 s）— 质量待人工核对：**

> @e2e-codex 指出"原子替换也未显式 fsync"，与我发现的"文件系统原子性逻辑未单独验证"互补：Codex 从实现风险角度指出缺少持久化保障，我从测试覆盖角度指出这个关键逻辑没有被单元测试所验证，两者共同表明该部分存在测试盲点。

## 6. c. 私聊排队与隔离

- 交付：失败（codex@频道: 2 条回复（重复））
- ACK：失败（activation_07565974-2f48-4810-b8e9-420798f478f4: state=quarantined）
- session：通过
- 模型：通过
- 预算：通过
- 私聊：通过
- Human #47（频道）：@e2e-codex-1e23439ab0d1b769c2f97d1a 新任务：请逐一检查 scripts/workbench-launch-receipt.mjs 中每个导出函数的错误处理路径，列出每个 assert/throw 的触发条件，并说明 scripts/workbench-launch-receipt.test.mjs 是否覆盖该条件（给出行号）。完成后在频道回复一段汇总。
- Human #2（codex 私聊）：私聊问题：请用一句话说明你认为 PID 校验最大的风险是什么。这条问题只在私聊，请在私聊回复，不要发到频道。

| RunAttempt                               | 实例   | 房间       | 状态   | 模式 | 开始 → 结束                                         | 生成 | 输入/缓存/输出     | 压缩 |
| ---------------------------------------- | ------ | ---------- | ------ | ---- | --------------------------------------------------- | ---- | ------------------ | ---- |
| run_9d58f624-9acf-4c90-9ec1-1b787583f737 | codex  | 频道       | exited | warm | 2026-09-27T09:51:29.248Z → 2026-09-27T09:52:43.089Z | 14   | 256823/219904/2504 | 0    |
| run_dc81db2b-589c-4740-bc1d-9a3b1bd9f4ce | claude | 频道       | exited | —    | 2026-09-27T09:51:29.249Z → 2026-09-27T09:51:41.069Z | 2    | 62883/61545/519    | 0    |
| run_99486c64-6ac9-4d4a-b924-33e1d5728451 | codex  | codex 私聊 | exited | warm | 2026-09-27T09:52:43.093Z → 2026-09-27T09:52:47.962Z | 1    | 25458/24320/176    | 0    |
| run_c49e3b5a-1d3c-4283-a5ee-010948ba9d8d | codex  | 频道       | exited | warm | 2026-09-27T09:52:59.789Z → 2026-09-27T09:53:17.953Z | 2    | 52237/49664/643    | 0    |
| run_03ef2119-9c98-4221-a052-13c3c1d22f7d | codex  | 频道       | exited | warm | 2026-09-27T09:53:41.265Z → 2026-09-27T09:53:57.121Z | 2    | 54448/51712/678    | 0    |

**回复 #7（codex，codex 私聊，延迟 78.3 s）— 质量待人工核对：**

> 最大的风险是校验只比较 receipt 中的 PID 数字与 incumbent PID，PID 复用时可能把旧 receipt 错认作当前进程的网络配置。

**回复 #62（codex，频道，延迟 74.0 s）— 质量待人工核对：**

> 逐项结论：restartNetworkEnvironment：receipt 缺失/版本非1、PID与 incumbent 不等分别在 :88-91、:92-96 断言，测试覆盖于 test.mjs:47-57；mode 无效/端口非法在 :24-27、:49-52，测试仅覆盖未知 kind（:58-66），未覆盖端口边界；LAN origin 非法 URL、非 HTTPS、非规范 origin、bindHost 空值、证书/私钥路径非绝对分别由 :30-33、:38-45 触发，当前测试只验证合法 LAN（:28-46），未覆盖这些失败条件。Tailnet bindHost 非 100.64/10 由 :54 委托校验，测试覆盖（:201-222）；trusted LAN 列表非数组、loopback 重复由 :70-78 触发，测试覆盖非数组及重复（:151-179）；RFC1918 外/非法、重复、等于 Tailnet 地址由 :81-85 委托校验，测试覆盖非私网/非法/重复（:151-179），未单测等于 Tailnet。readLaunchReceipt：ENOENT 返回 undefined、其他文件错误或 JSON 解析错误重抛（:101-109）；测试验证缺失（:78-82），未覆盖损坏 JSON/其他 I/O 错误。writeLaunchReceipt：mode 的上述校验同样适用，另 PID 非正整数断言（:111-113）未测；写入/rename 错误会抛出且 finally 清临时文件（:114-124）未测。测试仅覆盖合法写入及不可复现 trusted LAN 时失败且不落盘（:180-200）。

**回复 #70（codex，频道，延迟 108.8 s）— 质量待人工核对：**

> 逐项结论：restartNetworkEnvironment 的 receipt 缺失/版本非1、PID 不等分别触发 :88-91、:92-96，测试覆盖 :47-57；无效 mode/端口（:24-27、:49-52）只测未知 kind（test.mjs:58-66），端口未覆盖。LAN 模式 URL 非法、非 HTTPS、origin 非规范、bindHost 空、证书/私钥路径非绝对分别触发 :30-33、:38-45，仅测合法 LAN（:28-46）。Tailnet host 非 100.64/10 触发 :54，已覆盖 :201-222；trusted LAN 非数组或重复 loopback 触发 :70-78，已覆盖非数组/重复（:151-179）；委托校验拒绝非私网/非法/重复或等于 Tailnet 的地址（:81-85），测试覆盖前三类（:151-179），未覆盖等于 Tailnet。readLaunchReceipt 对 ENOENT 返回 undefined，JSON 损坏或其他 I/O 错误重抛（:101-109）；只测缺失（:78-82）。writeLaunchReceipt 对非法 mode（同上）、PID 非正整数（:111-113）会拒绝；写入/rename 出错则抛错并 finally 清临时文件（:114-124）；测试覆盖不可复现 LAN 条目失败且不落盘（:180-200），未覆盖 PID、文件操作失败及清理路径；成功权限与替换覆盖 :78-103。

```json
{
  "channelRunAttemptId": "run_9d58f624-9acf-4c90-9ec1-1b787583f737",
  "privateRunAttemptId": "run_99486c64-6ac9-4d4a-b924-33e1d5728451",
  "privateMessageAt": "2026-09-27T09:51:29.622Z",
  "directMembers": ["codex", "Human"]
}
```

## 7. d. 记忆写入与读回

- 交付：失败（codex@频道: 3 条回复（重复））
- ACK：通过
- session：通过
- 模型：通过
- 预算：通过
- 记忆写入：通过
- 记忆读回：通过
- Human #81（频道）：@e2e-codex-1e23439ab0d1b769c2f97d1a 请用 `worker memory write` 记录一条项目记忆（--type project，名称自拟的小写 slug），正文是你对 PID 校验逻辑的结论（含文件与行号）。写完后在频道回复一句，说明你使用的记忆名称。
- Human #100（频道）：@e2e-claude-0d484e96bf36d0fd6c53aed4 请用 memory search 或 memory read 找到并读取 Codex 审查员刚写入的关于 PID 校验的频道记忆，引用其中的结论，并说明该记忆的名称与作者。

| RunAttempt                               | 实例   | 房间 | 状态   | 模式 | 开始 → 结束                                         | 生成 | 输入/缓存/输出  | 压缩 |
| ---------------------------------------- | ------ | ---- | ------ | ---- | --------------------------------------------------- | ---- | --------------- | ---- |
| run_40e83844-b84a-4535-8c0c-7e1958848d1d | claude | 频道 | exited | —    | 2026-09-27T09:54:17.828Z → 2026-09-27T09:54:30.968Z | 2    | 67336/64176/335 | 0    |
| run_b629c379-34de-4eba-b52c-a0b9222de307 | codex  | 频道 | exited | cold | 2026-09-27T12:45:15.875Z → 2026-09-27T12:45:35.873Z | 3    | 84980/54784/528 | 0    |
| run_52541796-40f4-4afc-8062-9b1523652d2f | codex  | 频道 | exited | warm | 2026-09-27T12:46:31.781Z → 2026-09-27T12:46:40.793Z | 2    | 58443/56832/214 | 0    |
| run_56f1664c-0003-4ec6-8ab7-d25f41bd1958 | claude | 频道 | exited | —    | 2026-09-27T12:46:31.783Z → 2026-09-27T12:46:46.169Z | 2    | 71435/35405/735 | 0    |
| run_cba32796-d9a7-4fdf-8ef1-814ab1b93386 | codex  | 频道 | exited | warm | 2026-09-27T12:46:40.816Z → 2026-09-27T12:46:50.717Z | 2    | 60131/57856/369 | 0    |
| run_988ae055-df38-4873-a44d-2bf5f56a2411 | codex  | 频道 | exited | warm | 2026-09-27T12:46:50.721Z → 2026-09-27T12:46:56.799Z | 1    | 30903/29440/219 | 0    |

**回复 #96（codex，频道，延迟 10278.3 s）— 质量待人工核对：**

> 已记录项目记忆，名称为 pid-receipt-validation。

**回复 #116（claude，频道，延迟 12.4 s）— 质量待人工核对：**

> 已读取记忆 pid-receipt-validation（由 @e2e-codex 著）。其结论指出：restartNetworkEnvironment 在 :92-96 只验证 receipt.pid === incumbentPid，writeLaunchReceipt 在 :113 只断言 PID 为正整数，测试覆盖了 PID 不匹配（test.mjs:47-57），但未覆盖 writeLaunchReceipt 的非法 PID 边界值；且"比较数字不能识别 PID 复用或验证该 PID 对应进程身份"。
>
> 记忆名称：pid-receipt-validation（类型 project）
> 作者：@e2e-codex-1e23439ab0d1b769c2f97d1a

**回复 #120（codex，频道，延迟 19.2 s）— 质量待人工核对：**

> 记忆 `pid-receipt-validation`（作者：Codex 审查员，participant `principal_21cf2ed3-f20c-4c5b-9e03-3a7074398257`）指出：`restartNetworkEnvironment` 仅比较 receipt PID 与 incumbent PID 是否相等，不能识别 PID 复用或验证进程身份（scripts/workbench-launch-receipt.mjs:92-96）。

**回复 #128（codex，频道，延迟 25.2 s）— 质量待人工核对：**

> 收到。此前读取确认的 `pid-receipt-validation` 记忆作者为 Codex 审查员（participant `principal_21cf2ed3-f20c-4c5b-9e03-3a7074398257`）；其 PID 比较与复用风险结论如你引用所述。

```json
{
  "entries": [
    {
      "entryId": "memory_31ee893a-f74c-438c-bfaa-2848d444a8c1",
      "scopeRoomId": "room_d128678d-2365-4f62-9c2a-44a3ee8c01ec",
      "name": "pid-receipt-validation",
      "type": "project",
      "description": "workbench launch receipt PID 校验结论",
      "state": "active",
      "revision": 1,
      "createdAt": "2026-09-27T12:45:31.730Z",
      "body": "在 scripts/workbench-launch-receipt.mjs:92-96，restartNetworkEnvironment 只要求 receipt.pid 严格等于 incumbentPid；scripts/workbench-launch-receipt.mjs:113 的写入端只断言 PID 是大于零的整数。测试 scripts/workbench-launch-receipt.test.mjs:47-57 覆盖 receipt PID 与 incumbent 不匹配，但没有覆盖 writeLaunchReceipt 的非法 PID 边界。比较数字不能识别 PID 复用或验证该 PID 对应进程身份。\n"
    }
  ],
  "revisions": [
    {
      "entryId": "memory_31ee893a-f74c-438c-bfaa-2848d444a8c1",
      "revision": 1,
      "op": "create",
      "actorKind": "instance",
      "actorPrincipalId": "principal_21cf2ed3-f20c-4c5b-9e03-3a7074398257",
      "instanceId": "principal_21cf2ed3-f20c-4c5b-9e03-3a7074398257",
      "roleId": "role_7d9fbcd0-8419-4514-b68a-8bece3bab4d7",
      "modelBindingId": "local:codex-cli/v1:gpt-6-luna",
      "modelReasoning": "low",
      "sessionGeneration": 0,
      "runAttemptId": "run_b629c379-34de-4eba-b52c-a0b9222de307",
      "viaRoomId": "room_d128678d-2365-4f62-9c2a-44a3ee8c01ec",
      "basedOnRoomSeq": 81,
      "createdAt": "2026-09-27T12:45:31.730Z"
    }
  ]
}
```

## 8. e. 读开关拒绝

- 交付：失败（1 条不在预期房间/实例的回复）
- ACK：通过
- session：通过
- 模型：通过
- 预算：通过
- 读开关：通过
- Human #133（频道）：@e2e-claude-0d484e96bf36d0fd6c53aed4 请再次用 memory read 读取频道记忆 pid-receipt-validation的正文，并逐字引用其中的第一句。如果读取失败，请如实说明失败原因，不要凭印象复述。

| RunAttempt                               | 实例   | 房间 | 状态   | 模式 | 开始 → 结束                                         | 生成 | 输入/缓存/输出  | 压缩 |
| ---------------------------------------- | ------ | ---- | ------ | ---- | --------------------------------------------------- | ---- | --------------- | ---- |
| run_202bb7ca-4e65-4f5e-9151-2a44998405a5 | claude | 频道 | exited | —    | 2026-09-27T12:47:18.204Z → 2026-09-27T12:47:28.602Z | 2    | 74201/72988/423 | 0    |
| run_13e9bc6e-b4e5-462b-9125-b942f7daf498 | codex  | 频道 | exited | warm | 2026-09-27T12:47:18.205Z → 2026-09-27T12:47:33.307Z | 2    | 63176/60928/323 | 0    |

**回复 #142（claude，频道，延迟 8.5 s）— 质量待人工核对：**

> 读取失败。错误信息：Worker API HTTP 403: channel memory read is turned off for this instance by the Human。
>
> 由于 Human 关闭了该实例的频道记忆读取权限，无法再次读取 pid-receipt-validation 的正文内容，故不引用第一句。

**回复 #146（codex，频道，延迟 15.3 s）— 质量待人工核对：**

> “在 scripts/workbench-launch-receipt.mjs:92-96，restartNetworkEnvironment 只要求 receipt.pid 严格等于 incumbentPid；scripts/workbench-launch-receipt.mjs:113 的写入端只断言 PID 是大于零的整数。”

```json
{
  "offPolicyRevision": 1,
  "restoredPolicyRevision": 2,
  "overrideRow": {
    "readEnabled": 0,
    "writeEnabled": null
  },
  "memoryIndexMarks": [
    {
      "sessionGeneration": 0,
      "servedReadEnabled": 0,
      "indexState": "index",
      "indexSeq": 0,
      "deltaSeq": 95,
      "updatedAt": "2026-09-27T12:47:18.555Z"
    }
  ]
}
```

## 9. f. daemon 重启后续聊

- 交付：通过
- ACK：通过
- session：通过
- 模型：通过
- 预算：通过
- 重启：通过
- Human #151（频道）：@e2e-codex-1e23439ab0d1b769c2f97d1a @e2e-claude-0d484e96bf36d0fd6c53aed4 服务已重启。请继续上次的讨论：不要重新读取文件，各用一两句话复述你在重启前给出的结论，并指出对方结论中你同意或不同意的一点。

| RunAttempt                               | 实例   | 房间 | 状态   | 模式 | 开始 → 结束                                         | 生成 | 输入/缓存/输出    | 压缩 |
| ---------------------------------------- | ------ | ---- | ------ | ---- | --------------------------------------------------- | ---- | ----------------- | ---- |
| run_d0f45e61-9e38-48c4-8d2a-86b98eaefb87 | codex  | 频道 | exited | cold | 2026-09-27T12:53:31.432Z → 2026-09-27T12:53:55.601Z | 4    | 136006/131072/654 | 0    |
| run_09bda471-7ac6-437f-ace1-277c9a47231c | claude | 频道 | exited | —    | 2026-09-27T12:53:31.434Z → 2026-09-27T12:53:49.830Z | 1    | 37911/37614/1120  | 0    |

**回复 #160（claude，频道，延迟 16.7 s）— 质量待人工核对：**

> @e2e-claude-0d484e96bf36d0fd6c53aed4：我的结论是测试对 PID 不匹配情况覆盖良好（test.mjs:47-57），但 writeLaunchReceipt 的非整数/≤0 等 PID 边界值未测试；receipt 写入的文件权限与原子替换逻辑经测验（:78-103），但缺少 fsync 显式持久化验证。
>
> @e2e-codex 指出测试未覆盖 writeLaunchReceipt 的非法 PID 边界，我同意；但不同意其暗示的"原子替换未显式 fsync"是实现缺陷——POSIX rename 已保证原子性，fsync 是持久化强化而非正确性要求，当前测试未验证此点属设计空隙而非代码错误。

**回复 #164（codex，频道，延迟 24.2 s）— 质量待人工核对：**

> 我此前的结论是：restartNetworkEnvironment 只比较 receipt PID 与 incumbent PID 相等（workbench-launch-receipt.mjs:92-96），因此不能识别 PID 复用或确认进程身份；写入时仅要求 PID 为正整数（:113）。我同意 @e2e-claude 指出的测试覆盖缺口：写入函数的非法 PID 边界未被测试（test.mjs:113 未覆盖）。

```json
{
  "pidBefore": 75793,
  "pidAfter": 92091,
  "restartMs": 6114,
  "backupDir": "~/.loom/acceptance/backups/20260927T094812Z",
  "deployedHead": "6018f4731455722c63a7d649f877c1636a805540",
  "activeWorkBefore": {
    "activations": 0,
    "runs": 0,
    "orphaned": 0
  }
}
```

## 10. g. 控制台

- 控制台：通过

```json
{
  "consoleHttp": "200 text/html; charset=utf-8",
  "cards": [
    {
      "provider": "codex",
      "handle": "e2e-codex-1e23439ab0d1b769c2f97d1a",
      "stateLabel": "空闲",
      "queuedLabel": "排队 0",
      "compactionLabel": "0（本 session，Loom 托管轮次内观测）",
      "privateBoxLabel": "私聊可用",
      "lastError": null,
      "recentRuns": [
        {
          "lastEventType": "run.turn_quiesced",
          "runAttemptId": "run_d0f45e61-9e38-48c4-8d2a-86b98eaefb87",
          "updatedAt": "2026-09-27T12:53:55.601Z"
        },
        {
          "lastEventType": "run.finished",
          "runAttemptId": "run_13e9bc6e-b4e5-462b-9125-b942f7daf498",
          "updatedAt": "2026-09-27T12:47:33.307Z"
        },
        {
          "lastEventType": "run.finished",
          "runAttemptId": "run_988ae055-df38-4873-a44d-2bf5f56a2411",
          "updatedAt": "2026-09-27T12:46:56.800Z"
        }
      ],
      "latestRunAttemptId": "run_d0f45e61-9e38-48c4-8d2a-86b98eaefb87",
      "latestRunUsage": {
        "gaps": [],
        "generations": [
          {
            "cachedInputTokens": "31,488",
            "context": "32,939 / 258,400",
            "inputTokens": "32,788",
            "observedAt": "2026-09-27T12:53:41.612Z",
            "outputTokens": "151",
            "provider": "codex-app-server/v1",
            "reasoningOutputTokens": "0",
            "responseId": "01a0e2ed-86f6-79b0-9846-f34c0be89ca8:786330"
          },
          {
            "cachedInputTokens": "32,512",
            "context": "33,110 / 258,400",
            "inputTokens": "32,982",
            "observedAt": "2026-09-27T12:53:46.418Z",
            "outputTokens": "128",
            "provider": "codex-app-server/v1",
            "reasoningOutputTokens": "0",
            "responseId": "01a0e2ed-86f6-79b0-9846-f34c0be89ca8:819440"
          },
          {
            "cachedInputTokens": "32,512",
            "context": "35,006 / 258,400",
            "inputTokens": "34,758",
            "observedAt": "2026-09-27T12:53:52.142Z",
            "outputTokens": "248",
            "provider": "codex-app-server/v1",
            "reasoningOutputTokens": "0",
            "responseId": "01a0e2ed-86f6-79b0-9846-f34c0be89ca8:854446"
          },
          {
            "cachedInputTokens": "34,560",
            "context": "35,605 / 258,400",
            "inputTokens": "35,478",
            "observedAt": "2026-09-27T12:53:55.595Z",
            "outputTokens": "127",
            "provider": "codex-app-server/v1",
            "reasoningOutputTokens": "0",
            "responseId": "01a0e2ed-86f6-79b0-9846-f34c0be89ca8:890051"
          }
        ],
        "processCleanups": [],
        "rows": [
          {
            "label": "执行方式",
            "value": "冷（新启动常驻进程）"
          },
          {
            "label": "session 恢复耗时",
            "value": "26 ms"
          },
          {
            "label": "final 收尾",
            "value": "final 帖 #164；已请求：是；已接受：是；已终止：是；抢占后续生成：否"
          },
          {
            "label": "用量完整性",
            "value": "完整"
          },
          {
            "label": "生成次数",
            "value": "4"
          },
          {
            "label": "输入 token",
            "value": "136,006"
          },
          {
            "label": "缓存输入 token",
            "value": "131,072"
          },
          {
            "label": "输出 token",
            "value": "654"
          },
          {
            "label": "推理 token",
            "value": "0"
          },
          {
            "label": "上下文占用",
            "value": "35,605 / 258,400"
          },
          {
            "label": "压缩次数（本轮）",
            "value": "0"
          },
          {
            "label": "已记录费用小计（CLI 自报）",
            "value": "未知（CLI 未报告）"
          }
        ],
        "truncated": false
      }
    },
    {
      "provider": "claude",
      "handle": "e2e-claude-0d484e96bf36d0fd6c53aed4",
      "stateLabel": "空闲",
      "queuedLabel": "排队 0",
      "compactionLabel": "0（本 session，Loom 托管轮次内观测）",
      "privateBoxLabel": "私聊未打开",
      "lastError": null,
      "recentRuns": [
        {
          "lastEventType": "run.finished",
          "runAttemptId": "run_09bda471-7ac6-437f-ace1-277c9a47231c",
          "updatedAt": "2026-09-27T12:53:49.831Z"
        },
        {
          "lastEventType": "run.finished",
          "runAttemptId": "run_202bb7ca-4e65-4f5e-9151-2a44998405a5",
          "updatedAt": "2026-09-27T12:47:28.602Z"
        },
        {
          "lastEventType": "run.finished",
          "runAttemptId": "run_56f1664c-0003-4ec6-8ab7-d25f41bd1958",
          "updatedAt": "2026-09-27T12:46:46.169Z"
        }
      ],
      "latestRunAttemptId": "run_09bda471-7ac6-437f-ace1-277c9a47231c",
      "latestRunUsage": {
        "gaps": [],
        "generations": [
          {
            "cachedInputTokens": "37,614",
            "context": "未知",
            "inputTokens": "37,911",
            "observedAt": "2026-09-27T12:53:47.559Z",
            "outputTokens": "1,120",
            "provider": "claude-stream-json/v1",
            "reasoningOutputTokens": "未知",
            "responseId": "msg_011CfTydrgxzzP5UkYuTeGHN"
          }
        ],
        "processCleanups": ["run_end：发现 0，终止 0，剩余 0"],
        "rows": [
          {
            "label": "执行方式",
            "value": "未知（按轮进程或无记录）"
          },
          {
            "label": "session 恢复耗时",
            "value": "未知（未恢复或未测量）"
          },
          {
            "label": "final 收尾",
            "value": "final 帖 #160；已请求：是；已接受：是；已终止：是；抢占后续生成：是"
          },
          {
            "label": "用量完整性",
            "value": "完整"
          },
          {
            "label": "生成次数",
            "value": "1"
          },
          {
            "label": "输入 token",
            "value": "37,911"
          },
          {
            "label": "缓存输入 token",
            "value": "37,614"
          },
          {
            "label": "输出 token",
            "value": "1,120"
          },
          {
            "label": "推理 token",
            "value": "未知"
          },
          {
            "label": "上下文占用",
            "value": "未知"
          },
          {
            "label": "压缩次数（本轮）",
            "value": "0"
          },
          {
            "label": "已记录费用小计（CLI 自报）",
            "value": "未知（CLI 自报 1 条，增量均未知）"
          }
        ],
        "truncated": false
      }
    }
  ],
  "usage": {
    "rows": [
      {
        "cachedInputTokens": "779,520",
        "cost": "未知",
        "inputTokens": "882,921",
        "label": "codex",
        "outputTokens": "7,130",
        "reasoningTokens": "0",
        "runs": "12"
      },
      {
        "cachedInputTokens": "455,770",
        "cost": "$0.0720（部分，CLI 自报）",
        "inputTokens": "530,073",
        "label": "claude",
        "outputTokens": "7,676",
        "reasoningTokens": "未知",
        "runs": "8"
      }
    ],
    "totals": {
      "cachedInputTokens": "1,235,290",
      "cost": "$0.0720（部分，CLI 自报）",
      "inputTokens": "1,412,994",
      "label": "合计",
      "outputTokens": "14,806",
      "reasoningTokens": "0",
      "runs": "20"
    },
    "truncated": false
  }
}
```

## 人工核对清单

- a：两段结论是否分别针对 receipt 写入/PID 校验与测试覆盖，行号是否真实。
- b：是否准确引用了对方结论。
- c：私聊回答是否只在私聊；频道汇总是否未提及私聊内容。
- d：记忆正文是否为 PID 校验结论；claude 的引用是否与记忆一致。
- e：claude 是否承认无法读取，而非凭印象复述。
- f：重启后的复述是否与重启前一致（未重读文件）。

## 已知限制

- 读开关拒绝只能由“开关生效 + 轨迹中出现读命令 + 无修订写入”间接证明；Kernel 不记录被拒的读取，回复是否承认失败需人工核对。
- 记忆读回只证明 claude 调用了读命令；因记忆名称在频道可见，不能自动证明引用内容来自记忆正文。
- 私聊排队依赖时序：若 codex 频道轮在私聊入账前已结束，判“未覆盖”，需重跑该步（--step 6）。
- 原生 session id 来自 Host 绑定文件 supervisors/provider-sessions 与 instance_runtimes；只证明 Loom 传给 CLI 的续聊 id 未变，不证明 provider 侧上下文完整。
- 实例回复中互相 @ 会触发追加轮，按“额外回复”判失败并计入预算；这是产品行为发现，不是脚本错误。
- Claude 使用 haiku（负责人 2026-09-25 批准行），不是 AGENTS.md 2026-09-09 矩阵中的 sonnet；Codex 使用 gpt-6-luna。
- 不是效率门禁：没有原生 CLI 对照，逐轮 usage 只作记录。
