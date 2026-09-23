# Codex 原生 fork：隔离本机协议验证

2026-09-23。承接[纵向 MVP](../design/role-instance-vertical-mvp.zh-CN.md)和已批准的频道内持久 fork。此次新增可重复执行的验证脚本；**尚未新增产品 fork 命令、成员入口或正式 session 绑定**。

## 方法与来源

执行 `node scripts/test-codex-native-fork.mjs /opt/homebrew/bin/codex`。本机 CLI 为 0.155.1；独立临时 HOME / CODEX_HOME / cwd，未继承用户认证环境或读取正式 session。模型 provider 固定为本地 HTTP Responses fixture，回复固定字符串，不执行工具，不调用付费模型。运行结束关闭测试子进程和服务，删除临时目录。

这比 fake CLI 多验证了本机真实 Codex 的协议处理、历史持久化与恢复，但**没有验证真实模型遵循身份指令、回答质量、token 或实际耗时**。本地 fixture usage 为零，不是推理模型消耗测量。

依据固定上游 [openai/codex，commit 6b9826e3](https://github.com/openai/codex/tree/6b9826e3aa83b1a5947db50f4332cb9c65f1b340)（Apache-2.0，核对本地 LICENSE；只读分析）：

- `codex-rs/app-server/tests/suite/v2/thread_fork.rs`：原生 fork、完整/截止历史。
- `codex-rs/app-server-protocol/schema/typescript/v2/ThreadForkParams.ts`：threadId、lastTurnId、developerInstructions。
- `codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts`、`CollaborationMode.ts`、`Settings.ts`：原生 turn 的 collaborationMode developer 指令通道。

源检出目录见[能力核查](2026-09-22-role-session-capabilities.zh-CN.md)。测试为 RAH 自写协议调用与本地 fixture，不复制上游实现；生产没有引入分析仓库依赖。Raft 的跨频道单 Agent 会话并不是此处的目标：这是用户批准的每频道实例架构适配，不标记为 Raft 字节复用。Multica 的通用编排不解决此次原生指令落点，未引入其依赖。

## 关键发现

直接在 `thread/fork` 传新的 `developerInstructions`，RPC 成功并生成不同 thread ID，但在本机 0.155.1 子会话的实际模型请求里仍只有旧身份，新文本没有送入。不能把字段存在或成功返回当作身份交接完成。此前启动记忆核查也发现恢复会话的 system 参数与真实模型输入不等价；此处重新使用模型请求侧证据。

验证成功的方式是：子会话首轮 `turn/start` 使用 `collaborationMode.settings.developer_instructions` 提交身份交接。模型请求出现晚于源身份的 developer 消息。它是**追加新指令，不是删除旧历史身份**；新指令说明当前为新的实例、旧身份属于来源、不得继承原任务。关闭 app-server 再启动，resume 相同子 session，该指令和子历史仍在。

本机协议首轮试验使用数字 loopback 地址时被机器网络代理返回 503；fixture 改用 localhost 后直接完成。没有更改系统代理设置，此现象不归因于产品调度，也没有因此更改产品网络配置。

## 验证结果

证据：[原生 CLI + 本地假模型](../evidence/2026-09-23-native-fork/codex-local-model.json)。

| 检查                                     | 结果                                 |
| ---------------------------------------- | ------------------------------------ |
| 两轮父历史后按第一轮 completed turn 截止 | 子包含第一轮、不包含第二轮           |
| 不存在的 cutoff                          | 原生拒绝，不默默复制全部             |
| fork 本身                                | 新 session ID，不产生模型请求        |
| fork 的 developerInstructions 参数       | 本机未送达模型请求；明确记录负证据   |
| 首轮 collaborationMode developer 指令    | 请求里实际出现，顺序晚于源身份       |
| 关闭进程再恢复子 session                 | ID、继承历史、子历史及交接指令仍在   |
| 父 session 再续聊                        | 含父后续历史，不含子消息或子身份     |
| 模型请求                                 | 六次，仅本地固定回复；未调用付费模型 |

没有直接改写任何原生 JSONL/数据库，没有读取或复制正式用户会话。本次未修改 daemon/Web 行为或正式数据，因此没有重启未改变的正式服务。

## 接下来的最小产品接线

1. Kernel 校验来源实例仍在频道且没有活动执行；Host 获取现有排他 fence，读取该实例当前精确 session 绑定。不能按“最新文件”猜 session，也不能把一次角色配置复制叫 fork。
2. Host 按完成 cutoff 调原生 fork，记录操作回执和新 session ID。同一操作重试不再次原生 fork。原生失败不发布可执行成员。
3. Kernel 创建同频道新 principal/实例，冻结来源实例配置，任务、Inbox、私有 box 成员权限均不复制。首轮发放新运行凭据并携带身份交接；原凭据在旧执行完成后不可重用。
4. 首次及后续唤醒只能恢复该子 session，不因来源模板修订或进程重启静默变成空会话。接 UI 后验证频道 @ 到子实例并由它回复。

首批只考虑 Codex、空闲来源和最近完成点，不展开忙时 fork、Side、恢复替代或四家通用框架。其他 CLI 未接入不能显示成功。**本脚本不证明上述 Kernel/Host/API/UI 接线完成，也不证明共享本机账户下具备文件级安全隔离。**

## 本轮仓库检查

`npm run check` 完整退出 0（包含类型检查、默认测试、Web 单测与回归尾段）；`npm run format:check`、`git diff --check` 通过。原生 fixture 门禁重复执行通过，归档 JSON 与最后一次结果一致。本轮只有验证脚本、设计和证据变更，没有修改产品运行路径、构建部署或提交代码。
