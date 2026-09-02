# Thread Files 与长历史真实浏览器验收

日期：2026-09-01。

## 自动化与浏览器结果

| 用例                                 | 结果                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Thread 请求 body/attachment 严格合同 | 通过；附件-only 合法，二者皆空拒绝                                               |
| Kernel 原子消费与幂等重放            | 通过；附件投影到 Thread Message 与 Room Files，同一请求重放 deduplicated         |
| Room/Thread 上传草稿隔离             | 通过；同一 Room reservation 下两个表现草稿互不污染                               |
| 真实 Chromium 上传                   | 通过；浏览器构造真实 `File`，等待上传完成后以空正文提交 Thread 回复              |
| Thread Message 卡片                  | 通过；Thread 内显示 `thread-browser-gate.txt`                                    |
| Room Files 投影                      | 通过；关闭 Thread 后 Files tab 显示同一文件                                      |
| 后续主链回归                         | 通过；该次门禁继续跑完 Thread/Task/Agent/移动端，最终报告 `390x844`              |
| 10,050 条长历史                      | 通过；1440×1000，prepend anchor delta 0，DOM 27 行，Markdown refresh 20 次无失败 |

针对性测试命令的 31 项全部通过，`npm run typecheck` 通过；真实浏览器命令为 `npm run test:web:browser` 与 `npm run test:web:message-timeline`。

## 证据边界

测试使用隔离 Fake Runtime，不调用付费 Provider。它证明文件的 Human 上传、canonical Thread Message、Files read model 和长历史渲染，而不证明 Agent 已读取文件内容或生成 Artifact。浏览器选择的测试文件是门禁自产的无敏感文本；不包含用户文件。

## 正式发布与状态保持

Thread 写入链在隔离真实 Chromium 中完成后才发布；正式 `4173` 的新页只做读取与导航复验，没有向用户 Room 写测试消息或调用付费 Provider。切换前备份位于 `/Users/sun/Library/Application Support/RAH OS/backup-before-agent-mcp-thread-files-4xHWYl`，正式入口脚本为 `/assets/index-oDMj5FZ7.js`。

启动后对 Workspace、Room、Membership、Message、Thread、Task、InputRequest、Agent Definition/Revision、Execution Policy/Revision、Memory Home、Room Files、MCP、收藏和侧栏偏好逐表做双向 `EXCEPT`，差异均为 0；8 个私有配置、凭据、Provider session 和 Agent Memory 文件哈希不变。正式页面健康状态与新 DOM 同时复验，不以 health 单独代替浏览器验收。
