# DELIVERY-SLA-1 结果

## 投递与升级

- loomd 在原有定时轮询中复查在途投递，目标原生记录里出现 `[loom:<id>]` 才确认送达。收件箱保留年龄、原因、首次停滞时间和一次性重试预约，接管后继续对账。空闲目标默认 120 秒，确认忙碌或压缩时为 360 秒。
- `loom status` 置顶停滞投递。发件人的下一次唤醒附上 ID、目标、原因和年龄。Worker 已出结果、Leader 尚未收到时，卡片显示 `result-undelivered`。Leader 的收件停滞升报 Auditor。Auditor 的收件停滞经桌面提示和 `loom notifications` 升给 Super／用户。告警按投递去重，Auditor 与桌面渠道各按项目五分钟节流。
- TUI 延续内联粘贴和既有超大回复文件阈值。再次按 Enter 至少等 1.5 秒，核对原生轮、完整自有草稿、光标、编辑输入和交互提示，最多一次，回执记为 `re-enter`。Claude 在首次 Enter 后出现待选择问题时，回归测试确认只发出一次 Enter。

## 历史回放与隔离实测

- `57883071` 在 42×24 时分段写入 639 字节。历史重排至 200×120 后，完整画面读回 611 字节，和 615 字节的 wire 只差空白。holder 读回采用流式 UTF-8 解码，保留跨日志分块的字符。原 holder 只保存了输入偏移 140→145，这 5 字节的类别无法追溯。回归在同一帧分别模拟 5 字节的 DA 回报、编辑键和旧日志未知输入，仅确认 DA 的分支自动提交。两个历史 ID 的逾期回归都在 120 秒后生成停滞事件并升给 Auditor，重启后仍只产生一次告警。[重排夹具](pilot-reflow.json)
- `919d7ab2` 的交接投递 `5b58581e` 实际只写入 1281／4621 字节，第二段在 UTF-8 字符中间短写。原始回执回放没有得到可续写位置，草稿保留供停滞升级。[只读回放日志](/tmp/loom-delivery-sla-verified.BsCRCy/handover-replay.log)
- 隔离 HOME 中启动原生 agy 和真实 holder，使用回环模型端点重放 `57883071`。重排后向测试 PTY 发入 5 字节 DA 回报，编辑序号保持不变，loomd 的 TUI 控制逻辑自动提交，得到一次原生确认。原生 transcript 的 615 字节与原文完全相同。[原生 agy 实测](/tmp/loom-delivery-sla-verified.BsCRCy/live-agy.log)
- 在独立 hc 服务上实测临时增高内层 PTY。初始内外都为 42×24，可见标记行 1–23。内层增至 64 行后，holder 可读 1–63 行，已附着的 hc 仍为 24 行，可见范围移到 41–63。恢复高度后 hc 又显示 1–23。自动增高会让附着视图丢失顶部内容，所以本次只记录测量结果。[hc 高度实测](/tmp/loom-delivery-sla-verified.BsCRCy/tall-hc.log)

## 测试与交付

- 在与 `e17e06c3` 实现相同的基线归档上连续跑了 12 轮 `npm test`。第 7 轮全绿，另 11 轮共捕获 27 次叶子用例失败。失败集中在 `daemon/hardening.test.mjs` 的 ACP 波次、原生退出和 SIGKILL 持久化子例。清理阶段对已退出属主的进程组执行 `kill(-pgid, 0)`，macOS 有时返回 `EPERM`。清理现在先按 PID、UID、启动时间和可执行文件核对进程身份，复查活体成员，并保留泄漏断言。[12 轮基线日志](/tmp/loom-delivery-sla-baseline.pP0FIg/logs)
- 最终工作树的 `npm test` 通过 379 项，0 失败、0 取消、0 跳过。holder 重新构建了 macOS arm64、Linux arm64 和 Linux x64 发布文件，原生运行验证在 macOS 完成。[最终全量日志](/tmp/loom-delivery-sla-verified.BsCRCy/final.log)
- 文档和 Leader／Auditor 技能已更新。pilot-2 只做了历史记录读取，所有发键和尺寸变更都在隔离测试中完成。改动留在当前工作树，未提交。

STATUS: done
