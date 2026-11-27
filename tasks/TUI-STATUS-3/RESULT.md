# TUI-STATUS-3

## v2

- Board 集中显示健康状态、待处理事项、Leader 与 Auditor、各区域的计数和最近一小时的投递状态。无待处理事项时显示「一切正常」。Workers、Gates 和 Notices 的计数可点击跳转，投递行可打开含全量计数的详情。旧的拒绝投递仍可在详情中查看。
- Workers 默认只显示在线和空闲保留的会话，按 `a` 或点击筛选行查看已释放、已结束的会话。表格按实际内容分配宽度，保留完整 Wave 和八位 UUID 短地址，并显示 CLI·model、投递结果和会话年龄。空闲倒计时来自 `board.workers[].releaseAt`，已释放来自 `releasedAt`。两者均为 Unix 毫秒。WORKER-REAP-1 提供实际释放计划，本卡通过 fixture 验证这两个字段的呈现。
- Gates 每个轮次单列一行，显示裁决标签、等待对象和年龄。裁决首行以弱化样式显示在下一行，详情保留裁决全文、门禁包路径和完整材料路径。新轮次收到前一轮的结论或结束事件后仍可保持开放。
- Notices 按最新时间排序，展示相对时间、级别、可读类型、角色、已读状态和摘要。重复事项合并计数，普通投递成功回执只计数。已读状态来自 loomd 的通知记录。
- Leader 与 Auditor 的 Context 使用最近一次原生模型调用的输入 token 和模型窗口。Gemini 4 Neon、Claude Sonnet 5.5 缺少实测窗口时，界面用 `≈` 标记估算值。
- 支持 SGR 鼠标报告。点击页签或区域计数可跳转，点击列表行可选择，双击或回车可打开详情，滚轮可滚动。退出和可捕获的异常路径会恢复鼠标报告、光标和终端屏幕模式。[XTerm SGR 协议](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking)
- 隔离环境中的 `npm test` 通过 731 项。更新了 80、120、200 列五个页签的文本快照，并验证了分片鼠标报告、窗口投递计数、门禁轮次、通知分组和重连。在独立 Herdr 临时页签中通过 `hc attach` 注入 SGR 报告，实测点击、双击、滚轮、门禁详情和正常退出。另用独立 PTY 验证未捕获异常时的模式恢复。

STATUS: done
