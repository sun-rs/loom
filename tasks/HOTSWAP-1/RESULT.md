# HOTSWAP-1 结果

无头会话由独立进程组中的每会话宿主持有。loomd 正常重启、被 SIGKILL、切换发布或回滚时，原生进程和轮次继续执行。接管方领取新的控制世代，从宿主的持久事件流和请求收据对账，再按原投递 ID 更新 inbox 与波次 outbox。显式 `loom stop` 关闭会话宿主。

## 实现与兼容

- 宿主启动意图、owner、原生绑定及输入收据保存在项目元数据中。接管检查 PID、incarnation、原生 session ID 和 stream ID；重复控制按 ID 与内容摘要返回原收据，同 ID 的不同内容拒绝。明确未交给原生的输入可重试，提交状态无法核实的输入保留 `uncertain`。[宿主](../../daemon/session-host.mjs) · [接管](../../daemon/host-client.mjs) · [收件箱](../../inbox/engine.mjs)
- 宿主和 loom-pty 保留 v1 和 v2 的共同方法与身份校验，较早的 loom-pty 通过 v0 适配。loom-pty 的改动仅限控制协议握手。`loom upgrade` 使用分别准备的发布目录，校验两版自检、源码摘要、依赖、数据库版本与控制协议。接回会话后原子提交发布指针，报告每个会话；失败时由上一版接管，`--rollback` 使用同一交接流程。[控制协议](../../docs/PROTOCOL-v2.md#5-在线升级与回滚)
- SQLite 的旧版写入路径使用显式列投影，更新已知字段时保留新增列的值。发布采用可空或带默认值的扩展列、旁表及 `user_version`，在兼容窗口关闭后再收缩结构。[索引迁移规则](../../index/README.md)

## 验收

- HOTSWAP-0 严格矩阵覆盖对照组、正常重启、SIGKILL、daemon 与 CLI 替换、loom-pty 替换、在线模式扩展和 OAR 0.130.0 → 0.130.1，七组均通过。核对 43 个投递 ID，每个都有一条 inbox 记录、一次原生输入和预期结果。七条波次各投递一次，均带预期 Worker 结果。停机组的原 Worker 在 loomd 离线期间完成。SQLite 验证 `user_version=2`、JSONL 扩展和旁表后，已知列更新仍保留新增列的非空值 `17`。所属 hc 窗格和宿主均已清理。[严格矩阵](/Users/sun/Code/exp-relay/hotswap-1/r-dA10vi/summary.json)
- 真机使用 Codex 0.171.0、agy 1.5.16、hc 和两个 loom-pty 协议版本。两家模型请求由各自的本地端点提供确定性结果。隔离的 agy ACP 使用仅对本地端点有效的测试密钥。验证新旧 CLI 互连、v1/v2 宿主与包装器并存、显式回滚、候选版启动失败后自动接管。Codex 和 agy 的原生进程、会话和事件流持续运行，两个在途轮次都在 loomd 停机时完成；重新接管后各收到一次结果。agy 的正文沿用 `unconfirmed` 标记。未知方法、协议、incarnation 和旧控制世代均被拒绝。[真机与进程证据](/Users/sun/Code/exp-relay/hotswap-1/l-0pTdBD/result.json)
- `npm test` 通过 259 项，覆盖收到宿主收据前后的 daemon SIGKILL、原生事件落盘边界、inbox 回执、波次和留存。`attempt` 和 `abort-intent` 的旧断言已更新：宿主证明旧控制请求未到达时，接管者可安全继续并只提交一次。[测试日志](/Users/sun/Code/exp-relay/hotswap-1/npm-VimtgV/npm-test.log)

为使原严格验收适配独立宿主，调整了 HOTSWAP-0 的 `harness.mjs` 和 `setup.mjs`。严格运行使用本卡实验目录，记录停机期间的 Worker 完成，并显式关闭由测试创建的宿主。CLI 的 daemon 启动入口读取升级提交的活动发布指针。首次部署遇到旧 loomd 直接持有的活跃无头会话时，预检返回阻塞原因和对应地址。宿主本身退出后可按原生 ID 尝试恢复，新流通过原生证据对账。

```sh
/opt/homebrew/bin/node tasks/HOTSWAP-0/harness.mjs
/opt/homebrew/bin/node tasks/HOTSWAP-1/live.mjs
npm test
```

STATUS: done
