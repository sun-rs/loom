# 执行中重启恢复与后台失败传播修复

本批只修复[真实核心旅程](./2026-09-08-real-multi-agent-core-journey.zh-CN.md)发现的两个阻塞，不重做 Room、私聊或记忆体系，也不处理其他批次接口。

## 上游参考与采用方式

来源为用户授权的 Raft Computer 1.0.18 npm 提取源码，固定 bundle SHA-256：`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。发布入口：`https://www.npmjs.com/package/raft-computer/v/1.0.18`。提取目录：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/`。保留上游授权／来源边界，本批没有复制其 bundle 到生产代码，也不将其称为开源许可证授权。

| 上游位置                                           | 已读实现与采用结论                                                                                                                                                    | 切片 SHA-256                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| packages/computer/src/machineConvergenceReducer.ts | leg_crashed 保留旧进程身份观察，清除失效目标证明，允许后继分配新 generation。RAH 同样保留旧 Run 退出证据，以当前 attempt 校验后继，不使用旧 generation 阻挡合法恢复。 | 6075d5b89269538a21d9a836d25bd89f2f106511ae4e36c21ae16cbc70340a3d |
| packages/computer/src/machineReadiness.ts          | runner 必须 alive，版本及连接证明必须匹配 PID。RAH 关闭失效后台的 gateway，避免独立页面存活被当成整机就绪。                                                           | c603fa3b5a49cf895724928f953b654fcf5a4009f5e7b4d5645797d263eaed23 |
| packages/computer/src/health.ts                    | 持久记录退出代码、信号及 fatal 状态。RAH 保留原 Run 来源并传播实际后台失败，不把失败转成假成功。                                                                      | fab4a61194940a16eb6471f093f130d1f25b9a4b8ae18f85d69c827542c3bce4 |

补充比较 Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `server/cmd/multica/cmd_daemon.go`：启动阶段监听 child.Wait、区分 starting／running，前台 d.Run 非取消错误向上传播。其实现依赖远端 daemon 拓扑，未引入本地 RAH；本批为上游行为参考下的 RAH glue 修复，不是 byte-exact 复用或新的恢复算法。

Raft 上述逻辑属于 Computer 生命周期证据，并不拥有 RAH 的 Activation／RunAttempt。未声称官网经过同条件整机重启实验。

## 修改与失败测试

1. Kernel 的 Activation generation 查询按 `attempt_count` 选择 Run 和 Placement。过去查询任意最新历史 Run，导致新的 Placement 被旧 Host 的已终止 Run 拦截。原 Run 的 generation 检查未改；旧执行者不能续约新 attempt，新 Host 不能改旧 Run。新增 exited／cancelled 两种回归，修复前实际得到同一 ExecutionFencedError，修复后新 Run 可领取且旧记录逐字段不变。
2. Local Core composition 为 applicationRun 传播 terminal failure；非预期 resolve 也视为故障，关闭 gateway 后通知外层。正常 stop 不产生假失败，gateway 只关闭一次。外层只接受当前在线 owner 的失败，不让已替换 owner 的迟到结果污染后继。
3. 原先启动后失败只留在内部 Promise，外层服务继续监听。新增 reject／unexpected-exit 测试在修复前失败，正常 stop 对照通过；外层失败传播测试修复前也失败，修复后通过。

没有新增队列、记忆存储、中央服务或自动无限重试。没有改变 Agent 的角色、模型配置或记忆策略。

## 验证

- `npm run check` 完整通过；检查期间仅扩展本批测试与文档，没有继续修改产品行为。最终再运行本批完整专项 50 项，全部通过。
- `npm run format:check`、`git diff --check` 通过；文档完稿后再次核对。
- `npm run build:web:workbench` 通过，保留已有 bundle size 提示。
- 使用上一轮失败现场原状态启动真实工作台，没有重新发送 R0908：原 Activation 创建新的 Run，实际 Kimi 发布恰好一条 `R0908 RECOVERED`，thread_id 与原请求相同，Activation completed。旧 Run 保留 cancelled／SIGKILL／drain timeout，未重写。
- 另一 Agent 在原 DM 收到一条有界请求后实际回复 `R0908-A ALIVE`。这证明本批恢复后另一身份可继续执行，不外推为全部并发配置故障组合。
- 浏览器实际看到恢复结果的 Room 预览和另一 Agent 私聊回复。打开中的 Thread 明细仍可能未自动刷新，已保留为独立前端问题；本批不把后端成功包装成完整前端旅程收口。

证据：`/Users/sun/Code/reviews/rah_os/2026-09-08-recovery-repair/` 保存检查日志；原现场目录 `2026-09-08-multi-agent-journey/` 中的 `recovery-fixed.log`、`recovery-fixed-canonical.json` 关联原请求、新旧 Run 和消息。真实 Provider 沿用已批准的 Kimi K3 low；本批未运行 Claude／Codex 付费调用。

## 正式交付

正式实例通过空闲检查和备份回执校验后，旧 PID 33920 优雅退出，新 PID 43150 在 `http://127.0.0.1:4173` 提供服务。冻结 Web build 为 `11e028868d2c84e075aab14d3a6503e46680bc2b89c0ec09dcd595bea75d65a3`。备份位于 `/Users/sun/.rah/backups/pre-restart-9dd846f1-a716-4c5c-8d4f-f692d1fe0f3a`。

新浏览器页面已实际打开 Computer 和 Chat，并检查截图；Computer 已连接，四个 Agent 资料及 Room 历史可见。备份与在线数据库的 messages、rooms、memberships、agent_definitions、agent_definition_revisions 完全一致，37 个 Agent 私有记忆文件逐文件哈希一致，见 `formal-persistence-check.json`。隔离实验实例已优雅停止，现场保留。未提交或推送 Git。

本批没有宣称完整 Raft 高可用或全部前端验收通过。原 Thread 面板未实时更新的问题在此次恢复结果到达后再次观察到：Room 预览为 5 条，打开的消息列仍显示 4 条，截图保留在工具记录中。这一前端更新缺口单独留待修复；新的后端恢复消息已明确写入正确 Thread。
